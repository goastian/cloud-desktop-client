const chokidar = require('chokidar');
const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Transform } = require('stream');

/**
 * E2: ThrottleTransform — a Transform stream that limits throughput to maxBytesPerSec.
 * Passes data through in timed chunks so the overall rate stays at or below the limit.
 */
class ThrottleTransform extends Transform {
    constructor(maxBytesPerSec) {
        super();
        this.maxBytesPerSec = maxBytesPerSec;
        this.bytesSentInWindow = 0;
        this.windowStart = Date.now();
    }

    _transform(chunk, encoding, callback) {
        if (!this.maxBytesPerSec || this.maxBytesPerSec <= 0) {
            // No limit — passthrough
            this.push(chunk);
            return callback();
        }

        const sendChunk = (offset) => {
            if (offset >= chunk.length) return callback();

            const now = Date.now();
            const elapsed = now - this.windowStart;

            // Reset window every second
            if (elapsed >= 1000) {
                this.bytesSentInWindow = 0;
                this.windowStart = now;
            }

            const remaining = this.maxBytesPerSec - this.bytesSentInWindow;
            if (remaining <= 0) {
                // Wait until next window
                const waitMs = 1000 - elapsed;
                setTimeout(() => sendChunk(offset), waitMs);
                return;
            }

            const slice = chunk.slice(offset, offset + remaining);
            this.push(slice);
            this.bytesSentInWindow += slice.length;
            sendChunk(offset + slice.length);
        };

        sendChunk(0);
    }
}

class SyncEngine extends EventEmitter {
    constructor(syncFolder, authToken, serverUrl, store, activityHistory = null, settingsManager = null) {
        super();
        this.syncFolder = syncFolder;
        this.authToken = authToken;
        this.serverUrl = serverUrl;
        this.store = store;
        this.activityHistory = activityHistory;
        this.settingsManager = settingsManager; // E1: For selective sync exclusion checks
        this.watcher = null;
        this.syncing = false;
        this.paused = false;
        this.syncQueue = [];
        this.processing = false;
        this.fileMap = new Map();        // Mapa: ruta local archivo → ID archivo servidor
        this.folderMap = new Map();      // Mapa: ruta relativa carpeta → ID carpeta servidor
        this.workspaceId = null;
        this.folderId = null; // Set externally for multi-folder support
        this.downloadingPaths = new Set(); // A5 fix: Track paths being downloaded to avoid re-upload loops
        this.maxConcurrency = 3; // C4: Max concurrent uploads
        this.activeUploads = 0; // C4: Current active upload count
        this.maxRetries = 3; // C4: Max retry attempts per item
        
        // Load persisted maps for this folder
        this._loadFileMap();
        this._loadFolderMap();
    }

    _getFileMapKey() {
        // Create a unique key for this folder's fileMap
        const folderHash = Buffer.from(this.syncFolder).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
        return `fileMap_${folderHash}`;
    }

    _loadFileMap() {
        try {
            const saved = this.store.get(this._getFileMapKey(), null);
            if (saved && typeof saved === 'object') {
                this.fileMap = new Map(Object.entries(saved));
                console.log(`Loaded ${this.fileMap.size} cached file mappings for ${this.syncFolder}`);
            }
        } catch (error) {
            console.warn('Could not load fileMap:', error.message);
            this.fileMap = new Map();
        }
    }

    _saveFileMap() {
        try {
            const obj = Object.fromEntries(this.fileMap);
            this.store.set(this._getFileMapKey(), obj);
        } catch (error) {
            console.warn('Could not save fileMap:', error.message);
        }
    }

    _getFolderMapKey() {
        const folderHash = Buffer.from(this.syncFolder).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
        return `folderMap_${folderHash}`;
    }

    _loadFolderMap() {
        try {
            const saved = this.store.get(this._getFolderMapKey(), null);
            if (saved && typeof saved === 'object') {
                this.folderMap = new Map(Object.entries(saved));
                console.log(`Loaded ${this.folderMap.size} cached folder mappings`);
            }
        } catch (error) {
            console.warn('Could not load folderMap:', error.message);
            this.folderMap = new Map();
        }
    }

    _saveFolderMap() {
        try {
            const obj = Object.fromEntries(this.folderMap);
            this.store.set(this._getFolderMapKey(), obj);
        } catch (error) {
            console.warn('Could not save folderMap:', error.message);
        }
    }

    // A2: Persist sync queue for crash recovery
    _getQueueKey() {
        const folderHash = Buffer.from(this.syncFolder).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
        return `syncQueue_${folderHash}`;
    }

    _loadQueue() {
        try {
            const saved = this.store.get(this._getQueueKey(), null);
            if (Array.isArray(saved) && saved.length > 0) {
                this.syncQueue = saved;
                console.log(`[A2] Recovered ${saved.length} pending queue items for ${this.syncFolder}`);
            }
        } catch (error) {
            console.warn('Could not load sync queue:', error.message);
        }
    }

    _saveQueue() {
        try {
            this.store.set(this._getQueueKey(), this.syncQueue);
        } catch (error) {
            console.warn('Could not save sync queue:', error.message);
        }
    }

    _clearPersistedQueue() {
        this.store.delete(this._getQueueKey());
    }

    /**
     * E1: Check if a file should be excluded from sync based on settings
     */
    _isExcluded(filePath) {
        if (!this.settingsManager) return false;
        const fileName = path.basename(filePath);
        return this.settingsManager.shouldExcludeFile(filePath, fileName);
    }

    /**
     * Limpia el cache de sincronización para forzar una re-sincronización completa
     */
    clearSyncCache() {
        console.log('🗑️  Limpiando cache de sincronización...');
        this.fileMap.clear();
        this.folderMap.clear();
        this.store.delete(this._getFileMapKey());
        this.store.delete(this._getFolderMapKey());
        console.log('✓ Cache limpiado. La próxima sincronización será completa.');
    }

    async start() {
        console.log('Starting sync engine...');
        this.syncing = true;
        this.processing = true;
        this.emit('status-changed');

        // A2: Recover any pending queue items from a previous crash
        this._loadQueue();

        try {
            // Get default workspace
            try {
                await this.loadWorkspace();
            } catch (error) {
                console.warn('Could not load workspace, using default:', error.message);
                this.workspaceId = 1;
            }
            
            // MODO BIDIRECCIONAL SEGURO
            console.log('='.repeat(60));
            console.log('🔄 SYNC MODE: BIDIRECTIONAL (SAFE)');
            console.log('✓ Local file watching: ENABLED');
            console.log('✓ Upload to server: ENABLED');
            console.log('✓ Download from server: ENABLED (safe mode)');
            console.log('✓ Periodic sync: ENABLED (every 30s)');
            console.log('='.repeat(60));
            
            // Sincronización inicial segura
            try {
                await this.safeInitialSync();
            } catch (error) {
                console.warn('Initial sync failed:', error.message);
            }
            
            // Start watching local folder
            this.startWatcher();
            
            // Start periodic sync
            this.startPeriodicSync();
            
            console.log('Sync engine started successfully');
            
            // Mark initial sync as complete - now idle
            this.processing = false;
            this.emit('status-changed');
        } catch (error) {
            console.error('Error starting sync engine:', error);
            this.syncing = false;
            this.processing = false;
            this.emit('status-changed');
            throw error;
        }
    }

    async loadWorkspace() {
        try {
            const response = await this.apiRequest('get', '/api/external/workspaces');
            const workspaces = response.data.data || response.data;
            
            const defaultWorkspace = workspaces.find(w => w.is_default) || workspaces[0];
            
            if (!defaultWorkspace) {
                throw new Error('No workspace found');
            }
            
            this.workspaceId = defaultWorkspace.id;
            console.log('Using workspace:', defaultWorkspace.name);
        } catch (error) {
            console.error('Error loading workspace:', error);
            throw error;
        }
    }

    /**
     * Sincronización inicial completa (Bootstrap Sync)
     * 
     * Flujo:
     * 1. Escanear todos los archivos locales existentes
     * 2. Obtener todos los archivos del servidor
     * 3. Comparar estados y decidir acciones:
     *    - Subir: archivo existe local pero no en servidor
     *    - Descargar: archivo existe en servidor pero no local
     *    - Conflicto: archivo existe en ambos pero son diferentes
     * 4. Ejecutar las acciones de sincronización
     */
    async safeInitialSync() {
        console.log('\n' + '='.repeat(60));
        console.log('🔄 BOOTSTRAP SYNC - Sincronización Inicial Completa');
        console.log('='.repeat(60));
        console.log(`   Server URL: ${this.serverUrl}`);
        console.log(`   Workspace ID: ${this.workspaceId}`);
        console.log(`   Sync Folder: ${this.syncFolder}`);
        
        const syncStartTime = Date.now();
        
        // Log sync start
        if (this.activityHistory) {
            this.activityHistory.logSyncStart(this.folderId, path.basename(this.syncFolder));
        }
        
        try {
            // PASO 1: Escanear archivos y carpetas locales
            console.log('\n📂 PASO 1: Escaneando archivos y carpetas locales...');
            const localFiles = await this.scanLocalFiles();
            const localFolders = this.getScannedFolders();
            console.log(`   Encontrados ${localFiles.length} archivos y ${localFolders.length} carpetas locales`);
            
            // PASO 1.5: Crear estructura de carpetas en el servidor PRIMERO
            if (localFolders.length > 0) {
                console.log('\n📁 PASO 1.5: Creando estructura de carpetas en el servidor...');
                
                // Ordenar carpetas por profundidad (menos profunda primero)
                const sortedFolders = [...localFolders].sort((a, b) => {
                    const depthA = a.relativePath.split(path.sep).length;
                    const depthB = b.relativePath.split(path.sep).length;
                    return depthA - depthB;
                });
                
                for (const folder of sortedFolders) {
                    try {
                        await this.getOrCreateServerFolder(folder.relativePath);
                    } catch (error) {
                        console.error(`   ✗ Error creando carpeta ${folder.relativePath}:`, error.message);
                    }
                }
                console.log(`   ✓ Estructura de carpetas sincronizada`);
            }
            
            // PASO 2: Obtener archivos del servidor
            console.log('\n☁️  PASO 2: Obteniendo archivos del servidor...');
            const serverFiles = await this.getServerFiles();
            console.log(`   Encontrados ${serverFiles.length} archivos en el servidor`);
            
            // PASO 3: Comparar y decidir acciones
            console.log('\n🔍 PASO 3: Comparando estados...');
            const syncActions = await this.compareAndDecide(localFiles, serverFiles);
            
            console.log(`\n📊 Resumen de acciones:`);
            console.log(`   ⬆️  Subir: ${syncActions.upload.length} archivos`);
            console.log(`   ⬇️  Descargar: ${syncActions.download.length} archivos`);
            console.log(`   ⚠️  Conflictos: ${syncActions.conflicts.length} archivos`);
            console.log(`   ✓ Sin cambios: ${syncActions.unchanged.length} archivos`);
            
            // PASO 4: Ejecutar acciones de sincronización
            console.log('\n⚡ PASO 4: Ejecutando sincronización...');
            
            // 4a: Subir archivos locales que no existen en el servidor
            if (syncActions.upload.length > 0) {
                console.log('\n   ⬆️  Subiendo archivos nuevos al servidor...');
                
                // Ordenar archivos por profundidad de directorio (menos profundo primero)
                const sortedFiles = [...syncActions.upload].sort((a, b) => {
                    const depthA = a.relativeDir ? a.relativeDir.split(path.sep).length : 0;
                    const depthB = b.relativeDir ? b.relativeDir.split(path.sep).length : 0;
                    return depthA - depthB;
                });
                
                for (const localFile of sortedFiles) {
                    try {
                        const displayPath = localFile.relativeDir 
                            ? `${localFile.relativeDir}/${localFile.name}` 
                            : localFile.name;
                        console.log(`      Subiendo: ${displayPath}`);
                        await this.uploadFile(localFile.path);
                        console.log(`      ✓ ${displayPath} subido`);
                        
                        // Log activity
                        if (this.activityHistory) {
                            this.activityHistory.logUpload(localFile.path, localFile.size, this.folderId);
                        }
                    } catch (error) {
                        console.error(`      ✗ Error subiendo ${localFile.name}:`, error.message);
                        if (this.activityHistory) {
                            this.activityHistory.logError(`Error subiendo ${localFile.name}`, { 
                                filePath: localFile.path, 
                                error: error.message 
                            });
                        }
                    }
                }
            }
            
            // 4b: Descargar archivos del servidor que no existen localmente
            if (syncActions.download.length > 0) {
                console.log('\n   ⬇️  Descargando archivos del servidor...');
                for (const serverFile of syncActions.download) {
                    try {
                        const fileName = this.getServerFileName(serverFile);
                        // Usar la ruta relativa del servidor si está disponible
                        const serverRelativePath = serverFile.serverRelativePath || fileName;
                        const localPath = path.join(this.syncFolder, serverRelativePath);
                        
                        // Crear carpetas locales si no existen
                        const localDir = path.dirname(localPath);
                        await fs.mkdir(localDir, { recursive: true });
                        
                        console.log(`      Descargando: ${serverRelativePath}`);
                        await this.safeDownloadFile(serverFile, fileName, localPath);
                        this.fileMap.set(localPath, serverFile.id);
                        
                        // Log activity
                        if (this.activityHistory) {
                            this.activityHistory.logDownload(localPath, serverFile.size || 0, this.folderId);
                        }
                    } catch (error) {
                        console.error(`      ✗ Error descargando:`, error.message);
                        if (this.activityHistory) {
                            this.activityHistory.logError(`Error descargando ${serverFile.name || 'archivo'}`, { 
                                error: error.message 
                            });
                        }
                    }
                }
            }
            
            // 4c: Resolver conflictos (por defecto: servidor gana si es más reciente)
            if (syncActions.conflicts.length > 0) {
                console.log('\n   ⚠️  Resolviendo conflictos...');
                for (const conflict of syncActions.conflicts) {
                    try {
                        await this.resolveConflict(conflict);
                    } catch (error) {
                        console.error(`      ✗ Error resolviendo conflicto:`, error.message);
                    }
                }
            }
            
            // Guardar estado
            this._saveFileMap();
            this._saveFolderMap();
            
            const syncDuration = Date.now() - syncStartTime;
            
            // Log sync complete
            if (this.activityHistory) {
                this.activityHistory.logSyncComplete(this.folderId, path.basename(this.syncFolder), {
                    uploaded: syncActions.upload.length,
                    downloaded: syncActions.download.length,
                    duration: syncDuration
                });
            }
            
            console.log('\n' + '='.repeat(60));
            console.log('✓ BOOTSTRAP SYNC COMPLETADO');
            console.log('='.repeat(60) + '\n');
            
        } catch (error) {
            console.error('Error en sincronización inicial:', error.message);
            if (this.activityHistory) {
                this.activityHistory.logError('Error en sincronización inicial', { error: error.message });
            }
            throw error;
        }
    }
    
    /**
     * Escanea recursivamente la carpeta local y retorna información de todos los archivos y carpetas
     */
    async scanLocalFiles(dir = null, localFolders = null) {
        const scanDir = dir || this.syncFolder;
        const files = [];
        const isRoot = dir === null;
        
        // Si es la primera llamada, inicializar el array de carpetas
        if (isRoot) {
            this._scannedFolders = [];
        }
        
        try {
            const entries = await fs.readdir(scanDir, { withFileTypes: true });
            
            for (const entry of entries) {
                // Ignorar archivos ocultos y carpetas del sistema
                if (entry.name.startsWith('.')) continue;
                
                const fullPath = path.join(scanDir, entry.name);
                
                if (entry.isFile()) {
                    try {
                        const stats = await fs.stat(fullPath);
                        const hash = await this.calculateFileHash(fullPath);
                        
                        const relativePath = path.relative(this.syncFolder, fullPath);
                        const relativeDir = path.dirname(relativePath);
                        
                        files.push({
                            name: entry.name,
                            path: fullPath,
                            relativePath: relativePath,
                            relativeDir: relativeDir === '.' ? '' : relativeDir,
                            size: stats.size,
                            mtime: stats.mtime,
                            hash: hash
                        });
                    } catch (error) {
                        console.warn(`      ⚠️  No se pudo leer: ${entry.name}`);
                    }
                } else if (entry.isDirectory()) {
                    // Registrar la carpeta
                    const folderRelativePath = path.relative(this.syncFolder, fullPath);
                    this._scannedFolders.push({
                        name: entry.name,
                        path: fullPath,
                        relativePath: folderRelativePath
                    });
                    
                    // Recursivamente escanear subdirectorios
                    const subFiles = await this.scanLocalFiles(fullPath);
                    files.push(...subFiles);
                }
            }
        } catch (error) {
            console.error(`Error escaneando ${scanDir}:`, error.message);
        }
        
        return files;
    }
    
    /**
     * Obtiene las carpetas locales escaneadas
     */
    getScannedFolders() {
        return this._scannedFolders || [];
    }
    
    /**
     * A4: Calcula hash de un archivo — usa hash parcial para archivos grandes (>10MB)
     * Lee solo los primeros y últimos 64KB + tamaño para detección rápida de cambios
     */
    async calculateFileHash(filePath) {
        const PARTIAL_THRESHOLD = 10 * 1024 * 1024; // 10MB
        const CHUNK_SIZE = 64 * 1024; // 64KB

        const stats = await fs.stat(filePath);

        if (stats.size <= PARTIAL_THRESHOLD) {
            // Small file: full hash
            return new Promise((resolve, reject) => {
                const hash = crypto.createHash('sha256');
                const stream = fsSync.createReadStream(filePath);
                stream.on('data', data => hash.update(data));
                stream.on('end', () => resolve(hash.digest('hex')));
                stream.on('error', error => reject(error));
            });
        }

        // Large file: partial hash (first chunk + last chunk + size)
        const hash = crypto.createHash('sha256');
        hash.update(`size:${stats.size}`);

        // Read first chunk
        const headBuf = Buffer.alloc(CHUNK_SIZE);
        const fd = await fs.open(filePath, 'r');
        try {
            await fd.read(headBuf, 0, CHUNK_SIZE, 0);
            hash.update(headBuf);

            // Read last chunk
            const tailOffset = Math.max(0, stats.size - CHUNK_SIZE);
            const tailBuf = Buffer.alloc(CHUNK_SIZE);
            await fd.read(tailBuf, 0, CHUNK_SIZE, tailOffset);
            hash.update(tailBuf);
        } finally {
            await fd.close();
        }

        return hash.digest('hex');
    }
    
    /**
     * Obtiene todos los archivos del servidor (incluyendo los de subcarpetas)
     */
    async getServerFiles() {
        try {
            // Usar el endpoint /sync/files que devuelve TODOS los archivos sin filtrar por carpeta
            const response = await this.apiRequest('get', '/api/external/sync/files', {
                params: { 
                    workspace_id: this.workspaceId
                }
            });
            
            let serverFiles = [];
            if (response.data && response.data.data) {
                serverFiles = response.data.data;
            } else if (Array.isArray(response.data)) {
                serverFiles = response.data;
            }
            
            return serverFiles || [];
        } catch (error) {
            console.error('Error obteniendo archivos del servidor:', error.message);
            return [];
        }
    }
    
    /**
     * Obtiene el nombre de archivo del servidor de forma segura
     */
    getServerFileName(file) {
        let fileName = file.original_name || file.name;
        
        // Si no tiene extensión, agregarla del mime_type
        if (fileName && !path.extname(fileName) && file.mime_type) {
            const ext = this.getExtensionFromMimeType(file.mime_type);
            if (ext) {
                fileName = `${fileName}${ext}`;
            }
        }
        
        // Si aún no hay nombre válido, usar el name con extensión del path
        if (!fileName && file.path) {
            const pathExt = path.extname(file.path);
            fileName = file.name + pathExt;
        }
        
        return fileName || 'unknown';
    }
    
    /**
     * Normaliza una ruta para comparación cross-platform
     * Convierte separadores a / y lowercase
     */
    normalizePath(p) {
        if (!p) return '';
        return p.replace(/\\/g, '/').toLowerCase();
    }
    
    /**
     * Compara archivos locales con archivos del servidor y decide qué acciones tomar
     * Considera la estructura de carpetas para una comparación correcta
     */
    async compareAndDecide(localFiles, serverFiles) {
        const actions = {
            upload: [],      // Archivos locales que no existen en servidor
            download: [],    // Archivos del servidor que no existen localmente
            conflicts: [],   // Archivos que existen en ambos pero son diferentes
            unchanged: []    // Archivos que están sincronizados
        };
        
        // Obtener carpetas del servidor para construir rutas completas
        const serverFolders = await this.getServerFolders();
        const folderIdToPath = new Map();
        
        // Construir mapa de folder_id -> ruta
        for (const folder of serverFolders) {
            folderIdToPath.set(folder.id, this.buildFolderPath(folder, serverFolders));
        }
        
        console.log(`   📊 Carpetas del servidor: ${serverFolders.length}`);
        for (const [id, folderPath] of folderIdToPath) {
            console.log(`      folder_id ${id} -> ${folderPath}`);
        }
        
        // Crear mapa de archivos del servidor por ruta relativa completa (normalizada)
        const serverFileMap = new Map();
        for (const serverFile of serverFiles) {
            const fileName = this.getServerFileName(serverFile);
            if (fileName && fileName !== 'unknown') {
                // Construir ruta relativa completa incluyendo carpeta
                let relativePath = fileName;
                if (serverFile.folder_id && folderIdToPath.has(serverFile.folder_id)) {
                    const folderPath = folderIdToPath.get(serverFile.folder_id);
                    relativePath = folderPath + '/' + fileName;
                }
                const normalizedPath = this.normalizePath(relativePath);
                serverFileMap.set(normalizedPath, { ...serverFile, serverRelativePath: relativePath });
            }
        }
        
        // Crear mapa de archivos locales por ruta relativa (normalizada)
        const localFileMap = new Map();
        for (const localFile of localFiles) {
            const normalizedPath = this.normalizePath(localFile.relativePath);
            localFileMap.set(normalizedPath, localFile);
        }
        
        console.log(`   📊 Archivos locales: ${localFileMap.size}, Archivos servidor: ${serverFileMap.size}`);
        
        // Comparar archivos locales con servidor
        for (const localFile of localFiles) {
            const normalizedLocalPath = this.normalizePath(localFile.relativePath);
            const serverFile = serverFileMap.get(normalizedLocalPath);
            
            if (!serverFile) {
                // Archivo existe localmente pero no en servidor -> SUBIR
                actions.upload.push(localFile);
            } else {
                // Archivo existe en ambos -> comparar
                const localPath = localFile.path;
                
                // Verificar si ya está en el fileMap (ya sincronizado antes)
                if (this.fileMap.has(localPath) && this.fileMap.get(localPath) === serverFile.id) {
                    // Ya está sincronizado, verificar si cambió
                    if (localFile.size === serverFile.size) {
                        actions.unchanged.push({ local: localFile, server: serverFile });
                    } else {
                        // Tamaño diferente = conflicto
                        actions.conflicts.push({ local: localFile, server: serverFile });
                    }
                } else {
                    // No está en fileMap, comparar por tamaño
                    if (localFile.size === serverFile.size) {
                        // Mismo tamaño, asumir sincronizado
                        this.fileMap.set(localPath, serverFile.id);
                        actions.unchanged.push({ local: localFile, server: serverFile });
                    } else {
                        // Tamaño diferente = conflicto
                        actions.conflicts.push({ local: localFile, server: serverFile });
                    }
                }
            }
        }
        
        // Encontrar archivos que existen en servidor pero no localmente
        for (const [serverRelativePath, serverFile] of serverFileMap) {
            if (!localFileMap.has(serverRelativePath)) {
                actions.download.push(serverFile);
            }
        }
        
        return actions;
    }
    
    /**
     * Construye la ruta completa de una carpeta basándose en su jerarquía de padres
     * Siempre usa / como separador para consistencia cross-platform
     */
    buildFolderPath(folder, allFolders) {
        const parts = [folder.name];
        let current = folder;
        
        while (current.parent_id) {
            const parent = allFolders.find(f => f.id === current.parent_id);
            if (parent) {
                parts.unshift(parent.name);
                current = parent;
            } else {
                break;
            }
        }
        
        // Usar / siempre para consistencia cross-platform
        return parts.join('/');
    }
    
    /**
     * Obtiene o crea una carpeta en el servidor, retorna el ID de la carpeta
     * @param {string} relativePath - Ruta relativa de la carpeta (ej: "docs/proyectos")
     * @returns {number|null} - ID de la carpeta en el servidor o null si es raíz
     */
    async getOrCreateServerFolder(relativePath) {
        if (!relativePath || relativePath === '.' || relativePath === '') {
            return null; // Raíz, no necesita folder_id
        }
        
        // Normalizar la ruta (usar siempre / como separador para consistencia)
        const normalizedPath = relativePath.split(path.sep).join('/');
        
        // Verificar si ya tenemos esta carpeta mapeada
        if (this.folderMap.has(normalizedPath)) {
            console.log(`      📂 Carpeta en cache: ${normalizedPath} -> ID: ${this.folderMap.get(normalizedPath)}`);
            return this.folderMap.get(normalizedPath);
        }
        
        // Dividir la ruta en partes para crear jerarquía
        const parts = normalizedPath.split('/').filter(p => p && p !== '.');
        let parentId = null;
        let currentPath = '';
        
        console.log(`      📂 Creando jerarquía de carpetas: ${parts.join(' -> ')}`);
        
        for (const folderName of parts) {
            currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
            
            // Verificar si esta parte ya existe en el mapa
            if (this.folderMap.has(currentPath)) {
                parentId = this.folderMap.get(currentPath);
                console.log(`         ✓ ${currentPath} ya existe (ID: ${parentId})`);
                continue;
            }
            
            // Buscar si la carpeta ya existe en el servidor
            try {
                const response = await this.apiRequest('get', '/api/external/folders', {
                    params: {
                        workspace_id: this.workspaceId,
                        parent_id: parentId === null ? 'null' : parentId
                    }
                });
                
                const folders = response.data || [];
                const existingFolder = folders.find(f => 
                    f.name.toLowerCase() === folderName.toLowerCase()
                );
                
                if (existingFolder) {
                    parentId = existingFolder.id;
                    this.folderMap.set(currentPath, existingFolder.id);
                    console.log(`         ✓ ${currentPath} encontrada en servidor (ID: ${parentId})`);
                } else {
                    // Crear la carpeta
                    console.log(`         📁 Creando carpeta: ${folderName} (parent_id: ${parentId})`);
                    const createResponse = await this.apiRequest('post', '/api/external/folders', {
                        name: folderName,
                        workspace_id: this.workspaceId,
                        parent_id: parentId
                    });
                    
                    const newFolder = createResponse.data.folder || createResponse.data;
                    parentId = newFolder.id;
                    this.folderMap.set(currentPath, newFolder.id);
                    console.log(`         ✓ ${currentPath} creada (ID: ${newFolder.id})`);
                }
            } catch (error) {
                console.error(`         ✗ Error con carpeta ${currentPath}:`, error.message);
                return null;
            }
        }
        
        this._saveFolderMap();
        return parentId;
    }
    
    /**
     * Obtiene las carpetas del servidor para sincronización
     */
    async getServerFolders() {
        try {
            const response = await this.apiRequest('get', '/api/external/folders', {
                params: { 
                    workspace_id: this.workspaceId
                }
            });
            return response.data || [];
        } catch (error) {
            console.error('Error obteniendo carpetas del servidor:', error.message);
            return [];
        }
    }

    /**
     * Resuelve un conflicto entre archivo local y servidor
     * Por defecto: el más reciente gana
     */
    async resolveConflict(conflict) {
        const { local, server } = conflict;
        const serverModified = new Date(server.updated_at);
        const localModified = local.mtime;
        
        console.log(`      Conflicto: ${local.name}`);
        console.log(`         Local: ${local.size} bytes, modificado ${localModified.toISOString()}`);
        console.log(`         Server: ${server.size} bytes, modificado ${serverModified.toISOString()}`);

        // C7: If conflict resolution mode is 'ask', emit to renderer and wait
        const conflictMode = this.settingsManager ? this.settingsManager.getSetting('conflictMode', 'auto') : 'auto';
        let resolution;

        if (conflictMode === 'ask' && this._conflictResolver) {
            resolution = await this._conflictResolver({
                fileName: local.name,
                localPath: local.path,
                localSize: local.size,
                localModified: localModified.toISOString(),
                serverSize: server.size,
                serverModified: serverModified.toISOString(),
            });
        } else {
            // Auto-resolve: newest wins
            resolution = serverModified > localModified ? 'server' : 'local';
        }

        if (resolution === 'server') {
            console.log(`         Resolución: Descargar versión del servidor`);
            const fileName = this.getServerFileName(server);
            await this.safeDownloadFile(server, fileName, local.path);
            this.fileMap.set(local.path, server.id);
        } else if (resolution === 'local') {
            console.log(`         Resolución: Subir versión local`);
            await this.uploadFile(local.path);
        } else if (resolution === 'both') {
            // Keep both: rename local with .conflict suffix, then download server version
            const ext = path.extname(local.path);
            const base = local.path.slice(0, -ext.length || undefined);
            const conflictPath = `${base}.conflict-${Date.now()}${ext}`;
            await fs.promises.rename(local.path, conflictPath);
            console.log(`         Resolución: Mantener ambos (local renombrado a ${path.basename(conflictPath)})`);
            const fileName = this.getServerFileName(server);
            await this.safeDownloadFile(server, fileName, local.path);
            this.fileMap.set(local.path, server.id);
            // Upload the renamed conflict copy
            await this.uploadFile(conflictPath);
        } else {
            // Skip
            console.log(`         Resolución: Omitido`);
        }
    }

    /**
     * C7: Set a conflict resolver callback. Called with conflict info, must return
     * a Promise resolving to 'server', 'local', 'both', or 'skip'.
     */
    setConflictResolver(resolver) {
        this._conflictResolver = resolver;
    }

    getExtensionFromMimeType(mimeType) {
        const mimeMap = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/svg+xml': '.svg',
            'application/pdf': '.pdf',
            'text/plain': '.txt',
            'text/html': '.html',
            'text/css': '.css',
            'text/csv': '.csv',
            'text/javascript': '.js',
            'application/javascript': '.js',
            'application/json': '.json',
            'application/zip': '.zip',
            'application/x-rar-compressed': '.rar',
            'application/x-7z-compressed': '.7z',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'application/vnd.ms-excel': '.xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
            'application/vnd.ms-powerpoint': '.ppt',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
            'video/mp4': '.mp4',
            'video/webm': '.webm',
            'video/quicktime': '.mov',
            'audio/mpeg': '.mp3',
            'audio/wav': '.wav',
            'audio/ogg': '.ogg',
            'text/x-php': '.php',
            'application/x-httpd-php': '.php',
            'text/markdown': '.md',
            'application/xml': '.xml',
            'text/xml': '.xml'
        };
        
        return mimeMap[mimeType] || '';
    }

    async safeDownloadFile(file, fileName, localPath) {
        try {
            // A5 fix: Mark path as downloading so watcher handlers skip events for it
            this.downloadingPaths.add(localPath);
            
            // E2: Use streaming download with optional bandwidth throttling
            if (this.downloadBandwidthLimit && this.downloadBandwidthLimit > 0) {
                const response = await this.apiRequest('get', `/api/external/files/${file.id}/download`, null, {
                    responseType: 'stream'
                });
                
                await new Promise((resolve, reject) => {
                    const throttle = new ThrottleTransform(this.downloadBandwidthLimit);
                    const writeStream = fsSync.createWriteStream(localPath);
                    response.data
                        .pipe(throttle)
                        .pipe(writeStream)
                        .on('finish', resolve)
                        .on('error', reject);
                    response.data.on('error', reject);
                });
            } else {
                const response = await this.apiRequest('get', `/api/external/files/${file.id}/download`, null, {
                    responseType: 'arraybuffer'
                });
                
                if (!response.data || response.data.byteLength === 0) {
                    console.error('Empty file received:', fileName);
                    return;
                }
                
                const buffer = Buffer.from(response.data);
                await fs.writeFile(localPath, buffer);
            }
            
            console.log(`✓ Downloaded: ${fileName}`);
        } catch (error) {
            console.error(`✗ Download failed: ${fileName}:`, error.message);
        } finally {
            // A5 fix: Wait for filesystem events to settle, then remove from tracking set
            setTimeout(() => {
                this.downloadingPaths.delete(localPath);
            }, 2000);
        }
    }

    startPeriodicSync() {
        this.syncInterval = setInterval(async () => {
            if (!this.paused && !this.processing) {
                console.log('\n🔄 Checking for server changes...');
                await this.safeCheckServerChanges();
            }
        }, 30000); // Every 30 seconds
    }

    async safeCheckServerChanges() {
        try {
            const lastSync = this.store.get('lastSyncTime', null);
            
            // Obtener TODOS los archivos del servidor (incluyendo subcarpetas)
            const response = await this.apiRequest('get', '/api/external/sync/files', {
                params: { 
                    workspace_id: this.workspaceId
                }
            });
            
            const serverFiles = response.data.data || response.data;
            
            if (!Array.isArray(serverFiles) || serverFiles.length === 0) {
                console.log('No new changes on server');
                return;
            }
            
            // Obtener carpetas para construir rutas
            const serverFolders = await this.getServerFolders();
            const folderIdToPath = new Map();
            for (const folder of serverFolders) {
                folderIdToPath.set(folder.id, this.buildFolderPath(folder, serverFolders));
            }
            
            console.log(`Found ${serverFiles.length} files on server`);
            
            for (const file of serverFiles) {
                const fileName = this.getServerFileName(file);
                
                if (!fileName || fileName === 'unknown') {
                    continue;
                }
                
                // Construir ruta relativa completa incluyendo carpeta
                let relativePath = fileName;
                if (file.folder_id && folderIdToPath.has(file.folder_id)) {
                    const folderPath = folderIdToPath.get(file.folder_id);
                    relativePath = path.join(folderPath, fileName);
                }
                
                const localPath = path.join(this.syncFolder, relativePath);
                
                // Verificar si ya está sincronizado
                if (this.fileMap.has(localPath) && this.fileMap.get(localPath) === file.id) {
                    console.log(`⏭️  Already synced: ${relativePath}`);
                    continue;
                }
                
                // Crear carpetas locales si no existen
                const localDir = path.dirname(localPath);
                await fs.mkdir(localDir, { recursive: true });
                
                console.log(`⬇️  Syncing: ${relativePath}`);
                await this.safeDownloadFile(file, fileName, localPath);
                this.fileMap.set(localPath, file.id);
            }
            
            // Save fileMap after sync
            this._saveFileMap();
            
            this.store.set('lastSyncTime', new Date().toISOString());
            console.log('✓ Server sync completed\n');
        } catch (error) {
            console.error('Error checking server changes:', error.message);
        }
    }

    startWatcher() {
        this.watcher = chokidar.watch(this.syncFolder, {
            ignored: /(^|[\/\\])\../,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 2000,
                pollInterval: 100
            }
        });

        this.watcher
            .on('add', (filePath) => this.handleFileAdd(filePath))
            .on('change', (filePath) => this.handleFileChange(filePath))
            .on('unlink', (filePath) => this.handleFileDelete(filePath));

        console.log('File watcher started for:', this.syncFolder);
    }

    async handleFileAdd(filePath) {
        if (this.paused) return;
        if (this.downloadingPaths.has(filePath)) return; // A5 fix
        if (this._isExcluded(filePath)) return; // E1: selective sync
        
        const fileName = path.basename(filePath);
        console.log('📁 File added:', fileName);
        this.addToQueue({ type: 'add', path: filePath });
    }

    async handleFileChange(filePath) {
        if (this.paused) return;
        if (this.downloadingPaths.has(filePath)) return; // A5 fix
        if (this._isExcluded(filePath)) return; // E1: selective sync
        
        const fileName = path.basename(filePath);
        console.log('📝 File changed:', fileName);
        this.addToQueue({ type: 'change', path: filePath });
    }

    async handleFileDelete(filePath) {
        if (this.paused) return;
        if (this.downloadingPaths.has(filePath)) return; // A5 fix
        if (this._isExcluded(filePath)) return; // E1: selective sync
        
        const fileName = path.basename(filePath);
        console.log('🗑️  File deleted:', fileName);
        this.addToQueue({ type: 'delete', path: filePath });
    }

    addToQueue(item) {
        // A1 fix: Add timestamp and depth for ordered processing
        const relativePath = path.relative(this.syncFolder, item.path);
        item.timestamp = item.timestamp || Date.now();
        item.depth = relativePath.split(path.sep).length;
        
        // Deduplicate: remove existing queue entry for same path
        this.syncQueue = this.syncQueue.filter(q => q.path !== item.path);
        this.syncQueue.push(item);
        this._saveQueue(); // A2: persist queue for crash recovery
        
        console.log(`Queue: ${this.syncQueue.length} items pending`);
        this.processQueue();
    }

    _sortQueue() {
        // A1 fix: Sort queue for deterministic processing order
        // 1. Directories (lower depth) before files (higher depth) — ensures parent folders exist
        // 2. Within same depth, sort by timestamp (oldest first — FIFO)
        // 3. Deletes processed last (reverse depth order — deepest first)
        this.syncQueue.sort((a, b) => {
            // Deletes go after adds/changes
            if (a.type === 'delete' && b.type !== 'delete') return 1;
            if (a.type !== 'delete' && b.type === 'delete') return -1;
            
            // For deletes: deepest first (reverse depth)
            if (a.type === 'delete' && b.type === 'delete') {
                if (a.depth !== b.depth) return b.depth - a.depth;
                return a.timestamp - b.timestamp;
            }
            
            // For adds/changes: shallowest first, then by timestamp
            if (a.depth !== b.depth) return a.depth - b.depth;
            return a.timestamp - b.timestamp;
        });
    }

    async processQueue() {
        if (this.processing || this.syncQueue.length === 0) {
            return;
        }

        this.processing = true;
        this.emit('status-changed');

        while (this.syncQueue.length > 0) {
            // A1 fix: Sort before each batch to account for items added during processing
            this._sortQueue();

            // C4: Take a batch of items up to maxConcurrency, respecting depth ordering
            // Items at the same depth can run concurrently; deeper items wait
            const batch = [];
            let batchDepth = null;
            
            while (batch.length < this.maxConcurrency && this.syncQueue.length > 0) {
                const next = this.syncQueue[0];
                if (batchDepth === null) {
                    batchDepth = next.depth;
                }
                // Only batch items at the same depth to preserve parent-before-child ordering
                if (next.depth !== batchDepth) break;
                batch.push(this.syncQueue.shift());
            }

            // C4: Process batch concurrently
            const results = await Promise.allSettled(
                batch.map(item => this._processItem(item))
            );

            // C4: Handle retries for failed items
            for (let i = 0; i < results.length; i++) {
                if (results[i].status === 'rejected') {
                    const item = batch[i];
                    item._retries = (item._retries || 0) + 1;
                    if (item._retries < this.maxRetries) {
                        const backoffMs = Math.min(1000 * Math.pow(2, item._retries), 30000);
                        console.log(`⟳ Retry ${item._retries}/${this.maxRetries} for ${path.basename(item.path)} in ${backoffMs}ms`);
                        await new Promise(r => setTimeout(r, backoffMs));
                        this.syncQueue.push(item);
                    } else {
                        console.error(`✗ Gave up on ${path.basename(item.path)} after ${this.maxRetries} retries`);
                    }
                }
            }
            
            this._saveQueue(); // A2: update persisted queue after each batch
        }

        this.processing = false;
        this._saveFileMap();
        this._clearPersistedQueue(); // A2: queue fully processed, clear persisted copy
        this.emit('status-changed');
        console.log('\n✓ Sync queue completed\n');
    }

    async _processItem(item) {
        const fileName = path.basename(item.path);
        
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Processing: ${fileName}`);
        console.log(`Action: ${item.type.toUpperCase()}`);
        console.log(`Pending: ${this.syncQueue.length} items`);
        console.log('='.repeat(50));
        
        switch (item.type) {
            case 'add':
            case 'change':
                await this.uploadFile(item.path);
                console.log(`✓ ${fileName} uploaded successfully`);
                break;
            case 'delete':
                await this.deleteFile(item.path);
                console.log(`✓ ${fileName} deleted from server`);
                break;
        }
    }

    async uploadFile(filePath) {
        let transfer = null;
        const startTime = Date.now();
        
        try {
            const stats = await fs.stat(filePath);
            if (!stats.isFile()) return;

            const fileName = path.basename(filePath);
            
            // Register active transfer
            if (this.activityHistory) {
                transfer = this.activityHistory.addActiveTransfer({
                    type: 'upload',
                    filePath,
                    fileName,
                    size: stats.size,
                    folderId: this.folderId
                });
                this.activityHistory.startTransfer(transfer.id);
            }
            
            // A3 fix: Use streaming for files instead of loading entire file into memory
            const FormData = require('form-data');
            const form = new FormData();
            
            // Obtener la ruta relativa del archivo respecto a la carpeta de sincronización
            const relativePath = path.relative(this.syncFolder, filePath);
            const relativeDir = path.dirname(relativePath);
            
            // Obtener o crear la carpeta en el servidor si el archivo está en un subdirectorio
            let folderId = null;
            if (relativeDir && relativeDir !== '.') {
                console.log(`      📂 Archivo en subdirectorio: ${relativeDir}`);
                folderId = await this.getOrCreateServerFolder(relativeDir);
                console.log(`      📂 folder_id obtenido: ${folderId}`);
            }
            
            // A3 fix: Stream file instead of readFile to avoid OOM on large files
            // E2: Apply upload bandwidth throttling if configured
            let fileStream = fsSync.createReadStream(filePath);
            if (this.uploadBandwidthLimit && this.uploadBandwidthLimit > 0) {
                const throttle = new ThrottleTransform(this.uploadBandwidthLimit);
                fileStream = fileStream.pipe(throttle);
            }
            form.append('file', fileStream, { filename: fileName, knownLength: stats.size });
            form.append('workspace_id', this.workspaceId.toString());
            form.append('name', fileName);
            
            // Agregar folder_id si el archivo está en un subdirectorio
            if (folderId) {
                form.append('folder_id', folderId.toString());
                console.log(`      ✓ Subiendo con folder_id: ${folderId}`);
            } else {
                console.log(`      ✓ Subiendo a la raíz (sin folder_id)`);
            }

            const fileId = this.fileMap.get(filePath);
            
            // D3 improvement: Real upload progress via axios onUploadProgress
            const uploadConfig = {
                headers: form.getHeaders(),
                onUploadProgress: (progressEvent) => {
                    if (transfer && this.activityHistory && progressEvent.total) {
                        const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
                        this.activityHistory.updateTransferProgress(transfer.id, percent, progressEvent.loaded);
                    }
                }
            };
            
            if (fileId) {
                // Usar PUT para actualizar archivos existentes
                const response = await this.apiRequest('put', `/api/external/files/${fileId}`, form, uploadConfig);
            } else {
                // Usar POST para crear nuevos archivos
                const response = await this.apiRequest('post', '/api/external/files', form, uploadConfig);
                
                if (response.data.id) {
                    this.fileMap.set(filePath, response.data.id);
                }
            }
            
            // Complete transfer successfully
            if (transfer && this.activityHistory) {
                this.activityHistory.completeTransfer(transfer.id, true);
            }
        } catch (error) {
            // Mark transfer as failed
            if (transfer && this.activityHistory) {
                this.activityHistory.completeTransfer(transfer.id, false, error.message);
            }
            throw error;
        }
    }

    async deleteFile(filePath) {
        try {
            const fileId = this.fileMap.get(filePath);
            
            if (!fileId) {
                console.log('File not tracked, skipping delete');
                return;
            }

            await this.apiRequest('delete', `/api/external/files/${fileId}`);
            this.fileMap.delete(filePath);
        } catch (error) {
            throw error;
        }
    }

    async apiRequest(method, url, data = null, config = {}) {
        const fullUrl = `${this.serverUrl}${url}`;
        
        // Build headers - ensure Authorization is always present and not overwritten
        const headers = {
            ...config.headers,  // First spread config headers (like Content-Type from FormData)
            'Authorization': `Bearer ${this.authToken}`,  // Then set Authorization (overwrites if exists)
            'Accept': 'application/json',
        };
        
        // Build request config without spreading config.headers again
        const { headers: configHeaders, ...restConfig } = config;
        const requestConfig = {
            method,
            url: fullUrl,
            headers,
            ...restConfig
        };

        // Handle params for GET requests (passed as data.params)
        if (method.toLowerCase() === 'get' && data && data.params) {
            requestConfig.params = data.params;
        } else if (data) {
            requestConfig.data = data;
        }

        try {
            const response = await axios(requestConfig);
            return response;
        } catch (error) {
            console.error(`API Error: ${method.toUpperCase()} ${url} - ${error.response?.status || 'N/A'}: ${error.response?.data?.message || error.message}`);
            throw error;
        }
    }

    pause() {
        this.paused = true;
        console.log('Sync paused');
        this.emit('status-changed');
    }

    resume() {
        this.paused = false;
        console.log('Sync resumed');
        this.emit('status-changed');
    }

    /**
     * Manual sync - triggers immediate synchronization
     */
    async syncNow() {
        if (this.processing) {
            console.log('Sync already in progress');
            return;
        }
        
        console.log('🔄 Manual sync triggered...');
        this.emit('status-changed');
        
        try {
            // First, process any pending queue items
            await this.processQueue();
            
            // Then check for server changes
            await this.safeCheckServerChanges();
            
            console.log('✓ Manual sync completed');
        } catch (error) {
            console.error('Error during manual sync:', error.message);
        }
        
        this.emit('status-changed');
    }

    /**
     * Set bandwidth limits for uploads/downloads
     */
    setBandwidthLimits(uploadLimit, downloadLimit) {
        this.uploadBandwidthLimit = uploadLimit;
        this.downloadBandwidthLimit = downloadLimit;
        console.log(`Bandwidth limits set: Upload=${uploadLimit}, Download=${downloadLimit}`);
    }

    stop() {
        if (this.watcher) {
            this.watcher.close();
        }
        
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
        
        this.syncing = false;
        console.log('Sync engine stopped');
        this.emit('status-changed');
    }

    getStatus() {
        return {
            syncing: this.syncing,
            paused: this.paused,
            queueLength: this.syncQueue.length,
            processing: this.processing,
            // For UI: show as 'syncing' only when actively processing
            isActive: this.syncing && !this.paused && this.processing
        };
    }

    clearFileMap() {
        this.fileMap.clear();
        this.store.delete(this._getFileMapKey());
        console.log('FileMap cleared for:', this.syncFolder);
    }
}

module.exports = SyncEngine;

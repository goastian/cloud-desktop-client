const chokidar = require('chokidar');
const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class SyncEngine extends EventEmitter {
    constructor(syncFolder, authToken, serverUrl, store) {
        super();
        this.syncFolder = syncFolder;
        this.authToken = authToken;
        this.serverUrl = serverUrl;
        this.store = store;
        this.watcher = null;
        this.syncing = false;
        this.paused = false;
        this.syncQueue = [];
        this.processing = false;
        this.fileMap = new Map();        // Mapa: ruta local archivo → ID archivo servidor
        this.folderMap = new Map();      // Mapa: ruta relativa carpeta → ID carpeta servidor
        this.workspaceId = null;
        this.folderId = null; // Set externally for multi-folder support
        
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
        
        try {
            // PASO 1: Escanear archivos locales
            console.log('\n📂 PASO 1: Escaneando archivos locales...');
            const localFiles = await this.scanLocalFiles();
            console.log(`   Encontrados ${localFiles.length} archivos locales`);
            
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
                for (const localFile of syncActions.upload) {
                    try {
                        console.log(`      Subiendo: ${localFile.name}`);
                        await this.uploadFile(localFile.path);
                        console.log(`      ✓ ${localFile.name} subido`);
                    } catch (error) {
                        console.error(`      ✗ Error subiendo ${localFile.name}:`, error.message);
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
                    } catch (error) {
                        console.error(`      ✗ Error descargando:`, error.message);
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
            
            console.log('\n' + '='.repeat(60));
            console.log('✓ BOOTSTRAP SYNC COMPLETADO');
            console.log('='.repeat(60) + '\n');
            
        } catch (error) {
            console.error('Error en sincronización inicial:', error.message);
            throw error;
        }
    }
    
    /**
     * Escanea recursivamente la carpeta local y retorna información de todos los archivos
     */
    async scanLocalFiles(dir = null) {
        const scanDir = dir || this.syncFolder;
        const files = [];
        
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
     * Calcula el hash SHA256 de un archivo
     */
    async calculateFileHash(filePath) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = fsSync.createReadStream(filePath);
            
            stream.on('data', data => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', error => reject(error));
        });
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
        
        // Crear mapa de archivos del servidor por ruta relativa completa
        const serverFileMap = new Map();
        for (const serverFile of serverFiles) {
            const fileName = this.getServerFileName(serverFile);
            if (fileName && fileName !== 'unknown') {
                // Construir ruta relativa completa incluyendo carpeta
                let relativePath = fileName;
                if (serverFile.folder_id && folderIdToPath.has(serverFile.folder_id)) {
                    const folderPath = folderIdToPath.get(serverFile.folder_id);
                    relativePath = path.join(folderPath, fileName);
                }
                serverFileMap.set(relativePath.toLowerCase(), { ...serverFile, serverRelativePath: relativePath });
            }
        }
        
        // Crear mapa de archivos locales por ruta relativa
        const localFileMap = new Map();
        for (const localFile of localFiles) {
            localFileMap.set(localFile.relativePath.toLowerCase(), localFile);
        }
        
        // Comparar archivos locales con servidor
        for (const localFile of localFiles) {
            const serverFile = serverFileMap.get(localFile.relativePath.toLowerCase());
            
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
        
        return parts.join(path.sep);
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
        
        // Verificar si ya tenemos esta carpeta mapeada
        if (this.folderMap.has(relativePath)) {
            return this.folderMap.get(relativePath);
        }
        
        // Dividir la ruta en partes para crear jerarquía
        const parts = relativePath.split(path.sep).filter(p => p && p !== '.');
        let parentId = null;
        let currentPath = '';
        
        for (const folderName of parts) {
            currentPath = currentPath ? path.join(currentPath, folderName) : folderName;
            
            // Verificar si esta parte ya existe en el mapa
            if (this.folderMap.has(currentPath)) {
                parentId = this.folderMap.get(currentPath);
                continue;
            }
            
            // Buscar si la carpeta ya existe en el servidor
            try {
                const response = await this.apiRequest('get', '/api/external/folders', {
                    params: {
                        workspace_id: this.workspaceId,
                        parent_id: parentId || 'null'
                    }
                });
                
                const folders = response.data || [];
                const existingFolder = folders.find(f => 
                    f.name.toLowerCase() === folderName.toLowerCase()
                );
                
                if (existingFolder) {
                    parentId = existingFolder.id;
                    this.folderMap.set(currentPath, existingFolder.id);
                } else {
                    // Crear la carpeta
                    const createResponse = await this.apiRequest('post', '/api/external/folders', {
                        name: folderName,
                        workspace_id: this.workspaceId,
                        parent_id: parentId
                    });
                    
                    const newFolder = createResponse.data.folder || createResponse.data;
                    parentId = newFolder.id;
                    this.folderMap.set(currentPath, newFolder.id);
                    console.log(`      📁 Carpeta creada: ${currentPath} (ID: ${newFolder.id})`);
                }
            } catch (error) {
                console.error(`      ✗ Error creando carpeta ${currentPath}:`, error.message);
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
        
        if (serverModified > localModified) {
            // Servidor es más reciente -> descargar
            console.log(`         Resolución: Descargar versión del servidor (más reciente)`);
            const fileName = this.getServerFileName(server);
            await this.safeDownloadFile(server, fileName, local.path);
            this.fileMap.set(local.path, server.id);
        } else {
            // Local es más reciente -> subir
            console.log(`         Resolución: Subir versión local (más reciente)`);
            await this.uploadFile(local.path);
        }
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
            // IMPORTANTE: Para GET requests, pasar null como data y las opciones como config
            const response = await this.apiRequest('get', `/api/external/files/${file.id}/download`, null, {
                responseType: 'arraybuffer'
            });
            
            if (!response.data || response.data.byteLength === 0) {
                console.error('Empty file received:', fileName);
                return;
            }
            
            const buffer = Buffer.from(response.data);
            
            // IMPORTANTE: Pausar watcher temporalmente para evitar que detecte
            // este archivo como "nuevo" y lo intente subir de nuevo (loop infinito)
            const wasWatching = this.watcher !== null;
            if (wasWatching) {
                await this.watcher.unwatch(localPath);
            }
            
            await fs.writeFile(localPath, buffer);
            
            // Esperar un momento antes de reactivar el watch
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            if (wasWatching) {
                this.watcher.add(localPath);
            }
            
            console.log(`✓ Downloaded: ${fileName} (${buffer.length} bytes)`);
        } catch (error) {
            console.error(`✗ Download failed: ${fileName}:`, error.message);
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
        
        const fileName = path.basename(filePath);
        console.log('📁 File added:', fileName);
        this.addToQueue({ type: 'add', path: filePath });
    }

    async handleFileChange(filePath) {
        if (this.paused) return;
        
        const fileName = path.basename(filePath);
        console.log('📝 File changed:', fileName);
        this.addToQueue({ type: 'change', path: filePath });
    }

    async handleFileDelete(filePath) {
        if (this.paused) return;
        
        const fileName = path.basename(filePath);
        console.log('🗑️  File deleted:', fileName);
        this.addToQueue({ type: 'delete', path: filePath });
    }

    addToQueue(item) {
        this.syncQueue.push(item);
        console.log(`Queue: ${this.syncQueue.length} items pending`);
        this.processQueue();
    }

    async processQueue() {
        if (this.processing || this.syncQueue.length === 0) {
            return;
        }

        this.processing = true;
        this.emit('status-changed');

        while (this.syncQueue.length > 0) {
            const item = this.syncQueue.shift();
            const fileName = path.basename(item.path);
            
            console.log(`\n${'='.repeat(50)}`);
            console.log(`Processing: ${fileName}`);
            console.log(`Action: ${item.type.toUpperCase()}`);
            console.log(`Pending: ${this.syncQueue.length} items`);
            console.log('='.repeat(50));
            
            try {
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
            } catch (error) {
                console.error(`✗ Error with ${fileName}:`, error.message);
            }
        }

        this.processing = false;
        this._saveFileMap();
        this.emit('status-changed');
        console.log('\n✓ Sync queue completed\n');
    }

    async uploadFile(filePath) {
        try {
            const stats = await fs.stat(filePath);
            if (!stats.isFile()) return;

            const fileName = path.basename(filePath);
            const fileBuffer = await fs.readFile(filePath);
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
            
            form.append('file', fileBuffer, fileName);
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
            
            if (fileId) {
                // Usar PUT para actualizar archivos existentes
                const response = await this.apiRequest('put', `/api/external/files/${fileId}`, form, {
                    headers: form.getHeaders()
                });
            } else {
                // Usar POST para crear nuevos archivos
                const response = await this.apiRequest('post', '/api/external/files', form, {
                    headers: form.getHeaders()
                });
                
                if (response.data.id) {
                    this.fileMap.set(filePath, response.data.id);
                }
            }
        } catch (error) {
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

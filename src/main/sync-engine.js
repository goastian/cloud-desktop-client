const chokidar = require('chokidar');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
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
        this.fileMap = new Map();
        this.workspaceId = null;
        this.folderId = null; // Set externally for multi-folder support
        
        // Load persisted fileMap for this folder
        this._loadFileMap();
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
            const response = await this.apiRequest('get', '/api/workspaces');
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

    async safeInitialSync() {
        console.log('🔽 Starting safe initial sync...');
        console.log(`   Server URL: ${this.serverUrl}`);
        console.log(`   Workspace ID: ${this.workspaceId}`);
        console.log(`   Sync Folder: ${this.syncFolder}`);
        console.log(`   Auth Token: ${this.authToken ? this.authToken.substring(0, 20) + '...' : 'NOT SET'}`);
        
        try {
            // Use the files endpoint - this returns paginated results for root folder
            // Note: In production, this only returns files in the root folder (folder_id = null)
            const response = await this.apiRequest('get', '/api/files', {
                params: { 
                    workspace_id: this.workspaceId,
                    per_page: 100  // Get more files per page
                }
            });
            
            console.log('API Response status:', response.status);
            
            // Handle both paginated and non-paginated responses
            let serverFiles = [];
            if (response.data && response.data.data) {
                serverFiles = response.data.data;
            } else if (Array.isArray(response.data)) {
                serverFiles = response.data;
            }
            
            if (!Array.isArray(serverFiles) || serverFiles.length === 0) {
                console.log('No files to sync from server');
                return;
            }
            
            console.log(`Found ${serverFiles.length} files on server`);
            
            for (const file of serverFiles) {
                // Obtener nombre del archivo - SIEMPRE usar original_name primero
                // El campo 'path' contiene el UUID, NO el nombre original
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
                
                // Validación de seguridad
                if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
                    console.warn(`⚠️  Skipping unsafe file: ${fileName || 'unknown'}`);
                    continue;
                }
                
                const localPath = path.join(this.syncFolder, fileName);
                
                // Verificar si ya está descargado y es el mismo archivo
                if (this.fileMap.has(localPath) && this.fileMap.get(localPath) === file.id) {
                    console.log(`⏭️  Already synced: ${fileName}`);
                    continue;
                }
                
                try {
                    await fs.access(localPath);
                    // File exists, check if needs update
                    const stats = await fs.stat(localPath);
                    const serverModified = new Date(file.updated_at);
                    
                    if (serverModified > stats.mtime) {
                        console.log(`⬇️  Updating: ${fileName}`);
                        await this.safeDownloadFile(file, fileName, localPath);
                    } else {
                        console.log(`✓ Up to date: ${fileName}`);
                        this.fileMap.set(localPath, file.id);
                    }
                } catch {
                    // File doesn't exist, download it
                    console.log(`⬇️  Downloading: ${fileName}`);
                    await this.safeDownloadFile(file, fileName, localPath);
                }
                
                this.fileMap.set(localPath, file.id);
            }
            
            // Save fileMap after initial sync
            this._saveFileMap();
            
            console.log('✓ Initial sync completed');
        } catch (error) {
            console.error('Error in initial sync:', error.message);
            throw error;
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
            const response = await this.apiRequest('get', `/api/files/${file.id}/download`, null, {
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
            
            // Use the files endpoint
            const response = await this.apiRequest('get', '/api/files', {
                params: { 
                    workspace_id: this.workspaceId,
                    per_page: 100
                }
            });
            
            // Handle both paginated and non-paginated responses
            let serverFiles = [];
            if (response.data && response.data.data) {
                serverFiles = response.data.data;
            } else if (Array.isArray(response.data)) {
                serverFiles = response.data;
            }
            
            if (!Array.isArray(serverFiles) || serverFiles.length === 0) {
                console.log('No new changes on server');
                return;
            }
            
            console.log(`Found ${serverFiles.length} new/updated files`);
            
            for (const file of serverFiles) {
                // Obtener nombre del archivo - SIEMPRE usar original_name primero
                let fileName = file.original_name || file.name;
                
                // Si no tiene extensión, agregarla del mime_type
                if (fileName && !path.extname(fileName) && file.mime_type) {
                    const ext = this.getExtensionFromMimeType(file.mime_type);
                    if (ext) {
                        fileName = `${fileName}${ext}`;
                    }
                }
                
                if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
                    console.warn(`⚠️  Skipping unsafe file: ${fileName || 'unknown'}`);
                    continue;
                }
                
                const localPath = path.join(this.syncFolder, fileName);
                
                // Verificar si ya está sincronizado
                if (this.fileMap.has(localPath) && this.fileMap.get(localPath) === file.id) {
                    console.log(`⏭️  Already synced: ${fileName}`);
                    continue;
                }
                
                console.log(`⬇️  Syncing: ${fileName}`);
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
            
            form.append('file', fileBuffer, fileName);
            form.append('workspace_id', this.workspaceId);
            form.append('name', fileName);

            const fileId = this.fileMap.get(filePath);
            
            if (fileId) {
                const response = await this.apiRequest('post', `/api/files/${fileId}`, form, {
                    headers: form.getHeaders()
                });
            } else {
                const response = await this.apiRequest('post', '/api/files', form, {
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

            await this.apiRequest('delete', `/api/files/${fileId}`);
            this.fileMap.delete(filePath);
        } catch (error) {
            throw error;
        }
    }

    async apiRequest(method, url, data = null, config = {}) {
        const fullUrl = `${this.serverUrl}${url}`;
        
        const requestConfig = {
            method,
            url: fullUrl,
            headers: {
                'Authorization': `Bearer ${this.authToken}`,
                'Accept': 'application/json',
                ...config.headers
            },
            ...config
        };

        // Handle params for GET requests (passed as data.params)
        if (method.toLowerCase() === 'get' && data && data.params) {
            requestConfig.params = data.params;
        } else if (data) {
            requestConfig.data = data;
        }

        console.log(`API Request: ${method.toUpperCase()} ${fullUrl}`);
        console.log(`  Authorization: Bearer ${this.authToken ? this.authToken.substring(0, 30) + '...' : 'NOT SET'}`);
        
        try {
            const response = await axios(requestConfig);
            return response;
        } catch (error) {
            console.error(`API Request failed: ${method.toUpperCase()} ${url}`);
            console.error(`  Status: ${error.response?.status || 'N/A'}`);
            console.error(`  Message: ${error.response?.data?.message || error.message}`);
            console.error(`  Full URL: ${fullUrl}`);
            console.error(`  Token present: ${!!this.authToken}`);
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

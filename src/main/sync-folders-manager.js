const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');

class SyncFoldersManager extends EventEmitter {
    constructor(store) {
        super();
        this.store = store;
    }

    // Get all configured sync folders
    getSyncFolders() {
        return this.store.get('syncFolders', []);
    }

    // Add a new sync folder
    addSyncFolder(folderPath, options = {}) {
        const folders = this.getSyncFolders();
        
        // Check if folder already exists
        if (folders.some(f => f.path === folderPath)) {
            throw new Error('This folder is already configured for sync');
        }

        // Check if folder is a subfolder of an existing sync folder
        for (const existing of folders) {
            if (folderPath.startsWith(existing.path + path.sep)) {
                throw new Error(`This folder is inside an already synced folder: ${existing.name}`);
            }
            if (existing.path.startsWith(folderPath + path.sep)) {
                throw new Error(`An existing sync folder is inside this folder: ${existing.name}`);
            }
        }

        const newFolder = {
            id: Date.now().toString(),
            path: folderPath,
            name: options.name || path.basename(folderPath),
            enabled: true,
            syncMode: options.syncMode || 'two-way', // two-way, upload-only, download-only
            remotePath: options.remotePath || `/${path.basename(folderPath)}`,
            lastSync: null,
            fileCount: 0,
            totalSize: 0,
            status: 'pending', // pending, syncing, synced, error
            createdAt: new Date().toISOString()
        };

        folders.push(newFolder);
        this.store.set('syncFolders', folders);
        
        this.emit('folder-added', newFolder);
        return newFolder;
    }

    // Remove a sync folder
    removeSyncFolder(folderId) {
        const folders = this.getSyncFolders();
        const index = folders.findIndex(f => f.id === folderId);
        
        if (index === -1) {
            throw new Error('Folder not found');
        }

        const removed = folders.splice(index, 1)[0];
        this.store.set('syncFolders', folders);
        
        this.emit('folder-removed', removed);
        return removed;
    }

    // Update sync folder settings
    updateSyncFolder(folderId, updates) {
        const folders = this.getSyncFolders();
        const index = folders.findIndex(f => f.id === folderId);
        
        if (index === -1) {
            throw new Error('Folder not found');
        }

        folders[index] = { ...folders[index], ...updates };
        this.store.set('syncFolders', folders);
        
        this.emit('folder-updated', folders[index]);
        return folders[index];
    }

    // Toggle folder enabled state
    toggleSyncFolder(folderId) {
        const folders = this.getSyncFolders();
        const folder = folders.find(f => f.id === folderId);
        
        if (!folder) {
            throw new Error('Folder not found');
        }

        return this.updateSyncFolder(folderId, { enabled: !folder.enabled });
    }

    // Update folder status
    updateFolderStatus(folderId, status, additionalData = {}) {
        return this.updateSyncFolder(folderId, { 
            status, 
            ...additionalData,
            lastSync: status === 'synced' ? new Date().toISOString() : undefined
        });
    }

    // Get folder by ID
    getFolderById(folderId) {
        const folders = this.getSyncFolders();
        return folders.find(f => f.id === folderId);
    }

    // Get enabled folders only
    getEnabledFolders() {
        return this.getSyncFolders().filter(f => f.enabled);
    }

    // Get folder statistics
    async getFolderStats(folderPath) {
        try {
            let totalSize = 0;
            let fileCount = 0;

            const scanDir = async (dir) => {
                try {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    
                    for (const entry of entries) {
                        // Skip hidden files and common excludes
                        if (entry.name.startsWith('.')) continue;
                        if (['node_modules', '__pycache__', '.git'].includes(entry.name)) continue;

                        const fullPath = path.join(dir, entry.name);
                        
                        if (entry.isDirectory()) {
                            await scanDir(fullPath);
                        } else if (entry.isFile()) {
                            const stats = await fs.stat(fullPath);
                            totalSize += stats.size;
                            fileCount++;
                        }
                    }
                } catch (error) {
                    // Skip directories we can't read
                }
            };

            await scanDir(folderPath);

            return { totalSize, fileCount };
        } catch (error) {
            console.error('Error getting folder stats:', error);
            return { totalSize: 0, fileCount: 0 };
        }
    }

    // List contents of a folder (for file browser)
    async listFolderContents(folderPath) {
        try {
            const entries = await fs.readdir(folderPath, { withFileTypes: true });
            const contents = [];

            for (const entry of entries) {
                // Skip hidden files
                if (entry.name.startsWith('.')) continue;

                const fullPath = path.join(folderPath, entry.name);
                
                try {
                    const stats = await fs.stat(fullPath);
                    
                    contents.push({
                        name: entry.name,
                        path: fullPath,
                        isDirectory: entry.isDirectory(),
                        size: entry.isFile() ? stats.size : 0,
                        modified: stats.mtime,
                        created: stats.birthtime
                    });
                } catch (error) {
                    // Skip files we can't stat
                }
            }

            // Sort: directories first, then by name
            contents.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.name.localeCompare(b.name);
            });

            return contents;
        } catch (error) {
            console.error('Error listing folder:', error);
            throw error;
        }
    }

    // Get common user folders (cross-platform)
    getCommonFolders() {
        const os = require('os');
        const homeDir = os.homedir();
        const platform = os.platform();

        const folders = [
            { name: 'Documents', path: path.join(homeDir, 'Documents') },
            { name: 'Pictures', path: path.join(homeDir, 'Pictures') },
            { name: 'Downloads', path: path.join(homeDir, 'Downloads') },
            { name: 'Desktop', path: path.join(homeDir, 'Desktop') },
            { name: 'Music', path: path.join(homeDir, 'Music') },
            { name: 'Videos', path: path.join(homeDir, 'Videos') }
        ];

        // Add platform-specific folders
        if (platform === 'darwin') {
            folders.push({ name: 'Movies', path: path.join(homeDir, 'Movies') });
        }

        // Filter to only existing folders
        return folders.filter(f => {
            try {
                require('fs').accessSync(f.path);
                return true;
            } catch {
                return false;
            }
        });
    }

    // Format bytes to human readable
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

module.exports = SyncFoldersManager;

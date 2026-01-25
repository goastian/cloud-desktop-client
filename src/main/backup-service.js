const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const axios = require('axios');

class BackupService extends EventEmitter {
    constructor(store, authToken, serverUrl) {
        super();
        this.store = store;
        this.authToken = authToken;
        this.serverUrl = serverUrl;
        this.backupQueue = [];
        this.processing = false;
        this.paused = false;
    }

    // Get all configured backup folders
    getBackupFolders() {
        return this.store.get('backupFolders', []);
    }

    // Add a new backup folder
    addBackupFolder(folderPath, options = {}) {
        const folders = this.getBackupFolders();
        
        // Check if folder already exists
        if (folders.some(f => f.path === folderPath)) {
            throw new Error('This folder is already configured for backup');
        }

        const newFolder = {
            id: Date.now().toString(),
            path: folderPath,
            name: options.name || path.basename(folderPath),
            enabled: true,
            lastBackup: null,
            fileCount: 0,
            totalSize: 0,
            includeSubfolders: options.includeSubfolders !== false,
            excludePatterns: options.excludePatterns || [
                'node_modules',
                '.git',
                '.DS_Store',
                'Thumbs.db',
                '*.tmp',
                '*.temp'
            ],
            schedule: options.schedule || 'realtime', // realtime, hourly, daily, weekly
            createdAt: new Date().toISOString()
        };

        folders.push(newFolder);
        this.store.set('backupFolders', folders);
        
        this.emit('folder-added', newFolder);
        return newFolder;
    }

    // Remove a backup folder
    removeBackupFolder(folderId) {
        const folders = this.getBackupFolders();
        const index = folders.findIndex(f => f.id === folderId);
        
        if (index === -1) {
            throw new Error('Folder not found');
        }

        const removed = folders.splice(index, 1)[0];
        this.store.set('backupFolders', folders);
        
        this.emit('folder-removed', removed);
        return removed;
    }

    // Update backup folder settings
    updateBackupFolder(folderId, updates) {
        const folders = this.getBackupFolders();
        const index = folders.findIndex(f => f.id === folderId);
        
        if (index === -1) {
            throw new Error('Folder not found');
        }

        folders[index] = { ...folders[index], ...updates };
        this.store.set('backupFolders', folders);
        
        this.emit('folder-updated', folders[index]);
        return folders[index];
    }

    // Toggle folder enabled state
    toggleBackupFolder(folderId) {
        const folders = this.getBackupFolders();
        const folder = folders.find(f => f.id === folderId);
        
        if (!folder) {
            throw new Error('Folder not found');
        }

        return this.updateBackupFolder(folderId, { enabled: !folder.enabled });
    }

    // Get folder statistics
    async getFolderStats(folderPath) {
        try {
            let totalSize = 0;
            let fileCount = 0;

            const scanDir = async (dir) => {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    
                    if (entry.isDirectory()) {
                        await scanDir(fullPath);
                    } else if (entry.isFile()) {
                        const stats = await fs.stat(fullPath);
                        totalSize += stats.size;
                        fileCount++;
                    }
                }
            };

            await scanDir(folderPath);

            return { totalSize, fileCount };
        } catch (error) {
            console.error('Error getting folder stats:', error);
            return { totalSize: 0, fileCount: 0 };
        }
    }

    // Scan folder and get file list
    async scanFolder(folderPath, excludePatterns = []) {
        const files = [];

        const shouldExclude = (name) => {
            return excludePatterns.some(pattern => {
                if (pattern.includes('*')) {
                    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
                    return regex.test(name);
                }
                return name === pattern;
            });
        };

        const scanDir = async (dir, relativePath = '') => {
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                
                for (const entry of entries) {
                    if (shouldExclude(entry.name)) continue;

                    const fullPath = path.join(dir, entry.name);
                    const relPath = path.join(relativePath, entry.name);
                    
                    if (entry.isDirectory()) {
                        await scanDir(fullPath, relPath);
                    } else if (entry.isFile()) {
                        const stats = await fs.stat(fullPath);
                        files.push({
                            path: fullPath,
                            relativePath: relPath,
                            name: entry.name,
                            size: stats.size,
                            modified: stats.mtime
                        });
                    }
                }
            } catch (error) {
                console.error(`Error scanning ${dir}:`, error.message);
            }
        };

        await scanDir(folderPath);
        return files;
    }

    // Start backup for a specific folder
    async backupFolder(folderId) {
        const folders = this.getBackupFolders();
        const folder = folders.find(f => f.id === folderId);
        
        if (!folder) {
            throw new Error('Folder not found');
        }

        if (!folder.enabled) {
            throw new Error('Folder backup is disabled');
        }

        console.log(`Starting backup for: ${folder.name}`);
        this.emit('backup-started', folder);

        try {
            const files = await this.scanFolder(folder.path, folder.excludePatterns);
            let uploaded = 0;
            let failed = 0;

            for (const file of files) {
                try {
                    await this.uploadBackupFile(file, folder);
                    uploaded++;
                    this.emit('file-backed-up', { file, folder, progress: uploaded / files.length });
                } catch (error) {
                    console.error(`Failed to backup ${file.name}:`, error.message);
                    failed++;
                }
            }

            // Update folder stats
            const stats = await this.getFolderStats(folder.path);
            this.updateBackupFolder(folderId, {
                lastBackup: new Date().toISOString(),
                fileCount: stats.fileCount,
                totalSize: stats.totalSize
            });

            this.emit('backup-completed', { folder, uploaded, failed });
            return { success: true, uploaded, failed };
        } catch (error) {
            this.emit('backup-failed', { folder, error });
            throw error;
        }
    }

    // Upload a single file as backup
    async uploadBackupFile(file, folder) {
        const FormData = require('form-data');
        const form = new FormData();
        
        const fileBuffer = await fs.readFile(file.path);
        const deviceId = this.store.get('deviceId');
        const deviceName = this.store.get('deviceName');
        
        form.append('file', fileBuffer, file.name);
        form.append('backup_folder_id', folder.id);
        form.append('backup_folder_name', folder.name);
        form.append('relative_path', file.relativePath);
        form.append('device_id', deviceId);
        form.append('device_name', deviceName);
        form.append('is_backup', 'true');

        const response = await axios.post(
            `${this.serverUrl}/api/external/backup/upload`,
            form,
            {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    ...form.getHeaders()
                }
            }
        );

        return response.data;
    }

    // Get backup history
    getBackupHistory() {
        return this.store.get('backupHistory', []);
    }

    // Add to backup history
    addToHistory(entry) {
        const history = this.getBackupHistory();
        history.unshift({
            ...entry,
            timestamp: new Date().toISOString()
        });
        
        // Keep only last 100 entries
        if (history.length > 100) {
            history.pop();
        }
        
        this.store.set('backupHistory', history);
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

module.exports = BackupService;

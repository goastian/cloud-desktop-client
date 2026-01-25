/**
 * Offline Cache Service - Caché local para acceso offline
 * Permite acceder a archivos sincronizados sin conexión a internet
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

class OfflineCache extends EventEmitter {
    constructor(store, cacheDir) {
        super();
        this.store = store;
        this.cacheDir = cacheDir || path.join(require('os').homedir(), '.astian-cloud', 'cache');
        this.metadataFile = path.join(this.cacheDir, 'cache-metadata.json');
        this.initialized = false;
    }

    /**
     * Initialize cache directory
     */
    async initialize() {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
            await this.loadMetadata();
            this.initialized = true;
            console.log('✓ Offline cache initialized:', this.cacheDir);
        } catch (error) {
            console.error('Error initializing offline cache:', error);
            throw error;
        }
    }

    /**
     * Load cache metadata
     */
    async loadMetadata() {
        try {
            const data = await fs.readFile(this.metadataFile, 'utf8');
            this.metadata = JSON.parse(data);
        } catch {
            this.metadata = {
                files: {},
                totalSize: 0,
                lastCleanup: null
            };
        }
    }

    /**
     * Save cache metadata
     */
    async saveMetadata() {
        try {
            await fs.writeFile(this.metadataFile, JSON.stringify(this.metadata, null, 2));
        } catch (error) {
            console.error('Error saving cache metadata:', error);
        }
    }

    /**
     * Get cache settings from settings manager
     */
    getCacheSettings() {
        const settings = this.store.get('settings', {});
        return {
            enabled: settings.enableOfflineCache !== false,
            maxSize: settings.maxCacheSize || 1024 * 1024 * 1024, // 1 GB default
            expirationDays: settings.cacheExpirationDays || 30
        };
    }

    /**
     * Check if cache is enabled
     */
    isEnabled() {
        return this.getCacheSettings().enabled;
    }

    /**
     * Generate cache key for a file
     */
    generateCacheKey(fileId, version = 1) {
        return crypto.createHash('md5').update(`${fileId}-v${version}`).digest('hex');
    }

    /**
     * Get cached file path
     */
    getCachePath(cacheKey) {
        // Use subdirectories to avoid too many files in one folder
        const subDir = cacheKey.substring(0, 2);
        return path.join(this.cacheDir, subDir, cacheKey);
    }

    /**
     * Check if file is cached
     */
    async isCached(fileId, version = 1) {
        const cacheKey = this.generateCacheKey(fileId, version);
        const entry = this.metadata.files[cacheKey];
        
        if (!entry) return false;
        
        // Check if file still exists
        try {
            await fs.access(this.getCachePath(cacheKey));
            return true;
        } catch {
            // File doesn't exist, remove from metadata
            delete this.metadata.files[cacheKey];
            await this.saveMetadata();
            return false;
        }
    }

    /**
     * Get cached file
     */
    async getCachedFile(fileId, version = 1) {
        const cacheKey = this.generateCacheKey(fileId, version);
        const entry = this.metadata.files[cacheKey];
        
        if (!entry) return null;
        
        const cachePath = this.getCachePath(cacheKey);
        
        try {
            const data = await fs.readFile(cachePath);
            
            // Update last accessed time
            entry.lastAccessed = new Date().toISOString();
            entry.accessCount = (entry.accessCount || 0) + 1;
            await this.saveMetadata();
            
            return {
                data,
                metadata: entry
            };
        } catch (error) {
            console.error('Error reading cached file:', error);
            return null;
        }
    }

    /**
     * Cache a file
     */
    async cacheFile(fileId, version, data, metadata = {}) {
        if (!this.isEnabled()) return null;
        
        const settings = this.getCacheSettings();
        const fileSize = data.length;
        
        // Check if we need to make room
        if (this.metadata.totalSize + fileSize > settings.maxSize) {
            await this.makeRoom(fileSize);
        }
        
        const cacheKey = this.generateCacheKey(fileId, version);
        const cachePath = this.getCachePath(cacheKey);
        
        try {
            // Ensure directory exists
            await fs.mkdir(path.dirname(cachePath), { recursive: true });
            
            // Write file
            await fs.writeFile(cachePath, data);
            
            // Update metadata
            this.metadata.files[cacheKey] = {
                fileId,
                version,
                size: fileSize,
                cachedAt: new Date().toISOString(),
                lastAccessed: new Date().toISOString(),
                accessCount: 0,
                originalName: metadata.originalName || '',
                mimeType: metadata.mimeType || '',
                hash: metadata.hash || ''
            };
            
            this.metadata.totalSize += fileSize;
            await this.saveMetadata();
            
            this.emit('file-cached', { fileId, version, size: fileSize });
            
            return cacheKey;
        } catch (error) {
            console.error('Error caching file:', error);
            return null;
        }
    }

    /**
     * Remove file from cache
     */
    async removeFromCache(fileId, version = 1) {
        const cacheKey = this.generateCacheKey(fileId, version);
        const entry = this.metadata.files[cacheKey];
        
        if (!entry) return false;
        
        try {
            const cachePath = this.getCachePath(cacheKey);
            await fs.unlink(cachePath);
            
            this.metadata.totalSize -= entry.size;
            delete this.metadata.files[cacheKey];
            await this.saveMetadata();
            
            this.emit('file-removed', { fileId, version });
            
            return true;
        } catch (error) {
            console.error('Error removing cached file:', error);
            return false;
        }
    }

    /**
     * Make room in cache by removing old/unused files
     */
    async makeRoom(neededSpace) {
        const settings = this.getCacheSettings();
        const targetSize = settings.maxSize - neededSpace;
        
        // Get all cached files sorted by last access (oldest first)
        const entries = Object.entries(this.metadata.files)
            .map(([key, entry]) => ({ key, ...entry }))
            .sort((a, b) => new Date(a.lastAccessed) - new Date(b.lastAccessed));
        
        let currentSize = this.metadata.totalSize;
        const toRemove = [];
        
        for (const entry of entries) {
            if (currentSize <= targetSize) break;
            
            toRemove.push(entry);
            currentSize -= entry.size;
        }
        
        // Remove files
        for (const entry of toRemove) {
            try {
                const cachePath = this.getCachePath(entry.key);
                await fs.unlink(cachePath);
                
                this.metadata.totalSize -= entry.size;
                delete this.metadata.files[entry.key];
            } catch (error) {
                console.error('Error removing cached file during cleanup:', error);
            }
        }
        
        await this.saveMetadata();
        
        console.log(`Cache cleanup: removed ${toRemove.length} files`);
        this.emit('cleanup-complete', { removed: toRemove.length });
    }

    /**
     * Clean expired entries
     */
    async cleanExpired() {
        const settings = this.getCacheSettings();
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() - settings.expirationDays);
        
        let removed = 0;
        
        for (const [key, entry] of Object.entries(this.metadata.files)) {
            const lastAccessed = new Date(entry.lastAccessed);
            
            if (lastAccessed < expirationDate) {
                try {
                    const cachePath = this.getCachePath(key);
                    await fs.unlink(cachePath);
                    
                    this.metadata.totalSize -= entry.size;
                    delete this.metadata.files[key];
                    removed++;
                } catch (error) {
                    // File might already be deleted
                }
            }
        }
        
        this.metadata.lastCleanup = new Date().toISOString();
        await this.saveMetadata();
        
        console.log(`Expired cache cleanup: removed ${removed} files`);
        return removed;
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const settings = this.getCacheSettings();
        const fileCount = Object.keys(this.metadata.files).length;
        
        return {
            enabled: settings.enabled,
            totalSize: this.metadata.totalSize,
            maxSize: settings.maxSize,
            usagePercent: Math.round((this.metadata.totalSize / settings.maxSize) * 100),
            fileCount,
            lastCleanup: this.metadata.lastCleanup,
            expirationDays: settings.expirationDays
        };
    }

    /**
     * Get list of cached files
     */
    getCachedFiles() {
        return Object.entries(this.metadata.files).map(([key, entry]) => ({
            cacheKey: key,
            ...entry
        }));
    }

    /**
     * Clear entire cache
     */
    async clearCache() {
        const files = Object.keys(this.metadata.files);
        
        for (const key of files) {
            try {
                const cachePath = this.getCachePath(key);
                await fs.unlink(cachePath);
            } catch (error) {
                // Ignore errors
            }
        }
        
        this.metadata = {
            files: {},
            totalSize: 0,
            lastCleanup: new Date().toISOString()
        };
        
        await this.saveMetadata();
        this.emit('cache-cleared');
        
        return files.length;
    }

    /**
     * Pin a file (prevent it from being auto-removed)
     */
    async pinFile(fileId, version = 1) {
        const cacheKey = this.generateCacheKey(fileId, version);
        const entry = this.metadata.files[cacheKey];
        
        if (entry) {
            entry.pinned = true;
            await this.saveMetadata();
            return true;
        }
        return false;
    }

    /**
     * Unpin a file
     */
    async unpinFile(fileId, version = 1) {
        const cacheKey = this.generateCacheKey(fileId, version);
        const entry = this.metadata.files[cacheKey];
        
        if (entry) {
            entry.pinned = false;
            await this.saveMetadata();
            return true;
        }
        return false;
    }

    /**
     * Get pinned files
     */
    getPinnedFiles() {
        return Object.entries(this.metadata.files)
            .filter(([_, entry]) => entry.pinned)
            .map(([key, entry]) => ({ cacheKey: key, ...entry }));
    }

    /**
     * Format bytes to human readable
     */
    static formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

module.exports = OfflineCache;

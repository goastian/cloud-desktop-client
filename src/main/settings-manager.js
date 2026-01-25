/**
 * Settings Manager - Gestión de configuración del cliente de escritorio
 * Incluye límites de ancho de banda, sincronización selectiva y otras preferencias
 */

const EventEmitter = require('events');

class SettingsManager extends EventEmitter {
    constructor(store) {
        super();
        this.store = store;
        this.defaults = {
            // Bandwidth limits (bytes per second, 0 = unlimited)
            uploadBandwidthLimit: 0,
            downloadBandwidthLimit: 0,
            
            // Sync settings
            syncMode: 'automatic', // 'automatic', 'manual', 'selective'
            syncInterval: 30000, // milliseconds
            pauseSyncOnMeteredConnection: true,
            
            // Selective sync - files/folders to exclude
            excludedPatterns: [
                '*.tmp',
                '*.temp',
                '~$*',
                '.DS_Store',
                'Thumbs.db',
                'desktop.ini',
                '*.part'
            ],
            excludedFolders: [],
            
            // File size limits
            maxFileSizeForAutoSync: 100 * 1024 * 1024, // 100 MB
            
            // Notifications
            showNotifications: true,
            notifyOnSyncComplete: true,
            notifyOnErrors: true,
            
            // Startup
            launchOnStartup: false,
            startMinimized: false,
            
            // Cache settings
            enableOfflineCache: true,
            maxCacheSize: 1024 * 1024 * 1024, // 1 GB
            cacheExpirationDays: 30,
            
            // UI preferences
            theme: 'system', // 'light', 'dark', 'system'
            language: 'es'
        };
    }

    /**
     * Get all settings
     */
    getSettings() {
        const saved = this.store.get('settings', {});
        return { ...this.defaults, ...saved };
    }

    /**
     * Get a specific setting
     */
    getSetting(key) {
        const settings = this.getSettings();
        return settings[key];
    }

    /**
     * Update settings
     */
    updateSettings(updates) {
        const current = this.getSettings();
        const newSettings = { ...current, ...updates };
        this.store.set('settings', newSettings);
        this.emit('settings-changed', { updates, settings: newSettings });
        return newSettings;
    }

    /**
     * Reset settings to defaults
     */
    resetSettings() {
        this.store.set('settings', this.defaults);
        this.emit('settings-changed', { updates: this.defaults, settings: this.defaults });
        return this.defaults;
    }

    // ============================================
    // Bandwidth Management
    // ============================================

    /**
     * Set upload bandwidth limit (bytes per second)
     * @param {number} bytesPerSecond - 0 for unlimited
     */
    setUploadBandwidthLimit(bytesPerSecond) {
        return this.updateSettings({ uploadBandwidthLimit: Math.max(0, bytesPerSecond) });
    }

    /**
     * Set download bandwidth limit (bytes per second)
     * @param {number} bytesPerSecond - 0 for unlimited
     */
    setDownloadBandwidthLimit(bytesPerSecond) {
        return this.updateSettings({ downloadBandwidthLimit: Math.max(0, bytesPerSecond) });
    }

    /**
     * Get bandwidth limits
     */
    getBandwidthLimits() {
        const settings = this.getSettings();
        return {
            upload: settings.uploadBandwidthLimit,
            download: settings.downloadBandwidthLimit
        };
    }

    /**
     * Convert human-readable bandwidth to bytes per second
     * @param {number} value 
     * @param {string} unit - 'KB', 'MB'
     */
    static bandwidthToBytes(value, unit) {
        const multipliers = {
            'KB': 1024,
            'MB': 1024 * 1024
        };
        return value * (multipliers[unit] || 1);
    }

    /**
     * Convert bytes per second to human-readable format
     * @param {number} bytesPerSecond 
     */
    static bytesToBandwidth(bytesPerSecond) {
        if (bytesPerSecond === 0) return { value: 0, unit: 'KB', display: 'Sin límite' };
        if (bytesPerSecond >= 1024 * 1024) {
            return { 
                value: Math.round(bytesPerSecond / (1024 * 1024)), 
                unit: 'MB',
                display: `${Math.round(bytesPerSecond / (1024 * 1024))} MB/s`
            };
        }
        return { 
            value: Math.round(bytesPerSecond / 1024), 
            unit: 'KB',
            display: `${Math.round(bytesPerSecond / 1024)} KB/s`
        };
    }

    // ============================================
    // Sync Mode Management
    // ============================================

    /**
     * Set sync mode
     * @param {string} mode - 'automatic', 'manual', 'selective'
     */
    setSyncMode(mode) {
        const validModes = ['automatic', 'manual', 'selective'];
        if (!validModes.includes(mode)) {
            throw new Error(`Invalid sync mode: ${mode}`);
        }
        return this.updateSettings({ syncMode: mode });
    }

    /**
     * Get current sync mode
     */
    getSyncMode() {
        return this.getSetting('syncMode');
    }

    /**
     * Set sync interval (for automatic mode)
     * @param {number} milliseconds 
     */
    setSyncInterval(milliseconds) {
        return this.updateSettings({ syncInterval: Math.max(5000, milliseconds) });
    }

    // ============================================
    // Selective Sync / Exclusions
    // ============================================

    /**
     * Add pattern to exclude from sync
     * @param {string} pattern - Glob pattern (e.g., '*.tmp', 'node_modules')
     */
    addExcludedPattern(pattern) {
        const patterns = this.getSetting('excludedPatterns');
        if (!patterns.includes(pattern)) {
            patterns.push(pattern);
            return this.updateSettings({ excludedPatterns: patterns });
        }
        return this.getSettings();
    }

    /**
     * Remove pattern from exclusions
     */
    removeExcludedPattern(pattern) {
        const patterns = this.getSetting('excludedPatterns').filter(p => p !== pattern);
        return this.updateSettings({ excludedPatterns: patterns });
    }

    /**
     * Add folder to exclude from sync
     */
    addExcludedFolder(folderPath) {
        const folders = this.getSetting('excludedFolders');
        if (!folders.includes(folderPath)) {
            folders.push(folderPath);
            return this.updateSettings({ excludedFolders: folders });
        }
        return this.getSettings();
    }

    /**
     * Remove folder from exclusions
     */
    removeExcludedFolder(folderPath) {
        const folders = this.getSetting('excludedFolders').filter(f => f !== folderPath);
        return this.updateSettings({ excludedFolders: folders });
    }

    /**
     * Check if a file should be excluded from sync
     * @param {string} filePath 
     * @param {string} fileName 
     */
    shouldExcludeFile(filePath, fileName) {
        const patterns = this.getSetting('excludedPatterns');
        const excludedFolders = this.getSetting('excludedFolders');
        
        // Check excluded folders
        for (const folder of excludedFolders) {
            if (filePath.startsWith(folder)) {
                return true;
            }
        }
        
        // Check patterns
        for (const pattern of patterns) {
            if (this.matchPattern(fileName, pattern)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Simple glob pattern matching
     */
    matchPattern(fileName, pattern) {
        // Convert glob to regex
        const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        
        const regex = new RegExp(`^${regexPattern}$`, 'i');
        return regex.test(fileName);
    }

    /**
     * Check if file size exceeds auto-sync limit
     */
    exceedsAutoSyncLimit(fileSize) {
        const maxSize = this.getSetting('maxFileSizeForAutoSync');
        return maxSize > 0 && fileSize > maxSize;
    }

    // ============================================
    // Cache Settings
    // ============================================

    /**
     * Set offline cache settings
     */
    setCacheSettings(options) {
        const updates = {};
        if (typeof options.enabled === 'boolean') {
            updates.enableOfflineCache = options.enabled;
        }
        if (typeof options.maxSize === 'number') {
            updates.maxCacheSize = options.maxSize;
        }
        if (typeof options.expirationDays === 'number') {
            updates.cacheExpirationDays = options.expirationDays;
        }
        return this.updateSettings(updates);
    }

    /**
     * Get cache settings
     */
    getCacheSettings() {
        const settings = this.getSettings();
        return {
            enabled: settings.enableOfflineCache,
            maxSize: settings.maxCacheSize,
            expirationDays: settings.cacheExpirationDays
        };
    }
}

module.exports = SettingsManager;

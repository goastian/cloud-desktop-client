/**
 * Activity History - Registro de actividades de sincronización
 * Mantiene un historial de todas las operaciones realizadas
 */

const EventEmitter = require('events');
const path = require('path');

class ActivityHistory extends EventEmitter {
    constructor(store) {
        super();
        this.store = store;
        this.maxEntries = 1000; // Máximo de entradas en el historial
    }

    /**
     * Activity types
     */
    static TYPES = {
        UPLOAD: 'upload',
        DOWNLOAD: 'download',
        DELETE: 'delete',
        RENAME: 'rename',
        MOVE: 'move',
        CONFLICT: 'conflict',
        ERROR: 'error',
        SYNC_START: 'sync_start',
        SYNC_COMPLETE: 'sync_complete',
        SYNC_PAUSE: 'sync_pause',
        SYNC_RESUME: 'sync_resume',
        FOLDER_ADDED: 'folder_added',
        FOLDER_REMOVED: 'folder_removed',
        CONNECTION_LOST: 'connection_lost',
        CONNECTION_RESTORED: 'connection_restored'
    };

    /**
     * Activity status
     */
    static STATUS = {
        PENDING: 'pending',
        IN_PROGRESS: 'in_progress',
        COMPLETED: 'completed',
        FAILED: 'failed',
        CANCELLED: 'cancelled'
    };

    /**
     * Get all activity history
     * @param {Object} options - Filter options
     */
    getHistory(options = {}) {
        const history = this.store.get('activityHistory', []);
        let filtered = [...history];

        // Filter by type
        if (options.type) {
            filtered = filtered.filter(a => a.type === options.type);
        }

        // Filter by status
        if (options.status) {
            filtered = filtered.filter(a => a.status === options.status);
        }

        // Filter by folder
        if (options.folderId) {
            filtered = filtered.filter(a => a.folderId === options.folderId);
        }

        // Filter by date range
        if (options.startDate) {
            const start = new Date(options.startDate).getTime();
            filtered = filtered.filter(a => new Date(a.timestamp).getTime() >= start);
        }
        if (options.endDate) {
            const end = new Date(options.endDate).getTime();
            filtered = filtered.filter(a => new Date(a.timestamp).getTime() <= end);
        }

        // Sort by timestamp (newest first)
        filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Limit results
        if (options.limit) {
            filtered = filtered.slice(0, options.limit);
        }

        return filtered;
    }

    /**
     * Get recent activity (last 24 hours)
     */
    getRecentActivity(limit = 50) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        return this.getHistory({
            startDate: yesterday.toISOString(),
            limit
        });
    }

    /**
     * Get activity statistics
     */
    getStats() {
        const history = this.store.get('activityHistory', []);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const todayActivities = history.filter(a => 
            new Date(a.timestamp) >= today
        );

        const stats = {
            total: history.length,
            today: todayActivities.length,
            byType: {},
            byStatus: {},
            totalBytesUploaded: 0,
            totalBytesDownloaded: 0,
            errors: 0
        };

        for (const activity of history) {
            // Count by type
            stats.byType[activity.type] = (stats.byType[activity.type] || 0) + 1;
            
            // Count by status
            stats.byStatus[activity.status] = (stats.byStatus[activity.status] || 0) + 1;
            
            // Sum bytes
            if (activity.type === ActivityHistory.TYPES.UPLOAD && activity.size) {
                stats.totalBytesUploaded += activity.size;
            }
            if (activity.type === ActivityHistory.TYPES.DOWNLOAD && activity.size) {
                stats.totalBytesDownloaded += activity.size;
            }
            
            // Count errors
            if (activity.status === ActivityHistory.STATUS.FAILED) {
                stats.errors++;
            }
        }

        return stats;
    }

    /**
     * Add activity to history
     * @param {Object} activity 
     */
    addActivity(activity) {
        const history = this.store.get('activityHistory', []);
        
        const newActivity = {
            id: this.generateId(),
            timestamp: new Date().toISOString(),
            status: ActivityHistory.STATUS.COMPLETED,
            ...activity
        };

        history.unshift(newActivity);

        // Trim history if exceeds max
        if (history.length > this.maxEntries) {
            history.splice(this.maxEntries);
        }

        this.store.set('activityHistory', history);
        this.emit('activity-added', newActivity);
        
        return newActivity;
    }

    /**
     * Log file upload
     */
    logUpload(filePath, fileSize, folderId, options = {}) {
        return this.addActivity({
            type: ActivityHistory.TYPES.UPLOAD,
            filePath,
            fileName: path.basename(filePath),
            size: fileSize,
            folderId,
            status: options.status || ActivityHistory.STATUS.COMPLETED,
            error: options.error,
            duration: options.duration
        });
    }

    /**
     * Log file download
     */
    logDownload(filePath, fileSize, folderId, options = {}) {
        return this.addActivity({
            type: ActivityHistory.TYPES.DOWNLOAD,
            filePath,
            fileName: path.basename(filePath),
            size: fileSize,
            folderId,
            status: options.status || ActivityHistory.STATUS.COMPLETED,
            error: options.error,
            duration: options.duration
        });
    }

    /**
     * Log file deletion
     */
    logDelete(filePath, folderId, options = {}) {
        return this.addActivity({
            type: ActivityHistory.TYPES.DELETE,
            filePath,
            fileName: path.basename(filePath),
            folderId,
            status: options.status || ActivityHistory.STATUS.COMPLETED,
            error: options.error,
            isLocal: options.isLocal || false,
            isRemote: options.isRemote || false
        });
    }

    /**
     * Log sync conflict
     */
    logConflict(filePath, folderId, resolution) {
        return this.addActivity({
            type: ActivityHistory.TYPES.CONFLICT,
            filePath,
            fileName: path.basename(filePath),
            folderId,
            resolution,
            status: ActivityHistory.STATUS.COMPLETED
        });
    }

    /**
     * Log error
     */
    logError(message, details = {}) {
        return this.addActivity({
            type: ActivityHistory.TYPES.ERROR,
            message,
            ...details,
            status: ActivityHistory.STATUS.FAILED
        });
    }

    /**
     * Log sync start
     */
    logSyncStart(folderId, folderName) {
        return this.addActivity({
            type: ActivityHistory.TYPES.SYNC_START,
            folderId,
            folderName,
            message: `Sincronización iniciada: ${folderName}`
        });
    }

    /**
     * Log sync complete
     */
    logSyncComplete(folderId, folderName, stats = {}) {
        return this.addActivity({
            type: ActivityHistory.TYPES.SYNC_COMPLETE,
            folderId,
            folderName,
            message: `Sincronización completada: ${folderName}`,
            filesUploaded: stats.uploaded || 0,
            filesDownloaded: stats.downloaded || 0,
            filesDeleted: stats.deleted || 0,
            duration: stats.duration
        });
    }

    /**
     * Log folder added
     */
    logFolderAdded(folderId, folderPath) {
        return this.addActivity({
            type: ActivityHistory.TYPES.FOLDER_ADDED,
            folderId,
            folderPath,
            folderName: path.basename(folderPath),
            message: `Carpeta agregada: ${path.basename(folderPath)}`
        });
    }

    /**
     * Log folder removed
     */
    logFolderRemoved(folderId, folderPath) {
        return this.addActivity({
            type: ActivityHistory.TYPES.FOLDER_REMOVED,
            folderId,
            folderPath,
            folderName: path.basename(folderPath),
            message: `Carpeta eliminada: ${path.basename(folderPath)}`
        });
    }

    /**
     * Update activity status
     */
    updateActivity(activityId, updates) {
        const history = this.store.get('activityHistory', []);
        const index = history.findIndex(a => a.id === activityId);
        
        if (index !== -1) {
            history[index] = { ...history[index], ...updates };
            this.store.set('activityHistory', history);
            this.emit('activity-updated', history[index]);
            return history[index];
        }
        
        return null;
    }

    /**
     * Clear all history
     */
    clearHistory() {
        this.store.set('activityHistory', []);
        this.emit('history-cleared');
    }

    /**
     * Clear old entries (older than specified days)
     */
    clearOldEntries(days = 30) {
        const history = this.store.get('activityHistory', []);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        
        const filtered = history.filter(a => 
            new Date(a.timestamp) >= cutoff
        );
        
        const removed = history.length - filtered.length;
        this.store.set('activityHistory', filtered);
        
        return removed;
    }

    /**
     * Export history to JSON
     */
    exportHistory() {
        return JSON.stringify(this.store.get('activityHistory', []), null, 2);
    }

    /**
     * Generate unique ID
     */
    generateId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get activity icon based on type
     */
    static getActivityIcon(type) {
        const icons = {
            [ActivityHistory.TYPES.UPLOAD]: '⬆️',
            [ActivityHistory.TYPES.DOWNLOAD]: '⬇️',
            [ActivityHistory.TYPES.DELETE]: '🗑️',
            [ActivityHistory.TYPES.RENAME]: '✏️',
            [ActivityHistory.TYPES.MOVE]: '📦',
            [ActivityHistory.TYPES.CONFLICT]: '⚠️',
            [ActivityHistory.TYPES.ERROR]: '❌',
            [ActivityHistory.TYPES.SYNC_START]: '🔄',
            [ActivityHistory.TYPES.SYNC_COMPLETE]: '✅',
            [ActivityHistory.TYPES.SYNC_PAUSE]: '⏸️',
            [ActivityHistory.TYPES.SYNC_RESUME]: '▶️',
            [ActivityHistory.TYPES.FOLDER_ADDED]: '📁',
            [ActivityHistory.TYPES.FOLDER_REMOVED]: '📂',
            [ActivityHistory.TYPES.CONNECTION_LOST]: '📡',
            [ActivityHistory.TYPES.CONNECTION_RESTORED]: '🌐'
        };
        return icons[type] || '📋';
    }

    /**
     * Get human-readable activity description
     */
    static getActivityDescription(activity) {
        switch (activity.type) {
            case ActivityHistory.TYPES.UPLOAD:
                return `Subido: ${activity.fileName}`;
            case ActivityHistory.TYPES.DOWNLOAD:
                return `Descargado: ${activity.fileName}`;
            case ActivityHistory.TYPES.DELETE:
                return `Eliminado: ${activity.fileName}`;
            case ActivityHistory.TYPES.CONFLICT:
                return `Conflicto resuelto: ${activity.fileName}`;
            case ActivityHistory.TYPES.ERROR:
                return activity.message || 'Error desconocido';
            case ActivityHistory.TYPES.SYNC_START:
                return activity.message || 'Sincronización iniciada';
            case ActivityHistory.TYPES.SYNC_COMPLETE:
                return activity.message || 'Sincronización completada';
            default:
                return activity.message || activity.type;
        }
    }
}

module.exports = ActivityHistory;

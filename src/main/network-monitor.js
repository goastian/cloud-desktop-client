/**
 * Network Monitor - Detects online/offline status and pauses/resumes sync accordingly
 */

const { EventEmitter } = require('events');
const { net } = require('electron');

class NetworkMonitor extends EventEmitter {
    constructor(options = {}) {
        super();
        this.online = true;
        this.checkInterval = options.checkInterval || 30000; // 30s default
        this.serverUrl = options.serverUrl || null;
        this._intervalId = null;
    }

    /**
     * Start monitoring network status
     */
    start() {
        // Initial check
        this._check();

        // Periodic check
        this._intervalId = setInterval(() => this._check(), this.checkInterval);
        console.log('[NetworkMonitor] Started monitoring');
    }

    /**
     * Stop monitoring
     */
    stop() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
        console.log('[NetworkMonitor] Stopped');
    }

    /**
     * Check current network status using Electron's net module
     */
    _check() {
        const wasOnline = this.online;
        this.online = net.isOnline();

        if (wasOnline && !this.online) {
            console.log('[NetworkMonitor] ⚠️  Network went OFFLINE');
            this.emit('offline');
            this.emit('status-changed', { online: false });
        } else if (!wasOnline && this.online) {
            console.log('[NetworkMonitor] ✓ Network is back ONLINE');
            this.emit('online');
            this.emit('status-changed', { online: true });
        }
    }

    /**
     * Get current status
     */
    isOnline() {
        return this.online;
    }

    /**
     * Update the server URL for connectivity checks
     */
    setServerUrl(url) {
        this.serverUrl = url;
    }
}

module.exports = NetworkMonitor;

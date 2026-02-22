const { autoUpdater } = require('electron-updater');
const { app, dialog, BrowserWindow, Notification } = require('electron');

/**
 * E4: Auto-update module using electron-updater.
 * Reads releases from GitHub: https://github.com/goastian/cloud-desktop-client
 * electron-builder publishes artifacts to GitHub Releases; electron-updater
 * fetches latest.yml / latest-mac.yml / latest-linux.yml from the release
 * assets and compares versions automatically.
 */
class AutoUpdater {
    constructor(options = {}) {
        this.checkInterval = options.checkIntervalMs || 4 * 60 * 60 * 1000; // 4 hours
        this.intervalId = null;
        this.mainWindow = null;
        this.silent = options.silent !== false; // silent by default

        // Configure autoUpdater to use GitHub Releases
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.allowPrerelease = false;
        autoUpdater.logger = console;

        // Explicitly set GitHub as the update provider
        autoUpdater.setFeedURL({
            provider: 'github',
            owner: 'goastian',
            repo: 'cloud-desktop-client',
        });

        this._bindEvents();
    }

    _bindEvents() {
        autoUpdater.on('checking-for-update', () => {
            console.log('[AutoUpdater] Checking for update...');
        });

        autoUpdater.on('update-available', (info) => {
            console.log('[AutoUpdater] Update available:', info.version);
            this._notify(
                'Update Available',
                `A new version (${info.version}) is being downloaded.`
            );
        });

        autoUpdater.on('update-not-available', () => {
            console.log('[AutoUpdater] No update available.');
        });

        autoUpdater.on('download-progress', (progress) => {
            const pct = Math.round(progress.percent);
            console.log(`[AutoUpdater] Download progress: ${pct}%`);
            // Update taskbar progress if window is available
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.setProgressBar(progress.percent / 100);
            }
        });

        autoUpdater.on('update-downloaded', (info) => {
            console.log('[AutoUpdater] Update downloaded:', info.version);
            // Clear taskbar progress
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.setProgressBar(-1);
            }

            this._notify(
                'Update Ready',
                `Version ${info.version} will be installed when you restart.`
            );

            // If the window is visible, offer immediate restart
            if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible()) {
                dialog.showMessageBox(this.mainWindow, {
                    type: 'info',
                    title: 'Update Ready',
                    message: `Version ${info.version} has been downloaded.`,
                    detail: 'Restart now to apply the update?',
                    buttons: ['Restart Now', 'Later'],
                    defaultId: 0,
                }).then(({ response }) => {
                    if (response === 0) {
                        app.isQuitting = true;
                        autoUpdater.quitAndInstall(false, true);
                    }
                });
            }
        });

        autoUpdater.on('error', (error) => {
            console.error('[AutoUpdater] Error:', error.message);
        });
    }

    _notify(title, body) {
        if (!Notification.isSupported()) return;
        try {
            const notif = new Notification({ title, body });
            notif.show();
        } catch (e) {
            // Notification may fail in some environments
        }
    }

    /**
     * Start checking for updates.
     * @param {BrowserWindow} mainWindow - Reference to the main window
     */
    start(mainWindow) {
        this.mainWindow = mainWindow;

        // Initial check after a short delay to let the app settle
        setTimeout(() => {
            this.checkForUpdates();
        }, 10000);

        // Periodic checks
        this.intervalId = setInterval(() => {
            this.checkForUpdates();
        }, this.checkInterval);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    checkForUpdates() {
        try {
            autoUpdater.checkForUpdates();
        } catch (e) {
            console.error('[AutoUpdater] Check failed:', e.message);
        }
    }

    /**
     * Manual check triggered by user (shows dialog even if no update).
     */
    async checkForUpdatesManual() {
        try {
            const result = await autoUpdater.checkForUpdates();
            if (!result || !result.updateInfo) {
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    dialog.showMessageBox(this.mainWindow, {
                        type: 'info',
                        title: 'No Updates',
                        message: 'You are running the latest version.',
                    });
                }
            }
        } catch (e) {
            console.error('[AutoUpdater] Manual check failed:', e.message);
        }
    }
}

module.exports = AutoUpdater;

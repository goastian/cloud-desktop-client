const { contextBridge, ipcRenderer } = require('electron');

// Whitelist of valid IPC channels for invoke (renderer → main)
const VALID_INVOKE_CHANNELS = [
    'get-config',
    'get-storage-stats',
    'set-server-url',
    'is-dev-mode',
    'get-environment',
    'set-environment',
    'toggle-environment',
    'set-production-url',
    'validate-user-email',
    'generate-pairing-code',
    'verify-pairing-code',
    'select-sync-folder',
    'start-sync',
    'open-external',
    'logout',
    'get-device-info',
    'set-device-name',
    'get-sync-folders',
    'add-sync-folder',
    'remove-sync-folder',
    'toggle-sync-folder',
    'update-sync-folder',
    'get-folder-stats',
    'list-folder-contents',
    'get-common-folders',
    'browse-folder',
    'get-backup-folders',
    'add-backup-folder',
    'remove-backup-folder',
    'start-backup',
    'toggle-backup-folder',
    'start-all-syncs',
    'stop-all-syncs',
    'get-sync-status',
    'clear-sync-cache',
    'get-settings',
    'update-settings',
    'reset-settings',
    'set-bandwidth-limits',
    'get-bandwidth-limits',
    'set-sync-mode',
    'add-excluded-pattern',
    'remove-excluded-pattern',
    'add-excluded-folder',
    'remove-excluded-folder',
    'get-activity-history',
    'get-recent-activity',
    'get-activity-stats',
    'clear-activity-history',
    'clear-old-activity',
    'export-activity-history',
    'get-active-transfers',
    'cancel-transfer',
    'cancel-all-transfers',
    'init-offline-cache',
    'get-cache-stats',
    'get-cached-files',
    'clear-cache',
    'clean-expired-cache',
    'pin-cached-file',
    'unpin-cached-file',
    'get-pinned-files',
    'set-cache-settings',
    'sync-now',
    'pause-sync',
    'resume-sync',
    'save-device-name',
    'add-exclusion-pattern',
    'remove-exclusion-pattern',
    'resolve-conflict'
];

// Whitelist of valid IPC channels for on (main → renderer)
const VALID_RECEIVE_CHANNELS = [
    'sync-status-changed',
    'transfers-updated',
    'transfer-progress',
    'network-status-changed',
    'conflict-detected'
];

contextBridge.exposeInMainWorld('electronAPI', {
    invoke: (channel, ...args) => {
        if (VALID_INVOKE_CHANNELS.includes(channel)) {
            return ipcRenderer.invoke(channel, ...args);
        }
        console.error(`[Preload] Blocked invoke on invalid channel: ${channel}`);
        return Promise.reject(new Error(`Invalid IPC channel: ${channel}`));
    },
    on: (channel, callback) => {
        if (VALID_RECEIVE_CHANNELS.includes(channel)) {
            const subscription = (event, ...args) => callback(...args);
            ipcRenderer.on(channel, subscription);
            // Return unsubscribe function
            return () => ipcRenderer.removeListener(channel, subscription);
        }
        console.error(`[Preload] Blocked listener on invalid channel: ${channel}`);
        return () => {};
    },
    off: (channel) => {
        if (VALID_RECEIVE_CHANNELS.includes(channel)) {
            ipcRenderer.removeAllListeners(channel);
        }
    },
    removeAllListeners: (channel) => {
        if (VALID_RECEIVE_CHANNELS.includes(channel)) {
            ipcRenderer.removeAllListeners(channel);
        }
    }
});

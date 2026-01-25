const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const Conf = require('conf');
const SyncEngine = require('./sync-engine');
const AuthService = require('./auth-service');
const DeviceManager = require('./device-manager');
const SyncFoldersManager = require('./sync-folders-manager');
const BackupService = require('./backup-service');
const SettingsManager = require('./settings-manager');
const ActivityHistory = require('./activity-history');
const OfflineCache = require('./offline-cache');
const EnvironmentConfig = require('./environment-config');

const store = new Conf({
    projectName: 'astian-cloud',
    projectSuffix: ''
});
let mainWindow = null;
let tray = null;
let syncEngines = new Map(); // Multiple sync engines for multiple folders
let backupService = null;
let offlineCache = null;

// Initialize services
const environmentConfig = new EnvironmentConfig(store);
const authService = new AuthService(store, environmentConfig);
const deviceManager = new DeviceManager(store);
const syncFoldersManager = new SyncFoldersManager(store);
const settingsManager = new SettingsManager(store);
const activityHistory = new ActivityHistory(store);

const isDev = process.argv.includes('--dev');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 480,
        height: 700,
        show: false,
        frame: true,
        resizable: true,
        minWidth: 400,
        minHeight: 500,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(__dirname, '../../assets/icon.png')
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    if (isDev) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('ready-to-show', () => {
        const isAuthenticated = store.get('authenticated', false);
        if (!isAuthenticated) {
            mainWindow.show();
        }
    });

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });
}

function createTray() {
    const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
    tray = new Tray(iconPath);

    const updateTrayMenu = () => {
        const isAuthenticated = store.get('authenticated', false);
        // Fix: Use syncEngines Map instead of undefined syncEngine
        const isSyncing = syncEngines.size > 0 && Array.from(syncEngines.values()).some(e => !e.paused);
        const syncFolders = syncFoldersManager.getSyncFolders();
        const folderCount = syncFolders.length;

        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'Astian Cloud',
                enabled: false
            },
            { type: 'separator' },
            {
                label: isAuthenticated ? `✓ Authenticated` : '✗ Not authenticated',
                enabled: false
            },
            {
                label: isSyncing ? '🔄 Syncing...' : '⏸ Paused',
                enabled: false
            },
            {
                label: `📁 ${folderCount} carpeta${folderCount !== 1 ? 's' : ''} sincronizada${folderCount !== 1 ? 's' : ''}`,
                enabled: false
            },
            { type: 'separator' },
            {
                label: 'Open Folder',
                click: () => {
                    const folder = store.get('syncFolder');
                    if (folder) {
                        require('electron').shell.openPath(folder);
                    }
                },
                enabled: isAuthenticated
            },
            {
                label: 'Open Web App',
                click: () => {
                    const serverUrl = environmentConfig.getServerUrl();
                    require('electron').shell.openExternal(serverUrl);
                }
            },
            { type: 'separator' },
            {
                label: isSyncing ? 'Pausar Sincronización' : 'Reanudar Sincronización',
                click: () => {
                    // Pause/resume all sync engines
                    for (const [id, engine] of syncEngines) {
                        if (isSyncing) {
                            engine.pause();
                        } else {
                            engine.resume();
                        }
                    }
                    updateTrayMenu();
                },
                enabled: isAuthenticated && syncEngines.size > 0
            },
            {
                label: 'Sincronizar Ahora',
                click: async () => {
                    for (const [id, engine] of syncEngines) {
                        await engine.syncNow();
                    }
                    activityHistory.addActivity({
                        type: ActivityHistory.TYPES.SYNC_START,
                        message: 'Sincronización manual iniciada'
                    });
                },
                enabled: isAuthenticated && syncEngines.size > 0
            },
            {
                label: 'Settings',
                click: () => {
                    mainWindow.show();
                }
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => {
                    app.isQuitting = true;
                    app.quit();
                }
            }
        ]);

        tray.setContextMenu(contextMenu);
    };

    updateTrayMenu();
    
    // Fix: Properly show window on tray click
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            if (!mainWindow.isVisible()) {
                mainWindow.show();
            }
            mainWindow.focus();
        }
    });
    
    // Double-click also shows window
    tray.on('double-click', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            if (!mainWindow.isVisible()) {
                mainWindow.show();
            }
            mainWindow.focus();
        }
    });

    tray.setToolTip('Astian Cloud - Desktop Sync');

    return updateTrayMenu;
}

app.whenReady().then(async () => {
    createWindow();
    const updateTrayMenu = createTray();
    
    const isAuthenticated = store.get('authenticated', false);
    if (isAuthenticated) {
        const token = store.get('authToken');
        const serverUrl = environmentConfig.getServerUrl();
        
        // Start sync engines for all enabled sync folders
        const syncFolders = syncFoldersManager.getSyncFolders();
        for (const folder of syncFolders) {
            if (folder.enabled && token) {
                try {
                    await startSyncForFolder(folder);
                    console.log(`Started sync for folder: ${folder.name}`);
                } catch (error) {
                    console.error(`Failed to start sync for ${folder.name}:`, error.message);
                }
            }
        }
        
        // Legacy support: if no sync folders but old syncFolder exists, migrate it
        const legacySyncFolder = store.get('syncFolder');
        if (syncFolders.length === 0 && legacySyncFolder && token) {
            const newFolder = syncFoldersManager.addSyncFolder(legacySyncFolder, path.basename(legacySyncFolder));
            if (newFolder) {
                try {
                    await startSyncForFolder(newFolder);
                    console.log(`Migrated legacy sync folder: ${legacySyncFolder}`);
                } catch (error) {
                    console.error(`Failed to start sync for legacy folder:`, error.message);
                }
            }
        }
    }
});

app.on('window-all-closed', () => {
    // No hacer nada - mantener app en background
});

app.on('before-quit', () => {
    // Stop all sync engines
    for (const [id, engine] of syncEngines) {
        engine.stop();
    }
    syncEngines.clear();
});

// IPC Handlers

ipcMain.handle('get-config', async () => {
    return {
        authenticated: store.get('authenticated', false),
        serverUrl: environmentConfig.getServerUrl(),
        syncFolder: store.get('syncFolder', ''),
        syncFolders: syncFoldersManager.getSyncFolders(),
        backupFolders: store.get('backupFolders', []),
        email: store.get('email', ''),
        device: deviceManager.getDeviceInfo(),
        environment: environmentConfig.getConfig()
    };
});

ipcMain.handle('set-server-url', async (event, url) => {
    // In production mode, update the production URL
    // In development mode, this is ignored (always localhost:8000)
    if (environmentConfig.isProduction()) {
        environmentConfig.setProductionUrl(url);
    }
    authService.updateServerUrl(environmentConfig.getServerUrl());
    return { success: true, serverUrl: environmentConfig.getServerUrl() };
});

// Environment Management IPC Handlers
ipcMain.handle('is-dev-mode', async () => {
    return isDev;
});

ipcMain.handle('get-environment', async () => {
    return environmentConfig.getConfig();
});

ipcMain.handle('set-environment', async (event, env) => {
    try {
        const result = environmentConfig.setEnvironment(env);
        authService.updateServerUrl(result.serverUrl);
        return { success: true, ...result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('toggle-environment', async () => {
    try {
        const result = environmentConfig.toggleEnvironment();
        authService.updateServerUrl(result.serverUrl);
        return { success: true, ...result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('set-production-url', async (event, url) => {
    try {
        const newUrl = environmentConfig.setProductionUrl(url);
        if (environmentConfig.isProduction()) {
            authService.updateServerUrl(newUrl);
        }
        return { success: true, productionUrl: newUrl };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('validate-user-email', async (event, email) => {
    try {
        const result = await authService.validateUserEmail(email);
        return result;
    } catch (error) {
        console.error('Error validating email:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('generate-pairing-code', async (event, email) => {
    try {
        // Registrar código en el servidor (el servicio genera el código)
        const result = await authService.registerPairingCode(email);
        
        if (result.success) {
            // Guardar código temporalmente
            store.set('pendingCode', result.code);
            store.set('codeGeneratedAt', Date.now());
            store.set('userEmail', email);
            return { success: true, code: result.code };
        }
        
        return result;
    } catch (error) {
        console.error('Error generating pairing code:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('verify-pairing-code', async (event, code) => {
    try {
        const result = await authService.checkPairingApproval(code);
        
        if (result.success && result.token) {
            store.set('authenticated', true);
            store.set('authToken', result.token);
            store.delete('pendingCode');
            store.delete('codeGeneratedAt');
            
            return { success: true };
        }
        
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('select-sync-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Sync Folder',
        buttonLabel: 'Select Folder'
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const folder = result.filePaths[0];
        store.set('syncFolder', folder);
        return { success: true, folder };
    }

    return { success: false };
});

ipcMain.handle('start-sync', async () => {
    try {
        const token = store.get('authToken');

        if (!token) {
            return { success: false, error: 'Not authenticated' };
        }

        // Start sync for all enabled folders
        const syncFolders = syncFoldersManager.getSyncFolders();
        for (const folder of syncFolders) {
            if (folder.enabled && !syncEngines.has(folder.id)) {
                await startSyncForFolder(folder);
            }
        }
        
        mainWindow.hide();
        
        return { success: true };
    } catch (error) {
        console.error('Error starting sync:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('open-external', async (event, url) => {
    try {
        await require('electron').shell.openExternal(url);
        return { success: true };
    } catch (error) {
        console.error('Error opening external URL:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('logout', async () => {
    // Stop all sync engines
    for (const [id, engine] of syncEngines) {
        engine.stop();
    }
    syncEngines.clear();
    
    store.clear();
    
    mainWindow.show();
    mainWindow.webContents.reload();
    
    return { success: true };
});

// ============================================
// Device Management IPC Handlers
// ============================================

ipcMain.handle('get-device-info', async () => {
    return deviceManager.getDeviceInfo();
});

ipcMain.handle('set-device-name', async (event, name) => {
    try {
        const device = deviceManager.setDeviceName(name);
        return { success: true, device };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============================================
// Sync Folders Management IPC Handlers
// ============================================

ipcMain.handle('get-sync-folders', async () => {
    return syncFoldersManager.getSyncFolders();
});

ipcMain.handle('add-sync-folder', async (event, options = {}) => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory', 'createDirectory'],
            title: 'Select Folder to Sync',
            buttonLabel: 'Add Folder'
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true };
        }

        const folderPath = result.filePaths[0];
        const folder = syncFoldersManager.addSyncFolder(folderPath, options);
        
        // Get folder stats
        const stats = await syncFoldersManager.getFolderStats(folderPath);
        syncFoldersManager.updateSyncFolder(folder.id, stats);

        return { success: true, folder: { ...folder, ...stats } };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('remove-sync-folder', async (event, folderId) => {
    try {
        // Stop sync engine for this folder if running
        if (syncEngines.has(folderId)) {
            syncEngines.get(folderId).stop();
            syncEngines.delete(folderId);
        }
        
        const removed = syncFoldersManager.removeSyncFolder(folderId);
        return { success: true, folder: removed };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('toggle-sync-folder', async (event, folderId) => {
    try {
        const folder = syncFoldersManager.toggleSyncFolder(folderId);
        
        if (folder.enabled) {
            // Start sync for this folder
            await startSyncForFolder(folder);
        } else {
            // Stop sync for this folder
            if (syncEngines.has(folderId)) {
                syncEngines.get(folderId).stop();
                syncEngines.delete(folderId);
            }
        }
        
        return { success: true, folder };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('update-sync-folder', async (event, folderId, updates) => {
    try {
        const folder = syncFoldersManager.updateSyncFolder(folderId, updates);
        return { success: true, folder };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-folder-stats', async (event, folderPath) => {
    try {
        const stats = await syncFoldersManager.getFolderStats(folderPath);
        return { success: true, stats };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============================================
// Folder Browser IPC Handlers
// ============================================

ipcMain.handle('list-folder-contents', async (event, folderPath) => {
    try {
        const contents = await syncFoldersManager.listFolderContents(folderPath);
        return { success: true, contents };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-common-folders', async () => {
    return syncFoldersManager.getCommonFolders();
});

ipcMain.handle('browse-folder', async () => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            title: 'Browse Folder'
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true };
        }

        const folderPath = result.filePaths[0];
        const contents = await syncFoldersManager.listFolderContents(folderPath);
        
        return { success: true, path: folderPath, contents };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============================================
// Backup Management IPC Handlers
// ============================================

ipcMain.handle('get-backup-folders', async () => {
    return store.get('backupFolders', []);
});

ipcMain.handle('add-backup-folder', async (event, options = {}) => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            title: 'Select Folder to Backup',
            buttonLabel: 'Add Backup Folder'
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true };
        }

        const folderPath = result.filePaths[0];
        
        // Initialize backup service if needed
        if (!backupService) {
            const token = store.get('authToken');
            const serverUrl = environmentConfig.getServerUrl();
            backupService = new BackupService(store, token, serverUrl);
        }
        
        const folder = backupService.addBackupFolder(folderPath, options);
        const stats = await backupService.getFolderStats(folderPath);
        
        return { success: true, folder: { ...folder, ...stats } };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('remove-backup-folder', async (event, folderId) => {
    try {
        if (!backupService) {
            return { success: false, error: 'Backup service not initialized' };
        }
        
        const removed = backupService.removeBackupFolder(folderId);
        return { success: true, folder: removed };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('start-backup', async (event, folderId) => {
    try {
        if (!backupService) {
            const token = store.get('authToken');
            const serverUrl = environmentConfig.getServerUrl();
            backupService = new BackupService(store, token, serverUrl);
        }
        
        const result = await backupService.backupFolder(folderId);
        return { success: true, ...result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('toggle-backup-folder', async (event, folderId) => {
    try {
        if (!backupService) {
            const token = store.get('authToken');
            const serverUrl = environmentConfig.getServerUrl();
            backupService = new BackupService(store, token, serverUrl);
        }
        
        const folder = backupService.toggleBackupFolder(folderId);
        return { success: true, folder };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============================================
// Multi-folder Sync Management
// ============================================

async function startSyncForFolder(folder) {
    const token = store.get('authToken');
    const serverUrl = environmentConfig.getServerUrl();
    
    if (!token) {
        throw new Error('Not authenticated');
    }
    
    const engine = new SyncEngine(folder.path, token, serverUrl, store, activityHistory);
    engine.folderId = folder.id;
    
    engine.on('status-changed', () => {
        const status = engine.getStatus();
        // Use isActive for more accurate status determination
        let folderStatus = 'synced';
        if (status.paused) {
            folderStatus = 'paused';
        } else if (status.isActive || status.processing) {
            folderStatus = 'syncing';
        }
        syncFoldersManager.updateFolderStatus(folder.id, folderStatus);
        if (mainWindow) {
            mainWindow.webContents.send('sync-status-changed', { folderId: folder.id, status });
        }
    });
    
    syncEngines.set(folder.id, engine);
    await engine.start();
    
    return engine;
}

ipcMain.handle('start-all-syncs', async () => {
    try {
        const folders = syncFoldersManager.getEnabledFolders();
        const results = [];
        
        for (const folder of folders) {
            try {
                await startSyncForFolder(folder);
                results.push({ folderId: folder.id, success: true });
            } catch (error) {
                results.push({ folderId: folder.id, success: false, error: error.message });
            }
        }
        
        return { success: true, results };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('stop-all-syncs', async () => {
    for (const [id, engine] of syncEngines) {
        engine.stop();
    }
    syncEngines.clear();
    return { success: true };
});

ipcMain.handle('get-sync-status', async () => {
    const statuses = {};
    for (const [id, engine] of syncEngines) {
        statuses[id] = engine.getStatus();
    }
    return statuses;
});

ipcMain.handle('clear-sync-cache', async (event, folderId = null) => {
    try {
        if (folderId && syncEngines.has(folderId)) {
            // Limpiar cache de una carpeta específica
            const engine = syncEngines.get(folderId);
            engine.clearSyncCache();
            return { success: true, message: `Cache limpiado para carpeta ${folderId}` };
        } else {
            // Limpiar cache de todas las carpetas
            for (const [id, engine] of syncEngines) {
                engine.clearSyncCache();
            }
            return { success: true, message: 'Cache limpiado para todas las carpetas' };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============================================
// Settings Management IPC Handlers
// ============================================

ipcMain.handle('get-settings', async () => {
    return settingsManager.getSettings();
});

ipcMain.handle('update-settings', async (event, updates) => {
    try {
        const settings = settingsManager.updateSettings(updates);
        return { success: true, settings };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('reset-settings', async () => {
    try {
        const settings = settingsManager.resetSettings();
        return { success: true, settings };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('set-bandwidth-limits', async (event, { upload, download }) => {
    try {
        if (typeof upload === 'number') {
            settingsManager.setUploadBandwidthLimit(upload);
        }
        if (typeof download === 'number') {
            settingsManager.setDownloadBandwidthLimit(download);
        }
        
        // Apply to all sync engines
        for (const [id, engine] of syncEngines) {
            if (engine.setBandwidthLimits) {
                engine.setBandwidthLimits(
                    settingsManager.getSetting('uploadBandwidthLimit'),
                    settingsManager.getSetting('downloadBandwidthLimit')
                );
            }
        }
        
        return { success: true, limits: settingsManager.getBandwidthLimits() };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-bandwidth-limits', async () => {
    return settingsManager.getBandwidthLimits();
});

ipcMain.handle('set-sync-mode', async (event, mode) => {
    try {
        const settings = settingsManager.setSyncMode(mode);
        return { success: true, settings };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('add-excluded-pattern', async (event, pattern) => {
    try {
        const settings = settingsManager.addExcludedPattern(pattern);
        return { success: true, settings };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('remove-excluded-pattern', async (event, pattern) => {
    try {
        const settings = settingsManager.removeExcludedPattern(pattern);
        return { success: true, settings };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('add-excluded-folder', async (event, folderPath) => {
    try {
        const settings = settingsManager.addExcludedFolder(folderPath);
        return { success: true, settings };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('remove-excluded-folder', async (event, folderPath) => {
    try {
        const settings = settingsManager.removeExcludedFolder(folderPath);
        return { success: true, settings };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============================================
// Activity History IPC Handlers
// ============================================

ipcMain.handle('get-activity-history', async (event, options = {}) => {
    return activityHistory.getHistory(options);
});

ipcMain.handle('get-recent-activity', async (event, limit = 50) => {
    return activityHistory.getRecentActivity(limit);
});

ipcMain.handle('get-activity-stats', async () => {
    return activityHistory.getStats();
});

ipcMain.handle('clear-activity-history', async () => {
    activityHistory.clearHistory();
    return { success: true };
});

ipcMain.handle('clear-old-activity', async (event, days = 30) => {
    const removed = activityHistory.clearOldEntries(days);
    return { success: true, removed };
});

ipcMain.handle('export-activity-history', async () => {
    return activityHistory.exportHistory();
});

// Active Transfers IPC Handlers
ipcMain.handle('get-active-transfers', async () => {
    return activityHistory.getActiveTransfers();
});

ipcMain.handle('cancel-transfer', async (event, transferId) => {
    return activityHistory.cancelTransfer(transferId);
});

ipcMain.handle('cancel-all-transfers', async () => {
    return activityHistory.cancelAllTransfers();
});

// Forward transfer events to renderer
activityHistory.on('transfers-updated', (transfers) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transfers-updated', transfers);
    }
});

activityHistory.on('transfer-progress', (transfer) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transfer-progress', transfer);
    }
});

// ============================================
// Offline Cache IPC Handlers
// ============================================

ipcMain.handle('init-offline-cache', async () => {
    try {
        if (!offlineCache) {
            offlineCache = new OfflineCache(store);
        }
        await offlineCache.initialize();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-cache-stats', async () => {
    if (!offlineCache) {
        return { enabled: false, totalSize: 0, fileCount: 0 };
    }
    return offlineCache.getStats();
});

ipcMain.handle('get-cached-files', async () => {
    if (!offlineCache) return [];
    return offlineCache.getCachedFiles();
});

ipcMain.handle('clear-cache', async () => {
    try {
        if (!offlineCache) {
            return { success: true, removed: 0 };
        }
        const removed = await offlineCache.clearCache();
        return { success: true, removed };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clean-expired-cache', async () => {
    try {
        if (!offlineCache) {
            return { success: true, removed: 0 };
        }
        const removed = await offlineCache.cleanExpired();
        return { success: true, removed };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('pin-cached-file', async (event, fileId, version = 1) => {
    try {
        if (!offlineCache) {
            return { success: false, error: 'Cache not initialized' };
        }
        const result = await offlineCache.pinFile(fileId, version);
        return { success: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('unpin-cached-file', async (event, fileId, version = 1) => {
    try {
        if (!offlineCache) {
            return { success: false, error: 'Cache not initialized' };
        }
        const result = await offlineCache.unpinFile(fileId, version);
        return { success: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-pinned-files', async () => {
    if (!offlineCache) return [];
    return offlineCache.getPinnedFiles();
});

ipcMain.handle('set-cache-settings', async (event, options) => {
    try {
        const settings = settingsManager.setCacheSettings(options);
        return { success: true, settings };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============================================
// Manual Sync IPC Handlers
// ============================================

ipcMain.handle('sync-now', async (event, folderId = null) => {
    try {
        if (folderId) {
            // Sync specific folder
            const engine = syncEngines.get(folderId);
            if (engine) {
                await engine.syncNow();
                activityHistory.logSyncStart(folderId, 'Manual sync');
                return { success: true };
            }
            return { success: false, error: 'Folder not found' };
        } else {
            // Sync all folders
            for (const [id, engine] of syncEngines) {
                await engine.syncNow();
            }
            activityHistory.addActivity({
                type: ActivityHistory.TYPES.SYNC_START,
                message: 'Sincronización manual de todas las carpetas'
            });
            return { success: true };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('pause-sync', async (event, folderId = null) => {
    try {
        if (folderId) {
            const engine = syncEngines.get(folderId);
            if (engine) {
                engine.pause();
                return { success: true };
            }
            return { success: false, error: 'Folder not found' };
        } else {
            for (const [id, engine] of syncEngines) {
                engine.pause();
            }
            return { success: true };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('resume-sync', async (event, folderId = null) => {
    try {
        if (folderId) {
            const engine = syncEngines.get(folderId);
            if (engine) {
                engine.resume();
                return { success: true };
            }
            return { success: false, error: 'Folder not found' };
        } else {
            for (const [id, engine] of syncEngines) {
                engine.resume();
            }
            return { success: true };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
});

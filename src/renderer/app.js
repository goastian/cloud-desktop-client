const { ipcRenderer } = require('electron');

let currentStep = 'server';
let setupFolders = [];
let pairingCheckInterval = null;
let currentEmail = null;
let deviceInfo = null;
let syncFolders = [];
let backupFolders = [];
let settings = {};
let activityHistory = [];
let cacheStats = {};
let environmentConfig = {};
let isDevMode = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const config = await ipcRenderer.invoke('get-config');
    
    deviceInfo = config.device;
    syncFolders = config.syncFolders || [];
    backupFolders = config.backupFolders || [];
    environmentConfig = config.environment || {};
    
    // Check if running in dev mode (passed from main process)
    isDevMode = await ipcRenderer.invoke('is-dev-mode');
    
    // Show dev controls only in dev mode
    showDevControls(isDevMode);
    
    if (config.authenticated) {
        showDashboard();
    } else {
        // Update server URL input based on environment
        updateServerUrlInput(config);
        showStep('server');
    }
    
    setupEventListeners();
    setupTabListeners();
    
    // Listen for sync status changes from main process
    ipcRenderer.on('sync-status-changed', (event, data) => {
        updateSyncStatus(data);
    });
});

function setupEventListeners() {
    // Step 1: Server URL
    document.getElementById('btnConnect').addEventListener('click', async () => {
        const serverUrl = document.getElementById('serverUrl').value.trim();
        
        if (!serverUrl) {
            showError('Por favor ingresa la URL del servidor');
            return;
        }
        
        const btn = document.getElementById('btnConnect');
        btn.disabled = true;
        btn.textContent = 'Connecting...';
        
        await ipcRenderer.invoke('set-server-url', serverUrl);
        
        btn.disabled = false;
        btn.textContent = 'Connect';
        
        showStep('email');
    });
    
    // Environment toggle
    const envToggle = document.getElementById('envToggle');
    if (envToggle) {
        envToggle.addEventListener('change', async (e) => {
            const env = e.target.checked ? 'development' : 'production';
            const result = await ipcRenderer.invoke('set-environment', env);
            if (result.success) {
                environmentConfig = await ipcRenderer.invoke('get-environment');
                updateServerUrlInput({ serverUrl: result.serverUrl, environment: environmentConfig });
            }
        });
    }

    // Step 2: Email Validation
    document.getElementById('btnBackToServer').addEventListener('click', () => {
        showStep('server');
    });

    document.getElementById('btnValidateEmail').addEventListener('click', async () => {
        const email = document.getElementById('userEmail').value.trim();
        
        if (!email) {
            showEmailError('Please enter your email address');
            return;
        }

        if (!isValidEmail(email)) {
            showEmailError('Please enter a valid email address.');
            return;
        }
        
        const btn = document.getElementById('btnValidateEmail');
        btn.disabled = true;
        btn.textContent = 'Validating...';
        
        hideEmailMessages();
        
        const result = await ipcRenderer.invoke('validate-user-email', email);
        
        btn.disabled = false;
        btn.textContent = 'Continue';
        
        if (result.success) {
            if (result.exists) {
                const codeResult = await ipcRenderer.invoke('generate-pairing-code', email);
                
                if (codeResult.success) {
                    showStep('code');
                    startPairingCheck(codeResult.code);
                } else {
                    showEmailError(codeResult.error || 'Error al generar código de vinculación');
                }
            } else {
                showEmailInfo(
                    'Este correo no está registrado. Por favor regístrate primero en ' +
                    '<a href="#" id="linkRegister">la plataforma web</a>.'
                );
                
                document.getElementById('linkRegister').addEventListener('click', async (e) => {
                    e.preventDefault();
                    const serverUrl = document.getElementById('serverUrl').value.trim();
                    await ipcRenderer.invoke('open-external', `${serverUrl}/register`);
                });
            }
        } else {
            showEmailError(result.error || 'Error al validar el correo electrónico');
        }
    });
    
    // Step 3: Pairing Code
    document.getElementById('btnCancelCode').addEventListener('click', () => {
        stopPairingCheck();
        showStep('server');
    });
    
    // Step 4: Device Setup
    document.getElementById('btnSaveDevice').addEventListener('click', async () => {
        const deviceName = document.getElementById('deviceName').value.trim();
        
        if (deviceName) {
            await ipcRenderer.invoke('set-device-name', deviceName);
            deviceInfo = await ipcRenderer.invoke('get-device-info');
        }
        
        showStep('folder');
        renderSetupFolderList();
    });
    
    // Step 5: Folder Selection (Initial Setup)
    document.getElementById('btnAddFirstFolder').addEventListener('click', async () => {
        await addSyncFolderToSetup();
    });
    
    document.getElementById('btnStartSync').addEventListener('click', async () => {
        const btn = document.getElementById('btnStartSync');
        btn.disabled = true;
        btn.textContent = 'Iniciando...';
        
        const result = await ipcRenderer.invoke('start-all-syncs');
        
        if (result.success) {
            showDashboard();
        } else {
            showError(result.error || 'Error al iniciar sincronización');
            btn.disabled = false;
            btn.textContent = 'Iniciar sincronización';
        }
    });
    
    // Dashboard: Sync Folders
    document.getElementById('btnAddSyncFolder').addEventListener('click', addSyncFolder);
    document.getElementById('btnAddSyncFolderEmpty').addEventListener('click', addSyncFolder);
    
    // Dashboard: Backup Folders
    document.getElementById('btnAddBackupFolder').addEventListener('click', addBackupFolder);
    document.getElementById('btnAddBackupFolderEmpty').addEventListener('click', addBackupFolder);
    
    // Dashboard: Settings
    document.getElementById('btnSaveDeviceName').addEventListener('click', async () => {
        const name = document.getElementById('settingsDeviceName').value.trim();
        if (name) {
            const result = await ipcRenderer.invoke('set-device-name', name);
            if (result.success) {
                deviceInfo = result.device;
                updateDeviceCard();
                alert('Nombre guardado');
            }
        }
    });
    
    document.getElementById('btnLogout').addEventListener('click', async () => {
        if (confirm('¿Estás seguro de cerrar sesión? La sincronización se detendrá.')) {
            await ipcRenderer.invoke('logout');
        }
    });
    
    document.getElementById('btnOpenWebApp').addEventListener('click', async () => {
        const config = await ipcRenderer.invoke('get-config');
        await ipcRenderer.invoke('open-external', config.serverUrl);
    });
    
    // Settings: Environment
    const settingsEnvToggle = document.getElementById('settingsEnvToggle');
    if (settingsEnvToggle) {
        settingsEnvToggle.addEventListener('change', async (e) => {
            const env = e.target.checked ? 'development' : 'production';
            const result = await ipcRenderer.invoke('set-environment', env);
            if (result.success) {
                environmentConfig = await ipcRenderer.invoke('get-environment');
                updateEnvironmentUI();
                alert(`Entorno cambiado a: ${env === 'development' ? 'Desarrollo' : 'Producción'}\nURL: ${result.serverUrl}`);
            }
        });
    }
    
    const btnSaveProductionUrl = document.getElementById('btnSaveProductionUrl');
    if (btnSaveProductionUrl) {
        btnSaveProductionUrl.addEventListener('click', async () => {
            const url = document.getElementById('settingsProductionUrl').value.trim();
            if (!url) {
                alert('Por favor ingresa una URL válida');
                return;
            }
            const result = await ipcRenderer.invoke('set-production-url', url);
            if (result.success) {
                environmentConfig = await ipcRenderer.invoke('get-environment');
                updateEnvironmentUI();
                alert('URL de producción guardada');
            } else {
                alert('Error: ' + result.error);
            }
        });
    }
    
    // Settings: Bandwidth
    document.getElementById('btnSaveBandwidth').addEventListener('click', saveBandwidthLimits);
    
    // Settings: Sync Mode
    document.querySelectorAll('input[name="syncMode"]').forEach(radio => {
        radio.addEventListener('change', async (e) => {
            await ipcRenderer.invoke('set-sync-mode', e.target.value);
        });
    });
    
    document.getElementById('btnSyncNow').addEventListener('click', async () => {
        const btn = document.getElementById('btnSyncNow');
        btn.disabled = true;
        btn.textContent = 'Synchronizing...';
        await ipcRenderer.invoke('sync-now');
        btn.disabled = false;
        btn.textContent = 'Sincronizar Ahora';
        loadActivityHistory();
    });
    
    // Settings: Exclusions
    document.getElementById('btnAddExclusion').addEventListener('click', addExclusionPattern);
    document.getElementById('newExclusionPattern').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addExclusionPattern();
    });
    
    // Settings: Cache
    document.getElementById('enableCache').addEventListener('change', async (e) => {
        await ipcRenderer.invoke('set-cache-settings', { enabled: e.target.checked });
    });
    
    document.getElementById('btnClearCache').addEventListener('click', async () => {
        if (confirm('¿Limpiar toda la caché offline?')) {
            await ipcRenderer.invoke('clear-cache');
            loadCacheStats();
        }
    });
    
    // Activity
    document.getElementById('btnRefreshActivity').addEventListener('click', loadActivityHistory);
    document.getElementById('activityFilter').addEventListener('change', loadActivityHistory);
    document.getElementById('btnClearActivity').addEventListener('click', async () => {
        if (confirm('¿Limpiar todo el historial de actividad?')) {
            await ipcRenderer.invoke('clear-activity-history');
            loadActivityHistory();
        }
    });
    document.getElementById('btnExportActivity').addEventListener('click', exportActivityHistory);
}

function setupTabListeners() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            // Update tab buttons
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Update tab content
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`tab-${tabName}`).classList.add('active');
        });
    });
}

async function startPairingCheck(code) {
    document.getElementById('pairingCode').textContent = code;
    
    let attempts = 0;
    const maxAttempts = 60;
    
    pairingCheckInterval = setInterval(async () => {
        attempts++;
        
        if (attempts > maxAttempts) {
            stopPairingCheck();
            showCodeError('Código expirado. Por favor intenta de nuevo.');
            return;
        }
        
        const result = await ipcRenderer.invoke('verify-pairing-code', code);
        
        if (result.success) {
            stopPairingCheck();
            // Load device info and go to device setup
            deviceInfo = await ipcRenderer.invoke('get-device-info');
            document.getElementById('deviceName').value = deviceInfo.name || '';
            showStep('device-setup');
        } else if (result.error && !result.error.includes('not found') && !result.error.includes('not approved')) {
            stopPairingCheck();
            showCodeError(result.error);
        }
    }, 5000);
}

function stopPairingCheck() {
    if (pairingCheckInterval) {
        clearInterval(pairingCheckInterval);
        pairingCheckInterval = null;
    }
}

function showStep(stepName) {
    currentStep = stepName;
    
    document.querySelectorAll('.step').forEach(step => {
        step.classList.remove('active');
    });
    
    document.getElementById('dashboard').classList.remove('show');
    
    const targetStep = document.getElementById(`step-${stepName}`);
    if (targetStep) {
        targetStep.classList.add('active');
    }
    
    hideError();
    hideCodeError();
}

async function showDashboard() {
    document.querySelectorAll('.step').forEach(el => {
        el.classList.remove('active');
    });
    
    document.getElementById('dashboard').classList.add('show');
    
    // Load data
    const config = await ipcRenderer.invoke('get-config');
    deviceInfo = config.device;
    syncFolders = config.syncFolders || [];
    backupFolders = config.backupFolders || [];
    environmentConfig = config.environment || {};
    
    updateDeviceCard();
    renderSyncFolderList();
    renderBackupFolderList();
    updateEnvironmentUI();
    
    document.getElementById('settingsDeviceName').value = deviceInfo?.name || '';
    document.getElementById('settingsServerUrl').textContent = config.serverUrl;
    
    // Load settings
    await loadSettings();
    
    // Load activity history
    await loadActivityHistory();
    
    // Load cache stats
    await loadCacheStats();
    
    // Initialize offline cache
    await ipcRenderer.invoke('init-offline-cache');
}

function updateDeviceCard() {
    if (deviceInfo) {
        document.getElementById('dashDeviceName').textContent = deviceInfo.name || 'My Device';
        document.getElementById('dashDeviceInfo').textContent = `${deviceInfo.platformName} • Connected`;
    }
}

// ============================================
// Sync Folders Management
// ============================================

async function addSyncFolderToSetup() {
    const result = await ipcRenderer.invoke('add-sync-folder');
    
    if (result.success && !result.canceled) {
        setupFolders.push(result.folder);
        syncFolders = await ipcRenderer.invoke('get-sync-folders');
        renderSetupFolderList();
        document.getElementById('btnStartSync').disabled = setupFolders.length === 0;
    }
}

function renderSetupFolderList() {
    const container = document.getElementById('setupFolderList');
    
    if (syncFolders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📂</div>
                <p>Add at least one folder to sync</p>
            </div>
        `;
        document.getElementById('btnStartSync').disabled = true;
        return;
    }
    
    container.innerHTML = syncFolders.map(folder => `
        <div class="folder-item" data-id="${folder.id}">
            <div class="folder-icon">📁</div>
            <div class="folder-details">
                <div class="folder-name">${folder.name}</div>
                <div class="folder-path">${folder.path}</div>
                <div class="folder-stats">${formatBytes(folder.totalSize || 0)} • ${folder.fileCount || 0} files</div>
            </div>
            <div class="folder-actions">
                <button class="btn-small btn-danger" onclick="removeSetupFolder('${folder.id}')">✕</button>
            </div>
        </div>
    `).join('');
    
    document.getElementById('btnStartSync').disabled = false;
}

async function removeSetupFolder(folderId) {
    await ipcRenderer.invoke('remove-sync-folder', folderId);
    syncFolders = await ipcRenderer.invoke('get-sync-folders');
    setupFolders = setupFolders.filter(f => f.id !== folderId);
    renderSetupFolderList();
}

async function addSyncFolder() {
    const result = await ipcRenderer.invoke('add-sync-folder');
    
    if (result.success && !result.canceled) {
        syncFolders = await ipcRenderer.invoke('get-sync-folders');
        renderSyncFolderList();
        
        // Start sync for the new folder
        await ipcRenderer.invoke('toggle-sync-folder', result.folder.id);
    }
}

function renderSyncFolderList() {
    const container = document.getElementById('syncFolderList');
    
    if (syncFolders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📂</div>
                <p>No hay carpetas configuradas</p>
                <button id="btnAddSyncFolderEmpty" class="btn-small" onclick="addSyncFolder()">Add folder</button>
            </div>
        `;
        return;
    }
    
    container.innerHTML = syncFolders.map(folder => `
        <div class="folder-item" data-id="${folder.id}">
            <div class="folder-icon">📁</div>
            <div class="folder-details">
                <div class="folder-name">${folder.name}</div>
                <div class="folder-path">${folder.path}</div>
                <div class="folder-stats">
                    ${formatBytes(folder.totalSize || 0)} • ${folder.fileCount || 0} archivos
                    <span class="status-badge status-${folder.status || 'pending'}">${getStatusText(folder.status)}</span>
                </div>
            </div>
            <div class="folder-actions">
                <label class="toggle-switch">
                    <input type="checkbox" ${folder.enabled ? 'checked' : ''} onchange="toggleSyncFolder('${folder.id}')">
                    <span class="toggle-slider"></span>
                </label>
                <button class="btn-small btn-danger" onclick="removeSyncFolder('${folder.id}')">✕</button>
            </div>
        </div>
    `).join('');
}

async function toggleSyncFolder(folderId) {
    await ipcRenderer.invoke('toggle-sync-folder', folderId);
    syncFolders = await ipcRenderer.invoke('get-sync-folders');
    renderSyncFolderList();
}

async function removeSyncFolder(folderId) {
    if (confirm('¿Eliminar esta carpeta de la sincronización?')) {
        await ipcRenderer.invoke('remove-sync-folder', folderId);
        syncFolders = await ipcRenderer.invoke('get-sync-folders');
        renderSyncFolderList();
    }
}

// ============================================
// Backup Folders Management
// ============================================

async function addBackupFolder() {
    const result = await ipcRenderer.invoke('add-backup-folder');
    
    if (result.success && !result.canceled) {
        backupFolders = await ipcRenderer.invoke('get-backup-folders');
        renderBackupFolderList();
    }
}

function renderBackupFolderList() {
    const container = document.getElementById('backupFolderList');
    
    if (backupFolders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">💾</div>
                <p>There are no backup folders.</p>
                <button class="btn-small" onclick="addBackupFolder()">Add Folder</button>
            </div>
        `;
        return;
    }
    
    container.innerHTML = backupFolders.map(folder => `
        <div class="folder-item" data-id="${folder.id}">
            <div class="folder-icon">💾</div>
            <div class="folder-details">
                <div class="folder-name">${folder.name}</div>
                <div class="folder-path">${folder.path}</div>
                <div class="folder-stats">
                    ${formatBytes(folder.totalSize || 0)} • ${folder.fileCount || 0} files
                    ${folder.lastBackup ? `• Last: ${formatDate(folder.lastBackup)}` : ''}
                </div>
            </div>
            <div class="folder-actions">
                <button class="btn-small btn-success" onclick="startBackup('${folder.id}')" title="Iniciar backup">↑</button>
                <button class="btn-small btn-danger" onclick="removeBackupFolder('${folder.id}')">✕</button>
            </div>
        </div>
    `).join('');
}

async function startBackup(folderId) {
    const result = await ipcRenderer.invoke('start-backup', folderId);
    
    if (result.success) {
        alert(`Backup completado: ${result.uploaded} archivos subidos`);
        backupFolders = await ipcRenderer.invoke('get-backup-folders');
        renderBackupFolderList();
    } else {
        alert('Error en backup: ' + result.error);
    }
}

async function removeBackupFolder(folderId) {
    if (confirm('¿Eliminar esta carpeta del backup?')) {
        await ipcRenderer.invoke('remove-backup-folder', folderId);
        backupFolders = await ipcRenderer.invoke('get-backup-folders');
        renderBackupFolderList();
    }
}

// ============================================
// Utility Functions
// ============================================

function showError(message) {
    const errorEl = document.getElementById('generalError');
    errorEl.textContent = message;
    errorEl.classList.add('show');
}

function hideError() {
    const errorEl = document.getElementById('generalError');
    errorEl.classList.remove('show');
}

function showCodeError(message) {
    const errorEl = document.getElementById('codeError');
    errorEl.textContent = message;
    errorEl.classList.add('show');
    document.getElementById('codeSpinner').style.display = 'none';
}

function hideCodeError() {
    const errorEl = document.getElementById('codeError');
    errorEl.classList.remove('show');
    document.getElementById('codeSpinner').style.display = 'block';
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function showEmailError(message) {
    const errorDiv = document.getElementById('emailError');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
    const infoDiv = document.getElementById('emailInfo');
    if (infoDiv) {
        infoDiv.style.display = 'none';
    }
}

function showEmailInfo(message) {
    const infoDiv = document.getElementById('emailInfo');
    if (infoDiv) {
        infoDiv.innerHTML = message;
        infoDiv.style.display = 'block';
    }
    const errorDiv = document.getElementById('emailError');
    if (errorDiv) {
        errorDiv.style.display = 'none';
    }
}

function hideEmailMessages() {
    const errorDiv = document.getElementById('emailError');
    if (errorDiv) {
        errorDiv.style.display = 'none';
    }
    const infoDiv = document.getElementById('emailInfo');
    if (infoDiv) {
        infoDiv.style.display = 'none';
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getStatusText(status) {
    const statusMap = {
        'pending': 'Pending',
        'syncing': 'Synchronizing',
        'synced': 'Synchronized',
        'paused': 'Paused',
        'error': 'Error'
    };
    return statusMap[status] || 'Pending';
}

function updateSyncStatus(data) {
    const indicator = document.getElementById('syncIndicator');
    const text = document.getElementById('syncStatusText');
    
    // Use isActive for more accurate status (only true when actively processing)
    const isActivelyProcessing = data.status.isActive || (data.status.processing && !data.status.paused);
    
    if (isActivelyProcessing) {
        indicator.classList.add('syncing');
        text.textContent = 'Synchronizing...';
    } else if (data.status.paused) {
        indicator.classList.remove('syncing');
        text.textContent = 'Paused';
    } else {
        indicator.classList.remove('syncing');
        text.textContent = 'Synchronized';
    }
    
    // Update folder status in list
    syncFolders = syncFolders.map(f => {
        if (f.id === data.folderId) {
            let status = 'synced';
            if (data.status.paused) {
                status = 'paused';
            } else if (isActivelyProcessing) {
                status = 'syncing';
            }
            return { ...f, status };
        }
        return f;
    });
    renderSyncFolderList();
}

// ============================================
// Settings Management
// ============================================

async function loadSettings() {
    settings = await ipcRenderer.invoke('get-settings');
    
    // Bandwidth limits
    const limits = await ipcRenderer.invoke('get-bandwidth-limits');
    updateBandwidthUI(limits);
    
    // Sync mode
    const syncModeRadio = document.querySelector(`input[name="syncMode"][value="${settings.syncMode}"]`);
    if (syncModeRadio) syncModeRadio.checked = true;
    
    // Exclusion patterns
    renderExclusionPatterns();
    
    // Cache settings
    document.getElementById('enableCache').checked = settings.enableOfflineCache !== false;
}

function updateBandwidthUI(limits) {
    const uploadInput = document.getElementById('uploadLimit');
    const uploadUnit = document.getElementById('uploadLimitUnit');
    const downloadInput = document.getElementById('downloadLimit');
    const downloadUnit = document.getElementById('downloadLimitUnit');
    
    if (limits.upload === 0) {
        uploadInput.value = '';
        uploadUnit.value = '0';
    } else if (limits.upload >= 1024 * 1024) {
        uploadInput.value = Math.round(limits.upload / (1024 * 1024));
        uploadUnit.value = 'MB';
    } else {
        uploadInput.value = Math.round(limits.upload / 1024);
        uploadUnit.value = 'KB';
    }
    
    if (limits.download === 0) {
        downloadInput.value = '';
        downloadUnit.value = '0';
    } else if (limits.download >= 1024 * 1024) {
        downloadInput.value = Math.round(limits.download / (1024 * 1024));
        downloadUnit.value = 'MB';
    } else {
        downloadInput.value = Math.round(limits.download / 1024);
        downloadUnit.value = 'KB';
    }
}

async function saveBandwidthLimits() {
    const uploadValue = parseInt(document.getElementById('uploadLimit').value) || 0;
    const uploadUnit = document.getElementById('uploadLimitUnit').value;
    const downloadValue = parseInt(document.getElementById('downloadLimit').value) || 0;
    const downloadUnit = document.getElementById('downloadLimitUnit').value;
    
    let uploadBytes = 0;
    let downloadBytes = 0;
    
    if (uploadUnit === 'KB') uploadBytes = uploadValue * 1024;
    else if (uploadUnit === 'MB') uploadBytes = uploadValue * 1024 * 1024;
    
    if (downloadUnit === 'KB') downloadBytes = downloadValue * 1024;
    else if (downloadUnit === 'MB') downloadBytes = downloadValue * 1024 * 1024;
    
    const result = await ipcRenderer.invoke('set-bandwidth-limits', {
        upload: uploadBytes,
        download: downloadBytes
    });
    
    if (result.success) {
        alert('Límites de ancho de banda guardados');
    }
}

function renderExclusionPatterns() {
    const container = document.getElementById('excludedPatterns');
    const patterns = settings.excludedPatterns || [];
    
    if (patterns.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding: 10px;"><small>No hay patrones de exclusión</small></div>';
        return;
    }
    
    container.innerHTML = patterns.map(pattern => `
        <div class="exclusion-item">
            <code>${pattern}</code>
            <button onclick="removeExclusionPattern('${pattern}')">✕</button>
        </div>
    `).join('');
}

async function addExclusionPattern() {
    const input = document.getElementById('newExclusionPattern');
    const pattern = input.value.trim();
    
    if (!pattern) return;
    
    const result = await ipcRenderer.invoke('add-excluded-pattern', pattern);
    if (result.success) {
        settings = result.settings;
        renderExclusionPatterns();
        input.value = '';
    }
}

async function removeExclusionPattern(pattern) {
    const result = await ipcRenderer.invoke('remove-excluded-pattern', pattern);
    if (result.success) {
        settings = result.settings;
        renderExclusionPatterns();
    }
}

// ============================================
// Activity History
// ============================================

async function loadActivityHistory() {
    const filter = document.getElementById('activityFilter').value;
    const options = { limit: 50 };
    
    if (filter !== 'all') {
        options.type = filter;
    }
    
    activityHistory = await ipcRenderer.invoke('get-activity-history', options);
    const stats = await ipcRenderer.invoke('get-activity-stats');
    
    // Update stats
    document.getElementById('statUploaded').textContent = stats.byType?.upload || 0;
    document.getElementById('statDownloaded').textContent = stats.byType?.download || 0;
    document.getElementById('statErrors').textContent = stats.errors || 0;
    
    renderActivityList();
}

function renderActivityList() {
    const container = document.getElementById('activityList');
    
    if (activityHistory.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📊</div>
                <p>No hay actividad reciente</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = activityHistory.map(activity => `
        <div class="activity-item">
            <div class="activity-icon">${getActivityIcon(activity.type)}</div>
            <div class="activity-details">
                <div class="activity-title">${getActivityDescription(activity)}</div>
                <div class="activity-meta">
                    <span>${formatRelativeTime(activity.timestamp)}</span>
                    ${activity.size ? `<span>${formatBytes(activity.size)}</span>` : ''}
                </div>
            </div>
        </div>
    `).join('');
}

function getActivityIcon(type) {
    const icons = {
        'upload': '⬆️',
        'download': '⬇️',
        'delete': '🗑️',
        'conflict': '⚠️',
        'error': '❌',
        'sync_start': '🔄',
        'sync_complete': '✅',
        'folder_added': '📁',
        'folder_removed': '📂'
    };
    return icons[type] || '📋';
}

function getActivityDescription(activity) {
    switch (activity.type) {
        case 'upload': return `Subido: ${activity.fileName || 'archivo'}`;
        case 'download': return `Descargado: ${activity.fileName || 'archivo'}`;
        case 'delete': return `Eliminado: ${activity.fileName || 'archivo'}`;
        case 'conflict': return `Conflicto resuelto: ${activity.fileName || 'archivo'}`;
        case 'error': return activity.message || 'Error desconocido';
        case 'sync_start': return activity.message || 'Sincronización iniciada';
        case 'sync_complete': return activity.message || 'Sincronización completada';
        default: return activity.message || activity.type;
    }
}

function formatRelativeTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return `Hace ${diffMins} min`;
    if (diffHours < 24) return `Hace ${diffHours}h`;
    if (diffDays < 7) return `Hace ${diffDays}d`;
    return date.toLocaleDateString();
}

async function exportActivityHistory() {
    const data = await ipcRenderer.invoke('export-activity-history');
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `astian-cloud-activity-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================
// Cache Management
// ============================================

async function loadCacheStats() {
    cacheStats = await ipcRenderer.invoke('get-cache-stats');
    
    document.getElementById('cacheFileCount').textContent = cacheStats.fileCount || 0;
    document.getElementById('cacheSize').textContent = formatBytes(cacheStats.totalSize || 0);
    document.getElementById('cacheLimit').textContent = formatBytes(cacheStats.maxSize || 1024 * 1024 * 1024);
    document.getElementById('cacheProgress').style.width = `${cacheStats.usagePercent || 0}%`;
    document.getElementById('enableCache').checked = cacheStats.enabled !== false;
}

// ============================================
// Environment Management
// ============================================

function updateServerUrlInput(config) {
    const serverUrlInput = document.getElementById('serverUrl');
    const envToggle = document.getElementById('envToggle');
    const envLabel = document.getElementById('envLabel');
    
    if (serverUrlInput && config.serverUrl) {
        serverUrlInput.value = config.serverUrl;
    }
    
    if (config.environment) {
        const isDev = config.environment.isDevelopment;
        
        if (envToggle) {
            envToggle.checked = isDev;
        }
        
        if (envLabel) {
            envLabel.textContent = isDev ? '🔧 Desarrollo' : '🌐 Producción';
            envLabel.className = isDev ? 'env-label env-dev' : 'env-label env-prod';
        }
        
        // Disable URL input in development mode (always localhost:8000)
        if (serverUrlInput) {
            serverUrlInput.disabled = isDev;
            if (isDev) {
                serverUrlInput.title = 'En modo desarrollo, la URL es siempre localhost:8000';
            } else {
                serverUrlInput.title = '';
            }
        }
    }
}

function updateEnvironmentUI() {
    const settingsEnvToggle = document.getElementById('settingsEnvToggle');
    const settingsEnvLabel = document.getElementById('settingsEnvLabel');
    const settingsServerUrl = document.getElementById('settingsServerUrl');
    const settingsProductionUrl = document.getElementById('settingsProductionUrl');
    const productionUrlSection = document.getElementById('productionUrlSection');
    
    if (!environmentConfig) return;
    
    const isDev = environmentConfig.isDevelopment;
    
    if (settingsEnvToggle) {
        settingsEnvToggle.checked = isDev;
    }
    
    if (settingsEnvLabel) {
        settingsEnvLabel.textContent = isDev ? '🔧 Desarrollo (localhost:8000)' : '🌐 Producción';
        settingsEnvLabel.className = isDev ? 'env-label env-dev' : 'env-label env-prod';
    }
    
    if (settingsServerUrl) {
        settingsServerUrl.textContent = environmentConfig.serverUrl || '';
    }
    
    if (settingsProductionUrl) {
        settingsProductionUrl.value = environmentConfig.productionUrl || '';
    }
    
    // Show/hide production URL section based on environment
    if (productionUrlSection) {
        productionUrlSection.style.display = isDev ? 'none' : 'block';
    }
}

function showDevControls(show) {
    // Show/hide environment toggle in server step
    const envToggleContainer = document.getElementById('envToggleContainer');
    if (envToggleContainer) {
        envToggleContainer.style.display = show ? 'block' : 'none';
    }
    
    // Show/hide dev settings section in settings tab
    const devSettingsSection = document.getElementById('devSettingsSection');
    if (devSettingsSection) {
        devSettingsSection.style.display = show ? 'block' : 'none';
    }
}

// Make functions globally available for onclick handlers
window.removeSetupFolder = removeSetupFolder;
window.addSyncFolder = addSyncFolder;
window.toggleSyncFolder = toggleSyncFolder;
window.removeSyncFolder = removeSyncFolder;
window.addBackupFolder = addBackupFolder;
window.startBackup = startBackup;
window.removeBackupFolder = removeBackupFolder;
window.removeExclusionPattern = removeExclusionPattern;

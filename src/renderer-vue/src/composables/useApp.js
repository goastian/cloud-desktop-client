import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { useElectron } from './useElectron'
import { useToast } from './useToast'

/**
 * Central app state composable — manages auth flow, config, network status,
 * sync status, and all IPC event listeners.
 */
const currentView = ref('loading') // loading | setup | dashboard
const setupStep = ref('server')    // server | email | code | device | folder
const isOnline = ref(true)

const config = reactive({
  authenticated: false,
  serverUrl: 'https://cloud2.astian.org',
  syncFolders: [],
  backupFolders: [],
  email: '',
  device: null,
  environment: null,
})

const storage = reactive({
  used: 0,
  total: 10 * 1024 * 1024 * 1024,
  loading: false,
})

const syncStatuses = reactive({})   // folderId -> status object
const transfers = ref([])           // active/pending transfers
const activities = ref([])          // activity history
const activityStats = reactive({ uploaded: 0, downloaded: 0, errors: 0 })

export function useApp() {
  const { invoke, on, off, available } = useElectron()
  const toast = useToast()

  // ── Bootstrap ──
  async function init() {
    if (!available) {
      currentView.value = 'setup'
      return
    }

    try {
      const cfg = await invoke('get-config')
      Object.assign(config, cfg)

      if (config.authenticated) {
        currentView.value = 'dashboard'
        await refreshStorage()
        await refreshActivity()
        await refreshTransfers()
      } else {
        currentView.value = 'setup'
        setupStep.value = 'server'

        // Check dev mode for env toggle
        const isDev = await invoke('is-dev-mode')
        config._isDev = isDev
      }
    } catch (e) {
      console.error('[useApp] init error:', e)
      currentView.value = 'setup'
    }
  }

  // ── IPC event listeners ──
  function setupListeners() {
    on('sync-status-changed', (data) => {
      syncStatuses[data.folderId] = data.status
    })
    on('transfers-updated', (data) => {
      transfers.value = data
    })
    on('transfer-progress', (transfer) => {
      const idx = transfers.value.findIndex(t => t.id === transfer.id)
      if (idx !== -1) {
        transfers.value[idx] = { ...transfers.value[idx], ...transfer }
      }
    })
    on('network-status-changed', (data) => {
      isOnline.value = data.online
      toast.show(
        data.online ? 'Connection restored' : 'You are offline — sync paused',
        data.online ? 'success' : 'warning'
      )
    })
  }

  function teardownListeners() {
    off('sync-status-changed')
    off('transfers-updated')
    off('transfer-progress')
    off('network-status-changed')
  }

  // ── Auth flow ──
  async function connectServer(url) {
    const result = await invoke('set-server-url', url)
    if (result?.success) {
      config.serverUrl = result.serverUrl
      setupStep.value = 'email'
    }
    return result
  }

  async function validateEmail(email) {
    const result = await invoke('validate-user-email', email)
    if (result?.success) {
      config.email = email
    }
    return result
  }

  async function generatePairingCode(email) {
    return await invoke('generate-pairing-code', email)
  }

  async function verifyPairingCode(code) {
    return await invoke('verify-pairing-code', code)
  }

  async function saveDevice(name) {
    return await invoke('save-device-name', name)
  }

  async function getDeviceInfo() {
    return await invoke('get-device-info')
  }

  // ── Folder management ──
  async function addSyncFolder() {
    const result = await invoke('add-sync-folder')
    if (result?.success) {
      config.syncFolders = await invoke('get-sync-folders') || config.syncFolders
    }
    return result
  }

  async function removeSyncFolder(folderId) {
    const result = await invoke('remove-sync-folder', folderId)
    if (result?.success) {
      config.syncFolders = config.syncFolders.filter(f => f.id !== folderId)
    }
    return result
  }

  async function toggleSyncFolder(folderId) {
    const result = await invoke('toggle-sync-folder', folderId)
    if (result?.success && result.folder) {
      const idx = config.syncFolders.findIndex(f => f.id === folderId)
      if (idx !== -1) config.syncFolders[idx] = result.folder
    }
    return result
  }

  // ── Backup management ──
  async function addBackupFolder() {
    return await invoke('add-backup-folder')
  }

  async function removeBackupFolder(folderId) {
    return await invoke('remove-backup-folder', folderId)
  }

  async function toggleBackupFolder(folderId) {
    return await invoke('toggle-backup-folder', folderId)
  }

  // ── Sync controls ──
  async function startSync() {
    const result = await invoke('start-sync')
    return result
  }

  async function startAllSyncs() {
    return await invoke('start-all-syncs')
  }

  async function stopAllSyncs() {
    return await invoke('stop-all-syncs')
  }

  async function pauseSync(folderId) {
    return await invoke('pause-sync', folderId)
  }

  async function resumeSync(folderId) {
    return await invoke('resume-sync', folderId)
  }

  async function syncNow(folderId) {
    return await invoke('sync-now', folderId)
  }

  // ── Storage ──
  async function refreshStorage() {
    storage.loading = true
    try {
      const result = await invoke('get-storage-stats')
      if (result?.success) {
        storage.used = result.used || 0
        storage.total = result.total || 10 * 1024 * 1024 * 1024
      }
    } finally {
      storage.loading = false
    }
  }

  // ── Activity ──
  async function refreshActivity() {
    try {
      const result = await invoke('get-activity-history')
      if (result?.activities) activities.value = result.activities
      if (result?.stats) Object.assign(activityStats, result.stats)
    } catch (e) { /* ignore */ }
  }

  async function refreshTransfers() {
    try {
      const result = await invoke('get-active-transfers')
      if (Array.isArray(result)) transfers.value = result
    } catch (e) { /* ignore */ }
  }

  async function clearActivity() {
    await invoke('clear-activity-history')
    activities.value = []
    Object.assign(activityStats, { uploaded: 0, downloaded: 0, errors: 0 })
  }

  async function cancelTransfer(transferId) {
    return await invoke('cancel-transfer', transferId)
  }

  async function cancelAllTransfers() {
    return await invoke('cancel-all-transfers')
  }

  // ── Settings ──
  async function getSettings() {
    return await invoke('get-settings')
  }

  async function updateSettings(updates) {
    return await invoke('update-settings', updates)
  }

  async function saveBandwidthLimits(upload, download) {
    return await invoke('set-bandwidth-limits', { upload, download })
  }

  async function addExclusionPattern(pattern) {
    return await invoke('add-exclusion-pattern', pattern)
  }

  async function removeExclusionPattern(pattern) {
    return await invoke('remove-exclusion-pattern', pattern)
  }

  // ── Cache ──
  async function getCacheStats() {
    return await invoke('get-cache-stats')
  }

  async function clearCache() {
    return await invoke('clear-cache')
  }

  // ── Misc ──
  async function openExternal(url) {
    return await invoke('open-external', url)
  }

  async function logout() {
    const result = await invoke('logout')
    if (result?.success) {
      config.authenticated = false
      currentView.value = 'setup'
      setupStep.value = 'server'
    }
    return result
  }

  async function selectSyncFolder() {
    return await invoke('select-sync-folder')
  }

  async function getEnvironment() {
    return await invoke('get-environment')
  }

  async function toggleEnvironment() {
    return await invoke('toggle-environment')
  }

  return {
    // State
    currentView,
    setupStep,
    isOnline,
    config,
    storage,
    syncStatuses,
    transfers,
    activities,
    activityStats,

    // Lifecycle
    init,
    setupListeners,
    teardownListeners,

    // Auth
    connectServer,
    validateEmail,
    generatePairingCode,
    verifyPairingCode,
    saveDevice,
    getDeviceInfo,

    // Folders
    addSyncFolder,
    removeSyncFolder,
    toggleSyncFolder,
    addBackupFolder,
    removeBackupFolder,
    toggleBackupFolder,
    selectSyncFolder,

    // Sync
    startSync,
    startAllSyncs,
    stopAllSyncs,
    pauseSync,
    resumeSync,
    syncNow,

    // Data
    refreshStorage,
    refreshActivity,
    refreshTransfers,
    clearActivity,
    cancelTransfer,
    cancelAllTransfers,

    // Settings
    getSettings,
    updateSettings,
    saveBandwidthLimits,
    addExclusionPattern,
    removeExclusionPattern,

    // Cache
    getCacheStats,
    clearCache,

    // Misc
    openExternal,
    logout,
    getEnvironment,
    toggleEnvironment,
  }
}

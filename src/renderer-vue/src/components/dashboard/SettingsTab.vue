<template>
  <div class="space-y-5">
    <!-- Device -->
    <section>
      <h3 class="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">📱 Device</h3>
      <div class="mb-2">
        <label class="block text-xs font-medium text-gray-600 mb-1" for="sDeviceName">Device name</label>
        <input id="sDeviceName" v-model="deviceName" type="text" class="input-field" placeholder="My device">
      </div>
      <button class="btn-secondary btn-small" @click="saveDeviceName">Save name</button>
    </section>

    <!-- Bandwidth -->
    <section>
      <h3 class="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">📡 Bandwidth Limit</h3>
      <div class="space-y-3">
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Upload limit</label>
          <div class="flex gap-2">
            <input v-model.number="uploadLimit" type="number" min="0" class="input-field flex-1" placeholder="0">
            <select v-model="uploadLimitUnit" class="input-field w-28">
              <option value="0">No limit</option>
              <option value="KB">KB/s</option>
              <option value="MB">MB/s</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Download limit</label>
          <div class="flex gap-2">
            <input v-model.number="downloadLimit" type="number" min="0" class="input-field flex-1" placeholder="0">
            <select v-model="downloadLimitUnit" class="input-field w-28">
              <option value="0">No limit</option>
              <option value="KB">KB/s</option>
              <option value="MB">MB/s</option>
            </select>
          </div>
        </div>
        <button class="btn-secondary btn-small" @click="saveBandwidth">Save limits</button>
      </div>
    </section>

    <!-- Sync Mode -->
    <section>
      <h3 class="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">🔄 Sync Mode</h3>
      <div class="space-y-2">
        <label
          v-for="mode in syncModes"
          :key="mode.value"
          class="flex items-start gap-2.5 p-2.5 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors"
        >
          <input type="radio" v-model="syncMode" :value="mode.value" class="mt-0.5 w-auto">
          <span class="flex flex-col">
            <strong class="text-sm text-gray-700">{{ mode.label }}</strong>
            <small class="text-[11px] text-gray-400">{{ mode.desc }}</small>
          </span>
        </label>
      </div>
      <button class="btn-small btn-primary mt-3" @click="doSyncNow">Sync Now</button>
    </section>

    <!-- Exclusions -->
    <section>
      <h3 class="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">📂 Excluded Files</h3>
      <div class="max-h-[120px] overflow-y-auto space-y-1 mb-2">
        <div
          v-for="(pattern, i) in exclusions"
          :key="i"
          class="flex items-center justify-between py-1.5 px-2.5 bg-gray-50 rounded-md text-xs"
        >
          <code class="bg-gray-200 py-0.5 px-1.5 rounded font-mono">{{ pattern }}</code>
          <button class="btn-icon bg-red-500 text-white hover:bg-red-600 w-6 h-6 text-[10px]" @click="removeExclusion(pattern)">✕</button>
        </div>
      </div>
      <div class="flex gap-2">
        <input v-model="newExclusion" type="text" class="input-field flex-1" placeholder="*.tmp, node_modules, etc." @keyup.enter="addExclusion">
        <button class="btn-secondary btn-small" @click="addExclusion">+ Add</button>
      </div>
    </section>

    <!-- Cache -->
    <section>
      <h3 class="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">💾 Offline Cache</h3>
      <div class="space-y-1 mb-3 text-xs">
        <div class="flex justify-between"><span class="text-gray-500">Cached files:</span><span class="font-medium text-gray-700">{{ cache.fileCount }}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Space used:</span><span class="font-medium text-gray-700">{{ cache.sizeLabel }}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Limit:</span><span class="font-medium text-gray-700">{{ cache.limitLabel }}</span></div>
      </div>
      <div class="h-2 bg-gray-200 rounded-full overflow-hidden mb-3">
        <div class="h-full bg-gradient-to-r from-brand-500 to-accent-500 transition-all duration-300" :style="{ width: cache.percent + '%' }"></div>
      </div>
      <div class="flex items-center justify-between">
        <label class="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" v-model="cacheEnabled" class="w-auto" @change="toggleCache">
          <span>Enable offline cache</span>
        </label>
        <button class="btn-secondary btn-small" @click="doClearCache">Clear cache</button>
      </div>
    </section>

    <!-- Danger Zone -->
    <section>
      <h3 class="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">⚠️ Danger zone</h3>
      <button class="btn-danger" @click="doLogout">Log out</button>
    </section>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'

const {
  config, getSettings, updateSettings, saveBandwidthLimits,
  addExclusionPattern, removeExclusionPattern,
  getCacheStats, clearCache, logout, syncNow,
  saveDevice,
} = useApp()
const toast = useToast()
const confirm = useConfirm()

const deviceName = ref('')
const uploadLimit = ref(0)
const uploadLimitUnit = ref('0')
const downloadLimit = ref(0)
const downloadLimitUnit = ref('0')
const syncMode = ref('automatic')
const exclusions = ref([])
const newExclusion = ref('')
const cacheEnabled = ref(true)
const cache = reactive({ fileCount: 0, sizeLabel: '0 B', limitLabel: '1 GB', percent: 0 })

const syncModes = [
  { value: 'automatic', label: 'Automatic', desc: 'Synchronize changes automatically' },
  { value: 'manual', label: 'Manual', desc: 'Synchronize only when requested' },
  { value: 'selective', label: 'Selective', desc: 'Choose which files to synchronize' },
]

onMounted(async () => {
  try {
    const settings = await getSettings()
    if (settings) {
      deviceName.value = config.device?.name || ''
      syncMode.value = settings.syncMode || 'automatic'
      exclusions.value = settings.exclusionPatterns || []
      cacheEnabled.value = settings.cacheEnabled !== false

      if (settings.uploadLimit) {
        const { value, unit } = parseBandwidth(settings.uploadLimit)
        uploadLimit.value = value
        uploadLimitUnit.value = unit
      }
      if (settings.downloadLimit) {
        const { value, unit } = parseBandwidth(settings.downloadLimit)
        downloadLimit.value = value
        downloadLimitUnit.value = unit
      }
    }
  } catch (e) { /* use defaults */ }

  await refreshCache()
})

function parseBandwidth(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return { value: 0, unit: '0' }
  if (bytesPerSec >= 1024 * 1024) return { value: Math.round(bytesPerSec / (1024 * 1024)), unit: 'MB' }
  return { value: Math.round(bytesPerSec / 1024), unit: 'KB' }
}

function toBytesPerSec(value, unit) {
  if (unit === '0' || !value) return 0
  if (unit === 'KB') return value * 1024
  if (unit === 'MB') return value * 1024 * 1024
  return 0
}

async function saveDeviceName() {
  try {
    await saveDevice(deviceName.value.trim())
    toast.success('Device name saved')
  } catch (e) {
    toast.error(e.message || 'Error saving name')
  }
}

async function saveBandwidth() {
  const up = toBytesPerSec(uploadLimit.value, uploadLimitUnit.value)
  const down = toBytesPerSec(downloadLimit.value, downloadLimitUnit.value)
  try {
    await saveBandwidthLimits(up, down)
    toast.success('Bandwidth limits saved')
  } catch (e) {
    toast.error(e.message || 'Error saving limits')
  }
}

async function doSyncNow() {
  try {
    await updateSettings({ syncMode: syncMode.value })
    await syncNow()
    toast.info('Sync started')
  } catch (e) {
    toast.error(e.message || 'Error syncing')
  }
}

async function addExclusion() {
  const p = newExclusion.value.trim()
  if (!p) return
  try {
    await addExclusionPattern(p)
    exclusions.value.push(p)
    newExclusion.value = ''
    toast.success(`Exclusion "${p}" added`)
  } catch (e) {
    toast.error(e.message || 'Error adding exclusion')
  }
}

async function removeExclusion(pattern) {
  try {
    await removeExclusionPattern(pattern)
    exclusions.value = exclusions.value.filter(p => p !== pattern)
  } catch (e) {
    toast.error(e.message || 'Error removing exclusion')
  }
}

async function refreshCache() {
  try {
    const stats = await getCacheStats()
    if (stats) {
      cache.fileCount = stats.fileCount || 0
      cache.sizeLabel = formatBytes(stats.size || 0)
      cache.limitLabel = formatBytes(stats.limit || 1024 * 1024 * 1024)
      cache.percent = stats.limit ? Math.min(100, Math.round(((stats.size || 0) / stats.limit) * 100)) : 0
    }
  } catch (e) { /* ignore */ }
}

async function toggleCache() {
  await updateSettings({ cacheEnabled: cacheEnabled.value })
}

async function doClearCache() {
  const ok = await confirm.ask({
    title: 'Clear cache',
    message: 'This will remove all cached files. Continue?',
    confirmLabel: 'Clear',
    danger: true,
  })
  if (!ok) return
  await clearCache()
  await refreshCache()
  toast.success('Cache cleared')
}

async function doLogout() {
  const ok = await confirm.ask({
    title: 'Log out',
    message: 'You will be disconnected from this device. Your files will not be deleted.',
    confirmLabel: 'Log out',
    danger: true,
  })
  if (!ok) return
  await logout()
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
</script>

<template>
  <div>
    <DeviceCard :device="config.device" />
    <StorageCard :used="storage.used" :total="storage.total" @upgrade="openUpgrade" />

    <!-- Tabs -->
    <div class="flex border-b-2 border-gray-100 mb-4">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="flex-1 py-2.5 text-center text-sm font-medium border-b-2 -mb-[2px] transition-all bg-transparent rounded-none cursor-pointer"
        :class="activeTab === tab.id
          ? 'text-brand-500 border-b-brand-500'
          : 'text-gray-400 border-b-transparent hover:text-brand-400'"
        @click="activeTab = tab.id"
      >{{ tab.label }}</button>
    </div>

    <!-- Tab Content -->
    <KeepAlive>
      <SyncTab     v-if="activeTab === 'sync'" />
      <BackupTab   v-else-if="activeTab === 'backup'" />
      <ActivityTab v-else-if="activeTab === 'activity'" />
      <SettingsTab v-else-if="activeTab === 'settings'" />
    </KeepAlive>

    <!-- Footer -->
    <div class="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between">
      <div class="flex items-center gap-2 text-xs text-gray-500">
        <div
          class="w-2 h-2 rounded-full"
          :class="indicatorClass"
        ></div>
        <span>{{ statusText }}</span>
      </div>
      <button class="btn-secondary btn-small" @click="openWeb">Open Web</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useApp } from '@/composables/useApp'
import DeviceCard from './DeviceCard.vue'
import StorageCard from './StorageCard.vue'
import SyncTab from './SyncTab.vue'
import BackupTab from './BackupTab.vue'
import ActivityTab from './ActivityTab.vue'
import SettingsTab from './SettingsTab.vue'

const { config, storage, isOnline, syncStatuses, openExternal } = useApp()

const activeTab = ref('sync')

const tabs = [
  { id: 'sync',     label: '🔄 Sync' },
  { id: 'backup',   label: '💾 Backup' },
  { id: 'activity', label: '📊 Activity' },
  { id: 'settings', label: '⚙️ Settings' },
]

const isSyncing = computed(() =>
  Object.values(syncStatuses).some(s => s?.syncing)
)

const indicatorClass = computed(() => {
  if (!isOnline.value) return 'bg-amber-400'
  if (isSyncing.value) return 'bg-blue-500 animate-pulse-dot'
  return 'bg-green-500'
})

const statusText = computed(() => {
  if (!isOnline.value) return 'Offline'
  if (isSyncing.value) return 'Syncing...'
  return 'Synchronized'
})

function openUpgrade() {
  openExternal(config.serverUrl + '/plans')
}

function openWeb() {
  openExternal(config.serverUrl)
}
</script>

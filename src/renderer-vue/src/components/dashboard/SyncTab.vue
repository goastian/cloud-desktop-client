<template>
  <div>
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-medium text-gray-700 flex items-center gap-2 m-0">📁 Synced folders</h3>
      <button class="btn-secondary btn-small" @click="addFolder">+ Add</button>
    </div>

    <div v-if="folders.length === 0">
      <EmptyState icon="📂" message="No folders are configured.">
        <button class="btn-small btn-primary" @click="addFolder">Add Folder</button>
      </EmptyState>
    </div>

    <div v-else class="max-h-[250px] overflow-y-auto space-y-2">
      <div
        v-for="folder in folders"
        :key="folder.id"
        class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
      >
        <span class="text-2xl flex-shrink-0">📂</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-gray-700 truncate">{{ folder.name || folderName(folder.path) }}</span>
            <StatusBadge :status="folderStatus(folder)" />
          </div>
          <div class="text-[11px] text-gray-400 truncate">{{ folder.path }}</div>
          <div v-if="folder.stats" class="text-[10px] text-gray-500 mt-0.5">
            {{ folder.stats.files || 0 }} files • {{ formatBytes(folder.stats.size || 0) }}
          </div>
        </div>
        <div class="flex gap-1.5">
          <button
            class="btn-icon bg-gray-200 text-gray-600 hover:bg-gray-300"
            :title="folder.enabled === false ? 'Enable' : 'Pause'"
            @click="toggle(folder)"
          >{{ folder.enabled === false ? '▶' : '⏸' }}</button>
          <button
            class="btn-icon bg-red-100 text-red-500 hover:bg-red-200"
            title="Remove"
            @click="remove(folder)"
          >✕</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'

const { config, syncStatuses, addSyncFolder, removeSyncFolder, toggleSyncFolder } = useApp()
const toast = useToast()
const confirm = useConfirm()

const folders = computed(() => config.syncFolders || [])

function folderName(p) {
  if (!p) return 'Folder'
  return p.split(/[\\/]/).filter(Boolean).pop() || 'Folder'
}

function folderStatus(folder) {
  if (folder.enabled === false) return 'disabled'
  const s = syncStatuses[folder.id]
  if (s?.syncing) return 'syncing'
  if (s?.paused) return 'paused'
  if (s?.error) return 'error'
  return 'synced'
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

async function addFolder() {
  try {
    const result = await addSyncFolder()
    if (result?.success) {
      toast.success('Folder added')
    } else if (result?.message) {
      toast.warning(result.message)
    }
  } catch (e) {
    toast.error(e.message || 'Error adding folder')
  }
}

async function toggle(folder) {
  try {
    await toggleSyncFolder(folder.id)
  } catch (e) {
    toast.error(e.message || 'Error toggling folder')
  }
}

async function remove(folder) {
  const ok = await confirm.ask({
    title: 'Remove folder',
    message: `Remove "${folderName(folder.path)}" from sync? Files will not be deleted.`,
    confirmLabel: 'Remove',
    danger: true,
  })
  if (!ok) return
  try {
    await removeSyncFolder(folder.id)
    toast.success('Folder removed')
  } catch (e) {
    toast.error(e.message || 'Error removing folder')
  }
}
</script>

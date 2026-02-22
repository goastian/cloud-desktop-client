<template>
  <div>
    <h3 class="text-base font-medium text-gray-700 mb-1 flex items-center gap-2">📁 Select folders to synchronize</h3>
    <p class="text-xs text-gray-500 mb-4">You can add multiple folders to sync with your cloud.</p>

    <div class="max-h-[250px] overflow-y-auto mb-3 space-y-2">
      <div
        v-for="folder in folders"
        :key="folder.id || folder.path"
        class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
      >
        <span class="text-2xl">📂</span>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-gray-700 truncate">{{ folder.name || folderName(folder.path) }}</div>
          <div class="text-[11px] text-gray-400 truncate">{{ folder.path }}</div>
        </div>
        <button class="btn-icon bg-red-500 text-white hover:bg-red-600" @click="remove(folder)">✕</button>
      </div>
    </div>

    <button class="btn-secondary mb-3 w-full" @click="addFolder">+ Add Folder</button>

    <button
      class="btn-primary"
      :disabled="folders.length === 0 || loading"
      @click="start"
    >
      {{ loading ? 'Starting...' : 'Start Sync' }}
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'

const emit = defineEmits(['done'])
const { addSyncFolder, removeSyncFolder, startSync, config, selectSyncFolder } = useApp()
const toast = useToast()

const folders = ref([...(config.syncFolders || [])])
const loading = ref(false)

function folderName(p) {
  if (!p) return 'Folder'
  return p.split(/[\\/]/).filter(Boolean).pop() || 'Folder'
}

async function addFolder() {
  try {
    const result = await addSyncFolder()
    if (result?.success && result.folder) {
      folders.value.push(result.folder)
    } else if (result?.message) {
      toast.warning(result.message)
    }
  } catch (e) {
    toast.error(e.message || 'Error adding folder')
  }
}

async function remove(folder) {
  try {
    if (folder.id) {
      await removeSyncFolder(folder.id)
    }
    folders.value = folders.value.filter(f => f !== folder)
  } catch (e) {
    toast.error(e.message || 'Error removing folder')
  }
}

async function start() {
  loading.value = true
  try {
    const result = await startSync()
    if (result?.success !== false) {
      emit('done')
    } else {
      toast.error(result?.message || 'Could not start sync')
    }
  } catch (e) {
    toast.error(e.message || 'Error starting sync')
  } finally {
    loading.value = false
  }
}
</script>

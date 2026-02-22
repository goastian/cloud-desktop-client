<template>
  <div>
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-medium text-gray-700 flex items-center gap-2 m-0">📊 Activity</h3>
      <button class="btn-secondary btn-small" @click="refresh">🔄</button>
    </div>

    <!-- Stats -->
    <div class="flex gap-2 mb-3">
      <div class="flex-1 bg-gray-50 rounded-lg p-3 text-center">
        <div class="text-xl font-bold text-brand-500">{{ activityStats.uploaded }}</div>
        <div class="text-[10px] text-gray-500">⬆️ Uploaded</div>
      </div>
      <div class="flex-1 bg-gray-50 rounded-lg p-3 text-center">
        <div class="text-xl font-bold text-brand-500">{{ activityStats.downloaded }}</div>
        <div class="text-[10px] text-gray-500">⬇️ Downloaded</div>
      </div>
      <div class="flex-1 bg-gray-50 rounded-lg p-3 text-center">
        <div class="text-xl font-bold text-brand-500">{{ activityStats.errors }}</div>
        <div class="text-[10px] text-gray-500">❌ Errors</div>
      </div>
    </div>

    <!-- Active Transfers -->
    <div v-if="activeTransfers.length > 0" class="bg-gray-50 rounded-lg p-2.5 mb-2">
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-[13px] font-medium text-gray-700 m-0">🔄 Active Transfers</h4>
        <button class="btn-small btn-danger" @click="cancelAll">Cancel All</button>
      </div>
      <div class="max-h-[150px] overflow-y-auto space-y-1.5">
        <TransferItem
          v-for="t in activeTransfers"
          :key="t.id"
          :transfer="t"
          @cancel="cancelOne(t.id)"
        />
      </div>
    </div>

    <!-- Pending Transfers -->
    <div v-if="pendingTransfers.length > 0" class="bg-gray-50 rounded-lg p-2.5 mb-2">
      <h4 class="text-[13px] font-medium text-gray-700 mb-2">⏳ Pending ({{ pendingTransfers.length }})</h4>
      <div class="max-h-[150px] overflow-y-auto space-y-1.5">
        <TransferItem
          v-for="t in pendingTransfers"
          :key="t.id"
          :transfer="t"
          @cancel="cancelOne(t.id)"
        />
      </div>
    </div>

    <!-- History -->
    <h4 class="text-[13px] font-medium text-gray-700 mt-3 mb-2">📜 History</h4>
    <div class="mb-3">
      <select v-model="filter" class="w-full py-2 px-3 border-2 border-gray-200 rounded-lg text-sm bg-white">
        <option value="all">All activities</option>
        <option value="upload">Uploads only</option>
        <option value="download">Downloads only</option>
        <option value="error">Errors only</option>
      </select>
    </div>

    <div v-if="filteredActivities.length === 0">
      <EmptyState icon="📊" message="No recent activity" />
    </div>
    <div v-else class="max-h-[200px] overflow-y-auto space-y-1.5 mb-3">
      <div
        v-for="a in filteredActivities"
        :key="a.id"
        class="flex items-start gap-2.5 p-2.5 bg-gray-50 rounded-lg"
      >
        <span class="text-lg flex-shrink-0">{{ activityIcon(a.type) }}</span>
        <div class="flex-1 min-w-0">
          <div class="text-xs font-medium text-gray-700 truncate">{{ a.fileName || a.path }}</div>
          <div class="text-[10px] text-gray-400 flex gap-2">
            <span>{{ formatBytes(a.size) }}</span>
            <span>{{ timeAgo(a.timestamp) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="flex gap-2 justify-end">
      <button class="btn-secondary btn-small" @click="clearHistory">Clear history</button>
      <button class="btn-secondary btn-small" @click="exportHistory">Export</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import EmptyState from '@/components/ui/EmptyState.vue'
import TransferItem from './TransferItem.vue'

const {
  transfers, activities, activityStats,
  refreshActivity, refreshTransfers,
  cancelTransfer, cancelAllTransfers, clearActivity,
} = useApp()
const toast = useToast()

const filter = ref('all')

const activeTransfers = computed(() =>
  transfers.value.filter(t => t.status === 'in_progress')
)
const pendingTransfers = computed(() =>
  transfers.value.filter(t => t.status === 'pending')
)

const filteredActivities = computed(() => {
  if (filter.value === 'all') return activities.value
  return activities.value.filter(a => a.type === filter.value)
})

function activityIcon(type) {
  return { upload: '⬆️', download: '⬇️', delete: '🗑️', error: '❌', conflict: '⚠️' }[type] || '📄'
}

function formatBytes(bytes) {
  if (!bytes) return ''
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

async function refresh() {
  await Promise.all([refreshActivity(), refreshTransfers()])
  toast.info('Activity refreshed')
}

async function cancelOne(id) {
  await cancelTransfer(id)
}

async function cancelAll() {
  await cancelAllTransfers()
  toast.info('All transfers cancelled')
}

async function clearHistory() {
  await clearActivity()
  toast.success('History cleared')
}

function exportHistory() {
  // Trigger export via IPC
  toast.info('Export not yet implemented')
}
</script>

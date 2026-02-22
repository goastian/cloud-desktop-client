<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="conflict" class="fixed inset-0 bg-black/50 z-[10002] flex items-center justify-center" @click.self="resolve('skip')">
        <div class="bg-white rounded-2xl p-5 w-[380px] shadow-2xl animate-scaleIn">
          <div class="flex items-center gap-2 mb-3">
            <span class="text-2xl">⚠️</span>
            <h3 class="text-base font-semibold text-gray-800 m-0">File Conflict</h3>
          </div>

          <p class="text-sm text-gray-500 mb-4 leading-relaxed">
            <strong class="text-gray-700">{{ conflict.fileName }}</strong> has been modified both locally and on the server.
          </p>

          <!-- Comparison -->
          <div class="grid grid-cols-2 gap-2 mb-4">
            <div class="bg-blue-50 rounded-lg p-3 text-center">
              <div class="text-xs text-blue-600 font-medium mb-1">💻 Local</div>
              <div class="text-sm font-semibold text-gray-700">{{ formatBytes(conflict.localSize) }}</div>
              <div class="text-[10px] text-gray-400 mt-0.5">{{ formatDate(conflict.localModified) }}</div>
            </div>
            <div class="bg-green-50 rounded-lg p-3 text-center">
              <div class="text-xs text-green-600 font-medium mb-1">☁️ Server</div>
              <div class="text-sm font-semibold text-gray-700">{{ formatBytes(conflict.serverSize) }}</div>
              <div class="text-[10px] text-gray-400 mt-0.5">{{ formatDate(conflict.serverModified) }}</div>
            </div>
          </div>

          <!-- Actions -->
          <div class="space-y-2">
            <button class="w-full btn-primary text-sm" @click="resolve('local')">
              ⬆️ Keep Local Version
            </button>
            <button class="w-full btn-secondary text-sm" @click="resolve('server')">
              ⬇️ Keep Server Version
            </button>
            <div class="flex gap-2">
              <button class="flex-1 btn-secondary btn-small" @click="resolve('both')">
                📄 Keep Both
              </button>
              <button class="flex-1 btn-secondary btn-small text-gray-400" @click="resolve('skip')">
                ⏭️ Skip
              </button>
            </div>
          </div>

          <!-- Timer -->
          <div class="text-center text-[10px] text-gray-400 mt-3">
            Auto-resolving in {{ countdown }}s (server version wins)
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { useElectron } from '@/composables/useElectron'

const { invoke, on } = useElectron()

const conflict = ref(null)
const countdown = ref(60)
let countdownTimer = null

// Listen for conflicts from main process
const unsub = on('conflict-detected', (data) => {
  conflict.value = data
  countdown.value = 60
  startCountdown()
})

onUnmounted(() => {
  if (unsub) unsub()
  clearInterval(countdownTimer)
})

function startCountdown() {
  clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) {
      resolve('server')
    }
  }, 1000)
}

async function resolve(resolution) {
  clearInterval(countdownTimer)
  if (conflict.value?.conflictId) {
    await invoke('resolve-conflict', conflict.value.conflictId, resolution)
  }
  conflict.value = null
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}
</script>

<style scoped>
.modal-enter-active { animation: fadeIn 0.15s ease; }
.modal-leave-active { animation: fadeIn 0.15s ease reverse; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.animate-scaleIn { animation: scaleIn 0.2s ease; }
@keyframes scaleIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
</style>

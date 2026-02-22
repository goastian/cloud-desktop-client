<template>
  <div class="bg-gray-50 rounded-xl p-3 px-4 mb-4 border border-gray-200">
    <div class="flex items-center gap-2 mb-2">
      <span class="text-base">💾</span>
      <span class="font-semibold text-sm text-gray-700 flex-1">Storage</span>
      <span class="text-xs text-brand-500 font-semibold">{{ usedLabel }} / {{ totalLabel }}</span>
    </div>
    <div class="h-2 bg-gray-200 rounded-full overflow-hidden mb-1.5">
      <div
        class="h-full rounded-full transition-all duration-500"
        :class="barClass"
        :style="{ width: percent + '%' }"
      ></div>
    </div>
    <div class="text-[11px] text-gray-400 text-center">
      {{ usedLabel }} of {{ totalLabel }} used
    </div>
    <button
      class="w-full mt-2.5 py-2.5 px-4 bg-gradient-to-br from-amber-400 to-red-500 text-white border-none rounded-lg text-sm font-semibold cursor-pointer transition-all duration-200 flex items-center justify-center gap-1.5 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-red-500/40 active:translate-y-0"
      @click="$emit('upgrade')"
    >
      ⭐ Upgrade Plan
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  used: { type: Number, default: 0 },
  total: { type: Number, default: 10 * 1024 * 1024 * 1024 },
})

defineEmits(['upgrade'])

const percent = computed(() => {
  if (!props.total) return 0
  return Math.min(100, Math.round((props.used / props.total) * 100))
})

const barClass = computed(() => {
  if (percent.value >= 90) return 'bg-gradient-to-r from-red-500 to-red-600'
  if (percent.value >= 75) return 'bg-gradient-to-r from-amber-400 to-red-500'
  return 'bg-gradient-to-br from-brand-500 to-accent-500'
})

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const usedLabel = computed(() => formatBytes(props.used))
const totalLabel = computed(() => formatBytes(props.total))
</script>

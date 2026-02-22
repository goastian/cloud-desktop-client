<template>
  <div
    class="flex items-center gap-2.5 p-2 bg-white rounded-md border border-gray-200"
    :class="{
      'border-l-[3px] border-l-blue-500': transfer.status === 'in_progress',
      'border-l-[3px] border-l-orange-400 opacity-80': transfer.status === 'pending',
    }"
  >
    <span class="text-base flex-shrink-0">{{ icon }}</span>
    <div class="flex-1 min-w-0">
      <div class="text-xs font-medium text-gray-700 truncate">{{ transfer.fileName || 'File' }}</div>
      <div class="flex items-center gap-2 text-[10px] text-gray-400">
        <span v-if="transfer.status === 'in_progress' && transfer.progress != null">
          {{ transfer.progress }}%
        </span>
        <div v-if="transfer.status === 'in_progress'" class="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden min-w-[60px]">
          <div
            class="h-full bg-gradient-to-r from-brand-500 to-accent-500 rounded-full transition-all duration-300"
            :style="{ width: (transfer.progress || 0) + '%' }"
          ></div>
        </div>
        <span v-else>{{ transfer.status }}</span>
      </div>
    </div>
    <button
      class="btn-icon bg-red-500 text-white hover:bg-red-600 text-[10px]"
      title="Cancel"
      @click="$emit('cancel')"
    >✕</button>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  transfer: { type: Object, required: true },
})

defineEmits(['cancel'])

const icon = computed(() => {
  return props.transfer.type === 'download' ? '⬇️' : '⬆️'
})
</script>

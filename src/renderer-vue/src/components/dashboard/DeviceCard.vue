<template>
  <div class="bg-gradient-to-br from-brand-500 to-accent-500 rounded-xl p-4 text-white mb-4">
    <h4 class="text-sm opacity-90 mb-1">Connected device</h4>
    <div class="text-lg font-semibold mb-2">{{ deviceName }}</div>
    <div class="text-[11px] opacity-80">{{ deviceInfo }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  device: { type: Object, default: () => ({}) },
})

const deviceName = computed(() => props.device?.name || 'My Device')
const deviceInfo = computed(() => {
  const platform = props.device?.platform || 'Desktop'
  return `${platform} • Connected`
})
</script>

<template>
  <div
    class="border-3 border-gray-200 border-t-brand-500 rounded-full animate-spin-slow mx-auto"
    :class="sizeClass"
  ></div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  size: { type: String, default: 'md' },
})

const sizeClass = computed(() => ({
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-[3px]',
  lg: 'w-10 h-10 border-4',
}[props.size] || 'w-6 h-6 border-[3px]'))
</script>

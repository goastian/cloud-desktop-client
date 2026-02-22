<template>
  <div class="text-center py-8 px-5 text-gray-400">
    <div class="text-5xl mb-3">{{ icon }}</div>
    <p class="text-sm mb-4">{{ message }}</p>
    <slot />
  </div>
</template>

<script setup>
defineProps({
  icon: { type: String, default: '📂' },
  message: { type: String, default: 'Nothing here yet' },
})
</script>

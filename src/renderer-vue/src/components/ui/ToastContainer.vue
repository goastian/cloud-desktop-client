<template>
  <Teleport to="body">
    <div class="fixed top-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none">
      <TransitionGroup name="toast">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="pointer-events-auto flex items-center gap-2.5 py-3 px-4 rounded-xl bg-white shadow-lg text-sm text-gray-700 min-w-[260px] max-w-[360px] border-l-4"
          :class="borderClass(t.type)"
        >
          <span class="text-lg flex-shrink-0">{{ t.icon }}</span>
          <span class="flex-1 leading-snug">{{ t.message }}</span>
          <button
            class="bg-transparent border-none cursor-pointer text-gray-400 hover:text-gray-700 p-0 text-base w-auto"
            @click="dismiss(t.id)"
          >&times;</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { useToast } from '@/composables/useToast'

const { toasts, dismiss } = useToast()

function borderClass(type) {
  return {
    success: 'border-l-green-500',
    error: 'border-l-red-500',
    warning: 'border-l-amber-500',
    info: 'border-l-brand-500',
  }[type] || 'border-l-brand-500'
}
</script>

<style scoped>
.toast-enter-active { animation: toastIn 0.3s ease forwards; }
.toast-leave-active { animation: toastOut 0.25s ease forwards; }
@keyframes toastIn {
  from { opacity: 0; transform: translateX(40px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes toastOut {
  from { opacity: 1; transform: translateX(0); }
  to   { opacity: 0; transform: translateX(40px); }
}
</style>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="fixed inset-0 bg-black/40 z-[10001] flex items-center justify-center" @click.self="cancel">
        <div class="bg-white rounded-2xl p-6 w-[340px] shadow-2xl animate-scaleIn">
          <h3 class="text-base font-semibold text-gray-800 mb-2">{{ title }}</h3>
          <p class="text-sm text-gray-500 mb-5 leading-relaxed">{{ message }}</p>
          <div class="flex gap-2.5 justify-end">
            <button class="btn-secondary btn-small" @click="cancel">Cancel</button>
            <button
              :class="danger ? 'btn-danger btn-small' : 'btn-primary btn-small'"
              @click="confirm"
            >{{ confirmLabel }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { useConfirm } from '@/composables/useConfirm'

const { visible, title, message, confirmLabel, danger, confirm, cancel } = useConfirm()
</script>

<style scoped>
.modal-enter-active { animation: fadeIn 0.15s ease; }
.modal-leave-active { animation: fadeIn 0.15s ease reverse; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.animate-scaleIn { animation: scaleIn 0.2s ease; }
@keyframes scaleIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
</style>

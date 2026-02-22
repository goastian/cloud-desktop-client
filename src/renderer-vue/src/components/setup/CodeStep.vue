<template>
  <div>
    <div class="bg-blue-50 border-l-4 border-brand-500 p-3 rounded-lg mb-4 text-xs text-gray-600 leading-relaxed">
      <strong>📱 Connect your device:</strong>
      <ol class="ml-4 mt-2 list-decimal space-y-1">
        <li>Open Astian Cloud in your browser.</li>
        <li>Go to <strong>Menu Settings → Devices</strong></li>
        <li>Enter this code:</li>
      </ol>
    </div>

    <div class="bg-gray-50 border-2 border-dashed border-brand-500 rounded-xl py-6 px-4 text-center my-4">
      <div class="text-xs text-gray-500 mb-1">Linking Code</div>
      <div class="text-4xl font-bold text-brand-500 tracking-[6px] font-mono">{{ displayCode }}</div>
    </div>

    <Spinner v-if="polling" class="my-4" />
    <p v-if="polling" class="text-center text-sm text-gray-500">Awaiting approval...</p>

    <p v-if="errorMsg" class="text-xs text-red-500 bg-red-50 border-l-4 border-red-400 p-2.5 rounded-lg mb-3">{{ errorMsg }}</p>

    <button class="btn-secondary mt-4" @click="cancelPolling">Cancel</button>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useApp } from '@/composables/useApp'
import Spinner from '@/components/ui/Spinner.vue'

const emit = defineEmits(['next', 'back'])
const props = defineProps({
  email: { type: String, required: true },
})

const { generatePairingCode, verifyPairingCode } = useApp()

const code = ref('------')
const polling = ref(false)
const errorMsg = ref('')
let pollTimeout = null
let attempts = 0
const MAX_ATTEMPTS = 30
const BASE_DELAY = 3000
const MULTIPLIER = 1.3
const MAX_DELAY = 15000

const displayCode = computed(() => code.value)

onMounted(async () => {
  try {
    const result = await generatePairingCode(props.email)
    if (result?.success && result.code) {
      code.value = result.code
      startPolling()
    } else {
      errorMsg.value = result?.message || 'Could not generate pairing code'
    }
  } catch (e) {
    errorMsg.value = e.message || 'Error generating code'
  }
})

onUnmounted(() => {
  clearTimeout(pollTimeout)
})

function startPolling() {
  polling.value = true
  attempts = 0
  poll()
}

async function poll() {
  if (attempts >= MAX_ATTEMPTS) {
    polling.value = false
    errorMsg.value = 'Pairing timed out. Please try again.'
    return
  }

  try {
    const result = await verifyPairingCode(code.value)
    if (result?.approved) {
      polling.value = false
      emit('next')
      return
    }
  } catch (e) {
    // continue polling
  }

  attempts++
  const delay = Math.min(BASE_DELAY * Math.pow(MULTIPLIER, attempts), MAX_DELAY)
  pollTimeout = setTimeout(poll, delay)
}

function cancelPolling() {
  clearTimeout(pollTimeout)
  polling.value = false
  emit('back')
}
</script>

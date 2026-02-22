<template>
  <div>
    <h2 class="text-lg font-semibold text-gray-800 mb-2">Connect to the Server</h2>
    <p class="text-sm text-gray-500 mb-4">Enter the URL of your Astian Cloud server</p>

    <!-- Environment toggle (dev mode only) -->
    <div v-if="isDev" class="bg-gray-50 rounded-lg p-3 mb-4">
      <label class="flex items-center justify-between gap-3 cursor-pointer">
        <span
          class="text-sm font-semibold py-1 px-2.5 rounded-xl"
          :class="isProduction ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'"
        >{{ isProduction ? '🌐 Production' : '🛠️ Development' }}</span>
        <label class="relative w-10 h-[22px] inline-block">
          <input type="checkbox" v-model="devMode" class="sr-only peer" @change="onEnvToggle">
          <span class="absolute inset-0 bg-gray-300 rounded-full transition peer-checked:bg-gradient-to-br peer-checked:from-brand-500 peer-checked:to-accent-500 cursor-pointer"></span>
          <span class="absolute left-[3px] bottom-[3px] w-4 h-4 bg-white rounded-full transition peer-checked:translate-x-[18px]"></span>
        </label>
        <span class="text-xs text-gray-400">Dev Mode</span>
      </label>
    </div>

    <div class="mb-4">
      <label class="block text-sm font-medium text-gray-700 mb-1.5" for="serverUrl">Server URL</label>
      <input
        id="serverUrl"
        v-model="serverUrl"
        type="text"
        class="input-field"
        placeholder="https://cloud.example.com"
        :disabled="loading"
        @keyup.enter="connect"
      >
    </div>

    <p v-if="errorMsg" class="text-xs text-red-500 bg-red-50 border-l-4 border-red-400 p-2.5 rounded-lg mb-3">{{ errorMsg }}</p>

    <button class="btn-primary" :disabled="loading || !serverUrl.trim()" @click="connect">
      <span v-if="loading">Connecting...</span>
      <span v-else>Connect</span>
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useApp } from '@/composables/useApp'

const emit = defineEmits(['next'])
const { connectServer, config, getEnvironment, toggleEnvironment } = useApp()

const serverUrl = ref(config.serverUrl || 'https://cloud2.astian.org')
const loading = ref(false)
const errorMsg = ref('')
const isDev = ref(config._isDev || false)
const devMode = ref(false)
const isProduction = ref(true)

async function onEnvToggle() {
  const result = await toggleEnvironment()
  if (result?.environment) {
    isProduction.value = result.environment === 'production'
    if (result.serverUrl) serverUrl.value = result.serverUrl
  }
}

async function connect() {
  errorMsg.value = ''
  loading.value = true
  try {
    const result = await connectServer(serverUrl.value.trim())
    if (result?.success) {
      emit('next')
    } else {
      errorMsg.value = result?.message || 'Could not connect to the server'
    }
  } catch (e) {
    errorMsg.value = e.message || 'Connection error'
  } finally {
    loading.value = false
  }
}
</script>

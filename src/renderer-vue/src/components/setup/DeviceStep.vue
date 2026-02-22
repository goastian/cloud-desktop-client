<template>
  <div>
    <div class="bg-green-50 border-l-4 border-green-400 p-2.5 rounded-lg text-xs text-green-700 mb-4">
      ✓ Device successfully linked!
    </div>

    <h3 class="text-base font-medium text-gray-700 mb-3 flex items-center gap-2">📱 Set up your device</h3>

    <div class="mb-4">
      <label class="block text-sm font-medium text-gray-700 mb-1.5" for="deviceName">Device name</label>
      <input
        id="deviceName"
        v-model="name"
        type="text"
        class="input-field"
        placeholder="My work PC"
        :disabled="loading"
        @keyup.enter="save"
      >
      <p class="text-[11px] text-gray-400 mt-1">
        This name will help you identify which device the files were uploaded from.
      </p>
    </div>

    <button class="btn-primary" :disabled="loading || !name.trim()" @click="save">
      {{ loading ? 'Saving...' : 'Continue' }}
    </button>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useApp } from '@/composables/useApp'

const emit = defineEmits(['next'])
const { saveDevice, getDeviceInfo } = useApp()

const name = ref('')
const loading = ref(false)

onMounted(async () => {
  try {
    const info = await getDeviceInfo()
    if (info?.name) name.value = info.name
  } catch (e) { /* use empty */ }
})

async function save() {
  loading.value = true
  try {
    await saveDevice(name.value.trim())
    emit('next')
  } finally {
    loading.value = false
  }
}
</script>

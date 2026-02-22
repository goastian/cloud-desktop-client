<template>
  <div>
    <h2 class="text-lg font-semibold text-gray-800 mb-2">User Identification</h2>
    <p class="text-sm text-gray-500 mb-4">Enter your registered email address</p>

    <div class="mb-4">
      <label class="block text-sm font-medium text-gray-700 mb-1.5" for="userEmail">Email</label>
      <input
        id="userEmail"
        v-model="email"
        type="email"
        class="input-field"
        placeholder="your-email@example.com"
        autocomplete="email"
        :disabled="loading"
        @keyup.enter="validate"
      >
    </div>

    <p v-if="errorMsg" class="text-xs text-red-500 bg-red-50 border-l-4 border-red-400 p-2.5 rounded-lg mb-3">{{ errorMsg }}</p>
    <p v-if="infoMsg" class="text-xs text-blue-600 bg-blue-50 border-l-4 border-blue-400 p-2.5 rounded-lg mb-3">{{ infoMsg }}</p>

    <div class="flex gap-2.5 mt-4">
      <button class="btn-secondary flex-1" @click="$emit('back')">Back</button>
      <button class="btn-primary flex-1" :disabled="loading || !email.trim()" @click="validate">
        {{ loading ? 'Validating...' : 'Continue' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useApp } from '@/composables/useApp'

const emit = defineEmits(['next', 'back'])
const { validateEmail } = useApp()

const email = ref('')
const loading = ref(false)
const errorMsg = ref('')
const infoMsg = ref('')

async function validate() {
  errorMsg.value = ''
  infoMsg.value = ''
  loading.value = true
  try {
    const result = await validateEmail(email.value.trim())
    if (result?.success) {
      emit('next', email.value.trim())
    } else if (result?.needsRegistration) {
      infoMsg.value = result.message || 'You need to register first at the web portal.'
    } else {
      errorMsg.value = result?.message || 'Could not validate email'
    }
  } catch (e) {
    errorMsg.value = e.message || 'Validation error'
  } finally {
    loading.value = false
  }
}
</script>

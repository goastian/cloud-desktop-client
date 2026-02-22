<template>
  <div class="card" v-if="currentView !== 'loading'">
    <!-- Logo -->
    <div class="text-center mb-6">
      <h1 class="text-2xl font-bold text-brand-500 mb-1">☁️ Astian Cloud</h1>
      <p class="text-sm text-gray-400">Desktop Sync Client</p>
    </div>

    <!-- Setup Flow -->
    <template v-if="currentView === 'setup'">
      <Transition name="slide" mode="out-in">
        <ServerStep  v-if="setupStep === 'server'"  key="server"  @next="setupStep = 'email'" />
        <EmailStep   v-else-if="setupStep === 'email'"   key="email"   @next="onEmailDone" @back="setupStep = 'server'" />
        <CodeStep    v-else-if="setupStep === 'code'"    key="code"    :email="userEmail" @next="setupStep = 'device'" @back="setupStep = 'email'" />
        <DeviceStep  v-else-if="setupStep === 'device'"  key="device"  @next="setupStep = 'folder'" />
        <FolderStep  v-else-if="setupStep === 'folder'"  key="folder"  @done="onSetupComplete" />
      </Transition>
    </template>

    <!-- Dashboard -->
    <DashboardView v-else-if="currentView === 'dashboard'" />
  </div>

  <!-- Loading -->
  <div v-else class="card flex flex-col items-center justify-center py-16">
    <Spinner size="lg" />
    <p class="text-sm text-gray-400 mt-4">Loading...</p>
  </div>

  <!-- Global UI -->
  <ToastContainer />
  <ConfirmModal />
  <ConflictModal />
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useApp } from '@/composables/useApp'

import ServerStep from '@/components/setup/ServerStep.vue'
import EmailStep from '@/components/setup/EmailStep.vue'
import CodeStep from '@/components/setup/CodeStep.vue'
import DeviceStep from '@/components/setup/DeviceStep.vue'
import FolderStep from '@/components/setup/FolderStep.vue'
import DashboardView from '@/components/dashboard/DashboardView.vue'
import Spinner from '@/components/ui/Spinner.vue'
import ToastContainer from '@/components/ui/ToastContainer.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import ConflictModal from '@/components/ui/ConflictModal.vue'

const { currentView, setupStep, init, setupListeners, teardownListeners } = useApp()

const userEmail = ref('')

function onEmailDone(email) {
  userEmail.value = email
  setupStep.value = 'code'
}

function onSetupComplete() {
  currentView.value = 'dashboard'
}

onMounted(() => {
  setupListeners()
  init()
})

onUnmounted(() => {
  teardownListeners()
})
</script>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: all 0.25s ease;
}
.slide-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.slide-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}
</style>

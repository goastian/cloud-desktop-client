import { ref } from 'vue'

const toasts = ref([])
let toastId = 0

const ICONS = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
}

export function useToast() {
  function show(message, type = 'info', duration = 3500) {
    const id = ++toastId
    toasts.value.push({ id, message, type, icon: ICONS[type] || ICONS.info, removing: false })

    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
    return id
  }

  function dismiss(id) {
    const t = toasts.value.find(t => t.id === id)
    if (t) {
      t.removing = true
      setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id)
      }, 250)
    }
  }

  function success(msg, duration) { return show(msg, 'success', duration) }
  function error(msg, duration)   { return show(msg, 'error', duration) }
  function warning(msg, duration) { return show(msg, 'warning', duration) }
  function info(msg, duration)    { return show(msg, 'info', duration) }

  return { toasts, show, dismiss, success, error, warning, info }
}

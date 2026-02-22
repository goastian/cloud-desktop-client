import { ref } from 'vue'

const visible = ref(false)
const title = ref('')
const message = ref('')
const confirmLabel = ref('Confirm')
const danger = ref(false)
let resolvePromise = null

export function useConfirm() {
  function ask(opts = {}) {
    title.value = opts.title || 'Confirm'
    message.value = opts.message || 'Are you sure?'
    confirmLabel.value = opts.confirmLabel || 'Confirm'
    danger.value = !!opts.danger
    visible.value = true

    return new Promise((resolve) => {
      resolvePromise = resolve
    })
  }

  function confirm() {
    visible.value = false
    if (resolvePromise) resolvePromise(true)
    resolvePromise = null
  }

  function cancel() {
    visible.value = false
    if (resolvePromise) resolvePromise(false)
    resolvePromise = null
  }

  return { visible, title, message, confirmLabel, danger, ask, confirm, cancel }
}

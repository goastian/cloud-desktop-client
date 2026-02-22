/**
 * Composable to access the Electron IPC bridge exposed via preload.js.
 * Provides invoke() for request/response and on()/off() for event listeners.
 */
export function useElectron() {
  const api = window.electronAPI

  if (!api) {
    console.warn('[useElectron] electronAPI not available — running outside Electron?')
    return {
      invoke: async () => null,
      on: () => {},
      off: () => {},
      available: false,
    }
  }

  return {
    invoke: api.invoke,
    on: api.on,
    off: api.off,
    available: true,
  }
}

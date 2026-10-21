import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { ButtonServiceStatus } from '@shared/devices'
import { formatUsbId, type UsbId } from '@/lib/camera-info'

type ButtonListener = (pressed: boolean) => void

/**
 * Photo buttons of USB cameras (UVC still-image button). Windows' camera driver keeps them to
 * itself, so they come from the "CameraDraw Buttons" background service (`service/`).
 */
export const useButtonsStore = defineStore('buttons', () => {
  const status = ref<ButtonServiceStatus | null>(null)
  /** Install/uninstall in progress. */
  const pending = ref<'install' | 'uninstall' | null>(null)
  /** `vid:pid` → listeners. Only devices with listeners are watched by the service. */
  const listeners = new Map<string, Set<ButtonListener>>()

  window.api.buttons.onStatus((value) => (status.value = value))
  window.api.buttons.onPress((event) => {
    for (const listener of listeners.get(formatUsbId(event)) ?? []) listener(event.pressed)
  })
  void refresh()

  async function refresh(): Promise<void> {
    status.value = await window.api.buttons.status()
  }

  function syncWatch(): void {
    window.api.buttons.watch(
      [...listeners.keys()].map((key) => {
        const [vendorId, productId] = key.split(':')
        return { vendorId, productId }
      })
    )
  }

  /** Reports presses and releases of a device's photo button. Returns an unsubscribe function. */
  function listen(usb: UsbId, listener: ButtonListener): () => void {
    const key = formatUsbId(usb)
    const set = listeners.get(key) ?? new Set()
    listeners.set(key, set)
    set.add(listener)
    syncWatch()
    return () => {
      set.delete(listener)
      if (!set.size) listeners.delete(key)
      syncWatch()
    }
  }

  async function run(action: 'install' | 'uninstall'): Promise<void> {
    pending.value = action
    try {
      status.value = await window.api.buttons[action]()
    } finally {
      pending.value = null
    }
  }

  return {
    status,
    pending,
    refresh,
    listen,
    install: () => run('install'),
    uninstall: () => run('uninstall')
  }
})

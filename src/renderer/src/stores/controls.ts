import { defineStore } from 'pinia'
import { formatUsbId, type UsbId } from '@/lib/camera-info'

type BrightnessListener = (value: number) => void

/**
 * UVC brightness of USB cameras, read regularly by the main process (`cameradraw-buttons
 * brightness`, no service needed). Some cameras report buttons through it – see the device modules.
 */
export const useControlsStore = defineStore('controls', () => {
  /** `vid:pid` → listeners. Only devices with listeners are read. */
  const listeners = new Map<string, Set<BrightnessListener>>()

  window.api.controls.onBrightness((event) => {
    for (const listener of listeners.get(formatUsbId(event)) ?? []) listener(event.value)
  })

  function syncWatch(): void {
    window.api.controls.watchBrightness(
      [...listeners.keys()].map((key) => {
        const [vendorId, productId] = key.split(':')
        return { vendorId, productId }
      })
    )
  }

  // Drops readers left over from before a reload of the window.
  syncWatch()

  /** Reports the device's brightness value – first the current one, then every change. */
  function listenBrightness(usb: UsbId, listener: BrightnessListener): () => void {
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

  return { listenBrightness }
})

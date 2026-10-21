import { shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { useDebounceFn } from '@vueuse/core'
import type { SystemCamera } from '@shared/devices'
import { classifyCamera, type CameraConnection } from '@/lib/camera-info'
import { useCameraStore } from './camera'

/** What the operating system knows about the cameras – used to tell physical from virtual ones. */
export const useHardwareStore = defineStore('hardware', () => {
  const camera = useCameraStore()

  /** Cameras registered with the OS; null until loaded or on platforms without the query. */
  const systemCameras = shallowRef<SystemCamera[] | null>(null)
  let initialized = false

  async function refresh(): Promise<void> {
    systemCameras.value = await window.api.devices.systemCameras()
  }

  const refreshDebounced = useDebounceFn(refresh, 500)

  function init(): void {
    if (initialized) return
    initialized = true
    // Re-query whenever cameras come or go.
    watch(
      () => camera.devices.map((d) => d.label).join('\n'),
      () => void refreshDebounced(),
      { immediate: true }
    )
  }

  const connectionOf = (label: string): CameraConnection =>
    classifyCamera(label, systemCameras.value)

  return { systemCameras, init, refresh, connectionOf }
})

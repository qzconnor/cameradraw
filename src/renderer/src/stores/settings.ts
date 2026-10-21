import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AppSettings, AppState } from '@shared/types'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings | null>(null)
  const saveDirAvailable = ref(false)

  const loaded = computed(() => settings.value !== null)
  /** First start, or the configured folder disappeared → the setup dialog is required. */
  const needsSetup = computed(() => loaded.value && !saveDirAvailable.value)
  const saveDir = computed(() => settings.value?.saveDir ?? null)
  const mirror = computed(() => settings.value?.mirror ?? false)
  const ambientLight = computed(() => settings.value?.ambientLight ?? true)
  const preferCameraZoom = computed(() => settings.value?.preferCameraZoom ?? true)
  const disabledModules = computed(() => settings.value?.disabledModules ?? [])
  const cameraModules = computed(() => settings.value?.cameraModules ?? {})

  function apply(state: AppState): void {
    settings.value = state.settings
    saveDirAvailable.value = state.saveDirAvailable
  }

  async function load(): Promise<void> {
    apply(await window.api.settings.get())
  }

  async function update(patch: Partial<AppSettings>): Promise<void> {
    // Optimistic, so toggles (gallery, mirror) react instantly; reverted if the main process refuses.
    if (settings.value) settings.value = { ...settings.value, ...patch }
    try {
      apply(await window.api.settings.update(patch))
    } catch (err) {
      await load()
      throw err
    }
  }

  return {
    settings,
    saveDirAvailable,
    loaded,
    needsSetup,
    saveDir,
    mirror,
    ambientLight,
    preferCameraZoom,
    disabledModules,
    cameraModules,
    load,
    update
  }
})

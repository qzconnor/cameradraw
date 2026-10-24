import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { CameraControlSettings } from '@shared/camera-controls'
import { DEFAULT_MCP_PORT } from '@shared/mcp'
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
  const stopCameraWhenHidden = computed(() => settings.value?.stopCameraWhenHidden ?? true)
  const disabledModules = computed(() => settings.value?.disabledModules ?? [])
  const cameraModules = computed(() => settings.value?.cameraModules ?? {})
  const cameraScales = computed(() => settings.value?.cameraScales ?? {})
  const cameraControls = computed(() => settings.value?.cameraControls ?? {})
  const mcpEnabled = computed(() => settings.value?.mcpEnabled ?? false)
  const mcpTransport = computed(() => settings.value?.mcpTransport ?? 'http')
  const mcpPort = computed(() => settings.value?.mcpPort ?? DEFAULT_MCP_PORT)

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

  /** Changes what is stored for one camera; an entry left with nothing in it is dropped. */
  async function updateCameraControls(
    label: string,
    change: (entry: CameraControlSettings) => CameraControlSettings
  ): Promise<void> {
    const map = { ...cameraControls.value }
    const entry = change(map[label] ?? { values: {}, originals: {} })
    const empty =
      !entry.resolution && !Object.keys(entry.values).length && !Object.keys(entry.originals).length
    if (empty) delete map[label]
    else map[label] = entry
    await update({ cameraControls: map })
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
    stopCameraWhenHidden,
    disabledModules,
    cameraModules,
    cameraScales,
    cameraControls,
    mcpEnabled,
    mcpTransport,
    mcpPort,
    load,
    update,
    updateCameraControls
  }
})

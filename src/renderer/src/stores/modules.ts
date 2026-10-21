import { computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { parseUsbId } from '@/lib/camera-info'
import { DEVICE_MODULES, findModule, matchModule, type DeviceModule } from '@/modules'
import { useButtonsStore } from './buttons'
import { useCameraStore } from './camera'
import { useControlsStore } from './controls'
import { useSettingsStore } from './settings'

/** `auto`: matched by USB id · `none`: no module · otherwise a module id. */
export type ModuleAssignment = 'auto' | 'none' | (string & {})

/**
 * in-use – applied to the chosen camera
 * ready  – switched on, waiting for a matching camera
 * off    – switched off by the user
 */
export type ModuleUsage = 'in-use' | 'ready' | 'off'

export const useModulesStore = defineStore('modules', () => {
  const settings = useSettingsStore()
  const camera = useCameraStore()

  const isEnabled = (id: string): boolean => !settings.disabledModules.includes(id)

  const assignmentFor = (label: string): ModuleAssignment => settings.cameraModules[label] ?? 'auto'

  /** Module that would be picked automatically for a camera (by USB id). */
  function autoModuleFor(label: string): DeviceModule | null {
    const usb = parseUsbId(label)
    return (usb && matchModule(usb)) || null
  }

  /** Module assigned to a camera, regardless of whether it is switched on. */
  function assignedModule(label: string): DeviceModule | null {
    const assignment = assignmentFor(label)
    if (assignment === 'auto') return autoModuleFor(label)
    if (assignment === 'none') return null
    return findModule(assignment) ?? null
  }

  /** Module that is actually applied to a camera (assigned and switched on). */
  function moduleFor(label: string | null): DeviceModule | null {
    const module = label ? assignedModule(label) : null
    return module && isEnabled(module.id) ? module : null
  }

  /** Label of the chosen camera – also while it is disconnected. */
  const currentLabel = computed(() => camera.selectedDevice?.label ?? camera.selectedLabel)
  const activeModule = computed(() => moduleFor(currentLabel.value))

  function usageOf(id: string): ModuleUsage {
    if (!isEnabled(id)) return 'off'
    return activeModule.value?.id === id ? 'in-use' : 'ready'
  }

  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    const disabled = new Set(settings.disabledModules)
    if (enabled) disabled.delete(id)
    else disabled.add(id)
    await settings.update({ disabledModules: [...disabled] })
  }

  async function assign(label: string, assignment: ModuleAssignment): Promise<void> {
    const map = { ...settings.cameraModules }
    if (assignment === 'auto') delete map[label]
    else map[label] = assignment
    await settings.update({ cameraModules: map })
  }

  // Run the active module's hooks while its camera is live and not paused (no device buttons then).
  watch(
    [activeModule, () => camera.status === 'live' && !camera.paused, currentLabel],
    ([module, live, label], _previous, onCleanup) => {
      if (!module?.activate || !live || !label) return
      const usb = parseUsbId(label)
      // A camera assigned by hand may have no USB id in its label – use the module's device then.
      const device = usb ?? module.match[0]
      onCleanup(
        module.activate({
          cameraLabel: label,
          usb,
          capture: camera.requestCapture,
          zoom: camera.stepZoom,
          onPhotoButton: (listener) =>
            device ? useButtonsStore().listen(device, listener) : () => undefined,
          onBrightness: (listener) =>
            device ? useControlsStore().listenBrightness(device, listener) : () => undefined
        })
      )
    },
    { immediate: true }
  )

  return {
    modules: DEVICE_MODULES,
    isEnabled,
    assignmentFor,
    autoModuleFor,
    assignedModule,
    moduleFor,
    currentLabel,
    activeModule,
    usageOf,
    setEnabled,
    assign
  }
})

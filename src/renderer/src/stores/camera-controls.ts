import { computed, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  AUTO_CONTROL_NAMES,
  AUTO_CONTROLS,
  VALUE_CONTROLS,
  type AutoControl,
  type CameraControlName,
  type CameraControlValues,
  type ControlMode,
  type ValueControl
} from '@shared/camera-controls'
import { CONTROL_LABELS } from '@/lib/camera-controls'
import { useCameraStore } from './camera'
import { useModulesStore } from './modules'
import { useSettingsStore } from './settings'

export interface ControlRange {
  min: number
  max: number
  step: number
}

/** A picture control of the live camera that CameraDraw can set. */
export type CameraControl =
  | { kind: 'value'; name: ValueControl; range: ControlRange }
  /** `range`: of the value used in manual mode, null if the camera only offers the modes. */
  | { kind: 'auto'; name: AutoControl; range: ControlRange | null }

/** Settings are written this long after the last change – sliders change many times a second. */
const SAVE_DELAY = 400

type Capabilities = Record<string, unknown>

function rangeOf(value: unknown): ControlRange | null {
  const r = value as Partial<ControlRange> | undefined
  if (typeof r?.min !== 'number' || typeof r.max !== 'number' || !(r.max > r.min)) return null
  return { min: r.min, max: r.max, step: typeof r.step === 'number' && r.step > 0 ? r.step : 0 }
}

/** The controls a camera reports, in the order they are shown. */
function controlsOf(caps: Capabilities): CameraControl[] {
  const found: CameraControl[] = []
  for (const name of AUTO_CONTROL_NAMES) {
    const { mode, value } = AUTO_CONTROLS[name]
    const modes = caps[mode]
    if (Array.isArray(modes) && modes.includes('continuous') && modes.includes('manual')) {
      found.push({ kind: 'auto', name, range: rangeOf(caps[value]) })
    }
  }
  for (const name of VALUE_CONTROLS) {
    const range = rangeOf(caps[name])
    if (range) found.push({ kind: 'value', name, range })
  }
  return found
}

/** W3C names a control sets – an auto control has its mode and its value. */
const namesOf = (control: CameraControl): CameraControlName[] =>
  control.kind === 'value'
    ? [control.name]
    : [AUTO_CONTROLS[control.name].mode, AUTO_CONTROLS[control.name].value]

const clamp = (value: number, range: ControlRange): number =>
  Math.min(range.max, Math.max(range.min, value))

/** What to send to the camera for `values`, for the controls in `controls`. */
function constraintFor(
  values: CameraControlValues,
  controls: CameraControl[]
): CameraControlValues {
  const out: Record<string, unknown> = {}
  for (const control of controls) {
    if (control.kind === 'value') {
      const value = values[control.name]
      if (value !== undefined) out[control.name] = clamp(value, control.range)
      continue
    }
    const { mode, value } = AUTO_CONTROLS[control.name]
    if (values[mode] === 'continuous') out[mode] = 'continuous'
    else if (values[mode] === 'manual' || values[value] !== undefined) {
      out[mode] = 'manual'
      const manual = values[value]
      if (manual !== undefined && control.range) out[value] = clamp(manual, control.range)
    }
  }
  return out as CameraControlValues
}

/** A value of an auto control means its manual mode; the automatic mode drops the value. */
function normalize(patch: CameraControlValues): CameraControlValues {
  const out: Record<string, unknown> = { ...patch }
  for (const name of AUTO_CONTROL_NAMES) {
    const { mode, value } = AUTO_CONTROLS[name]
    if (out[mode] === 'continuous') delete out[value]
    else if (out[value] !== undefined) out[mode] = 'manual'
  }
  return out as CameraControlValues
}

const pick = (values: CameraControlValues, names: CameraControlName[]): CameraControlValues =>
  Object.fromEntries(
    names.filter((n) => values[n] !== undefined).map((n) => [n, values[n]])
  ) as CameraControlValues

async function tryApply(track: MediaStreamTrack, values: CameraControlValues): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [values as MediaTrackConstraintSet] })
    return true
  } catch {
    return false
  }
}

/**
 * Picture controls of the live camera: which it has, their values, and changing them. What the
 * user sets is remembered per camera and applied again whenever the camera starts; "Zurücksetzen"
 * restores the camera's values from before. Controls a device module locks (the microscope's
 * brightness) are never touched.
 */
export const useCameraControlsStore = defineStore('cameraControls', () => {
  const camera = useCameraStore()
  const settings = useSettingsStore()
  const modules = useModulesStore()

  /** Everything the live camera reports, before locks and refusals. */
  const reported = shallowRef<CameraControl[]>([])
  /** Current values, as the camera reports them after each change. */
  const values = ref<CameraControlValues>({})
  /**
   * Value controls a camera lists but refuses to set (the Generalplus microscope rejects even its
   * current contrast). Found once per camera label and app run.
   */
  const refusedByCamera = new Map<string, ValueControl[]>()
  const refused = ref<ValueControl[]>([])
  /** The controls are being read or set up for a camera that just started. */
  const loading = ref(false)

  let track: MediaStreamTrack | null = null
  /** Label of the camera the controls belong to. */
  const label = ref<string | null>(null)
  let setupToken = 0

  /** Lock of the device module the camera is recognised as (by USB id or by hand). */
  const lock = computed(() => {
    const current = modules.currentLabel
    if (!current) return null
    const recognised = [modules.autoModuleFor(current), modules.assignedModule(current)]
    return recognised.find((m) => m?.lockedControls)?.lockedControls ?? null
  })

  /** The controls offered: reported by the camera, not locked and not refused. */
  const controls = computed(() =>
    reported.value.filter(
      (c) =>
        !namesOf(c).some((n) => lock.value?.controls.includes(n)) &&
        !(c.kind === 'value' && refused.value.includes(c.name))
    )
  )
  /** Reported controls left out because of the module's lock. */
  const lockedControls = computed(() =>
    reported.value.filter((c) => namesOf(c).some((n) => lock.value?.controls.includes(n)))
  )

  const stored = computed(() => (label.value ? settings.cameraControls[label.value] : undefined))
  /** A change of this camera waits to be written to the settings. */
  const saving = ref(false)
  /** Something was changed in CameraDraw that "Zurücksetzen" can undo. */
  const changed = computed(
    () => saving.value || (!!stored.value && Object.keys(stored.value.values).length > 0)
  )

  const isAuto = (name: AutoControl): boolean => values.value[AUTO_CONTROLS[name].mode] !== 'manual'

  function readValues(): void {
    if (!track) return
    const current = track.getSettings() as Record<string, unknown>
    const names = reported.value.flatMap(namesOf)
    values.value = Object.fromEntries(
      names.filter((n) => current[n] !== undefined).map((n) => [n, current[n]])
    ) as CameraControlValues
  }

  /** Tries the value controls with their current values once per camera; keeps the refused ones. */
  async function findRefused(
    t: MediaStreamTrack,
    offered: CameraControl[]
  ): Promise<ValueControl[]> {
    const current = t.getSettings() as Record<string, unknown>
    const names = offered
      .filter((c): c is Extract<CameraControl, { kind: 'value' }> => c.kind === 'value')
      .map((c) => c.name)
      .filter((n) => typeof current[n] === 'number')
    const same = (names: ValueControl[]): CameraControlValues =>
      Object.fromEntries(names.map((n) => [n, current[n]]))
    if (!names.length || (await tryApply(t, same(names)))) return []
    const out: ValueControl[] = []
    for (const name of names) if (!(await tryApply(t, same([name])))) out.push(name)
    return out
  }

  /** Reads the controls of a camera that just started and applies what the user set for it. */
  async function setup(stream: MediaStream | null): Promise<void> {
    const token = ++setupToken
    const t = stream?.getVideoTracks()[0] ?? null
    const cameraLabel = t ? camera.selectedLabel : null
    track = t
    label.value = cameraLabel
    wanted = {} // meant for the camera before
    reported.value = []
    values.value = {}
    refused.value = []
    loading.value = !!t && !!cameraLabel
    if (!t || !cameraLabel) return void flushSave()
    try {
      await flushSave()
      const found = controlsOf((t.getCapabilities?.() ?? {}) as Capabilities)
      const unlocked = found.filter(
        (c) => !namesOf(c).some((n) => lock.value?.controls.includes(n))
      )
      let refusedHere = refusedByCamera.get(cameraLabel)
      if (!refusedHere) {
        refusedHere = await findRefused(t, unlocked)
        // Ended meanwhile (unplugged, switched off): the answers say nothing about the camera.
        if (t.readyState !== 'live') return
        refusedByCamera.set(cameraLabel, refusedHere)
      }
      if (token !== setupToken) return
      const usable = unlocked.filter((c) => !(c.kind === 'value' && refusedHere.includes(c.name)))
      const remembered = settings.cameraControls[cameraLabel]?.values
      if (remembered) await tryApply(t, constraintFor(remembered, usable))
      if (token !== setupToken) return
      reported.value = found
      refused.value = refusedHere
      readValues()
    } finally {
      if (token === setupToken) loading.value = false
    }
  }

  // ── Changing ────────────────────────────────────────────────────────────────

  /** Changes waiting for the camera – fast slider moves are sent as one. */
  let wanted: CameraControlValues = {}
  let applying: Promise<void> | null = null

  function drain(): Promise<void> {
    applying ??= (async () => {
      let failure: unknown = null
      try {
        while (Object.keys(wanted).length && track) {
          const batch = wanted
          wanted = {}
          try {
            await track.applyConstraints({
              advanced: [constraintFor(batch, controls.value) as MediaTrackConstraintSet]
            })
          } catch (err) {
            failure ??= err
          }
        }
        // Only now: reading in between would pull a slider back while it is still being dragged.
        readValues()
      } finally {
        applying = null
      }
      if (failure) throw failure
    })()
    return applying
  }

  // What the user set, written to the settings shortly after the last change.
  let unsaved: {
    label: string
    values: CameraControlValues
    originals: CameraControlValues
  } | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  async function flushSave(): Promise<void> {
    clearTimeout(saveTimer)
    const pending = unsaved
    unsaved = null
    saving.value = false
    if (!pending) return
    await settings
      .updateCameraControls(pending.label, (entry) => ({
        ...entry,
        values: pending.values,
        originals: pending.originals
      }))
      .catch(() => undefined)
  }

  /** Remembers a change for this camera, and the camera's values before its first change. */
  function remember(change: CameraControlValues): void {
    const cameraLabel = label.value
    if (!cameraLabel) return
    if (unsaved?.label !== cameraLabel) {
      const entry = settings.cameraControls[cameraLabel]
      unsaved = {
        label: cameraLabel,
        values: { ...entry?.values },
        originals: { ...entry?.originals }
      }
    }
    const target = unsaved
    for (const control of controls.value) {
      const names = namesOf(control)
      if (!names.some((n) => change[n] !== undefined)) continue
      if (!names.some((n) => n in target.originals)) {
        Object.assign(target.originals, pick(values.value, names))
      }
      if (control.kind === 'value') {
        target.values[control.name] = change[control.name]
        continue
      }
      // An auto control is stored whole: its mode, and in manual mode the value to use.
      const { mode, value } = AUTO_CONTROLS[control.name]
      const manual = (change[mode] ?? values.value[mode]) === 'manual'
      const amount = change[value] ?? values.value[value]
      target.values[mode] = manual ? 'manual' : 'continuous'
      delete target.values[value]
      if (manual && amount !== undefined) target.values[value] = amount
    }
    clearTimeout(saveTimer)
    saving.value = true
    saveTimer = setTimeout(() => void flushSave(), SAVE_DELAY)
  }

  /**
   * Sets controls of the live camera: e.g. `{ brightness: 140 }`, `{ exposureMode: 'continuous' }`
   * or `{ exposureTime: 156.25 }` (a value switches its control to manual). Throws if the camera
   * refuses; the values then show what it really uses.
   */
  async function set(patch: CameraControlValues): Promise<void> {
    if (!track) throw new Error('Die Kamera läuft gerade nicht.')
    const offered = new Set(controls.value.flatMap(namesOf))
    for (const name of Object.keys(patch) as CameraControlName[]) {
      if (offered.has(name)) continue
      if (lock.value?.controls.includes(name)) throw new Error(lock.value.reason)
      throw new Error(`Diese Kamera lässt „${CONTROL_LABELS[name]}“ nicht einstellen.`)
    }
    const change = normalize(patch)
    remember(change)
    // Shown at once, so a slider follows the pointer; the camera's answer replaces it.
    values.value = { ...values.value, ...change }
    wanted = { ...wanted, ...change }
    await drain()
  }

  /** Switches an auto control between the camera's automatic and its manual value. */
  const setAuto = (name: AutoControl, auto: boolean): Promise<void> =>
    set({ [AUTO_CONTROLS[name].mode]: (auto ? 'continuous' : 'manual') as ControlMode })

  /** Restores the camera's values from before CameraDraw changed them, and forgets the changes. */
  async function reset(): Promise<void> {
    const cameraLabel = label.value
    if (!track || !cameraLabel) throw new Error('Die Kamera läuft gerade nicht.')
    await flushSave()
    const originals = settings.cameraControls[cameraLabel]?.originals ?? {}
    await settings.updateCameraControls(cameraLabel, (entry) => ({
      ...entry,
      values: {},
      originals: {}
    }))
    if (!Object.keys(originals).length) return
    wanted = { ...wanted, ...originals }
    await drain()
  }

  watch(
    () => camera.stream,
    (stream) => void setup(stream),
    { immediate: true }
  )

  return {
    controls,
    lockedControls,
    lock,
    refused,
    values,
    loading,
    changed,
    isAuto,
    set,
    setAuto,
    reset
  }
})

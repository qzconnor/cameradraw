import type { PowerLineFrequency } from './devices'

/**
 * Picture controls of a camera: exposure, white balance, focus, brightness and so on. The names are
 * those of the W3C Image Capture constraints Chromium offers on a camera track; on Windows it reads
 * and sets them through the camera driver (UVC processing unit and camera terminal). Which ones a
 * camera has, and whether it really accepts them, differs from camera to camera. The anti-flicker
 * filter (`powerLineFrequency`) is not among them: CameraDraw sets it through its helper program.
 */

/** Controls set by a single number (in the camera's own units). */
export const VALUE_CONTROLS = ['brightness', 'contrast', 'saturation', 'sharpness'] as const
export type ValueControl = (typeof VALUE_CONTROLS)[number]

/** Controls with an automatic mode – their value only applies in manual mode. */
export const AUTO_CONTROLS = {
  exposure: { mode: 'exposureMode', value: 'exposureTime' },
  whiteBalance: { mode: 'whiteBalanceMode', value: 'colorTemperature' },
  focus: { mode: 'focusMode', value: 'focusDistance' }
} as const
export type AutoControl = keyof typeof AUTO_CONTROLS
export const AUTO_CONTROL_NAMES = Object.keys(AUTO_CONTROLS) as AutoControl[]

/** `continuous`: the camera adjusts itself · `manual`: the value set is used. */
export type ControlMode = 'continuous' | 'manual'
export const CONTROL_MODES: readonly ControlMode[] = ['continuous', 'manual']

/**
 * Values of the controls. `exposureTime` is in units of 100 µs, `colorTemperature` in Kelvin, the
 * others in the camera's own units (see the ranges the camera reports).
 */
export interface CameraControlValues {
  brightness?: number
  contrast?: number
  saturation?: number
  sharpness?: number
  exposureMode?: ControlMode
  exposureTime?: number
  whiteBalanceMode?: ControlMode
  colorTemperature?: number
  focusMode?: ControlMode
  focusDistance?: number
  /** Anti-flicker filter in Hz (mains frequency of the lamps), 0 = off. */
  powerLineFrequency?: PowerLineFrequency
}
export type CameraControlName = keyof CameraControlValues

const MODE_KEYS = AUTO_CONTROL_NAMES.map((name) => AUTO_CONTROLS[name].mode)
const NUMBER_KEYS = [...VALUE_CONTROLS, ...AUTO_CONTROL_NAMES.map((n) => AUTO_CONTROLS[n].value)]

/** `standard`: up to Full HD (1920×1080) · `max`: the highest resolution the camera offers. */
export type CameraResolution = 'standard' | 'max'

/** What CameraDraw changed on one camera (per camera label, like modules and scales). */
export interface CameraControlSettings {
  /** Only set for `max` – the default is `standard`. */
  resolution?: 'max'
  /** Show and capture the picture in the TV range 16–235, like Logi Capture (see `SOFT_CONTRAST`). */
  softContrast?: true
  /** Values set in CameraDraw – applied again whenever the camera starts. */
  values: CameraControlValues
  /** The camera's values before CameraDraw first changed them – "Zurücksetzen" restores these. */
  originals: CameraControlValues
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Keeps only known controls with valid values. */
export function sanitizeControlValues(value: unknown): CameraControlValues {
  if (!isRecord(value)) return {}
  const out: Record<string, unknown> = {}
  for (const key of MODE_KEYS) {
    if (CONTROL_MODES.includes(value[key] as ControlMode)) out[key] = value[key]
  }
  for (const key of NUMBER_KEYS) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) out[key] = value[key]
  }
  if ([0, 50, 60].includes(value.powerLineFrequency as number)) {
    out.powerLineFrequency = value.powerLineFrequency
  }
  return out as CameraControlValues
}

/** Camera label → its settings; null if `value` is not such a map. */
export function sanitizeControlSettings(
  value: unknown
): Record<string, CameraControlSettings> | null {
  if (!isRecord(value) || Object.keys(value).length > 200) return null
  const out: Record<string, CameraControlSettings> = {}
  for (const [label, entry] of Object.entries(value)) {
    if (!isRecord(entry)) return null
    out[label] = {
      ...(entry.resolution === 'max' ? { resolution: 'max' } : {}),
      ...(entry.softContrast === true ? { softContrast: true } : {}),
      values: sanitizeControlValues(entry.values),
      originals: sanitizeControlValues(entry.originals)
    }
  }
  return out
}

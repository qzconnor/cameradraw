import { AUTO_CONTROLS, type AutoControl, type CameraControlName } from '@shared/camera-controls'
import type { CameraControl } from '@/stores/camera-controls'

/** German names of the controls, also used in messages. */
export const CONTROL_LABELS: Record<CameraControlName | AutoControl, string> = {
  brightness: 'Helligkeit',
  contrast: 'Kontrast',
  saturation: 'Sättigung',
  sharpness: 'Schärfe',
  exposure: 'Belichtung',
  exposureMode: 'Belichtung',
  exposureTime: 'Belichtungszeit',
  whiteBalance: 'Weißabgleich',
  whiteBalanceMode: 'Weißabgleich',
  colorTemperature: 'Farbtemperatur',
  focus: 'Fokus',
  focusMode: 'Fokus',
  focusDistance: 'Fokus',
  powerLineFrequency: 'Flimmerfilter'
}

/** Exposure times are in units of 100 µs. */
const EXPOSURE_UNITS_PER_SECOND = 10_000

const number = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })

/** Exposure time the way cameras show it, e.g. "1/64 s" or "2 s". */
export function formatExposure(units: number): string {
  const seconds = units / EXPOSURE_UNITS_PER_SECOND
  return seconds >= 1 ? `${number.format(seconds)} s` : `1/${Math.round(1 / seconds)} s`
}

const isWholeNumber = (value: number): boolean => Math.abs(value - Math.round(value)) < 1e-6

/** How a control's value maps onto a slider. */
export interface ControlSlider {
  /** The setting it moves, e.g. `exposureTime` for the exposure. */
  name: CameraControlName
  min: number
  max: number
  step: number
  toSlider: (value: number) => number
  fromSlider: (position: number) => number
  format: (value: number) => string
}

/** The slider of a control, null if it has no value to set (only the automatic mode). */
export function sliderFor(control: CameraControl): ControlSlider | null {
  const range = control.range
  if (!range) return null
  const name = control.kind === 'value' ? control.name : AUTO_CONTROLS[control.name].value
  const step = range.step || (range.max - range.min) / 100
  const decimals = isWholeNumber(step) ? 0 : 1
  const plain = new Intl.NumberFormat('de-DE', { maximumFractionDigits: decimals })
  const linear: ControlSlider = {
    name,
    min: range.min,
    max: range.max,
    step,
    toSlider: (value) => value,
    fromSlider: (position) => position,
    format: (value) => plain.format(value)
  }
  if (name === 'colorTemperature')
    return { ...linear, format: (value) => `${plain.format(value)} K` }
  if (name !== 'exposureTime') return linear

  // On Windows the camera driver counts exposure in powers of two of a second (UVC "log2
  // seconds"), so the slider moves in those steps; other ranges stay linear.
  const exponent = (value: number): number => Math.log2(value / EXPOSURE_UNITS_PER_SECOND)
  if (!isWholeNumber(exponent(range.min)) || !isWholeNumber(exponent(range.max))) {
    return { ...linear, format: formatExposure }
  }
  return {
    name,
    min: Math.round(exponent(range.min)),
    max: Math.round(exponent(range.max)),
    step: 1,
    toSlider: (value) => Math.round(exponent(value)),
    fromSlider: (position) => 2 ** position * EXPOSURE_UNITS_PER_SECOND,
    format: formatExposure
  }
}

/** A camera registered with the operating system (Windows device manager). */
export interface SystemCamera {
  name: string
  instanceId: string
  /**
   * usb      – plugged in via USB
   * software – device created by a program (virtual camera)
   * other    – e.g. built into the device
   */
  bus: 'usb' | 'software' | 'other'
}

/** A USB device type in lowercase hex, e.g. `{ vendorId: '1b3f', productId: '2002' }`. */
export interface UsbDeviceId {
  vendorId: string
  productId: string
}

/**
 * Background service "CameraDraw Buttons" that reports UVC photo buttons (Windows only).
 *
 * unsupported   – not available on this platform
 * not-installed – the service is not installed
 * stopped       – installed, but not reachable (stopped or still starting)
 * outdated      – the installed service speaks an older protocol; installing again updates it
 * running       – connected, see `capture`
 */
export type ButtonServiceState =
  'unsupported' | 'not-installed' | 'stopped' | 'outdated' | 'running'

/**
 * What the running service reports about its USB capture.
 *
 * idle           – no camera to watch right now
 * ready          – listening to every watched camera
 * device-missing – a watched camera is not connected
 * usbpcap-*      – USBPcap is missing, needs a reboot, or is used by another capture (Wireshark)
 * error          – see `message`
 */
export type ButtonCaptureState =
  | 'idle'
  | 'ready'
  | 'device-missing'
  | 'usbpcap-missing'
  | 'usbpcap-reboot'
  | 'usbpcap-busy'
  | 'error'

export interface ButtonServiceStatus {
  state: ButtonServiceState
  /** Only while running. */
  capture: ButtonCaptureState | null
  message: string | null
  /** False if this build of CameraDraw does not include the service (e.g. not built yet). */
  bundled: boolean
}

export interface StillButtonEvent extends UsbDeviceId {
  pressed: boolean
}

/** A new value of a camera's UVC brightness control (read by `cameradraw-buttons brightness`). */
export interface BrightnessEvent extends UsbDeviceId {
  value: number
}

/** Anti-flicker filter in Hz – the mains frequency of the lamps; 0 = off. */
export type PowerLineFrequency = 0 | 50 | 60

/** A camera's anti-flicker filter (UVC power line frequency), see `controls.powerLine`. */
export interface PowerLineState {
  value: PowerLineFrequency
  /** What the camera accepts – many only 50 and 60, not off. */
  options: PowerLineFrequency[]
  /** The camera's own default (Logitech webcams: 60). */
  default: PowerLineFrequency
}

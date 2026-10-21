import type { Component } from 'vue'
import type { UsbId } from '@/lib/camera-info'

/**
 * supported – CameraDraw handles it
 * device    – handled by the device itself, nothing for the app to do
 * planned   – known/decoded, but not available in the app yet
 */
export type CapabilityStatus = 'supported' | 'device' | 'planned'

export interface ModuleCapability {
  label: string
  status: CapabilityStatus
  detail: string
  /** Needs the "CameraDraw Buttons" background service – its status is shown with the capability. */
  requiresButtonService?: boolean
}

export interface ModuleContext {
  cameraLabel: string
  usb: UsbId | null
  /** Freezes the live picture like the Space key (ignored in the editor and with open panels). */
  capture: () => void
  /** Zooms in (1) or out (−1) by one step, like the + / − keys. */
  zoom: (direction: 1 | -1) => void
  /**
   * Reports presses (`true`) and releases (`false`) of the camera's UVC photo button via the
   * background service. Returns a function that stops listening.
   */
  onPhotoButton: (listener: (pressed: boolean) => void) => () => void
  /**
   * Reads the camera's UVC brightness regularly (every 65 ms, read-only, no service needed) and
   * reports the current value, then every change. Returns a function that stops reading.
   */
  onBrightness: (listener: (value: number) => void) => () => void
}

/** Support for a specific device type. Add new modules in `modules/index.ts`. */
export interface DeviceModule {
  id: string
  name: string
  /** Short name for badges, e.g. "Mikroskop". */
  shortName: string
  description: string
  icon: Component
  /** Cameras this module is assigned to automatically. */
  match: UsbId[]
  capabilities: ModuleCapability[]
  /**
   * Runs while the module is active for the live camera and the camera is not paused (e.g.
   * listening to device buttons). Returns a cleanup function.
   */
  activate?: (context: ModuleContext) => () => void
}

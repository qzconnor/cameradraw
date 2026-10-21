import type { UsbId } from '@/lib/camera-info'
import { generalplusMicroscope } from './generalplus-microscope'
import type { DeviceModule } from './types'

export type { DeviceModule, ModuleCapability, CapabilityStatus } from './types'

/** All device modules. New devices get their own file and are listed here. */
export const DEVICE_MODULES: DeviceModule[] = [generalplusMicroscope]

export const findModule = (id: string): DeviceModule | undefined =>
  DEVICE_MODULES.find((m) => m.id === id)

/** Module that recognises a camera by its USB id. */
export const matchModule = (usb: UsbId): DeviceModule | undefined =>
  DEVICE_MODULES.find((m) =>
    m.match.some((id) => id.vendorId === usb.vendorId && id.productId === usb.productId)
  )

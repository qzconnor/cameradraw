import type { SystemCamera } from '@shared/devices'

export interface UsbId {
  vendorId: string
  productId: string
}

/**
 * usb      – physically plugged in via USB
 * physical – physical, not USB (e.g. built into a laptop)
 * virtual  – created by software (OBS, DroidCam, …)
 * unknown  – cannot tell on this platform
 */
export type CameraConnection = 'usb' | 'physical' | 'virtual' | 'unknown'

export const CONNECTION_LABELS: Record<CameraConnection, string> = {
  usb: 'Per USB angeschlossen',
  physical: 'Eingebaute Kamera',
  virtual: 'Virtuelle Kamera (Software)',
  unknown: 'Anschlussart unbekannt'
}

/** Chromium appends the USB id to USB camera labels, e.g. `GENERAL - UVC (1b3f:2002)`. */
export function parseUsbId(label: string | null | undefined): UsbId | null {
  const match = /\(([0-9a-f]{4}):([0-9a-f]{4})\)\s*$/i.exec(label ?? '')
  return match ? { vendorId: match[1].toLowerCase(), productId: match[2].toLowerCase() } : null
}

export const formatUsbId = (id: UsbId): string => `${id.vendorId}:${id.productId}`

/**
 * Physical or virtual? USB cameras carry their USB id in the label. Everything else is looked up in
 * the OS device list: Windows registers real cameras there, while most virtual cameras are mere
 * software filters that do not appear at all (or appear as software devices).
 */
export function classifyCamera(
  label: string,
  systemCameras: SystemCamera[] | null
): CameraConnection {
  if (parseUsbId(label)) return 'usb'
  if (!systemCameras) return 'unknown'
  const entry = systemCameras.find((c) => c.name.trim() === label.trim())
  if (!entry) return 'virtual'
  if (entry.bus === 'software') return 'virtual'
  return entry.bus === 'usb' ? 'usb' : 'physical'
}

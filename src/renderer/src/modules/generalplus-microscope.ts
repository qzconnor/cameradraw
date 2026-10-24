import { MicroscopeIcon } from '@lucide/vue'
import type { DeviceModule } from './types'

/** UVC brightness values the microscope uses to report its zoom buttons (idle: 0x31). */
const BRIGHTNESS_ZOOM_OUT = 0x32
const BRIGHTNESS_ZOOM_IN = 0x33

/**
 * Generalplus USB digital microscope (USB id 1b3f:2002, "GENERAL - UVC").
 *
 * Reverse engineered with USBPcap/Wireshark and from the V-SCOPE viewer:
 * - Photo button: standard UVC still-image button, sent on the interrupt endpoint 0x83 as a
 *   VideoStreaming status packet `02 01 00 01` (pressed) / `02 01 00 00` (released).
 *   Windows' camera driver (usbvideo.sys) consumes it: the device uses still-image method 2, so the
 *   driver turns the press into its own still capture and never raises a notification other apps
 *   could receive (KSEVENT_VIDCAPTOSTI_EXT_TRIGGER stays silent, tested). The "CameraDraw Buttons"
 *   service reads the packet from the USB traffic via USBPcap instead.
 * - Zoom + / −: the device sends nothing by itself and does not zoom. It reports the buttons
 *   through the UVC brightness control (Processing Unit 5, selector 2) instead: GET_CUR answers
 *   0x33 once after Zoom +, 0x32 once after Zoom −, otherwise 0x31. So the value has to be polled
 *   (V-SCOPE: every 65 ms); CameraDraw then zooms digitally. Never set the brightness.
 * - Long press on the photo button: switches the microscope off/on (device only).
 */
export const generalplusMicroscope: DeviceModule = {
  id: 'generalplus-microscope',
  name: 'USB-Mikroskop (Generalplus)',
  shortName: 'Mikroskop',
  description: 'Digitalmikroskop mit Foto- und Zoom-Tasten (USB-ID 1b3f:2002).',
  icon: MicroscopeIcon,
  match: [{ vendorId: '1b3f', productId: '2002' }],
  capabilities: [
    {
      label: 'Foto-Taste',
      status: 'supported',
      detail:
        'Hält das Bild an wie die Leertaste. Windows gibt die Taste nicht an Apps weiter – sie kommt über den Hintergrunddienst „CameraDraw Buttons“, der USBPcap braucht.',
      requiresButtonService: true
    },
    {
      label: 'Zoom + / −',
      status: 'supported',
      detail:
        'Zoomt in CameraDraw wie die Tasten + / −. Das Mikroskop meldet die Tasten über seinen Helligkeitswert, den CameraDraw laufend abfragt – ohne Hintergrunddienst.'
    }
  ],
  lockedControls: {
    controls: ['brightness'],
    reason:
      'Die Helligkeit stellt CameraDraw bei diesem Mikroskop nicht ein – es meldet darüber seine Zoom-Tasten.'
  },
  activate: ({ onPhotoButton, onBrightness, capture, zoom }) => {
    const stopPhoto = onPhotoButton((pressed) => {
      if (pressed) capture()
    })
    // Only changes are reported, and the read after a press is idle again: one value per press.
    const stopZoom = onBrightness((value) => {
      if (value === BRIGHTNESS_ZOOM_IN) zoom(1)
      else if (value === BRIGHTNESS_ZOOM_OUT) zoom(-1)
    })
    return () => {
      stopPhoto()
      stopZoom()
    }
  }
}

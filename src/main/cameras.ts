import { execFile } from 'child_process'
import type { SystemCamera } from '@shared/devices'

/** Cached briefly – the renderer asks again whenever the camera list changes. */
const CACHE_MS = 3000

let cache: { at: number; cameras: SystemCamera[] } | null = null

function busOf(instanceId: string): SystemCamera['bus'] {
  if (/^USB\\/i.test(instanceId)) return 'usb'
  if (/^(SWD|ROOT)\\/i.test(instanceId)) return 'software'
  return 'other'
}

/**
 * Cameras known to Windows' device manager. Virtual cameras that only exist as DirectShow /
 * Media Foundation filters (OBS, DroidCam, …) do not show up here at all.
 * Returns null on other platforms or if the query fails.
 */
export function listSystemCameras(): Promise<SystemCamera[] | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  if (cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.cameras)

  const script =
    "Get-CimInstance Win32_PnPEntity -Filter \"PNPClass='Camera' OR PNPClass='Image'\" | " +
    'Select-Object Name, PNPDeviceID | ConvertTo-Json -Compress'

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 15000 },
      (error, stdout) => {
        if (error) return resolve(null)
        try {
          const raw = JSON.parse(String(stdout).trim() || '[]') as
            { Name: string; PNPDeviceID: string } | { Name: string; PNPDeviceID: string }[]
          const cameras = (Array.isArray(raw) ? raw : [raw])
            .filter((d) => d?.Name && d.PNPDeviceID)
            .map((d) => ({ name: d.Name, instanceId: d.PNPDeviceID, bus: busOf(d.PNPDeviceID) }))
          cache = { at: Date.now(), cameras }
          resolve(cameras)
        } catch {
          resolve(null)
        }
      }
    )
  })
}

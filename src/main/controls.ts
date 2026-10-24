import { execFile, spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { app, BrowserWindow, ipcMain } from 'electron'
import type {
  BrightnessEvent,
  PowerLineFrequency,
  PowerLineState,
  UsbDeviceId
} from '@shared/devices'
import { IPC } from '@shared/types'
import { sanitizeDevices, serviceExecutable } from './buttons'

/**
 * Reads the UVC brightness of watched cameras with `cameradraw-buttons.exe brightness`, one process
 * per device. Unlike the photo button this needs neither the service nor admin rights: the process
 * runs as the user and only asks the camera driver. It exits when its stdin closes, so it never
 * outlives the app.
 */

const RESTART_DELAY = 3000
const MAX_LINE_LENGTH = 4096

const supported = process.platform === 'win32'

interface Poller {
  device: UsbDeviceId
  process: ChildProcess | null
  restartTimer?: NodeJS.Timeout
}

/** `vid:pid` → poller */
const pollers = new Map<string, Poller>()
let stopped = false

const keyOf = (device: UsbDeviceId): string => `${device.vendorId}:${device.productId}`

function broadcast(event: BrightnessEvent): void {
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send(IPC.controlsBrightness, event)
}

function onLine(poller: Poller, line: string): void {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(line)
  } catch {
    return
  }
  // Status lines (ready / device-missing) are not needed: values only come while readable.
  if (data.type === 'value' && Number.isInteger(data.value)) {
    broadcast({ ...poller.device, value: data.value as number })
  }
}

function start(poller: Poller): void {
  const exe = serviceExecutable()
  if (stopped || !existsSync(exe)) return
  const child = spawn(exe, ['brightness', keyOf(poller.device)], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore']
  })
  poller.process = child
  let buffer = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk
    let end: number
    while ((end = buffer.indexOf('\n')) >= 0) {
      onLine(poller, buffer.slice(0, end).trim())
      buffer = buffer.slice(end + 1)
    }
    if (buffer.length > MAX_LINE_LENGTH) child.kill()
  })
  // 'exit' follows a failed start as well.
  child.on('error', () => undefined)
  child.on('exit', () => {
    if (poller.process !== child) return
    // Ended on its own (crash, killed from outside) – try again while the device is watched.
    poller.process = null
    poller.restartTimer = setTimeout(() => start(poller), RESTART_DELAY)
  })
}

function stop(poller: Poller): void {
  clearTimeout(poller.restartTimer)
  const child = poller.process
  poller.process = null
  child?.kill()
}

function watchBrightness(devices: UsbDeviceId[]): void {
  const wanted = new Map(devices.map((device) => [keyOf(device), device]))
  for (const [key, poller] of pollers) {
    if (wanted.has(key)) continue
    stop(poller)
    pollers.delete(key)
  }
  for (const [key, device] of wanted) {
    if (pollers.has(key)) continue
    const poller: Poller = { device, process: null }
    pollers.set(key, poller)
    start(poller)
  }
}

// ── Anti-flicker filter ─────────────────────────────────────────────────────────

/** UVC power line frequency code ↔ Hz (0 = off). */
const POWER_LINE_HZ: PowerLineFrequency[] = [0, 50, 60]

const isPowerLineFrequency = (v: unknown): v is PowerLineFrequency =>
  POWER_LINE_HZ.includes(v as PowerLineFrequency)

/**
 * Reads a camera's anti-flicker filter with `cameradraw-buttons.exe powerline` – after setting it,
 * if `value` is given. Browsers offer no control for it. null: no such camera, no filter, or no
 * helper (e.g. on other platforms).
 */
function powerLine(
  device: UsbDeviceId,
  value?: PowerLineFrequency
): Promise<PowerLineState | null> {
  const exe = serviceExecutable()
  if (!supported || !existsSync(exe)) return Promise.resolve(null)
  const args = ['powerline', keyOf(device)]
  if (value !== undefined) args.push(String(POWER_LINE_HZ.indexOf(value)))
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, timeout: 5000 }, (_err, stdout) => {
      let data: Record<string, unknown>
      try {
        data = JSON.parse(String(stdout).trim())
      } catch {
        return resolve(null)
      }
      if (data.error === 'rejected') {
        return reject(new Error('Die Kamera hat den Flimmerfilter nicht übernommen.'))
      }
      const { min, max } = data
      const code = (n: unknown): PowerLineFrequency | undefined => POWER_LINE_HZ[n as number]
      const current = code(data.value)
      if (current === undefined || typeof min !== 'number' || typeof max !== 'number') {
        return resolve(null)
      }
      resolve({
        value: current,
        options: POWER_LINE_HZ.filter((_, i) => i >= min && i <= max),
        default: code(data.default) ?? current
      })
    })
  })
}

export function registerControlsIpc(): void {
  ipcMain.handle(IPC.controlsPowerLine, (_e, camera: unknown, value: unknown) => {
    const [device] = sanitizeDevices([camera])
    if (!device) throw new Error('Unbekannte Kamera.')
    if (value !== undefined && !isPowerLineFrequency(value)) {
      throw new Error('Der Flimmerfilter kennt nur 0 (aus), 50 und 60 Hz.')
    }
    return powerLine(device, value)
  })
  ipcMain.on(IPC.controlsWatchBrightness, (_e, devices: unknown) => {
    if (supported) watchBrightness(sanitizeDevices(devices))
  })
  app.on('before-quit', () => {
    stopped = true
    watchBrightness([])
  })
}

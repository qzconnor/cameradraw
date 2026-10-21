import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { connect, type Socket } from 'net'
import { join } from 'path'
import { app, BrowserWindow, ipcMain } from 'electron'
import type {
  ButtonCaptureState,
  ButtonServiceStatus,
  StillButtonEvent,
  UsbDeviceId
} from '@shared/devices'
import { IPC } from '@shared/types'

/**
 * Client for the "CameraDraw Buttons" Windows service (source in `service/`). The service reads
 * UVC photo-button packets from the USB traffic via USBPcap – Windows' camera driver swallows them –
 * and reports them on a named pipe, one JSON object per line.
 */

const SERVICE_NAME = 'CameraDrawButtons'
const PIPE_PATH = '\\\\.\\pipe\\cameradraw-buttons'
/** Must match `Protocol.Version` in service/Protocol.cs. */
const PROTOCOL_VERSION = 1
const RECONNECT_DELAY = 3000
/** How long to wait for the pipe after installing (the service starts within a moment). */
const START_TIMEOUT = 5000
const MAX_LINE_LENGTH = 64 * 1024
const MAX_WATCHED = 16

const ERROR_SERVICE_DOES_NOT_EXIST = 1060
const ERROR_CANCELLED = 1223

const CAPTURE_STATES: ButtonCaptureState[] = [
  'idle',
  'ready',
  'device-missing',
  'usbpcap-missing',
  'usbpcap-reboot',
  'usbpcap-busy',
  'error'
]

const supported = process.platform === 'win32'

let socket: Socket | null = null
let connected = false
let reconnectTimer: NodeJS.Timeout | undefined
let stopped = false
/** Result of the last `sc query`; null = not checked yet. */
let installed: boolean | null = null
let serviceVersion: number | null = null
let capture: ButtonCaptureState | null = null
let message: string | null = null
let watched: UsbDeviceId[] = []
let lastStatus = ''

/** The service executable shipped with the app (copied to Program Files when installing). */
export function serviceExecutable(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'button-service', 'cameradraw-buttons.exe')
    : join(app.getAppPath(), 'service', 'publish', 'cameradraw-buttons.exe')
}

function currentStatus(): ButtonServiceStatus {
  const bundled = supported && existsSync(serviceExecutable())
  if (!supported) return { state: 'unsupported', capture: null, message: null, bundled }
  if (connected) {
    return serviceVersion === PROTOCOL_VERSION
      ? { state: 'running', capture, message, bundled }
      : { state: 'outdated', capture: null, message: null, bundled }
  }
  return {
    state: installed === false ? 'not-installed' : 'stopped',
    capture: null,
    message: null,
    bundled
  }
}

/** Sends the status to the renderer if it changed. */
function publish(): void {
  const status = currentStatus()
  const json = JSON.stringify(status)
  if (json === lastStatus) return
  lastStatus = json
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send(IPC.buttonsStatusChanged, status)
}

function broadcastPress(event: StillButtonEvent): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.buttonsPressed, event)
}

/** Asks the service manager whether the service exists (exit code 1060 = it does not). */
function refreshInstalled(): Promise<void> {
  return new Promise((resolve) => {
    execFile('sc.exe', ['query', SERVICE_NAME], { windowsHide: true }, (error) => {
      installed = !error || error.code !== ERROR_SERVICE_DOES_NOT_EXIST
      resolve()
    })
  })
}

const isHexId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{4}$/.test(value)

function onLine(line: string): void {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(line)
  } catch {
    return
  }
  if (data.type === 'status') {
    serviceVersion = typeof data.version === 'number' ? data.version : null
    capture = CAPTURE_STATES.includes(data.state as ButtonCaptureState)
      ? (data.state as ButtonCaptureState)
      : 'error'
    message = typeof data.message === 'string' ? data.message : null
    publish()
  } else if (data.type === 'button' && serviceVersion === PROTOCOL_VERSION) {
    if (isHexId(data.vendorId) && isHexId(data.productId) && typeof data.pressed === 'boolean') {
      broadcastPress({ vendorId: data.vendorId, productId: data.productId, pressed: data.pressed })
    }
  }
}

function sendWatch(): void {
  if (connected) socket?.write(JSON.stringify({ watch: watched }) + '\n')
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    connectPipe()
  }, RECONNECT_DELAY)
}

function connectPipe(): void {
  if (!supported || stopped || socket) return
  const pipe = connect(PIPE_PATH)
  socket = pipe
  let buffer = ''
  pipe.setEncoding('utf8')
  pipe.on('connect', () => {
    connected = true
    installed = true
    sendWatch()
    publish()
  })
  pipe.on('data', (chunk: string) => {
    buffer += chunk
    let end: number
    while ((end = buffer.indexOf('\n')) >= 0) {
      onLine(buffer.slice(0, end))
      buffer = buffer.slice(end + 1)
    }
    if (buffer.length > MAX_LINE_LENGTH) pipe.destroy()
  })
  // 'close' follows every error.
  pipe.on('error', () => undefined)
  pipe.on('close', () => {
    const wasConnected = connected
    socket = null
    connected = false
    serviceVersion = null
    capture = null
    message = null
    // The service went away – stopped or uninstalled?
    if (wasConnected) void refreshInstalled().then(publish)
    publish()
    scheduleReconnect()
  })
}

/** Connects right away and resolves once connected or after `timeout`. */
async function waitForConnection(timeout: number): Promise<void> {
  const deadline = Date.now() + timeout
  while (!connected && Date.now() < deadline) {
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
    connectPipe()
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/**
 * Runs `cameradraw-buttons.exe install|uninstall` with admin rights – Windows shows its UAC prompt.
 * PowerShell's Start-Process is the simplest way to ask for elevation from Node.
 */
function runElevated(command: 'install' | 'uninstall'): Promise<void> {
  const exe = serviceExecutable()
  if (!existsSync(exe)) {
    return Promise.reject(
      new Error('Der Dienst ist in dieser Version von CameraDraw nicht enthalten.')
    )
  }
  const script =
    `try { $p = Start-Process -FilePath $env:CAMERADRAW_SERVICE_EXE -ArgumentList '${command}' ` +
    `-Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode } catch { exit ${ERROR_CANCELLED} }`
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, env: { ...process.env, CAMERADRAW_SERVICE_EXE: exe } },
      (error) => {
        const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0
        if (code === 0) resolve()
        else if (code === ERROR_CANCELLED)
          reject(new Error('Die Windows-Abfrage wurde abgebrochen.'))
        else reject(new Error(`Der Dienst meldet Fehlercode ${code}.`))
      }
    )
  })
}

async function install(): Promise<ButtonServiceStatus> {
  await runElevated('install')
  installed = true
  // Drop an old connection (e.g. to an outdated service) and connect to the new one.
  socket?.destroy()
  await waitForConnection(START_TIMEOUT)
  publish()
  return currentStatus()
}

async function uninstall(): Promise<ButtonServiceStatus> {
  await runElevated('uninstall')
  socket?.destroy()
  await refreshInstalled()
  publish()
  return currentStatus()
}

/** Only well-formed ids from the renderer, at most `MAX_WATCHED`. */
export function sanitizeDevices(devices: unknown): UsbDeviceId[] {
  if (!Array.isArray(devices)) return []
  return devices
    .filter(
      (d): d is UsbDeviceId =>
        typeof d === 'object' && d !== null && isHexId(d.vendorId) && isHexId(d.productId)
    )
    .slice(0, MAX_WATCHED)
    .map((d) => ({ vendorId: d.vendorId, productId: d.productId }))
}

export function registerButtonIpc(): void {
  ipcMain.handle(IPC.buttonsStatus, async () => {
    if (supported && !connected) await refreshInstalled()
    lastStatus = JSON.stringify(currentStatus())
    return currentStatus()
  })
  ipcMain.on(IPC.buttonsWatch, (_e, devices: unknown) => {
    watched = sanitizeDevices(devices)
    sendWatch()
  })
  ipcMain.handle(IPC.buttonsInstall, () => install())
  ipcMain.handle(IPC.buttonsUninstall, () => uninstall())
}

/** Connects to the service and keeps reconnecting while the app runs. */
export function startButtonService(): void {
  if (!supported) return
  void refreshInstalled().then(publish)
  connectPipe()
  app.on('before-quit', () => {
    stopped = true
    clearTimeout(reconnectTimer)
    socket?.destroy()
  })
}

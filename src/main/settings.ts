import { app } from 'electron'
import { accessSync, constants, existsSync, readFileSync, statSync } from 'fs'
import { rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { DEFAULT_MCP_PORT } from '@shared/mcp'
import type { AppSettings, AppState } from '@shared/types'

const DEFAULTS: AppSettings = {
  saveDir: null,
  cameraId: null,
  cameraLabel: null,
  mirror: false,
  ambientLight: true,
  preferCameraZoom: true,
  stopCameraWhenHidden: true,
  disabledModules: [],
  cameraModules: {},
  cameraScales: {},
  mcpEnabled: false,
  mcpPort: DEFAULT_MCP_PORT
}

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

let current: AppSettings = { ...DEFAULTS }

export function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Record<string, unknown>
    // Only take known keys, so settings removed in newer versions do not linger in the file.
    const known = Object.keys(DEFAULTS).filter((key) => key in raw)
    current = { ...DEFAULTS, ...Object.fromEntries(known.map((key) => [key, raw[key]])) }
  } catch {
    current = { ...DEFAULTS }
  }
  return current
}

export function getSettings(): AppSettings {
  return current
}

export function isWritableDir(dir: string | null): dir is string {
  if (!dir || !existsSync(dir)) return false
  try {
    if (!statSync(dir).isDirectory()) return false
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function getAppState(): AppState {
  return { settings: current, saveDirAvailable: isWritableDir(current.saveDir) }
}

/**
 * Writes run one after another: parallel writes would share the temp file, fail and could leave a
 * broken settings file behind (which loads as the defaults – save folder and camera gone).
 */
let writeQueue: Promise<void> = Promise.resolve()

/** Writes the settings as they are when the write starts, so the last write has the latest. */
async function writeSettings(): Promise<void> {
  // Write atomically so a crash never leaves a half-written settings file behind.
  const file = settingsFile()
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(current, null, 2), 'utf8')
  await rename(tmp, file)
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  current = { ...current, ...patch }
  const write = writeQueue.then(writeSettings)
  // A failed write must not block the ones after it.
  writeQueue = write.catch(() => undefined)
  await write
  return current
}

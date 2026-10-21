import { app } from 'electron'
import { accessSync, constants, existsSync, readFileSync, statSync } from 'fs'
import { rename, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AppSettings, AppState } from '@shared/types'

const DEFAULTS: AppSettings = {
  saveDir: null,
  cameraId: null,
  cameraLabel: null,
  mirror: false,
  ambientLight: true,
  preferCameraZoom: true,
  disabledModules: [],
  cameraModules: {}
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

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  current = { ...current, ...patch }
  // Write atomically so a crash never leaves a half-written settings file behind.
  const file = settingsFile()
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(current, null, 2), 'utf8')
  await rename(tmp, file)
  return current
}

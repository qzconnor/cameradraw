import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import { isMcpTransport, isValidMcpPort } from '@shared/mcp'
import { IPC, type AppSettings, type CameraScale, type SaveImageRequest } from '@shared/types'
import { registerButtonIpc } from './buttons'
import { listSystemCameras } from './cameras'
import { registerControlsIpc } from './controls'
import { applyMcpSettings, registerMcpIpc } from './mcp/server'
import { getAppState, getSettings, isWritableDir, updateSettings } from './settings'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  listReleases
} from './updater'
import {
  copyImageToClipboard,
  readImageFile,
  createProject,
  listLibrary,
  loadImage,
  moveImage,
  removeImage,
  removeProject,
  renameImage,
  renameProject,
  reveal,
  saveImage,
  watchLibrary,
  writeImageToClipboard
} from './library'

let stopWatching: (() => void) | undefined

function broadcastLibraryChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.libraryChanged)
}

/** (Re)starts the folder watcher for the current save folder. */
export function restartLibraryWatcher(): void {
  stopWatching?.()
  stopWatching = undefined
  const dir = getSettings().saveDir
  if (isWritableDir(dir)) stopWatching = watchLibrary(dir, broadcastLibraryChanged)
}

function requireSaveDir(): string {
  const dir = getSettings().saveDir
  if (!isWritableDir(dir)) throw new Error('Der Speicherordner ist nicht verfügbar.')
  return dir
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string')

const isStringRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.keys(v).length <= 200 &&
  Object.values(v).every((s) => typeof s === 'string')

const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

const isScaleRecord = (v: unknown): v is Record<string, CameraScale> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.keys(v).length <= 200 &&
  Object.values(v).every(
    (s) =>
      typeof s === 'object' &&
      s !== null &&
      isPositive(s.micronsPerPixel) &&
      isPositive(s.frameWidth)
  )

/** Only accept known keys with the right type from the renderer. */
function sanitizePatch(patch: unknown): Partial<AppSettings> {
  const p = (patch ?? {}) as Record<string, unknown>
  const out: Partial<AppSettings> = {}
  const nullableString = (v: unknown): v is string | null => v === null || typeof v === 'string'
  if ('saveDir' in p && nullableString(p.saveDir)) out.saveDir = p.saveDir
  if ('cameraId' in p && nullableString(p.cameraId)) out.cameraId = p.cameraId
  if ('cameraLabel' in p && nullableString(p.cameraLabel)) out.cameraLabel = p.cameraLabel
  if (typeof p.mirror === 'boolean') out.mirror = p.mirror
  if (typeof p.ambientLight === 'boolean') out.ambientLight = p.ambientLight
  if (typeof p.preferCameraZoom === 'boolean') out.preferCameraZoom = p.preferCameraZoom
  if (typeof p.stopCameraWhenHidden === 'boolean') out.stopCameraWhenHidden = p.stopCameraWhenHidden
  if (typeof p.mcpEnabled === 'boolean') out.mcpEnabled = p.mcpEnabled
  if (isMcpTransport(p.mcpTransport)) out.mcpTransport = p.mcpTransport
  if (isValidMcpPort(p.mcpPort)) out.mcpPort = p.mcpPort
  if (isStringArray(p.disabledModules)) out.disabledModules = p.disabledModules.slice(0, 100)
  if (isStringRecord(p.cameraModules)) out.cameraModules = p.cameraModules
  if (isScaleRecord(p.cameraScales)) {
    out.cameraScales = Object.fromEntries(
      Object.entries(p.cameraScales).map(([label, s]) => [
        label,
        { micronsPerPixel: s.micronsPerPixel, frameWidth: s.frameWidth }
      ])
    )
  }
  return out
}

export function registerIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => getAppState())

  ipcMain.handle(IPC.settingsUpdate, async (_e, patch: unknown) => {
    const clean = sanitizePatch(patch)
    if (clean.saveDir !== undefined && clean.saveDir !== null && !isWritableDir(clean.saveDir)) {
      throw new Error('In diesen Ordner kann nicht geschrieben werden.')
    }
    const before = getSettings().saveDir
    await updateSettings(clean)
    if (getSettings().saveDir !== before) restartLibraryWatcher()
    if (['mcpEnabled', 'mcpTransport', 'mcpPort'].some((key) => key in clean)) {
      void applyMcpSettings()
    }
    return getAppState()
  })

  ipcMain.handle(IPC.pickFolder, async (e, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Speicherordner wählen',
      buttonLabel: 'Ordner wählen',
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.libraryList, async () => {
    const dir = getSettings().saveDir
    return isWritableDir(dir) ? listLibrary(dir) : { projects: [], items: [] }
  })

  // Paths and names are validated by the library functions (resolveInLibrary / nameError).
  ipcMain.handle(IPC.librarySave, (_e, req: SaveImageRequest) => saveImage(requireSaveDir(), req))
  ipcMain.handle(IPC.libraryLoad, (_e, path: string) => loadImage(requireSaveDir(), path))
  ipcMain.handle(IPC.libraryRemove, (_e, path: string) => removeImage(requireSaveDir(), path))
  ipcMain.handle(IPC.libraryMove, (_e, path: string, project: unknown) =>
    moveImage(requireSaveDir(), path, typeof project === 'string' ? project : null)
  )
  ipcMain.handle(IPC.libraryRename, (_e, path: string, name: string) =>
    renameImage(requireSaveDir(), path, name)
  )
  ipcMain.handle(IPC.libraryReveal, (_e, path: string) => reveal(requireSaveDir(), path))
  ipcMain.handle(IPC.libraryOpenFolder, () => shell.openPath(requireSaveDir()))
  ipcMain.handle(IPC.libraryReadImage, (_e, path: string) => readImageFile(requireSaveDir(), path))
  ipcMain.handle(IPC.libraryCopyImage, (_e, path: string) =>
    copyImageToClipboard(requireSaveDir(), path)
  )
  ipcMain.handle(IPC.clipboardWriteImage, (_e, png: unknown) => {
    if (!(png instanceof Uint8Array)) throw new Error('Kein Bild zum Kopieren.')
    return writeImageToClipboard(nativeImage.createFromBuffer(Buffer.from(png)))
  })
  ipcMain.handle(IPC.clipboardWriteText, (_e, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text)
  })
  ipcMain.handle(IPC.libraryCreateProject, (_e, name: string) =>
    createProject(requireSaveDir(), name)
  )
  ipcMain.handle(IPC.libraryRenameProject, (_e, from: string, to: string) =>
    renameProject(requireSaveDir(), from, to)
  )
  ipcMain.handle(IPC.libraryRemoveProject, (_e, name: string) =>
    removeProject(requireSaveDir(), name)
  )

  ipcMain.handle(IPC.systemCameras, () => listSystemCameras())

  ipcMain.handle(IPC.updatesState, () => getUpdateState())
  ipcMain.handle(IPC.updatesCheck, () => checkForUpdates())
  ipcMain.handle(IPC.updatesDownload, () => downloadUpdate())
  ipcMain.on(IPC.updatesInstall, () => installUpdate())
  ipcMain.handle(IPC.updatesReleases, () => listReleases())

  registerButtonIpc()
  registerControlsIpc()
  registerMcpIpc()
}

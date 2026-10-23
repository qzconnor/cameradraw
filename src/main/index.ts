import { app, BrowserWindow, nativeTheme, session, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC } from '@shared/types'
import icon from '../../resources/icon.png?asset'
import { getSettings, loadSettings } from './settings'
import { handleMediaProtocol, registerMediaScheme } from './protocol'
import { startButtonService } from './buttons'
import { registerIpc, restartLibraryWatcher } from './ipc'
import { applyMcpSettings } from './mcp/server'
import { isStdioRelay, runStdioRelay } from './mcp/stdio'
import { startUpdater } from './updater'
import { loadWindowState, trackWindowState } from './window-state'

// Matches the `--sidebar` token of the dark theme so the native window controls blend in.
const CHROME_COLOR = '#171717'
// One pixel less than the 44px title bar, so its bottom border stays visible under the controls.
const TITLEBAR_HEIGHT = 43

// The end-to-end tests (e2e/) give every run a throwaway profile, so they never touch the real
// settings – Electron ignores a redirected %APPDATA%.
const testUserData = process.env['CAMERADRAW_USER_DATA']
if (testUserData) app.setPath('userData', testUserData)

registerMediaScheme()

/** Brings a window to the front, also out of the taskbar. */
function bringToFront(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.focus()
}

function createWindow(): void {
  const saved = loadWindowState()
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    // Size and position of the last session (otherwise centred).
    ...saved?.bounds,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'CameraDraw',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin'
      ? {
          titleBarOverlay: { color: CHROME_COLOR, symbolColor: '#fafafa', height: TITLEBAR_HEIGHT }
        }
      : {}),
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (saved?.maximized) mainWindow.maximize()
    mainWindow.show()
  })
  trackWindowState(mainWindow)

  // The camera may be switched off while the window is minimized (see `stopCameraWhenHidden`).
  const sendMinimized = (minimized: boolean): void =>
    mainWindow.webContents.send(IPC.windowMinimized, minimized)
  mainWindow.on('minimize', () => sendMinimized(true))
  mainWindow.on('restore', () => sendMinimized(false))

  // The renderer keeps the window open because a drawing is unsaved and asks in its own dialog –
  // make sure it is seen, e.g. when the window was closed from the taskbar while minimized.
  mainWindow.webContents.on('will-prevent-unload', () => bringToFront(mainWindow))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Links (e.g. in the release notes) open in the browser instead of replacing the app.
  const devServer = process.env['ELECTRON_RENDERER_URL']
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (devServer && url.startsWith(devServer)) return
    event.preventDefault()
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Grant camera access and the list of installed fonts (for texts), deny everything else. */
function setupPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'local-fonts') return callback(true)
    if (permission !== 'media') return callback(false)
    const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    callback(types.every((t) => t === 'video'))
  })
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission) => permission === 'media' || permission === 'local-fonts'
  )
}

function start(): void {
  electronApp.setAppUserModelId('com.cameradraw.app')
  nativeTheme.themeSource = 'dark'

  // F12 opens DevTools in development; Ctrl+R is ignored in production.
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  loadSettings()
  setupPermissions()
  handleMediaProtocol(() => getSettings().saveDir)
  registerIpc()
  restartLibraryWatcher()
  startButtonService()

  createWindow()
  startUpdater()
  // Only if switched on in the settings.
  void applyMcpSettings()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

// Started by an MCP client (`cameradraw.exe --mcp`): no window, only the connection to the app.
// The installed app runs once: a second start would find the camera busy and run its own updater
// and folder watcher, so it quits and brings the open window to the front instead. Not during
// development – the lock is per profile, and `npm run dev` shares it with the installed app.
if (isStdioRelay()) {
  runStdioRelay()
} else if (!app.isPackaged || app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) bringToFront(win)
  })
  app.whenReady().then(start)
} else {
  app.quit()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

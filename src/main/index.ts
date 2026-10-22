import { app, BrowserWindow, nativeTheme, session, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getSettings, loadSettings } from './settings'
import { handleMediaProtocol, registerMediaScheme } from './protocol'
import { startButtonService } from './buttons'
import { registerIpc, restartLibraryWatcher } from './ipc'
import { startUpdater } from './updater'

// Matches the `--sidebar` token of the dark theme so the native window controls blend in.
const CHROME_COLOR = '#171717'
// One pixel less than the 44px title bar, so its bottom border stays visible under the controls.
const TITLEBAR_HEIGHT = 43

registerMediaScheme()

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
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

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // The renderer keeps the window open because a drawing is unsaved and asks in its own dialog –
  // make sure it is seen, e.g. when the window was closed from the taskbar while minimized.
  mainWindow.webContents.on('will-prevent-unload', () => {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

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

/** Grant camera access, deny everything else. */
function setupPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission !== 'media') return callback(false)
    const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    callback(types.every((t) => t === 'video'))
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')
}

app.whenReady().then(() => {
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

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

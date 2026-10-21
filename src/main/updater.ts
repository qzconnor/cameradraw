import { app, BrowserWindow, Notification, net } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { IPC, type ReleaseNote, type UpdateState } from '@shared/types'

/**
 * Updates come from the GitHub releases of the repository (published by semantic-release, see
 * `.releaserc.json`). The publish settings in `electron-builder.yml` tell electron-updater where.
 */
const REPO = 'qzconnor/cameradraw'
const FIRST_CHECK_DELAY = 10_000
const CHECK_INTERVAL = 4 * 60 * 60 * 1000
const RELEASES_CACHE = 10 * 60 * 1000

let state: UpdateState = {
  // Only an installed app can update itself.
  status: app.isPackaged ? 'idle' : 'unsupported',
  current: app.getVersion(),
  next: null,
  progress: 0,
  checkedAt: null,
  error: null
}
let notifiedVersion: string | null = null
let releasesCache: { at: number; notes: ReleaseNote[] } | null = null

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.updatesChanged, state)
}

export const getUpdateState = (): UpdateState => state

/** electron-updater appends long HTTP dumps to its errors – the first line is enough. */
const firstLine = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).split('\n')[0]

/** System notification while the window is in the background – otherwise the app shows a hint. */
function notify(version: string): void {
  if (notifiedVersion === version) return
  notifiedVersion = version
  if (BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return
  const notification = new Notification({
    title: 'Update für CameraDraw',
    body: `Version ${version} ist verfügbar und kann direkt in der App installiert werden.`
  })
  notification.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
    win.webContents.send(IPC.updatesShow)
  })
  notification.show()
}

export async function checkForUpdates(): Promise<void> {
  if (['unsupported', 'checking', 'downloading', 'downloaded'].includes(state.status)) return
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    setState({ status: 'error', error: firstLine(err), checkedAt: Date.now() })
  }
}

export async function downloadUpdate(): Promise<void> {
  if (!state.next || !['available', 'error'].includes(state.status)) return
  setState({ status: 'downloading', progress: 0, error: null })
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    setState({ status: 'error', error: firstLine(err) })
  }
}

/** Quits, runs the installer and starts the new version afterwards. */
export function installUpdate(): void {
  if (state.status === 'downloaded') autoUpdater.quitAndInstall(false, true)
}

export function startUpdater(): void {
  if (!app.isPackaged) return
  // Downloading is the user's choice; a downloaded update is also installed when quitting.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking', error: null }))
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setState({ status: 'available', next: info.version, checkedAt: Date.now() })
    notify(info.version)
  })
  autoUpdater.on('update-not-available', () =>
    setState({ status: 'up-to-date', next: null, checkedAt: Date.now() })
  )
  autoUpdater.on('download-progress', (progress: ProgressInfo) =>
    setState({ status: 'downloading', progress: progress.percent })
  )
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    setState({ status: 'downloaded', next: info.version, progress: 100 })
  )
  autoUpdater.on('error', (err) => setState({ status: 'error', error: firstLine(err) }))

  setTimeout(() => void checkForUpdates(), FIRST_CHECK_DELAY)
  setInterval(() => void checkForUpdates(), CHECK_INTERVAL)
}

interface GitHubRelease {
  tag_name: string
  published_at: string | null
  body_html?: string
  html_url: string
  draft: boolean
  prerelease: boolean
}

/** Published releases with their notes, newest first (cached for a few minutes). */
export async function listReleases(): Promise<ReleaseNote[]> {
  if (releasesCache && Date.now() - releasesCache.at < RELEASES_CACHE) return releasesCache.notes
  const response = await net.fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github.html+json', 'User-Agent': 'CameraDraw' }
  })
  if (!response.ok) throw new Error(`GitHub antwortet mit Status ${response.status}.`)
  const releases = (await response.json()) as GitHubRelease[]
  const notes = releases
    .filter((r) => !r.draft && !r.prerelease)
    .map((r) => ({
      version: r.tag_name.replace(/^v/, ''),
      date: r.published_at ?? '',
      html: r.body_html ?? '',
      url: r.html_url
    }))
  releasesCache = { at: Date.now(), notes }
  return notes
}

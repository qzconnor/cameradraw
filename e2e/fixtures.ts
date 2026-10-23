import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { spawnSync } from 'child_process'
import { once } from 'events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { addImage } from './helpers/library'

/** Built by `npm run test:e2e` into a folder of its own, so it never collides with `npm run dev`. */
const MAIN = resolve(__dirname, '../out-e2e/main/index.js')

/** Chromium's fake camera (a green test picture) – a camera on any machine, CI included. */
const FAKE_CAMERA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

export interface Workspace {
  dir: string
  /** Throwaway profile (settings, local storage, window state). */
  profile: string
  /** Save folder; holds `Probe.png` (1920×1080, no layers) to start with. */
  library: string
}

export interface Session {
  app: ElectronApplication
  page: Page
}

interface Fixtures {
  /** Settings of the fresh profile, on top of the save folder. */
  settings: Record<string, unknown>
  workspace: Workspace
  /** Starts CameraDraw on the workspace – again after quitting, e.g. to test a restart. */
  launch: () => Promise<Session>
  session: Session
  app: ElectronApplication
  page: Page
}

/**
 * The environment of the app. Without ELECTRON_RUN_AS_NODE, which terminals of Electron based
 * editors set – Electron would start as plain Node then.
 */
function appEnv(profile: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  return { ...env, CAMERADRAW_USER_DATA: profile }
}

/**
 * Quits the app whatever state it is in. Destroying the windows skips the question about an
 * unsaved drawing, so the app quits by itself; a hanging one is ended with all its processes
 * (on Windows Playwright starts Electron through a shell, so killing that child is not enough).
 */
async function quit(app: ElectronApplication): Promise<void> {
  let child: ReturnType<ElectronApplication['process']>
  try {
    child = app.process()
  } catch {
    return // the app quit during the test, and Playwright has let go of it
  }
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) win.destroy()
    })
    .catch(() => undefined)
  const timer = setTimeout(() => {
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'])
    } else child.kill('SIGKILL')
  }, 10_000)
  await exited
  clearTimeout(timer)
}

export const test = base.extend<Fixtures>({
  settings: [{}, { option: true }],

  workspace: async ({ settings }, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'cameradraw-e2e-'))
    const profile = join(dir, 'profile')
    const library = join(dir, 'library')
    mkdirSync(profile)
    mkdirSync(library)
    writeFileSync(
      join(profile, 'settings.json'),
      JSON.stringify({ saveDir: library, ...settings }, null, 2)
    )
    addImage(library, 'Probe.png')
    await use({ dir, profile, library })
    // Chromium's helper processes let go of the profile a moment after the app has quit.
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  },

  launch: async ({ workspace }, use, testInfo) => {
    const started: Session[] = []
    await use(async () => {
      const app = await electron.launch({
        args: [MAIN, ...FAKE_CAMERA],
        env: appEnv(workspace.profile)
      })
      const page = await app.firstWindow()
      // Ready once the stores exist and the settings are loaded.
      await page.waitForFunction(() => {
        const host = document.querySelector('#app') as { __vue_app__?: unknown } | null
        return !!host?.__vue_app__ && !!document.querySelector('header')
      })
      started.push({ app, page })
      return { app, page }
    })
    for (const { app, page } of started) {
      if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
        const shot = await page.screenshot().catch(() => null)
        if (shot) await testInfo.attach('screenshot', { body: shot, contentType: 'image/png' })
      }
      await quit(app)
    }
  },

  session: async ({ launch }, use) => {
    await use(await launch())
  },
  app: async ({ session }, use) => {
    await use(session.app)
  },
  page: async ({ session }, use) => {
    await use(session.page)
  }
})

export { expect } from '@playwright/test'

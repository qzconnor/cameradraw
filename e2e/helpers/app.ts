import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'

export interface Point {
  x: number
  y: number
}

/**
 * Reads a value of a Pinia store of the running app (e.g. `camera` → `status`). The stores are
 * reachable through the Vue app on `#app`.
 */
export function storeValue<T>(page: Page, store: string, key: string): Promise<T> {
  return page.evaluate(
    ([store, key]) => {
      const host = document.querySelector('#app') as unknown as {
        __vue_app__: { config: { globalProperties: { $pinia: { _s: Map<string, object> } } } }
      }
      const value = (host.__vue_app__.config.globalProperties.$pinia._s.get(store) as never)[key]
      return JSON.parse(JSON.stringify(value ?? null))
    },
    [store, key] as const
  )
}

/** Calls an action of a Pinia store of the running app. */
export async function storeCall(
  page: Page,
  store: string,
  action: string,
  ...args: unknown[]
): Promise<void> {
  await page.evaluate(
    async ([store, action, args]) => {
      const host = document.querySelector('#app') as unknown as {
        __vue_app__: { config: { globalProperties: { $pinia: { _s: Map<string, object> } } } }
      }
      const target = host.__vue_app__.config.globalProperties.$pinia._s.get(store) as Record<
        string,
        (...a: unknown[]) => unknown
      >
      await target[action](...args)
    },
    [store, action, args] as const
  )
}

export async function waitForLiveCamera(page: Page): Promise<void> {
  await expect.poll(() => storeValue(page, 'camera', 'status'), { timeout: 15_000 }).toBe('live')
  // "live" comes with the stream; the first picture can take a moment longer (on a slow runner).
  await expect
    .poll(() => page.locator('main video').evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBeGreaterThan(0)
}

export async function openGallery(page: Page): Promise<void> {
  if ((await storeValue(page, 'panels', 'active')) !== 'gallery') await page.keyboard.press('g')
  await expect(page.getByRole('dialog').filter({ hasText: 'Galerie' })).toBeVisible()
  // Back to the top level if the gallery still shows a project.
  const back = page.getByRole('button', { name: 'Galerie', exact: true })
  if (await back.count()) await back.first().click()
}

export const galleryCard = (page: Page, name: string): Locator =>
  page.getByRole('button', { name: `${name} bearbeiten` })

/** Opens an image of the top level in the editor and waits until it is drawable. */
export async function openImage(page: Page, name: string): Promise<void> {
  await openGallery(page)
  await galleryCard(page, name).click()
  await expect(page.locator('canvas.upper-canvas')).toBeVisible()
  await expect.poll(() => storeValue(page, 'editor', 'loading')).toBe(false)
  await expect(page.locator('.canvas-container')).toBeVisible()
  // The picture itself loads a moment longer (a spinner shows meanwhile).
  await expect(page.locator('main').getByRole('status')).toHaveCount(0)
}

/** Path of the image open in the editor (the session itself holds the image bytes). */
function editorPath(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const host = document.querySelector('#app') as unknown as {
      __vue_app__: { config: { globalProperties: { $pinia: { _s: Map<string, object> } } } }
    }
    const editor = host.__vue_app__.config.globalProperties.$pinia._s.get('editor') as {
      session: { path: string | null } | null
    }
    return editor.session?.path ?? null
  })
}

export async function canvasBox(
  page: Page
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('.canvas-container').boundingBox()
  if (!box) throw new Error('no drawing area')
  return box
}

/** A point of the drawing area, as fractions of its size. */
export async function canvasPoint(page: Page, fx: number, fy: number): Promise<Point> {
  const box = await canvasBox(page)
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

/** Drags with the left mouse button – draws with the current tool. */
export async function drag(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

/** Draws a rectangle with the rectangle tool between two fractions of the drawing area. */
export async function drawRect(page: Page, from = [0.3, 0.3], to = [0.5, 0.5]): Promise<void> {
  await page.keyboard.press('r')
  await drag(page, await canvasPoint(page, from[0], from[1]), await canvasPoint(page, to[0], to[1]))
}

/**
 * Strg+S on an image from the gallery – saved in place, the editor stays open. Waits until the
 * file is written again: an image without changes is not dirty before saving either.
 */
export async function quickSave(page: Page): Promise<void> {
  const path = await editorPath(page)
  const written = async (): Promise<number> =>
    (await storeValue<{ path: string; mtime: number }[]>(page, 'gallery', 'items')).find(
      (i) => i.path === path
    )?.mtime ?? 0
  const before = await written()
  await page.keyboard.press('Control+s')
  await expect.poll(written).toBeGreaterThan(before)
  await expect.poll(() => storeValue(page, 'editor', 'dirty')).toBe(false)
  // Toasts are listed newest first; older ones (of saves just before) may be hidden in the stack.
  await expect(toast(page, 'Gespeichert').first()).toBeVisible()
}

export const toast = (page: Page, title: string): Locator =>
  page.locator('[data-sonner-toast]').filter({ hasText: title })

export const discardDialog = (page: Page): Locator =>
  page.getByRole('alertdialog', { name: 'Änderungen verwerfen?' })

export const saveDialog = (page: Page): Locator =>
  page.getByRole('dialog').filter({ has: page.locator('#save-name') })

export function windowCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => 0)
}

/** Closes the window like its X button does. */
export async function closeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
}

import { execFileSync } from 'child_process'
import { join } from 'path'
import { expect, test } from './fixtures'
import { drawRect, galleryCard, openGallery, openImage, storeValue, toast } from './helpers/app'

/**
 * The clipboard belongs to the whole system: the tests keep what is on it and put it back. Items
 * read with clipboard.read() cannot be written again, so their data is copied out first.
 */
test.beforeEach(async ({ app }) => {
  await app.evaluate(async ({ clipboard }) => {
    const saved: Record<string, Blob | string>[] = []
    for (const item of await clipboard.read().catch(() => [])) {
      const data: Record<string, Blob | string> = {}
      for (const type of item.types) data[type] = (await item.getType(type)) as Blob | string
      saved.push(data)
    }
    ;(globalThis as { savedClipboard?: unknown }).savedClipboard = saved
  })
})

test.afterEach(async ({ app }) => {
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const saved = (globalThis as { savedClipboard?: Record<string, Blob | string>[] })
      .savedClipboard
    if (saved?.length) await clipboard.write(saved.map((data) => new ClipboardItem(data)))
    else await clipboard.clear()
  })
})

/** Size of the image on the clipboard as Electron sees it; keeps its pixels for comparisons. */
async function clipboardImage(
  app: import('@playwright/test').ElectronApplication
): Promise<{ width: number; height: number } | null> {
  return app.evaluate(async ({ clipboard, nativeImage }) => {
    const item = (await clipboard.read()).find((i) => i.types.includes('image/png'))
    if (!item) return null
    const blob = (await item.getType('image/png')) as Blob
    const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
    ;(globalThis as { clipBitmap?: Buffer }).clipBitmap = image.toBitmap()
    return image.getSize()
  })
}

/** What a Windows program (WinForms) can paste from the clipboard. */
function windowsClipboard(): string {
  return execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; $i = [System.Windows.Forms.Clipboard]::GetImage(); if ($i) { "$($i.Width)x$($i.Height)" } else { "none" }'
    ],
    { encoding: 'utf8' }
  ).trim()
}

test('"Bild kopieren" in the gallery puts the image on the clipboard', async ({ app, page }) => {
  await openGallery(page)
  await galleryCard(page, 'Probe.png').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Bild kopieren' }).click()
  await expect(toast(page, 'Bild kopiert')).toBeVisible()
  expect(await clipboardImage(app)).toEqual({ width: 1920, height: 1080 })
  if (process.platform === 'win32') expect(windowsClipboard()).toBe('1920x1080')
})

test('copying in the editor includes the drawing and saves nothing', async ({
  app,
  page,
  workspace
}) => {
  await openImage(page, 'Probe.png')
  await drawRect(page, [0.3, 0.3], [0.5, 0.5])
  await page.keyboard.press('Control+Shift+C')
  await expect(toast(page, 'Bild kopiert')).toBeVisible()
  expect(await clipboardImage(app)).toEqual({ width: 1920, height: 1080 })

  // Along the top edge of the rectangle (y ≈ 324) the copy differs from the picture on disk.
  const changed = await app.evaluate(
    ({ nativeImage }, file) => {
      const original = nativeImage.createFromPath(file).toBitmap()
      const copy = (globalThis as { clipBitmap?: Buffer }).clipBitmap!
      let differing = 0
      for (let y = 318; y <= 330; y++)
        for (let x = 600; x <= 940; x++) {
          const i = (y * 1920 + x) * 4
          const diff =
            Math.abs(copy[i] - original[i]) +
            Math.abs(copy[i + 1] - original[i + 1]) +
            Math.abs(copy[i + 2] - original[i + 2])
          if (diff > 90) differing++
        }
      return differing
    },
    join(workspace.library, 'Probe.png')
  )
  expect(changed).toBeGreaterThan(300)
  expect(await storeValue(page, 'editor', 'dirty')).toBe(true)

  await page.getByRole('button', { name: 'Bild in die Zwischenablage kopieren' }).click()
  await expect(toast(page, 'Bild kopiert').first()).toBeVisible()
})

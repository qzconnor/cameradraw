import { expect, test } from './fixtures'
import {
  canvasPoint,
  closeWindow,
  discardDialog,
  drawRect,
  openImage,
  quickSave,
  storeValue,
  windowCount
} from './helpers/app'

/** An unsaved drawing is never lost without asking (closing, cancelling, update restart). */

test('closing the window with an unsaved drawing asks first', async ({ app, page }) => {
  await openImage(page, 'Probe.png')
  await drawRect(page)

  await closeWindow(app)
  await expect(discardDialog(page)).toBeVisible()
  expect(await windowCount(app)).toBe(1)

  await page.getByRole('button', { name: 'Weiter bearbeiten' }).click()
  await expect(discardDialog(page)).toBeHidden()
  await expect(page.getByRole('button', { name: 'Rückgängig' })).toBeEnabled()

  await closeWindow(app)
  await page.getByRole('button', { name: 'Verwerfen' }).click()
  await expect.poll(() => windowCount(app)).toBe(0)
})

test('a minimized window comes back to ask', async ({ app, page }) => {
  await openImage(page, 'Probe.png')
  await drawRect(page)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
  await closeWindow(app)
  await expect(discardDialog(page)).toBeVisible()
  expect(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())
  ).toBe(false)
})

test('without changes the window closes right away', async ({ app, page }) => {
  await openImage(page, 'Probe.png')
  await closeWindow(app)
  await expect.poll(() => windowCount(app)).toBe(0)
})

test('text that is still being typed counts as a change', async ({ app, page }) => {
  await openImage(page, 'Probe.png')
  await page.keyboard.press('t')
  await page.mouse.click(...xy(await canvasPoint(page, 0.4, 0.4)))
  await page.keyboard.type('Hallo')

  await page.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(discardDialog(page)).toBeVisible()
  await page.getByRole('button', { name: 'Weiter bearbeiten' }).click()
  await expect(discardDialog(page)).toBeHidden()

  await closeWindow(app)
  await expect(discardDialog(page)).toBeVisible()
  expect(await windowCount(app)).toBe(1)
})

test('typing a text away again leaves nothing to ask about', async ({ page }) => {
  await openImage(page, 'Probe.png')
  await page.keyboard.press('t')
  await page.mouse.click(...xy(await canvasPoint(page, 0.4, 0.4)))
  await page.keyboard.type('Hallo')
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace')
  await page.getByRole('button', { name: 'Abbrechen' }).click()
  await expect.poll(() => storeValue(page, 'editor', 'isOpen')).toBe(false)
})

test('clicking into a saved text without typing is no change', async ({ page }) => {
  await openImage(page, 'Probe.png')
  await page.keyboard.press('t')
  const at = await canvasPoint(page, 0.4, 0.4)
  await page.mouse.click(at.x, at.y)
  await page.keyboard.type('Bums')
  await page.keyboard.press('Escape') // leaves the text
  await quickSave(page)

  await page.mouse.click(at.x + 10, at.y + 15) // into the text, starts editing
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA')
  await page.getByRole('button', { name: 'Abbrechen' }).click()
  await expect.poll(() => storeValue(page, 'editor', 'isOpen')).toBe(false)
})

test('restarting for an update asks first and installs only after confirming', async ({
  app,
  page
}) => {
  // Count install requests reaching the main process (the dev build cannot install anything).
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as { installRequests?: number }
    g.installRequests = 0
    ipcMain.on('updates:install', () => (g.installRequests = (g.installRequests ?? 0) + 1))
  })
  const installRequests = (): Promise<number> =>
    app.evaluate(() => (globalThis as { installRequests?: number }).installRequests ?? 0)

  await openImage(page, 'Probe.png')
  await drawRect(page)
  // An update is ready – as the updater would report it.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('updates:changed', {
      status: 'downloaded',
      current: '1.0.0',
      next: '1.0.1',
      progress: 100,
      checkedAt: Date.now(),
      error: null
    })
  )

  await page.getByRole('button', { name: 'Jetzt neu starten', exact: true }).click()
  await expect(discardDialog(page)).toBeVisible()
  await page.getByRole('button', { name: 'Weiter bearbeiten' }).click()
  expect(await installRequests()).toBe(0)

  await page.getByRole('button', { name: 'Update', exact: true }).click()
  await page.getByRole('button', { name: 'Jetzt neu starten und installieren' }).click()
  await expect(discardDialog(page)).toBeVisible()
  await page.getByRole('button', { name: 'Verwerfen' }).click()
  await expect.poll(installRequests).toBe(1)
})

const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y]

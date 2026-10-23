import { expect, test } from './fixtures'
import { galleryCard, openGallery, storeCall, storeValue, waitForLiveCamera } from './helpers/app'

/** The camera view with Chromium's fake camera. */

/** A press of a device's photo button, as the microscope module reports it. */
const photoButton = (page: import('@playwright/test').Page): Promise<void> =>
  storeCall(page, 'camera', 'requestCapture')
const editorOpen = (page: import('@playwright/test').Page): Promise<boolean> =>
  storeValue(page, 'editor', 'isOpen')

test('the photo button freezes the picture with the gallery open and closes it', async ({
  page
}) => {
  await waitForLiveCamera(page)
  await openGallery(page)
  await photoButton(page)
  await expect.poll(() => editorOpen(page)).toBe(true)
  expect(await storeValue(page, 'panels', 'active')).toBeNull()
})

test('the photo button does nothing while a menu or dialog is open', async ({ page }) => {
  await waitForLiveCamera(page)
  await openGallery(page)
  await galleryCard(page, 'Probe.png').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Umbenennen' })).toBeVisible()
  await photoButton(page)
  await page.waitForTimeout(800)
  expect(await editorOpen(page)).toBe(false)

  await page.getByRole('menuitem', { name: 'Umbenennen' }).click()
  await expect(page.getByRole('dialog', { name: 'Bild umbenennen' })).toBeVisible()
  await photoButton(page)
  await page.waitForTimeout(800)
  expect(await editorOpen(page)).toBe(false)
})

test('P pauses the camera and resumes it', async ({ page }) => {
  await waitForLiveCamera(page)
  await page.mouse.click(5, 300) // focus on the stage, not on a button
  await page.keyboard.press('p')
  await expect.poll(() => storeValue(page, 'camera', 'paused')).toBe(true)
  await expect.poll(() => storeValue(page, 'camera', 'status')).toBe('off')
  await expect(page.getByText('Kamera pausiert', { exact: true })).toBeVisible()
  await page.keyboard.press('p')
  await waitForLiveCamera(page)
})

test('the camera is off while the window is minimized', async ({ app, page }) => {
  await waitForLiveCamera(page)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
  await expect.poll(() => storeValue(page, 'camera', 'status')).toBe('off')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())
  await waitForLiveCamera(page)
})

test.describe('with "Kamera ausschalten" off', () => {
  test.use({ settings: { stopCameraWhenHidden: false } })

  test('the camera keeps running while minimized', async ({ app, page }) => {
    await waitForLiveCamera(page)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
    await page.waitForTimeout(1000)
    expect(await storeValue(page, 'camera', 'status')).toBe('live')
  })
})

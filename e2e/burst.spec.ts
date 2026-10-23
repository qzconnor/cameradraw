import { readdirSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  galleryCard,
  openGallery,
  saveDialog,
  storeCall,
  storeValue,
  toast,
  waitForLiveCamera
} from './helpers/app'
import { addImage, readLayers } from './helpers/library'

/** Burst capture: pictures are saved right away instead of opened in the editor. */

const CAMERA = 'fake_device_0'
const STAMPED = /^CameraDraw_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_\d+)?\.png$/

/** New pictures in a folder of the library (`''` for the save folder itself). */
const captures = (library: string, project = ''): string[] =>
  readdirSync(join(library, project))
    .filter((name) => STAMPED.test(name))
    .sort()

const editorOpen = (page: Page): Promise<boolean> => storeValue(page, 'editor', 'isOpen')
const burstToggle = (page: Page): import('@playwright/test').Locator =>
  page.getByRole('button', { name: 'Serienaufnahme', exact: true })
const projectPicker = (page: Page): import('@playwright/test').Locator =>
  page.getByRole('button', { name: 'Projekt für die Serienaufnahme' })

async function pickProject(page: Page, name: string): Promise<void> {
  await projectPicker(page).click()
  await page.getByRole('menuitemradio', { name }).click()
  await expect(projectPicker(page)).toHaveText(name)
}

test('Shift+Space saves a picture without opening the editor', async ({ page, workspace }) => {
  await waitForLiveCamera(page)
  await page.keyboard.press('Shift+Space')
  await expect(toast(page, 'Bild gespeichert')).toBeVisible()
  expect(await editorOpen(page)).toBe(false)

  const [name] = captures(workspace.library)
  expect(name).toBeDefined()
  const doc = readLayers(workspace.library, name)
  expect(doc.objects).toEqual([])
  expect(doc.capture).toEqual({ zoom: 1, frameWidth: 1920 })
  expect(doc.capturedAt).toBeGreaterThan(Date.now() - 60_000)
  expect(doc.micronsPerPixel).toBeUndefined()
  await expect(toast(page, 'Bild gespeichert')).toContainText(name)

  // "Bearbeiten" in the toast opens it – editable like any other image.
  await toast(page, 'Bild gespeichert').getByRole('button', { name: 'Bearbeiten' }).click()
  await expect.poll(() => editorOpen(page)).toBe(true)
  expect(await storeValue<{ path: string }>(page, 'editor', 'session')).toMatchObject({
    path: name
  })

  // Space alone still opens the editor while burst capture is off.
  await page.keyboard.press('Escape')
  await waitForLiveCamera(page)
  await page.keyboard.press('Space')
  await expect.poll(() => editorOpen(page)).toBe(true)
})

test('in burst capture Space, the shutter and the photo button save into the chosen project', async ({
  page,
  workspace
}) => {
  addImage(workspace.library, 'Probe 12/Übersicht.png')
  await waitForLiveCamera(page)
  await burstToggle(page).click()
  await expect(burstToggle(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(projectPicker(page)).toHaveText('Kein Projekt')
  await pickProject(page, 'Probe 12')

  // Three pictures in quick succession – mostly within the same second.
  await page.mouse.click(5, 300) // focus on the stage, not on the menu button
  for (let i = 0; i < 3; i++) await page.keyboard.press('Space')
  await expect.poll(() => captures(workspace.library, 'Probe 12').length).toBe(3)
  await expect(page.getByText('3 Bilder', { exact: true })).toBeVisible()
  await expect(toast(page, '3 Bilder gespeichert')).toBeVisible()
  expect(await editorOpen(page)).toBe(false)

  await page.getByRole('button', { name: 'Bild speichern' }).click()
  await expect.poll(() => captures(workspace.library, 'Probe 12').length).toBe(4)

  // The photo button with the gallery open: the gallery stays and shows the new picture.
  await openGallery(page)
  await page.getByRole('button', { name: 'Projekt Probe 12 öffnen' }).click()
  await storeCall(page, 'camera', 'requestCapture')
  await expect.poll(() => captures(workspace.library, 'Probe 12').length).toBe(5)
  const newest = captures(workspace.library, 'Probe 12').at(-1)!
  await expect(galleryCard(page, newest)).toBeVisible()
  expect(await storeValue(page, 'panels', 'active')).toBe('gallery')
  expect(await editorOpen(page)).toBe(false)
  expect(captures(workspace.library)).toEqual([])
})

test('a burst picture gets the scale of the camera', async ({ page, workspace }) => {
  await waitForLiveCamera(page)
  await storeCall(page, 'settings', 'update', {
    cameraScales: { [CAMERA]: { micronsPerPixel: 5, frameWidth: 1920 } }
  })
  await storeCall(page, 'camera', 'setZoom', 2)
  await page.keyboard.press('Shift+Space')
  await expect.poll(() => captures(workspace.library).length).toBe(1)
  const doc = readLayers(workspace.library, captures(workspace.library)[0])
  expect(doc.micronsPerPixel).toBeCloseTo(2.5, 6)
  expect(doc.capture).toEqual({ zoom: 2, frameWidth: 1920 })
})

test('a new project from the burst bar is used for burst and later saves', async ({
  launch,
  workspace
}) => {
  const first = await launch()
  let page = first.page
  await waitForLiveCamera(page)
  await burstToggle(page).click()
  await projectPicker(page).click()
  await page.getByRole('menuitem', { name: 'Neues Projekt …' }).click()
  const dialog = page.getByRole('dialog', { name: 'Neues Projekt' })
  await dialog.getByRole('textbox').fill('Serie A')
  await dialog.getByRole('button', { name: 'Anlegen' }).click()
  await expect(projectPicker(page)).toHaveText('Serie A')
  await page.mouse.click(5, 300)
  await page.keyboard.press('Space')
  await expect.poll(() => captures(workspace.library, 'Serie A').length).toBe(1)

  // After a restart burst capture is still on and still saves into "Serie A".
  await first.app.close()
  page = (await launch()).page
  await waitForLiveCamera(page)
  await expect(burstToggle(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(projectPicker(page)).toHaveText('Serie A')

  // Switched off: Space opens the editor, and saving suggests the same project.
  await burstToggle(page).click()
  await expect(projectPicker(page)).toHaveCount(0)
  await page.mouse.click(5, 300)
  await page.keyboard.press('Space')
  await expect.poll(() => editorOpen(page)).toBe(true)
  await page.keyboard.press('Control+s')
  await expect(saveDialog(page).locator('#save-project')).toHaveText('Serie A')
})

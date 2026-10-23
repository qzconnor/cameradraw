import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { expect, test } from './fixtures'
import {
  discardDialog,
  drawRect,
  openImage,
  quickSave,
  saveDialog,
  storeValue,
  toast,
  waitForEditor,
  waitForLiveCamera
} from './helpers/app'
import { addImage, readLayers } from './helpers/library'

test('Strg+S saves an image from the gallery in place and keeps the editor open', async ({
  page,
  workspace
}) => {
  const file = join(workspace.library, 'Probe.png')
  const before = statSync(file).mtimeMs
  await openImage(page, 'Probe.png')
  await drawRect(page)
  await quickSave(page)
  await expect(saveDialog(page)).toBeHidden()
  expect(await storeValue(page, 'editor', 'isOpen')).toBe(true)
  expect(statSync(file).mtimeMs).toBeGreaterThan(before)
  expect(readLayers(workspace.library, 'Probe.png').objects).toHaveLength(1)

  // The button does the same; afterwards Esc leaves without asking.
  await drawRect(page, [0.6, 0.6], [0.7, 0.7])
  await page.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect.poll(() => storeValue(page, 'editor', 'dirty')).toBe(false)
  expect(readLayers(workspace.library, 'Probe.png').objects).toHaveLength(2)
  await page.keyboard.press('Escape')
  await expect.poll(() => storeValue(page, 'editor', 'isOpen')).toBe(false)
  await expect(discardDialog(page)).toBeHidden()
})

test('"Speichern unter" can keep the original and save a copy', async ({ launch, workspace }) => {
  addImage(workspace.library, 'Temp.png', { layers: { capturedAt: 1_700_000_000_000 } })
  const original = readFileSync(join(workspace.library, '.cameradraw', 'Temp.json'), 'utf8')
  const originalTime = statSync(join(workspace.library, 'Temp.png')).mtimeMs
  const { page } = await launch()
  await openImage(page, 'Temp.png')
  await drawRect(page)

  // Through the menu next to "Speichern" – it has to open on screen.
  await page.getByRole('button', { name: 'Weitere Speicheroptionen' }).click()
  const item = page.getByRole('menuitem', { name: /Speichern unter/ })
  const box = await item.boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(box && box.y >= 0 && box.y + box.height <= viewport.height).toBe(true)
  expect(box!.height).toBeLessThan(40) // one line
  await item.click()

  await expect(saveDialog(page).getByRole('heading')).toHaveText('Speichern unter')
  await saveDialog(page).getByText('Als Kopie speichern').click()
  await expect(page.locator('#save-name')).toHaveValue('Temp Kopie')
  await saveDialog(page).getByRole('button', { name: 'Speichern' }).click()
  await expect(toast(page, 'Kopie gespeichert')).toBeVisible()

  expect(existsSync(join(workspace.library, 'Temp Kopie.png'))).toBe(true)
  expect(readLayers(workspace.library, 'Temp Kopie.png').capturedAt).toBe(1_700_000_000_000)
  expect(readFileSync(join(workspace.library, '.cameradraw', 'Temp.json'), 'utf8')).toBe(original)
  expect(statSync(join(workspace.library, 'Temp.png')).mtimeMs).toBe(originalTime)
  await expect.poll(() => storeValue(page, 'editor', 'isOpen')).toBe(false)

  // The next copy gets the next free name; switching back restores the name.
  await openImage(page, 'Temp.png')
  await page.keyboard.press('Control+Shift+S')
  await saveDialog(page).getByText('Als Kopie speichern').click()
  await expect(page.locator('#save-name')).toHaveValue('Temp Kopie 2')
  await saveDialog(page).getByText('Als Kopie speichern').click()
  await expect(page.locator('#save-name')).toHaveValue('Temp')
})

test('a new capture asks for name and project and then returns to the camera', async ({
  page,
  workspace
}) => {
  await waitForLiveCamera(page)
  await page.keyboard.press('Space')
  await waitForEditor(page)
  await drawRect(page)
  await page.keyboard.press('Control+s')
  await expect(saveDialog(page).getByRole('heading')).toHaveText('Bild speichern')
  await expect(saveDialog(page).getByText('Als Kopie speichern')).toHaveCount(0)
  await page.locator('#save-name').fill('Neue Aufnahme')
  await saveDialog(page).getByRole('button', { name: 'Speichern' }).click()
  await expect.poll(() => storeValue(page, 'editor', 'isOpen')).toBe(false)
  expect(existsSync(join(workspace.library, 'Neue Aufnahme.png'))).toBe(true)
  expect(readLayers(workspace.library, 'Neue Aufnahme.png').capture).toEqual({
    zoom: 1,
    frameWidth: 1920
  })
})

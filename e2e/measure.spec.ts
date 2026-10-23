import { readFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from './fixtures'
import {
  canvasBox,
  drag,
  openImage,
  quickSave,
  saveDialog,
  storeCall,
  storeValue,
  toast,
  waitForEditor,
  waitForLiveCamera,
  type Point
} from './helpers/app'
import { readLayers } from './helpers/library'

/** Measuring lines, calibrating with one of them, and carrying the scale over to new captures. */

const CAMERA = 'fake_device_0'

interface Measure {
  cdKind: string
  cdLength: number
  objects: { type: string; text?: string }[]
}
const measures = (library: string, path: string): Measure[] =>
  (readLayers(library, path).objects as unknown as Measure[]).filter((o) => o.cdKind === 'measure')
const label = (m: Measure): string | undefined =>
  m.objects.find((o) => o.text !== undefined)?.text?.trim()
const badge = (page: import('@playwright/test').Page): import('@playwright/test').Locator =>
  page.getByRole('button', { name: 'Maßstab', exact: true })
const badgeScale = async (page: import('@playwright/test').Page): Promise<number> =>
  parseFloat((await badge(page).innerText()).replace(/^.*=\s*/, '').replace(',', '.'))

async function line(page: import('@playwright/test').Page, from: Point, dx: number): Promise<void> {
  await drag(page, from, { x: from.x + dx, y: from.y })
}

test('measures in pixels, then in mm after calibrating with a known distance', async ({
  page,
  workspace
}) => {
  await openImage(page, 'Probe.png')
  await expect(badge(page)).toHaveCount(0)
  await page.keyboard.press('d')
  await expect(toast(page, 'Noch kein Maßstab')).toBeVisible()
  const box = await canvasBox(page)
  const fit = box.width / 1920
  const A = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.7 }
  await line(page, A, 300)
  await quickSave(page)
  const first = measures(workspace.library, 'Probe.png').at(-1)!
  expect(Math.abs(first.cdLength - 300 / fit)).toBeLessThan(2)
  expect(label(first)).toBe(`${Math.round(first.cdLength)} px`)

  // This line is 5 mm
  await page.mouse.click(A.x + 150, A.y, { button: 'right' })
  await page.getByRole('menuitem', { name: /Als Maßstab verwenden/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Maßstab festlegen' })
  await expect(dialog).toContainText(`Gemessen: ${Math.round(first.cdLength)} Pixel`)
  await expect(dialog).toContainText(CAMERA)
  await page.locator('#calibrate-length').fill('5')
  await dialog.getByRole('button', { name: 'Übernehmen' }).click()
  await expect(toast(page, 'Maßstab festgelegt')).toBeVisible()
  const scale = 5000 / first.cdLength
  await expect.poll(() => badgeScale(page)).toBeCloseTo(scale, 2)

  // A line half as long; both saved with the scale
  await line(page, { x: A.x, y: A.y - 80 }, 150)
  await quickSave(page)
  const lines = measures(workspace.library, 'Probe.png')
  expect(lines.map(label)).toEqual(['5 mm', '2,5 mm'])
  const doc = readLayers(workspace.library, 'Probe.png')
  expect(doc.micronsPerPixel).toBeCloseTo(scale, 6)
  const settings = JSON.parse(readFileSync(join(workspace.profile, 'settings.json'), 'utf8'))
  expect(settings.cameraScales[CAMERA].micronsPerPixel).toBeCloseTo(scale, 6)
  expect(settings.cameraScales[CAMERA].frameWidth).toBe(1920)

  // Moving keeps the length; undo and redo keep the scale
  await page.keyboard.press('v')
  await drag(page, { x: A.x + 75, y: A.y - 80 }, { x: A.x + 175, y: A.y - 30 })
  await quickSave(page)
  expect(label(measures(workspace.library, 'Probe.png').at(-1)!)).toBe('2,5 mm')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect.poll(() => badgeScale(page)).toBeCloseTo(scale, 2)

  // Removing the scale brings back pixels and is an unsaved change
  // With the keyboard: a toast may lie over the badge, and a hovered toast stays open.
  await badge(page).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: 'Maßstab entfernen' }).click()
  await expect(badge(page)).toHaveCount(0)
  expect(await storeValue(page, 'editor', 'dirty')).toBe(true)
})

test('a new capture gets the camera scale, divided by the zoom', async ({ page, workspace }) => {
  await waitForLiveCamera(page)
  // A calibration of the camera, as made before: 5 µm per pixel of a 1920 px frame.
  await storeCall(page, 'settings', 'update', {
    cameraScales: { [CAMERA]: { micronsPerPixel: 5, frameWidth: 1920 } }
  })
  await storeCall(page, 'camera', 'setZoom', 2)
  await page.keyboard.press('Space')
  await waitForEditor(page)
  await expect(badge(page)).toBeVisible()
  await expect.poll(() => badgeScale(page)).toBeCloseTo(2.5, 3)

  await page.keyboard.press('d')
  const box = await canvasBox(page)
  await line(page, { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 }, 200)
  await page.keyboard.press('Control+s')
  await page.locator('#save-name').fill('Messtest')
  await saveDialog(page).getByRole('button', { name: 'Speichern' }).click()
  await expect.poll(() => storeValue(page, 'editor', 'isOpen')).toBe(false)
  const doc = readLayers(workspace.library, 'Messtest.png')
  expect(doc.micronsPerPixel).toBeCloseTo(2.5, 6)
  expect(doc.capture).toEqual({ zoom: 2, frameWidth: 1920 })
  expect(label(measures(workspace.library, 'Messtest.png')[0])).toMatch(/(µm|mm)$/)

  // Opened again from the gallery: the scale of the picture
  await openImage(page, 'Messtest.png')
  await expect.poll(() => badgeScale(page)).toBeCloseTo(2.5, 3)
})

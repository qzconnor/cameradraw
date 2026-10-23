import { join } from 'path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { canvasBox, drawRect, openImage, quickSave, storeValue } from './helpers/app'
import { addImage, pngSize, readLayers, testColor } from './helpers/library'

/** Turning the picture, straightening a perspective, adding space – and undoing all of it. */

/** A button of the picture's toolbar (turn, crop, add space, original). */
const pictureButton = (page: Page, name: string): Locator =>
  page.getByRole('toolbar', { name: 'Bild' }).getByRole('button', { name, exact: true })

/** Red, green and blue of a pixel of an image file. */
function pixel(app: ElectronApplication, file: string, x: number, y: number): Promise<number[]> {
  return app.evaluate(
    ({ nativeImage }, [file, x, y]) => {
      const bitmap = nativeImage.createFromPath(file).crop({ x, y, width: 1, height: 1 }).toBitmap()
      return [bitmap[2], bitmap[1], bitmap[0]] // BGRA
    },
    [file, x, y] as const
  )
}

const near = (actual: number[], expected: number[], tolerance = 10): boolean =>
  actual.every((value, i) => Math.abs(value - expected[i]) <= tolerance)

/** Moves the mouse onto an image point – the whole picture is shown (no zoom). */
async function imagePoint(
  page: Page,
  x: number,
  y: number,
  size = { width: 1920, height: 1080 }
): Promise<{ x: number; y: number }> {
  const box = await canvasBox(page)
  return { x: box.x + (x / size.width) * box.width, y: box.y + (y / size.height) * box.height }
}

test('turning and adding space move the drawing along; the original stays', async ({
  app,
  page,
  workspace
}) => {
  await openImage(page, 'Probe.png')
  await drawRect(page) // 30 % … 50 % of the picture: centre (768, 432)

  await pictureButton(page, 'Nach rechts drehen').click()
  await pictureButton(page, 'Fläche anfügen').click()
  const dialog = page.getByRole('dialog', { name: 'Fläche anfügen' })
  await expect(dialog.getByRole('button', { name: 'Rechts', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await dialog.getByRole('button', { name: '50 % des Bildes' }).click()
  await expect(dialog).toContainText('1080 × 1920 → 1620 × 1920 Pixel')
  await dialog.getByRole('button', { name: 'Anfügen' }).click()
  await expect(dialog).toBeHidden()
  // Portrait now – the drawing area follows.
  await expect
    .poll(async () => (await canvasBox(page)).height > (await canvasBox(page)).width)
    .toBe(true)

  await quickSave(page)
  const file = join(workspace.library, 'Probe.png')
  expect(pngSize(file)).toEqual({ width: 1620, height: 1920 })
  const layers = readLayers(workspace.library, 'Probe.png')
  expect(layers).toMatchObject({
    width: 1620,
    height: 1920,
    adjustments: [
      { type: 'rotate', turns: 1 },
      { type: 'extend', top: 0, right: 540, bottom: 0, left: 0, color: '#ffffff' }
    ]
  })
  // The original frame is kept as it was.
  expect(pngSize(join(workspace.library, '.cameradraw', 'Probe.base.png'))).toEqual({
    width: 1920,
    height: 1080
  })
  // Turned clockwise: (x, y) → (1080 − y, x).
  const rect = layers.objects[0] as { left: number; top: number; angle: number }
  expect(rect.angle).toBe(90)
  expect(Math.abs(rect.left - 648)).toBeLessThan(3)
  expect(Math.abs(rect.top - 768)).toBeLessThan(3)
  // The added space is white, the picture is the frame turned: its top left was bottom left.
  expect(await pixel(app, file, 1400, 900)).toEqual([255, 255, 255])
  expect(near(await pixel(app, file, 50, 50), testColor(50, 1030))).toBe(true)

  // Undo both: the frame again, landscape.
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect
    .poll(async () => (await canvasBox(page)).width > (await canvasBox(page)).height)
    .toBe(true)
  await quickSave(page)
  expect(pngSize(file)).toEqual({ width: 1920, height: 1080 })
  expect(readLayers(workspace.library, 'Probe.png').adjustments).toBeUndefined()
})

test('a perspective crop straightens the marked area', async ({ app, page, workspace }) => {
  await openImage(page, 'Probe.png')
  await page.keyboard.press('c')
  const bar = page.getByText('Ecken auf die Kanten ziehen')
  await expect(bar).toBeVisible()

  // Escape leaves without changing anything.
  await page.keyboard.press('Escape')
  await expect(bar).toBeHidden()
  expect(await storeValue(page, 'editor', 'dirty')).toBe(false)

  const crop = pictureButton(page, 'Perspektivisch zuschneiden')
  await crop.click()
  await expect(crop).toHaveAttribute('aria-pressed', 'true')
  const corners: [string, number, number][] = [
    ['Ecke oben links', 300, 200],
    ['Ecke oben rechts', 1100, 250],
    ['Ecke unten rechts', 1050, 800],
    ['Ecke unten links', 350, 760]
  ]
  for (const [name, x, y] of corners) {
    const handle = page.getByRole('button', { name })
    const box = (await handle.boundingBox())!
    const target = await imagePoint(page, x, y)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 5 })
    await page.mouse.up()
  }
  await expect(page.getByText(/\d+ × \d+ px/)).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(bar).toBeHidden()

  await quickSave(page)
  const file = join(workspace.library, 'Probe.png')
  const { width, height } = pngSize(file)
  // The longer of each pair of opposite edges: about 800 × 560.
  expect(Math.abs(width - 800)).toBeLessThan(8)
  expect(Math.abs(height - 560)).toBeLessThan(8)
  const [adjustment] = readLayers(workspace.library, 'Probe.png').adjustments as {
    type: string
    corners: { x: number; y: number }[]
  }[]
  expect(adjustment.type).toBe('perspective')
  // The middle of the result is where the diagonals cross (≈ 701, 521); a bit right of and below
  // it the picture shows about (750, 550) – between the grid lines.
  const sample = await pixel(app, file, Math.round(width / 2) + 49, Math.round(height / 2) + 29)
  expect(near(sample, testColor(750, 550))).toBe(true)
})

test('reopening keeps the changes; "Original wiederherstellen" brings the frame back', async ({
  page,
  workspace
}) => {
  addImage(workspace.library, 'Gedreht.png', {
    layers: { width: 1080, height: 1920, adjustments: [{ type: 'rotate', turns: 3 }] }
  })
  await openImage(page, 'Gedreht.png')
  await expect
    .poll(async () => (await canvasBox(page)).height > (await canvasBox(page)).width)
    .toBe(true)

  await pictureButton(page, 'Original wiederherstellen').click()
  await expect
    .poll(async () => (await canvasBox(page)).width > (await canvasBox(page)).height)
    .toBe(true)
  await expect.poll(() => storeValue(page, 'editor', 'dirty')).toBe(true)
  await quickSave(page)
  expect(pngSize(join(workspace.library, 'Gedreht.png'))).toEqual({ width: 1920, height: 1080 })
  expect(readLayers(workspace.library, 'Gedreht.png').adjustments).toBeUndefined()

  // Nothing left to restore.
  await expect(pictureButton(page, 'Original wiederherstellen')).toBeDisabled()
})

/** Presses the mouse in the middle of `handle` – the start of a drag. */
async function grab(page: Page, handle: Locator): Promise<{ x: number; y: number }> {
  // Waits until nothing covers it – right after opening, the gallery is still sliding away.
  await handle.hover()
  const box = (await handle.boundingBox())!
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  return at
}

test('dragging an edge adds space; a click or right-click on it asks for the amount', async ({
  app,
  page,
  workspace
}) => {
  await openImage(page, 'Probe.png')
  const right = page.getByRole('button', { name: 'Fläche rechts anfügen' })
  // The amount being added, next to the space.
  const label = page.getByText(/^\+\d+ px$/)

  // Escape while dragging leaves the picture as it is.
  let at = await grab(page, right)
  await page.mouse.move(at.x + 30, at.y, { steps: 5 })
  await expect(label).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(label).toBeHidden()
  expect(await storeValue(page, 'editor', 'dirty')).toBe(false)

  // A short drag (not near the border, so the view stays): the label says how much.
  at = await grab(page, right)
  await page.mouse.move(at.x + 30, at.y, { steps: 5 })
  const dragged = Number((await label.textContent())!.match(/\d+/)![0])
  expect(dragged).toBeGreaterThan(20)
  await page.mouse.up()
  await expect(label).toBeHidden()

  // A click on the handle asks for the amount, ready to type.
  await right.click()
  const form = page.getByRole('dialog', { name: 'Fläche anfügen' })
  await expect(form.getByRole('button', { name: 'Rechts', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await page.keyboard.type('200')
  await expect(form).toContainText(`${1920 + dragged + 200} × 1080 Pixel`)
  await page.keyboard.press('Enter')
  await expect(form).toBeHidden()

  // Right-click: the same for the bottom edge – Escape adds nothing.
  await page.getByRole('button', { name: 'Fläche unten anfügen' }).click({ button: 'right' })
  await expect(form.getByRole('button', { name: 'Unten', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await page.keyboard.press('Escape')
  await expect(form).toBeHidden()

  // On the left in blue – the colour is chosen in the form and remembered.
  await page.getByRole('button', { name: 'Fläche links anfügen' }).click({ button: 'right' })
  await page.keyboard.type('100')
  await form.getByRole('button', { name: 'Farbe wählen' }).click()
  await page.getByRole('button', { name: '#3b82f6' }).click()
  // Escape closes the colour choice, the form stays.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('group', { name: 'Farbvorlagen' })).toBeHidden()
  await expect(form).toBeVisible()
  await form.getByRole('button', { name: 'Anfügen' }).click()
  await expect(form).toBeHidden()
  expect(await storeValue(page, 'editor', 'extendColor')).toBe('#3b82f6')

  await quickSave(page)
  const file = join(workspace.library, 'Probe.png')
  const width = 1920 + dragged + 200 + 100
  expect(pngSize(file)).toEqual({ width, height: 1080 })
  expect(readLayers(workspace.library, 'Probe.png').adjustments).toMatchObject([
    { type: 'extend', right: dragged, color: '#ffffff' },
    { type: 'extend', right: 200, color: '#ffffff' },
    { type: 'extend', left: 100, color: '#3b82f6' }
  ])
  expect(await pixel(app, file, 50, 540)).toEqual([59, 130, 246])
  expect(near(await pixel(app, file, 150, 540), testColor(50, 540))).toBe(true)
  expect(await pixel(app, file, width - 20, 540)).toEqual([255, 255, 255])
})

test('at the border the view zooms out for more space; Shift snaps to quarters', async ({
  page,
  workspace
}) => {
  await openImage(page, 'Probe.png')
  const zoom = page.getByRole('button', { name: 'Ganzes Bild zeigen' })
  const label = page.getByText(/^\+\d+ px$/)

  const at = await grab(page, page.getByRole('button', { name: 'Fläche rechts anfügen' }))
  await page.keyboard.down('Shift')
  // To the window's edge: the picture shrinks, the space keeps growing.
  const width = await page.evaluate(() => window.innerWidth)
  await page.mouse.move(width - 2, at.y, { steps: 10 })
  await expect(zoom).not.toHaveText('1.0×')
  await expect(label).toHaveText(/^\+(480|960|1440|1920) px$/)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect(label).toBeHidden()
  // The whole (bigger) picture again.
  await expect(zoom).toHaveText('1.0×')

  await quickSave(page)
  const added = pngSize(join(workspace.library, 'Probe.png')).width - 1920
  expect(added).toBeGreaterThan(0)
  expect(added % 480).toBe(0)
})

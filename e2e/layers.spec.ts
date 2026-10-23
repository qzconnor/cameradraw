import { join } from 'path'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  canvasBox,
  canvasPoint,
  drawRect,
  galleryCard,
  openGallery,
  openImage,
  quickSave,
  storeCall,
  storeValue
} from './helpers/app'
import { addImage, layerPictures, pngSize, readLayers } from './helpers/library'

/** Layers: the list bottom left, pictures cropped later on their own, images from the gallery. */

const panel = (page: Page): Locator => page.getByRole('region', { name: 'Ebenen' })
const layerButton = (page: Page, name: string): Locator =>
  panel(page).getByRole('button', { name: `Ebene ${name}`, exact: true })
/** Names in the list, top first. */
const layerNames = (page: Page): Promise<string[]> =>
  panel(page)
    .locator('[data-layer] button[aria-label^="Ebene "]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')!.slice('Ebene '.length)))
const pictureButton = (page: Page, name: string): Locator =>
  page.getByRole('toolbar', { name: 'Bild' }).getByRole('button', { name, exact: true })

test('drawings go into the layer worked on; layers are added, hidden, moved and deleted', async ({
  page,
  workspace
}) => {
  await openImage(page, 'Probe.png')
  // A picture of before there were layers: the frame and one drawing.
  await expect.poll(() => layerNames(page)).toEqual(['Zeichnung', 'Bild'])
  await expect(layerButton(page, 'Zeichnung')).toHaveAttribute('aria-current', 'true')

  await drawRect(page)
  await expect(panel(page).getByText('1 Objekt')).toBeVisible()

  await panel(page).getByRole('button', { name: 'Neue Ebene' }).click()
  await expect.poll(() => layerNames(page)).toEqual(['Zeichnung 2', 'Zeichnung', 'Bild'])
  await drawRect(page, [0.6, 0.6], [0.8, 0.8])

  // Picking the frame and drawing: into the drawing right above it.
  await layerButton(page, 'Bild').click()
  await drawRect(page, [0.1, 0.1], [0.2, 0.2])
  await expect(layerButton(page, 'Zeichnung')).toHaveAttribute('aria-current', 'true')
  await expect(panel(page).getByText('2 Objekte')).toBeVisible()

  // Hidden, then moved below the other drawing – and renamed with a double click.
  await panel(page).getByRole('button', { name: 'Zeichnung 2 ausblenden' }).click()
  await layerButton(page, 'Zeichnung 2').click()
  await panel(page).getByRole('button', { name: 'Ebene nach unten' }).click()
  await expect.poll(() => layerNames(page)).toEqual(['Zeichnung', 'Zeichnung 2', 'Bild'])
  await layerButton(page, 'Zeichnung 2').dblclick()
  await panel(page).getByRole('textbox', { name: 'Name der Ebene' }).fill('Notizen')
  await page.keyboard.press('Enter')
  await expect.poll(() => layerNames(page)).toEqual(['Zeichnung', 'Notizen', 'Bild'])

  await quickSave(page)
  const saved = readLayers(workspace.library, 'Probe.png')
  expect(saved.layers.map((l) => [l.type, l.name, l.visible, l.objects?.length])).toEqual([
    ['image', 'Bild', true, undefined],
    ['drawing', 'Notizen', false, 1],
    ['drawing', 'Zeichnung', true, 2]
  ])

  // Deleting a layer – and undoing it.
  await layerButton(page, 'Notizen').click()
  await page.keyboard.press('Delete')
  await expect.poll(() => layerNames(page)).toEqual(['Zeichnung', 'Bild'])
  await page.locator('canvas.upper-canvas').hover()
  await page.keyboard.press('Control+z')
  await expect.poll(() => layerNames(page)).toEqual(['Zeichnung', 'Notizen', 'Bild'])

  // Dragging a row puts the layer elsewhere: "Zeichnung" below "Notizen".
  const from = (await layerButton(page, 'Zeichnung').boundingBox())!
  const below = (await layerButton(page, 'Notizen').boundingBox())!
  await page.mouse.move(from.x + 40, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(below.x + 40, below.y + below.height * 0.8, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => layerNames(page)).toEqual(['Notizen', 'Zeichnung', 'Bild'])

  // The list can be put away; it stays so.
  await page.getByRole('button', { name: 'Ebenen', exact: true }).click()
  await expect(panel(page)).toBeHidden()
  await page.getByRole('button', { name: 'Ebenen', exact: true }).click()
  await expect(panel(page)).toBeVisible()
})

test('the frame can be cropped later – the space and notes beside it stay', async ({
  page,
  workspace
}) => {
  await openImage(page, 'Probe.png')
  // Space on the right for notes: 960 px, white.
  await pictureButton(page, 'Fläche anfügen').click()
  const form = page.getByRole('dialog', { name: 'Fläche anfügen' })
  await form.getByRole('button', { name: 'Anfügen' }).click()
  await expect(form).toBeHidden()
  await expect.poll(() => layerNames(page)).toEqual(['Zeichnung', 'Bild', 'Fläche rechts'])
  // A note on the space (beside the frame) and a mark on the frame.
  await drawRect(page, [0.75, 0.2], [0.9, 0.3])
  await drawRect(page, [0.1, 0.1], [0.2, 0.2])

  // C crops the frame on its own: corners at 100 px from its edges.
  await page.keyboard.press('c')
  const corners: [string, number, number][] = [
    ['Ecke oben links', 100, 100],
    ['Ecke oben rechts', 1820, 100],
    ['Ecke unten rechts', 1820, 980],
    ['Ecke unten links', 100, 980]
  ]
  for (const [name, x, y] of corners) {
    const handle = page.getByRole('button', { name })
    // The frame is shown alone meanwhile – its own pixels on the drawing area.
    const box = await canvasBox(page)
    const target = { x: box.x + (x / 1920) * box.width, y: box.y + (y / 1080) * box.height }
    const at = (await handle.boundingBox())!
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 4 })
    await page.mouse.up()
  }
  await page.keyboard.press('Enter')
  await expect(page.getByText('Ecken auf die Kanten ziehen')).toBeHidden()

  await quickSave(page)
  // The frame is 1720 × 880 now, the space keeps its 960 px beside it.
  const file = join(workspace.library, 'Probe.png')
  const { width, height } = pngSize(file)
  expect(Math.abs(width - (1720 + 960))).toBeLessThan(6)
  expect(Math.abs(height - 880)).toBeLessThan(6)
  const saved = readLayers(workspace.library, 'Probe.png')
  const fill = saved.layers.find((l) => l.type === 'fill')!
  expect(Math.abs(fill.left! - 1720)).toBeLessThan(6)
  expect(fill.width).toBe(960)
  expect(Math.abs(fill.height! - 880)).toBeLessThan(6)
  // The note moved along with the space, 200 px to the left.
  const [note] = saved.objects as { left: number; top: number }[]
  expect(Math.abs(note.left - (0.825 * 2880 - 200))).toBeLessThan(8)

  // Cropping again shows the uncropped frame with the corners of the crop – to move them.
  await page.keyboard.press('c')
  await expect(page.getByText(/17[12]\d × (8[789]|9[0-9])\d px/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Ecken auf die Kanten ziehen')).toBeHidden()
  expect(await storeValue(page, 'editor', 'dirty')).toBe(false)
})

test('a double click edits a picture on its own; images come in from the gallery', async ({
  page,
  workspace
}) => {
  addImage(workspace.library, 'Detail.png')
  await openImage(page, 'Probe.png')

  // From the gallery into the picture: dragged onto the drawing area.
  await openGallery(page)
  const card = galleryCard(page, 'Detail.png')
  await card.hover()
  const from = (await card.boundingBox())!
  const into = await canvasPoint(page, 0.25, 0.3)
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(into.x, into.y, { steps: 12 })
  await expect(page.getByText('Ins Bild einfügen')).toBeVisible()
  await page.mouse.up()
  await expect.poll(() => layerNames(page)).toEqual(['Detail', 'Zeichnung', 'Bild'])
  await storeCall(page, 'panels', 'closeAll')

  // It fits into half the picture, around the point it was dropped on, and is selected.
  await expect.poll(() => storeValue(page, 'editor', 'tool')).toBe('select')

  // A double click on it shows it alone: turned to the right and taken back.
  await page.mouse.dblclick(into.x, into.y)
  const bar = page.getByText('drehen oder zuschneiden')
  await expect(bar).toBeVisible()
  await pictureButton(page, 'Nach rechts drehen').click()
  await page.getByRole('button', { name: 'Übernehmen' }).click()
  await expect(bar).toBeHidden()

  await quickSave(page)
  // The frame stays as it was; the detail is stored next to the image.
  expect(pngSize(join(workspace.library, 'Probe.png'))).toEqual({ width: 1920, height: 1080 })
  const saved = readLayers(workspace.library, 'Probe.png')
  const detail = saved.layers.find((l) => l.name === 'Detail')!
  expect(detail).toMatchObject({ type: 'image', adjustments: [{ type: 'rotate', turns: 1 }] })
  expect(detail.scale).toBeCloseTo(0.5, 2)
  expect(saved.adjustments).toBeUndefined()
  expect(layerPictures(workspace.library, 'Probe.png')).toEqual([`${detail.source}.png`])

  // Reopened, it is still there – and a double click on the frame edits that one.
  await storeCall(page, 'editor', 'close')
  await openImage(page, 'Probe.png')
  await expect.poll(() => layerNames(page)).toEqual(['Detail', 'Zeichnung', 'Bild'])
  await page.keyboard.press('v')
  // Right after opening, the gallery still slides away over the right part.
  await expect(page.getByRole('dialog').filter({ hasText: 'Galerie' })).toBeHidden()
  const frame = await canvasPoint(page, 0.8, 0.8)
  await page.mouse.dblclick(frame.x, frame.y)
  await expect(page.getByText('Bild drehen oder zuschneiden')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(bar).toBeHidden()

  // Deleting the layer removes its picture with the next save.
  await layerButton(page, 'Detail').click()
  await panel(page).getByRole('button', { name: 'Ebene löschen' }).click()
  await quickSave(page)
  expect(layerPictures(workspace.library, 'Probe.png')).toEqual([])
})

test('a copied layer can be pasted into another image', async ({ page, workspace }) => {
  addImage(workspace.library, 'Zweites.png')
  await openImage(page, 'Probe.png')
  await drawRect(page)
  await quickSave(page)
  await layerButton(page, 'Zeichnung').click()
  await panel(page).getByRole('button', { name: 'Ebene kopieren' }).click()
  // Copying again replaces it: the frame – with its picture.
  await layerButton(page, 'Bild').click()
  await page.keyboard.press('Control+c')

  await openImage(page, 'Zweites.png')
  await layerButton(page, 'Zeichnung').click()
  await panel(page).getByRole('button', { name: 'Ebene einfügen' }).click()
  await expect.poll(() => layerNames(page)).toEqual(['Bild 2', 'Zeichnung', 'Bild'])
  // Duplicating works within the image.
  await layerButton(page, 'Zeichnung').click()
  await panel(page).getByRole('button', { name: 'Ebene duplizieren' }).click()
  await expect
    .poll(() => layerNames(page))
    .toEqual(['Bild 2', 'Zeichnung Kopie', 'Zeichnung', 'Bild'])
  await quickSave(page)
  const saved = readLayers(workspace.library, 'Zweites.png')
  expect(saved.layers.map((l) => l.name)).toEqual([
    'Bild',
    'Zeichnung',
    'Zeichnung Kopie',
    'Bild 2'
  ])
  expect(layerPictures(workspace.library, 'Zweites.png')).toHaveLength(1)

  // A drawing layer brings its objects along.
  await openImage(page, 'Probe.png')
  await layerButton(page, 'Zeichnung').click()
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect.poll(() => layerNames(page)).toEqual(['Zeichnung 2', 'Zeichnung', 'Bild'])
  await expect(panel(page).getByText('1 Objekt')).toHaveCount(2)
})

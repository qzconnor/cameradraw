import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  canvasBox,
  canvasPoint,
  drag,
  drawRect,
  openImage,
  quickSave,
  storeValue,
  toast,
  type Point
} from './helpers/app'
import { addImage, readLayers } from './helpers/library'

/** Copying, pasting, duplicating, moving with the arrow keys and stacking order of shapes. */

interface Saved {
  cdKind: string
  left: number
  top: number
  objects?: { text?: string }[]
}

/** The saved objects (after Strg+S), rounded to whole pixels. */
async function saved(page: Page, library: string, image = 'Probe.png'): Promise<Saved[]> {
  await quickSave(page)
  return (readLayers(library, image).objects as unknown as Saved[]).map((o) => ({
    ...o,
    left: Math.round(o.left),
    top: Math.round(o.top)
  }))
}
const places = (objects: Saved[]): number[][] => objects.map((o) => [o.left, o.top])

/** Clicks a point of the drawing area (fractions of its size) with the select tool. */
async function pick(page: Page, fx: number, fy: number): Promise<void> {
  await page.keyboard.press('v')
  const p = await canvasPoint(page, fx, fy)
  await page.mouse.click(p.x, p.y)
}

/** Picks an entry of the context menu at `at` and waits until the menu is gone. */
async function menu(page: Page, at: Point, entry: string): Promise<void> {
  await page.mouse.click(at.x, at.y, { button: 'right' })
  // The name starts with the entry; the shortcut shown next to it is part of it.
  await page.getByRole('menuitem', { name: new RegExp(`^${entry}`) }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
}

/**
 * Keys that change the image after saving (undo, redo, paste) – waits until the change is applied,
 * which takes a moment for steps that load objects.
 */
async function change(page: Page, keys: string): Promise<void> {
  await page.keyboard.press(keys)
  await expect.poll(() => storeValue(page, 'editor', 'dirty')).toBe(true)
}

test('a moved multi-selection is saved where it is, also after undo and redo', async ({
  page,
  workspace
}) => {
  await openImage(page, 'Probe.png')
  await drawRect(page, [0.2, 0.2], [0.3, 0.3])
  await drawRect(page, [0.5, 0.5], [0.6, 0.6])
  const before = places(await saved(page, workspace.library))

  await page.keyboard.press('Control+a')
  const box = await canvasBox(page)
  const fit = box.width / 1920
  const from = await canvasPoint(page, 0.2, 0.25)
  await drag(page, { x: from.x + 2, y: from.y }, { x: from.x + 102, y: from.y + 50 })
  const moved = before.map(([x, y]) => [x + 100 / fit, y + 50 / fit])
  const close = (actual: number[][], expected: number[][]): void =>
    actual.forEach((p, i) =>
      p.forEach((v, j) => expect(Math.abs(v - expected[i][j])).toBeLessThan(2))
    )

  // Saved while still selected: in place, and nothing is left unsaved (it used to be).
  close(places(await saved(page, workspace.library)), moved)
  await change(page, 'Control+z')
  close(places(await saved(page, workspace.library)), before)
  await change(page, 'Control+y')
  close(places(await saved(page, workspace.library)), moved)
})

test('Strg+C and Strg+V paste copies a bit further each time', async ({ page, workspace }) => {
  await openImage(page, 'Probe.png')
  await page.keyboard.press('v')
  await page.keyboard.press('Control+c')
  await expect(toast(page, 'Nichts ausgewählt')).toBeVisible()

  await drawRect(page, [0.2, 0.2], [0.3, 0.3])
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await page.keyboard.press('Control+v')
  const [original, first, second] = await saved(page, workspace.library)
  expect([first.left - original.left, first.top - original.top]).toEqual([24, 24])
  expect([second.left - original.left, second.top - original.top]).toEqual([48, 48])

  // The pasted copy is selected: Entf removes it, undo brings it back.
  await change(page, 'Control+v')
  expect(await storeValue(page, 'editor', 'tool')).toBe('select')
  await page.keyboard.press('Delete')
  expect(await saved(page, workspace.library)).toHaveLength(3)
  await change(page, 'Control+z')
  expect(await saved(page, workspace.library)).toHaveLength(4)

  // Strg+X: copied and gone, pasted back a bit offset
  const all = await saved(page, workspace.library)
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+x')
  expect(await saved(page, workspace.library)).toHaveLength(0)
  await change(page, 'Control+v')
  const back = await saved(page, workspace.library)
  expect(back.map((o) => [o.left - 24, o.top - 24])).toEqual(places(all))
})

test('copied shapes can be pasted into another image, measurements in its scale', async ({
  page,
  workspace
}) => {
  addImage(workspace.library, 'Zweites.png', { layers: { micronsPerPixel: 10 } })
  await openImage(page, 'Probe.png')
  await drawRect(page, [0.2, 0.2], [0.3, 0.3])
  await page.keyboard.press('d')
  const box = await canvasBox(page)
  const fit = box.width / 1920
  const start = await canvasPoint(page, 0.2, 0.7)
  await drag(page, start, { x: start.x + 300 * fit, y: start.y })
  const [, line] = await saved(page, workspace.library)
  expect(line.objects?.find((o) => o.text)?.text?.trim()).toMatch(/^\d+ px$/)

  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Escape')
  await openImage(page, 'Zweites.png')
  await page.keyboard.press('Control+v')
  const pasted = await saved(page, workspace.library, 'Zweites.png')
  expect(pasted.map((o) => o.cdKind)).toEqual(['rect', 'measure'])
  // About 300 px at 10 µm per pixel
  expect(pasted[1].objects?.find((o) => o.text)?.text?.trim()).toMatch(/^(2,9\d|3(,0\d?)?) mm$/)
})

test('right click: duplicate, paste at the pointer, front and back', async ({
  page,
  workspace
}) => {
  await openImage(page, 'Probe.png')
  await drawRect(page, [0.2, 0.2], [0.4, 0.4]) // A
  await drawRect(page, [0.3, 0.3], [0.5, 0.5]) // B, on top of A
  const [a, b] = await saved(page, workspace.library)

  // A to the front: right click on a part of A that B does not cover
  const onA = await canvasPoint(page, 0.25, 0.25)
  await page.keyboard.press('v')
  await menu(page, onA, 'In den Vordergrund')
  expect(places(await saved(page, workspace.library))).toEqual(places([b, a]))
  // … and back with Ende, to the front again with Pos1 (saving ends the selection)
  await pick(page, 0.25, 0.25)
  await page.keyboard.press('End')
  expect(places(await saved(page, workspace.library))).toEqual(places([a, b]))
  await pick(page, 0.25, 0.25)
  await page.keyboard.press('Home')
  expect(places(await saved(page, workspace.library))).toEqual(places([b, a]))

  // Duplicate from the menu
  await menu(page, onA, 'Duplizieren')
  const afterDuplicate = await saved(page, workspace.library)
  expect(afterDuplicate).toHaveLength(3)
  expect([afterDuplicate[2].left - a.left, afterDuplicate[2].top - a.top]).toEqual([24, 24])

  // Copy A and paste it with its centre where the menu was opened
  await menu(page, onA, 'Kopieren')
  const target = await canvasPoint(page, 0.8, 0.8)
  await menu(page, target, 'Hier einfügen')
  const box = await canvasBox(page)
  const fit = box.width / 1920
  const last = (await saved(page, workspace.library)).at(-1)!
  // left/top of a rectangle are its centre
  expect(Math.abs(last.left - (target.x - box.x) / fit)).toBeLessThan(3)
  expect(Math.abs(last.top - (target.y - box.y) / fit)).toBeLessThan(3)
})

test('Strg+D duplicates; arrow keys move the selection in one undo step', async ({
  page,
  workspace
}) => {
  await openImage(page, 'Probe.png')
  await drawRect(page, [0.2, 0.2], [0.3, 0.3])
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+d')
  // The copy is selected and moves: 3 × right, 1 × Shift+down (10 px)
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  const [original, moved] = await saved(page, workspace.library)
  expect([moved.left - original.left, moved.top - original.top]).toEqual([24 + 3, 24 + 10])

  // One undo step for all four presses, the next one takes the copy away
  await change(page, 'Control+z')
  const copy = (await saved(page, workspace.library))[1]
  expect([copy.left - original.left, copy.top - original.top]).toEqual([24, 24])
  await change(page, 'Control+z')
  expect(await saved(page, workspace.library)).toHaveLength(1)
})

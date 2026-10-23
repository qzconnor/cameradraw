import { readFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from './fixtures'
import { canvasBox, drag, openImage, quickSave, type Point } from './helpers/app'
import { readLayers } from './helpers/library'

/**
 * Zoom and pan in the editor. Small rectangles drawn at fixed screen points tell from their saved
 * image coordinates whether the view was where it should be.
 */

const zoomLabel = async (page: import('@playwright/test').Page): Promise<number> =>
  parseFloat(await page.getByRole('button', { name: 'Ganzes Bild zeigen' }).innerText())

/** Top-left corner (image pixels) and size of the last rectangle saved – fabric uses the centre. */
function lastRect(library: string): { x: number; y: number; w: number; h: number; count: number } {
  const objects = readLayers(library, 'Probe.png').objects as {
    left: number
    top: number
    width: number
    height: number
  }[]
  const o = objects.at(-1)!
  return {
    x: o.left - o.width / 2,
    y: o.top - o.height / 2,
    w: o.width,
    h: o.height,
    count: objects.length
  }
}

async function rectAt(page: import('@playwright/test').Page, p: Point, size = 40): Promise<void> {
  await drag(page, p, { x: p.x + size, y: p.y + size * 0.75 })
}

test('zooming keeps the point under the mouse, panning moves by the dragged distance', async ({
  page,
  workspace
}) => {
  await openImage(page, 'Probe.png')
  await page.keyboard.press('r')
  const box = await canvasBox(page)
  const fit = box.width / 1920
  expect(await zoomLabel(page)).toBe(1)
  const P = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.45 }
  const atFit = { x: (P.x - box.x) / fit, y: (P.y - box.y) / fit }

  // Wheel at P. The first step is a big one: while the picture is smaller than the drawing area
  // in one direction it stays centred there, so only from then on the point keeps its place –
  // how soon depends on the window (and the layer list beside the picture).
  await page.mouse.move(P.x, P.y)
  await page.mouse.wheel(0, -600)
  for (let i = 0; i < 2; i++) await page.mouse.wheel(0, -150)
  await expect.poll(() => zoomLabel(page)).toBeGreaterThan(2.5)
  const zoomed = await canvasBox(page)
  expect(zoomed.width * zoomed.height).toBeGreaterThan(box.width * box.height)
  await rectAt(page, P)
  await quickSave(page)
  const r1 = lastRect(workspace.library)
  const zoom = 40 / r1.w
  expect(Math.abs(r1.x - atFit.x)).toBeLessThan(2)
  expect(Math.abs(r1.y - atFit.y)).toBeLessThan(2)
  expect(Math.abs(zoom - fit * (await zoomLabel(page)))).toBeLessThan(fit * 0.06)

  // Space + drag: the view moves, nothing is drawn
  await page.mouse.move(P.x, P.y)
  await page.keyboard.down('Space')
  await drag(page, P, { x: P.x - 200, y: P.y - 100 })
  await page.keyboard.up('Space')
  await rectAt(page, P)
  await quickSave(page)
  const r2 = lastRect(workspace.library)
  expect(r2.count).toBe(r1.count + 1)
  expect(Math.abs(r2.x - r1.x - 200 / zoom)).toBeLessThan(2)
  expect(Math.abs(r2.y - r1.y - 100 / zoom)).toBeLessThan(2)

  // Middle mouse button
  await page.mouse.move(P.x, P.y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(P.x + 100, P.y + 50, { steps: 8 })
  await page.mouse.up({ button: 'middle' })
  await rectAt(page, P)
  await quickSave(page)
  const r3 = lastRect(workspace.library)
  expect(r3.count).toBe(r2.count + 1)
  expect(Math.abs(r2.x - r3.x - 100 / zoom)).toBeLessThan(2)

  // Panning stops at the image edge
  await page.keyboard.down('Space')
  await drag(page, P, { x: P.x + 3000, y: P.y + 3000 })
  await page.keyboard.up('Space')
  await rectAt(page, { x: zoomed.x + 3, y: zoomed.y + 3 }, 30)
  await quickSave(page)
  const r4 = lastRect(workspace.library)
  expect(Math.abs(r4.x - 3 / zoom)).toBeLessThan(2)
  expect(Math.abs(r4.y - 3 / zoom)).toBeLessThan(2)
})

test('keys, buttons and limits; the saved image stays whole', async ({ page, workspace }) => {
  await openImage(page, 'Probe.png')
  const box = await canvasBox(page)
  await page.keyboard.press('+')
  await expect.poll(() => zoomLabel(page)).toBe(1.5)
  await page.keyboard.press('-')
  await expect.poll(() => zoomLabel(page)).toBe(1)
  await page.getByRole('button', { name: 'Vergrößern' }).click()
  await page.getByRole('button', { name: 'Vergrößern' }).click()
  await expect.poll(() => zoomLabel(page)).toBe(2)

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -200)
  await expect.poll(() => zoomLabel(page)).toBe(8)
  await expect(page.getByRole('button', { name: 'Vergrößern' })).toBeDisabled()

  // Saved while zoomed in: still the whole picture, not shifted
  await page.keyboard.press('r')
  await drag(page, { x: box.x + 300, y: box.y + 200 }, { x: box.x + 400, y: box.y + 260 })
  await quickSave(page)
  const png = readFileSync(join(workspace.library, 'Probe.png'))
  expect(png.readUInt32BE(16)).toBe(1920) // IHDR width
  expect(png.readUInt32BE(20)).toBe(1080)

  await page.keyboard.press('0')
  await expect.poll(() => zoomLabel(page)).toBe(1)
  const back = await canvasBox(page)
  expect(Math.abs(back.width - box.width)).toBeLessThan(2)
})

test('the layers, zoom control and action bar fit into the smallest window', async ({
  app,
  page
}) => {
  await openImage(page, 'Probe.png')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 620))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(1000)
  // The bar at the bottom: the layer list's button, the zoom and the actions, side by side.
  const panels = await page.$$eval('.glass-panel', (els) =>
    els
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.top > innerHeight - 80)
      .map((r) => ({ left: r.left, right: r.right }))
      .sort((a, b) => a.left - b.left)
  )
  expect(panels).toHaveLength(3)
  expect(panels[0].right).toBeLessThanOrEqual(panels[1].left)
  expect(panels[1].right).toBeLessThanOrEqual(panels[2].left)
  expect(panels[2].right).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
})

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { canvasPoint, drag, openImage, quickSave, storeValue } from './helpers/app'
import { readLayers } from './helpers/library'

/** Numbered markers: placed with a click, pulled out of a spot with a line, counting on. */

interface SavedMarker {
  cdKind: string
  objects: { type: string; text?: string; fontSize?: number; radius?: number; fill?: string }[]
}

/** The markers saved for the image (after Strg+S), bottom first. */
async function savedMarkers(page: Page, library: string): Promise<SavedMarker[]> {
  await quickSave(page)
  return (readLayers(library, 'Probe.png').objects as unknown as SavedMarker[]).filter(
    (o) => o.cdKind === 'marker'
  )
}

const label = (marker: SavedMarker): string | undefined =>
  marker.objects.find((o) => o.type.toLowerCase() === 'text')?.text

async function clickAt(page: Page, fx: number, fy: number): Promise<void> {
  const p = await canvasPoint(page, fx, fy)
  await page.mouse.click(p.x, p.y)
}

test('markers count on, a drag leads a line to the spot, the size picker resizes them', async ({
  page,
  workspace
}) => {
  await openImage(page, 'Probe.png')
  await page.keyboard.press('n')
  expect(await storeValue(page, 'editor', 'tool')).toBe('marker')
  await expect(page.getByRole('button', { name: 'Nummer', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  await clickAt(page, 0.2, 0.2)
  await clickAt(page, 0.4, 0.2)
  // Pulled out of the spot at 60 % / 60 %: the circle lands where the mouse is let go.
  await drag(page, await canvasPoint(page, 0.6, 0.6), await canvasPoint(page, 0.75, 0.35))
  let markers = await savedMarkers(page, workspace.library)
  expect(markers.map(label)).toEqual(['1', '2', '3'])
  // Circle and number – and with a line: the line and the dot at the spot.
  expect(markers.map((m) => m.objects.length)).toEqual([2, 2, 4])

  // Deleted in the middle: the next one still counts on from the highest.
  await page.keyboard.press('v')
  await clickAt(page, 0.4, 0.2)
  await page.keyboard.press('Delete')
  await page.keyboard.press('n')
  await clickAt(page, 0.3, 0.7)
  markers = await savedMarkers(page, workspace.library)
  expect(markers.map(label)).toEqual(['1', '3', '4'])

  // A selected marker takes the size picked in the toolbar (it shows for markers).
  await page.keyboard.press('v')
  await clickAt(page, 0.2, 0.2)
  await page.getByRole('button', { name: 'Nummerngröße 112' }).click()
  markers = await savedMarkers(page, workspace.library)
  const number = (m: SavedMarker): number =>
    m.objects.find((o) => o.type.toLowerCase() === 'text')!.fontSize!
  expect(number(markers[0])).toBeCloseTo(112, 0)
  expect(number(markers[1])).toBeCloseTo(48, 0)
})

test('a light colour gets a dark number', async ({ page, workspace }) => {
  await openImage(page, 'Probe.png')
  await page.keyboard.press('n')
  await page.getByRole('button', { name: 'Farbe wählen' }).click()
  await page.getByRole('button', { name: '#facc15' }).click()
  await page.getByRole('button', { name: 'Farbe wählen' }).click()
  await expect(page.getByRole('group', { name: 'Farbvorlagen' })).toHaveCount(0)
  await clickAt(page, 0.5, 0.5)
  const [marker] = await savedMarkers(page, workspace.library)
  const fills = marker.objects.map((o) => o.fill)
  expect(fills).toEqual(['#facc15', '#171717'])
})

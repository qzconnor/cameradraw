import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { canvasPoint, openImage, quickSave } from './helpers/app'
import { addImage, readLayers } from './helpers/library'

/** Texts are Markdown: typed as their source, drawn formatted, saved as written. */

interface SavedText {
  type: string
  text: string
  fontSize: number
  width: number
  height: number
}

/** The saved texts (after Strg+S). */
async function savedTexts(page: Page, library: string, image = 'Probe.png'): Promise<SavedText[]> {
  await quickSave(page)
  return readLayers(library, image).objects as unknown as SavedText[]
}

/** Clicks a point of the drawing area (fractions of its size) with the text tool. */
async function clickWithText(page: Page, fx: number, fy: number): Promise<void> {
  await page.keyboard.press('t')
  const p = await canvasPoint(page, fx, fy)
  await page.mouse.click(p.x, p.y)
}

/** Clicks into the text that starts at a point of the drawing area (fractions of its size). */
async function clickInto(page: Page, fx: number, fy: number): Promise<void> {
  const p = await canvasPoint(page, fx, fy)
  await page.mouse.click(p.x + 20, p.y + 20)
}

/** Shown while a text is typed. */
const hint = (page: Page): Locator => page.getByRole('note', { name: 'Markdown' })

/** Height of plain text lines as fabric lays them out (size 48 on a 1920 px wide image). */
const plainHeight = (lines: number): number => 48 * 1.13 * (1.16 * (lines - 1) + 1)

test('a text is typed as Markdown and drawn formatted', async ({ page, workspace }) => {
  await openImage(page, 'Probe.png')
  await clickWithText(page, 0.3, 0.3)
  await expect(hint(page)).toBeVisible()
  await page.keyboard.type('# Befund')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Riss am Rand')
  await page.keyboard.press('Escape')
  await expect(hint(page)).toHaveCount(0)

  const [text] = await savedTexts(page, workspace.library)
  // Saved as written, as an IText – older versions of the app show the source.
  expect(text).toMatchObject({ type: 'IText', text: '# Befund\nRiss am Rand', fontSize: 48 })
  // The heading is larger than plain text.
  expect(text.height).toBeGreaterThan(plainHeight(2) * 1.3)

  // A click into it with the text tool shows the source again (Bild ab: to its end).
  await clickInto(page, 0.3, 0.3)
  await expect(hint(page)).toBeVisible()
  await page.keyboard.press('PageDown')
  await page.keyboard.type('.')
  await page.keyboard.press('Escape')
  const [changed] = await savedTexts(page, workspace.library)
  expect(changed.text).toBe('# Befund\nRiss am Rand.')
})

test('Strg+B and Strg+I put Markdown around the selection and take it away', async ({
  page,
  workspace
}) => {
  await openImage(page, 'Probe.png')
  await clickWithText(page, 0.3, 0.3)
  await page.keyboard.type('Probe fertig')
  for (let i = 0; i < 'fertig'.length; i++) await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Control+b')
  await page.keyboard.press('Control+i')
  // The selection stays on the word, so the second marker goes inside the first.
  await page.keyboard.type('fix')
  await page.keyboard.press('Escape')
  expect((await savedTexts(page, workspace.library))[0].text).toBe('Probe **_fix_**')

  await clickInto(page, 0.3, 0.3)
  await page.keyboard.press('PageDown')
  for (let i = 0; i < '_**'.length; i++) await page.keyboard.press('ArrowLeft')
  for (let i = 0; i < 'fix'.length; i++) await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Control+b')
  await page.keyboard.press('Escape')
  expect((await savedTexts(page, workspace.library))[0].text).toBe('Probe _fix_')
})

test('a text from before Markdown keeps its lines and size', async ({ page, workspace }) => {
  // As saved by earlier versions: a plain IText.
  addImage(workspace.library, 'Notiz.png', {
    layers: {
      objects: [
        {
          type: 'IText',
          cdKind: 'text',
          left: 200,
          top: 200,
          originX: 'left',
          originY: 'top',
          text: 'Zeile 1\nZeile 2\n\nZeile 4',
          fontFamily: '"Geist Variable", sans-serif',
          fontWeight: 600,
          fontSize: 48,
          fill: '#ef4444',
          width: 152,
          height: plainHeight(4)
        }
      ]
    }
  })
  await openImage(page, 'Notiz.png')
  const [text] = await savedTexts(page, workspace.library, 'Notiz.png')
  expect(text).toMatchObject({ type: 'IText', text: 'Zeile 1\nZeile 2\n\nZeile 4' })
  expect(text.height).toBeCloseTo(plainHeight(4), 0)
})

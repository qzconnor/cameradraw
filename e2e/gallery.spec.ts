import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { expect, test } from './fixtures'
import { drawRect, galleryCard, openGallery, openImage, quickSave, storeValue } from './helpers/app'
import { addImage, readLayers } from './helpers/library'

const STAMPED = 'CameraDraw_2026-10-21_17-08-10'
const local = (iso: string): number => new Date(iso).getTime()

/** Image names of the gallery in display order. */
const order = (page: import('@playwright/test').Page): Promise<string[]> =>
  page.$$eval('li [aria-label$=" bearbeiten"]', (els) =>
    els.map((el) => el.getAttribute('aria-label')!.replace(/ bearbeiten$/, ''))
  )

test.describe('capture date', () => {
  test.beforeEach(({ workspace }) => {
    // Layers of older versions have no capturedAt.
    addImage(workspace.library, `${STAMPED}.png`, { layers: {} })
    addImage(workspace.library, 'Alt ohne Stempel.png', {
      layers: {},
      mtime: new Date('2026-09-01T10:00:00')
    })
    addImage(workspace.library, 'Fremdbild.png', { mtime: new Date('2026-08-15T09:30:00') })
    addImage(workspace.library, 'Gespeichert.png', {
      layers: { capturedAt: local('2026-07-01T08:15:00') }
    })
  })

  test('comes from the layers, the default name or the file date', async ({ launch }) => {
    const { page } = await launch()
    await openGallery(page)
    await expect(galleryCard(page, `${STAMPED}.png`)).toContainText('21.10.2026, 17:08')
    await expect(galleryCard(page, 'Alt ohne Stempel.png')).toContainText('01.09.2026, 10:00')
    await expect(galleryCard(page, 'Fremdbild.png')).toContainText('15.08.2026, 09:30')
    await expect(galleryCard(page, 'Gespeichert.png')).toContainText('01.07.2026, 08:15')
    // Newest first – Probe.png was made just now.
    expect(await order(page)).toEqual([
      'Probe.png',
      `${STAMPED}.png`,
      'Alt ohne Stempel.png',
      'Fremdbild.png',
      'Gespeichert.png'
    ])
  })

  test('stays when an old image is edited', async ({ launch, workspace }) => {
    const { page } = await launch()
    await openImage(page, 'Alt ohne Stempel.png')
    await drawRect(page)
    await quickSave(page)
    expect(readLayers(workspace.library, 'Alt ohne Stempel.png').capturedAt).toBe(
      local('2026-09-01T10:00:00')
    )
    await page.keyboard.press('Escape')
    await openGallery(page)
    await expect(galleryCard(page, 'Alt ohne Stempel.png')).toContainText('01.09.2026, 10:00')
    expect((await order(page)).indexOf('Alt ohne Stempel.png')).toBe(2)

    // "Heute" only shows what was taken today.
    await page.getByRole('button', { name: 'Sortieren und filtern' }).click()
    await page.getByRole('menuitemradio', { name: 'Heute' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => order(page)).toEqual(['Probe.png'])
  })

  test('stays when a stamped name is changed', async ({ launch, workspace }) => {
    const { page } = await launch()
    await openGallery(page)
    await galleryCard(page, `${STAMPED}.png`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Umbenennen' }).click()
    await page.getByRole('dialog').getByRole('textbox').fill('Probe A')
    await page.keyboard.press('Enter')
    await expect(galleryCard(page, 'Probe A.png')).toContainText('21.10.2026, 17:08')
    expect(readLayers(workspace.library, 'Probe A.png').capturedAt).toBe(
      local('2026-10-21T17:08:10')
    )
  })
})

test('deleting puts the image and its layers into the recycle bin', async ({
  launch,
  workspace
}) => {
  test.skip(process.platform !== 'win32', 'Windows recycle bin')
  const stem = `Papierkorbtest-${Date.now()}`
  addImage(workspace.library, `${stem}.png`, { layers: {} })
  const files = [
    join(workspace.library, `${stem}.png`),
    join(workspace.library, '.cameradraw', `${stem}.json`),
    join(workspace.library, '.cameradraw', `${stem}.base.png`)
  ]
  const shell = (script: string): string =>
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8'
    }).trim()
  const bin = `$bin = (New-Object -ComObject Shell.Application).Namespace(10); $bin.Items() | Where-Object { $_.Name -like '${stem}*' }`

  const { page } = await launch()
  try {
    await openGallery(page)
    await galleryCard(page, `${stem}.png`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Löschen' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('mit seinen Zeichnungs-Ebenen')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click()
    await expect.poll(() => files.some(existsSync)).toBe(false)
    expect(shell(`@(${bin}).Count`)).toBe('3')
  } finally {
    // Back out of the recycle bin – it belongs to whoever runs the tests.
    shell(`${bin} | ForEach-Object { $_.InvokeVerb('undelete') }`)
  }
  await expect.poll(() => files.every(existsSync)).toBe(true)
  expect(shell(`@(${bin}).Count`)).toBe('0')
  await expect(
    galleryCard(page, `${stem}.png`).locator('[aria-label="Ebenen bearbeitbar"]')
  ).toHaveCount(1)
})

test('a cut off file name shows in full as a tooltip', async ({ launch, workspace }) => {
  const long = 'Eine sehr lange Bezeichnung der Probe Nummer 12.png'
  addImage(workspace.library, long)
  const { page } = await launch()
  await openGallery(page)
  await galleryCard(page, long).locator('p').first().hover()
  await expect(page.getByRole('tooltip')).toContainText(long)
  await page.mouse.move(5, 300)
  await galleryCard(page, 'Probe.png').locator('p').first().hover()
  await page.waitForTimeout(800) // longer than the tooltip delay
  await expect(page.getByRole('tooltip')).toHaveCount(0)
})

test('thumbnails load', async ({ launch, workspace }) => {
  addImage(workspace.library, 'Projekt/Bild 1.png')
  addImage(workspace.library, 'Zweites.png')
  const { page } = await launch()
  await openGallery(page)
  await expect
    .poll(() =>
      page.$$eval('li img', (imgs) =>
        imgs.every(
          (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0
        )
      )
    )
    .toBe(true)
  const width = await page.$eval(
    'li [aria-label="Probe.png bearbeiten"] img',
    (img) => (img as HTMLImageElement).naturalWidth
  )
  expect(width).toBeLessThanOrEqual(480)
  expect(await storeValue(page, 'gallery', 'loading')).toBe(false)
})

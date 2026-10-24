import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { storeValue, toast, waitForLiveCamera } from './helpers/app'

/**
 * The settings in tabs, and what the camera itself adjusts. Chromium's fake camera offers exposure
 * and focus (both 10–100 in steps of 5, starting at 50, always manual) and up to 3840×2160.
 */

const CAMERA = 'fake_device_0'

/** What the camera really uses right now, as the track reports it. */
const trackSettings = (page: Page): Promise<Record<string, unknown>> =>
  page
    .locator('main video')
    .evaluate((v: HTMLVideoElement) =>
      JSON.parse(JSON.stringify((v.srcObject as MediaStream).getVideoTracks()[0].getSettings()))
    )

const savedControls = (profile: string): Record<string, unknown> | undefined =>
  JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8')).cameraControls?.[CAMERA]

/** Smallest and largest colour value in an image file. */
const valueRange = (app: ElectronApplication, file: string): Promise<[number, number]> =>
  app.evaluate(({ nativeImage }, file) => {
    const pixels = nativeImage.createFromPath(file).toBitmap()
    let min = 255
    let max = 0
    pixels.forEach((value, i) => {
      if (i % 4 === 3) return // alpha
      min = Math.min(min, value)
      max = Math.max(max, value)
    })
    return [min, max] as [number, number]
  }, file)

const field = (page: Page, label: string): ReturnType<Page['locator']> =>
  page.locator('[data-slot=field]').filter({ has: page.getByText(label, { exact: true }) })

test('the settings are sorted into tabs', async ({ page }) => {
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
  const tab = (name: string): ReturnType<Page['getByRole']> => page.getByRole('tab', { name })
  await expect(tab('Allgemein')).toHaveAttribute('data-state', 'active')
  await expect(page.getByText('Speicherordner', { exact: true })).toBeVisible()
  await expect(page.getByText('Ambient Light', { exact: true })).toBeVisible()
  await expect(page.getByText('Kamerabild spiegeln')).toBeHidden()

  await tab('Kamera').click()
  await expect(page.getByText('Kamerabild spiegeln')).toBeVisible()
  await expect(page.getByText('Speicherordner', { exact: true })).toBeHidden()

  await tab('KI').click()
  await expect(page.getByText('KI-Steuerung (MCP-Server)')).toBeVisible()

  // The tab stays when the panel is closed and opened again.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
  await expect(tab('KI')).toHaveAttribute('data-state', 'active')
})

test('the camera picture is adjusted, remembered and reset', async ({ launch, workspace }) => {
  const first = await launch()
  const page = first.page
  await waitForLiveCamera(page)
  // The button beside the mirror toggle opens the picture settings.
  await page.getByRole('button', { name: 'Bildeinstellungen' }).click()
  await expect(page.getByRole('tab', { name: 'Bild' })).toHaveAttribute('data-state', 'active')

  const exposure = field(page, 'Belichtung')
  await expect(exposure.getByRole('switch', { name: 'Belichtung automatisch' })).not.toBeChecked()
  await expect(exposure.getByText('1/200 s')).toBeVisible() // 50 × 100 µs
  await expect(field(page, 'Fokus').getByRole('slider')).toBeVisible()
  // The fake camera has neither – only what the camera offers is shown.
  await expect(page.getByText('Helligkeit', { exact: true })).toBeHidden()
  await expect(page.getByText('Weißabgleich', { exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Zurücksetzen', exact: true })).toBeDisabled()

  await exposure.getByRole('slider').focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await trackSettings(page)).exposureTime).toBe(70)
  await expect(exposure.getByText('1/143 s')).toBeVisible()
  await expect
    .poll(() => savedControls(workspace.profile))
    .toEqual({
      values: { exposureMode: 'manual', exposureTime: 70 },
      originals: { exposureMode: 'manual', exposureTime: 50 }
    })

  // A new start of the camera (here: of the app) sets it again.
  await first.app.close()
  const second = await launch()
  await waitForLiveCamera(second.page)
  await expect.poll(async () => (await trackSettings(second.page)).exposureTime).toBe(70)

  await second.page.getByRole('button', { name: 'Bildeinstellungen' }).click()
  await second.page.getByRole('button', { name: 'Zurücksetzen', exact: true }).click()
  await expect.poll(async () => (await trackSettings(second.page)).exposureTime).toBe(50)
  await expect.poll(() => savedControls(workspace.profile)).toBeUndefined()
  await expect(
    second.page.getByRole('button', { name: 'Zurücksetzen', exact: true })
  ).toBeDisabled()
})

test('a camera with more than Full HD can use its highest resolution', async ({
  page,
  workspace
}) => {
  await waitForLiveCamera(page)
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
  await page.getByRole('tab', { name: 'Kamera' }).click()
  const badge = page.locator('[data-slot=field]').filter({ hasText: 'Auflösung' }).first()
  await expect(badge.getByText('1920×1080')).toBeVisible()

  await page.getByRole('button', { name: 'Höchste · 3840×2160' }).click()
  await waitForLiveCamera(page)
  await expect(badge.getByText('3840×2160')).toBeVisible()
  expect(await storeValue(page, 'camera', 'resolution')).toEqual({ width: 3840, height: 2160 })
  expect(savedControls(workspace.profile)).toMatchObject({ resolution: 'max' })

  await page.getByRole('button', { name: 'Bis Full HD' }).click()
  await waitForLiveCamera(page)
  await expect(badge.getByText('1920×1080')).toBeVisible()
  expect(savedControls(workspace.profile)).toBeUndefined()
})

test('soft contrast shows and saves the picture in the range 16–235', async ({
  app,
  page,
  workspace
}) => {
  await waitForLiveCamera(page)
  await page.getByRole('button', { name: 'Bildeinstellungen' }).click()
  // The fake camera is no USB device – no anti-flicker filter to set.
  await expect(page.getByText('Flimmerfilter')).toBeHidden()
  const soft = page.getByRole('switch', { name: 'Weicher Kontrast' })
  await expect(soft).not.toBeChecked()
  await soft.click()
  await expect(page.locator('main video')).toHaveCSS('filter', /contrast\(0\.87/)
  await expect.poll(() => savedControls(workspace.profile)).toMatchObject({ softContrast: true })

  // Saved right away (burst), so the file shows what was captured.
  await page.keyboard.press('Escape')
  const capture = async (): Promise<[number, number]> => {
    const before = new Set(readdirSync(workspace.library))
    await page.mouse.click(5, 300) // focus on the stage
    await page.keyboard.press('Shift+Space')
    await expect(toast(page, 'Bild gespeichert')).toBeVisible()
    let name: string | undefined
    await expect
      .poll(() => (name = readdirSync(workspace.library).find((f) => !before.has(f))))
      .toBeDefined()
    return valueRange(app, join(workspace.library, name!))
  }
  const [low, high] = await capture()
  expect(low).toBeGreaterThanOrEqual(15)
  expect(high).toBeLessThanOrEqual(236)

  await page.getByRole('button', { name: 'Bildeinstellungen' }).click()
  await soft.click()
  await expect(page.locator('main video')).toHaveCSS('filter', 'none')
  await expect.poll(() => savedControls(workspace.profile)).toBeUndefined()
  await page.keyboard.press('Escape')
  await expect(toast(page, 'Bild gespeichert')).toBeHidden()
  // The fake picture has pure colours: back to the full range.
  const [plainLow] = await capture()
  expect(plainLow).toBeLessThan(15)
})

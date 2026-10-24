import { expect, test } from './fixtures'
import { storeValue, toast, waitForEditor, waitForLiveCamera } from './helpers/app'

/** Focusing: focus peaking with its sharpness meter, and focus stacking. */

test('the focus aid lights up sharp edges and shows how sharp the picture is', async ({ page }) => {
  await waitForLiveCamera(page)
  const toggle = page.getByRole('button', { name: 'Schärfehilfe', exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-focus-peaking]')).toBeVisible()

  // The fake camera's picture is crisp: the meter fills up.
  const meter = page.getByRole('meter', { name: 'Schärfe' })
  await expect
    .poll(async () => Number(await meter.getAttribute('aria-valuenow')))
    .toBeGreaterThan(80)
  expect(await storeValue(page, 'focusPeaking', 'sharpness')).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Viel' }).click()
  await page.getByRole('button', { name: 'Grün' }).click()
  expect(await storeValue(page, 'focusPeaking', 'level')).toBe('high')
  expect(await storeValue(page, 'focusPeaking', 'color')).toBe('#39ff14')

  await page.getByRole('button', { name: 'Schärfehilfe ausschalten' }).click()
  await expect(meter).toHaveCount(0)
  await expect(page.locator('[data-focus-peaking]')).toBeHidden()
  await expect.poll(() => storeValue(page, 'focusPeaking', 'sharpness')).toBeNull()
})

test('focus stacking by hand: the shutter starts a stack and finishes it', async ({ page }) => {
  await waitForLiveCamera(page)
  await page.getByRole('button', { name: 'Fokus-Stacking', exact: true }).click()
  const bar = page.getByLabel('Fokus-Stacking', { exact: true }).filter({ hasText: 'Auslöser' })
  await expect(bar).toBeVisible()

  await page.mouse.click(5, 300) // focus on the stage, not on a button
  await page.keyboard.press('Space')
  await expect.poll(() => storeValue(page, 'focusStack', 'state')).toBe('recording')
  await expect(page.getByRole('button', { name: 'Fokus-Stapel fertig' })).toBeVisible()
  await expect.poll(() => storeValue<number>(page, 'focusStack', 'frames')).toBeGreaterThan(3)

  await page.keyboard.press('Space')
  await waitForEditor(page)
  expect(await storeValue(page, 'focusStack', 'state')).toBe('idle')
  const session = await page.evaluate(() => {
    const host = document.querySelector('#app') as unknown as {
      __vue_app__: { config: { globalProperties: { $pinia: { _s: Map<string, object> } } } }
    }
    const editor = host.__vue_app__.config.globalProperties.$pinia._s.get('editor') as {
      session: { path: string | null; width: number; height: number }
    }
    return { path: editor.session.path, width: editor.session.width }
  })
  expect(session.path).toBeNull()
  expect(session.width).toBeGreaterThan(100)
})

test('a camera that sets its own focus sweeps through it and gets it back', async ({ page }) => {
  await waitForLiveCamera(page)
  await expect.poll(() => storeValue(page, 'focusStack', 'canSweep')).toBe(true)
  const focus = (): Promise<unknown> =>
    storeValue<{ focusDistance?: number }>(page, 'cameraControls', 'values').then(
      (v) => v.focusDistance
    )
  const before = await focus()

  // With burst capture it is saved right away – the camera stays on, its focus can be read.
  await page.getByRole('button', { name: 'Serienaufnahme' }).click()
  await page.getByRole('button', { name: 'Fokus-Stacking', exact: true }).click()
  await page.getByRole('button', { name: '10', exact: true }).click()
  await page.getByRole('button', { name: 'Automatisch' }).click()
  await expect(page.getByText(/Fokus fährt durch – Bild \d+ von 10/)).toBeVisible()
  await expect(toast(page, 'Bild gespeichert')).toBeVisible({ timeout: 20_000 })
  expect(await storeValue(page, 'focusStack', 'state')).toBe('idle')
  await expect.poll(focus).toBe(before)
})

test('a stack being taken can be cancelled', async ({ page }) => {
  await waitForLiveCamera(page)
  await page.getByRole('button', { name: 'Fokus-Stacking', exact: true }).click()
  await page.getByRole('button', { name: 'Fokus-Stapel starten' }).click()
  await expect.poll(() => storeValue(page, 'focusStack', 'state')).toBe('recording')
  await page.getByRole('button', { name: 'Abbrechen' }).click()
  await expect.poll(() => storeValue(page, 'focusStack', 'state')).toBe('idle')
  await page.waitForTimeout(500)
  expect(await storeValue(page, 'editor', 'isOpen')).toBe(false)
})

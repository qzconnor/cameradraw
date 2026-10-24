import { expect, test } from './fixtures'
import { storeValue, waitForLiveCamera } from './helpers/app'

/** Aids for focusing the live picture: focus peaking with its sharpness meter. */

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

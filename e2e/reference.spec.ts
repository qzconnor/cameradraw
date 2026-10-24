import { expect, test } from './fixtures'
import { galleryCard, openGallery, storeValue, waitForLiveCamera } from './helpers/app'
import { addImage } from './helpers/library'

/** A picture taken before over the live picture, to put a sample back where it was. */

test('the newest picture lies over the live picture; another one, blend and drawing are picked', async ({
  launch,
  workspace
}) => {
  // Older than Probe.png, which is the newest.
  addImage(workspace.library, 'Vorher/Alt.png', { mtime: new Date(2020, 0, 1) })
  const { page } = await launch()
  await waitForLiveCamera(page)

  const overlay = page.locator('img[data-reference]')
  await page.getByRole('button', { name: 'Referenzbild', exact: true }).click()
  await expect(overlay).toBeVisible()
  expect(await storeValue(page, 'reference', 'path')).toBe('Probe.png')
  const picker = page.getByRole('button', { name: 'Referenzbild wählen' })
  await expect(picker).toContainText('Probe.png')
  await expect(overlay).toHaveCSS('opacity', '0.5')

  await picker.click()
  await page.getByRole('button', { name: 'Alt.png' }).click()
  await expect(picker).toContainText('Alt.png')
  expect(await storeValue(page, 'reference', 'path')).toBe('Vorher/Alt.png')

  const difference = page.getByRole('button', { name: 'Differenz' })
  await expect(page.getByRole('button', { name: 'Überblenden' })).toHaveAttribute(
    'data-state',
    'on'
  )
  await difference.click()
  await expect(difference).toHaveAttribute('data-state', 'on')
  await expect(overlay).toHaveCSS('mix-blend-mode', 'difference')

  // With its drawing: the image as saved is shown instead of the frame.
  const frameUrl = await overlay.getAttribute('src')
  await page.getByRole('switch', { name: 'Zeichnung' }).click()
  await expect(overlay).not.toHaveAttribute('src', frameUrl!)
  expect(await storeValue(page, 'reference', 'drawing')).toBe(true)

  await page.getByRole('button', { name: 'Referenzbild ausblenden' }).click()
  await expect(overlay).toHaveCount(0)
  expect(await storeValue(page, 'reference', 'path')).toBeNull()
})

test('the gallery shows any picture as the reference', async ({ page }) => {
  await waitForLiveCamera(page)
  await openGallery(page)
  await galleryCard(page, 'Probe.png').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Als Referenz einblenden' }).click()
  await expect(page.locator('img[data-reference]')).toBeVisible()
  expect(await storeValue(page, 'panels', 'active')).toBeNull()
  expect(await storeValue(page, 'reference', 'path')).toBe('Probe.png')
})

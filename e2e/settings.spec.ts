import { readFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from './fixtures'

test('many settings changes at once leave a valid settings file', async ({ page, workspace }) => {
  // Alternating sizes: a write mixing into another would leave broken JSON behind.
  const failed = await page.evaluate(async () => {
    const big = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`Kamera ${i}`, 'none']))
    const api = (
      window as unknown as {
        api: { settings: { update(patch: object): Promise<unknown> } }
      }
    ).api
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) => api.settings.update({ cameraModules: i % 2 ? {} : big }))
    )
    return results.filter((r) => r.status === 'rejected').length
  })
  expect(failed).toBe(0)

  const saved = JSON.parse(readFileSync(join(workspace.profile, 'settings.json'), 'utf8'))
  expect(saved.cameraModules).toEqual({}) // the last update
  expect(saved.saveDir).toBe(workspace.library)
})

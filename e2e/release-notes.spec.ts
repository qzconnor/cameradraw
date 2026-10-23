import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from './fixtures'

/**
 * Release notes in the updates panel. GitHub's answers are simulated in the main process, so the
 * tests need no network and always see the same releases.
 */

const API_LIST = [
  {
    tag_name: 'v2.0.0',
    published_at: '2026-10-20T10:00:00Z',
    body_html: '<h2>2.0.0</h2><ul><li>Aus der API</li></ul>',
    html_url: 'https://github.com/qzconnor/cameradraw/releases/tag/v2.0.0',
    draft: false,
    prerelease: false
  },
  {
    tag_name: 'v1.9.0-beta',
    published_at: '2026-10-10T10:00:00Z',
    body_html: '<p>Vorab</p>',
    html_url: 'https://github.com/qzconnor/cameradraw/releases/tag/v1.9.0-beta',
    draft: false,
    prerelease: true
  }
]

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:github.com,2008:Repository/1/v1.2.3</id>
    <updated>2026-10-22T15:56:32Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/qzconnor/cameradraw/releases/tag/v1.2.3"/>
    <title>v1.2.3</title>
    <content type="html">&lt;h2&gt;1.2.3&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Aus dem Feed &amp;amp; korrekt&lt;/li&gt;&lt;/ul&gt;</content>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1/v1.2.2</id>
    <updated>2026-10-22T15:18:42Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/qzconnor/cameradraw/releases/tag/v1.2.2"/>
    <title>v1.2.2</title>
    <content type="html">&lt;p&gt;Ältere Version&lt;/p&gt;</content>
  </entry>
</feed>`

interface Answers {
  /** Bodies of the API answers in turn (the last one repeats). */
  api: string[]
  feed: string[]
}

/** Replaces net.fetch for GitHub: answers from `answers`, counts the requests. */
async function simulateGitHub(app: ElectronApplication, answers: Answers): Promise<void> {
  await app.evaluate(({ net }, answers) => {
    const original = net.fetch.bind(net)
    const g = globalThis as { requests?: { api: number; feed: number } }
    g.requests = { api: 0, feed: 0 }
    net.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const kind = url.includes('api.github.com') ? 'api' : url.endsWith('.atom') ? 'feed' : null
      if (!kind) return original(input, init)
      const list = answers[kind]
      const body = list[Math.min(g.requests![kind], list.length - 1)]
      g.requests![kind]++
      return Promise.resolve(new Response(body, { status: 200 }))
    }
  }, answers)
}
const requests = (app: ElectronApplication): Promise<{ api: number; feed: number }> =>
  app.evaluate(() => (globalThis as { requests?: { api: number; feed: number } }).requests!)

const openUpdates = (page: Page): Promise<void> =>
  page.getByRole('button', { name: 'Updates und Versionshinweise' }).click()
const notes = (page: Page): import('@playwright/test').Locator =>
  page.locator('[aria-label="Versionshinweise"] article')

test('without releases from the API the feed fills in', async ({ app, page }) => {
  await simulateGitHub(app, { api: ['[]'], feed: [FEED] })
  await openUpdates(page)
  await expect(notes(page)).toHaveCount(2)
  await expect(notes(page).first()).toContainText('1.2.3')
  await expect(notes(page).first()).toContainText('Aus dem Feed & korrekt')
  await expect(notes(page).first()).toContainText('22. Oktober 2026')
  await expect(
    notes(page).first().getByRole('link', { name: 'Auf GitHub ansehen' })
  ).toHaveAttribute('href', 'https://github.com/qzconnor/cameradraw/releases/tag/v1.2.3')
})

test('the API list is used when it has releases, without pre-releases', async ({ app, page }) => {
  await simulateGitHub(app, { api: [JSON.stringify(API_LIST)], feed: [FEED] })
  await openUpdates(page)
  await expect(notes(page)).toHaveCount(1)
  await expect(notes(page).first()).toContainText('Aus der API')
  expect((await requests(app)).feed).toBe(0)
})

test('an empty answer is not kept: "Erneut laden" asks again', async ({ app, page }) => {
  const emptyFeed = '<?xml version="1.0"?><feed></feed>'
  await simulateGitHub(app, { api: ['[]', JSON.stringify(API_LIST)], feed: [emptyFeed] })
  await openUpdates(page)
  await expect(page.getByText('Noch keine Versionen')).toBeVisible()
  await page.getByRole('button', { name: 'Erneut laden' }).click()
  await expect(notes(page)).toHaveCount(1)

  // Reopened: shown right away from the cache, GitHub is not asked again.
  const before = await requests(app)
  await page.keyboard.press('Escape')
  await openUpdates(page)
  await expect(notes(page)).toHaveCount(1)
  await page.waitForTimeout(500)
  expect(await requests(app)).toEqual(before)
})

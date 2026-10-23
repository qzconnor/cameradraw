import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests of the built app (`npm run test:e2e`), see e2e/README.md.
 * https://www.electronjs.org/docs/latest/tutorial/automated-testing
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  // One app at a time: the tests share the screen, the clipboard and the (fake) camera.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // On CI a second try separates a slow runner from a real failure.
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list'
})

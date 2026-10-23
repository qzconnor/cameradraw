import { writeFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from './fixtures'

/** Size, position and maximized state come back after a restart. */

const bounds = { x: 120, y: 90, width: 1000, height: 660 }

test('size and position come back after a restart', async ({ launch }) => {
  const first = await launch()
  await first.app.evaluate(
    ({ BrowserWindow }, b) => BrowserWindow.getAllWindows()[0].setBounds(b),
    bounds
  )
  await first.page.waitForTimeout(300)
  await first.app.close()

  const second = await launch()
  expect(
    await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
  ).toEqual(bounds)

  // Maximized: comes back maximized, with the normal size for restoring.
  await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
  await second.page.waitForTimeout(300)
  await second.app.close()

  const third = await launch()
  const state = await third.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return { maximized: win.isMaximized(), normal: win.getNormalBounds() }
  })
  expect(state.maximized).toBe(true)
  expect(state.normal).toEqual(bounds)
})

test('a position on no screen falls back to the default size', async ({ launch, workspace }) => {
  writeFileSync(
    join(workspace.profile, 'window-state.json'),
    JSON.stringify({ bounds: { x: -9000, y: -9000, width: 1000, height: 660 }, maximized: false })
  )
  const { app } = await launch()
  const { bounds: b, area } = await app.evaluate(({ BrowserWindow, screen }) => ({
    bounds: BrowserWindow.getAllWindows()[0].getBounds(),
    area: screen.getPrimaryDisplay().workArea
  }))
  // 1440 × 900 – Windows makes it smaller on a smaller screen (like the 1024 × 768 of the CI runner).
  if (area.width >= 1440 && area.height >= 900) {
    expect({ width: b.width, height: b.height }).toEqual({ width: 1440, height: 900 })
  } else {
    expect(b.width).toBeLessThanOrEqual(area.width)
    expect(b.height).toBeLessThanOrEqual(area.height)
  }
  // On the screen again
  expect(b.x).toBeGreaterThanOrEqual(area.x - 10)
  expect(b.y).toBeGreaterThanOrEqual(area.y - 10)
  expect(b.x).toBeLessThan(area.x + area.width)
})

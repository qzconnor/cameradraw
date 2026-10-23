import { readFileSync, readdirSync } from 'fs'
import { request } from 'http'
import { createServer } from 'net'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio'
import { expect, test } from './fixtures'
import { canvasBox, storeValue, toast, waitForEditor, waitForLiveCamera } from './helpers/app'
import { addImage, readLayers } from './helpers/library'
import {
  MCP_PORT,
  call,
  callError,
  callImage,
  callText,
  connect,
  mcpMode,
  mcpState,
  mcpUrl,
  waitForMcp
} from './helpers/mcp'

/** Remote control by AI assistants: the MCP server and what its clients can do in the app. */

const editorOpen = (page: import('@playwright/test').Page): Promise<boolean> =>
  storeValue(page, 'editor', 'isOpen')

test.describe('switched off', () => {
  test.use({ settings: { mcpPort: MCP_PORT } })

  test('the MCP server is off until switched on in the settings', async ({ page, workspace }) => {
    expect(await mcpState(page)).toBe('off')
    await expect(connect()).rejects.toThrow()
    // No title bar indicator while it is off.
    await expect(page.getByRole('button', { name: 'KI-Steuerung an (MCP-Server)' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
    await page.getByText('KI-Steuerung (MCP-Server)').click()
    await expect(page.getByText('MCP-Server läuft')).toBeVisible()
    await expect(page.getByText('Noch kein Client verbunden.')).toBeVisible()
    // How to set it up, with the address of this server.
    await expect(page.getByRole('textbox', { name: 'Konfiguration für Claude Code' })).toHaveValue(
      `claude mcp add --transport http cameradraw ${mcpUrl()}`
    )
    await page.getByRole('tab', { name: 'VS Code' }).click()
    const vscode = page.getByRole('textbox', { name: 'Konfiguration für VS Code' })
    expect(JSON.parse(await vscode.inputValue())).toEqual({
      servers: { cameradraw: { type: 'http', url: mcpUrl() } }
    })

    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['get_state', 'capture', 'open_image', 'editor_draw', 'editor_save'])
    )
    await call(client, 'get_state')
    await expect(page.getByText(/Zuletzt verbunden: e2e-client um/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'KI-Steuerung an (MCP-Server)' })).toBeVisible()
    await client.close()

    const settings = (): Record<string, unknown> =>
      JSON.parse(readFileSync(join(workspace.profile, 'settings.json'), 'utf8'))
    expect(settings().mcpEnabled).toBe(true)

    // Off again: the port is closed.
    await page.getByRole('switch', { name: 'KI-Steuerung (MCP-Server)' }).click()
    await expect.poll(() => mcpState(page)).toBe('off')
    await expect(connect()).rejects.toThrow()
    expect(settings().mcpEnabled).toBe(false)
  })
})

test.describe('switched on', () => {
  test.use({ settings: { mcpEnabled: true, mcpPort: MCP_PORT } })

  test('a client takes a picture, draws on it and saves it into a new project', async ({
    page,
    workspace
  }) => {
    await waitForLiveCamera(page)
    await waitForMcp(page)
    const client = await connect()

    const state = await call(client, 'get_state')
    expect(state).toMatchObject({ view: 'camera', camera: { status: 'live' }, editor: null })

    const captured = await call(client, 'capture')
    expect(captured.editor).toMatchObject({ newCapture: true, width: 1920, height: 1080 })
    await waitForEditor(page)

    const drawn = await call(client, 'editor_draw', {
      shapes: [
        { type: 'rect', from: { x: 100, y: 100 }, to: { x: 500, y: 400 }, color: '#22c55e' },
        { type: 'arrow', from: { x: 900, y: 700 }, to: { x: 520, y: 420 } },
        { type: 'text', at: { x: 100, y: 450 }, text: 'Probe', fontSize: 72 },
        { type: 'measure', from: { x: 200, y: 900 }, to: { x: 1000, y: 900 } }
      ]
    })
    expect(drawn.added).toEqual([0, 1, 2, 3])
    expect(drawn.unsavedChanges).toBe(true)
    expect(drawn.objects[0]).toMatchObject({ kind: 'rect', color: '#22c55e', filled: false })
    expect(drawn.objects[2]).toMatchObject({ kind: 'text', text: 'Probe', fontSize: 72 })
    expect(drawn.objects[3]).toMatchObject({ kind: 'measure', lengthPixels: 800, length: '800 px' })
    expect(await storeValue(page, 'editor', 'dirty')).toBe(true)

    // A measuring line of 2 mm sets the scale – like "Als Maßstab verwenden".
    const scale = await call(client, 'editor_set_scale', {
      calibrate: { index: 3, length: 2, unit: 'mm' }
    })
    expect(scale.micronsPerPixel).toBe(2.5)
    const updated = await call(client, 'editor_update', {
      indices: [0],
      filled: true,
      moveBy: { x: 50, y: 0 }
    })
    expect(updated.objects[0]).toMatchObject({ filled: true, box: { left: 146 } })
    expect(updated.objects[3].length).toBe('2 mm')

    const saved = await call(client, 'editor_save', { name: 'Per MCP', project: 'Probe 7' })
    expect(saved).toMatchObject({ saved: { path: 'Probe 7/Per MCP.png' }, editor: null })
    await expect.poll(() => editorOpen(page)).toBe(false)
    await expect(toast(page, 'Bild gespeichert')).toBeVisible()

    const layers = readLayers(workspace.library, 'Probe 7/Per MCP.png')
    expect(layers.objects.map((o) => o['cdKind'])).toEqual(['rect', 'arrow', 'text', 'measure'])
    expect(layers.micronsPerPixel).toBe(2.5)
    await client.close()
  })

  test('a client opens a saved image, changes it and saves it in place', async ({
    page,
    workspace
  }) => {
    addImage(workspace.library, 'Probe 7/Übersicht.png', { layers: {} })
    await waitForMcp(page)
    const client = await connect()

    const library = await call(client, 'list_library')
    expect(library.projects).toEqual([expect.objectContaining({ name: 'Probe 7', images: 1 })])
    expect(library.images.map((i: { path: string }) => i.path).sort()).toEqual([
      'Probe 7/Übersicht.png',
      'Probe.png'
    ])
    const picture = await callImage(client, 'get_image', { path: 'Probe.png', maxSize: 640 })
    expect(picture.mimeType).toBe('image/jpeg')
    expect(picture.text).toContain('640×360')

    const opened = await call(client, 'open_image', { path: 'Probe 7/Übersicht.png' })
    expect(opened).toMatchObject({ path: 'Probe 7/Übersicht.png', objectCount: 0 })
    await waitForEditor(page)

    await call(client, 'editor_draw', {
      shapes: [{ type: 'ellipse', from: { x: 600, y: 300 }, to: { x: 900, y: 500 } }]
    })
    // Unsaved changes are not dropped without asking.
    expect(await callError(client, 'open_image', { path: 'Probe.png' })).toContain(
      'ungespeicherte Änderungen'
    )
    expect(await callError(client, 'editor_close')).toContain('ungespeicherte Änderungen')

    const undone = await call(client, 'editor_history', { action: 'undo' })
    expect(undone).toMatchObject({ undone: 1, objectCount: 0 })
    const redone = await call(client, 'editor_history', { action: 'redo' })
    expect(redone).toMatchObject({ redone: 1, objectCount: 1 })

    const saved = await call(client, 'editor_save')
    expect(saved.saved.path).toBe('Probe 7/Übersicht.png')
    expect(saved.editor).toMatchObject({ path: 'Probe 7/Übersicht.png', unsavedChanges: false })
    expect(readLayers(workspace.library, 'Probe 7/Übersicht.png').objects).toHaveLength(1)
    expect(await editorOpen(page)).toBe(true)

    await call(client, 'editor_close')
    await expect.poll(() => editorOpen(page)).toBe(false)

    // "save" stores the picture right away like burst capture – into the project picked last.
    await waitForLiveCamera(page)
    const shot = await call(client, 'capture', { mode: 'save' })
    expect(shot.saved.path).toMatch(/^Probe 7\/CameraDraw_.*\.png$/)
    expect(readdirSync(join(workspace.library, 'Probe 7'))).toContain(shot.saved.name)
    expect(await editorOpen(page)).toBe(false)
    await client.close()
  })

  test('keys and mouse sent by a client reach the app', async ({ page }) => {
    await waitForLiveCamera(page)
    await waitForMcp(page)
    const client = await connect()

    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const screenshot = await callImage(client, 'screenshot')
    expect(screenshot.mimeType).toBe('image/jpeg')
    expect(screenshot.text).toContain(`${size.width}×${size.height}`)

    // Space freezes the picture, R picks the rectangle, dragging draws one.
    await callText(client, 'press_key', { keys: 'Space' })
    await waitForEditor(page)
    await callText(client, 'press_key', { keys: 'r' })
    await expect.poll(() => storeValue(page, 'editor', 'tool')).toBe('rect')
    const box = await canvasBox(page)
    await callText(client, 'drag', {
      from: { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 },
      to: { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 }
    })
    await expect
      .poll(async () =>
        (await call(client, 'editor_state')).objects.map((o: { kind: string }) => o.kind)
      )
      .toEqual(['rect'])

    await callText(client, 'press_key', { keys: 'Control+Z' })
    await expect.poll(async () => (await call(client, 'editor_state')).objectCount).toBe(0)
    await callText(client, 'press_key', { keys: 'Escape' })
    await expect.poll(() => editorOpen(page)).toBe(false)
    await client.close()
  })

  test('web pages cannot use the server', async ({ page }) => {
    await waitForMcp(page)
    const status = (headers: Record<string, string>): Promise<number> =>
      new Promise((resolve, reject) => {
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        const req = request(
          mcpUrl(),
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              ...headers
            }
          },
          (res) => {
            res.resume()
            resolve(res.statusCode ?? 0)
          }
        )
        req.on('error', reject)
        req.end(body)
      })
    // A page on another site (cross-site request) and a foreign host name (DNS rebinding).
    expect(await status({ origin: 'https://example.com' })).toBe(403)
    expect(await status({ host: `example.com:${MCP_PORT}` })).toBe(403)
  })
})

test.describe('stdio', () => {
  test.use({ settings: { mcpEnabled: true, mcpTransport: 'stdio', mcpPort: MCP_PORT } })

  test('a client starts the app with --mcp and talks to it over stdio', async ({
    page,
    workspace
  }) => {
    await waitForMcp(page)
    // No network port in this mode.
    await expect(connect()).rejects.toThrow()

    // The entry for Claude Desktop, as the settings show it: just the executable with --mcp.
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
    await expect(page.getByText('stdio · cameradraw --mcp')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Claude Desktop' })).toHaveAttribute(
      'data-state',
      'active'
    )
    const entry = JSON.parse(
      await page.getByRole('textbox', { name: 'Konfiguration für Claude Desktop' }).inputValue()
    )
    const server = entry.mcpServers.cameradraw
    expect(Object.keys(server)).toEqual(['command', 'args'])
    expect(server.command).toMatch(/electron\.exe$/i)
    expect(server.args.at(-1)).toBe('--mcp')

    // Started like Claude Desktop does. (The test profile keeps it away from a real CameraDraw.)
    const start = (profile: string): StdioClientTransport =>
      new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: { ...getDefaultEnvironment(), CAMERADRAW_USER_DATA: profile },
        stderr: 'ignore'
      })
    const client = new Client({ name: 'stdio-client', version: '1.0.0' })
    await client.connect(start(workspace.profile))
    expect((await client.listTools()).tools.length).toBeGreaterThan(30)
    expect(await call(client, 'get_state')).toMatchObject({ view: 'camera' })
    await expect(page.getByText(/Zuletzt verbunden: stdio-client/)).toBeVisible()
    await client.close()

    // Without the app on the other end it says what is missing.
    const lost = new Client({ name: 'stdio-client', version: '1.0.0' })
    await expect(lost.connect(start(join(workspace.dir, 'elsewhere')))).rejects.toThrow(
      /CameraDraw ist nicht erreichbar/
    )
    await lost.close()

    // Back to HTTP: the port opens.
    await page.getByText('HTTP', { exact: true }).click()
    await expect.poll(() => mcpMode(page)).toBe('http running')
    const http = await connect()
    expect(await call(http, 'get_state')).toMatchObject({ view: 'camera' })
    await http.close()
  })
})

test.describe('port taken', () => {
  test.use({ settings: { mcpEnabled: true, mcpPort: MCP_PORT } })

  test('says so when the port is used by another program', async ({ launch }) => {
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(MCP_PORT, '127.0.0.1', resolve))
    try {
      const { page } = await launch()
      await expect.poll(() => mcpState(page)).toBe('error')
      await page.getByRole('button', { name: 'MCP-Server läuft nicht' }).click()
      await expect(page.getByText('MCP-Server läuft nicht', { exact: true })).toBeVisible()
      await expect(
        page.getByText(`Port ${MCP_PORT} wird schon von einem anderen Programm verwendet.`)
      ).toBeVisible()
    } finally {
      blocker.close()
    }
  })
})

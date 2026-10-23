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

  test('a client writes notes in Markdown', async ({ page, workspace }) => {
    await waitForMcp(page)
    const client = await connect()
    await call(client, 'open_image', { path: 'Probe.png' })
    await waitForEditor(page)

    const plain = 'Befund\nRiss am Rand\nStelle A\nStelle B'
    const notes = '# Befund\n**Riss** am Rand\n\n| Stelle | Länge |\n|---|--:|\n| A | 0,4 mm |'
    const drawn = await call(client, 'editor_draw', {
      shapes: [
        { type: 'text', at: { x: 100, y: 100 }, text: plain, fontSize: 48 },
        { type: 'text', at: { x: 1000, y: 100 }, text: notes, fontSize: 48 }
      ]
    })
    // The state has the source; the box is the formatted text – the table and the larger
    // heading take more room than four plain lines.
    expect(drawn.objects[1]).toMatchObject({ kind: 'text', text: notes, fontSize: 48 })
    expect(drawn.objects[1].box.height).toBeGreaterThan(drawn.objects[0].box.height * 1.2)

    // Plain text lays out as it did before Markdown: four lines of fabric's line height.
    expect(drawn.objects[0].box.height).toBeCloseTo(48 * 1.13 * (1.16 * 3 + 1), -1)

    const updated = await call(client, 'editor_update', { indices: [1], text: '- [x] geprüft' })
    expect(updated.objects[1].text).toBe('- [x] geprüft')
    expect(updated.objects[1].box.height).toBeLessThan(drawn.objects[1].box.height / 2)

    await call(client, 'editor_save')
    const layers = readLayers(workspace.library, 'Probe.png')
    expect(layers.objects.map((o) => [o['type'], o['text']])).toEqual([
      ['IText', plain],
      ['IText', '- [x] geprüft']
    ])
    await client.close()
  })

  test('a client turns, straightens and extends the picture', async ({ page, workspace }) => {
    await waitForMcp(page)
    const client = await connect()
    await call(client, 'open_image', { path: 'Probe.png' })

    const turned = await call(client, 'editor_rotate', { degrees: 90 })
    expect(turned).toMatchObject({ width: 1080, height: 1920, adjustments: [{ type: 'rotate' }] })
    const straightened = await call(client, 'editor_perspective', {
      // In any order – sorted into top left, top right, bottom right, bottom left.
      corners: [
        { x: 900, y: 1500 },
        { x: 100, y: 100 },
        { x: 900, y: 100 },
        { x: 100, y: 1500 }
      ]
    })
    expect(straightened).toMatchObject({ width: 800, height: 1400 })
    expect(straightened.adjustments[1].corners[0]).toEqual({ x: 100, y: 100 })
    const extended = await call(client, 'editor_extend', { right: 600, color: '#000000' })
    expect(extended).toMatchObject({ width: 1400, height: 1400, unsavedChanges: true })
    expect(
      await callError(client, 'editor_perspective', {
        corners: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
          { x: 30, y: 0 }
        ]
      })
    ).toContain('kein Viereck')

    const undone = await call(client, 'editor_history', { action: 'undo' })
    expect(undone).toMatchObject({ width: 800, height: 1400 })
    const reset = await call(client, 'editor_reset_image')
    expect(reset).toMatchObject({ width: 1920, height: 1080, adjustments: [] })

    await call(client, 'editor_rotate', { degrees: -90 })
    await call(client, 'editor_save')
    expect(readLayers(workspace.library, 'Probe.png')).toMatchObject({
      width: 1080,
      height: 1920,
      adjustments: [{ type: 'rotate', turns: 3 }]
    })
    await client.close()
  })

  test('a client draws into layers of its own and pulls in an image', async ({
    page,
    workspace
  }) => {
    addImage(workspace.library, 'Detail.png')
    await waitForMcp(page)
    const client = await connect()
    await call(client, 'open_image', { path: 'Probe.png' })
    type Layer = {
      id: string
      name: string
      type: string
      owner: string | null
      active: boolean
      objects?: number[]
      box?: { left: number; top: number; width: number; height: number }
      pictureSize?: { width: number; height: number }
      adjustments?: unknown[]
    }
    const layer = (state: { layers: Layer[] }, id: string): Layer =>
      state.layers.find((l) => l.id === id)!
    const names = (state: { layers: Layer[] }): string[] => state.layers.map((l) => l.name)

    // Without a layer: one of its own on top, named after the client – the user keeps theirs.
    const first = await call(client, 'editor_draw', {
      shapes: [{ type: 'rect', from: { x: 100, y: 100 }, to: { x: 300, y: 200 } }]
    })
    expect(layer(first, first.layer)).toMatchObject({
      type: 'drawing',
      name: 'e2e-client',
      owner: 'ai',
      objects: [0]
    })
    expect(names(first)).toEqual(['Bild', 'Zeichnung', 'e2e-client'])
    expect(first.layers.find((l: Layer) => l.active).name).toBe('Zeichnung')

    // As many as it needs: the next drawing goes into the one added last …
    const labels = await call(client, 'editor_layers', { action: 'add', name: 'Beschriftung' })
    const text = await call(client, 'editor_draw', {
      shapes: [{ type: 'text', at: { x: 400, y: 400 }, text: 'Probe' }]
    })
    expect(text.layer).toBe(labels.added)
    // … or into the one asked for.
    const line = await call(client, 'editor_draw', {
      layer: first.layer,
      shapes: [{ type: 'line', from: { x: 0, y: 0 }, to: { x: 50, y: 50 } }]
    })
    expect(layer(line, first.layer).objects).toHaveLength(2)
    expect(line.aiLayer).toBe(first.layer)

    await call(client, 'editor_layers', {
      action: 'update',
      layer: labels.added,
      name: 'Notizen',
      visible: false
    })
    const moved = await call(client, 'editor_layers', {
      action: 'move',
      layer: labels.added,
      to: 'top'
    })
    expect(names(moved)).toEqual(['Bild', 'Zeichnung', 'e2e-client', 'Notizen'])
    expect(layer(moved, labels.added)).toMatchObject({ visible: false })
    expect(
      await callError(client, 'editor_draw', {
        layer: moved.layers[0].id,
        shapes: [{ type: 'line', from: { x: 0, y: 0 }, to: { x: 50, y: 50 } }]
      })
    ).toContain('keine Zeichnungsebene')

    // An image of the library: 800 px wide around (1440, 540) – then cropped on its own.
    const inserted = await call(client, 'editor_insert_image', {
      path: 'Detail.png',
      at: { x: 1440, y: 540 },
      width: 800
    })
    const detail = layer(inserted, inserted.added)
    expect(detail).toMatchObject({ type: 'image', name: 'Detail', owner: 'ai' })
    expect(detail.box).toEqual({ left: 1040, top: 315, width: 800, height: 450 })
    const cropped = await call(client, 'editor_perspective', {
      layer: detail.id,
      corners: [
        { x: 1140, y: 415 },
        { x: 1740, y: 415 },
        { x: 1740, y: 665 },
        { x: 1140, y: 665 }
      ]
    })
    // In the picture's own pixels; its middle stays; the frame and the canvas stay as they are.
    expect(layer(cropped, detail.id).pictureSize).toEqual({ width: 1440, height: 600 })
    expect(layer(cropped, detail.id).box!.left).toBeCloseTo(1140, 0)
    expect(cropped).toMatchObject({ width: 1920, height: 1080, adjustments: [] })

    await call(client, 'editor_layers', { action: 'delete', layer: labels.added })
    await call(client, 'editor_save')
    const saved = readLayers(workspace.library, 'Probe.png')
    expect(saved.layers.map((l) => [l.name, l.owner ?? null])).toEqual([
      ['Bild', null],
      ['Zeichnung', null],
      ['e2e-client', 'ai'],
      ['Detail', 'ai']
    ])
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
      await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
      await expect(page.getByText('MCP-Server läuft nicht', { exact: true })).toBeVisible()
      await expect(
        page.getByText(`Port ${MCP_PORT} wird schon von einem anderen Programm verwendet.`)
      ).toBeVisible()
    } finally {
      blocker.close()
    }
  })
})

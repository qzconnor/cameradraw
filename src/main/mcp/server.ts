import { ipcMain } from 'electron'
import { createServer, type Server } from 'http'
import { CLIENT_INFO_META_KEY, createMcpHandler } from '@modelcontextprotocol/server'
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler
} from '@modelcontextprotocol/node'
import { MCP_PATH, mcpUrl } from '@shared/mcp'
import { IPC } from '@shared/types'
import { getSettings } from '../settings'
import { registerBridgeIpc } from './bridge'
import { getMcpStatus, noteClient, setMcpStatus } from './status'
import { createMcpServer } from './tools'

/**
 * The MCP server: Streamable HTTP on 127.0.0.1 only, off unless switched on in the settings.
 * Host and Origin are checked, so web pages cannot reach it (DNS rebinding, cross-site requests).
 */

let server: Server | null = null
/** Starting and stopping run one after another, also when the setting is toggled quickly. */
let queue: Promise<void> = Promise.resolve()

/** Name of the client from the request: its handshake (2025 protocol) or the request envelope. */
async function clientName(request: Request): Promise<string | null> {
  if (request.method !== 'POST') return null
  try {
    const body = (await request.clone().json()) as {
      method?: string
      params?: { clientInfo?: { name?: unknown }; _meta?: Record<string, { name?: unknown }> }
    }
    const name =
      body.method === 'initialize'
        ? body.params?.clientInfo?.name
        : body.params?._meta?.[CLIENT_INFO_META_KEY]?.name
    return typeof name === 'string' && name ? name : null
  } catch {
    return null
  }
}

function listen(port: number): Promise<Server> {
  const handler = createMcpHandler(() => createMcpServer(), {
    onerror: (err) => console.warn('[mcp]', err.message)
  })
  const serve = toNodeHandler({
    fetch: async (request, options) => {
      noteClient(await clientName(request))
      return handler.fetch(request, options)
    }
  })
  const validHost = localhostHostValidation()
  const validOrigin = localhostOriginValidation()

  const http = createServer((req, res) => {
    if (!validHost(req, res) || !validOrigin(req, res)) return
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (path !== MCP_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`CameraDraw MCP-Server: ${mcpUrl(port)}`)
      return
    }
    void serve(req, res)
  })
  return new Promise((resolve, reject) => {
    http.once('error', reject)
    http.listen(port, '127.0.0.1', () => {
      http.off('error', reject)
      http.on('close', () => void handler.close())
      resolve(http)
    })
  })
}

function close(): Promise<void> {
  const running = server
  server = null
  if (!running) return Promise.resolve()
  // Open streams would keep `close` waiting.
  running.closeAllConnections()
  return new Promise((resolve) => running.close(() => resolve()))
}

async function apply(): Promise<void> {
  const { mcpEnabled, mcpPort } = getSettings()
  const current = getMcpStatus()
  if (mcpEnabled && server && current.state === 'running' && current.port === mcpPort) return
  await close()
  const base = { port: mcpPort, url: mcpUrl(mcpPort), error: null }
  if (!mcpEnabled) {
    setMcpStatus({ ...base, state: 'off' })
    return
  }
  setMcpStatus({ ...base, state: 'starting' })
  try {
    server = await listen(mcpPort)
    setMcpStatus({ state: 'running' })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    setMcpStatus({
      state: 'error',
      error:
        code === 'EADDRINUSE'
          ? `Port ${mcpPort} wird schon von einem anderen Programm verwendet.`
          : `Der Server konnte nicht starten: ${(err as Error).message}`
    })
  }
}

/** Starts, restarts or stops the server to match the settings. */
export function applyMcpSettings(): Promise<void> {
  const run = queue.then(apply)
  queue = run.catch(() => undefined)
  return run
}

export function registerMcpIpc(): void {
  registerBridgeIpc()
  ipcMain.handle(IPC.mcpStatus, () => getMcpStatus())
}

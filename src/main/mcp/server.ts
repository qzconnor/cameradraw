import { ipcMain } from 'electron'
import { existsSync, rmSync } from 'fs'
import { createServer } from 'http'
import { connect, createServer as createPipeServer, type Server, type Socket } from 'net'
import { CLIENT_INFO_META_KEY, createMcpHandler } from '@modelcontextprotocol/server'
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler
} from '@modelcontextprotocol/node'
import { MCP_PATH, mcpUrl, type McpTransport } from '@shared/mcp'
import { IPC } from '@shared/types'
import { getSettings } from '../settings'
import { registerBridgeIpc } from './bridge'
import { getMcpStatus, noteClient, setMcpStatus } from './status'
import { mcpPipePath, stdioCommand } from './stdio'
import { createMcpServer } from './tools'

/**
 * The MCP server, off unless switched on in the settings – one of:
 * - `http`: Streamable HTTP on 127.0.0.1 only. Host and Origin are checked, so web pages cannot
 *   reach it (DNS rebinding, cross-site requests).
 * - `stdio`: a local pipe that `cameradraw.exe --mcp` (started by the client) talks through.
 */

interface Listener {
  close(): Promise<void>
}

let server: Listener | null = null
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

function listenHttp(port: number): Promise<Listener> {
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
      resolve({
        close: async () => {
          // Open streams would keep `close` waiting.
          http.closeAllConnections()
          await new Promise((done) => http.close(done))
          await handler.close()
        }
      })
    })
  })
}

/** A socket file left behind by a crashed app (not on Windows: pipes vanish with their app). */
async function clearStaleSocket(path: string): Promise<void> {
  if (process.platform === 'win32' || !existsSync(path)) return
  const alive = await new Promise<boolean>((resolve) => {
    const probe = connect(path)
    probe.once('connect', () => resolve(true)).once('error', () => resolve(false))
    probe.unref()
  })
  if (!alive) rmSync(path, { force: true })
}

/** One MCP connection per client process – over the pipe as if over its stdio. */
function servePipeClient(socket: Socket): void {
  const handle = serveStdio(
    () => {
      const mcp = createMcpServer()
      // A 2025 client says who it is once, in the handshake.
      mcp.server.oninitialized = () => noteClient(mcp.server.getClientVersion()?.name ?? null)
      return mcp
    },
    {
      transport: new StdioServerTransport(socket, socket),
      onerror: (err) => console.warn('[mcp]', err.message)
    }
  )
  socket.on('error', () => socket.destroy())
  socket.once('close', () => void handle.close())
}

async function listenPipe(): Promise<Listener> {
  const path = mcpPipePath()
  await clearStaleSocket(path)
  const connections = new Set<Socket>()
  const pipe: Server = createPipeServer((socket) => {
    connections.add(socket)
    socket.once('close', () => connections.delete(socket))
    servePipeClient(socket)
  })
  return new Promise((resolve, reject) => {
    pipe.once('error', reject)
    pipe.listen(path, () => {
      pipe.off('error', reject)
      resolve({
        close: async () => {
          for (const socket of connections) socket.destroy()
          await new Promise((done) => pipe.close(done))
        }
      })
    })
  })
}

function close(): Promise<void> {
  const running = server
  server = null
  return running ? running.close() : Promise.resolve()
}

function startError(err: unknown, transport: McpTransport, port: number): string {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    return transport === 'stdio'
      ? 'Eine andere CameraDraw stellt die KI-Steuerung über stdio schon bereit.'
      : `Port ${port} wird schon von einem anderen Programm verwendet.`
  }
  return `Der Server konnte nicht starten: ${(err as Error).message}`
}

async function apply(): Promise<void> {
  const { mcpEnabled, mcpTransport, mcpPort } = getSettings()
  const current = getMcpStatus()
  const unchanged =
    current.state === 'running' && current.transport === mcpTransport && current.port === mcpPort
  if (mcpEnabled && server && unchanged) return
  await close()
  const base = {
    transport: mcpTransport,
    port: mcpPort,
    url: mcpUrl(mcpPort),
    stdio: stdioCommand(),
    error: null
  }
  if (!mcpEnabled) {
    setMcpStatus({ ...base, state: 'off' })
    return
  }
  setMcpStatus({ ...base, state: 'starting' })
  try {
    server = mcpTransport === 'stdio' ? await listenPipe() : await listenHttp(mcpPort)
    setMcpStatus({ state: 'running' })
  } catch (err) {
    setMcpStatus({ state: 'error', error: startError(err, mcpTransport, mcpPort) })
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

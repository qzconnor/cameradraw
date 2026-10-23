import { app } from 'electron'
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { connect } from 'net'
import { tmpdir, userInfo } from 'os'
import { join, resolve } from 'path'
import { createInterface } from 'readline'
import type { McpStdioCommand } from '@shared/mcp'

/**
 * MCP over stdio: a client (e.g. Claude Desktop) starts `cameradraw.exe --mcp`. That process
 * opens no window – it only passes its stdin/stdout on to the running app, which serves MCP on a
 * local pipe. No network port is involved.
 */

const RELAY_FLAG = '--mcp'

const UNREACHABLE =
  'CameraDraw ist nicht erreichbar – läuft die App, und ist die KI-Steuerung mit der Verbindung „stdio“ an?'

/** This process was started by an MCP client, not by the user. */
export const isStdioRelay = (): boolean => process.argv.includes(RELAY_FLAG)

/**
 * The pipe between the two – one per user (and per test profile, so tests never reach the app
 * someone is using).
 */
export function mcpPipePath(): string {
  const owner = process.env['CAMERADRAW_USER_DATA'] ?? userInfo().username
  const key = createHash('sha256').update(owner).digest('hex').slice(0, 16)
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\cameradraw-mcp-${key}`
    : join(tmpdir(), `cameradraw-mcp-${key}.sock`)
}

/**
 * What a client starts: this executable with the flag. Outside the installed app (development,
 * tests) Electron needs the app to run as well.
 */
export function stdioCommand(): McpStdioCommand {
  const appArgs = app.isPackaged ? [] : [resolve(process.argv[1] ?? '.')]
  return { command: process.execPath, args: [...appArgs, RELAY_FLAG] }
}

/**
 * The client's end of the stdio pipe. Electron's `process.stdin` is a stub in the main process on
 * Windows (it ends right away), so the handle the client passed is opened directly.
 */
const openStdin = (): NodeJS.ReadableStream => createReadStream('', { fd: 0 })

/** Without the app: every request gets the reason as its answer, until the client gives up. */
function refuse(input: NodeJS.ReadableStream): void {
  process.stderr.write(`${UNREACHABLE}\n`)
  createInterface({ input })
    .on('line', (line) => {
      try {
        const message = JSON.parse(line) as { id?: unknown; method?: unknown }
        if (message.id === undefined || message.method === undefined) return
        const error = { code: -32000, message: UNREACHABLE }
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error })}\n`)
      } catch {
        // Not a message – nothing to answer.
      }
    })
    .on('close', () => app.exit(0))
}

/** Runs instead of the app: passes the client's stdio through to the running CameraDraw. */
export function runStdioRelay(): void {
  // Nothing is shown, and the profile of the running app stays untouched.
  app.disableHardwareAcceleration()
  app.setPath('userData', join(app.getPath('temp'), 'CameraDraw-MCP'))

  const input = openStdin()
  input.once('error', () => app.exit(0))
  let connected = false
  const socket = connect(mcpPipePath())
  socket.once('connect', () => {
    connected = true
    input.pipe(socket)
    socket.pipe(process.stdout)
  })
  socket.once('error', () => {
    if (!connected) refuse(input)
  })
  // The app quit or switched the control off – the client sees the server end.
  socket.once('close', () => {
    if (connected) app.exit(0)
  })
}

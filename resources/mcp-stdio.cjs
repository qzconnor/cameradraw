// MCP over stdio for clients that only start programs themselves (e.g. Claude Desktop): every
// message goes on to the MCP server of the running CameraDraw, its answers come back.
//
// CameraDraw's own executable runs it as plain Node, so nothing else has to be installed:
//   ELECTRON_RUN_AS_NODE=1 cameradraw.exe mcp-stdio.cjs http://127.0.0.1:3729/mcp
// The settings show the exact entry (KI-Steuerung → Einrichten → Claude Desktop).
'use strict'

const { createInterface } = require('readline')

const url = process.argv[2] || 'http://127.0.0.1:3729/mcp'
const ENVELOPE_VERSION = 'io.modelcontextprotocol/protocolVersion'
const UNREACHABLE =
  'CameraDraw ist nicht erreichbar – läuft die App, und ist in den Einstellungen die KI-Steuerung an?'

/** Protocol version agreed in the 2025 handshake – the server expects it with every request. */
let protocolVersion = null

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

/** Answers a request with an error (notifications and responses get no answer). */
function fail(message, text) {
  if (message && message.id !== undefined && message.method !== undefined) {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: text } })
  }
}

function relay(text, request) {
  if (!text.trim()) return
  for (const answer of [].concat(JSON.parse(text))) {
    if (request.method === 'initialize' && answer.result && answer.result.protocolVersion) {
      protocolVersion = answer.result.protocolVersion
    }
    send(answer)
  }
}

/** Server-sent events: every `data:` block is one message. */
async function relayEvents(body, request) {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n')
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      const data = buffer
        .slice(0, end)
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      buffer = buffer.slice(end + 2)
      relay(data, request)
    }
  }
}

async function forward(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    return
  }
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  }
  const meta = message.params && message.params._meta
  const version = (meta && meta[ENVELOPE_VERSION]) || protocolVersion
  if (version) headers['mcp-protocol-version'] = version

  let response
  try {
    response = await fetch(url, { method: 'POST', headers, body: line })
  } catch {
    fail(message, UNREACHABLE)
    return
  }
  try {
    const type = response.headers.get('content-type') || ''
    if (response.status === 202) return
    if (type.includes('text/event-stream')) await relayEvents(response.body, message)
    else if (type.includes('json')) relay(await response.text(), message)
    else fail(message, `CameraDraw antwortet mit HTTP ${response.status}.`)
  } catch (err) {
    fail(message, `Antwort von CameraDraw nicht lesbar: ${err.message}`)
  }
}

process.stderr.write(`CameraDraw MCP (stdio) → ${url}\n`)
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim()) void forward(line)
})

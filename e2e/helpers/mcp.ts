import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { expect, type Page } from '@playwright/test'

/** Not the default port – a CameraDraw running next to the tests may use that one. */
export const MCP_PORT = 39731

export const mcpUrl = (port = MCP_PORT): string => `http://127.0.0.1:${port}/mcp`

export function mcpState(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as { api: { mcp: { status(): Promise<{ state: string }> } } }).api.mcp
      .status()
      .then((s) => s.state)
  )
}

export async function waitForMcp(page: Page): Promise<void> {
  await expect.poll(() => mcpState(page)).toBe('running')
}

/** An MCP client like Claude Code, connected to the app. */
export async function connect(port = MCP_PORT): Promise<Client> {
  const client = new Client({ name: 'e2e-client', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl(port))))
  return client
}

interface ToolResult {
  isError?: boolean
  content: { type: string; text?: string; data?: string; mimeType?: string }[]
}

async function callTool(client: Client, name: string, args: object): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args as Record<string, unknown> })) as ToolResult
}

const textOf = (result: ToolResult): string =>
  result.content.find((c) => c.type === 'text')?.text ?? ''

/** Calls a tool and returns its JSON answer; fails if the tool reports an error. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function call<T = any>(client: Client, name: string, args: object = {}): Promise<T> {
  const result = await callTool(client, name, args)
  if (result.isError) throw new Error(`${name}: ${textOf(result)}`)
  return JSON.parse(textOf(result)) as T
}

/** Calls a tool that answers with text (e.g. the input tools) and returns it. */
export async function callText(client: Client, name: string, args: object = {}): Promise<string> {
  const result = await callTool(client, name, args)
  if (result.isError) throw new Error(`${name}: ${textOf(result)}`)
  return textOf(result)
}

/** Calls a tool that must fail and returns its message. */
export async function callError(client: Client, name: string, args: object = {}): Promise<string> {
  const result = await callTool(client, name, args)
  expect(result.isError, `${name} should fail`).toBe(true)
  return textOf(result)
}

/** Calls a tool that answers with a picture: its type and the text next to it. */
export async function callImage(
  client: Client,
  name: string,
  args: object = {}
): Promise<{ mimeType: string; bytes: Buffer; text: string }> {
  const result = await callTool(client, name, args)
  if (result.isError) throw new Error(`${name}: ${textOf(result)}`)
  const image = result.content.find((c) => c.type === 'image')
  if (!image?.data || !image.mimeType) throw new Error(`${name}: no picture`)
  return {
    mimeType: image.mimeType,
    bytes: Buffer.from(image.data, 'base64'),
    text: textOf(result)
  }
}

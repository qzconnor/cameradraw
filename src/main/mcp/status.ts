import { BrowserWindow } from 'electron'
import { DEFAULT_MCP_PORT, mcpUrl, type McpStatus } from '@shared/mcp'
import { IPC } from '@shared/types'

let status: McpStatus = {
  state: 'off',
  port: DEFAULT_MCP_PORT,
  url: mcpUrl(DEFAULT_MCP_PORT),
  error: null,
  lastClient: null,
  activeCalls: 0
}

export const getMcpStatus = (): McpStatus => status

/** Updates the status and shows it in the app (settings, title bar). */
export function setMcpStatus(patch: Partial<McpStatus>): void {
  status = { ...status, ...patch }
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send(IPC.mcpStatusChanged, status)
}

/** A client spoke to the server – named if the request says who it is. */
export function noteClient(name: string | null): void {
  const known = name ?? status.lastClient?.name
  if (known) setMcpStatus({ lastClient: { name: known, at: Date.now() } })
}

/** Counts a tool call while it runs, so the app can show that it is being controlled. */
export async function trackCall<T>(run: () => Promise<T>): Promise<T> {
  setMcpStatus({ activeCalls: status.activeCalls + 1 })
  try {
    return await run()
  } finally {
    setMcpStatus({ activeCalls: Math.max(0, status.activeCalls - 1) })
  }
}

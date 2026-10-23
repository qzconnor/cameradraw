/**
 * Remote control of the running app by AI assistants through an MCP server (Model Context
 * Protocol, see `src/main/mcp/`). The main process serves the protocol; everything that happens
 * on screen – camera, gallery, editor – is done by the renderer, so the user watches it live.
 */

import type { AppSettings } from './types'

export const DEFAULT_MCP_PORT = 3729
export const MCP_PATH = '/mcp'
/** Name under which the server is suggested to MCP clients. */
export const MCP_SERVER_NAME = 'cameradraw'

export const mcpUrl = (port: number): string => `http://127.0.0.1:${port}${MCP_PATH}`

/** Ports below 1024 need admin rights on some systems. */
export const isValidMcpPort = (port: unknown): port is number =>
  typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535

/**
 * `http`: clients connect to the address (a port on 127.0.0.1) · `stdio`: clients start
 * `cameradraw.exe --mcp`, which talks to the running app over a local pipe – no network port.
 */
export type McpTransport = 'http' | 'stdio'

export const isMcpTransport = (value: unknown): value is McpTransport =>
  value === 'http' || value === 'stdio'

/** The program an MCP client starts for stdio – this app's executable. */
export interface McpStdioCommand {
  command: string
  args: string[]
}

export interface McpStatus {
  /** `off`: switched off in the settings · `error`: could not start, e.g. the port is taken. */
  state: 'off' | 'starting' | 'running' | 'error'
  transport: McpTransport
  port: number
  /** Endpoint for MCP clients (`http`). */
  url: string
  /** What a client starts (`stdio`). */
  stdio: McpStdioCommand
  error: string | null
  /** The client that connected last (its name from the handshake) and when (ms since epoch). */
  lastClient: { name: string; at: number } | null
  /** Tool calls being handled right now. */
  activeCalls: number
}

// ── Requests to the renderer ──────────────────────────────────────────────────

/** A request of the MCP server, run by the renderer on the live app. */
export interface RemoteRequest {
  id: number
  action: RemoteAction
  args: unknown
}

export interface RemoteResponse {
  id: number
  result?: unknown
  error?: string
}

export interface RemotePoint {
  x: number
  y: number
}

export type RemoteTool =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'eraser'
  | 'measure'

/** Style values as in the editor's toolbar: sizes for a 1920 px wide image, scaled to the image. */
export interface RemoteStyle {
  color?: string
  strokeWidth?: number
  fontSize?: number
  filled?: boolean
}

/** A shape added by `editorDraw`, in image pixels (0,0 = top left). */
export type RemoteShape = RemoteStyle &
  (
    | {
        type: 'line' | 'arrow' | 'rect' | 'ellipse' | 'measure'
        from: RemotePoint
        to: RemotePoint
      }
    | { type: 'pen' | 'highlighter'; points: RemotePoint[] }
    | { type: 'text'; at: RemotePoint; text: string }
  )

export type RemotePanel = 'gallery' | 'settings' | 'modules' | 'updates' | 'none'

/** Settings an MCP client may change – not the MCP server itself. */
export type RemoteSettings = Partial<
  Pick<
    AppSettings,
    'saveDir' | 'mirror' | 'ambientLight' | 'preferCameraZoom' | 'stopCameraWhenHidden'
  >
>

/** Arguments of every action the renderer runs (results are plain JSON, see `src/renderer/src/mcp/`). */
export interface RemoteActionArgs {
  state: Record<string, never>
  listCameras: { refresh?: boolean }
  selectCamera: { id?: string; label?: string }
  setCamera: { paused?: boolean; zoom?: number }
  capture: { mode?: 'edit' | 'save' }
  setBurst: { enabled?: boolean; project?: string | null }
  showPanel: { panel: RemotePanel; project?: string | null; query?: string }
  listLibrary: { project?: string | null; query?: string; limit?: number }
  openImage: { path: string; discard?: boolean }
  createProject: { name: string }
  renameProject: { name: string; newName: string }
  deleteProject: { name: string }
  renameImage: { path: string; newName: string }
  moveImage: { path: string; project: string | null }
  deleteImage: { path: string }
  copyImage: { path: string }
  editorState: Record<string, never>
  editorImage: { drawing?: boolean }
  editorDraw: { shapes: RemoteShape[] }
  editorSelect: { indices?: number[]; all?: boolean }
  editorUpdate: RemoteStyle & { indices: number[]; text?: string; moveBy?: RemotePoint }
  editorDelete: { indices?: number[]; all?: boolean }
  editorArrange: { indices: number[]; where: 'front' | 'back' }
  editorClipboard: {
    action: 'copy' | 'cut' | 'paste' | 'duplicate'
    indices?: number[]
    at?: RemotePoint
  }
  editorHistory: { action: 'undo' | 'redo'; steps?: number }
  editorSetTool: RemoteStyle & { tool?: RemoteTool }
  editorSetView: { zoom?: number; center?: RemotePoint }
  editorSetScale: {
    micronsPerPixel?: number | null
    calibrate?: { index: number; length: number; unit: 'µm' | 'mm'; remember?: boolean }
  }
  editorSave: { name?: string; project?: string | null; asCopy?: boolean; close?: boolean }
  editorCopyImage: Record<string, never>
  editorRotate: { degrees: 90 | 180 | 270 | -90 }
  editorPerspective: { corners: RemotePoint[]; width?: number; height?: number }
  editorExtend: { top?: number; right?: number; bottom?: number; left?: number; color?: string }
  editorResetImage: Record<string, never>
  editorClose: { discard?: boolean }
  updateSettings: RemoteSettings
}

export type RemoteAction = keyof RemoteActionArgs

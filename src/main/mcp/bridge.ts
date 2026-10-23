import { BrowserWindow, ipcMain } from 'electron'
import type { RemoteAction, RemoteActionArgs, RemoteRequest, RemoteResponse } from '@shared/mcp'
import { IPC } from '@shared/types'

/** Opening a picture or starting the camera can take a while, a hanging renderer must not block. */
const TIMEOUT = 60_000

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
  sender: Electron.WebContents
}

let nextId = 1
const pending = new Map<number, Pending>()
const watched = new WeakSet<Electron.WebContents>()

/** The app window – everything a client does happens there, so the user can watch. */
export function mainWindow(): BrowserWindow {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) throw new Error('Das Fenster von CameraDraw ist nicht offen.')
  return win
}

/** Runs an action in the renderer (see `src/renderer/src/mcp/`) and resolves with its result. */
export function callRenderer<A extends RemoteAction>(
  action: A,
  args: RemoteActionArgs[A]
): Promise<unknown> {
  const sender = mainWindow().webContents
  watchPage(sender)
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('CameraDraw hat nicht rechtzeitig geantwortet.'))
    }, TIMEOUT)
    pending.set(id, { resolve, reject, timer, sender })
    const request: RemoteRequest = { id, action, args }
    sender.send(IPC.mcpRequest, request)
  })
}

/** Answers from the renderer; a reload drops the requests it had not answered yet. */
export function registerBridgeIpc(): void {
  ipcMain.on(IPC.mcpResponse, (e, response: RemoteResponse) => {
    const request = pending.get(response?.id)
    if (!request || request.sender !== e.sender) return
    pending.delete(response.id)
    clearTimeout(request.timer)
    if (typeof response.error === 'string') request.reject(new Error(response.error))
    else request.resolve(response.result)
  })
}

/** Ends the requests a reloaded or closed page will never answer. */
function dropPending(sender: Electron.WebContents): void {
  for (const [id, request] of pending) {
    if (request.sender !== sender) continue
    pending.delete(id)
    clearTimeout(request.timer)
    request.reject(new Error('Die Oberfläche von CameraDraw wurde neu geladen.'))
  }
}

function watchPage(sender: Electron.WebContents): void {
  if (watched.has(sender)) return
  watched.add(sender)
  sender.on('did-start-loading', () => dropPending(sender))
  sender.once('destroyed', () => dropPending(sender))
}

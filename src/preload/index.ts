import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type { CameraDrawApi } from '@shared/api'
import type { UpdateState } from '@shared/types'
import type { BrightnessEvent, ButtonServiceStatus, StillButtonEvent } from '@shared/devices'
import type { McpStatus, RemoteRequest, RemoteResponse } from '@shared/mcp'

const api: CameraDrawApi = {
  platform: process.platform,
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch)
  },
  pickFolder: (defaultPath) => ipcRenderer.invoke(IPC.pickFolder, defaultPath ?? undefined),
  library: {
    list: () => ipcRenderer.invoke(IPC.libraryList),
    save: (req) => ipcRenderer.invoke(IPC.librarySave, req),
    load: (path) => ipcRenderer.invoke(IPC.libraryLoad, path),
    remove: (path) => ipcRenderer.invoke(IPC.libraryRemove, path),
    move: (path, project) => ipcRenderer.invoke(IPC.libraryMove, path, project),
    rename: (path, name) => ipcRenderer.invoke(IPC.libraryRename, path, name),
    reveal: (path) => ipcRenderer.invoke(IPC.libraryReveal, path),
    openFolder: () => ipcRenderer.invoke(IPC.libraryOpenFolder),
    copyImage: (path) => ipcRenderer.invoke(IPC.libraryCopyImage, path),
    createProject: (name) => ipcRenderer.invoke(IPC.libraryCreateProject, name),
    renameProject: (from, to) => ipcRenderer.invoke(IPC.libraryRenameProject, from, to),
    removeProject: (name) => ipcRenderer.invoke(IPC.libraryRemoveProject, name),
    onChanged: (callback) => {
      const listener = (): void => callback()
      ipcRenderer.on(IPC.libraryChanged, listener)
      return () => ipcRenderer.removeListener(IPC.libraryChanged, listener)
    }
  },
  clipboard: {
    writeImage: (png) => ipcRenderer.invoke(IPC.clipboardWriteImage, png),
    writeText: (text) => ipcRenderer.invoke(IPC.clipboardWriteText, text)
  },
  devices: {
    systemCameras: () => ipcRenderer.invoke(IPC.systemCameras)
  },
  buttons: {
    status: () => ipcRenderer.invoke(IPC.buttonsStatus),
    watch: (devices) => ipcRenderer.send(IPC.buttonsWatch, devices),
    install: () => ipcRenderer.invoke(IPC.buttonsInstall),
    uninstall: () => ipcRenderer.invoke(IPC.buttonsUninstall),
    onStatus: (callback) => {
      const listener = (_e: Electron.IpcRendererEvent, status: ButtonServiceStatus): void =>
        callback(status)
      ipcRenderer.on(IPC.buttonsStatusChanged, listener)
      return () => ipcRenderer.removeListener(IPC.buttonsStatusChanged, listener)
    },
    onPress: (callback) => {
      const listener = (_e: Electron.IpcRendererEvent, event: StillButtonEvent): void =>
        callback(event)
      ipcRenderer.on(IPC.buttonsPressed, listener)
      return () => ipcRenderer.removeListener(IPC.buttonsPressed, listener)
    }
  },
  controls: {
    watchBrightness: (devices) => ipcRenderer.send(IPC.controlsWatchBrightness, devices),
    onBrightness: (callback) => {
      const listener = (_e: Electron.IpcRendererEvent, event: BrightnessEvent): void =>
        callback(event)
      ipcRenderer.on(IPC.controlsBrightness, listener)
      return () => ipcRenderer.removeListener(IPC.controlsBrightness, listener)
    }
  },
  updates: {
    state: () => ipcRenderer.invoke(IPC.updatesState),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    download: () => ipcRenderer.invoke(IPC.updatesDownload),
    install: () => ipcRenderer.send(IPC.updatesInstall),
    releases: () => ipcRenderer.invoke(IPC.updatesReleases),
    onChanged: (callback) => {
      const listener = (_e: Electron.IpcRendererEvent, state: UpdateState): void => callback(state)
      ipcRenderer.on(IPC.updatesChanged, listener)
      return () => ipcRenderer.removeListener(IPC.updatesChanged, listener)
    },
    onShow: (callback) => {
      const listener = (): void => callback()
      ipcRenderer.on(IPC.updatesShow, listener)
      return () => ipcRenderer.removeListener(IPC.updatesShow, listener)
    }
  },
  windowState: {
    onMinimizedChange: (callback) => {
      const listener = (_e: Electron.IpcRendererEvent, minimized: boolean): void =>
        callback(minimized)
      ipcRenderer.on(IPC.windowMinimized, listener)
      return () => ipcRenderer.removeListener(IPC.windowMinimized, listener)
    }
  },
  mcp: {
    status: () => ipcRenderer.invoke(IPC.mcpStatus),
    onStatus: (callback) => {
      const listener = (_e: Electron.IpcRendererEvent, status: McpStatus): void => callback(status)
      ipcRenderer.on(IPC.mcpStatusChanged, listener)
      return () => ipcRenderer.removeListener(IPC.mcpStatusChanged, listener)
    },
    serve: (handler) => {
      const answer = (response: RemoteResponse): void => ipcRenderer.send(IPC.mcpResponse, response)
      const listener = (_e: Electron.IpcRendererEvent, { id, action, args }: RemoteRequest): void =>
        void handler(action, args)
          .then((result) => answer({ id, result }))
          // Also when the result cannot be sent (not cloneable).
          .catch((err: unknown) =>
            answer({ id, error: err instanceof Error ? err.message : String(err) })
          )
      ipcRenderer.on(IPC.mcpRequest, listener)
      return () => ipcRenderer.removeListener(IPC.mcpRequest, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

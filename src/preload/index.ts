import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type { CameraDrawApi } from '@shared/api'
import type { BrightnessEvent, ButtonServiceStatus, StillButtonEvent } from '@shared/devices'

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
    createProject: (name) => ipcRenderer.invoke(IPC.libraryCreateProject, name),
    renameProject: (from, to) => ipcRenderer.invoke(IPC.libraryRenameProject, from, to),
    removeProject: (name) => ipcRenderer.invoke(IPC.libraryRemoveProject, name),
    onChanged: (callback) => {
      const listener = (): void => callback()
      ipcRenderer.on(IPC.libraryChanged, listener)
      return () => ipcRenderer.removeListener(IPC.libraryChanged, listener)
    }
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
  }
}

contextBridge.exposeInMainWorld('api', api)

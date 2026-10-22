/** Persisted application settings (stored as JSON in the userData folder). */
export interface AppSettings {
  /** Folder where all drawings are saved. Must be chosen on first start. */
  saveDir: string | null
  /** deviceId of the camera the user picked last. */
  cameraId: string | null
  /** Label of that camera, used to recognise it again if the deviceId changes. */
  cameraLabel: string | null
  /** Mirror the live preview (and captured frame) horizontally. */
  mirror: boolean
  /** Let the picture's colours glow into the empty space around it instead of black bars. */
  ambientLight: boolean
  /** Use the camera's own zoom if it has one (otherwise / when off: digital zoom). */
  preferCameraZoom: boolean
  /**
   * Switch the camera off (free for other apps) while its picture is not shown – paused, while
   * editing or with the window minimized – instead of keeping it running in the background.
   */
  stopCameraWhenHidden: boolean
  /** Ids of device modules the user switched off. */
  disabledModules: string[]
  /** Camera label → module id or `none`. Cameras missing here are matched automatically. */
  cameraModules: Record<string, string>
  /** Camera label → its last calibration, applied to new pictures. */
  cameraScales: Record<string, CameraScale>
}

export interface AppState {
  settings: AppSettings
  /** False if `saveDir` is set but the folder no longer exists or is not writable. */
  saveDirAvailable: boolean
}

export interface GalleryItem {
  /** Identifies the image: `<file>` or `<project>/<file>` inside the save folder. */
  path: string
  /** File name, e.g. `CameraDraw_2026-10-21_15-50-12.png`. */
  name: string
  /** Project (sub folder of the save folder) the image is in, null if it lies directly in it. */
  project: string | null
  /** Full-size image, served through the `cdraw://` protocol. */
  url: string
  /** Small JPEG thumbnail, served through the `cdraw://` protocol. */
  thumbUrl: string
  /** Last modification time (ms since epoch). */
  mtime: number
  /**
   * When the picture was taken (ms since epoch): stored with its layers, otherwise the time in its
   * default file name, otherwise `mtime`. The gallery shows, sorts and filters by it, so editing,
   * copying or syncing an image does not change its date.
   */
  capturedAt: number
  size: number
  /** True if layered drawing data exists, so shapes stay individually editable. */
  editable: boolean
}

/** A project is a sub folder of the save folder. */
export interface GalleryProject {
  name: string
  /** Last modification time of the folder (ms since epoch). */
  mtime: number
}

export interface LibraryListing {
  projects: GalleryProject[]
  /** Images of the save folder and of all projects. */
  items: GalleryItem[]
}

/** Serialized drawing layer (fabric objects) on top of the base image. */
export interface EditorDocument {
  version: 1
  width: number
  height: number
  objects: Record<string, unknown>[]
  /** When the picture was taken (ms since epoch); added on saving, missing in older files. */
  capturedAt?: number
  /** Scale of the picture for measuring, if known (calibrated). */
  micronsPerPixel?: number
  /** How the picture was taken – needed to carry a calibration over to other pictures. */
  capture?: CaptureInfo
}

export interface CaptureInfo {
  /** Zoom factor of the camera view (digital or the camera's own), 1 = none. */
  zoom: number
  /** Width of the camera frame in pixels. */
  frameWidth: number
}

/**
 * Calibration of a camera, remembered for new pictures: microns per pixel of a frame of
 * `frameWidth` pixels without zoom. Only right as long as magnification and distance stay the
 * same.
 */
export interface CameraScale {
  micronsPerPixel: number
  frameWidth: number
}

export interface SaveImageRequest {
  /** Path of the image being edited, or null for a new capture. */
  source: string | null
  /**
   * Where to save (`<file>` or `<project>/<file>`). Differs from `source` to rename or move the
   * image; a missing project folder is created.
   */
  target: string
  /** Flattened result image, encoded to match the file extension of `target`. */
  image: Uint8Array
  /** Untouched base image (camera frame), PNG. */
  base: Uint8Array
  document: EditorDocument
  /** When the picture was taken – an edited image keeps the date it had. */
  capturedAt: number
}

export interface LoadedImage {
  path: string
  /** Base image bytes – the original frame if available, otherwise the flattened file. */
  base: Uint8Array
  baseMime: string
  /** Editable drawing layer, null if the file has no project data. */
  document: EditorDocument | null
  /** When the picture was taken, see `GalleryItem.capturedAt`. */
  capturedAt: number
}

/**
 * `unsupported`: not an installed app (development) · `idle`: not checked yet ·
 * `up-to-date` / `available`: result of the last check.
 */
export type UpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** Installed version. */
  current: string
  /** Version the update brings (available, downloading, downloaded – kept after an error). */
  next: string | null
  /** Download progress in percent. */
  progress: number
  /** End of the last check (ms since epoch). */
  checkedAt: number | null
  error: string | null
}

/** A published release with its notes (from GitHub). */
export interface ReleaseNote {
  version: string
  /** ISO date of publication. */
  date: string
  /** Release notes as HTML, rendered (and sanitized) by GitHub. */
  html: string
  url: string
}

export const IPC = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  pickFolder: 'dialog:pick-folder',
  libraryList: 'library:list',
  librarySave: 'library:save',
  libraryLoad: 'library:load',
  libraryRemove: 'library:remove',
  libraryMove: 'library:move',
  libraryRename: 'library:rename',
  libraryReveal: 'library:reveal',
  libraryCreateProject: 'library:create-project',
  libraryRenameProject: 'library:rename-project',
  libraryRemoveProject: 'library:remove-project',
  libraryOpenFolder: 'library:open-folder',
  libraryCopyImage: 'library:copy-image',
  libraryChanged: 'library:changed',
  clipboardWriteImage: 'clipboard:write-image',
  systemCameras: 'devices:system-cameras',
  buttonsStatus: 'buttons:status',
  buttonsWatch: 'buttons:watch',
  buttonsInstall: 'buttons:install',
  buttonsUninstall: 'buttons:uninstall',
  buttonsStatusChanged: 'buttons:status-changed',
  buttonsPressed: 'buttons:pressed',
  controlsWatchBrightness: 'controls:watch-brightness',
  controlsBrightness: 'controls:brightness',
  updatesState: 'updates:state',
  updatesCheck: 'updates:check',
  updatesDownload: 'updates:download',
  updatesInstall: 'updates:install',
  updatesReleases: 'updates:releases',
  updatesChanged: 'updates:changed',
  updatesShow: 'updates:show',
  windowMinimized: 'window:minimized'
} as const

export const MEDIA_SCHEME = 'cdraw'

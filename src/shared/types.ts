import type { McpTransport } from './mcp'

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
  /** Let AI assistants control the app through the MCP server (see `shared/mcp.ts`). */
  mcpEnabled: boolean
  /** How MCP clients connect, see `McpTransport`. */
  mcpTransport: McpTransport
  /** Port of the MCP server on 127.0.0.1 (`http`). */
  mcpPort: number
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

export interface ImagePoint {
  x: number
  y: number
}

/**
 * A change of the picture itself. Saved with the layers and applied to the original frame in
 * order, so the original stays untouched (see `renderer/src/editor/adjust.ts`).
 */
export type ImageAdjustment =
  /** Turned clockwise by quarter turns. */
  | { type: 'rotate'; turns: 1 | 2 | 3 }
  /**
   * The quadrilateral `corners` (top left, top right, bottom right, bottom left – in the picture
   * before this step) straightened into a `width` × `height` rectangle.
   */
  | {
      type: 'perspective'
      corners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint]
      width: number
      height: number
    }
  /** Space added around the picture, filled with `color`. */
  | { type: 'extend'; top: number; right: number; bottom: number; left: number; color: string }

interface LayerBase {
  /** Short random id, unique within the document. */
  id: string
  name: string
  visible: boolean
  /** Locked layers cannot be selected or moved in the picture (an image can still be cropped). */
  locked: boolean
  /** Drawn by an AI assistant (MCP) – it keeps its own layers. */
  owner?: 'ai'
}

/**
 * A picture: the original frame (`source: 'base'`) or one pulled in from the gallery (an id of
 * the pictures saved next to the image, see `LayerPicture`). Its adjustments are applied to the
 * source, so it can be cropped again later; the result lies at `left`/`top`, scaled by `scale`.
 */
export interface ImageLayerData extends LayerBase {
  type: 'image'
  source: string
  adjustments: ImageAdjustment[]
  left: number
  top: number
  scale: number
}

/** Plain space added beside the picture, filled with `color`. */
export interface FillLayerData extends LayerBase {
  type: 'fill'
  color: string
  left: number
  top: number
  width: number
  height: number
}

/** Shapes, texts and measuring lines (fabric objects, bottom first). */
export interface DrawingLayerData extends LayerBase {
  type: 'drawing'
  objects: Record<string, unknown>[]
}

export type LayerData = ImageLayerData | FillLayerData | DrawingLayerData

export type LayerType = LayerData['type']

/** The editable layers of an image, stored as JSON next to it. */
export interface EditorDocument {
  version: 2
  /** Size of the canvas the layers lie on. */
  width: number
  height: number
  /** Bottom first. */
  layers: LayerData[]
  /** When the picture was taken (ms since epoch); added on saving. */
  capturedAt?: number
  /** Scale of the picture for measuring, if known (calibrated). */
  micronsPerPixel?: number
  /** How the picture was taken – needed to carry a calibration over to other pictures. */
  capture?: CaptureInfo
}

/** Layers as written before there were layers: one drawing on the (adjusted) frame. */
export interface LegacyEditorDocument {
  version: 1
  /** Size of the picture the objects are drawn on – after the adjustments. */
  width: number
  height: number
  objects: Record<string, unknown>[]
  /** Changes of the picture (turned, straightened, extended); missing in older files. */
  adjustments?: ImageAdjustment[]
  capturedAt?: number
  micronsPerPixel?: number
  capture?: CaptureInfo
}

/** A picture of an image layer (PNG), besides the original frame. */
export interface LayerPicture {
  /** Letters and digits only – it names the file. */
  id: string
  bytes: Uint8Array
}

export const isPictureId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-z0-9]{1,32}$/i.test(id)

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
  /** Pictures of the image layers besides the frame – those not listed are removed. */
  pictures: LayerPicture[]
  /** When the picture was taken – an edited image keeps the date it had. */
  capturedAt: number
}

export interface LoadedImage {
  path: string
  /** Base image bytes – the original frame if available, otherwise the flattened file. */
  base: Uint8Array
  baseMime: string
  /** Editable layers, null if the file has no project data (older versions: `version: 1`). */
  document: EditorDocument | LegacyEditorDocument | null
  /** Pictures of its image layers besides the frame. */
  pictures: LayerPicture[]
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
  libraryReadImage: 'library:read-image',
  libraryChanged: 'library:changed',
  clipboardWriteImage: 'clipboard:write-image',
  clipboardWriteText: 'clipboard:write-text',
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
  windowMinimized: 'window:minimized',
  mcpStatus: 'mcp:status',
  mcpStatusChanged: 'mcp:status-changed',
  mcpRequest: 'mcp:request',
  mcpResponse: 'mcp:response'
} as const

export const MEDIA_SCHEME = 'cdraw'

import type {
  BrightnessEvent,
  ButtonServiceStatus,
  StillButtonEvent,
  SystemCamera,
  UsbDeviceId
} from './devices'
import type {
  AppSettings,
  AppState,
  GalleryItem,
  LibraryListing,
  LoadedImage,
  ReleaseNote,
  SaveImageRequest,
  UpdateState
} from './types'

/** API exposed by the preload script as `window.api`. */
export interface CameraDrawApi {
  platform: string
  settings: {
    get(): Promise<AppState>
    update(patch: Partial<AppSettings>): Promise<AppState>
  }
  pickFolder(defaultPath?: string | null): Promise<string | null>
  /** Images are addressed by their path (`<file>` or `<project>/<file>`, see `shared/names.ts`). */
  library: {
    list(): Promise<LibraryListing>
    save(req: SaveImageRequest): Promise<GalleryItem>
    load(path: string): Promise<LoadedImage>
    remove(path: string): Promise<void>
    /**
     * Moves an image into a project (null: directly into the save folder) and returns its new
     * path. If the name is taken there, a number is appended.
     */
    move(path: string, project: string | null): Promise<string>
    /** Gives an image a new file name (incl. extension) in its project; returns its new path. */
    rename(path: string, name: string): Promise<string>
    /** Shows an image or a project folder in the file explorer. */
    reveal(path: string): Promise<void>
    openFolder(): Promise<string>
    /** Puts the image (as saved, with its drawing) on the clipboard. */
    copyImage(path: string): Promise<void>
    createProject(name: string): Promise<void>
    renameProject(from: string, to: string): Promise<void>
    /** Moves a project folder with all its images to the trash. */
    removeProject(name: string): Promise<void>
    /** Subscribes to changes in the save folder; returns an unsubscribe function. */
    onChanged(callback: () => void): () => void
  }
  clipboard: {
    /** Puts a PNG on the clipboard, e.g. to paste it into a document or a chat. */
    writeImage(png: Uint8Array): Promise<void>
  }
  devices: {
    /** Cameras registered with the OS (Windows only, otherwise null). */
    systemCameras(): Promise<SystemCamera[] | null>
  }
  /** Photo buttons of USB cameras via the "CameraDraw Buttons" background service. */
  buttons: {
    status(): Promise<ButtonServiceStatus>
    /** Devices whose button presses should be reported; replaces the previous list. */
    watch(devices: UsbDeviceId[]): void
    /** Installs or updates the service – Windows asks for admin rights. */
    install(): Promise<ButtonServiceStatus>
    uninstall(): Promise<ButtonServiceStatus>
    onStatus(callback: (status: ButtonServiceStatus) => void): () => void
    onPress(callback: (event: StillButtonEvent) => void): () => void
  }
  /**
   * Camera controls read regularly by the app itself (Windows only, no service or admin rights).
   * Some cameras report buttons through them, e.g. the microscope's zoom buttons.
   */
  controls: {
    /** Devices whose UVC brightness should be read; replaces the previous list. */
    watchBrightness(devices: UsbDeviceId[]): void
    onBrightness(callback: (event: BrightnessEvent) => void): () => void
  }
  /** App updates from the GitHub releases (only in the installed app) and their notes. */
  updates: {
    state(): Promise<UpdateState>
    check(): Promise<void>
    download(): Promise<void>
    /** Quits, installs the downloaded update and starts the new version. */
    install(): void
    /** Published releases, newest first. */
    releases(): Promise<ReleaseNote[]>
    onChanged(callback: (state: UpdateState) => void): () => void
    /** The update notification of the system was clicked. */
    onShow(callback: () => void): () => void
  }
  windowState: {
    /** The window was minimized (true) or restored (false). */
    onMinimizedChange(callback: (minimized: boolean) => void): () => void
  }
}

import type { CameraDrawApi } from '../shared/api'

declare global {
  interface Window {
    api: CameraDrawApi
  }
}

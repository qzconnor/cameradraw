<script setup lang="ts">
import { computed, type Component } from 'vue'
import { CameraOffIcon, LockIcon, UnplugIcon, VideoOffIcon } from '@lucide/vue'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { useCameraStore } from '@/stores/camera'
import CameraSelect from './CameraSelect.vue'

const camera = useCameraStore()

interface OverlayContent {
  icon: Component | null
  title: string
  description: string
  /** Show a "waiting…" spinner line. */
  waiting?: boolean
  /** Show the camera picker (incl. "reload camera list"). */
  picker?: boolean
}

const content = computed<OverlayContent | null>(() => {
  const name = camera.selectedLabel ? `„${camera.selectedLabel}“` : 'Die Kamera'
  switch (camera.status) {
    case 'idle':
    case 'starting':
      return { icon: null, title: 'Kamera wird gestartet …', description: '' }
    case 'waiting':
      return {
        icon: UnplugIcon,
        title: 'Kamera getrennt',
        description: `${name} ist nicht verbunden. CameraDraw wartet, bis sie wieder angeschlossen ist, und wechselt nicht von selbst zu einer anderen Kamera.`,
        waiting: true,
        picker: true
      }
    case 'busy':
      return {
        icon: VideoOffIcon,
        title: 'Kamera belegt',
        description: `${name} kann gerade nicht geöffnet werden – vermutlich wird sie von einer anderen Anwendung verwendet.`,
        waiting: true,
        picker: true
      }
    case 'no-camera':
      return {
        icon: CameraOffIcon,
        title: 'Keine Kamera gefunden',
        description:
          'Schließe eine Kamera an – sie wird automatisch erkannt. Falls nicht, lade die Kameraliste neu.',
        waiting: true,
        picker: true
      }
    case 'denied':
      return {
        icon: LockIcon,
        title: 'Kein Kamerazugriff',
        description:
          'Der Zugriff auf die Kamera wurde verweigert. Erlaube den Kamera-Zugriff für Desktop-Apps in den Datenschutzeinstellungen deines Systems und lade die Kameraliste danach neu.',
        picker: true
      }
    default:
      return null
  }
})
</script>

<template>
  <div
    v-if="content"
    class="absolute inset-0 grid place-items-center bg-stage p-6 text-stage-foreground"
  >
    <Empty class="max-w-md">
      <EmptyHeader>
        <EmptyMedia v-if="content.icon" variant="icon">
          <component :is="content.icon" />
        </EmptyMedia>
        <Spinner v-else class="mb-2 size-6" />
        <EmptyTitle>{{ content.title }}</EmptyTitle>
        <EmptyDescription v-if="content.description">{{ content.description }}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent v-if="content.waiting || content.picker">
        <p v-if="content.waiting" class="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          Warte auf Verbindung …
        </p>
        <CameraSelect v-if="content.picker" class="w-72 max-w-full" />
      </EmptyContent>
    </Empty>
  </div>
</template>

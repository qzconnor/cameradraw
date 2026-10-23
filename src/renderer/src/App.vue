<script setup lang="ts">
import { onMounted, ref } from 'vue'
import CameraView from '@/components/camera/CameraView.vue'
import CaptureFlash from '@/components/camera/CaptureFlash.vue'
import DiscardChangesDialog from '@/components/editor/DiscardChangesDialog.vue'
import ImageEditor from '@/components/editor/ImageEditor.vue'
import GallerySheet from '@/components/gallery/GallerySheet.vue'
import TitleBar from '@/components/layout/TitleBar.vue'
import McpActivityGlow from '@/components/mcp/McpActivityGlow.vue'
import McpPointer from '@/components/mcp/McpPointer.vue'
import ModulesSheet from '@/components/modules/ModulesSheet.vue'
import SettingsSheet from '@/components/settings/SettingsSheet.vue'
import SetupDialog from '@/components/settings/SetupDialog.vue'
import UpdatesSheet from '@/components/updates/UpdatesSheet.vue'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useCameraStore } from '@/stores/camera'
import { useEditorStore } from '@/stores/editor'
import { useGalleryStore } from '@/stores/gallery'
import { useHardwareStore } from '@/stores/hardware'
import { useMcpStore } from '@/stores/mcp'
import { useSettingsStore } from '@/stores/settings'
import { useUpdatesStore } from '@/stores/updates'

const settings = useSettingsStore()
const camera = useCameraStore()
const gallery = useGalleryStore()
const hardware = useHardwareStore()
const editor = useEditorStore()
const updates = useUpdatesStore()
const mcp = useMcpStore()

const flash = ref<InstanceType<typeof CaptureFlash> | null>(null)

onMounted(async () => {
  await settings.load()
  void updates.init()
  gallery.init()
  hardware.init()
  void mcp.init()
  await camera.init()
})
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <div class="flex h-full flex-col">
      <TitleBar />

      <!-- The camera / editor fills everything below the title bar; the gallery is an overlay. -->
      <main class="relative min-h-0 flex-1 bg-stage text-stage-foreground">
        <!-- The camera stays mounted while editing so the stream can keep running (unless the
             "switch the camera off when it is not shown" setting is on). -->
        <CameraView v-show="!editor.isOpen" :active="!editor.isOpen" @captured="flash?.trigger()" />
        <ImageEditor
          v-if="editor.session"
          :key="editor.session.baseUrl"
          :session="editor.session"
        />

        <div
          v-if="editor.loading"
          class="absolute inset-0 z-10 grid place-items-center bg-stage/60"
        >
          <Spinner class="size-6" />
        </div>
        <CaptureFlash ref="flash" />
      </main>
    </div>

    <GallerySheet />
    <SettingsSheet />
    <ModulesSheet />
    <UpdatesSheet />
    <SetupDialog />
    <DiscardChangesDialog />
    <!-- Above the controls at the bottom (mirror, zoom, scale), so a toast never covers them. -->
    <Toaster theme="dark" position="bottom-right" :offset="{ right: 16, bottom: 96 }" />
    <!-- An AI assistant at work (MCP): over everything, but never in the way. -->
    <McpActivityGlow />
    <McpPointer />
  </TooltipProvider>
</template>

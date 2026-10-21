<script setup lang="ts">
import { ApertureIcon } from '@lucide/vue'
import CameraSelect from '@/components/camera/CameraSelect.vue'
import GalleryButton from '@/components/gallery/GalleryButton.vue'
import ModulesButton from '@/components/modules/ModulesButton.vue'
import SettingsButton from '@/components/settings/SettingsButton.vue'
import UpdatesButton from '@/components/updates/UpdatesButton.vue'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

const isMac = window.api.platform === 'darwin'
</script>

<template>
  <!-- Window drag area. The right padding keeps clear of the native window controls overlay. -->
  <header
    :class="
      cn(
        'drag-region flex h-11 shrink-0 items-center gap-3 border-b bg-sidebar text-sidebar-foreground',
        isMac ? 'pl-20' : 'pl-3'
      )
    "
    style="padding-right: calc(100vw - env(titlebar-area-width, 100vw) + 0.5rem)"
  >
    <div class="flex items-center gap-2">
      <div class="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
        <ApertureIcon class="size-3.5" />
      </div>
      <span class="text-sm font-semibold tracking-tight">CameraDraw</span>
    </div>

    <!-- my-auto (not self-center): the Separator itself sets self-stretch for vertical lines. -->
    <Separator orientation="vertical" class="my-auto h-5" />

    <CameraSelect size="sm" class="no-drag max-w-72" />

    <div class="no-drag ml-auto flex items-center gap-1">
      <UpdatesButton />
      <GalleryButton />
      <SettingsButton />
      <ModulesButton />
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CameraIcon, FolderIcon, ImageIcon, ImagesIcon } from '@lucide/vue'
import { splitExtension, splitItemPath } from '@shared/names'
import HintTooltip from '@/components/common/HintTooltip.vue'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb'
import { cn } from '@/lib/utils'
import { useGalleryStore } from '@/stores/gallery'
import { usePanelsStore } from '@/stores/panels'

/** Where the edited image lies: Galerie › Projekt › Datei. The first two open the gallery there. */
const props = defineProps<{
  /** Path of the image, null for a new capture. */
  path: string | null
  /** The image layer edited on its own, if one is. */
  layer?: string | null
}>()

const gallery = useGalleryStore()
const panels = usePanelsStore()

const parts = computed(() => (props.path ? splitItemPath(props.path) : null))

/**
 * The file name is shortened in the middle, so its end – usually the time of the capture – and
 * the extension stay readable: `CameraDraw_20…22-19-00.png`.
 */
const fileName = computed(() => {
  const { stem, ext } = splitExtension(parts.value?.name ?? '')
  const cut = Math.max(0, stem.length - 8)
  return { head: stem.slice(0, cut), tail: stem.slice(cut) + ext }
})

function showInGallery(project: string | null): void {
  gallery.browse(project)
  panels.setOpen('gallery', true)
}

/** Hides the "Galerie" crumb and its separator while the space is narrow. */
const narrowHidden = 'hidden @min-[18rem]:flex'

const linkClass =
  'flex min-w-0 items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
</script>

<template>
  <!-- @container: in a narrow window "Galerie" is left out, so the project and file names keep
       the space. The project keeps its full name (up to half the width), the file name gives way. -->
  <div class="@container min-w-0 flex-1">
    <Breadcrumb class="glass-panel flex h-11 w-fit max-w-full items-center px-3.5">
      <BreadcrumbList class="min-w-0 flex-nowrap">
        <template v-if="parts">
          <BreadcrumbItem :class="cn('shrink-0', narrowHidden)">
            <BreadcrumbLink
              as="button"
              type="button"
              :class="linkClass"
              @click="showInGallery(null)"
            >
              <ImagesIcon class="size-3.5 shrink-0" />
              Galerie
            </BreadcrumbLink>
          </BreadcrumbItem>
          <template v-if="parts.project">
            <BreadcrumbSeparator :class="narrowHidden" />
            <BreadcrumbItem class="max-w-1/2 min-w-0 shrink-0">
              <BreadcrumbLink
                as="button"
                type="button"
                :class="linkClass"
                @click="showInGallery(parts.project)"
              >
                <FolderIcon class="size-3.5 shrink-0" />
                <span class="truncate">{{ parts.project }}</span>
              </BreadcrumbLink>
            </BreadcrumbItem>
          </template>
          <BreadcrumbSeparator :class="!parts.project && narrowHidden" />
          <BreadcrumbItem class="min-w-0">
            <HintTooltip :label="parts.name">
              <BreadcrumbPage class="flex min-w-0">
                <span class="truncate">{{ fileName.head }}</span>
                <span class="shrink-0">{{ fileName.tail }}</span>
              </BreadcrumbPage>
            </HintTooltip>
          </BreadcrumbItem>
        </template>
        <BreadcrumbItem v-else class="min-w-0">
          <BreadcrumbPage class="flex min-w-0 items-center gap-1.5">
            <CameraIcon class="size-3.5 shrink-0" />
            <span class="truncate">Neue Aufnahme</span>
          </BreadcrumbPage>
        </BreadcrumbItem>
        <template v-if="layer">
          <BreadcrumbSeparator />
          <BreadcrumbItem class="max-w-1/2 min-w-0 shrink-0">
            <BreadcrumbPage class="flex min-w-0 items-center gap-1.5">
              <ImageIcon class="size-3.5 shrink-0" />
              <span class="truncate">{{ layer }}</span>
            </BreadcrumbPage>
          </BreadcrumbItem>
        </template>
      </BreadcrumbList>
    </Breadcrumb>
  </div>
</template>

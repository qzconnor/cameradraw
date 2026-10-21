<script setup lang="ts">
import { computed } from 'vue'
import {
  ChevronLeftIcon,
  EllipsisIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPenIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  ImagesIcon,
  Trash2Icon
} from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useGalleryDrag } from '@/composables/useGalleryDrag'
import { cn } from '@/lib/utils'
import { useGalleryStore } from '@/stores/gallery'
import { useSettingsStore } from '@/stores/settings'

/** Title bar of the gallery – inside a project with a way back and the project's actions. */
const emit = defineEmits<{
  createProject: []
  renameProject: [name: string]
  revealProject: [name: string]
  deleteProject: [name: string]
  openFolder: []
}>()

const gallery = useGalleryStore()
const settings = useSettingsStore()
const drag = useGalleryDrag()

const count = computed(() =>
  gallery.currentProject === null
    ? gallery.items.length
    : gallery.items.filter((i) => i.project === gallery.currentProject).length
)
</script>

<template>
  <SheetHeader
    :class="
      cn(
        'h-13 flex-row items-center gap-2 border-b py-0 pr-12',
        gallery.currentProject ? 'pl-2' : 'pl-4'
      )
    "
  >
    <template v-if="gallery.currentProject">
      <!-- Also a drop target: dropping an image here takes it out of the project. -->
      <Button
        :variant="drag.isOver(null) ? 'default' : 'ghost'"
        size="sm"
        data-drop-project=""
        :class="
          cn(
            'shrink-0 transition-transform',
            drag.canDrop(null) && 'ring-1 ring-primary/40',
            drag.isOver(null) && 'scale-105'
          )
        "
        @click="gallery.browse(null)"
      >
        <ChevronLeftIcon data-icon="inline-start" />
        Galerie
      </Button>
      <FolderIcon class="size-4 shrink-0 text-muted-foreground" />
      <SheetTitle class="truncate">{{ gallery.currentProject }}</SheetTitle>
    </template>
    <template v-else>
      <ImagesIcon class="size-4 text-muted-foreground" />
      <SheetTitle>Galerie</SheetTitle>
    </template>
    <Badge variant="secondary" class="tabular-nums">{{ count }}</Badge>
    <SheetDescription class="sr-only">
      Gespeicherte Bilder und Projekte – zum Weiterbearbeiten anklicken, zum Verschieben auf ein
      Projekt ziehen.
    </SheetDescription>

    <div class="ml-auto flex shrink-0 items-center gap-0.5">
      <DropdownMenu v-if="gallery.currentProject">
        <!-- No HintTooltip: nested in one, the menu loses its anchor (see GalleryViewMenu). -->
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon-sm" aria-label="Projekt-Aktionen">
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem @select="emit('renameProject', gallery.currentProject)">
              <FolderPenIcon />
              Umbenennen
            </DropdownMenuItem>
            <DropdownMenuItem @select="emit('revealProject', gallery.currentProject)">
              <FolderSearchIcon />
              Im Ordner zeigen
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              @select="emit('deleteProject', gallery.currentProject)"
            >
              <Trash2Icon />
              Projekt löschen
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <HintTooltip v-else label="Neues Projekt">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Neues Projekt"
          :disabled="!settings.saveDirAvailable"
          @click="emit('createProject')"
        >
          <FolderPlusIcon />
        </Button>
      </HintTooltip>

      <HintTooltip label="Speicherordner öffnen">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Speicherordner öffnen"
          :disabled="!settings.saveDirAvailable"
          @click="emit('openFolder')"
        >
          <FolderOpenIcon />
        </Button>
      </HintTooltip>
    </div>
  </SheetHeader>
</template>

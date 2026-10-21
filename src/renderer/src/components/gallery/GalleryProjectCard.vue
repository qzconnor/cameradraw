<script setup lang="ts">
import { computed, ref, useTemplateRef, watch, type Component } from 'vue'
import {
  EllipsisIcon,
  FolderIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderPenIcon,
  FolderSearchIcon,
  Trash2Icon
} from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useGalleryDrag } from '@/composables/useGalleryDrag'
import type { ProjectSummary } from '@/lib/gallery'
import { cn } from '@/lib/utils'

/** A project in the gallery – also a drop target for dragged images. */
const props = defineProps<{ project: ProjectSummary }>()

const emit = defineEmits<{ open: []; rename: []; reveal: []; delete: [] }>()

const drag = useGalleryDrag()
const hovered = ref(false)
/**
 * Thumbnails that failed to load: right after a drop the moved image still has its old URL until
 * the gallery refreshes – hide it instead of showing a broken image.
 */
const broken = ref<string[]>([])
const covers = computed(() => props.project.covers.filter((url) => !broken.value.includes(url)))
const button = useTemplateRef<HTMLButtonElement>('button')

/** An image is being dragged that could go into this project. */
const available = computed(() => drag.canDrop(props.project.name))
const over = computed(() => drag.isOver(props.project.name))

// Offsets of the stacked thumbnails from the centre – the newest lies in front, in the middle.
const FAN: Record<number, number[]> = { 1: [0], 2: [0.5, -0.5], 3: [0, -1, 1] }
// The stack fans out on hover, a bit while an image is dragged, and wide open below it.
const spread = computed(() => (over.value ? 2.3 : hovered.value || available.value ? 1.5 : 1))

function coverStyle(index: number): Record<string, string | number> {
  const count = covers.value.length
  const offset = (FAN[count]?.[index] ?? 0) * spread.value
  return {
    zIndex: count - index,
    transform: `translate(${offset * 18}%, ${Math.abs(offset) * 6}%) rotate(${offset * 6}deg)`
  }
}

// A short bounce when an image has landed here.
watch(drag.landing, (landing) => {
  if (landing?.project !== props.project.name) return
  button.value?.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1)' }],
    { duration: 480, easing: 'cubic-bezier(0.3, 1.6, 0.5, 1)' }
  )
})

const countLabel = computed(() => {
  const n = props.project.count
  return n === 0 ? 'Leer' : n === 1 ? '1 Bild' : `${n} Bilder`
})

interface MenuAction {
  label: string
  icon: Component
  run: () => void
  /** Key shown next to the entry – it works while the card has focus. */
  shortcut?: string
}

const mainActions: MenuAction[] = [
  { label: 'Öffnen', icon: FolderOpenIcon, run: () => emit('open') },
  { label: 'Umbenennen', icon: FolderPenIcon, run: () => emit('rename'), shortcut: 'F2' },
  { label: 'Im Ordner zeigen', icon: FolderSearchIcon, run: () => emit('reveal') }
]
const deleteAction: MenuAction = { label: 'Löschen', icon: Trash2Icon, run: () => emit('delete') }
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div
        class="group relative"
        :data-drop-project="project.name"
        @pointerenter="hovered = true"
        @pointerleave="hovered = false"
      >
        <button
          ref="button"
          type="button"
          :aria-label="`Projekt ${project.name} öffnen`"
          :class="
            cn(
              'relative block aspect-video w-full overflow-hidden rounded-lg bg-muted/60 ring-1 ring-foreground/10 transition duration-200 outline-none hover:ring-foreground/30 focus-visible:ring-2 focus-visible:ring-ring',
              available && 'ring-primary/40',
              over && 'scale-[1.04] shadow-xl ring-2 ring-primary hover:ring-primary'
            )
          "
          @click="emit('open')"
          @keydown.f2.prevent="emit('rename')"
        >
          <div class="absolute inset-0 grid place-items-center pb-8">
            <img
              v-for="(url, index) in covers"
              :key="url"
              :src="url"
              alt=""
              loading="lazy"
              decoding="async"
              draggable="false"
              class="col-start-1 row-start-1 aspect-video w-1/2 rounded-md object-cover shadow-lg ring-1 ring-foreground/15 transition-transform duration-300 ease-out"
              :style="coverStyle(index)"
              @error="broken.push(url)"
            />
            <FolderIcon
              v-if="!covers.length"
              :class="
                cn(
                  'size-10 text-muted-foreground transition-transform duration-300',
                  (hovered || available) && 'scale-110',
                  over && 'scale-125 text-foreground'
                )
              "
            />
          </div>

          <div
            class="absolute inset-x-0 bottom-0 bg-linear-to-t from-stage/90 to-transparent px-2.5 pt-6 pb-2 text-left"
          >
            <p class="flex items-center gap-1.5 text-xs font-medium text-stage-foreground">
              <FolderIcon class="size-3.5 shrink-0" />
              <span class="truncate">{{ project.name }}</span>
            </p>
            <p class="text-[11px] text-stage-foreground/70">{{ countLabel }}</p>
          </div>

          <div v-if="over" class="absolute inset-0 bg-primary/10 duration-150 animate-in fade-in">
            <Badge
              class="absolute top-2 left-1/2 -translate-x-1/2 shadow-lg duration-200 animate-in zoom-in-75"
            >
              <FolderInputIcon data-icon="inline-start" />
              Hierher verschieben
            </Badge>
          </div>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="secondary"
              size="icon-xs"
              aria-label="Weitere Aktionen"
              class="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
            <DropdownMenuGroup>
              <DropdownMenuItem
                v-for="action in mainActions"
                :key="action.label"
                @select="action.run"
              >
                <component :is="action.icon" />
                {{ action.label }}
                <DropdownMenuShortcut v-if="action.shortcut">{{
                  action.shortcut
                }}</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" @select="deleteAction.run">
                <component :is="deleteAction.icon" />
                {{ deleteAction.label }}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </ContextMenuTrigger>

    <ContextMenuContent class="w-48">
      <ContextMenuGroup>
        <ContextMenuItem v-for="action in mainActions" :key="action.label" @select="action.run">
          <component :is="action.icon" />
          {{ action.label }}
          <ContextMenuShortcut v-if="action.shortcut">{{ action.shortcut }}</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem variant="destructive" @select="deleteAction.run">
          <component :is="deleteAction.icon" />
          {{ deleteAction.label }}
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>

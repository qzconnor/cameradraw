<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import {
  BlendIcon,
  CopyIcon,
  EllipsisIcon,
  FolderIcon,
  FolderInputIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  ImagesIcon,
  LayersIcon,
  PencilIcon,
  TextCursorInputIcon,
  Trash2Icon
} from '@lucide/vue'
import type { GalleryItem } from '@shared/types'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useGalleryDrag } from '@/composables/useGalleryDrag'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const props = defineProps<{
  item: GalleryItem
  /** Currently open in the editor. */
  active: boolean
  /** Just saved. */
  isNew: boolean
  /** Show the project the image is in (search results across projects). */
  showProject: boolean
  /** All projects – offered under "Verschieben nach". */
  projects: string[]
}>()

const emit = defineEmits<{
  open: []
  copy: []
  rename: []
  reveal: []
  delete: []
  move: [project: string | null]
  moveToNew: []
  reference: []
}>()

const drag = useGalleryDrag()
const loaded = ref(false)
const dragged = computed(() => drag.isDragged(props.item.path))

/** The name is cut off – then its tooltip shows it in full. */
const nameTruncated = ref(false)
function measureName(event: PointerEvent): void {
  const el = event.currentTarget as HTMLElement
  nameTruncated.value = el.scrollWidth > el.clientWidth
}

/** Where the image can go: out of its project ("Kein Projekt", null) or into another one. */
const moveTargets = computed(() => [
  ...(props.item.project !== null ? [null] : []),
  ...props.projects.filter((p) => p !== props.item.project)
])

interface MenuAction {
  label: string
  icon: Component
  run: () => void
  /** Key shown next to the entry – it works while the card has focus. */
  shortcut?: string
  destructive?: boolean
}

const mainActions: MenuAction[] = [
  { label: 'Bearbeiten', icon: PencilIcon, run: () => emit('open') },
  { label: 'Bild kopieren', icon: CopyIcon, run: () => emit('copy') },
  { label: 'Umbenennen', icon: TextCursorInputIcon, run: () => emit('rename'), shortcut: 'F2' },
  { label: 'Im Ordner zeigen', icon: FolderSearchIcon, run: () => emit('reveal') },
  { label: 'Als Referenz einblenden', icon: BlendIcon, run: () => emit('reference') }
]
const deleteAction: MenuAction = {
  label: 'Löschen',
  icon: Trash2Icon,
  run: () => emit('delete'),
  destructive: true
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <!-- While dragged, the card stays behind as a faded placeholder. -->
      <div :class="cn('group relative transition duration-200', dragged && 'scale-95 opacity-30')">
        <button
          type="button"
          :aria-label="`${item.name} bearbeiten`"
          :aria-current="active || undefined"
          :class="
            cn(
              'relative block aspect-video w-full overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 transition outline-none hover:ring-foreground/30 focus-visible:ring-2 focus-visible:ring-ring',
              (active || isNew) && 'ring-2 ring-primary hover:ring-primary'
            )
          "
          @pointerdown="drag.press($event, item)"
          @click="emit('open')"
          @keydown.f2.prevent="emit('rename')"
        >
          <Skeleton v-if="!loaded" class="absolute inset-0 rounded-none" />
          <img
            :src="item.thumbUrl"
            alt=""
            loading="lazy"
            decoding="async"
            draggable="false"
            class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
            @load="loaded = true"
          />
          <div
            class="absolute inset-x-0 bottom-0 bg-linear-to-t from-stage/90 to-transparent px-2.5 pt-6 pb-2 text-left"
          >
            <HintTooltip :label="item.name" :disabled="!nameTruncated">
              <p
                class="truncate text-xs font-medium text-stage-foreground"
                @pointerenter="measureName"
              >
                {{ item.name }}
              </p>
            </HintTooltip>
            <p
              class="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-stage-foreground/70"
            >
              {{ formatDateTime(item.capturedAt) }}
              <LayersIcon v-if="item.editable" class="size-3" aria-label="Ebenen bearbeitbar" />
              <span
                v-if="showProject && item.project"
                class="ml-auto flex min-w-0 items-center gap-1"
              >
                <FolderIcon class="size-3 shrink-0" />
                <span class="truncate">{{ item.project }}</span>
              </span>
            </p>
          </div>
          <Badge v-if="active" class="absolute top-2 left-2">In Bearbeitung</Badge>
          <Badge v-else-if="isNew" class="absolute top-2 left-2">Neu</Badge>
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
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInputIcon />
                  Verschieben nach
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent class="max-h-72 w-52 overflow-y-auto">
                  <DropdownMenuGroup v-if="moveTargets.length">
                    <DropdownMenuItem
                      v-for="target in moveTargets"
                      :key="target ?? ''"
                      @select="emit('move', target)"
                    >
                      <ImagesIcon v-if="target === null" />
                      <FolderIcon v-else />
                      <span class="truncate">{{ target ?? 'Kein Projekt' }}</span>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator v-if="moveTargets.length" />
                  <DropdownMenuGroup>
                    <DropdownMenuItem @select="emit('moveToNew')">
                      <FolderPlusIcon />
                      Neues Projekt …
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
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
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInputIcon />
            Verschieben nach
          </ContextMenuSubTrigger>
          <ContextMenuSubContent class="max-h-72 w-52 overflow-y-auto">
            <ContextMenuGroup v-if="moveTargets.length">
              <ContextMenuItem
                v-for="target in moveTargets"
                :key="target ?? ''"
                @select="emit('move', target)"
              >
                <ImagesIcon v-if="target === null" />
                <FolderIcon v-else />
                <span class="truncate">{{ target ?? 'Kein Projekt' }}</span>
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator v-if="moveTargets.length" />
            <ContextMenuGroup>
              <ContextMenuItem @select="emit('moveToNew')">
                <FolderPlusIcon />
                Neues Projekt …
              </ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
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

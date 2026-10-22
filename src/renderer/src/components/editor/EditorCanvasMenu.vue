<script setup lang="ts">
import { computed } from 'vue'
import { BoxSelectIcon, PaintBucketIcon, RulerIcon, Trash2Icon, TypeIcon } from '@lucide/vue'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import type { CanvasSpot } from '@/composables/useDrawingCanvas'

/**
 * Right-click menu of the drawing area. The slot is the trigger (the canvas host); `spot`
 * describes what was under the pointer when the menu opened.
 */
const props = defineProps<{
  spot: CanvasSpot | null
  /** There are objects to select. */
  canSelectAll: boolean
}>()

const emit = defineEmits<{
  addText: []
  toggleFill: []
  /** Use the measuring line under the pointer to set the scale. */
  calibrate: []
  delete: []
  selectAll: []
}>()

const hasObjects = computed(() => !!props.spot?.objects.length)
const several = computed(() => (props.spot?.objects.length ?? 0) > 1)
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>

    <!-- No focus return on close: a text added from the menu keeps the keyboard focus. -->
    <ContextMenuContent class="w-56" @close-auto-focus.prevent>
      <ContextMenuGroup>
        <ContextMenuItem :disabled="!spot?.onImage" @select="emit('addText')">
          <TypeIcon />
          Text hier einfügen
        </ContextMenuItem>
      </ContextMenuGroup>

      <template v-if="hasObjects">
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem v-if="spot?.fillable" @select="emit('toggleFill')">
            <PaintBucketIcon />
            {{ spot.filled ? 'Füllung entfernen' : several ? 'Formen füllen' : 'Form füllen' }}
          </ContextMenuItem>
          <ContextMenuItem v-if="spot?.measurement" @select="emit('calibrate')">
            <RulerIcon />
            Als Maßstab verwenden …
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" @select="emit('delete')">
            <Trash2Icon />
            {{ several ? `${spot?.objects.length} Objekte löschen` : 'Löschen' }}
            <ContextMenuShortcut>Entf</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
      </template>

      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem :disabled="!canSelectAll" @select="emit('selectAll')">
          <BoxSelectIcon />
          Alles auswählen
          <ContextMenuShortcut>Strg A</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  BoxSelectIcon,
  BringToFrontIcon,
  ClipboardPasteIcon,
  CopyIcon,
  CopyPlusIcon,
  CropIcon,
  PaintBucketIcon,
  RulerIcon,
  SendToBackIcon,
  Trash2Icon,
  TypeIcon
} from '@lucide/vue'
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
  /** What was copied and can be pasted: objects (at the clicked point) or layers. */
  pasteKind: 'objects' | 'layers' | null
}>()

const emit = defineEmits<{
  addText: []
  toggleFill: []
  /** Use the measuring line under the pointer to set the scale. */
  calibrate: []
  delete: []
  selectAll: []
  copy: []
  duplicate: []
  /** Paste the copied objects at the clicked point. */
  paste: []
  arrange: [where: 'front' | 'back']
  /** Edit the image under the pointer on its own. */
  editImage: []
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
        <ContextMenuItem
          v-if="pasteKind"
          :disabled="pasteKind === 'objects' && !spot?.onImage"
          @select="emit('paste')"
        >
          <ClipboardPasteIcon />
          {{ pasteKind === 'layers' ? 'Ebene einfügen' : 'Hier einfügen' }}
          <ContextMenuShortcut>Strg V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem v-if="spot?.image" @select="emit('editImage')">
          <CropIcon />
          Bild bearbeiten …
        </ContextMenuItem>
      </ContextMenuGroup>

      <template v-if="hasObjects">
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem @select="emit('copy')">
            <CopyIcon />
            Kopieren
            <ContextMenuShortcut>Strg C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem @select="emit('duplicate')">
            <CopyPlusIcon />
            Duplizieren
            <ContextMenuShortcut>Strg D</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
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
          <ContextMenuItem @select="emit('arrange', 'front')">
            <BringToFrontIcon />
            In den Vordergrund
            <ContextMenuShortcut>Pos1</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem @select="emit('arrange', 'back')">
            <SendToBackIcon />
            In den Hintergrund
            <ContextMenuShortcut>Ende</ContextMenuShortcut>
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

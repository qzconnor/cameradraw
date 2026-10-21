<script setup lang="ts">
import { onMounted, ref, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useEventListener } from '@vueuse/core'
import { toast } from 'vue-sonner'
import AmbientLight from '@/components/common/AmbientLight.vue'
import { Spinner } from '@/components/ui/spinner'
import { useDrawingCanvas, type CanvasSpot } from '@/composables/useDrawingCanvas'
import { TOOLS } from '@/editor/tools'
import { errorMessage } from '@/lib/format'
import { encodingFor } from '@/lib/image'
import { isOverlayOpen, isTypingTarget } from '@/lib/keyboard'
import { useEditorStore, type EditorSession } from '@/stores/editor'
import { useGalleryStore } from '@/stores/gallery'
import { usePanelsStore } from '@/stores/panels'
import { useSettingsStore } from '@/stores/settings'
import EditorActionBar from './EditorActionBar.vue'
import EditorBreadcrumb from './EditorBreadcrumb.vue'
import EditorCanvasMenu from './EditorCanvasMenu.vue'
import EditorToolbar from './EditorToolbar.vue'
import SaveImageDialog from './SaveImageDialog.vue'

const props = defineProps<{ session: EditorSession }>()

const editor = useEditorStore()
const gallery = useGalleryStore()
const settings = useSettingsStore()
const panels = usePanelsStore()
const { tool, style } = storeToRefs(editor)

const host = ref<HTMLElement | null>(null)
const saving = ref(false)
/** The save dialog asks for the file name and the project first. */
const saveOpen = ref(false)

const {
  ready,
  canUndo,
  canRedo,
  hasSelection,
  isEmpty,
  dirty,
  load,
  undo,
  redo,
  deleteSelection,
  clearAll,
  applyStyleToSelection,
  inspectAt,
  addTextAt,
  setFilled,
  removeObjects,
  selectAll,
  isEditingText,
  finishInteraction,
  exportImage,
  exportDocument,
  markSaved
} = useDrawingCanvas({ host, tool, style })

onMounted(async () => {
  try {
    await load({
      url: props.session.baseUrl,
      width: props.session.width,
      height: props.session.height,
      document: props.session.document
    })
  } catch (err) {
    toast.error('Bild konnte nicht geöffnet werden', { description: errorMessage(err) })
    editor.close()
  }
})

watch(dirty, (value) => (editor.dirty = value), { immediate: true })

// Changing a style setting also restyles the selected objects. (The fill setting is only for new
// shapes – existing ones are filled via the context menu.)
watch(
  () => editor.color,
  () => applyStyleToSelection('color')
)
watch(
  () => editor.strokeWidth,
  () => applyStyleToSelection('strokeWidth')
)
watch(
  () => editor.fontSize,
  () => applyStyleToSelection('fontSize')
)

// ── Context menu ──────────────────────────────────────────────────────────────

/** What was under the pointer when the context menu opened. */
const spot = shallowRef<CanvasSpot | null>(null)

function onContextMenu(e: MouseEvent): void {
  spot.value = ready.value ? inspectAt(e) : null
}

function addTextHere(): void {
  const point = spot.value?.point
  // After the menu has closed, so the new text keeps the keyboard focus.
  if (point) setTimeout(() => addTextAt(point))
}

function toggleFill(): void {
  if (spot.value) setFilled(spot.value.objects, !spot.value.filled)
}

function deleteSpot(): void {
  if (spot.value) removeObjects(spot.value.objects)
}

function requestSave(): void {
  if (saving.value || !ready.value) return
  // Ends text editing, so the text being typed is part of the saved image.
  finishInteraction()
  saveOpen.value = true
}

async function save(target: string): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    const { mime, quality } = encodingFor(target)
    const image = await exportImage(mime, quality)
    const item = await gallery.save({
      source: props.session.path,
      target,
      image,
      base: props.session.baseBytes,
      document: exportDocument()
    })
    markSaved()
    saveOpen.value = false
    toast.success('Bild gespeichert', {
      description: item.project ? `${item.project} / ${item.name}` : item.name,
      // The gallery is hidden behind a button – offer a shortcut to the saved image.
      action: {
        label: 'Galerie öffnen',
        onClick: () => {
          gallery.browse(item.project)
          panels.setOpen('gallery', true)
        }
      }
    })
    editor.close()
  } catch (err) {
    toast.error('Speichern fehlgeschlagen', { description: errorMessage(err) })
  } finally {
    saving.value = false
  }
}

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (isOverlayOpen()) return
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()

  // Saving also works while typing text.
  if (mod && key === 's') {
    e.preventDefault()
    requestSave()
    return
  }
  if (isTypingTarget(e.target) || isEditingText()) return

  if (mod && key === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  } else if (mod && key === 'y') {
    e.preventDefault()
    redo()
  } else if (mod && key === 'a') {
    e.preventDefault()
    selectAll()
  } else if (mod || e.altKey) {
    return
  } else if (key === 'delete' || key === 'backspace') {
    e.preventDefault()
    deleteSelection()
  } else if (key === 'escape') {
    e.preventDefault()
    if (hasSelection.value) finishInteraction()
    else editor.requestClose()
  } else {
    const match = TOOLS.find((t) => t.shortcut.toLowerCase() === key)
    if (match) editor.tool = match.id
  }
})
</script>

<template>
  <div class="absolute inset-0">
    <!-- Colours of the frozen image glow into the space around it, aligned with the canvas area. -->
    <AmbientLight v-if="settings.ambientLight" :image-url="session.baseUrl" :frame="host" />

    <div class="relative flex size-full flex-col">
      <!-- Breadcrumb on the left gets all the space the right-aligned toolbar leaves. -->
      <div class="flex shrink-0 items-center gap-3 px-4 pt-4 pb-3">
        <EditorBreadcrumb :path="session.path" />
        <EditorToolbar class="shrink-0" />
      </div>

      <div class="relative min-h-0 flex-1 px-4">
        <EditorCanvasMenu
          :spot="spot"
          :can-select-all="!isEmpty"
          @add-text="addTextHere"
          @toggle-fill="toggleFill"
          @delete="deleteSpot"
          @select-all="selectAll"
        >
          <!-- capture: runs before the menu opens, so it knows what was right-clicked. -->
          <div
            ref="host"
            class="flex size-full items-center justify-center [&_.canvas-container]:shadow-2xl [&_.canvas-container]:ring-1 [&_.canvas-container]:ring-foreground/10"
            @contextmenu.capture="onContextMenu"
          />
        </EditorCanvasMenu>
        <div v-if="!ready" class="absolute inset-0 grid place-items-center">
          <Spinner class="size-6" />
        </div>
      </div>

      <div class="flex shrink-0 justify-center px-4 pt-3 pb-4">
        <EditorActionBar
          :can-undo="canUndo"
          :can-redo="canRedo"
          :has-selection="hasSelection"
          :is-empty="isEmpty"
          :saving="saving"
          @cancel="editor.requestClose()"
          @undo="undo"
          @redo="redo"
          @delete="deleteSelection"
          @clear="clearAll"
          @save="requestSave"
        />
      </div>
    </div>

    <SaveImageDialog v-model:open="saveOpen" :source="session.path" :saving="saving" @save="save" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClipboardPasteIcon,
  CopyIcon,
  CopyPlusIcon,
  PlusIcon,
  Trash2Icon
} from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import type { LayerInfo } from '@/composables/useDrawingCanvas'
import { cn } from '@/lib/utils'
import LayerRow from './LayerRow.vue'

/**
 * The layers of the picture, the top one first: pick the one to work on, show or hide, lock,
 * rename, reorder (drag a row or Alt+↑/↓), copy, paste, duplicate and delete them.
 */
const props = defineProps<{
  /** Bottom first, as the canvas keeps them. */
  layers: LayerInfo[]
  active: string | null
  /** Something was copied (objects or layers) that can be pasted. */
  canPaste: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  update: [id: string, change: { name?: string; visible?: boolean; locked?: boolean }]
  /** To `index` (0 = bottom). */
  move: [id: string, index: number]
  add: []
  duplicate: [id: string]
  copy: [id: string]
  paste: []
  remove: [id: string]
  editImage: [id: string]
}>()

/** Top first, like in other editors. */
const rows = computed(() => [...props.layers].reverse())
const activeLayer = computed(() => props.layers.find((l) => l.id === props.active) ?? null)
const activeIndex = computed(() => props.layers.findIndex((l) => l.id === props.active))

function moveBy(id: string, where: 'up' | 'down' | 'top' | 'bottom'): void {
  const index = props.layers.findIndex((l) => l.id === id)
  if (index < 0) return
  const last = props.layers.length - 1
  const to = { up: index + 1, down: index - 1, top: last, bottom: 0 }[where]
  emit('move', id, Math.max(0, Math.min(last, to)))
}

// ── Reordering by dragging a row ──────────────────────────────────────────────

const DRAG_THRESHOLD = 5
const list = ref<HTMLElement | null>(null)
/** The row being dragged, and before which row (top first) it would land – rows.length: last. */
const dragging = ref<{ id: string; slot: number } | null>(null)

function slotAt(y: number): number {
  const elements = [...(list.value?.querySelectorAll<HTMLElement>('[data-layer]') ?? [])]
  return elements.filter((el) => {
    const r = el.getBoundingClientRect()
    return r.top + r.height / 2 < y
  }).length
}

function grab(id: string, e: PointerEvent): void {
  if (e.button !== 0) return
  const startY = e.clientY
  const onMove = (ev: PointerEvent): void => {
    if (!dragging.value && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return
    dragging.value = { id, slot: slotAt(ev.clientY) }
  }
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onUp, true)
    const drag = dragging.value
    dragging.value = null
    if (!drag) return
    // The click after the drag must not select the row.
    const swallow = (ev: MouseEvent): void => ev.stopPropagation()
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, true))
    const from = rows.value.findIndex((l) => l.id === drag.id)
    const slot = drag.slot > from ? drag.slot - 1 : drag.slot
    if (slot !== from) emit('move', drag.id, rows.value.length - 1 - slot)
  }
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onUp, true)
}

// ── Keys while the list has the focus ─────────────────────────────────────────

function onKeyDown(e: KeyboardEvent): void {
  const layer = activeLayer.value
  if (!layer || (e.target as HTMLElement).tagName === 'INPUT') return
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()
  let handled = true
  if (e.altKey && (key === 'arrowup' || key === 'arrowdown')) {
    moveBy(layer.id, key === 'arrowup' ? 'up' : 'down')
  } else if (!mod && (key === 'arrowup' || key === 'arrowdown')) {
    const next = props.layers[activeIndex.value + (key === 'arrowup' ? 1 : -1)]
    if (next) {
      emit('select', next.id)
      focusRow(next.id)
    }
  } else if (key === 'delete' || key === 'backspace') emit('remove', layer.id)
  else if (mod && key === 'c') emit('copy', layer.id)
  else if (mod && key === 'v') emit('paste')
  else if (mod && key === 'd') emit('duplicate', layer.id)
  else handled = false
  if (handled) {
    // Not on to the editor, which would act on the drawn objects.
    e.preventDefault()
    e.stopPropagation()
  }
}

function focusRow(id: string): void {
  requestAnimationFrame(() =>
    list.value?.querySelector<HTMLElement>(`[data-layer="${id}"] button[aria-current]`)?.focus()
  )
}
</script>

<template>
  <section
    class="glass-panel flex min-h-0 flex-col gap-1 p-1.5"
    aria-label="Ebenen"
    data-layers-panel
    @keydown="onKeyDown"
  >
    <header class="flex items-center gap-2 px-2 pt-1 pb-0.5">
      <h2 class="text-sm font-medium">Ebenen</h2>
      <span class="text-xs text-muted-foreground tabular-nums">{{ layers.length }}</span>
    </header>

    <div ref="list" class="-mx-0.5 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-0.5">
      <template v-for="(layer, i) in rows" :key="layer.id">
        <div v-if="dragging?.slot === i" class="mx-1 h-0.5 shrink-0 rounded-full bg-primary" />
        <LayerRow
          :layer="layer"
          :active="layer.id === active"
          :top="i === 0"
          :bottom="i === rows.length - 1"
          :can-paste="canPaste"
          :dragged="dragging?.id === layer.id"
          @select="emit('select', layer.id)"
          @toggle-visible="emit('update', layer.id, { visible: !layer.visible })"
          @toggle-locked="emit('update', layer.id, { locked: !layer.locked })"
          @rename="(name) => emit('update', layer.id, { name })"
          @edit-image="emit('editImage', layer.id)"
          @duplicate="emit('duplicate', layer.id)"
          @copy="emit('copy', layer.id)"
          @paste="emit('paste')"
          @remove="emit('remove', layer.id)"
          @move="(where) => moveBy(layer.id, where)"
          @grab="(e) => grab(layer.id, e)"
        />
      </template>
      <div
        v-if="dragging?.slot === rows.length"
        class="mx-1 h-0.5 shrink-0 rounded-full bg-primary"
      />
    </div>

    <div
      class="flex items-center gap-0.5 border-t border-foreground/10 px-0.5 pt-1.5"
      role="toolbar"
      aria-label="Ebene"
    >
      <HintTooltip label="Neue Ebene" side="top">
        <Button variant="ghost" size="icon-sm" aria-label="Neue Ebene" @click="emit('add')">
          <PlusIcon />
        </Button>
      </HintTooltip>
      <HintTooltip label="Ebene duplizieren" :shortcut="['Strg', 'D']" side="top">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Ebene duplizieren"
          :disabled="!activeLayer"
          @click="activeLayer && emit('duplicate', activeLayer.id)"
        >
          <CopyPlusIcon />
        </Button>
      </HintTooltip>
      <HintTooltip label="Ebene kopieren – auch für andere Bilder" side="top">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Ebene kopieren"
          :disabled="!activeLayer"
          @click="activeLayer && emit('copy', activeLayer.id)"
        >
          <CopyIcon />
        </Button>
      </HintTooltip>
      <HintTooltip label="Einfügen" side="top">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Ebene einfügen"
          :disabled="!canPaste"
          @click="emit('paste')"
        >
          <ClipboardPasteIcon />
        </Button>
      </HintTooltip>
      <span class="flex-1" />
      <HintTooltip label="Nach oben" :shortcut="['Alt', '↑']" side="top">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Ebene nach oben"
          :disabled="!activeLayer || activeIndex === layers.length - 1"
          @click="activeLayer && moveBy(activeLayer.id, 'up')"
        >
          <ArrowUpIcon />
        </Button>
      </HintTooltip>
      <HintTooltip label="Nach unten" :shortcut="['Alt', '↓']" side="top">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Ebene nach unten"
          :disabled="!activeLayer || activeIndex <= 0"
          @click="activeLayer && moveBy(activeLayer.id, 'down')"
        >
          <ArrowDownIcon />
        </Button>
      </HintTooltip>
      <HintTooltip label="Ebene löschen" :shortcut="['Entf']" side="top">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Ebene löschen"
          :class="cn('hover:text-destructive')"
          :disabled="!activeLayer"
          @click="activeLayer && emit('remove', activeLayer.id)"
        >
          <Trash2Icon />
        </Button>
      </HintTooltip>
    </div>
  </section>
</template>

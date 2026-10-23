<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  ArrowDownIcon,
  ArrowDownToLineIcon,
  ArrowUpIcon,
  ArrowUpToLineIcon,
  BotIcon,
  ClipboardPasteIcon,
  CopyIcon,
  CopyPlusIcon,
  CropIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  LockOpenIcon,
  PenLineIcon,
  TextCursorInputIcon,
  Trash2Icon
} from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
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
import type { LayerInfo } from '@/composables/useDrawingCanvas'
import { cn } from '@/lib/utils'

/** One layer in the layer list: shown or hidden, its picture or kind, its name and lock. */
const props = defineProps<{
  layer: LayerInfo
  active: boolean
  /** Top / bottom of the list – it cannot move further. */
  top: boolean
  bottom: boolean
  canPaste: boolean
  /** Being dragged to another place in the list. */
  dragged: boolean
}>()

const emit = defineEmits<{
  select: []
  toggleVisible: []
  toggleLocked: []
  rename: [name: string]
  editImage: []
  duplicate: []
  copy: []
  paste: []
  remove: []
  move: [where: 'up' | 'down' | 'top' | 'bottom']
  /** Pointer down on the row – the list turns it into a drag. */
  grab: [event: PointerEvent]
}>()

const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)

/** What the row says below the name. */
const detail = computed(() => {
  const { layer } = props
  if (layer.type === 'image') return layer.adjusted ? 'Bearbeitet' : 'Original'
  if (layer.type === 'fill') return 'Fläche'
  if (!layer.objects) return 'Leer'
  return layer.objects === 1 ? '1 Objekt' : `${layer.objects} Objekte`
})

async function startRename(): Promise<void> {
  draft.value = props.layer.name
  editing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

function finishRename(apply: boolean): void {
  if (!editing.value) return
  editing.value = false
  const name = draft.value.trim()
  if (apply && name && name !== props.layer.name) emit('rename', name)
}

defineExpose({ startRename })
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div
        :class="
          cn(
            'group/layer flex h-11 items-center gap-1 rounded-lg pr-1 pl-0.5 transition-colors',
            active ? 'bg-primary text-primary-foreground' : 'hover:bg-foreground/8',
            dragged && 'opacity-40'
          )
        "
        :data-layer="layer.id"
      >
        <HintTooltip :label="layer.visible ? 'Ausblenden' : 'Einblenden'" side="top">
          <Button
            variant="ghost"
            size="icon-xs"
            :aria-label="`${layer.name} ${layer.visible ? 'ausblenden' : 'einblenden'}`"
            :aria-pressed="!layer.visible"
            :class="
              cn(
                'shrink-0 text-inherit hover:text-inherit',
                active ? 'hover:bg-primary-foreground/15' : 'hover:bg-foreground/10',
                !layer.visible && 'opacity-60'
              )
            "
            @click="emit('toggleVisible')"
          >
            <EyeOffIcon v-if="!layer.visible" />
            <EyeIcon v-else />
          </Button>
        </HintTooltip>

        <input
          v-if="editing"
          ref="input"
          v-model="draft"
          aria-label="Name der Ebene"
          class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @keydown.enter.prevent="finishRename(true)"
          @keydown.escape.prevent.stop="finishRename(false)"
          @keydown.stop
          @blur="finishRename(true)"
        />
        <button
          v-else
          type="button"
          :aria-label="`Ebene ${layer.name}`"
          :aria-current="active || undefined"
          class="flex h-full min-w-0 flex-1 touch-none items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @pointerdown="emit('grab', $event)"
          @click="emit('select')"
          @dblclick="layer.type === 'image' ? emit('editImage') : startRename()"
          @keydown.f2.prevent="startRename"
        >
          <span
            :class="
              cn(
                'grid size-8 shrink-0 place-items-center overflow-hidden rounded-md ring-1 ring-foreground/15',
                !layer.visible && 'opacity-50',
                layer.type === 'drawing' &&
                  (active ? 'bg-primary-foreground/10' : 'bg-foreground/8')
              )
            "
            :style="layer.color ? { backgroundColor: layer.color } : undefined"
          >
            <img
              v-if="layer.thumbnail"
              :src="layer.thumbnail"
              alt=""
              draggable="false"
              class="size-full object-cover"
            />
            <template v-else-if="layer.type === 'drawing'">
              <BotIcon v-if="layer.owner === 'ai'" class="size-4" />
              <PenLineIcon v-else class="size-4" />
            </template>
          </span>
          <span class="flex min-w-0 flex-col leading-tight">
            <span class="truncate text-sm font-medium">{{ layer.name }}</span>
            <span
              :class="
                cn(
                  'truncate text-[11px]',
                  active ? 'text-primary-foreground/70' : 'text-muted-foreground'
                )
              "
            >
              {{ layer.owner === 'ai' ? `KI · ${detail}` : detail }}
            </span>
          </span>
        </button>

        <HintTooltip v-if="layer.type === 'image'" label="Bild bearbeiten – Doppelklick" side="top">
          <Button
            variant="ghost"
            size="icon-xs"
            :aria-label="`${layer.name} bearbeiten`"
            :class="
              cn(
                'shrink-0 text-inherit opacity-0 group-hover/layer:opacity-100 hover:text-inherit focus-visible:opacity-100',
                active ? 'opacity-100 hover:bg-primary-foreground/15' : 'hover:bg-foreground/10'
              )
            "
            @click="emit('editImage')"
          >
            <CropIcon />
          </Button>
        </HintTooltip>
        <HintTooltip
          v-if="layer.type !== 'fill'"
          :label="layer.locked ? 'Entsperren' : 'Sperren – im Bild nicht auswählbar'"
          side="top"
        >
          <Button
            variant="ghost"
            size="icon-xs"
            :aria-label="`${layer.name} ${layer.locked ? 'entsperren' : 'sperren'}`"
            :aria-pressed="layer.locked"
            :class="
              cn(
                'shrink-0 text-inherit hover:text-inherit focus-visible:opacity-100',
                active ? 'hover:bg-primary-foreground/15' : 'hover:bg-foreground/10',
                !layer.locked && 'opacity-0 group-hover/layer:opacity-100'
              )
            "
            @click="emit('toggleLocked')"
          >
            <LockIcon v-if="layer.locked" />
            <LockOpenIcon v-else />
          </Button>
        </HintTooltip>
      </div>
    </ContextMenuTrigger>

    <ContextMenuContent class="w-56">
      <ContextMenuGroup>
        <ContextMenuItem v-if="layer.type === 'image'" @select="emit('editImage')">
          <CropIcon />
          Bild bearbeiten …
        </ContextMenuItem>
        <ContextMenuItem @select="startRename">
          <TextCursorInputIcon />
          Umbenennen
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem @select="emit('toggleVisible')">
          <EyeIcon v-if="!layer.visible" />
          <EyeOffIcon v-else />
          {{ layer.visible ? 'Ausblenden' : 'Einblenden' }}
        </ContextMenuItem>
        <ContextMenuItem v-if="layer.type !== 'fill'" @select="emit('toggleLocked')">
          <LockOpenIcon v-if="layer.locked" />
          <LockIcon v-else />
          {{ layer.locked ? 'Entsperren' : 'Sperren' }}
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem @select="emit('copy')">
          <CopyIcon />
          Kopieren
          <ContextMenuShortcut>Strg C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem :disabled="!canPaste" @select="emit('paste')">
          <ClipboardPasteIcon />
          Einfügen
          <ContextMenuShortcut>Strg V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem @select="emit('duplicate')">
          <CopyPlusIcon />
          Duplizieren
          <ContextMenuShortcut>Strg D</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem :disabled="top" @select="emit('move', 'up')">
          <ArrowUpIcon />
          Nach oben
          <ContextMenuShortcut>Alt ↑</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem :disabled="bottom" @select="emit('move', 'down')">
          <ArrowDownIcon />
          Nach unten
          <ContextMenuShortcut>Alt ↓</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem :disabled="top" @select="emit('move', 'top')">
          <ArrowUpToLineIcon />
          Ganz nach oben
        </ContextMenuItem>
        <ContextMenuItem :disabled="bottom" @select="emit('move', 'bottom')">
          <ArrowDownToLineIcon />
          Ganz nach unten
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem variant="destructive" @select="emit('remove')">
          <Trash2Icon />
          Ebene löschen
          <ContextMenuShortcut>Entf</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>

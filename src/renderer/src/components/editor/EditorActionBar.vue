<script setup lang="ts">
import {
  BrushCleaningIcon,
  ChevronDownIcon,
  CopyIcon,
  Redo2Icon,
  SaveAllIcon,
  SaveIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon
} from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'

defineProps<{
  canUndo: boolean
  canRedo: boolean
  hasSelection: boolean
  isEmpty: boolean
  saving: boolean
  /** The image is saved already (from the gallery): "Speichern" saves it in place. */
  existing: boolean
}>()

defineEmits<{
  cancel: []
  undo: []
  redo: []
  delete: []
  clear: []
  copy: []
  save: []
  saveAs: []
}>()
</script>

<template>
  <div class="glass-panel flex items-center gap-1.5 p-1.5">
    <HintTooltip label="Zurück zur Kamera" :shortcut="['Esc']" side="top">
      <Button variant="ghost" @click="$emit('cancel')">
        <XIcon data-icon="inline-start" />
        Abbrechen
      </Button>
    </HintTooltip>

    <Separator orientation="vertical" class="mx-0.5 my-auto h-5" />

    <ButtonGroup>
      <HintTooltip label="Rückgängig" :shortcut="['Strg', 'Z']" side="top">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Rückgängig"
          :disabled="!canUndo"
          @click="$emit('undo')"
        >
          <Undo2Icon />
        </Button>
      </HintTooltip>
      <HintTooltip label="Wiederholen" :shortcut="['Strg', 'Y']" side="top">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Wiederholen"
          :disabled="!canRedo"
          @click="$emit('redo')"
        >
          <Redo2Icon />
        </Button>
      </HintTooltip>
    </ButtonGroup>

    <HintTooltip label="Auswahl löschen" :shortcut="['Entf']" side="top">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Auswahl löschen"
        :disabled="!hasSelection"
        @click="$emit('delete')"
      >
        <Trash2Icon />
      </Button>
    </HintTooltip>
    <HintTooltip label="Alle Zeichnungen entfernen" side="top">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Alle Zeichnungen entfernen"
        :disabled="isEmpty"
        @click="$emit('clear')"
      >
        <BrushCleaningIcon />
      </Button>
    </HintTooltip>

    <Separator orientation="vertical" class="mx-0.5 my-auto h-5" />

    <HintTooltip
      label="Bild in die Zwischenablage kopieren"
      :shortcut="['Strg', 'Shift', 'C']"
      side="top"
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label="Bild in die Zwischenablage kopieren"
        @click="$emit('copy')"
      >
        <CopyIcon />
      </Button>
    </HintTooltip>

    <ButtonGroup>
      <HintTooltip
        :label="existing ? 'Speichern' : 'Speichern – mit Namen und Projekt'"
        :shortcut="['Strg', 'S']"
        side="top"
      >
        <Button :disabled="saving" @click="$emit('save')">
          <Spinner v-if="saving" data-icon="inline-start" />
          <SaveIcon v-else data-icon="inline-start" />
          Speichern
        </Button>
      </HintTooltip>
      <ButtonGroupSeparator class="bg-primary-foreground/20" />
      <DropdownMenu>
        <!-- No HintTooltip around the trigger: nested in one, the menu loses its anchor and opens
             off-screen. -->
        <DropdownMenuTrigger as-child>
          <Button size="icon" aria-label="Weitere Speicheroptionen" :disabled="saving">
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" class="w-56">
          <DropdownMenuItem @select="$emit('saveAs')">
            <SaveAllIcon />
            Speichern unter …
            <DropdownMenuShortcut>Strg+Shift+S</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  </div>
</template>

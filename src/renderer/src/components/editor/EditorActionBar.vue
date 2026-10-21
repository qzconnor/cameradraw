<script setup lang="ts">
import { BrushCleaningIcon, Redo2Icon, SaveIcon, Trash2Icon, Undo2Icon, XIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'

defineProps<{
  canUndo: boolean
  canRedo: boolean
  hasSelection: boolean
  isEmpty: boolean
  saving: boolean
}>()

defineEmits<{
  cancel: []
  undo: []
  redo: []
  delete: []
  clear: []
  save: []
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

    <HintTooltip label="Speichern – mit Namen und Projekt" :shortcut="['Strg', 'S']" side="top">
      <Button :disabled="saving" @click="$emit('save')">
        <Spinner v-if="saving" data-icon="inline-start" />
        <SaveIcon v-else data-icon="inline-start" />
        Speichern
      </Button>
    </HintTooltip>
  </div>
</template>

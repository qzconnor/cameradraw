<script setup lang="ts">
import { CheckIcon, Undo2Icon, XIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

/** Replaces the action bar while one image is edited on its own. */
defineProps<{
  name: string
  canUndo: boolean
  /** It was turned or cropped since it was opened. */
  changed: boolean
}>()

defineEmits<{ cancel: []; undo: []; done: [] }>()
</script>

<template>
  <div class="glass-panel flex items-center gap-1.5 p-1.5">
    <HintTooltip label="Ohne Änderungen zurück" :shortcut="['Esc']" side="top">
      <Button variant="ghost" @click="$emit('cancel')">
        <XIcon data-icon="inline-start" />
        Abbrechen
      </Button>
    </HintTooltip>

    <Separator orientation="vertical" class="mx-0.5 my-auto h-5" />

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

    <p class="max-w-72 truncate px-2 text-sm text-muted-foreground">
      <span class="text-foreground">{{ name }}</span> drehen oder zuschneiden
    </p>

    <HintTooltip label="Zurück ins Bild – mit den Änderungen" :shortcut="['Enter']" side="top">
      <Button @click="$emit('done')">
        <CheckIcon data-icon="inline-start" />
        {{ changed ? 'Übernehmen' : 'Fertig' }}
      </Button>
    </HintTooltip>
  </div>
</template>

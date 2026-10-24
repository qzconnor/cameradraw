<script setup lang="ts">
import { computed } from 'vue'
import { ImagesIcon, Layers2Icon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'

const props = defineProps<{
  disabled?: boolean
  /** Burst capture: the picture is saved right away instead of opened in the editor. */
  burst?: boolean
  /** Focus stacking: the shutter starts a stack (`ready`) or finishes it (`recording`). */
  stack?: 'ready' | 'recording' | null
}>()
defineEmits<{ click: [event: MouseEvent] }>()

const label = computed(() => {
  if (props.stack === 'recording') return 'Fokus-Stapel fertig'
  if (props.stack === 'ready') return 'Fokus-Stapel starten'
  return props.burst ? 'Bild speichern' : 'Bild anhalten'
})
const hint = computed(() => {
  if (props.stack === 'recording') return 'Fokus-Stapel zusammensetzen'
  if (props.stack === 'ready') return 'Fokus-Stapel starten, dann am Fokus drehen'
  return props.burst ? 'Bild direkt speichern' : 'Bild anhalten & zeichnen'
})
</script>

<template>
  <HintTooltip :label="hint" :shortcut="['Leertaste']" side="top">
    <button
      type="button"
      :aria-label="label"
      :disabled="disabled"
      class="group grid size-18 place-items-center rounded-full border-4 border-stage-foreground/90 bg-stage/30 shadow-2xl backdrop-blur-sm transition outline-none hover:border-stage-foreground focus-visible:ring-4 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40"
      @click="$emit('click', $event)"
    >
      <span
        class="grid size-13 place-items-center rounded-full bg-stage-foreground text-stage transition-transform duration-150 group-hover:scale-95 group-active:scale-85"
      >
        <span v-if="stack === 'recording'" class="size-5 rounded-sm bg-red-500" />
        <Layers2Icon v-else-if="stack === 'ready'" class="size-6" />
        <ImagesIcon v-else-if="burst" class="size-6" />
      </span>
    </button>
  </HintTooltip>
</template>

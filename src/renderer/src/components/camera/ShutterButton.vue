<script setup lang="ts">
import { ImagesIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'

defineProps<{
  disabled?: boolean
  /** Burst capture: the picture is saved right away instead of opened in the editor. */
  burst?: boolean
}>()
defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <HintTooltip
    :label="burst ? 'Bild direkt speichern' : 'Bild anhalten & zeichnen'"
    :shortcut="['Leertaste']"
    side="top"
  >
    <button
      type="button"
      :aria-label="burst ? 'Bild speichern' : 'Bild anhalten'"
      :disabled="disabled"
      class="group grid size-18 place-items-center rounded-full border-4 border-stage-foreground/90 bg-stage/30 shadow-2xl backdrop-blur-sm transition outline-none hover:border-stage-foreground focus-visible:ring-4 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40"
      @click="$emit('click', $event)"
    >
      <span
        class="grid size-13 place-items-center rounded-full bg-stage-foreground text-stage transition-transform duration-150 group-hover:scale-95 group-active:scale-85"
      >
        <ImagesIcon v-if="burst" class="size-6" />
      </span>
    </button>
  </HintTooltip>
</template>

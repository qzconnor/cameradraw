<script setup lang="ts">
import HintTooltip from '@/components/common/HintTooltip.vue'

defineProps<{ disabled?: boolean }>()
defineEmits<{ click: [] }>()
</script>

<template>
  <HintTooltip label="Bild anhalten & zeichnen" :shortcut="['Leertaste']" side="top">
    <button
      type="button"
      aria-label="Bild anhalten"
      :disabled="disabled"
      class="group grid size-18 place-items-center rounded-full border-4 border-stage-foreground/90 bg-stage/30 shadow-2xl backdrop-blur-sm transition outline-none hover:border-stage-foreground focus-visible:ring-4 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40"
      @click="$emit('click')"
    >
      <span
        class="size-13 rounded-full bg-stage-foreground transition-transform duration-150 group-hover:scale-95 group-active:scale-85"
      />
    </button>
  </HintTooltip>
</template>

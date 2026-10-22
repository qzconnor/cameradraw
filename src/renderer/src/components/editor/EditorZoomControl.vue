<script setup lang="ts">
import { ZoomInIcon, ZoomOutIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'

/** Zoom of the editor view – a compact sibling of the camera's zoom control. */
defineProps<{
  /** 1 = whole image. */
  zoom: number
  max: number
}>()

defineEmits<{
  zoomIn: []
  zoomOut: []
  reset: []
}>()
</script>

<template>
  <div class="glass-panel flex items-center gap-1.5 p-1">
    <HintTooltip label="Verkleinern" :shortcut="['−']" side="top">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Verkleinern"
        :disabled="zoom <= 1"
        @click="$emit('zoomOut')"
      >
        <ZoomOutIcon />
      </Button>
    </HintTooltip>

    <HintTooltip
      label="Ganzes Bild – Mausrad zoomt, Leertaste + Ziehen verschiebt"
      :shortcut="['0']"
      side="top"
    >
      <Button
        variant="ghost"
        size="sm"
        class="min-w-12 tabular-nums"
        aria-label="Ganzes Bild zeigen"
        @click="$emit('reset')"
      >
        {{ zoom.toFixed(1) }}×
      </Button>
    </HintTooltip>

    <HintTooltip label="Vergrößern" :shortcut="['+']" side="top">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Vergrößern"
        :disabled="zoom >= max"
        @click="$emit('zoomIn')"
      >
        <ZoomInIcon />
      </Button>
    </HintTooltip>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ZoomInIcon, ZoomOutIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useCameraStore } from '@/stores/camera'

const camera = useCameraStore()

const modeLabel = computed(() =>
  camera.zoomMode === 'camera' ? 'Kamera-Zoom' : 'Digitaler Zoom (vergrößert die Bildmitte)'
)

function onSlide(value: number[] | undefined): void {
  if (value?.length) camera.setZoom(value[0])
}
</script>

<template>
  <div class="glass-panel flex items-center gap-1.5 p-1">
    <HintTooltip label="Verkleinern" :shortcut="['−']" side="top">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Verkleinern"
        :disabled="camera.zoom <= 1"
        @click="camera.stepZoom(-1)"
      >
        <ZoomOutIcon />
      </Button>
    </HintTooltip>

    <Slider
      class="w-28"
      aria-label="Zoom"
      :min="1"
      :max="camera.maxZoom"
      :step="0.1"
      :model-value="[camera.zoom]"
      @update:model-value="onSlide"
    />

    <HintTooltip label="Vergrößern" :shortcut="['+']" side="top">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Vergrößern"
        :disabled="camera.zoom >= camera.maxZoom"
        @click="camera.stepZoom(1)"
      >
        <ZoomInIcon />
      </Button>
    </HintTooltip>

    <HintTooltip :label="`${modeLabel} – zurücksetzen`" :shortcut="['0']" side="top">
      <Button
        variant="ghost"
        size="sm"
        class="min-w-12 tabular-nums"
        aria-label="Zoom zurücksetzen"
        @click="camera.setZoom(1)"
      >
        {{ camera.zoom.toFixed(1) }}×
      </Button>
    </HintTooltip>
  </div>
</template>

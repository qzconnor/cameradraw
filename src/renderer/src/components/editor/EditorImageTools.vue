<script setup lang="ts">
import {
  CropIcon,
  ImageUpscaleIcon,
  RotateCcwSquareIcon,
  RotateCwSquareIcon,
  UndoDotIcon
} from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Toggle } from '@/components/ui/toggle'
import { ACTIVE_TOGGLE } from './toggle'

/** Changes of the picture itself, in plain sight: turn it, straighten a part, add space. */
defineProps<{
  /** The picture was changed – it can go back to the original. */
  adjusted: boolean
  /** Crop corners are being placed – the crop button ends it, the others wait. */
  cropping: boolean
  /** One image is edited on its own – space is added to the whole picture only. */
  imageView?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  /** Clockwise quarter turns (3 = a quarter to the left). */
  rotate: [turns: 1 | 3]
  crop: []
  stopCrop: []
  extend: []
  reset: []
}>()
</script>

<template>
  <div class="glass-panel flex items-center gap-1 p-1.5" role="toolbar" aria-label="Bild">
    <HintTooltip label="Nach links drehen">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Nach links drehen"
        :disabled="disabled || cropping"
        @click="emit('rotate', 3)"
      >
        <RotateCcwSquareIcon />
      </Button>
    </HintTooltip>
    <HintTooltip label="Nach rechts drehen">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Nach rechts drehen"
        :disabled="disabled || cropping"
        @click="emit('rotate', 1)"
      >
        <RotateCwSquareIcon />
      </Button>
    </HintTooltip>

    <Separator orientation="vertical" class="mx-1 my-auto h-5" />

    <HintTooltip label="Perspektivisch zuschneiden" :shortcut="['C']">
      <Toggle
        :model-value="cropping"
        aria-label="Perspektivisch zuschneiden"
        :disabled="disabled"
        :class="ACTIVE_TOGGLE"
        @update:model-value="(on) => (on ? emit('crop') : emit('stopCrop'))"
      >
        <CropIcon />
      </Toggle>
    </HintTooltip>
    <HintTooltip label="Fläche anfügen – oder an einer Bildkante ziehen">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Fläche anfügen"
        :disabled="disabled || cropping || imageView"
        @click="emit('extend')"
      >
        <ImageUpscaleIcon />
      </Button>
    </HintTooltip>

    <Separator orientation="vertical" class="mx-1 my-auto h-5" />

    <HintTooltip label="Original wiederherstellen">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Original wiederherstellen"
        :disabled="disabled || cropping || !adjusted"
        @click="emit('reset')"
      >
        <UndoDotIcon />
      </Button>
    </HintTooltip>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { toast } from 'vue-sonner'
import type { CameraControlValues } from '@shared/camera-controls'
import { Field, FieldLabel } from '@/components/ui/field'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { CONTROL_LABELS, sliderFor } from '@/lib/camera-controls'
import { errorMessage } from '@/lib/format'
import { useCameraControlsStore, type CameraControl } from '@/stores/camera-controls'

/**
 * One picture control of the camera: a slider, and for exposure, white balance and focus a switch
 * for the camera's automatic. Moving the slider switches the automatic off.
 */
const props = defineProps<{ control: CameraControl }>()

const controls = useCameraControlsStore()

const label = computed(() => CONTROL_LABELS[props.control.name])
const slider = computed(() => sliderFor(props.control))
const auto = computed(() => props.control.kind === 'auto' && controls.isAuto(props.control.name))
const value = computed(() => {
  const name = slider.value?.name
  const current = name ? controls.values[name] : undefined
  return typeof current === 'number' ? current : undefined
})
const switchId = computed(() => `camera-${props.control.name}-auto`)

function report(change: Promise<void>): void {
  change.catch((err) =>
    // One message for a whole slider move, not one per step.
    toast.error('Die Kamera hat die Einstellung nicht übernommen', {
      id: 'camera-control',
      description: errorMessage(err)
    })
  )
}

function onSlide(position: number[] | undefined): void {
  const s = slider.value
  if (!s || !position?.length) return
  report(controls.set({ [s.name]: s.fromSlider(position[0]) } as CameraControlValues))
}

function onAuto(on: boolean): void {
  if (props.control.kind === 'auto') report(controls.setAuto(props.control.name, on))
}
</script>

<template>
  <Field class="gap-2.5">
    <div class="flex min-h-5 items-center gap-2">
      <FieldLabel class="flex-1">{{ label }}</FieldLabel>
      <span
        v-if="slider && value !== undefined && !auto"
        class="text-xs text-muted-foreground tabular-nums"
      >
        {{ slider.format(value) }}
      </span>
      <template v-if="control.kind === 'auto'">
        <FieldLabel
          :for="switchId"
          class="cursor-pointer text-xs font-normal text-muted-foreground"
        >
          Auto
        </FieldLabel>
        <Switch
          :id="switchId"
          size="sm"
          :aria-label="`${label} automatisch`"
          :model-value="auto"
          @update:model-value="onAuto"
        />
      </template>
    </div>
    <!-- In automatic mode the slider stays usable (dimmed) – moving it switches to manual. -->
    <Slider
      v-if="slider"
      :aria-label="label"
      :min="slider.min"
      :max="slider.max"
      :step="slider.step"
      :model-value="[value === undefined ? slider.min : slider.toSlider(value)]"
      :class="auto && 'opacity-50 hover:opacity-100'"
      @update:model-value="onSlide"
    />
  </Field>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { toast } from 'vue-sonner'
import type { PowerLineFrequency } from '@shared/devices'
import { SEGMENTED_GROUP, SEGMENTED_ITEM } from '@/components/common/segmented'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { errorMessage } from '@/lib/format'
import { useCameraControlsStore } from '@/stores/camera-controls'

/**
 * The camera's anti-flicker filter, like in Logi Capture: 50 or 60 Hz, the mains frequency of the
 * lamps. The switch only shows for cameras that can turn it off.
 */
const controls = useCameraControlsStore()

const state = computed(() => controls.powerLine)
const on = computed(() => state.value?.value !== 0)
const canTurnOff = computed(() => !!state.value?.options.includes(0))
const frequencies = computed(() =>
  (state.value?.options ?? []).filter((hz): hz is 50 | 60 => hz !== 0)
)

function apply(hz: PowerLineFrequency): void {
  controls.set({ powerLineFrequency: hz }).catch((err) =>
    toast.error('Der Flimmerfilter wurde nicht übernommen', {
      id: 'camera-control',
      description: errorMessage(err)
    })
  )
}

function pick(value: unknown): void {
  // Clicking the active item would deselect it – one of them is always picked.
  const hz = Number(value)
  if ((hz === 50 || hz === 60) && hz !== state.value?.value) apply(hz)
}
</script>

<template>
  <Field v-if="state" class="gap-2.5">
    <div class="flex min-h-5 items-center gap-2">
      <FieldLabel :for="canTurnOff ? 'camera-power-line' : undefined" class="flex-1">
        Flimmerfilter
      </FieldLabel>
      <Switch
        v-if="canTurnOff"
        id="camera-power-line"
        size="sm"
        :model-value="on"
        @update:model-value="apply($event ? 50 : 0)"
      />
    </div>
    <ToggleGroup
      type="single"
      size="sm"
      :spacing="0.5"
      :class="['w-full', SEGMENTED_GROUP]"
      aria-label="Netzfrequenz"
      :disabled="!on"
      :model-value="on ? String(state.value) : undefined"
      @update:model-value="pick"
    >
      <ToggleGroupItem
        v-for="hz in frequencies"
        :key="hz"
        :value="String(hz)"
        :class="['flex-1', SEGMENTED_ITEM]"
      >
        {{ hz }} Hz
      </ToggleGroupItem>
    </ToggleGroup>
    <FieldDescription>
      Gegen Flackern und Streifen im Licht von Lampen: 50 Hz in Europa, 60 Hz z. B. in Nordamerika.
    </FieldDescription>
  </Field>
</template>

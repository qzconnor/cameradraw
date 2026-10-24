<script setup lang="ts">
import type { AcceptableValue } from 'reka-ui'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ACTIVE_TOGGLE } from './toggle'

const props = defineProps<{
  options: number[]
  /** `stroke` shows dots of growing size, `font` a growing "A", `marker` a growing "1". */
  kind: 'stroke' | 'font' | 'marker'
}>()
const value = defineModel<number>({ required: true })

const DOT_SIZES = [4, 6, 9, 12, 16]
const GLYPH_SIZES = [11, 13, 15, 18, 21]

const NAMES = { stroke: 'Strichstärke', font: 'Schriftgröße', marker: 'Nummerngröße' }

const label = (option: number): string => `${NAMES[props.kind]} ${option}`

function onChange(next: AcceptableValue): void {
  if (next) value.value = Number(next)
}
</script>

<template>
  <ToggleGroup
    type="single"
    :spacing="1"
    :model-value="String(value)"
    :aria-label="NAMES[kind]"
    @update:model-value="onChange"
  >
    <HintTooltip v-for="(option, i) in options" :key="option" :label="label(option)">
      <!-- mousedown.prevent: a text being typed keeps the keyboard. -->
      <ToggleGroupItem
        :value="String(option)"
        :aria-label="label(option)"
        :class="ACTIVE_TOGGLE"
        @mousedown.prevent
      >
        <span
          v-if="kind === 'stroke'"
          class="rounded-full bg-current"
          :style="{ width: `${DOT_SIZES[i]}px`, height: `${DOT_SIZES[i]}px` }"
        />
        <span
          v-else
          class="leading-none font-semibold"
          :style="{ fontSize: `${GLYPH_SIZES[i]}px` }"
          >{{ kind === 'marker' ? '1' : 'A' }}</span
        >
      </ToggleGroupItem>
    </HintTooltip>
  </ToggleGroup>
</template>

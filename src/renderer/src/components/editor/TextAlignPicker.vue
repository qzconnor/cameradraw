<script setup lang="ts">
import { computed } from 'vue'
import type { AcceptableValue } from 'reka-ui'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TEXT_ALIGNS, isTextAlign, type TextAlign } from '@/editor/tools'
import { ACTIVE_TOGGLE } from './toggle'

/**
 * Left, centred, right – three buttons; in a narrow window one that shows the alignment and
 * switches to the next one, so the toolbar fits.
 */
const align = defineModel<TextAlign>({ required: true })

const current = computed(() => TEXT_ALIGNS.find((a) => a.id === align.value) ?? TEXT_ALIGNS[0])
const next = computed(
  () => TEXT_ALIGNS[(TEXT_ALIGNS.indexOf(current.value) + 1) % TEXT_ALIGNS.length]
)

function onChange(value: AcceptableValue): void {
  if (isTextAlign(value)) align.value = value
}
</script>

<template>
  <!-- mousedown.prevent: a text being typed keeps the keyboard. -->
  <ToggleGroup
    type="single"
    :spacing="1"
    :model-value="align"
    aria-label="Ausrichtung"
    class="max-lg:hidden"
    @update:model-value="onChange"
  >
    <HintTooltip v-for="option in TEXT_ALIGNS" :key="option.id" :label="option.label">
      <ToggleGroupItem
        :value="option.id"
        :aria-label="option.label"
        :class="ACTIVE_TOGGLE"
        @mousedown.prevent
      >
        <component :is="option.icon" />
      </ToggleGroupItem>
    </HintTooltip>
  </ToggleGroup>
  <HintTooltip :label="`${current.label} – Klick: ${next.label}`">
    <Button
      variant="ghost"
      size="icon"
      class="hidden max-lg:inline-flex"
      :aria-label="`Ausrichtung: ${current.label}`"
      @mousedown.prevent
      @click="align = next.id"
    >
      <component :is="current.icon" />
    </Button>
  </HintTooltip>
</template>

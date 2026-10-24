<script setup lang="ts">
import { computed } from 'vue'
import { FocusIcon, XIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { SEGMENTED_GROUP, SEGMENTED_ITEM } from '@/components/common/segmented'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import {
  PEAKING_COLORS,
  PEAKING_LEVELS,
  isPeakingLevel,
  useFocusPeakingStore
} from '@/stores/focus-peaking'

/**
 * While the focus aid is on: how sharp the picture is now compared with the sharpest it was a
 * moment ago, how readily edges light up, and their colour.
 */
const peaking = useFocusPeakingStore()

/** Close to the sharpest of the last seconds: the focus sits. */
const SHARP = 0.95

const percent = computed(() => Math.round(peaking.relative * 100))
const sharp = computed(() => peaking.sharpness !== null && peaking.relative >= SHARP)

function pickLevel(value: unknown): void {
  // Clicking the active item would deselect it – one of them is always picked.
  if (isPeakingLevel(value)) peaking.level = value
}
</script>

<template>
  <div class="glass-panel flex items-center gap-3 py-1 pr-1 pl-3 text-sm">
    <FocusIcon class="size-4 shrink-0" />
    <span class="font-medium">Schärfe</span>
    <HintTooltip
      label="Wie scharf das Bild in der Mitte gerade ist – verglichen mit dem schärfsten der letzten Sekunden. Am Fokus drehen, bis der Balken voll ist."
    >
      <div
        role="meter"
        aria-label="Schärfe"
        :aria-valuenow="percent"
        aria-valuemin="0"
        aria-valuemax="100"
        class="relative h-2 w-36 overflow-hidden rounded-full bg-foreground/15"
      >
        <div
          :class="
            cn(
              'absolute inset-y-0 left-0 rounded-full transition-[width] duration-150',
              sharp ? 'bg-emerald-400' : 'bg-foreground/70'
            )
          "
          :style="{ width: `${percent}%` }"
        />
      </div>
    </HintTooltip>

    <ToggleGroup
      type="single"
      size="sm"
      :spacing="0.5"
      :class="SEGMENTED_GROUP"
      aria-label="Empfindlichkeit der Schärfehilfe"
      :model-value="peaking.level"
      @update:model-value="pickLevel"
    >
      <ToggleGroupItem
        v-for="level in PEAKING_LEVELS"
        :key="level.id"
        :value="level.id"
        :class="SEGMENTED_ITEM"
      >
        {{ level.label }}
      </ToggleGroupItem>
    </ToggleGroup>

    <div class="flex items-center gap-1" role="group" aria-label="Farbe der Schärfehilfe">
      <HintTooltip v-for="color in PEAKING_COLORS" :key="color.value" :label="color.label">
        <button
          type="button"
          :aria-label="color.label"
          :aria-pressed="peaking.color === color.value"
          :class="
            cn(
              'size-5 rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-popover transition outline-none focus-visible:ring-ring/60',
              peaking.color === color.value && 'ring-foreground/80'
            )
          "
          :style="{ backgroundColor: color.value }"
          @click="peaking.color = color.value"
        />
      </HintTooltip>
    </div>

    <HintTooltip label="Schärfehilfe ausschalten">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Schärfehilfe ausschalten"
        @click="peaking.enabled = false"
      >
        <XIcon />
      </Button>
    </HintTooltip>
  </div>
</template>

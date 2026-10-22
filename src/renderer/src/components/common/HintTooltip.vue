<script setup lang="ts">
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

withDefaults(
  defineProps<{
    label: string
    /** Keys shown next to the label, e.g. `['Strg', 'Z']`. */
    shortcut?: string[]
    side?: 'top' | 'right' | 'bottom' | 'left'
    /** Shows nothing, e.g. while the trigger says it all already. */
    disabled?: boolean
  }>(),
  { side: 'bottom', disabled: false }
)
</script>

<template>
  <Tooltip :disabled="disabled">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipContent :side="side" :side-offset="6">
      {{ label }}
      <KbdGroup v-if="shortcut?.length">
        <Kbd v-for="key in shortcut" :key="key">{{ key }}</Kbd>
      </KbdGroup>
    </TooltipContent>
  </Tooltip>
</template>

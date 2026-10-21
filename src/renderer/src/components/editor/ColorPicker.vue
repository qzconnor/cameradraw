<script setup lang="ts">
import { PipetteIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { COLOR_PRESETS } from '@/editor/tools'
import { cn } from '@/lib/utils'

const color = defineModel<string>({ required: true })
</script>

<template>
  <Popover>
    <!-- Own anchor outside the tooltip: inside it, the trigger would register with the tooltip's
         positioning and the popover would open off-screen. -->
    <PopoverAnchor as-child>
      <div class="flex">
        <HintTooltip label="Farbe">
          <PopoverTrigger as-child>
            <Button variant="ghost" size="icon" aria-label="Farbe wählen">
              <span
                class="size-5 rounded-full ring-2 ring-foreground/25"
                :style="{ backgroundColor: color }"
              />
            </Button>
          </PopoverTrigger>
        </HintTooltip>
      </div>
    </PopoverAnchor>

    <PopoverContent class="w-auto" :side-offset="10">
      <div class="grid grid-cols-5 gap-2" role="group" aria-label="Farbvorlagen">
        <button
          v-for="preset in COLOR_PRESETS"
          :key="preset"
          type="button"
          :aria-label="preset"
          :aria-pressed="preset === color"
          :class="
            cn(
              'size-7 rounded-full ring-1 ring-foreground/20 ring-offset-2 ring-offset-popover transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring',
              preset === color && 'ring-2 ring-foreground'
            )
          "
          :style="{ backgroundColor: preset }"
          @click="color = preset"
        />
      </div>
      <Separator />
      <label class="flex cursor-pointer items-center gap-2 text-sm">
        <!-- The circle is drawn here; the native colour input lies invisibly on top of it: its own
             swatch is not reliably clipped to the circle (it showed as a square). -->
        <span
          class="relative grid size-7 shrink-0 place-items-center rounded-full ring-1 ring-foreground/20 has-focus-visible:ring-2 has-focus-visible:ring-ring"
          :style="{ backgroundColor: color }"
        >
          <PipetteIcon class="pointer-events-none size-3.5 mix-blend-difference" />
          <input
            v-model="color"
            type="color"
            class="absolute inset-0 size-full cursor-pointer opacity-0"
            aria-label="Eigene Farbe"
          />
        </span>
        Eigene Farbe
        <span class="ml-auto font-mono text-xs text-muted-foreground uppercase">{{ color }}</span>
      </label>
    </PopoverContent>
  </Popover>
</template>

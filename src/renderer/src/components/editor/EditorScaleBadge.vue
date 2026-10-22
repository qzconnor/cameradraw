<script setup lang="ts">
import { computed } from 'vue'
import { RulerIcon, XIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { formatScale } from '@/editor/measure'

/** Shows the scale the measuring lines use; a menu explains it and can remove it. */
const props = defineProps<{ micronsPerPixel: number }>()
defineEmits<{ remove: [] }>()

const pixelsPerMillimetre = computed(() => Math.round(1000 / props.micronsPerPixel))
</script>

<template>
  <DropdownMenu>
    <!-- No HintTooltip around the trigger: nested in one, the menu loses its anchor and opens
         off-screen. -->
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" class="glass-panel h-11 px-3.5 tabular-nums" aria-label="Maßstab">
        <RulerIcon data-icon="inline-start" />
        {{ formatScale(micronsPerPixel) }}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" side="top" class="w-72">
      <DropdownMenuLabel class="flex flex-col gap-1 font-normal">
        <span class="font-medium text-foreground">Maßstab dieses Bildes</span>
        <span class="text-muted-foreground tabular-nums">
          1 mm = {{ pixelsPerMillimetre }} Pixel. Er stimmt nur, solange Vergrößerung und Abstand am
          Mikroskop so waren wie beim Kalibrieren.
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="$emit('remove')">
        <XIcon />
        Maßstab entfernen
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

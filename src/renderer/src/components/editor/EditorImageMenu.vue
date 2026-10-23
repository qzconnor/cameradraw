<script setup lang="ts">
import {
  ChevronDownIcon,
  CropIcon,
  ImageIcon,
  ImageUpscaleIcon,
  RotateCcwSquareIcon,
  RotateCwSquareIcon,
  UndoDotIcon
} from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

/** Changes of the picture itself: turn it, straighten a part of it, add space around it. */
defineProps<{
  /** The picture was changed – it can go back to the original. */
  adjusted: boolean
  disabled?: boolean
}>()

defineEmits<{
  /** Clockwise quarter turns (3 = a quarter to the left). */
  rotate: [turns: 1 | 3]
  crop: []
  extend: []
  reset: []
}>()
</script>

<template>
  <div class="glass-panel p-1.5">
    <DropdownMenu>
      <!-- No HintTooltip around the trigger: nested in one, the menu opens off-screen. -->
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" :disabled="disabled">
          <ImageIcon data-icon="inline-start" />
          Bild
          <ChevronDownIcon data-icon="inline-end" class="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-max">
        <DropdownMenuGroup>
          <DropdownMenuItem @select="$emit('rotate', 3)">
            <RotateCcwSquareIcon />
            Nach links drehen
          </DropdownMenuItem>
          <DropdownMenuItem @select="$emit('rotate', 1)">
            <RotateCwSquareIcon />
            Nach rechts drehen
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem @select="$emit('crop')">
            <CropIcon />
            Perspektivisch zuschneiden …
            <DropdownMenuShortcut class="pl-6">C</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem @select="$emit('extend')">
            <ImageUpscaleIcon />
            Fläche anfügen …
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem :disabled="!adjusted" @select="$emit('reset')">
            <UndoDotIcon />
            Original wiederherstellen
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>

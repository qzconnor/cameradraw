<script setup lang="ts">
import { FolderIcon, ImagesIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { useGalleryDrag } from '@/composables/useGalleryDrag'
import { cn } from '@/lib/utils'

/**
 * Slides in while an image is dragged: drop targets for "Kein Projekt" (null) and for projects
 * that are not on screen as cards.
 */
defineProps<{ targets: (string | null)[] }>()

const drag = useGalleryDrag()
const { active } = drag
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="translate-y-6 opacity-0"
    leave-active-class="transition duration-200 ease-in"
    leave-to-class="translate-y-6 opacity-0"
  >
    <div
      v-if="active && targets.length"
      data-drag-dock
      class="glass-panel absolute inset-x-3 bottom-3 flex flex-col gap-2 p-3"
    >
      <p class="text-xs text-muted-foreground">Zum Verschieben hierher ziehen</p>
      <!-- The padding leaves room for the entry animation and the enlarged target, so they do not
           make the list scrollable. -->
      <div class="-m-1.5 flex max-h-32 flex-wrap gap-1.5 overflow-x-hidden overflow-y-auto p-1.5">
        <!-- Not clickable – rendered as a div, it only receives drops. -->
        <Button
          v-for="(target, index) in targets"
          :key="target ?? ''"
          as="div"
          size="sm"
          :variant="drag.isOver(target) ? 'default' : 'outline'"
          :data-drop-project="target ?? ''"
          :class="
            cn(
              'max-w-full fill-mode-backwards duration-300 animate-in fade-in slide-in-from-bottom-1',
              drag.isOver(target) && 'scale-105'
            )
          "
          :style="{ animationDelay: `${index * 35}ms` }"
        >
          <ImagesIcon v-if="target === null" data-icon="inline-start" />
          <FolderIcon v-else data-icon="inline-start" />
          <span class="truncate">{{ target ?? 'Kein Projekt' }}</span>
        </Button>
      </div>
    </div>
  </Transition>
</template>

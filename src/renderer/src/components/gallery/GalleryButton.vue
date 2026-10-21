<script setup lang="ts">
import { computed } from 'vue'
import { ImagesIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useGalleryStore } from '@/stores/gallery'
import { usePanelsStore } from '@/stores/panels'

const gallery = useGalleryStore()
const panels = usePanelsStore()
const open = computed(() => panels.isOpen('gallery'))
</script>

<template>
  <HintTooltip :label="open ? 'Galerie schließen' : 'Galerie öffnen'" :shortcut="['G']">
    <!-- data-panel-toggle: the side panel ignores "outside clicks" on its own toggle.
         aria-expanded also gives the ghost button its pressed look. -->
    <Button
      variant="ghost"
      size="sm"
      data-panel-toggle="gallery"
      :aria-expanded="open"
      @click="panels.toggle('gallery')"
    >
      <ImagesIcon data-icon="inline-start" />
      Galerie
      <Badge variant="secondary" class="tabular-nums">{{ gallery.items.length }}</Badge>
    </Button>
  </HintTooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BlocksIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import { usePanelsStore } from '@/stores/panels'

const panels = usePanelsStore()
const open = computed(() => panels.isOpen('modules'))
</script>

<template>
  <HintTooltip :label="open ? 'Geräte-Module schließen' : 'Geräte-Module'">
    <!-- data-panel-toggle: the side panel ignores "outside clicks" on its own toggle.
         aria-expanded also gives the ghost button its pressed look. -->
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Geräte-Module"
      data-panel-toggle="modules"
      :aria-expanded="open"
      @click="panels.toggle('modules')"
    >
      <BlocksIcon />
    </Button>
  </HintTooltip>
</template>

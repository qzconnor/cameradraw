<script setup lang="ts">
import { computed } from 'vue'
import { SettingsIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import { usePanelsStore } from '@/stores/panels'

const panels = usePanelsStore()
const open = computed(() => panels.isOpen('settings'))
</script>

<template>
  <HintTooltip :label="open ? 'Einstellungen schließen' : 'Einstellungen'">
    <!-- data-panel-toggle: the side panel ignores "outside clicks" on its own toggle.
         aria-expanded also gives the ghost button its pressed look. -->
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Einstellungen"
      data-panel-toggle="settings"
      :aria-expanded="open"
      @click="panels.toggle('settings')"
    >
      <SettingsIcon />
    </Button>
  </HintTooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BotIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useMcpStore } from '@/stores/mcp'
import { usePanelsStore } from '@/stores/panels'

/**
 * Shown while the MCP server is switched on, so it is clear that the app can be controlled from
 * outside; a pulsing dot while a client is doing something. Opens the settings.
 */
const mcp = useMcpStore()
const panels = usePanelsStore()

const state = computed(() => mcp.status?.state ?? 'off')

const label = computed(() => {
  if (state.value === 'error') return 'MCP-Server läuft nicht'
  if (mcp.busy) return `${mcp.status?.lastClient?.name ?? 'Ein KI-Assistent'} bedient CameraDraw`
  return 'KI-Steuerung an (MCP-Server)'
})
</script>

<template>
  <HintTooltip v-if="state !== 'off'" :label="label">
    <!-- data-panel-toggle: the side panel ignores "outside clicks" on its own toggle. -->
    <Button
      variant="ghost"
      size="icon-sm"
      class="relative"
      :aria-label="label"
      data-panel-toggle="settings"
      @click="panels.toggle('settings')"
    >
      <BotIcon :class="cn(state === 'error' && 'text-destructive')" />
      <span v-if="mcp.busy" class="absolute top-1 right-1 flex size-2">
        <span class="absolute size-full animate-ping rounded-full bg-success opacity-75" />
        <span class="relative size-2 rounded-full bg-success ring-2 ring-sidebar" />
      </span>
    </Button>
  </HintTooltip>
</template>

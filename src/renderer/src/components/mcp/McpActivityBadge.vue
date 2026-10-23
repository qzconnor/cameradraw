<script setup lang="ts">
import { SparklesIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { useMcpStore } from '@/stores/mcp'
import { usePanelsStore } from '@/stores/panels'

/**
 * In the title bar while an AI assistant controls the app: who it is and what it does right now
 * ("Claude Code zeichnet …"). A click shows the MCP settings.
 */
const mcp = useMcpStore()
const panels = usePanelsStore()
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    leave-active-class="transition duration-500 ease-in"
    enter-from-class="-translate-y-3 scale-90 opacity-0"
    leave-to-class="-translate-y-3 scale-90 opacity-0"
  >
    <!-- An element of its own for the transition (the tooltip renders none). -->
    <div v-if="mcp.engaged" class="no-drag flex min-w-0">
      <HintTooltip label="Per MCP gesteuert – Einstellungen">
        <button
          type="button"
          role="status"
          :aria-label="`${mcp.clientName} ${mcp.busy ? mcp.activity : 'bedient CameraDraw'}`"
          class="mcp-ring no-drag relative max-w-80 rounded-full p-px shadow-[0_0_18px_-4px] shadow-fuchsia-500/60 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="panels.setOpen('settings', true)"
        >
          <span
            class="flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-sidebar/95 pr-3 pl-1 text-xs"
          >
            <span
              class="mcp-fill grid size-4.5 shrink-0 place-items-center rounded-full text-white"
            >
              <SparklesIcon class="size-3" />
            </span>
            <span class="truncate font-semibold">{{ mcp.clientName }}</span>
            <span v-if="mcp.busy" class="mcp-shimmer truncate">{{ mcp.activity }} …</span>
            <span v-else class="truncate text-muted-foreground">bedient CameraDraw</span>
          </span>
        </button>
      </HintTooltip>
    </div>
  </Transition>
</template>

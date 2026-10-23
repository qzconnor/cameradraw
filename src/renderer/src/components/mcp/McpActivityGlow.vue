<script setup lang="ts">
import { useMcpStore } from '@/stores/mcp'

/**
 * While an AI assistant controls the app, light in its colours turns around the window's edge –
 * brighter and breathing while it acts, softer while it thinks between two steps.
 */
const mcp = useMcpStore()
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-700 ease-out"
    leave-active-class="transition-opacity duration-1000 ease-in"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="mcp.engaged"
      class="pointer-events-none fixed inset-0 z-[100]"
      data-mcp-glow
      aria-hidden="true"
    >
      <div
        class="mcp-glow-haze"
        :class="
          mcp.busy ? 'animate-[mcp-breathe_1.4s_ease-in-out_infinite_alternate]' : 'opacity-35'
        "
      >
        <div class="mcp-glow-turn" />
      </div>
      <div class="mcp-glow-line transition-opacity duration-700" :class="!mcp.busy && 'opacity-60'">
        <div class="mcp-glow-turn" />
      </div>
    </div>
  </Transition>
</template>

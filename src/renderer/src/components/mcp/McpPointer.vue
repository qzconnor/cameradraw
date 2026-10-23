<script setup lang="ts">
import { ref, watch } from 'vue'
import { useMcpStore } from '@/stores/mcp'

/**
 * The pointer of an AI assistant: where it clicks and drags (and where it has just drawn), with its
 * name – like the cursors of others in a shared document. It glides to each point, so the user can
 * follow; a click ripples. It only shows; the input itself goes to the app as usual.
 */
const mcp = useMcpStore()

/** As long as the ripple animation (`mcp-ripple`) runs. */
const RIPPLE_MS = 600
const ripples = ref<number[]>([])

watch(
  () => mcp.clicks,
  (id) => {
    ripples.value.push(id)
    setTimeout(() => (ripples.value = ripples.value.filter((other) => other !== id)), RIPPLE_MS)
  }
)
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-300"
    leave-active-class="transition-opacity duration-700"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="mcp.pointer"
      class="pointer-events-none fixed top-0 left-0 z-[101]"
      data-mcp-pointer
      aria-hidden="true"
    >
      <div
        class="transition-[translate]"
        :class="mcp.pointer.pressed ? 'duration-75 ease-linear' : 'duration-200 ease-out'"
        :style="{ translate: `${mcp.pointer.x}px ${mcp.pointer.y}px` }"
      >
        <!-- Each click ripples out from the tip. -->
        <span
          v-for="id in ripples"
          :key="id"
          class="mcp-ring mcp-ripple absolute -top-6 -left-6 size-12 rounded-full opacity-0 [mask:radial-gradient(circle,transparent_55%,#000_57%)]"
        />
        <svg
          class="absolute -top-px -left-px size-6 drop-shadow-[0_2px_4px_rgb(0_0_0/0.5)] transition-transform duration-100"
          :class="mcp.pointer.pressed && 'scale-90'"
          viewBox="0 0 24 24"
        >
          <defs>
            <linearGradient id="mcp-pointer-fill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#22d3ee" />
              <stop offset="50%" stop-color="#a855f7" />
              <stop offset="100%" stop-color="#ec4899" />
            </linearGradient>
          </defs>
          <path
            d="M2 1.5 L2 19.5 L7 14.8 L10.4 22 L13.6 20.6 L10.3 13.6 L17 13.6 Z"
            fill="url(#mcp-pointer-fill)"
            stroke="white"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
        </svg>
        <span
          class="mcp-fill absolute top-5 left-4 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white shadow-lg"
        >
          {{ mcp.clientName }}
        </span>
      </div>
    </div>
  </Transition>
</template>

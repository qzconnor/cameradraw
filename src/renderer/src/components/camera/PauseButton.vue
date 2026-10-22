<script setup lang="ts">
import { computed } from 'vue'
import { PauseIcon, PlayIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'

const props = defineProps<{ paused: boolean }>()
defineEmits<{ click: [] }>()

const label = computed(() => (props.paused ? 'Kamera fortsetzen' : 'Kamera pausieren'))
</script>

<!-- A smaller sibling of the shutter button, in the same look. -->
<template>
  <HintTooltip :label="label" :shortcut="['P']" side="top">
    <button
      type="button"
      :aria-label="label"
      class="grid size-11 place-items-center rounded-full border-2 border-stage-foreground/90 bg-stage/30 text-stage-foreground shadow-2xl backdrop-blur-sm transition outline-none hover:border-stage-foreground hover:bg-stage/50 focus-visible:ring-4 focus-visible:ring-ring/60 active:scale-95"
      @click="$emit('click')"
    >
      <PlayIcon v-if="paused" class="size-5 translate-x-px fill-current" />
      <PauseIcon v-else class="size-5 fill-current" />
    </button>
  </HintTooltip>
</template>

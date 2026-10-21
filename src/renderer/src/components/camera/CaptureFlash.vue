<script setup lang="ts">
import { nextTick, ref } from 'vue'

const visible = ref(false)

/** Short white flash as feedback that the frame was frozen. */
async function trigger(): Promise<void> {
  visible.value = true
  await nextTick()
  requestAnimationFrame(() => (visible.value = false))
}

defineExpose({ trigger })
</script>

<template>
  <Transition
    leave-active-class="transition-opacity duration-500 ease-out"
    leave-to-class="opacity-0"
  >
    <div v-if="visible" class="pointer-events-none absolute inset-0 z-10 bg-stage-foreground/70" />
  </Transition>
</template>

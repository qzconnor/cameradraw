<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import type { CameraStatus } from '@/stores/camera'

const props = defineProps<{ status: CameraStatus }>()

const tone = computed(() => {
  switch (props.status) {
    case 'live':
      return 'bg-success'
    case 'waiting':
    case 'starting':
    case 'idle':
      return 'bg-warning animate-pulse'
    case 'busy':
    case 'denied':
      return 'bg-destructive'
    default:
      return 'bg-muted-foreground'
  }
})
</script>

<template>
  <span :class="cn('size-2 shrink-0 rounded-full', tone)" aria-hidden="true" />
</template>

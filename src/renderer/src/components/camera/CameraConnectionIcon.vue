<script setup lang="ts">
import { computed } from 'vue'
import { AppWindowIcon, LaptopIcon, UsbIcon, VideoIcon } from '@lucide/vue'
import { CONNECTION_LABELS, type CameraConnection } from '@/lib/camera-info'

const props = defineProps<{ connection: CameraConnection }>()

const ICONS = { usb: UsbIcon, physical: LaptopIcon, virtual: AppWindowIcon, unknown: VideoIcon }
const icon = computed(() => ICONS[props.connection])
</script>

<!-- aria-label instead of text: select items copy their text into the trigger. -->
<template>
  <component :is="icon" :aria-label="CONNECTION_LABELS[connection]" role="img" />
</template>

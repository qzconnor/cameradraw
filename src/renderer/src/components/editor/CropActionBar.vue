<script setup lang="ts">
import { CropIcon, XIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

/** Replaces the action bar while the corners for a perspective crop are being placed. */
defineProps<{
  /** Size of the straightened result, null while the corners span no quadrilateral. */
  result: { width: number; height: number } | null
}>()

defineEmits<{ cancel: []; apply: [] }>()
</script>

<template>
  <div class="glass-panel flex items-center gap-1.5 p-1.5">
    <HintTooltip label="Nicht zuschneiden" :shortcut="['Esc']" side="top">
      <Button variant="ghost" @click="$emit('cancel')">
        <XIcon data-icon="inline-start" />
        Abbrechen
      </Button>
    </HintTooltip>

    <Separator orientation="vertical" class="mx-0.5 my-auto h-5" />

    <p class="px-2 text-sm text-muted-foreground">
      <template v-if="result">
        Ecken auf die Kanten ziehen ·
        <span class="text-foreground tabular-nums">{{ result.width }} × {{ result.height }}</span>
        px
      </template>
      <template v-else>Die Ecken müssen ein Viereck bilden.</template>
    </p>

    <HintTooltip label="Zuschneiden und gerade ziehen" :shortcut="['Enter']" side="top">
      <Button :disabled="!result" @click="$emit('apply')">
        <CropIcon data-icon="inline-start" />
        Zuschneiden
      </Button>
    </HintTooltip>
  </div>
</template>

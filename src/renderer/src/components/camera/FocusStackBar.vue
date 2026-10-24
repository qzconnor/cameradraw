<script setup lang="ts">
import { Layers2Icon, XIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { SEGMENTED_GROUP, SEGMENTED_ITEM } from '@/components/common/segmented'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useBurstStore } from '@/stores/burst'
import { SWEEP_FRAMES, useFocusStackStore } from '@/stores/focus-stack'

/**
 * While focus stacking is on: how it works, the automatic sweep for cameras that move their own
 * focus, and the progress of a stack being taken and merged.
 */
const stack = useFocusStackStore()
const burst = useBurstStore()

function pickFrames(value: unknown): void {
  const count = Number(value)
  if (count) stack.sweepFrames = count
}

// Failures are shown as toasts by the store.
const sweep = (): Promise<unknown> => stack.sweep(burst.enabled).catch(() => undefined)
const finish = (): Promise<unknown> => stack.finish().catch(() => undefined)
</script>

<template>
  <div
    class="glass-panel flex items-center gap-3 py-1 pr-1 pl-3 text-sm"
    aria-label="Fokus-Stacking"
  >
    <Layers2Icon class="size-4 shrink-0" />
    <span class="font-medium">Fokus-Stacking</span>

    <template v-if="stack.state === 'idle'">
      <span class="text-muted-foreground">
        Auslöser drücken, langsam durch den Fokus drehen, Auslöser beendet
      </span>
      <template v-if="stack.canSweep">
        <ToggleGroup
          type="single"
          size="sm"
          :spacing="0.5"
          :class="SEGMENTED_GROUP"
          aria-label="Bilder beim automatischen Durchfahren"
          :model-value="String(stack.sweepFrames)"
          @update:model-value="pickFrames"
        >
          <ToggleGroupItem
            v-for="count in SWEEP_FRAMES"
            :key="count"
            :value="String(count)"
            :class="SEGMENTED_ITEM"
          >
            {{ count }}
          </ToggleGroupItem>
        </ToggleGroup>
        <HintTooltip label="Die Kamera fährt den Fokus selbst von nah bis fern durch">
          <Button size="sm" variant="secondary" @click="sweep">Automatisch</Button>
        </HintTooltip>
      </template>
      <HintTooltip label="Fokus-Stacking ausschalten">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Fokus-Stacking ausschalten"
          @click="stack.enabled = false"
        >
          <XIcon />
        </Button>
      </HintTooltip>
    </template>

    <template v-else-if="stack.state === 'recording'">
      <span class="size-2 shrink-0 animate-pulse rounded-full bg-red-500" />
      <span class="tabular-nums" role="status">
        {{ stack.frames }} {{ stack.frames === 1 ? 'Bild' : 'Bilder' }}
      </span>
      <span class="text-muted-foreground">– langsam am Fokus drehen</span>
      <Button size="sm" @click="finish">Fertig</Button>
      <Button size="sm" variant="ghost" @click="stack.cancel()">Abbrechen</Button>
    </template>

    <template v-else>
      <Spinner class="size-4" />
      <span class="tabular-nums" role="status">
        <template v-if="stack.state === 'sweeping'">
          Fokus fährt durch – Bild {{ stack.frames }} von {{ stack.planned }}
        </template>
        <template v-else>Wird zusammengesetzt – {{ stack.merged }} von {{ stack.frames }}</template>
      </span>
      <Button size="sm" variant="ghost" @click="stack.cancel()">Abbrechen</Button>
    </template>
  </div>
</template>

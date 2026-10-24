<script setup lang="ts">
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { BlendIcon, ChevronDownIcon, XIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { SEGMENTED_GROUP, SEGMENTED_ITEM } from '@/components/common/segmented'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { errorMessage } from '@/lib/format'
import { cn } from '@/lib/utils'
import { isReferenceMode, useReferenceStore } from '@/stores/reference'

/**
 * While a reference lies over the live picture: which image it is (another one is picked from the
 * newest), how strongly it shows, blended or as the difference, with or without its drawing.
 */
const reference = useReferenceStore()

/** Images offered for picking – the newest; any other one from the gallery's menu. */
const CHOICES = 12

const pickerOpen = ref(false)

async function pick(path: string): Promise<void> {
  pickerOpen.value = false
  try {
    await reference.show(path)
  } catch (err) {
    toast.error('Referenzbild konnte nicht geladen werden', { description: errorMessage(err) })
  }
}

function pickMode(value: unknown): void {
  // Clicking the active item would deselect it – one of them is always picked.
  if (isReferenceMode(value)) reference.mode = value
}
</script>

<template>
  <div class="glass-panel flex items-center gap-3 py-1 pr-1 pl-3 text-sm">
    <BlendIcon class="size-4 shrink-0" />
    <span class="font-medium">Referenz</span>

    <Popover v-model:open="pickerOpen">
      <PopoverTrigger as-child>
        <Button variant="ghost" size="sm" aria-label="Referenzbild wählen" class="max-w-56">
          <img
            v-if="reference.item"
            :src="reference.item.thumbUrl"
            alt=""
            class="h-5 w-8 shrink-0 rounded-sm object-cover"
          />
          <span class="truncate">{{ reference.item?.name ?? '…' }}</span>
          <ChevronDownIcon data-icon="inline-end" class="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-96" :side-offset="8" aria-label="Referenzbild wählen">
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="item in reference.recent.slice(0, CHOICES)"
            :key="item.path"
            type="button"
            :aria-label="item.name"
            :aria-pressed="item.path === reference.path"
            :title="item.project ? `${item.project} / ${item.name}` : item.name"
            :class="
              cn(
                'aspect-video overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10 transition outline-none hover:ring-foreground/40 focus-visible:ring-2 focus-visible:ring-ring',
                item.path === reference.path && 'ring-2 ring-primary hover:ring-primary'
              )
            "
            @click="pick(item.path)"
          >
            <img :src="item.thumbUrl" alt="" class="size-full object-cover" loading="lazy" />
          </button>
        </div>
        <p class="text-xs text-muted-foreground">
          Die neuesten Bilder. Jedes andere: in der Galerie per Rechtsklick → „Als Referenz
          einblenden“.
        </p>
      </PopoverContent>
    </Popover>

    <Slider
      class="w-28"
      aria-label="Deckkraft des Referenzbilds"
      :min="0.1"
      :max="1"
      :step="0.05"
      :model-value="[reference.opacity]"
      @update:model-value="(v) => v?.length && (reference.opacity = v[0])"
    />

    <ToggleGroup
      type="single"
      size="sm"
      :spacing="0.5"
      :class="SEGMENTED_GROUP"
      aria-label="Darstellung des Referenzbilds"
      :model-value="reference.mode"
      @update:model-value="pickMode"
    >
      <!-- The hints inside the items: around them, the tooltip's state would replace theirs. -->
      <ToggleGroupItem value="blend" :class="SEGMENTED_ITEM">
        <HintTooltip label="Halb durchsichtig über dem Livebild">
          <span>Überblenden</span>
        </HintTooltip>
      </ToggleGroupItem>
      <ToggleGroupItem value="difference" :class="SEGMENTED_ITEM">
        <HintTooltip label="Was übereinanderliegt, wird schwarz – zum genauen Ausrichten">
          <span>Differenz</span>
        </HintTooltip>
      </ToggleGroupItem>
    </ToggleGroup>

    <div class="flex items-center gap-2">
      <Switch id="reference-drawing" v-model="reference.drawing" size="sm" />
      <Label for="reference-drawing" class="font-normal">Zeichnung</Label>
    </div>

    <HintTooltip label="Referenzbild ausblenden">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Referenzbild ausblenden"
        @click="reference.hide()"
      >
        <XIcon />
      </Button>
    </HintTooltip>
  </div>
</template>

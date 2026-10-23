<script setup lang="ts">
import { computed, ref } from 'vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { ToggleGroupItem } from '@/components/ui/toggle-group'
import { SHAPE_TOOLS, usesFill, type ShapeTool } from '@/editor/tools'
import { cn } from '@/lib/utils'
import { useEditorStore } from '@/stores/editor'
import { ACTIVE_TOGGLE } from './toggle'

/**
 * Line, arrow, rectangle and ellipse as one item of the tool group – like the colour: a click
 * picks the shape used last and shows all of them, with the fill for new shapes.
 */
const editor = useEditorStore()

const open = ref(false)
const anchor = ref<HTMLElement | null>(null)

const current = computed(
  () => SHAPE_TOOLS.find((shape) => shape.id === editor.shapeTool) ?? SHAPE_TOOLS[0]
)
/** The icon is drawn filled while new rectangles / ellipses are filled. */
const filledIcon = computed(() => editor.filled && usesFill(current.value.id))

function pick(shape: ShapeTool): void {
  editor.tool = shape
  open.value = false
}

function onInteractOutside(e: Event): void {
  // A click on the item itself toggles the choice – it must not close and reopen it.
  if (anchor.value?.contains(e.target as Node)) e.preventDefault()
}
</script>

<template>
  <Popover v-model:open="open">
    <!-- Own anchor outside the tooltip: inside it, the popover would open off-screen. -->
    <PopoverAnchor as-child>
      <div ref="anchor" class="flex">
        <HintTooltip :label="`Formen · ${current.label}`" :shortcut="[current.shortcut]">
          <!-- The value is the shape used last: picking the item picks that tool. -->
          <ToggleGroupItem
            :value="current.id"
            aria-label="Formen"
            aria-haspopup="dialog"
            :aria-expanded="open"
            :class="cn('relative', ACTIVE_TOGGLE)"
            @click="open = !open"
          >
            <component :is="current.icon" :class="filledIcon && 'fill-current'" />
            <!-- Corner mark: there is more to choose. -->
            <span
              class="pointer-events-none absolute right-1 bottom-1 size-1.5 bg-current opacity-60 [clip-path:polygon(100%_0,100%_100%,0_100%)]"
            />
          </ToggleGroupItem>
        </HintTooltip>
      </div>
    </PopoverAnchor>

    <PopoverContent
      class="w-64"
      :side-offset="10"
      aria-label="Formen"
      @interact-outside="onInteractOutside"
    >
      <div class="flex flex-col gap-0.5" role="group" aria-label="Form">
        <Button
          v-for="shape in SHAPE_TOOLS"
          :key="shape.id"
          variant="ghost"
          :aria-pressed="editor.shapeTool === shape.id"
          :class="cn('justify-start', ACTIVE_TOGGLE)"
          @click="pick(shape.id as ShapeTool)"
        >
          <component :is="shape.icon" data-icon="inline-start" />
          {{ shape.label }}
          <Kbd class="ml-auto">{{ shape.shortcut }}</Kbd>
        </Button>
      </div>
      <Separator />
      <div class="flex items-center justify-between gap-3 px-2.5 pb-0.5">
        <Label for="shape-filled" class="flex-col items-start gap-0.5 font-normal">
          Füllen
          <span class="text-xs text-muted-foreground">Neue Rechtecke und Ellipsen</span>
        </Label>
        <Switch id="shape-filled" v-model="editor.filled" />
      </div>
    </PopoverContent>
  </Popover>
</template>

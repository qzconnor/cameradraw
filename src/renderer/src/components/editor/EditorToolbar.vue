<script setup lang="ts">
import { computed } from 'vue'
import type { AcceptableValue } from 'reka-ui'
import { PaintBucketIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Separator } from '@/components/ui/separator'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  FONT_SIZE_PRESETS,
  STROKE_PRESETS,
  TOOL_GROUPS,
  TOOLS,
  usesFill,
  type Tool
} from '@/editor/tools'
import { useEditorStore } from '@/stores/editor'
import ColorPicker from './ColorPicker.vue'
import SizePicker from './SizePicker.vue'
import { ACTIVE_TOGGLE } from './toggle'

const editor = useEditorStore()

/** The toggle is for new rectangles / ellipses; existing ones are filled via the context menu. */
const fillAvailable = computed(() => usesFill(editor.tool))

function onToolChange(value: AcceptableValue): void {
  // Clicking the active item would deselect it – a tool must always be active.
  if (typeof value === 'string' && TOOLS.some((t) => t.id === value)) editor.tool = value as Tool
}
</script>

<template>
  <div class="glass-panel flex items-center gap-1 p-1.5">
    <ToggleGroup
      type="single"
      :spacing="1"
      :model-value="editor.tool"
      aria-label="Werkzeug"
      @update:model-value="onToolChange"
    >
      <template v-for="(group, index) in TOOL_GROUPS" :key="index">
        <Separator v-if="index > 0" orientation="vertical" class="mx-1 my-auto h-5" />
        <HintTooltip
          v-for="tool in group"
          :key="tool.id"
          :label="tool.label"
          :shortcut="[tool.shortcut]"
        >
          <ToggleGroupItem :value="tool.id" :aria-label="tool.label" :class="ACTIVE_TOGGLE">
            <component :is="tool.icon" />
          </ToggleGroupItem>
        </HintTooltip>
      </template>
    </ToggleGroup>

    <Separator orientation="vertical" class="mx-1 my-auto h-5" />

    <ColorPicker v-model="editor.color" />

    <SizePicker
      v-if="editor.tool === 'text'"
      v-model="editor.fontSize"
      kind="font"
      :options="FONT_SIZE_PRESETS"
    />
    <SizePicker v-else v-model="editor.strokeWidth" kind="stroke" :options="STROKE_PRESETS" />

    <!-- Always there, only disabled when there is nothing to fill: the toolbar is right-aligned,
         so a change of its width would move all tool buttons away under the pointer. -->
    <Separator orientation="vertical" class="mx-1 my-auto h-5" />
    <HintTooltip label="Neue Formen füllen">
      <Toggle
        v-model="editor.filled"
        aria-label="Neue Formen füllen"
        :disabled="!fillAvailable"
        :class="ACTIVE_TOGGLE"
      >
        <PaintBucketIcon />
      </Toggle>
    </HintTooltip>
  </div>
</template>

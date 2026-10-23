<script setup lang="ts">
import type { AcceptableValue } from 'reka-ui'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  FONT_SIZE_PRESETS,
  SHAPE_TOOLS,
  STROKE_PRESETS,
  TOOL_GROUPS,
  TOOLS,
  type Tool
} from '@/editor/tools'
import { useEditorStore } from '@/stores/editor'
import ColorPicker from './ColorPicker.vue'
import ShapeToolPicker from './ShapeToolPicker.vue'
import SizePicker from './SizePicker.vue'
import { ACTIVE_TOGGLE } from './toggle'

const editor = useEditorStore()

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
        <ShapeToolPicker v-if="group === SHAPE_TOOLS" />
        <template v-else>
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
  </div>
</template>

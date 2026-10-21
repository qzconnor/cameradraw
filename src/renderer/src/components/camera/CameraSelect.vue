<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import type { AcceptableValue } from 'reka-ui'
import { RefreshCwIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { CameraConnection } from '@/lib/camera-info'
import { cn } from '@/lib/utils'
import { useCameraStore } from '@/stores/camera'
import { useHardwareStore } from '@/stores/hardware'
import CameraConnectionIcon from './CameraConnectionIcon.vue'
import CameraStatusDot from './CameraStatusDot.vue'

const props = withDefaults(
  defineProps<{ size?: 'sm' | 'default'; class?: HTMLAttributes['class'] }>(),
  { size: 'default' }
)

const camera = useCameraStore()
const hardware = useHardwareStore()

/** Connected cameras plus the chosen one while it is disconnected (so the selection stays visible). */
const options = computed(() => {
  const list = camera.devices.map((d) => ({ ...d, missing: false }))
  if (camera.selectedMissing && camera.selectedId) {
    list.unshift({
      id: camera.selectedId,
      label: camera.selectedLabel ?? 'Unbekannte Kamera',
      missing: true
    })
  }
  return list.map((o) => ({ ...o, connection: hardware.connectionOf(o.label) }))
})

/** Physical cameras first, then virtual ones – each group only if it has entries. */
const GROUPS: { label: string; kinds: CameraConnection[] }[] = [
  { label: 'Angeschlossen', kinds: ['usb', 'physical'] },
  { label: 'Virtuell', kinds: ['virtual'] },
  { label: 'Weitere Kameras', kinds: ['unknown'] }
]
const groups = computed(() =>
  GROUPS.map((g) => ({
    label: g.label,
    options: options.value.filter((o) => g.kinds.includes(o.connection))
  })).filter((g) => g.options.length)
)

function onSelect(value: AcceptableValue): void {
  if (typeof value === 'string' && value !== camera.selectedId) void camera.select(value)
}

async function reload(): Promise<void> {
  await camera.refresh()
  const count = camera.devices.length
  toast('Kameraliste aktualisiert', {
    description:
      count === 0
        ? 'Keine Kamera gefunden.'
        : `${count} ${count === 1 ? 'Kamera' : 'Kameras'} gefunden.`
  })
}
</script>

<template>
  <ButtonGroup :class="cn('min-w-0', props.class)">
    <Select :model-value="camera.selectedId ?? undefined" @update:model-value="onSelect">
      <SelectTrigger :size="props.size" class="min-w-0 flex-1" aria-label="Kamera auswählen">
        <!-- Grouped so the trigger's justify-between keeps the label left-aligned. -->
        <span class="flex min-w-0 items-center gap-2">
          <CameraStatusDot :status="camera.status" />
          <SelectValue
            :placeholder="camera.devices.length ? 'Kamera wählen' : 'Keine Kamera gefunden'"
            class="truncate"
          />
        </span>
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <template v-for="(group, index) in groups" :key="group.label">
          <SelectSeparator v-if="index > 0" />
          <SelectGroup>
            <SelectLabel>{{ group.label }}</SelectLabel>
            <!-- The key includes `missing`: reka-ui caches an item's text on mount, so a
                 disconnected → connected change needs a fresh item, not a patched one. -->
            <SelectItem
              v-for="option in group.options"
              :key="`${option.id}:${option.missing}`"
              :value="option.id"
              :disabled="option.missing"
            >
              <CameraConnectionIcon :connection="option.connection" />
              {{ option.missing ? `${option.label} (getrennt)` : option.label }}
            </SelectItem>
          </SelectGroup>
        </template>
        <SelectGroup v-if="!options.length">
          <SelectItem value="__none" disabled>Keine Kamera gefunden</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>

    <HintTooltip label="Kameraliste neu laden">
      <Button
        variant="outline"
        :size="props.size === 'sm' ? 'icon-sm' : 'icon'"
        aria-label="Kameraliste neu laden"
        :disabled="camera.refreshing"
        @click="reload"
      >
        <RefreshCwIcon :class="cn(camera.refreshing && 'animate-spin')" />
      </Button>
    </HintTooltip>
  </ButtonGroup>
</template>

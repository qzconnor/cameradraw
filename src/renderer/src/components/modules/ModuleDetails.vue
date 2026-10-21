<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheckIcon, CpuIcon, HourglassIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Badge } from '@/components/ui/badge'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet
} from '@/components/ui/field'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { formatUsbId } from '@/lib/camera-info'
import { errorMessage } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CapabilityStatus, DeviceModule } from '@/modules'
import { useModulesStore } from '@/stores/modules'
import ButtonServiceStatus from './ButtonServiceStatus.vue'
import { USAGE } from './usage'

const props = defineProps<{ module: DeviceModule }>()

const modules = useModulesStore()

const enabled = computed(() => modules.isEnabled(props.module.id))
const usage = computed(() => modules.usageOf(props.module.id))
const needsButtonService = computed(() =>
  props.module.capabilities.some((c) => c.requiresButtonService)
)

const usageText = computed(() => {
  if (usage.value === 'in-use') return `Wird gerade für „${modules.currentLabel}“ verwendet.`
  if (usage.value === 'off') return 'Ausgeschaltet – wird für keine Kamera verwendet.'
  const ids = props.module.match.map(formatUsbId).join(', ')
  return `Wird automatisch für Kameras mit USB-ID ${ids} verwendet.`
})

const CAPABILITY: Record<CapabilityStatus, { icon: typeof CpuIcon; tone: string; label: string }> =
  {
    supported: { icon: CircleCheckIcon, tone: 'text-success', label: 'Unterstützt' },
    device: { icon: CpuIcon, tone: 'text-muted-foreground', label: 'Im Gerät' },
    planned: { icon: HourglassIcon, tone: 'text-warning', label: 'Folgt' }
  }

async function toggle(value: boolean): Promise<void> {
  try {
    await modules.setEnabled(props.module.id, value)
  } catch (err) {
    toast.error('Modul konnte nicht umgeschaltet werden', { description: errorMessage(err) })
  }
}
</script>

<!-- Settings of one device module: on/off, what it can do, background service. -->
<template>
  <FieldGroup>
    <Item variant="muted">
      <ItemMedia variant="icon">
        <component :is="module.icon" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {{ module.name }}
          <Badge :variant="USAGE[usage].variant">{{ USAGE[usage].label }}</Badge>
        </ItemTitle>
        <ItemDescription>{{ module.description }}</ItemDescription>
      </ItemContent>
    </Item>

    <Field orientation="horizontal">
      <FieldContent>
        <!-- Clicking the label toggles the switch. -->
        <FieldLabel for="module-enabled" class="cursor-pointer">Modul eingeschaltet</FieldLabel>
        <FieldDescription>{{ usageText }}</FieldDescription>
      </FieldContent>
      <Switch
        id="module-enabled"
        class="self-center"
        :model-value="enabled"
        @update:model-value="toggle"
      />
    </Field>

    <FieldSeparator />

    <FieldSet>
      <FieldLegend>Funktionen</FieldLegend>
      <ul class="flex flex-col gap-3 text-sm">
        <li v-for="capability in module.capabilities" :key="capability.label" class="flex gap-2">
          <component
            :is="CAPABILITY[capability.status].icon"
            :class="cn('mt-0.5 size-4 shrink-0', CAPABILITY[capability.status].tone)"
            :aria-label="CAPABILITY[capability.status].label"
            role="img"
          />
          <p class="text-muted-foreground">
            <span class="font-medium text-foreground">{{ capability.label }}</span>
            <span class="mx-1">·</span>
            <span :class="CAPABILITY[capability.status].tone">
              {{ CAPABILITY[capability.status].label }}
            </span>
            <br />
            {{ capability.detail }}
          </p>
        </li>
      </ul>
    </FieldSet>

    <template v-if="needsButtonService && enabled">
      <FieldSeparator />
      <ButtonServiceStatus />
    </template>
  </FieldGroup>
</template>

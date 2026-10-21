<script setup lang="ts">
import { computed } from 'vue'
import { CameraIcon, ChevronRightIcon } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemHeader,
  ItemTitle
} from '@/components/ui/item'
import { formatUsbId } from '@/lib/camera-info'
import type { DeviceModule } from '@/modules'
import { useModulesStore } from '@/stores/modules'
import { USAGE } from './usage'

const props = defineProps<{ module: DeviceModule }>()
defineEmits<{ open: [] }>()

const modules = useModulesStore()
const usage = computed(() => modules.usageOf(props.module.id))
</script>

<!-- Tile in the module overview: shows whether the module is in use; opens its settings. -->
<template>
  <Item
    as="button"
    type="button"
    variant="outline"
    :data-usage="usage"
    class="flex-col flex-nowrap items-stretch gap-3 text-left hover:bg-muted/50 data-[usage=in-use]:border-primary/40 data-[usage=in-use]:bg-muted/40 data-[usage=off]:opacity-60"
    @click="$emit('open')"
  >
    <!-- basis-auto: header/footer default to a full row, which is a full column height here. -->
    <ItemHeader class="basis-auto">
      <div class="grid size-9 place-items-center rounded-lg bg-muted">
        <component :is="module.icon" class="size-5" />
      </div>
      <Badge :variant="USAGE[usage].variant">{{ USAGE[usage].label }}</Badge>
    </ItemHeader>
    <ItemContent>
      <ItemTitle>{{ module.shortName }}</ItemTitle>
      <ItemDescription>{{ module.name }}</ItemDescription>
    </ItemContent>
    <ItemFooter class="mt-auto basis-auto text-xs text-muted-foreground">
      <span v-if="usage === 'in-use'" class="flex min-w-0 items-center gap-1.5">
        <CameraIcon class="size-3.5 shrink-0" />
        <span class="truncate">{{ modules.currentLabel }}</span>
      </span>
      <span v-else class="truncate">USB-ID {{ module.match.map(formatUsbId).join(', ') }}</span>
      <ChevronRightIcon class="size-3.5 shrink-0" />
    </ItemFooter>
  </Item>
</template>

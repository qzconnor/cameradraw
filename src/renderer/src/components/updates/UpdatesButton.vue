<script setup lang="ts">
import { computed } from 'vue'
import { CircleArrowDownIcon, SparklesIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import { usePanelsStore } from '@/stores/panels'
import { useUpdatesStore } from '@/stores/updates'

/**
 * Opens the updates panel. With an update waiting it becomes a filled "Update" button with a
 * pulsing dot, after an update a dot marks the release notes that are still unread.
 */
const updates = useUpdatesStore()
const panels = usePanelsStore()
const open = computed(() => panels.isOpen('updates'))

const label = computed(() =>
  updates.hasUpdate
    ? `Version ${updates.state.next} ist verfügbar`
    : updates.unseen
      ? `Neu in Version ${updates.state.current}`
      : 'Updates und Versionshinweise'
)
</script>

<template>
  <HintTooltip :label="label">
    <!-- data-panel-toggle: the side panel ignores "outside clicks" on its own toggle. -->
    <Button
      v-if="updates.hasUpdate"
      size="sm"
      class="relative"
      data-panel-toggle="updates"
      :aria-expanded="open"
      @click="panels.toggle('updates')"
    >
      <CircleArrowDownIcon data-icon="inline-start" />
      Update
      <span class="absolute -top-1 -right-1 flex size-2.5">
        <span class="absolute size-full animate-ping rounded-full bg-success opacity-75" />
        <span class="relative size-2.5 rounded-full bg-success ring-2 ring-sidebar" />
      </span>
    </Button>
    <Button
      v-else
      variant="ghost"
      size="icon-sm"
      class="relative"
      :aria-label="label"
      data-panel-toggle="updates"
      :aria-expanded="open"
      @click="panels.toggle('updates')"
    >
      <SparklesIcon />
      <span
        v-if="updates.unseen"
        class="absolute top-1 right-1 size-2 rounded-full bg-success ring-2 ring-sidebar"
      />
    </Button>
  </HintTooltip>
</template>

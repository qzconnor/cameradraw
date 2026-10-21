<script setup lang="ts">
import { ArrowDownUpIcon } from '@lucide/vue'
import { storeToRefs } from 'pinia'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { DateFilter, SortDirection, SortKey } from '@/lib/gallery'
import { useGalleryStore } from '@/stores/gallery'

/** Sort order and date filter of the gallery. */
const gallery = useGalleryStore()
const { sortKey, sortDirection, projectsFirst, dateFilter } = storeToRefs(gallery)

const SORT_KEYS: { value: SortKey; label: string }[] = [
  { value: 'date', label: 'Datum' },
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'Größe' }
]
const DIRECTIONS: Record<SortKey, { value: SortDirection; label: string }[]> = {
  date: [
    { value: 'desc', label: 'Neueste zuerst' },
    { value: 'asc', label: 'Älteste zuerst' }
  ],
  name: [
    { value: 'asc', label: 'A → Z' },
    { value: 'desc', label: 'Z → A' }
  ],
  size: [
    { value: 'desc', label: 'Größte zuerst' },
    { value: 'asc', label: 'Kleinste zuerst' }
  ]
}
const PERIODS: { value: DateFilter; label: string }[] = [
  { value: 'all', label: 'Alle' },
  { value: 'today', label: 'Heute' },
  { value: 'week', label: 'Letzte 7 Tage' },
  { value: 'month', label: 'Letzte 30 Tage' }
]

/** Keeps the menu open, so the list can be watched re-sorting and several options changed. */
const keepOpen = (event: Event): void => event.preventDefault()
</script>

<template>
  <DropdownMenu>
    <!-- No HintTooltip around the trigger: nested in one, the menu loses its anchor and opens
         off-screen. -->
    <DropdownMenuTrigger as-child>
      <Button variant="outline" size="icon" aria-label="Sortieren und filtern" class="relative">
        <ArrowDownUpIcon />
        <!-- Marks an active date filter, which otherwise hides images unnoticed. -->
        <span
          v-if="dateFilter !== 'all'"
          class="absolute -top-1 -right-1 size-2.5 rounded-full bg-primary ring-2 ring-popover"
        />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-52">
      <DropdownMenuGroup>
        <DropdownMenuLabel>Sortieren nach</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          :model-value="sortKey"
          @update:model-value="gallery.setSortKey($event as SortKey)"
        >
          <DropdownMenuRadioItem
            v-for="option in SORT_KEYS"
            :key="option.value"
            :value="option.value"
            @select="keepOpen"
          >
            {{ option.label }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Reihenfolge</DropdownMenuLabel>
        <DropdownMenuRadioGroup v-model="sortDirection">
          <DropdownMenuRadioItem
            v-for="option in DIRECTIONS[sortKey]"
            :key="option.value"
            :value="option.value"
            @select="keepOpen"
          >
            {{ option.label }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuCheckboxItem v-model="projectsFirst" @select="keepOpen">
          Projekte oben
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Zeitraum</DropdownMenuLabel>
        <DropdownMenuRadioGroup v-model="dateFilter">
          <DropdownMenuRadioItem
            v-for="option in PERIODS"
            :key="option.value"
            :value="option.value"
            @select="keepOpen"
          >
            {{ option.label }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

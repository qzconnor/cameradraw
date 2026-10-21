<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BlocksIcon, ChevronLeftIcon } from '@lucide/vue'
import SidePanel from '@/components/common/SidePanel.vue'
import { Button } from '@/components/ui/button'
import { FieldDescription, FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { findModule } from '@/modules'
import { useModulesStore } from '@/stores/modules'
import { usePanelsStore } from '@/stores/panels'
import CameraModuleField from './CameraModuleField.vue'
import ModuleDetails from './ModuleDetails.vue'
import ModuleTile from './ModuleTile.vue'

const modules = useModulesStore()
const panels = usePanelsStore()

/** Module whose settings are shown; null = tile overview. */
const selectedId = ref<string | null>(null)
const selected = computed(() => (selectedId.value ? (findModule(selectedId.value) ?? null) : null))

// Every time the panel opens, start with the overview.
watch(
  () => panels.isOpen('modules'),
  (open) => {
    if (open) selectedId.value = null
  }
)
</script>

<!-- Side panel: device modules as tiles; a tile opens the module's settings. -->
<template>
  <SidePanel name="modules">
    <SheetHeader class="h-13 flex-row items-center gap-2 border-b py-0 pr-12 pl-4">
      <Button
        v-if="selected"
        variant="ghost"
        size="icon-sm"
        class="-ml-1.5"
        aria-label="Zurück zur Übersicht"
        @click="selectedId = null"
      >
        <ChevronLeftIcon />
      </Button>
      <BlocksIcon v-else class="size-4 text-muted-foreground" />
      <SheetTitle class="truncate">{{ selected?.shortName ?? 'Geräte-Module' }}</SheetTitle>
      <SheetDescription class="sr-only">
        Module ergänzen Funktionen für bestimmte Geräte.
      </SheetDescription>
    </SheetHeader>

    <ScrollArea class="min-h-0 flex-1">
      <div class="p-4">
        <ModuleDetails v-if="selected" :module="selected" />
        <FieldGroup v-else>
          <CameraModuleField />
          <FieldSet>
            <FieldLegend>Module</FieldLegend>
            <FieldDescription>
              Module ergänzen Funktionen für bestimmte Geräte. Antippen zeigt die Einstellungen.
            </FieldDescription>
            <div class="grid grid-cols-2 gap-3">
              <ModuleTile
                v-for="module in modules.modules"
                :key="module.id"
                :module="module"
                @open="selectedId = module.id"
              />
            </div>
          </FieldSet>
        </FieldGroup>
      </div>
    </ScrollArea>
  </SidePanel>
</template>

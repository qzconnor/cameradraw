<script setup lang="ts">
import { computed } from 'vue'
import type { AcceptableValue } from 'reka-ui'
import { toast } from 'vue-sonner'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
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
import { errorMessage } from '@/lib/format'
import { useModulesStore } from '@/stores/modules'

const modules = useModulesStore()

const label = computed(() => modules.currentLabel)
const assignment = computed(() => (label.value ? modules.assignmentFor(label.value) : 'auto'))
const autoName = computed(() =>
  label.value ? (modules.autoModuleFor(label.value)?.name ?? 'kein passendes Modul') : '–'
)
const assigned = computed(() => (label.value ? modules.assignedModule(label.value) : null))

async function onChange(value: AcceptableValue): Promise<void> {
  if (!label.value || typeof value !== 'string') return
  try {
    await modules.assign(label.value, value)
  } catch (err) {
    toast.error('Zuordnung konnte nicht gespeichert werden', { description: errorMessage(err) })
  }
}
</script>

<template>
  <Field>
    <FieldLabel for="camera-module">Modul für diese Kamera</FieldLabel>
    <Select :model-value="assignment" :disabled="!label" @update:model-value="onChange">
      <SelectTrigger id="camera-module" class="w-full">
        <SelectValue placeholder="Keine Kamera gewählt" />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectGroup>
          <!-- Keyed by the detected module: reka-ui caches item texts when they mount. -->
          <SelectItem :key="`auto:${autoName}`" value="auto"
            >Automatisch – {{ autoName }}</SelectItem
          >
          <SelectItem value="none">Kein Modul</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Module</SelectLabel>
          <SelectItem v-for="module in modules.modules" :key="module.id" :value="module.id">
            {{ module.name }}
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
    <FieldDescription v-if="label">
      Gilt für „{{ label }}“. Automatisch erkennt Geräte an ihrer USB-ID.
      <template v-if="assigned && !modules.isEnabled(assigned.id)">
        Das Modul „{{ assigned.name }}“ ist gerade ausgeschaltet.
      </template>
    </FieldDescription>
  </Field>
</template>

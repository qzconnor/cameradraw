<script setup lang="ts">
import { FolderIcon } from '@lucide/vue'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group'

const props = defineProps<{
  modelValue: string | null
  id?: string
  invalid?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

async function browse(): Promise<void> {
  const dir = await window.api.pickFolder(props.modelValue)
  if (dir) emit('update:modelValue', dir)
}
</script>

<template>
  <InputGroup>
    <InputGroupAddon>
      <FolderIcon />
    </InputGroupAddon>
    <InputGroupInput
      :id="id"
      :model-value="modelValue ?? ''"
      readonly
      placeholder="Kein Ordner gewählt"
      :aria-invalid="invalid || undefined"
      class="cursor-pointer truncate"
      @click="browse"
    />
    <InputGroupAddon align="inline-end">
      <InputGroupButton variant="secondary" @click="browse">Durchsuchen …</InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
</template>

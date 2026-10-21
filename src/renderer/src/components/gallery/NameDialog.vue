<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { nameError, sameName } from '@shared/names'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'

/** Asks for a name – of a new project, or a new one for a project or image (`initial`). */
const props = defineProps<{
  title: string
  description: string
  confirmLabel: string
  /** Current name when renaming. */
  initial?: string
  /** Fixed ending shown after the input, e.g. the file extension `.png`. */
  suffix?: string
  placeholder?: string
  /** Why a (valid) name cannot be used, e.g. because it is taken – or null. */
  taken?: (name: string) => string | null
  busy?: boolean
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ confirm: [name: string] }>()

const input = useTemplateRef<InstanceType<typeof InputGroupInput>>('input')

const name = ref('')
/** The empty-name hint only shows after trying to confirm. */
const submitted = ref(false)

watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    name.value = props.initial ?? ''
    submitted.value = false
  },
  { immediate: true }
)

const trimmed = computed(() => name.value.trim())
const problem = computed(() => {
  if (!trimmed.value) return submitted.value ? 'Bitte gib einen Namen ein.' : null
  const invalid = nameError(trimmed.value)
  if (invalid) return invalid
  // Renaming may change the case of the own name.
  if (props.initial !== undefined && sameName(props.initial, trimmed.value)) return null
  return props.taken?.(trimmed.value) ?? null
})

function submit(): void {
  submitted.value = true
  if (props.busy || !trimmed.value || problem.value) return
  if (trimmed.value === props.initial) open.value = false
  else emit('confirm', trimmed.value)
}

/** Focus the name with everything selected, so typing replaces it. */
function focusInput(event: Event): void {
  event.preventDefault()
  const el = input.value?.$el as HTMLInputElement | undefined
  el?.focus()
  el?.select()
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-sm" @open-auto-focus="focusInput">
      <form class="contents" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>{{ title }}</DialogTitle>
          <DialogDescription>{{ description }}</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field :data-invalid="!!problem || undefined">
            <FieldLabel for="gallery-name">Name</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="gallery-name"
                ref="input"
                v-model="name"
                :placeholder="placeholder"
                autocomplete="off"
                spellcheck="false"
                :aria-invalid="!!problem || undefined"
              />
              <InputGroupAddon v-if="suffix" align="inline-end">
                <InputGroupText>{{ suffix }}</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldError v-if="problem">{{ problem }}</FieldError>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <DialogClose as-child>
            <Button type="button" variant="outline">Abbrechen</Button>
          </DialogClose>
          <Button type="submit" :disabled="busy">
            <Spinner v-if="busy" data-icon="inline-start" />
            {{ confirmLabel }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

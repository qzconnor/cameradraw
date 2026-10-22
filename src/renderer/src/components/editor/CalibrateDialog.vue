<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { RulerIcon } from '@lucide/vue'
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

/**
 * Sets the scale from a measuring line drawn over a known distance, e.g. a few millimetres of a
 * ruler: the user enters how long it really is.
 */
const props = defineProps<{
  /** Length of the measuring line in image pixels. */
  pixels: number
  /** Camera the picture is from – its calibration can be kept for new pictures. */
  cameraLabel: string | null
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ confirm: [micronsPerPixel: number, remember: boolean] }>()

const UNITS = { mm: 1000, µm: 1 } as const
type Unit = keyof typeof UNITS

const input = useTemplateRef<InstanceType<typeof Input>>('input')
const length = ref('')
const unit = ref<Unit>('mm')
const remember = ref(true)
/** The empty-field hint only shows after trying to confirm. */
const submitted = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  length.value = ''
  submitted.value = false
  remember.value = true
})

/** German decimals are fine: `2,5` as well as `2.5`. */
const value = computed(() => Number(length.value.trim().replace(',', '.')))

const problem = computed(() => {
  if (!length.value.trim()) return submitted.value ? 'Bitte gib die Länge ein.' : null
  return Number.isFinite(value.value) && value.value > 0
    ? null
    : 'Bitte gib eine Zahl größer als 0 ein, z. B. 5 oder 2,5.'
})

function submit(): void {
  submitted.value = true
  if (problem.value || !length.value.trim()) return
  emit('confirm', (value.value * UNITS[unit.value]) / props.pixels, remember.value)
  open.value = false
}

function focusLength(event: Event): void {
  event.preventDefault()
  ;(input.value?.$el as HTMLInputElement | undefined)?.focus()
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md" @open-auto-focus="focusLength">
      <form class="contents" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>Maßstab festlegen</DialogTitle>
          <DialogDescription>
            Wie lang ist die gemessene Strecke in Wirklichkeit? Am genauesten wird es über mehrere
            Millimeter eines Lineals.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field :data-invalid="!!problem || undefined">
            <FieldLabel for="calibrate-length">Länge der Strecke</FieldLabel>
            <div class="flex gap-2">
              <Input
                id="calibrate-length"
                ref="input"
                v-model="length"
                inputmode="decimal"
                autocomplete="off"
                placeholder="z. B. 5"
                :aria-invalid="!!problem || undefined"
              />
              <Select v-model="unit">
                <SelectTrigger class="w-24" aria-label="Einheit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="(_, name) in UNITS" :key="name" :value="name">
                    {{ name }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <FieldError v-if="problem">{{ problem }}</FieldError>
            <FieldDescription v-else>
              <RulerIcon class="inline size-3.5 align-[-2px]" />
              Gemessen: {{ Math.round(pixels) }} Pixel
            </FieldDescription>
          </Field>

          <Field v-if="cameraLabel" orientation="horizontal">
            <FieldContent>
              <!-- Clicking the label toggles the switch. -->
              <FieldLabel for="calibrate-remember" class="cursor-pointer">
                Für neue Aufnahmen merken
              </FieldLabel>
              <FieldDescription>
                Gilt für „{{ cameraLabel }}“, solange Vergrößerung und Abstand gleich bleiben.
              </FieldDescription>
            </FieldContent>
            <Switch id="calibrate-remember" v-model="remember" class="self-center" />
          </Field>
        </FieldGroup>

        <DialogFooter>
          <DialogClose as-child>
            <Button type="button" variant="outline">Abbrechen</Button>
          </DialogClose>
          <Button type="submit">Übernehmen</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

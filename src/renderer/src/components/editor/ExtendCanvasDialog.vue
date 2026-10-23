<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ImageUpscaleIcon } from '@lucide/vue'
import type { ImageAdjustment } from '@shared/types'
import { SEGMENTED_GROUP, SEGMENTED_ITEM } from '@/components/common/segmented'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { MAX_SIDE } from '@/editor/adjust'
import ColorPicker from './ColorPicker.vue'

/** Asks where and how much space to add around the picture, e.g. for notes beside it. */
const props = defineProps<{ imageSize: { width: number; height: number } }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ extend: [adjustment: Extract<ImageAdjustment, { type: 'extend' }>] }>()

type Side = 'top' | 'right' | 'bottom' | 'left'

const SIDES: { value: Side; label: string }[] = [
  { value: 'top', label: 'Oben' },
  { value: 'right', label: 'Rechts' },
  { value: 'bottom', label: 'Unten' },
  { value: 'left', label: 'Links' }
]
/** Share of the picture's width (left/right) or height (top/bottom). */
const PRESETS = [0.25, 0.5, 1]

const side = ref<Side>('right')
const amount = ref('')
const color = ref('#ffffff')

/** Along the side: the width for left and right, the height for top and bottom. */
const across = computed(() =>
  side.value === 'left' || side.value === 'right' ? props.imageSize.width : props.imageSize.height
)

function preset(share: number): void {
  amount.value = String(Math.round(across.value * share))
}

// A fresh start every time: half of the picture to the right.
watch(open, (isOpen) => {
  if (!isOpen) return
  side.value = 'right'
  color.value = '#ffffff'
  preset(0.5)
})

// Another side: the same share of the picture there.
watch(side, (_value, previous) => {
  const before =
    previous === 'left' || previous === 'right' ? props.imageSize.width : props.imageSize.height
  const share = Number(amount.value) / before
  if (Number.isFinite(share) && share > 0) preset(share)
})

const pixels = computed(() => Number(amount.value))
const result = computed(() => {
  const { width, height } = props.imageSize
  const add = Number.isInteger(pixels.value) ? pixels.value : 0
  return side.value === 'left' || side.value === 'right'
    ? { width: width + add, height }
    : { width, height: height + add }
})
const problem = computed(() => {
  if (!Number.isInteger(pixels.value) || pixels.value < 1)
    return 'Bitte eine ganze Zahl ab 1 eingeben.'
  if (Math.max(result.value.width, result.value.height) > MAX_SIDE) {
    return `Das Bild darf höchstens ${MAX_SIDE} Pixel breit und hoch werden.`
  }
  return null
})

function submit(): void {
  if (problem.value) return
  emit('extend', {
    type: 'extend',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    [side.value]: pixels.value,
    color: color.value
  })
  open.value = false
}

const percent = (share: number): string => `${Math.round(share * 100)} %`
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <form class="contents" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>Fläche anfügen</DialogTitle>
          <DialogDescription>
            Erweitert das Bild um eine einfarbige Fläche, z. B. für Beschriftungen daneben. Das
            Original bleibt erhalten.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel>Seite</FieldLabel>
            <ToggleGroup
              type="single"
              size="sm"
              :spacing="0.5"
              :class="['w-full', SEGMENTED_GROUP]"
              aria-label="Seite"
              :model-value="side"
              @update:model-value="(value) => value && (side = value as Side)"
            >
              <ToggleGroupItem
                v-for="option in SIDES"
                :key="option.value"
                :value="option.value"
                :class="['flex-1', SEGMENTED_ITEM]"
              >
                {{ option.label }}
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <Field :data-invalid="!!problem || undefined">
            <FieldLabel for="extend-amount">
              {{ side === 'left' || side === 'right' ? 'Breite' : 'Höhe' }}
            </FieldLabel>
            <div class="flex gap-2">
              <InputGroup>
                <InputGroupInput
                  id="extend-amount"
                  v-model="amount"
                  inputmode="numeric"
                  autocomplete="off"
                  class="tabular-nums"
                  :aria-invalid="!!problem || undefined"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>px</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <ButtonGroup>
                <Button
                  v-for="share in PRESETS"
                  :key="share"
                  type="button"
                  variant="outline"
                  :aria-label="`${percent(share)} des Bildes`"
                  @click="preset(share)"
                >
                  {{ percent(share) }}
                </Button>
              </ButtonGroup>
            </div>
            <FieldError v-if="problem">{{ problem }}</FieldError>
            <FieldDescription v-else class="tabular-nums">
              {{ imageSize.width }} × {{ imageSize.height }} → {{ result.width }} ×
              {{ result.height }} Pixel
            </FieldDescription>
          </Field>

          <Field orientation="horizontal">
            <FieldLabel>Farbe</FieldLabel>
            <!-- A wrapper for the alignment: the picker's root (a popover) renders no element. -->
            <div class="ml-auto">
              <ColorPicker v-model="color" />
            </div>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <DialogClose as-child>
            <Button type="button" variant="outline">Abbrechen</Button>
          </DialogClose>
          <Button type="submit" :disabled="!!problem">
            <ImageUpscaleIcon data-icon="inline-start" />
            Anfügen
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

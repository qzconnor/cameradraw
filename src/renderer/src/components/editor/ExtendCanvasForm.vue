<script setup lang="ts">
import { computed, ref } from 'vue'
import { ImageUpscaleIcon } from '@lucide/vue'
import { SEGMENTED_GROUP, SEGMENTED_ITEM } from '@/components/common/segmented'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { acrossOf, isHorizontal, MAX_SIDE, maxExtend, type Side, type Size } from '@/editor/adjust'
import ColorPicker from './ColorPicker.vue'

/** Where, how much and which colour of space to add – shown next to the edge it goes on. */
const props = defineProps<{ imageSize: Size }>()
const side = defineModel<Side>('side', { required: true })
/** Pixels, as typed. */
const amount = defineModel<string>('amount', { required: true })
const color = defineModel<string>('color', { required: true })
const emit = defineEmits<{ submit: []; cancel: [] }>()

const SIDES: { value: Side; label: string }[] = [
  { value: 'top', label: 'Oben' },
  { value: 'right', label: 'Rechts' },
  { value: 'bottom', label: 'Unten' },
  { value: 'left', label: 'Links' }
]
/** Share of the picture's width (left/right) or height (top/bottom). */
const PRESETS = [0.25, 0.5, 1]

const input = ref<InstanceType<typeof InputGroupInput> | null>(null)

function preset(share: number): void {
  amount.value = String(Math.round(acrossOf(props.imageSize, side.value) * share))
}

/** Another side: the same share of the picture there. */
function pickSide(next: Side): void {
  const share = Number(amount.value) / acrossOf(props.imageSize, side.value)
  side.value = next
  if (Number.isFinite(share) && share > 0) preset(share)
}

const pixels = computed(() => Number(amount.value))
const result = computed(() => {
  const { width, height } = props.imageSize
  const add = Number.isInteger(pixels.value) ? pixels.value : 0
  return isHorizontal(side.value) ? { width: width + add, height } : { width, height: height + add }
})
const problem = computed(() => {
  if (!Number.isInteger(pixels.value) || pixels.value < 1)
    return 'Bitte eine ganze Zahl ab 1 eingeben.'
  if (pixels.value > maxExtend(props.imageSize, side.value)) {
    return `Das Bild darf höchstens ${MAX_SIDE} Pixel breit und hoch werden.`
  }
  return null
})

function submit(): void {
  if (!problem.value) emit('submit')
}

/** Ready to type a number right away. */
function focus(): void {
  const el = input.value?.$el as HTMLInputElement | undefined
  el?.focus()
  el?.select()
}

defineExpose({ focus })

const percent = (share: number): string => `${Math.round(share * 100)} %`
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="submit">
    <p class="font-medium">Fläche anfügen</p>

    <FieldGroup class="gap-4">
      <ToggleGroup
        type="single"
        size="sm"
        :spacing="0.5"
        :class="['w-full', SEGMENTED_GROUP]"
        aria-label="Seite"
        :model-value="side"
        @update:model-value="(value) => value && pickSide(value as Side)"
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

      <Field :data-invalid="!!problem || undefined">
        <FieldLabel for="extend-amount">{{ isHorizontal(side) ? 'Breite' : 'Höhe' }}</FieldLabel>
        <div class="flex gap-2">
          <InputGroup>
            <InputGroupInput
              id="extend-amount"
              ref="input"
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
              size="sm"
              class="h-auto"
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

    <div class="flex justify-end gap-2">
      <Button type="button" variant="outline" @click="emit('cancel')">Abbrechen</Button>
      <Button type="submit" :disabled="!!problem">
        <ImageUpscaleIcon data-icon="inline-start" />
        Anfügen
      </Button>
    </div>
  </form>
</template>

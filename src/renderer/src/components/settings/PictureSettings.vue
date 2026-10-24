<script setup lang="ts">
import { computed } from 'vue'
import { CameraOffIcon, RotateCcwIcon, SunMediumIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import CameraControlField from '@/components/camera/CameraControlField.vue'
import PowerLineField from '@/components/camera/PowerLineField.vue'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator
} from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { errorMessage } from '@/lib/format'
import { useCameraStore } from '@/stores/camera'
import { useCameraControlsStore } from '@/stores/camera-controls'

/**
 * Settings tab "Bild": the soft contrast CameraDraw applies to the picture, and what the camera
 * itself adjusts – exposure, white balance, focus, brightness, anti-flicker filter and so on. Only
 * what the live camera offers and really accepts is shown.
 */
const camera = useCameraStore()
const controls = useCameraControlsStore()

const autoControls = computed(() => controls.controls.filter((c) => c.kind === 'auto'))
const valueControls = computed(() => controls.controls.filter((c) => c.kind === 'value'))
const live = computed(() => camera.status === 'live')
/** The camera has settings of its own (not only the soft contrast). */
const adjustable = computed(() => controls.controls.length > 0 || !!controls.powerLine)

function setSoftContrast(on: boolean): void {
  camera
    .setSoftContrast(on)
    .catch((err) =>
      toast.error('Einstellung konnte nicht gespeichert werden', { description: errorMessage(err) })
    )
}

async function reset(): Promise<void> {
  try {
    await controls.reset()
  } catch (err) {
    toast.error('Zurücksetzen hat nicht geklappt', { description: errorMessage(err) })
  }
}
</script>

<template>
  <Empty v-if="!live" class="p-6">
    <EmptyHeader>
      <EmptyMedia variant="icon"><CameraOffIcon /></EmptyMedia>
      <EmptyTitle>Kamera läuft nicht</EmptyTitle>
      <EmptyDescription>
        Die Bildeinstellungen gibt es, solange das Livebild der Kamera zu sehen ist.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>

  <div v-else-if="controls.loading" class="flex justify-center p-6">
    <Spinner />
  </div>

  <FieldGroup v-else>
    <Field orientation="horizontal">
      <FieldContent>
        <!-- Clicking the label toggles the switch. -->
        <FieldLabel for="settings-soft-contrast" class="cursor-pointer"
          >Weicher Kontrast</FieldLabel
        >
        <FieldDescription>
          Wie in Logi Capture: Helles frisst nicht aus, Farben und Farbstiche wirken ruhiger. Gilt
          auch für Aufnahmen.
        </FieldDescription>
      </FieldContent>
      <Switch
        id="settings-soft-contrast"
        class="self-center"
        :model-value="camera.softContrast"
        @update:model-value="setSoftContrast"
      />
    </Field>

    <FieldSeparator />

    <FieldDescription v-if="adjustable">
      Stellt die Kamera selbst ein – das wirkt auf das Livebild und jede Aufnahme. CameraDraw merkt
      es sich für diese Kamera.
    </FieldDescription>

    <CameraControlField v-for="control in autoControls" :key="control.name" :control="control" />
    <FieldSeparator v-if="autoControls.length && valueControls.length" />
    <CameraControlField v-for="control in valueControls" :key="control.name" :control="control" />
    <FieldSeparator v-if="controls.controls.length && controls.powerLine" />
    <PowerLineField />

    <Empty v-if="!adjustable" class="p-4">
      <EmptyHeader>
        <EmptyMedia variant="icon"><SunMediumIcon /></EmptyMedia>
        <EmptyTitle>Nichts einzustellen</EmptyTitle>
        <EmptyDescription>Diese Kamera lässt selbst keine Bildeinstellungen zu.</EmptyDescription>
      </EmptyHeader>
    </Empty>

    <div v-if="adjustable">
      <Button variant="outline" size="sm" :disabled="!controls.changed" @click="reset">
        <RotateCcwIcon data-icon="inline-start" />
        Zurücksetzen
      </Button>
    </div>
  </FieldGroup>
</template>

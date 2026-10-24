<script setup lang="ts">
import { computed } from 'vue'
import { CameraOffIcon, RotateCcwIcon, SunMediumIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import CameraControlField from '@/components/camera/CameraControlField.vue'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { FieldDescription, FieldGroup, FieldSeparator } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '@/lib/format'
import { useCameraStore } from '@/stores/camera'
import { useCameraControlsStore } from '@/stores/camera-controls'

/**
 * Settings tab "Bild": what the camera itself adjusts – exposure, white balance, focus, brightness
 * and so on. Only what the live camera offers and really accepts is shown.
 */
const camera = useCameraStore()
const controls = useCameraControlsStore()

const autoControls = computed(() => controls.controls.filter((c) => c.kind === 'auto'))
const valueControls = computed(() => controls.controls.filter((c) => c.kind === 'value'))
const live = computed(() => camera.status === 'live')

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
    <FieldDescription v-if="controls.controls.length">
      Stellt die Kamera selbst ein – das wirkt auf das Livebild und jede Aufnahme. CameraDraw merkt
      es sich für diese Kamera.
    </FieldDescription>

    <CameraControlField v-for="control in autoControls" :key="control.name" :control="control" />
    <FieldSeparator v-if="autoControls.length && valueControls.length" />
    <CameraControlField v-for="control in valueControls" :key="control.name" :control="control" />

    <Empty v-if="!controls.controls.length" class="p-4">
      <EmptyHeader>
        <EmptyMedia variant="icon"><SunMediumIcon /></EmptyMedia>
        <EmptyTitle>Nichts einzustellen</EmptyTitle>
        <EmptyDescription>Diese Kamera lässt keine Bildeinstellungen zu.</EmptyDescription>
      </EmptyHeader>
    </Empty>

    <div v-if="controls.controls.length">
      <Button variant="outline" size="sm" :disabled="!controls.changed" @click="reset">
        <RotateCcwIcon data-icon="inline-start" />
        Zurücksetzen
      </Button>
    </div>
  </FieldGroup>
</template>

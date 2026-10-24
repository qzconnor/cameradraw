<script setup lang="ts">
import { computed } from 'vue'
import { toast } from 'vue-sonner'
import type { CameraResolution } from '@shared/camera-controls'
import CameraSelect from '@/components/camera/CameraSelect.vue'
import { SEGMENTED_GROUP, SEGMENTED_ITEM } from '@/components/common/segmented'
import { Badge } from '@/components/ui/badge'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator
} from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CONNECTION_LABELS, formatUsbId, parseUsbId } from '@/lib/camera-info'
import { errorMessage } from '@/lib/format'
import { useCameraStore } from '@/stores/camera'
import { useHardwareStore } from '@/stores/hardware'
import { useModulesStore } from '@/stores/modules'
import { useSettingsStore } from '@/stores/settings'

/** Settings tab "Kamera": which camera, its resolution and how the live picture behaves. */
const settings = useSettingsStore()
const camera = useCameraStore()
const hardware = useHardwareStore()
const modules = useModulesStore()

/** How the chosen camera is connected, e.g. "Per USB angeschlossen · USB-ID 1b3f:2002". */
const connectionNote = computed(() => {
  const label = modules.currentLabel
  if (!label) return null
  const usb = parseUsbId(label)
  const text = CONNECTION_LABELS[hardware.connectionOf(label)]
  return usb ? `${text} · USB-ID ${formatUsbId(usb)}` : text
})

const size = (s: { width: number; height: number }): string => `${s.width}×${s.height}`

async function update(patch: Parameters<typeof settings.update>[0]): Promise<void> {
  try {
    await settings.update(patch)
  } catch (err) {
    toast.error('Einstellung konnte nicht gespeichert werden', { description: errorMessage(err) })
  }
}

function pickResolution(value: unknown): void {
  // Clicking the active item would deselect it – one of them is always picked.
  if (value !== 'standard' && value !== 'max') return
  camera
    .setResolution(value as CameraResolution)
    .catch((err) =>
      toast.error('Auflösung konnte nicht geändert werden', { description: errorMessage(err) })
    )
}
</script>

<template>
  <FieldGroup>
    <Field>
      <FieldLabel>Kamera</FieldLabel>
      <CameraSelect class="w-full" />
      <FieldDescription v-if="connectionNote">{{ connectionNote }}</FieldDescription>
    </Field>

    <!-- Resolution the camera actually delivers – captured images are saved at exactly this size. -->
    <Field v-if="camera.status === 'live' && camera.resolution" orientation="horizontal">
      <FieldContent>
        <FieldLabel>Auflösung</FieldLabel>
        <FieldDescription>Bilder werden in dieser Größe gespeichert.</FieldDescription>
      </FieldContent>
      <Badge variant="outline" class="self-center tabular-nums">
        {{ size(camera.resolution) }}
      </Badge>
    </Field>

    <!-- Only for cameras that offer more than Full HD – for the others there is nothing to pick. -->
    <Field v-if="camera.status === 'live' && camera.offersMoreThanStandard && camera.maxResolution">
      <ToggleGroup
        type="single"
        size="sm"
        :spacing="0.5"
        :class="['w-full', SEGMENTED_GROUP]"
        aria-label="Auflösung wählen"
        :model-value="camera.resolutionSetting"
        @update:model-value="pickResolution"
      >
        <ToggleGroupItem value="standard" :class="['flex-1', SEGMENTED_ITEM]">
          Bis Full HD
        </ToggleGroupItem>
        <ToggleGroupItem value="max" :class="['flex-1', SEGMENTED_ITEM]">
          Höchste · {{ size(camera.maxResolution) }}
        </ToggleGroupItem>
      </ToggleGroup>
      <FieldDescription>
        Die höchste Auflösung zeigt mehr Details, das Livebild kann dabei aber ruckeln.
      </FieldDescription>
    </Field>

    <FieldSeparator />

    <Field orientation="horizontal">
      <FieldContent>
        <!-- Clicking the label toggles the switch. -->
        <FieldLabel for="settings-mirror" class="cursor-pointer">Kamerabild spiegeln</FieldLabel>
        <FieldDescription>Praktisch, wenn die Kamera auf dich gerichtet ist.</FieldDescription>
      </FieldContent>
      <Switch
        id="settings-mirror"
        class="self-center"
        :model-value="settings.mirror"
        @update:model-value="update({ mirror: $event })"
      />
    </Field>

    <!-- Only relevant for cameras that report a zoom control of their own. -->
    <Field v-if="camera.hasCameraZoom" orientation="horizontal">
      <FieldContent>
        <FieldLabel for="settings-camera-zoom" class="cursor-pointer">
          Kamera-Zoom verwenden
        </FieldLabel>
        <FieldDescription>
          Zoomt mit der Kamera selbst in voller Auflösung. Ändert sich beim Zoomen nichts,
          ausschalten – dann wird digital die Bildmitte vergrößert.
        </FieldDescription>
      </FieldContent>
      <Switch
        id="settings-camera-zoom"
        class="self-center"
        :model-value="settings.preferCameraZoom"
        @update:model-value="update({ preferCameraZoom: $event })"
      />
    </Field>

    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel for="settings-stop-hidden" class="cursor-pointer">
          Kamera ausschalten, wenn sie nicht zu sehen ist
        </FieldLabel>
        <FieldDescription>
          Beim Pausieren, Bearbeiten und Minimieren geht das Kameralicht aus und andere Apps können
          die Kamera nutzen; danach dauert das Einschalten einen Moment. Sonst läuft sie im
          Hintergrund weiter.
        </FieldDescription>
      </FieldContent>
      <Switch
        id="settings-stop-hidden"
        class="self-center"
        :model-value="settings.stopCameraWhenHidden"
        @update:model-value="update({ stopCameraWhenHidden: $event })"
      />
    </Field>
  </FieldGroup>
</template>

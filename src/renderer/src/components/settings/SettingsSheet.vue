<script setup lang="ts">
import { FolderOpenIcon, SettingsIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { computed } from 'vue'
import CameraSelect from '@/components/camera/CameraSelect.vue'
import SidePanel from '@/components/common/SidePanel.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator
} from '@/components/ui/field'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { CONNECTION_LABELS, formatUsbId, parseUsbId } from '@/lib/camera-info'
import { errorMessage } from '@/lib/format'
import { useCameraStore } from '@/stores/camera'
import { useGalleryStore } from '@/stores/gallery'
import { useHardwareStore } from '@/stores/hardware'
import { useModulesStore } from '@/stores/modules'
import { useSettingsStore } from '@/stores/settings'
import FolderPicker from './FolderPicker.vue'

const settings = useSettingsStore()
const gallery = useGalleryStore()
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

async function update(patch: Parameters<typeof settings.update>[0]): Promise<void> {
  try {
    await settings.update(patch)
  } catch (err) {
    toast.error('Einstellung konnte nicht gespeichert werden', { description: errorMessage(err) })
  }
}

async function openFolder(): Promise<void> {
  try {
    await gallery.openFolder()
  } catch (err) {
    toast.error('Ordner konnte nicht geöffnet werden', { description: errorMessage(err) })
  }
}
</script>

<template>
  <SidePanel name="settings">
    <SheetHeader class="h-13 flex-row items-center gap-2 border-b py-0 pr-12 pl-4">
      <SettingsIcon class="size-4 text-muted-foreground" />
      <SheetTitle>Einstellungen</SheetTitle>
      <SheetDescription class="sr-only">Änderungen werden sofort übernommen.</SheetDescription>
    </SheetHeader>

    <ScrollArea class="min-h-0 flex-1">
      <FieldGroup class="p-4">
        <Field>
          <FieldLabel for="settings-folder">Speicherordner</FieldLabel>
          <FolderPicker
            id="settings-folder"
            :model-value="settings.saveDir"
            @update:model-value="update({ saveDir: $event })"
          />
          <FieldDescription>
            Bilder werden als PNG gespeichert. Die Zeichnungs-Ebenen liegen im versteckten
            Unterordner „.cameradraw“, damit Bilder später weiter bearbeitet werden können.
          </FieldDescription>
        </Field>

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
            {{ camera.resolution.width }}×{{ camera.resolution.height }}
          </Badge>
        </Field>

        <FieldSeparator />

        <Field orientation="horizontal">
          <FieldContent>
            <!-- Clicking the label toggles the switch. -->
            <FieldLabel for="settings-mirror" class="cursor-pointer">
              Kamerabild spiegeln
            </FieldLabel>
            <FieldDescription>Praktisch, wenn die Kamera auf dich gerichtet ist.</FieldDescription>
          </FieldContent>
          <Switch
            id="settings-mirror"
            class="self-center"
            :model-value="settings.mirror"
            @update:model-value="update({ mirror: $event })"
          />
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="settings-ambient" class="cursor-pointer">Ambient Light</FieldLabel>
            <FieldDescription>
              Statt schwarzer Ränder leuchten die Farben vom Bildrand in die freie Fläche.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="settings-ambient"
            class="self-center"
            :model-value="settings.ambientLight"
            @update:model-value="update({ ambientLight: $event })"
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
      </FieldGroup>
    </ScrollArea>

    <div class="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2.5">
      <p class="text-xs text-muted-foreground">Änderungen werden sofort übernommen.</p>
      <Button
        variant="outline"
        size="sm"
        :disabled="!settings.saveDirAvailable"
        @click="openFolder"
      >
        <FolderOpenIcon data-icon="inline-start" />
        Ordner öffnen
      </Button>
    </div>
  </SidePanel>
</template>

<script setup lang="ts">
import { FolderOpenIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator
} from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { errorMessage } from '@/lib/format'
import { useGalleryStore } from '@/stores/gallery'
import { useSettingsStore } from '@/stores/settings'
import FolderPicker from './FolderPicker.vue'

/** Settings tab "Allgemein": where pictures are saved and how the app looks. */
const settings = useSettingsStore()
const gallery = useGalleryStore()

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
  <FieldGroup>
    <Field>
      <FieldLabel for="settings-folder">Speicherordner</FieldLabel>
      <FolderPicker
        id="settings-folder"
        :model-value="settings.saveDir"
        @update:model-value="update({ saveDir: $event })"
      />
      <FieldDescription>
        Bilder werden als PNG gespeichert. Die Zeichnungs-Ebenen liegen im versteckten Unterordner
        „.cameradraw“, damit Bilder später weiter bearbeitet werden können.
      </FieldDescription>
      <!-- A wrapper, so the button keeps its own width in the field. -->
      <div>
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
    </Field>

    <FieldSeparator />

    <Field orientation="horizontal">
      <FieldContent>
        <!-- Clicking the label toggles the switch. -->
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
  </FieldGroup>
</template>

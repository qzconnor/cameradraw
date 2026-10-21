<script setup lang="ts">
import { ref, watch } from 'vue'
import { ApertureIcon, ArrowRightIcon, TriangleAlertIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import CameraSelect from '@/components/camera/CameraSelect.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '@/lib/format'
import { useSettingsStore } from '@/stores/settings'
import FolderPicker from './FolderPicker.vue'

const settings = useSettingsStore()

const folder = ref<string | null>(null)
const saving = ref(false)
/** A folder was configured before, but it is gone now (e.g. USB drive removed). */
const folderMissing = ref(false)

watch(
  () => settings.needsSetup,
  (needed) => {
    if (!needed) return
    folder.value = settings.saveDir
    folderMissing.value = settings.saveDir !== null
  },
  { immediate: true }
)

async function finish(): Promise<void> {
  if (!folder.value) return
  saving.value = true
  try {
    await settings.update({ saveDir: folder.value })
  } catch (err) {
    toast.error('Ordner kann nicht verwendet werden', { description: errorMessage(err) })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <!-- Not dismissable: a save folder is required before the app can be used. -->
  <Dialog :open="settings.needsSetup">
    <DialogContent
      :show-close-button="false"
      class="sm:max-w-lg"
      @escape-key-down.prevent
      @pointer-down-outside.prevent
      @interact-outside.prevent
    >
      <DialogHeader>
        <div
          class="mb-2 grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"
        >
          <ApertureIcon />
        </div>
        <DialogTitle>{{
          folderMissing ? 'Speicherordner nicht gefunden' : 'Willkommen bei CameraDraw'
        }}</DialogTitle>
        <DialogDescription>
          Wähle einen Ordner, in dem deine Bilder gespeichert werden. Das kannst du später in den
          Einstellungen ändern.
        </DialogDescription>
      </DialogHeader>

      <Alert v-if="folderMissing" variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Ordner nicht erreichbar</AlertTitle>
        <AlertDescription>
          Der bisherige Ordner existiert nicht mehr oder ist schreibgeschützt. Wähle ihn erneut oder
          einen anderen.
        </AlertDescription>
      </Alert>

      <FieldGroup>
        <Field>
          <FieldLabel for="setup-folder">Speicherordner</FieldLabel>
          <FolderPicker id="setup-folder" v-model="folder" />
          <FieldDescription>Jedes Bild wird hier als PNG abgelegt.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Kamera</FieldLabel>
          <CameraSelect class="w-full" />
        </Field>
      </FieldGroup>

      <DialogFooter>
        <Button :disabled="!folder || saving" @click="finish">
          <Spinner v-if="saving" data-icon="inline-start" />
          Los geht’s
          <ArrowRightIcon v-if="!saving" data-icon="inline-end" />
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

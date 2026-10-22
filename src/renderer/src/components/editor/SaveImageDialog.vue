<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { FolderIcon, FolderPlusIcon, ImagesIcon, SaveIcon } from '@lucide/vue'
import {
  captureStem,
  itemPath,
  nameError,
  sameName,
  splitExtension,
  splitItemPath
} from '@shared/names'
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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useGalleryStore } from '@/stores/gallery'

/** Asks for the file name and the project before an image is saved. */
const props = defineProps<{
  /** Path of the image being edited, null for a new capture. */
  source: string | null
  saving: boolean
}>()
const open = defineModel<boolean>('open', { required: true })
/** `copy`: save the edited image as a new one next to the original. */
const emit = defineEmits<{ save: [target: string, copy: boolean] }>()

const gallery = useGalleryStore()
const nameInput = useTemplateRef<InstanceType<typeof InputGroupInput>>('nameInput')
const projectInput = useTemplateRef<InstanceType<typeof Input>>('projectInput')

// Select values that can never be project names (':' is not allowed in names).
const NO_PROJECT = ':none'
const NEW_PROJECT = ':new'

const stem = ref('')
/** Kept from the edited file, so it stays encoded the same way; new images are PNG. */
const ext = ref('.png')
const choice = ref(NO_PROJECT)
const newProject = ref('')
/** Only for an image from the gallery: keep the original and save a new image. */
const asCopy = ref(false)
/** Hints about empty fields only show after trying to save. */
const submitted = ref(false)

watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    submitted.value = false
    newProject.value = ''
    asCopy.value = false
    if (props.source) {
      const { project, name } = splitItemPath(props.source)
      ;({ stem: stem.value, ext: ext.value } = splitExtension(name))
      choice.value = gallery.projectExists(project) ? project : NO_PROJECT
    } else {
      stem.value = captureStem()
      ext.value = '.png'
      // The project picked last time is preselected.
      choice.value = gallery.projectExists(gallery.lastProject) ? gallery.lastProject : NO_PROJECT
    }
  },
  { immediate: true }
)

// The name field for a new project appears – put the cursor there.
watch(choice, async (value) => {
  if (value !== NEW_PROJECT) return
  await nextTick()
  ;(projectInput.value?.$el as HTMLInputElement | undefined)?.focus()
})

const project = computed(() =>
  choice.value === NO_PROJECT
    ? null
    : choice.value === NEW_PROJECT
      ? newProject.value.trim()
      : choice.value
)
const target = computed(() => itemPath(project.value, `${stem.value.trim()}${ext.value}`))
/** An existing image gets a new name or project – the file is moved, not copied. */
const relocating = computed(
  () => props.source !== null && !asCopy.value && props.source !== target.value
)

/** `Bild Kopie`, `Bild Kopie 2`, … – the first name still free in the chosen project. */
function freeCopyStem(base: string): string {
  const taken = (candidate: string): boolean =>
    gallery.items.some((i) => sameName(i.path, itemPath(project.value, `${candidate}${ext.value}`)))
  let candidate = `${base} Kopie`
  for (let n = 2; taken(candidate); n++) candidate = `${base} Kopie ${n}`
  return candidate
}

/** Name suggested when switching to a copy – taken back if the copy is switched off again. */
let suggestedStem: string | null = null

// A copy cannot keep the original's name in the same place – suggest a free one.
watch(asCopy, async (copy) => {
  if (!props.source) return
  const original = splitExtension(splitItemPath(props.source).name).stem
  if (!copy) {
    if (stem.value === suggestedStem) stem.value = original
    return
  }
  if (!sameName(target.value, props.source)) return
  stem.value = suggestedStem = freeCopyStem(original)
  await nextTick()
  const el = nameInput.value?.$el as HTMLInputElement | undefined
  el?.focus()
  el?.select()
})

const nameProblem = computed(() => {
  const name = stem.value.trim()
  if (!name) return submitted.value ? 'Bitte gib einen Dateinamen ein.' : null
  const invalid = nameError(name)
  if (invalid) return invalid
  // For a copy the original counts as taken as well.
  const taken = gallery.items.some(
    (i) => (asCopy.value || i.path !== props.source) && sameName(i.path, target.value)
  )
  if (!taken) return null
  return project.value
    ? `In „${project.value}“ gibt es schon ein Bild mit diesem Namen.`
    : 'Es gibt schon ein Bild mit diesem Namen.'
})

const projectProblem = computed(() => {
  if (choice.value !== NEW_PROJECT) return null
  const name = newProject.value.trim()
  if (!name) return submitted.value ? 'Bitte gib einen Namen für das Projekt ein.' : null
  return (
    nameError(name) ??
    (gallery.hasProject(name) ? 'Dieses Projekt gibt es schon – wähle es oben aus.' : null)
  )
})

function submit(): void {
  submitted.value = true
  const incomplete = !stem.value.trim() || (choice.value === NEW_PROJECT && !project.value)
  if (props.saving || incomplete || nameProblem.value || projectProblem.value) return
  emit('save', target.value, asCopy.value)
}

/** Focus the name with everything selected, so typing replaces the suggestion. */
function focusName(event: Event): void {
  event.preventDefault()
  const el = nameInput.value?.$el as HTMLInputElement | undefined
  el?.focus()
  el?.select()
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md" @open-auto-focus="focusName">
      <form class="contents" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>{{ source ? 'Speichern unter' : 'Bild speichern' }}</DialogTitle>
          <DialogDescription>
            Gib dem Bild einen Namen und wähle, in welchem Projekt es liegen soll.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field :data-invalid="!!nameProblem || undefined">
            <FieldLabel for="save-name">Dateiname</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="save-name"
                ref="nameInput"
                v-model="stem"
                autocomplete="off"
                spellcheck="false"
                :aria-invalid="!!nameProblem || undefined"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>{{ ext }}</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldError v-if="nameProblem">{{ nameProblem }}</FieldError>
            <FieldDescription v-else-if="relocating">
              Das Bild wird nicht kopiert: „{{ source }}“ wird umbenannt bzw. verschoben.
            </FieldDescription>
            <FieldDescription v-else-if="asCopy">
              „{{ source }}“ bleibt unverändert, die Kopie kommt als neues Bild dazu.
            </FieldDescription>
          </Field>

          <Field v-if="source" orientation="horizontal">
            <FieldContent>
              <!-- Clicking the label toggles the switch. -->
              <FieldLabel for="save-copy" class="cursor-pointer">Als Kopie speichern</FieldLabel>
              <FieldDescription>Das Original bleibt erhalten.</FieldDescription>
            </FieldContent>
            <Switch id="save-copy" v-model="asCopy" class="self-center" />
          </Field>

          <Field>
            <FieldLabel for="save-project">Projekt</FieldLabel>
            <Select v-model="choice">
              <SelectTrigger id="save-project" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem :value="NO_PROJECT">
                    <ImagesIcon />
                    Kein Projekt
                  </SelectItem>
                </SelectGroup>
                <template v-if="gallery.projectNames.length">
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Projekte</SelectLabel>
                    <SelectItem v-for="name in gallery.projectNames" :key="name" :value="name">
                      <FolderIcon />
                      {{ name }}
                    </SelectItem>
                  </SelectGroup>
                </template>
                <SelectSeparator />
                <SelectGroup>
                  <SelectItem :value="NEW_PROJECT">
                    <FolderPlusIcon />
                    Neues Projekt …
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription
              >Beim nächsten Bild ist dieses Projekt schon ausgewählt.</FieldDescription
            >
          </Field>

          <Field v-if="choice === NEW_PROJECT" :data-invalid="!!projectProblem || undefined">
            <FieldLabel for="save-new-project">Name des neuen Projekts</FieldLabel>
            <Input
              id="save-new-project"
              ref="projectInput"
              v-model="newProject"
              placeholder="z. B. Probe 12"
              autocomplete="off"
              spellcheck="false"
              :aria-invalid="!!projectProblem || undefined"
            />
            <FieldError v-if="projectProblem">{{ projectProblem }}</FieldError>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <DialogClose as-child>
            <Button type="button" variant="outline">Abbrechen</Button>
          </DialogClose>
          <Button type="submit" :disabled="saving">
            <Spinner v-if="saving" data-icon="inline-start" />
            <SaveIcon v-else data-icon="inline-start" />
            Speichern
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

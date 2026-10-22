<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { CameraIcon, FolderIcon, SearchXIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { sameName, splitExtension, splitItemPath } from '@shared/names'
import type { GalleryItem } from '@shared/types'
import HintTooltip from '@/components/common/HintTooltip.vue'
import SidePanel from '@/components/common/SidePanel.vue'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { Kbd } from '@/components/ui/kbd'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useGalleryDrag } from '@/composables/useGalleryDrag'
import { errorMessage } from '@/lib/format'
import type { ProjectSummary } from '@/lib/gallery'
import { isOverlayOpen, isTypingTarget } from '@/lib/keyboard'
import { useEditorStore } from '@/stores/editor'
import { useGalleryStore } from '@/stores/gallery'
import { usePanelsStore } from '@/stores/panels'
import { useSettingsStore } from '@/stores/settings'
import DeleteDialog from './DeleteDialog.vue'
import GalleryDragGhost from './GalleryDragGhost.vue'
import GalleryDropDock from './GalleryDropDock.vue'
import GalleryHeader from './GalleryHeader.vue'
import GalleryItemCard from './GalleryItemCard.vue'
import GalleryProjectCard from './GalleryProjectCard.vue'
import GalleryToolbar from './GalleryToolbar.vue'
import NameDialog from './NameDialog.vue'

const gallery = useGalleryStore()
const editor = useEditorStore()
const settings = useSettingsStore()
const panels = usePanelsStore()
const drag = useGalleryDrag()

async function run(action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
  } catch (err) {
    toast.error('Aktion fehlgeschlagen', { description: errorMessage(err) })
  }
}

function openImage(path: string): void {
  panels.setOpen('gallery', false)
  editor.openFromGallery(path)
}

// --- Moving ---------------------------------------------------------------------------------

async function moveImage(
  item: GalleryItem,
  project: string | null,
  undoable = true
): Promise<void> {
  try {
    const path = await gallery.move(item.path, project)
    editor.pathChanged(item.path, path)
    const { name } = splitItemPath(path)
    const moved = { ...item, path, name, project }
    toast.success(project ? `Nach „${project}“ verschoben` : `Aus „${item.project}“ genommen`, {
      description: name === item.name ? name : `Als ${name} – der Name war dort schon vergeben.`,
      action: undoable
        ? { label: 'Rückgängig', onClick: () => void moveImage(moved, item.project, false) }
        : undefined
    })
  } catch (err) {
    toast.error('Verschieben fehlgeschlagen', { description: errorMessage(err) })
  }
}

drag.onDrop(({ item, project }) => void moveImage(item, project))

/** Drop targets in the dock: "Kein Projekt" and every project not shown as a card. */
const dockTargets = computed<(string | null)[]>(() => {
  const dragged = drag.active.value?.item
  if (!dragged) return []
  const shown = new Set(
    gallery.entries.flatMap((e) => (e.kind === 'project' ? [e.project.name] : []))
  )
  return [
    ...(dragged.project !== null ? [null] : []),
    ...gallery.projectNames.filter((p) => p !== dragged.project && !shown.has(p))
  ]
})

// --- Naming: new project, renaming projects and images -------------------------------------

type NameRequest =
  | { mode: 'createProject'; thenMove?: GalleryItem }
  | { mode: 'renameProject'; project: string }
  | { mode: 'renameImage'; item: GalleryItem }

const nameRequest = ref<NameRequest | null>(null)
const nameOpen = ref(false)
const nameBusy = ref(false)

const projectTaken = (name: string): string | null =>
  gallery.hasProject(name) ? 'Ein Projekt mit diesem Namen gibt es schon.' : null

const nameDialog = computed(() => {
  const request = nameRequest.value
  if (request?.mode === 'renameImage') {
    const { item } = request
    const { stem, ext } = splitExtension(item.name)
    return {
      title: 'Bild umbenennen',
      description: item.editable
        ? 'Die Zeichnungs-Ebenen werden mit umbenannt – das Bild bleibt bearbeitbar.'
        : 'Die Datei wird im Speicherordner umbenannt.',
      confirm: 'Umbenennen',
      initial: stem,
      suffix: ext,
      placeholder: undefined,
      taken: (name: string): string | null => {
        const clash = gallery.items.some(
          (i) => i.project === item.project && i.path !== item.path && sameName(i.name, name + ext)
        )
        if (!clash) return null
        return item.project
          ? `In „${item.project}“ gibt es schon ein Bild mit diesem Namen.`
          : 'Es gibt schon ein Bild mit diesem Namen.'
      }
    }
  }
  if (request?.mode === 'renameProject') {
    return {
      title: 'Projekt umbenennen',
      description: 'Der Ordner des Projekts wird im Speicherordner umbenannt.',
      confirm: 'Umbenennen',
      initial: request.project,
      suffix: undefined,
      placeholder: 'z. B. Probe 12',
      taken: projectTaken
    }
  }
  return {
    title: 'Neues Projekt',
    description: request?.thenMove
      ? `Das Projekt wird als Unterordner angelegt und „${request.thenMove.name}“ dorthin verschoben.`
      : 'Das Projekt wird als Unterordner im Speicherordner angelegt.',
    confirm: 'Anlegen',
    initial: undefined,
    suffix: undefined,
    placeholder: 'z. B. Probe 12',
    taken: projectTaken
  }
})

function askName(request: NameRequest): void {
  nameRequest.value = request
  nameOpen.value = true
}

async function confirmName(name: string): Promise<void> {
  const request = nameRequest.value
  if (!request) return
  nameBusy.value = true
  try {
    if (request.mode === 'createProject') {
      await gallery.createProject(name)
      if (request.thenMove) await moveImage(request.thenMove, name, false)
      else toast.success('Projekt angelegt', { description: name })
    } else if (request.mode === 'renameProject') {
      await gallery.renameProject(request.project, name)
      editor.pathChanged(request.project, name)
      toast.success('Projekt umbenannt', { description: name })
    } else {
      const { ext } = splitExtension(request.item.name)
      const path = await gallery.renameImage(request.item.path, name + ext)
      editor.pathChanged(request.item.path, path)
      toast.success('Bild umbenannt', { description: splitItemPath(path).name })
    }
    nameOpen.value = false
  } catch (err) {
    toast.error(
      request.mode === 'createProject'
        ? 'Projekt konnte nicht angelegt werden'
        : 'Umbenennen fehlgeschlagen',
      { description: errorMessage(err) }
    )
  } finally {
    nameBusy.value = false
  }
}

// --- Deleting -------------------------------------------------------------------------------

type DeleteRequest =
  { kind: 'image'; item: GalleryItem } | { kind: 'project'; project: ProjectSummary }

const deleteRequest = ref<DeleteRequest | null>(null)
const deleteOpen = ref(false)

const deleteTexts = computed(() => {
  const request = deleteRequest.value
  if (request?.kind === 'project') {
    const { name, count } = request.project
    return {
      title: 'Projekt löschen?',
      description:
        count === 0
          ? `Das leere Projekt „${name}“ wird in den Papierkorb verschoben.`
          : `Das Projekt „${name}“ wird mit ${count === 1 ? 'einem Bild' : `allen ${count} Bildern`} in den Papierkorb verschoben.`
    }
  }
  return {
    title: 'Bild löschen?',
    description: `„${request?.item.name ?? ''}“ wird mit seinen Zeichnungs-Ebenen in den Papierkorb verschoben.`
  }
})

function askDeleteImage(item: GalleryItem): void {
  deleteRequest.value = { kind: 'image', item }
  deleteOpen.value = true
}

function askDeleteProject(name: string): void {
  const project = gallery.summaries.find((p) => p.name === name)
  if (!project) return
  deleteRequest.value = { kind: 'project', project }
  deleteOpen.value = true
}

async function confirmDelete(): Promise<void> {
  const request = deleteRequest.value
  if (!request) return
  try {
    if (request.kind === 'image') {
      await gallery.remove(request.item.path)
      if (editor.isEditing(request.item.path)) editor.close()
      toast.success('In den Papierkorb verschoben', { description: request.item.name })
    } else {
      await gallery.removeProject(request.project.name)
      if (editor.isEditing(request.project.name)) editor.close()
      toast.success('Projekt in den Papierkorb verschoben', { description: request.project.name })
    }
  } catch (err) {
    toast.error('Löschen fehlgeschlagen', { description: errorMessage(err) })
  }
}

// --- Layout & animation ---------------------------------------------------------------------

/** Into a project the content slides in from the right, back out of it from the left. */
const forward = ref(true)
watch(
  () => gallery.currentProject,
  (project) => (forward.value = project !== null)
)

/** Leaving cards are taken out of the grid flow, so the others move into place right away. */
function pinLeaving(el: Element): void {
  const card = el as HTMLElement
  const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = card
  Object.assign(card.style, {
    position: 'absolute',
    left: `${offsetLeft}px`,
    top: `${offsetTop}px`,
    width: `${offsetWidth}px`,
    height: `${offsetHeight}px`
  })
}

const firstLoad = computed(
  () => gallery.loading && !gallery.items.length && !gallery.projects.length
)

const folderPath = computed(() => {
  const dir = settings.saveDir
  if (!dir || !gallery.currentProject) return dir
  const sep = window.api.platform === 'win32' ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${sep}${gallery.currentProject}`
})

// G toggles the gallery (Escape closes it via the sheet itself).
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.key.toLowerCase() !== 'g' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
  if (isOverlayOpen() || isTypingTarget(e.target)) return
  e.preventDefault()
  panels.toggle('gallery')
})
</script>

<template>
  <SidePanel name="gallery">
    <GalleryHeader
      @create-project="askName({ mode: 'createProject' })"
      @rename-project="askName({ mode: 'renameProject', project: $event })"
      @reveal-project="run(() => gallery.reveal($event))"
      @delete-project="askDeleteProject"
      @open-folder="run(gallery.openFolder)"
    />
    <GalleryToolbar />

    <div class="relative min-h-0 flex-1">
      <Transition
        mode="out-in"
        :enter-active-class="
          forward
            ? 'duration-200 ease-out animate-in fade-in slide-in-from-right-8'
            : 'duration-200 ease-out animate-in fade-in slide-in-from-left-8'
        "
        :leave-active-class="
          forward
            ? 'duration-150 ease-in animate-out fade-out slide-out-to-left-8'
            : 'duration-150 ease-in animate-out fade-out slide-out-to-right-8'
        "
      >
        <div :key="gallery.currentProject ?? ':top'" class="flex size-full flex-col">
          <div v-if="firstLoad" class="grid grid-cols-2 gap-3 p-4">
            <Skeleton v-for="n in 6" :key="n" class="aspect-video w-full rounded-lg" />
          </div>

          <Empty v-else-if="!gallery.entries.length && gallery.filtered" class="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>Keine Treffer</EmptyTitle>
              <EmptyDescription>
                Kein Bild und kein Projekt passt zur Suche oder zum gewählten Zeitraum.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" @click="gallery.resetFilters()">
                Filter zurücksetzen
              </Button>
            </EmptyContent>
          </Empty>

          <Empty v-else-if="!gallery.entries.length && gallery.currentProject" class="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderIcon />
              </EmptyMedia>
              <EmptyTitle>Noch keine Bilder im Projekt</EmptyTitle>
              <EmptyDescription>
                Wähle beim Speichern „{{ gallery.currentProject }}“ als Projekt, oder zieh Bilder in
                der Galerie auf das Projekt.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>

          <Empty v-else-if="!gallery.entries.length" class="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CameraIcon />
              </EmptyMedia>
              <EmptyTitle>Noch keine Bilder</EmptyTitle>
              <EmptyDescription>
                Halte das Kamerabild mit <Kbd>Leertaste</Kbd> an, zeichne darauf und speichere es –
                es erscheint dann hier.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>

          <ScrollArea v-else class="min-h-0 flex-1">
            <TransitionGroup
              tag="ul"
              class="relative grid grid-cols-2 gap-3 p-4"
              move-class="transition-transform duration-300 ease-out"
              enter-active-class="transition duration-300 ease-out"
              enter-from-class="scale-90 opacity-0"
              leave-active-class="transition duration-200 ease-in"
              leave-to-class="scale-75 opacity-0"
              @before-leave="pinLeaving"
            >
              <li
                v-for="entry in gallery.entries"
                :key="entry.key"
                :class="entry.kind === 'heading' && 'col-span-2 -mb-1 first:-mt-1'"
              >
                <p
                  v-if="entry.kind === 'heading'"
                  class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
                >
                  {{ entry.label }}
                  <span class="tabular-nums">{{ entry.count }}</span>
                </p>
                <GalleryProjectCard
                  v-else-if="entry.kind === 'project'"
                  :project="entry.project"
                  @open="gallery.browse(entry.project.name)"
                  @rename="askName({ mode: 'renameProject', project: entry.project.name })"
                  @reveal="run(() => gallery.reveal(entry.project.name))"
                  @delete="askDeleteProject(entry.project.name)"
                />
                <GalleryItemCard
                  v-else
                  :item="entry.item"
                  :active="editor.session?.path === entry.item.path"
                  :is-new="gallery.lastSaved === entry.item.path"
                  :show-project="gallery.currentProject === null"
                  :projects="gallery.projectNames"
                  @open="openImage(entry.item.path)"
                  @reveal="run(() => gallery.reveal(entry.item.path))"
                  @rename="askName({ mode: 'renameImage', item: entry.item })"
                  @delete="askDeleteImage(entry.item)"
                  @move="moveImage(entry.item, $event)"
                  @move-to-new="askName({ mode: 'createProject', thenMove: entry.item })"
                />
              </li>
            </TransitionGroup>
          </ScrollArea>
        </div>
      </Transition>

      <GalleryDropDock :targets="dockTargets" />
    </div>

    <div v-if="folderPath" class="shrink-0 border-t px-4 py-2.5">
      <HintTooltip :label="folderPath" side="top">
        <p class="truncate text-xs text-muted-foreground">{{ folderPath }}</p>
      </HintTooltip>
    </div>

    <DeleteDialog
      v-model:open="deleteOpen"
      :title="deleteTexts.title"
      :description="deleteTexts.description"
      @confirm="confirmDelete"
    />
    <NameDialog
      v-model:open="nameOpen"
      :title="nameDialog.title"
      :description="nameDialog.description"
      :confirm-label="nameDialog.confirm"
      :initial="nameDialog.initial"
      :suffix="nameDialog.suffix"
      :placeholder="nameDialog.placeholder"
      :taken="nameDialog.taken"
      :busy="nameBusy"
      @confirm="confirmName"
    />
  </SidePanel>
  <GalleryDragGhost />
</template>

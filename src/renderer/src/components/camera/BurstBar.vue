<script setup lang="ts">
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { ChevronDownIcon, FolderIcon, FolderPlusIcon, ImagesIcon } from '@lucide/vue'
import NameDialog from '@/components/gallery/NameDialog.vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { errorMessage } from '@/lib/format'
import { useBurstStore } from '@/stores/burst'
import { useGalleryStore } from '@/stores/gallery'

/** While burst capture is on: how many pictures it took and the project they go to. */
const burst = useBurstStore()
const gallery = useGalleryStore()

// A radio value that can never be a project name (':' is not allowed in names).
const NO_PROJECT = ':none'

const newOpen = ref(false)
const creating = ref(false)

function pick(value: unknown): void {
  burst.setProject(value === NO_PROJECT ? null : String(value))
}

const projectTaken = (name: string): string | null =>
  gallery.hasProject(name) ? 'Ein Projekt mit diesem Namen gibt es schon.' : null

async function createProject(name: string): Promise<void> {
  creating.value = true
  try {
    await gallery.createProject(name)
    burst.setProject(name)
    newOpen.value = false
  } catch (err) {
    toast.error('Projekt konnte nicht angelegt werden', { description: errorMessage(err) })
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="glass-panel flex items-center gap-2 py-1 pr-1 pl-3 text-sm">
    <span class="font-medium">Serienaufnahme</span>
    <span v-if="burst.count" class="text-muted-foreground tabular-nums">
      {{ burst.count }} {{ burst.count === 1 ? 'Bild' : 'Bilder' }}
    </span>
    <span class="text-muted-foreground">in</span>

    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="sm" aria-label="Projekt für die Serienaufnahme">
          <FolderIcon v-if="burst.project" data-icon="inline-start" />
          <ImagesIcon v-else data-icon="inline-start" />
          <span class="max-w-48 truncate">{{ burst.project ?? 'Kein Projekt' }}</span>
          <ChevronDownIcon data-icon="inline-end" class="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="center" class="max-h-80 min-w-52">
        <DropdownMenuLabel>Speichern in</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          :model-value="burst.project ?? NO_PROJECT"
          @update:model-value="pick"
        >
          <DropdownMenuRadioItem :value="NO_PROJECT">Kein Projekt</DropdownMenuRadioItem>
          <DropdownMenuRadioItem v-for="name in gallery.projectNames" :key="name" :value="name">
            {{ name }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem @select="newOpen = true">
          <FolderPlusIcon />
          Neues Projekt …
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <NameDialog
      v-model:open="newOpen"
      title="Neues Projekt"
      description="Das Projekt wird als Unterordner im Speicherordner angelegt, die nächsten Bilder kommen dorthin."
      confirm-label="Anlegen"
      placeholder="z. B. Probe 12"
      :taken="projectTaken"
      :busy="creating"
      @confirm="createProject"
    />
  </div>
</template>

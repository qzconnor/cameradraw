<script setup lang="ts">
import { computed } from 'vue'
import { SearchIcon, XIcon } from '@lucide/vue'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group'
import { useGalleryStore } from '@/stores/gallery'
import GalleryViewMenu from './GalleryViewMenu.vue'

const gallery = useGalleryStore()

const placeholder = computed(() =>
  gallery.currentProject ? `In „${gallery.currentProject}“ suchen` : 'Bilder und Projekte suchen'
)

/** Escape first clears the search, only then closes the panel. */
function onEscape(event: KeyboardEvent): void {
  if (!gallery.query) return
  event.stopPropagation()
  gallery.query = ''
}
</script>

<template>
  <div class="flex shrink-0 items-center gap-2 px-4 pt-3">
    <InputGroup>
      <InputGroupInput
        v-model="gallery.query"
        :placeholder="placeholder"
        :aria-label="placeholder"
        autocomplete="off"
        spellcheck="false"
        @keydown.esc="onEscape"
      />
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupAddon v-if="gallery.query" align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Suche leeren" @click="gallery.query = ''">
          <XIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
    <GalleryViewMenu />
  </div>
</template>

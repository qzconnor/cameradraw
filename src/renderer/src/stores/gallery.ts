import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useDebounceFn, useLocalStorage } from '@vueuse/core'
import { itemPath, sameName } from '@shared/names'
import type { GalleryItem, GalleryProject, SaveImageRequest } from '@shared/types'
import {
  collator,
  galleryEntries,
  summarizeProjects,
  type DateFilter,
  type SortDirection,
  type SortKey
} from '@/lib/gallery'
import { useSettingsStore } from './settings'

export const useGalleryStore = defineStore('gallery', () => {
  const settings = useSettingsStore()

  /** All images – of the save folder and of every project. */
  const items = ref<GalleryItem[]>([])
  const projects = ref<GalleryProject[]>([])
  const loading = ref(false)
  /** Path of the most recently saved image (highlighted in the gallery). */
  const lastSaved = ref<string | null>(null)
  /** Project picked when saving last – preselected the next time. */
  const lastProject = useLocalStorage<string | null>('cameradraw.lastProject', null)

  /** Project opened in the gallery, null for the top level. */
  const currentProject = ref<string | null>(null)
  // Search and filter start fresh, the sort order is remembered.
  const query = ref('')
  const dateFilter = ref<DateFilter>('all')
  const sortKey = useLocalStorage<SortKey>('cameradraw.gallery.sortKey', 'date')
  const sortDirection = useLocalStorage<SortDirection>('cameradraw.gallery.sortDirection', 'desc')
  const projectsFirst = useLocalStorage('cameradraw.gallery.projectsFirst', true)

  const summaries = computed(() => summarizeProjects(projects.value, items.value))
  const projectNames = computed(() => projects.value.map((p) => p.name).sort(collator.compare))
  const entries = computed(() =>
    galleryEntries(summaries.value, items.value, {
      project: currentProject.value,
      query: query.value,
      dateFilter: dateFilter.value,
      sort: {
        key: sortKey.value,
        direction: sortDirection.value,
        projectsFirst: projectsFirst.value
      }
    })
  )
  const filtered = computed(() => query.value.trim() !== '' || dateFilter.value !== 'all')

  /** Ignores case, like the file systems of Windows and macOS. */
  const hasProject = (name: string): boolean => projects.value.some((p) => sameName(p.name, name))
  const projectExists = (name: string | null): name is string =>
    name !== null && projects.value.some((p) => p.name === name)

  let initialized = false

  async function refresh(): Promise<void> {
    if (!settings.saveDirAvailable) {
      items.value = []
      projects.value = []
      currentProject.value = null
      return
    }
    loading.value = true
    try {
      const listing = await window.api.library.list()
      items.value = listing.items
      projects.value = listing.projects
      if (!projectExists(currentProject.value)) currentProject.value = null
    } finally {
      loading.value = false
    }
  }

  const refreshDebounced = useDebounceFn(refresh, 150)

  function init(): void {
    if (initialized) return
    initialized = true
    window.api.library.onChanged(() => void refreshDebounced())
    watch(
      () => [settings.saveDir, settings.saveDirAvailable],
      () => void refresh(),
      { immediate: true }
    )
  }

  function browse(project: string | null): void {
    currentProject.value = project
    query.value = ''
  }

  function setSortKey(key: SortKey): void {
    sortKey.value = key
    // Each order starts the natural way round: newest, A → Z, largest.
    sortDirection.value = key === 'name' ? 'asc' : 'desc'
  }

  function resetFilters(): void {
    query.value = ''
    dateFilter.value = 'all'
  }

  async function save(req: SaveImageRequest): Promise<GalleryItem> {
    const item = await window.api.library.save(req)
    lastSaved.value = item.path
    lastProject.value = item.project
    await refresh()
    return item
  }

  async function remove(path: string): Promise<void> {
    await window.api.library.remove(path)
    items.value = items.value.filter((i) => i.path !== path)
  }

  /** Moves an image into a project (null: out of its project); returns the new path. */
  async function move(path: string, project: string | null): Promise<string> {
    // Optimistic, so the card animates away right when it is dropped. The URLs stay until the
    // refresh – the old thumbnail is cached, a new URL would point to a file that is not there yet.
    items.value = items.value.map((i) =>
      i.path === path ? { ...i, project, path: itemPath(project, i.name) } : i
    )
    try {
      const moved = await window.api.library.move(path, project)
      if (lastSaved.value === path) lastSaved.value = moved
      return moved
    } finally {
      await refresh()
    }
  }

  /** Gives an image a new file name (incl. extension); returns its new path. */
  async function renameImage(path: string, name: string): Promise<string> {
    const renamed = await window.api.library.rename(path, name)
    if (lastSaved.value === path) lastSaved.value = renamed
    await refresh()
    return renamed
  }

  async function createProject(name: string): Promise<void> {
    await window.api.library.createProject(name)
    await refresh()
  }

  async function renameProject(from: string, to: string): Promise<void> {
    await window.api.library.renameProject(from, to)
    if (currentProject.value === from) currentProject.value = to
    if (lastProject.value === from) lastProject.value = to
    if (lastSaved.value?.startsWith(`${from}/`)) {
      lastSaved.value = to + lastSaved.value.slice(from.length)
    }
    await refresh()
  }

  async function removeProject(name: string): Promise<void> {
    await window.api.library.removeProject(name)
    if (lastProject.value === name) lastProject.value = null
    await refresh()
  }

  const reveal = (path: string): Promise<void> => window.api.library.reveal(path)
  const openFolder = (): Promise<string> => window.api.library.openFolder()
  const copyImage = (path: string): Promise<void> => window.api.library.copyImage(path)

  return {
    items,
    projects,
    loading,
    lastSaved,
    lastProject,
    currentProject,
    query,
    dateFilter,
    sortKey,
    sortDirection,
    projectsFirst,
    summaries,
    projectNames,
    entries,
    filtered,
    hasProject,
    projectExists,
    init,
    refresh,
    browse,
    setSortKey,
    resetFilters,
    save,
    remove,
    move,
    renameImage,
    createProject,
    renameProject,
    removeProject,
    reveal,
    openFolder,
    copyImage
  }
})

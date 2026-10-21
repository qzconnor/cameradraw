import type { GalleryItem, GalleryProject } from '@shared/types'

export type SortKey = 'date' | 'name' | 'size'
export type SortDirection = 'asc' | 'desc'
export type DateFilter = 'all' | 'today' | 'week' | 'month'

export interface GallerySort {
  key: SortKey
  direction: SortDirection
  /** Projects above the images (otherwise both are sorted together). */
  projectsFirst: boolean
}

/** A project with what the gallery shows about it. */
export interface ProjectSummary {
  name: string
  /** Latest change: the folder itself or its newest image. */
  mtime: number
  count: number
  /** Total size of its images. */
  size: number
  /** Thumbnails of the newest images (up to 3), newest first. */
  covers: string[]
}

export type GalleryEntry =
  | { kind: 'project'; key: string; project: ProjectSummary }
  | { kind: 'image'; key: string; item: GalleryItem }
  | { kind: 'heading'; key: string; label: string; count: number }

export interface GalleryView {
  /** Project shown, null for the top level. */
  project: string | null
  query: string
  dateFilter: DateFilter
  sort: GallerySort
}

export const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' })

export function summarizeProjects(
  projects: GalleryProject[],
  items: GalleryItem[]
): ProjectSummary[] {
  const byName = new Map(projects.map((p) => [p.name, { ...p, images: [] as GalleryItem[] }]))
  for (const item of items) if (item.project) byName.get(item.project)?.images.push(item)
  return [...byName.values()].map(({ name, mtime, images }) => {
    const newest = [...images].sort((a, b) => b.mtime - a.mtime)
    return {
      name,
      mtime: Math.max(mtime, newest[0]?.mtime ?? 0),
      count: images.length,
      size: images.reduce((sum, i) => sum + i.size, 0),
      covers: newest.slice(0, 3).map((i) => i.thumbUrl)
    }
  })
}

const DAY = 86_400_000

/** Start (ms) of the period a date filter keeps. */
function periodStart(filter: DateFilter): number {
  if (filter === 'all') return 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = { today: 0, week: 6, month: 29 }[filter]
  return today.getTime() - days * DAY
}

interface Sortable {
  name: string
  mtime: number
  size: number
}

function compare(a: Sortable, b: Sortable, sort: GallerySort): number {
  const diff =
    sort.key === 'name'
      ? collator.compare(a.name, b.name)
      : sort.key === 'size'
        ? a.size - b.size
        : a.mtime - b.mtime
  return (sort.direction === 'asc' ? diff : -diff) || collator.compare(a.name, b.name)
}

const sortable = (e: GalleryEntry): Sortable =>
  e.kind === 'project' ? e.project : e.kind === 'image' ? e.item : { name: '', mtime: 0, size: 0 }

/** What the gallery shows for a view: its projects and images, filtered and sorted. */
export function galleryEntries(
  projects: ProjectSummary[],
  items: GalleryItem[],
  view: GalleryView
): GalleryEntry[] {
  const query = view.query.trim().toLocaleLowerCase()
  const matches = (name: string): boolean => !query || name.toLocaleLowerCase().includes(query)
  const since = periodStart(view.dateFilter)

  const images: GalleryEntry[] = items
    .filter((i) =>
      view.project !== null
        ? i.project === view.project
        : // Searching at the top level also finds images inside projects.
          i.project === null || query !== ''
    )
    .filter((i) => i.mtime >= since && matches(i.name))
    .map((item) => ({ kind: 'image', key: `i:${item.path}`, item }))

  const folders: GalleryEntry[] =
    view.project !== null
      ? []
      : projects
          .filter((p) => p.mtime >= since && matches(p.name))
          .map((project) => ({ kind: 'project', key: `p:${project.name}`, project }))

  const byView = (a: GalleryEntry, b: GalleryEntry): number =>
    compare(sortable(a), sortable(b), view.sort)

  if (!view.sort.projectsFirst) return [...folders, ...images].sort(byView)
  if (!folders.length || !images.length) return [...folders.sort(byView), ...images.sort(byView)]
  return [
    { kind: 'heading', key: 'h:projects', label: 'Projekte', count: folders.length },
    ...folders.sort(byView),
    { kind: 'heading', key: 'h:images', label: 'Bilder', count: images.length },
    ...images.sort(byView)
  ]
}

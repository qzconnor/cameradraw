import { ref, shallowRef } from 'vue'
import { createEventHook, createSharedComposable, useRafFn } from '@vueuse/core'
import type { GalleryItem } from '@shared/types'

/**
 * Dragging gallery images onto projects (pointer events, so the card can be animated freely).
 *
 * Drop targets are elements with `data-drop-project`: the project name, or an empty string for
 * "Kein Projekt" (directly in the save folder). While the pointer is over an element with
 * `data-drag-dock`, the list does not scroll.
 */

export interface GalleryDrag {
  item: GalleryItem
  /** Card the drag started on – the ghost flies back to it when the drop is cancelled. */
  source: HTMLElement
  width: number
  height: number
  /** Where the card was grabbed, relative to its top left corner. */
  offsetX: number
  offsetY: number
}

/** `drop` / `cancel`: the ghost is animating into the target / back to the card. */
export type DragPhase = 'drag' | 'drop' | 'cancel'

const THRESHOLD = 6 // px the pointer has to move before a press becomes a drag
const EDGE = 56 // px at the list's top and bottom edge that scroll it
const MAX_SCROLL = 18 // px per frame

const projectKey = (project: string | null): string => project ?? ''

export const useGalleryDrag = createSharedComposable(() => {
  const active = shallowRef<GalleryDrag | null>(null)
  const phase = ref<DragPhase>('drag')
  /** Drop target under the pointer: a project name, '' for "Kein Projekt", null for none. */
  const over = ref<string | null>(null)
  /** Last successful drop – the target plays a short "received" animation. */
  const landing = ref<{ project: string | null; at: number } | null>(null)
  /** Pointer position – not reactive, the ghost reads it every frame. */
  const pointer = { x: 0, y: 0 }

  const dropped = createEventHook<{ item: GalleryItem; project: string | null }>()

  let target: HTMLElement | null = null
  let overDock = false
  let viewport: HTMLElement | null = null
  let fallback: ReturnType<typeof setTimeout> | undefined

  /** The dragged image could be dropped into `project` (null: "Kein Projekt"). */
  const canDrop = (project: string | null): boolean =>
    !!active.value && projectKey(active.value.item.project) !== projectKey(project)
  const isOver = (project: string | null): boolean => over.value === projectKey(project)
  const isDragged = (path: string): boolean => active.value?.item.path === path
  /** Current screen position of the target under the pointer. */
  const targetRect = (): DOMRect | null => target?.getBoundingClientRect() ?? null

  function updateTarget(): void {
    const el = document.elementFromPoint(pointer.x, pointer.y)
    const found = el?.closest<HTMLElement>('[data-drop-project]') ?? null
    const project = found?.dataset.dropProject
    const valid = project !== undefined && canDrop(project || null)
    target = valid ? found : null
    over.value = valid ? project : null
    overDock = !!el?.closest('[data-drag-dock]')
  }

  // Scrolls the list while the pointer is near (or beyond) its top or bottom edge.
  const autoScroll = useRafFn(
    () => {
      if (!viewport || target || overDock) return
      const r = viewport.getBoundingClientRect()
      if (pointer.x < r.left || pointer.x > r.right) return
      let speed = 0
      if (pointer.y < r.top + EDGE) speed = -Math.min(1, (r.top + EDGE - pointer.y) / EDGE)
      else if (pointer.y > r.bottom - EDGE) {
        speed = Math.min(1, (pointer.y - r.bottom + EDGE) / EDGE)
      }
      if (!speed) return
      viewport.scrollTop += speed * MAX_SCROLL
      updateTarget()
    },
    { immediate: false }
  )

  function begin(item: GalleryItem, source: HTMLElement, startX: number, startY: number): void {
    const rect = source.getBoundingClientRect()
    clearTimeout(fallback)
    phase.value = 'drag'
    active.value = {
      item,
      source,
      width: rect.width,
      height: rect.height,
      offsetX: startX - rect.left,
      offsetY: startY - rect.top
    }
    viewport = source.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
    document.documentElement.dataset.dragging = ''
    autoScroll.resume()
  }

  /** The click that follows the drag's pointerup must not open the image. */
  function swallowClick(): void {
    const swallow = (e: MouseEvent): void => {
      e.stopPropagation()
      e.preventDefault()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, true))
  }

  function release(drop: boolean): void {
    autoScroll.pause()
    delete document.documentElement.dataset.dragging
    swallowClick()
    const drag = active.value!
    if (drop && target) {
      phase.value = 'drop'
      void dropped.trigger({ item: drag.item, project: over.value || null })
    } else {
      phase.value = 'cancel'
      target = null
      over.value = null
    }
    // In case the ghost cannot finish its animation.
    fallback = setTimeout(finish, 1000)
  }

  /** Called by the ghost when its drop / return animation is over. */
  function finish(): void {
    clearTimeout(fallback)
    if (!active.value) return
    if (phase.value === 'drop') landing.value = { project: over.value || null, at: Date.now() }
    active.value = null
    phase.value = 'drag'
    target = null
    over.value = null
    viewport = null
  }

  /** Pointer down on an image card – turns into a drag once the pointer moves a little. */
  function press(e: PointerEvent, item: GalleryItem): void {
    if (e.button !== 0 || e.pointerType === 'touch' || active.value) return
    const source = e.currentTarget as HTMLElement
    const { pointerId, clientX: startX, clientY: startY } = e

    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      pointer.x = ev.clientX
      pointer.y = ev.clientY
      if (!active.value) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return
        begin(item, source, startX, startY)
      }
      updateTarget()
    }
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      stop()
      if (active.value && phase.value === 'drag') release(ev.type === 'pointerup')
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape' || !active.value || phase.value !== 'drag') return
      // Captured before the side panel sees it: Escape cancels the drag instead of closing it.
      ev.preventDefault()
      ev.stopPropagation()
      stop()
      release(false)
    }
    function stop(): void {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      window.removeEventListener('keydown', onKey, true)
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    window.addEventListener('keydown', onKey, true)
  }

  return {
    active,
    phase,
    over,
    landing,
    pointer,
    press,
    finish,
    canDrop,
    isOver,
    isDragged,
    targetRect,
    onDrop: dropped.on
  }
})

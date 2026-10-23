<script setup lang="ts">
import { ref, useTemplateRef, watch } from 'vue'
import { useRafFn } from '@vueuse/core'
import { FolderInputIcon, ImagePlusIcon, ImagesIcon } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { useGalleryDrag } from '@/composables/useGalleryDrag'
import { cn } from '@/lib/utils'

/** The image card following the pointer while it is dragged onto a project. */
const drag = useGalleryDrag()
const { active, phase, over, overEditor } = drag
const ghost = useTemplateRef<HTMLElement>('ghost')

/** Target under the pointer ('' = "Kein Projekt") – kept while the hint fades out. */
const label = ref('')
const intoEditor = ref(false)
watch([over, overEditor], ([project, editor]) => {
  if (editor) intoEditor.value = true
  else if (project !== null) {
    intoEditor.value = false
    label.value = project
  }
})

// Animated state, eased towards its goal every frame.
let x = 0
let y = 0
let lastX = 0
let scale = 1
let tilt = 0
let pull = 0

function transform(px: number, py: number, rotate: number, s: number): string {
  const d = active.value!
  return `translate3d(${px - d.offsetX}px, ${py - d.offsetY}px, 0) rotate(${rotate}deg) scale(${s})`
}

const raf = useRafFn(
  () => {
    const el = ghost.value
    if (!el || !active.value || phase.value !== 'drag') return
    const { x: px, y: py } = drag.pointer
    // Tilts in the direction of movement, like a card held at the grabbed point.
    const velocity = px - lastX
    lastX = px
    tilt += (Math.max(-12, Math.min(12, velocity * 0.9)) - tilt) * 0.15
    // Over a target the card shrinks and is pulled towards it a little.
    const rect = drag.targetRect()
    pull += ((rect ? 0.22 : 0) - pull) * 0.2
    scale += ((rect ? 0.7 : 1.05) - scale) * 0.2
    const cx = rect ? rect.left + rect.width / 2 : px
    const cy = rect ? rect.top + rect.height / 2 : py
    x = px + (cx - px) * pull
    y = py + (cy - py) * pull
    el.style.transform = transform(x, y, tilt, scale)
  },
  { immediate: false }
)

watch(active, (d) => {
  if (!d) return raf.pause()
  x = lastX = drag.pointer.x
  y = drag.pointer.y
  scale = 1
  tilt = 0
  pull = 0
  raf.resume()
})

// Drop: the card is sucked into the target. Cancel: it flies back to where it came from.
watch(phase, async (next) => {
  const el = ghost.value
  const d = active.value
  if (!el || !d || next === 'drag') return
  raf.pause()
  const from = el.style.transform
  let keyframes: Parameters<Element['animate']>[0]
  if (next === 'drop') {
    const rect = drag.targetRect()
    const to = rect
      ? transform(rect.left + rect.width / 2, rect.top + rect.height / 2, 0, 0.1)
      : transform(x, y, 0, 0.1)
    keyframes = [{ transform: from }, { opacity: 1, offset: 0.55 }, { transform: to, opacity: 0 }]
  } else {
    const rect = d.source.isConnected ? d.source.getBoundingClientRect() : null
    keyframes = rect
      ? [
          { transform: from },
          { transform: transform(rect.left + d.offsetX, rect.top + d.offsetY, 0, 1) }
        ]
      : [{ transform: from }, { transform: from, opacity: 0 }]
  }
  const animation = el.animate(keyframes, {
    duration: next === 'drop' ? 380 : 340,
    easing:
      next === 'drop' ? 'cubic-bezier(0.55, 0, 0.7, 0.2)' : 'cubic-bezier(0.2, 0.9, 0.3, 1.15)',
    fill: 'forwards'
  })
  await animation.finished.catch(() => undefined)
  drag.finish()
})
</script>

<template>
  <Teleport to="body">
    <!-- z-[60]: above the side panel and its menus while dragging. -->
    <div
      v-if="active"
      ref="ghost"
      class="pointer-events-none fixed top-0 left-0 z-[60] will-change-transform"
      :style="{
        width: `${active.width}px`,
        height: `${active.height}px`,
        transformOrigin: `${active.offsetX}px ${active.offsetY}px`
      }"
    >
      <div class="size-full overflow-hidden rounded-lg bg-muted shadow-2xl ring-2 ring-primary">
        <img :src="active.item.thumbUrl" alt="" draggable="false" class="size-full object-cover" />
      </div>
      <Badge
        :class="
          cn(
            'absolute top-full left-1/2 mt-2 -translate-x-1/2 shadow-lg transition-opacity duration-150',
            over === null && !overEditor && 'opacity-0'
          )
        "
      >
        <template v-if="intoEditor">
          <ImagePlusIcon data-icon="inline-start" />
          Ins Bild einfügen
        </template>
        <template v-else>
          <ImagesIcon v-if="!label" data-icon="inline-start" />
          <FolderInputIcon v-else data-icon="inline-start" />
          {{ label || 'Kein Projekt' }}
        </template>
      </Badge>
    </div>
  </Teleport>
</template>

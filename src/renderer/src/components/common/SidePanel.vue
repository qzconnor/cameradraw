<script setup lang="ts">
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { usePanelsStore, type PanelName } from '@/stores/panels'

/**
 * Floating panel that slides in from the right below the title bar (gallery, settings).
 * Non-modal: no backdrop, the camera stays visible; a click outside or Escape closes it.
 * Its toggle button must carry `data-panel-toggle="<name>"`.
 */
const props = defineProps<{ name: PanelName }>()

const panels = usePanelsStore()

/** The toggle button handles its own click – otherwise the "outside click" would reopen the panel. */
function ignoreToggle(event: Event): void {
  const target = event.target as HTMLElement | null
  if (target?.closest?.(`[data-panel-toggle="${props.name}"]`)) event.preventDefault()
}

/**
 * Focus the panel itself instead of its first button: a focused button shows its tooltip, and the
 * tooltip would swallow the first Escape press.
 */
function focusPanel(event: Event): void {
  event.preventDefault()
  ;(event.target as HTMLElement | null)?.focus({ preventScroll: true })
}
</script>

<template>
  <Sheet :open="panels.isOpen(name)" :modal="false" @update:open="panels.setOpen(name, $event)">
    <!-- z-40 (one below the sheet default): the panel is part of the app surface, so tooltips,
         selects, menus and dialogs (all z-50) must stay above it. -->
    <SheetContent
      side="right"
      class="z-40 top-14! right-3! bottom-3! h-auto! w-[26rem]! max-w-[calc(100vw-1.5rem)]! gap-0 overflow-hidden rounded-2xl border-0! bg-popover/65 shadow-2xl ring-1 ring-foreground/10 backdrop-blur-2xl backdrop-saturate-150"
      @open-auto-focus="focusPanel"
      @close-auto-focus.prevent
      @pointer-down-outside="ignoreToggle"
      @focus-outside="ignoreToggle"
    >
      <slot />
    </SheetContent>
  </Sheet>
</template>

import { ref } from 'vue'
import { defineStore } from 'pinia'

export type PanelName = 'gallery' | 'settings' | 'modules' | 'updates'

/** Side panels sliding in from the right – only one is open at a time. */
export const usePanelsStore = defineStore('panels', () => {
  const active = ref<PanelName | null>(null)

  const isOpen = (name: PanelName): boolean => active.value === name

  function setOpen(name: PanelName, open: boolean): void {
    if (open) active.value = name
    // Only close if this panel is still the active one (another may have replaced it already).
    else if (active.value === name) active.value = null
  }

  const toggle = (name: PanelName): void => setOpen(name, !isOpen(name))

  return { active, isOpen, setOpen, toggle }
})

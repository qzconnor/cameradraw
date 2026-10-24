import { ref } from 'vue'
import { defineStore } from 'pinia'

export type PanelName = 'gallery' | 'settings' | 'modules' | 'updates'

/** Tabs of the settings panel. */
export const SETTINGS_TABS = ['general', 'camera', 'picture', 'ai'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

/** Side panels sliding in from the right – only one is open at a time. */
export const usePanelsStore = defineStore('panels', () => {
  const active = ref<PanelName | null>(null)
  /** Tab the settings panel shows – kept while it is closed. */
  const settingsTab = ref<SettingsTab>('general')

  const isOpen = (name: PanelName): boolean => active.value === name

  function setOpen(name: PanelName, open: boolean): void {
    if (open) active.value = name
    // Only close if this panel is still the active one (another may have replaced it already).
    else if (active.value === name) active.value = null
  }

  const toggle = (name: PanelName): void => setOpen(name, !isOpen(name))

  function closeAll(): void {
    active.value = null
  }

  function openSettings(tab: SettingsTab): void {
    settingsTab.value = tab
    setOpen('settings', true)
  }

  return { active, settingsTab, isOpen, setOpen, toggle, closeAll, openSettings }
})

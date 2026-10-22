import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { toast } from 'vue-sonner'
import type { ReleaseNote, UpdateState } from '@shared/types'
import { errorMessage } from '@/lib/format'
import { useEditorStore } from './editor'
import { usePanelsStore } from './panels'

export const useUpdatesStore = defineStore('updates', () => {
  const panels = usePanelsStore()

  const state = ref<UpdateState>({
    status: 'unsupported',
    current: '',
    next: null,
    progress: 0,
    checkedAt: null,
    error: null
  })
  const releases = ref<ReleaseNote[] | null>(null)
  const releasesLoading = ref(false)
  const releasesError = ref<string | null>(null)
  /** Version whose notes were looked at – if the installed one differs, the app was updated. */
  const seenVersion = useLocalStorage<string | null>('cameradraw.seenVersion', null)

  /** A newer version is offered (also while downloading, or after a failed download). */
  const hasUpdate = computed(
    () =>
      ['available', 'downloading', 'downloaded'].includes(state.value.status) ||
      (state.value.status === 'error' && state.value.next !== null)
  )
  /** Updated since the notes were last opened – "what's new" is still to be seen. */
  const unseen = computed(
    () => !!state.value.current && !!seenVersion.value && seenVersion.value !== state.value.current
  )

  const show = (): void => panels.setOpen('updates', true)

  let announced: string | null = null

  function apply(next: UpdateState): void {
    const before = state.value.status
    state.value = next
    if (next.status === 'available' && next.next && announced !== next.next) {
      announced = next.next
      toast(`Update auf ${next.next} verfügbar`, {
        description: 'Es lässt sich direkt in der App installieren.',
        duration: 12_000,
        action: { label: 'Ansehen', onClick: show }
      })
    }
    if (next.status === 'downloaded' && before !== 'downloaded') {
      toast.success('Update ist bereit', {
        description: `Version ${next.next} wird beim nächsten Start installiert.`,
        duration: 15_000,
        action: { label: 'Jetzt neu starten', onClick: install }
      })
    }
  }

  let initialized = false

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    window.api.updates.onChanged(apply)
    window.api.updates.onShow(show)
    apply(await window.api.updates.state())

    // A fresh install has nothing new to announce.
    if (seenVersion.value === null) seenVersion.value = state.value.current
    else if (unseen.value) {
      toast.success(`CameraDraw ist jetzt auf Version ${state.value.current}`, {
        duration: 12_000,
        action: { label: 'Was ist neu?', onClick: show }
      })
    }
  }

  function markSeen(): void {
    seenVersion.value = state.value.current
  }

  /** Loads the notes again – the main process keeps them for a few minutes, so this is cheap. */
  async function loadReleases(): Promise<void> {
    releasesLoading.value = true
    try {
      releases.value = await window.api.updates.releases()
      releasesError.value = null
    } catch (err) {
      // Notes shown already stay; the error only matters without them.
      if (!releases.value?.length) releasesError.value = errorMessage(err)
    } finally {
      releasesLoading.value = false
    }
  }

  const check = (): Promise<void> => window.api.updates.check()
  const download = (): Promise<void> => window.api.updates.download()
  /**
   * Asks first if a drawing is unsaved: the installer would close the app anyway, so the question
   * has to come before it starts.
   */
  function install(): void {
    useEditorStore().guard(() => window.api.updates.install())
  }

  return {
    state,
    releases,
    releasesLoading,
    releasesError,
    hasUpdate,
    unseen,
    init,
    markSeen,
    loadReleases,
    check,
    download,
    install
  }
})

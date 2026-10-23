import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { McpStatus } from '@shared/mcp'
import { runRemoteAction } from '@/mcp/actions'
import { activityOf, clientLabel } from '@/mcp/activity'

/** Calls take milliseconds – "busy" stays a moment longer, so it can be seen at all. */
const BUSY_LINGER = 1500
/**
 * A client thinks between its calls – it still counts as at work for this long after the last one,
 * so the app does not flicker between "controlled" and not.
 */
const ENGAGED_LINGER = 15_000

/** The pointer a client clicks and drags with (window coordinates, CSS pixels). */
export interface ClientPointer {
  x: number
  y: number
  pressed: boolean
}

/** The MCP server (remote control by AI assistants): its status, and answering its requests. */
export const useMcpStore = defineStore('mcp', () => {
  const status = ref<McpStatus | null>(null)
  /** A client is doing something right now (or just did). */
  const busy = ref(false)
  /** A client is at work: it called a tool a short while ago, or is calling one now. */
  const engaged = ref(false)
  /** Where the client's pointer is – null until it clicks or points somewhere. */
  const pointer = ref<ClientPointer | null>(null)
  /** Counts the clicks of the client (each one ripples where it was). */
  const clicks = ref(0)

  const clientName = computed(() => clientLabel(status.value?.lastClient?.name))
  /** What the client does right now, e.g. "zeichnet". */
  const activity = computed(() => activityOf(status.value?.lastCall?.tool))

  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let engagedTimer: ReturnType<typeof setTimeout> | undefined
  watch(
    () => status.value?.activeCalls ?? 0,
    (calls) => {
      clearTimeout(idleTimer)
      clearTimeout(engagedTimer)
      if (calls > 0) {
        busy.value = true
        engaged.value = true
        return
      }
      idleTimer = setTimeout(() => (busy.value = false), BUSY_LINGER)
      engagedTimer = setTimeout(() => (engaged.value = false), ENGAGED_LINGER)
    }
  )
  // The pointer goes with the client.
  watch(engaged, (value) => {
    if (!value) pointer.value = null
  })

  /** Shows the client's pointer at a point of the window, e.g. where it has just drawn. */
  function pointTo(x: number, y: number): void {
    pointer.value = { x, y, pressed: false }
  }

  let initialized = false

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    window.api.mcp.onStatus((value) => (status.value = value))
    window.api.mcp.serve(runRemoteAction)
    window.api.mcp.onPointer(({ x, y, action }) => {
      if (action === 'down') clicks.value++
      const pressed = action === 'down' || (action === 'move' && !!pointer.value?.pressed)
      pointer.value = { x, y, pressed }
    })
    status.value = await window.api.mcp.status()
  }

  return { status, busy, engaged, pointer, clicks, clientName, activity, pointTo, init }
})

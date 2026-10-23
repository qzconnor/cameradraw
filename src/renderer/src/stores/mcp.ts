import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { McpStatus } from '@shared/mcp'
import { runRemoteAction } from '@/mcp/actions'

/** Calls take milliseconds – "busy" stays a moment longer, so it can be seen at all. */
const BUSY_LINGER = 1500

/** The MCP server (remote control by AI assistants): its status, and answering its requests. */
export const useMcpStore = defineStore('mcp', () => {
  const status = ref<McpStatus | null>(null)
  /** A client is doing something right now (or just did). */
  const busy = ref(false)

  let idleTimer: ReturnType<typeof setTimeout> | undefined
  watch(
    () => status.value?.activeCalls ?? 0,
    (calls) => {
      clearTimeout(idleTimer)
      if (calls > 0) busy.value = true
      else idleTimer = setTimeout(() => (busy.value = false), BUSY_LINGER)
    }
  )

  let initialized = false

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    window.api.mcp.onStatus((value) => (status.value = value))
    window.api.mcp.serve(runRemoteAction)
    status.value = await window.api.mcp.status()
  }

  return { status, busy, init }
})

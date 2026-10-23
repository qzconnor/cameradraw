<script setup lang="ts">
import { computed } from 'vue'
import { refAutoReset } from '@vueuse/core'
import { CheckIcon, CircleCheckIcon, CircleXIcon, CopyIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle
} from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage, formatDateTime } from '@/lib/format'
import { useMcpStore } from '@/stores/mcp'

/** One line: is the MCP server running, where, and who used it last. */
const mcp = useMcpStore()

const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })

/** `um 15:32` today, otherwise with the date. */
function when(ms: number): string {
  const today = new Date().toDateString() === new Date(ms).toDateString()
  return today ? `um ${time.format(ms)}` : `am ${formatDateTime(ms)}`
}

const description = computed(() => {
  const status = mcp.status
  if (!status) return null
  if (status.state === 'error') return status.error
  if (status.state !== 'running') return null
  const client = status.lastClient
  if (mcp.busy) return `${client?.name ?? 'Ein Client'} bedient CameraDraw gerade.`
  return client
    ? `Zuletzt verbunden: ${client.name} ${when(client.at)}`
    : 'Noch kein Client verbunden.'
})

const copied = refAutoReset(false, 1500)

async function copyUrl(): Promise<void> {
  if (!mcp.status) return
  try {
    await window.api.clipboard.writeText(mcp.status.url)
    copied.value = true
  } catch (err) {
    toast.error('Kopieren fehlgeschlagen', { description: errorMessage(err) })
  }
}
</script>

<template>
  <Item variant="outline" size="sm">
    <ItemMedia variant="icon">
      <CircleCheckIcon v-if="mcp.status?.state === 'running'" class="text-success" />
      <CircleXIcon v-else-if="mcp.status?.state === 'error'" class="text-destructive" />
      <Spinner v-else />
    </ItemMedia>
    <ItemContent class="min-w-0">
      <ItemTitle>
        {{
          mcp.status?.state === 'running'
            ? 'MCP-Server läuft'
            : mcp.status?.state === 'error'
              ? 'MCP-Server läuft nicht'
              : 'MCP-Server startet …'
        }}
      </ItemTitle>
      <ItemDescription v-if="mcp.status?.state === 'running'" class="truncate font-mono">
        {{ mcp.status.url }}
      </ItemDescription>
      <ItemDescription v-if="description">{{ description }}</ItemDescription>
    </ItemContent>
    <ItemActions v-if="mcp.status?.state === 'running'">
      <HintTooltip :label="copied ? 'Kopiert' : 'Adresse kopieren'">
        <Button variant="outline" size="icon-sm" aria-label="Adresse kopieren" @click="copyUrl">
          <CheckIcon v-if="copied" />
          <CopyIcon v-else />
        </Button>
      </HintTooltip>
    </ItemActions>
  </Item>
</template>

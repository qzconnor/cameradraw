<script setup lang="ts">
import { computed } from 'vue'
import { refAutoReset, useLocalStorage } from '@vueuse/core'
import { CheckIcon, CopyIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { MCP_SERVER_NAME } from '@shared/mcp'
import { FieldDescription } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea
} from '@/components/ui/input-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { errorMessage } from '@/lib/format'

/** How to connect an MCP client – a snippet per client, ready to copy. */
const props = defineProps<{ url: string }>()

interface ClientSetup {
  id: string
  label: string
  /** Where the snippet goes. */
  place: string
  hint: string
  code: string
}

const json = (value: unknown): string => JSON.stringify(value, null, 2)

const clients = computed<ClientSetup[]>(() => [
  {
    id: 'claude-code',
    label: 'Claude Code',
    place: 'Terminal',
    hint: 'Einmal im Terminal ausführen. Mit --scope user gilt es in allen Projekten, sonst nur im aktuellen.',
    code: `claude mcp add --transport http ${MCP_SERVER_NAME} ${props.url}`
  },
  {
    id: 'vscode',
    label: 'VS Code',
    place: '.vscode/mcp.json',
    hint: 'In die Datei des Projekts eintragen – oder über „MCP: Server hinzufügen“ als HTTP-Server.',
    code: json({ servers: { [MCP_SERVER_NAME]: { type: 'http', url: props.url } } })
  },
  {
    id: 'cursor',
    label: 'Cursor',
    place: '~/.cursor/mcp.json',
    hint: 'Für alle Projekte – oder in .cursor/mcp.json eines Projekts.',
    code: json({ mcpServers: { [MCP_SERVER_NAME]: { url: props.url } } })
  },
  {
    id: 'other',
    label: 'Andere',
    place: 'JSON',
    hint: 'Für jeden MCP-Client mit „Streamable HTTP“, z. B. als .mcp.json im Projekt für Claude Code.',
    code: json({ mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url: props.url } } })
  }
])

const tab = useLocalStorage('cameradraw.mcp.client', 'claude-code')
/** The snippet copied last – its button shows a check mark for a moment. */
const copied = refAutoReset<string | null>(null, 1500)

async function copy(client: ClientSetup): Promise<void> {
  try {
    await window.api.clipboard.writeText(client.code)
    copied.value = client.id
  } catch (err) {
    toast.error('Kopieren fehlgeschlagen', { description: errorMessage(err) })
  }
}
</script>

<template>
  <Tabs v-model="tab" class="gap-2">
    <TabsList class="w-full">
      <TabsTrigger v-for="client in clients" :key="client.id" :value="client.id">
        {{ client.label }}
      </TabsTrigger>
    </TabsList>
    <TabsContent
      v-for="client in clients"
      :key="client.id"
      :value="client.id"
      class="flex flex-col gap-2"
    >
      <InputGroup>
        <InputGroupTextarea
          :model-value="client.code"
          :rows="client.code.split('\n').length"
          readonly
          spellcheck="false"
          :aria-label="`Konfiguration für ${client.label}`"
          class="min-h-0 font-mono text-xs md:text-xs"
        />
        <InputGroupAddon align="block-end" class="border-t">
          <InputGroupText>{{ client.place }}</InputGroupText>
          <InputGroupButton class="ml-auto" @click="copy(client)">
            <CheckIcon v-if="copied === client.id" data-icon="inline-start" />
            <CopyIcon v-else data-icon="inline-start" />
            {{ copied === client.id ? 'Kopiert' : 'Kopieren' }}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <FieldDescription>{{ client.hint }}</FieldDescription>
    </TabsContent>
  </Tabs>
</template>

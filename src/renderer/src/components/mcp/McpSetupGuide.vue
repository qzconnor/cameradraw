<script setup lang="ts">
import { computed } from 'vue'
import { refAutoReset, useLocalStorage } from '@vueuse/core'
import { CheckIcon, CopyIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { MCP_SERVER_NAME, type McpStdioCommand, type McpTransport } from '@shared/mcp'
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

/** How to connect an MCP client – a snippet per client and connection type, ready to copy. */
const props = defineProps<{
  transport: McpTransport
  url: string
  stdio: McpStdioCommand
}>()

interface ClientSetup {
  id: string
  label: string
  /** Where the snippet goes. */
  place: string
  hint: string
  code: string
}

const json = (value: unknown): string => JSON.stringify(value, null, 2)
/** For a command line – paths may contain spaces. */
const quote = (value: string): string => (/[\s"]/.test(value) ? `"${value}"` : value)

const httpClients = computed<ClientSetup[]>(() => [
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

const stdioClients = computed<ClientSetup[]>(() => {
  const { command, args } = props.stdio
  const server = { command, args }
  return [
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      place: 'claude_desktop_config.json',
      hint: 'In Claude unter Einstellungen → Entwickler → „Konfiguration bearbeiten“ bei „mcpServers“ eintragen und Claude neu starten. CameraDraw sollte dann schon laufen.',
      code: json({ mcpServers: { [MCP_SERVER_NAME]: server } })
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      place: 'Terminal',
      hint: 'Einmal im Terminal ausführen. Mit --scope user gilt es in allen Projekten, sonst nur im aktuellen.',
      code: ['claude mcp add', MCP_SERVER_NAME, '--', ...[command, ...args].map(quote)].join(' ')
    },
    {
      id: 'vscode',
      label: 'VS Code',
      place: '.vscode/mcp.json',
      hint: 'In die Datei des Projekts eintragen.',
      code: json({ servers: { [MCP_SERVER_NAME]: { type: 'stdio', ...server } } })
    },
    {
      id: 'other',
      label: 'Andere',
      place: 'JSON',
      hint: 'Für jeden MCP-Client, der Programme startet, z. B. Cursor (~/.cursor/mcp.json).',
      code: json({ mcpServers: { [MCP_SERVER_NAME]: server } })
    }
  ]
})

const clients = computed(() =>
  props.transport === 'stdio' ? stdioClients.value : httpClients.value
)

const picked = useLocalStorage<Record<McpTransport, string>>('cameradraw.mcp.clients', {
  http: 'claude-code',
  stdio: 'claude-desktop'
})
/** The client shown – remembered per connection type. */
const tab = computed({
  get: () =>
    clients.value.find((c) => c.id === picked.value[props.transport])?.id ?? clients.value[0].id,
  set: (id: string) => (picked.value = { ...picked.value, [props.transport]: id })
})

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
          class="min-h-0 font-mono text-xs break-all md:text-xs"
        />
        <InputGroupAddon align="block-end" class="border-t">
          <InputGroupText class="min-w-0 truncate">{{ client.place }}</InputGroupText>
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

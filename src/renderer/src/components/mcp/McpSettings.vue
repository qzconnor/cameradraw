<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { isValidMcpPort, mcpUrl } from '@shared/mcp'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { errorMessage } from '@/lib/format'
import { useMcpStore } from '@/stores/mcp'
import { useSettingsStore } from '@/stores/settings'
import McpSetupGuide, { type McpTransport } from './McpSetupGuide.vue'
import McpStatusItem from './McpStatusItem.vue'

/** Settings of the MCP server (off by default) and how to connect a client to it. */
const settings = useSettingsStore()
const mcp = useMcpStore()

async function update(patch: Parameters<typeof settings.update>[0]): Promise<void> {
  try {
    await settings.update(patch)
  } catch (err) {
    toast.error('Einstellung konnte nicht gespeichert werden', { description: errorMessage(err) })
  }
}

// The port is applied when the field is left or Enter is pressed, not with every digit.
const port = ref(String(settings.mcpPort))
watch(
  () => settings.mcpPort,
  (value) => (port.value = String(value))
)
const portProblem = computed(() =>
  isValidMcpPort(Number(port.value)) ? null : 'Bitte einen Port zwischen 1024 und 65535 eingeben.'
)

function applyPort(): void {
  const value = Number(port.value)
  if (!portProblem.value && value !== settings.mcpPort) void update({ mcpPort: value })
}

const url = computed(() => mcp.status?.url ?? mcpUrl(settings.mcpPort))

/** HTTP for clients that connect to an address, stdio for those that only start programs. */
const transport = useLocalStorage<McpTransport>('cameradraw.mcp.transport', 'http')

const TRANSPORT_HINTS: Record<McpTransport, string> = {
  http: 'Der Client verbindet sich direkt mit CameraDraw – für Claude Code, VS Code, Cursor und die meisten anderen.',
  stdio:
    'Der Client startet eine kleine Brücke aus CameraDraw – für Claude Desktop und Clients, die nur Programme starten.'
}

/** The picked connection stands out clearly – the default muted look is faint on the panel. */
const PICKED =
  'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90'

function pickTransport(value: unknown): void {
  // Clicking the active item would deselect it – one of them is always picked.
  if (value === 'http' || value === 'stdio') transport.value = value
}
</script>

<template>
  <Field orientation="horizontal">
    <FieldContent>
      <!-- Clicking the label toggles the switch. -->
      <FieldLabel for="settings-mcp" class="cursor-pointer">KI-Steuerung (MCP-Server)</FieldLabel>
      <FieldDescription>
        KI-Assistenten wie Claude Code bedienen CameraDraw dann live – Kamera, Aufnahme, Galerie und
        Editor. Erreichbar nur auf diesem Rechner, ohne Anmeldung.
      </FieldDescription>
    </FieldContent>
    <Switch
      id="settings-mcp"
      class="self-center"
      :model-value="settings.mcpEnabled"
      @update:model-value="update({ mcpEnabled: $event })"
    />
  </Field>

  <template v-if="settings.mcpEnabled">
    <McpStatusItem />

    <Field orientation="horizontal" :data-invalid="!!portProblem || undefined">
      <FieldContent>
        <FieldLabel for="settings-mcp-port">Port</FieldLabel>
        <FieldError v-if="portProblem">{{ portProblem }}</FieldError>
        <FieldDescription v-else>
          Nur ändern, wenn ein anderes Programm ihn schon verwendet.
        </FieldDescription>
      </FieldContent>
      <Input
        id="settings-mcp-port"
        v-model="port"
        inputmode="numeric"
        autocomplete="off"
        class="w-24 self-center tabular-nums"
        :aria-invalid="!!portProblem || undefined"
        @change="applyPort"
        @keydown.enter="applyPort"
      />
    </Field>

    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel>Verbindung</FieldLabel>
        <FieldDescription>{{ TRANSPORT_HINTS[transport] }}</FieldDescription>
      </FieldContent>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        class="self-center"
        aria-label="Verbindung"
        :model-value="transport"
        @update:model-value="pickTransport"
      >
        <ToggleGroupItem value="http" :class="PICKED">HTTP</ToggleGroupItem>
        <ToggleGroupItem value="stdio" :class="PICKED">stdio</ToggleGroupItem>
      </ToggleGroup>
    </Field>

    <Field v-if="mcp.status">
      <FieldLabel>Einrichten</FieldLabel>
      <FieldDescription>
        Den Server einmal im KI-Assistenten eintragen – solange CameraDraw läuft und die Steuerung
        an ist, kann er die App bedienen.
      </FieldDescription>
      <McpSetupGuide :transport="transport" :url="url" :stdio="mcp.status.stdio" />
    </Field>
  </template>
</template>

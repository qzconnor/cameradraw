<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { isMcpTransport, isValidMcpPort, mcpUrl, type McpTransport } from '@shared/mcp'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SEGMENTED_GROUP, SEGMENTED_ITEM } from '@/components/common/segmented'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { errorMessage } from '@/lib/format'
import { useMcpStore } from '@/stores/mcp'
import { useSettingsStore } from '@/stores/settings'
import McpSetupGuide from './McpSetupGuide.vue'
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

const TRANSPORT_HINTS: Record<McpTransport, string> = {
  http: 'Der Client verbindet sich mit einer Adresse auf diesem Rechner – für Claude Code, VS Code, Cursor und die meisten anderen.',
  stdio:
    'Der Client startet CameraDraw selbst als Programm – für Claude Desktop und alle Clients, die Programme starten. Ohne Netzwerk-Port.'
}

function pickTransport(value: unknown): void {
  // Clicking the active item would deselect it – one of them is always picked.
  if (isMcpTransport(value) && value !== settings.mcpTransport) {
    void update({ mcpTransport: value })
  }
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
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel>Verbindung</FieldLabel>
        <FieldDescription>{{ TRANSPORT_HINTS[settings.mcpTransport] }}</FieldDescription>
      </FieldContent>
      <ToggleGroup
        type="single"
        size="sm"
        :spacing="0.5"
        :class="['self-center', SEGMENTED_GROUP]"
        aria-label="Verbindung"
        :model-value="settings.mcpTransport"
        @update:model-value="pickTransport"
      >
        <ToggleGroupItem value="http" :class="SEGMENTED_ITEM">HTTP</ToggleGroupItem>
        <ToggleGroupItem value="stdio" :class="SEGMENTED_ITEM">stdio</ToggleGroupItem>
      </ToggleGroup>
    </Field>

    <McpStatusItem />

    <Field
      v-if="settings.mcpTransport === 'http'"
      orientation="horizontal"
      :data-invalid="!!portProblem || undefined"
    >
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

    <Field v-if="mcp.status">
      <FieldLabel>Einrichten</FieldLabel>
      <FieldDescription>
        Den Server einmal im KI-Assistenten eintragen – solange CameraDraw läuft und die Steuerung
        an ist, kann er die App bedienen.
      </FieldDescription>
      <McpSetupGuide :transport="settings.mcpTransport" :url="url" :stdio="mcp.status.stdio" />
    </Field>
  </template>
</template>

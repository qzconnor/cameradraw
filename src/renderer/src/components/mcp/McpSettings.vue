<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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

    <Field>
      <FieldLabel>Einrichten</FieldLabel>
      <FieldDescription>
        Den Server einmal im KI-Assistenten eintragen – solange CameraDraw läuft und die Steuerung
        an ist, kann er die App bedienen.
      </FieldDescription>
      <McpSetupGuide :url="url" />
    </Field>
  </template>
</template>

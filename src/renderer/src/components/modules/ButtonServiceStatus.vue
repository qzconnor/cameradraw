<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { CircleCheckIcon, CircleXIcon, InfoIcon, TriangleAlertIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { ButtonCaptureState } from '@shared/devices'
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
import { errorMessage } from '@/lib/format'
import { useButtonsStore } from '@/stores/buttons'

type Tone = 'success' | 'info' | 'warning' | 'error'

interface View {
  tone: Tone
  title: string
  /** Only when something needs attention. */
  detail?: string
  /** Show the USBPcap download link. */
  usbpcapLink?: boolean
  /** Label of the install button, if installing (again) helps. */
  install?: string
}

const buttons = useButtonsStore()

// `sc query` may be stale (e.g. the service was removed outside the app).
onMounted(() => void buttons.refresh())

const TONES: Record<Tone, { icon: typeof InfoIcon; class: string }> = {
  success: { icon: CircleCheckIcon, class: 'text-success' },
  info: { icon: InfoIcon, class: 'text-muted-foreground' },
  warning: { icon: TriangleAlertIcon, class: 'text-warning' },
  error: { icon: CircleXIcon, class: 'text-destructive' }
}

const ACTIVE = 'Hintergrunddienst aktiv'

const CAPTURE: Record<ButtonCaptureState, View> = {
  idle: { tone: 'success', title: ACTIVE },
  ready: { tone: 'success', title: ACTIVE },
  'device-missing': { tone: 'warning', title: ACTIVE, detail: 'Kamera am USB nicht gefunden.' },
  'usbpcap-missing': {
    tone: 'error',
    title: ACTIVE,
    detail: 'USBPcap fehlt.',
    usbpcapLink: true
  },
  'usbpcap-reboot': { tone: 'warning', title: ACTIVE, detail: 'USBPcap braucht einen Neustart.' },
  'usbpcap-busy': {
    tone: 'warning',
    title: ACTIVE,
    detail: 'USBPcap wird von einem anderen Programm benutzt.'
  },
  error: { tone: 'error', title: ACTIVE }
}

const view = computed<View>(() => {
  const status = buttons.status
  if (!status) return { tone: 'info', title: 'Hintergrunddienst wird geprüft …' }
  switch (status.state) {
    case 'unsupported':
      return { tone: 'info', title: 'Nur unter Windows verfügbar' }
    case 'not-installed':
      return {
        tone: 'warning',
        title: 'Hintergrunddienst nicht installiert',
        detail: 'Fragt einmal nach Admin-Rechten.',
        install: 'Installieren'
      }
    case 'stopped':
      return { tone: 'warning', title: 'Hintergrunddienst gestoppt', install: 'Installieren' }
    case 'outdated':
      return { tone: 'warning', title: 'Hintergrunddienst veraltet', install: 'Aktualisieren' }
    case 'running': {
      const capture = CAPTURE[status.capture ?? 'idle']
      return status.message ? { ...capture, detail: status.message } : capture
    }
  }
  return { tone: 'info', title: '' }
})

const installed = computed(() =>
  ['running', 'stopped', 'outdated'].includes(buttons.status?.state ?? '')
)
const canInstall = computed(() => buttons.status?.bundled ?? false)
const notBundled = computed(() => !!view.value.install && !canInstall.value)

async function run(action: 'install' | 'uninstall'): Promise<void> {
  try {
    await buttons[action]()
    toast.success(
      action === 'install' ? 'Hintergrunddienst installiert' : 'Hintergrunddienst deinstalliert'
    )
  } catch (err) {
    toast.error(
      action === 'install' ? 'Installation fehlgeschlagen' : 'Deinstallation fehlgeschlagen',
      { description: errorMessage(err) }
    )
  }
}
</script>

<!-- One line: is the "CameraDraw Buttons" background service running? Install or uninstall it. -->
<template>
  <Item variant="outline" size="sm">
    <ItemMedia variant="icon">
      <component :is="TONES[view.tone].icon" :class="TONES[view.tone].class" />
    </ItemMedia>
    <ItemContent>
      <ItemTitle>{{ view.title }}</ItemTitle>
      <ItemDescription v-if="view.detail || notBundled">
        {{ notBundled ? 'In diesem Build nicht enthalten.' : view.detail }}
        <a v-if="view.usbpcapLink" href="https://desowin.org/usbpcap/" target="_blank">
          Herunterladen
        </a>
      </ItemDescription>
    </ItemContent>
    <ItemActions>
      <Button
        v-if="view.install && canInstall"
        size="sm"
        :disabled="!!buttons.pending"
        @click="run('install')"
      >
        <Spinner v-if="buttons.pending === 'install'" data-icon="inline-start" />
        {{ view.install }}
      </Button>
      <Button
        v-if="installed"
        size="sm"
        variant="outline"
        :disabled="!!buttons.pending"
        @click="run('uninstall')"
      >
        <Spinner v-if="buttons.pending === 'uninstall'" data-icon="inline-start" />
        Deinstallieren
      </Button>
    </ItemActions>
  </Item>
</template>

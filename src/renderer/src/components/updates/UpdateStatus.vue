<script setup lang="ts">
import { computed } from 'vue'
import {
  CircleAlertIcon,
  CircleArrowDownIcon,
  CircleCheckIcon,
  InfoIcon,
  RotateCwIcon
} from '@lucide/vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle
} from '@/components/ui/item'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { formatDateTime } from '@/lib/format'
import { useUpdatesStore } from '@/stores/updates'

/** What the updater is doing, with the action that fits: download, restart or nothing to do. */
const updates = useUpdatesStore()
const state = computed(() => updates.state)
</script>

<template>
  <Alert v-if="state.status === 'unsupported'">
    <InfoIcon />
    <AlertTitle>Entwicklungsversion</AlertTitle>
    <AlertDescription>
      Updates gibt es nur in der installierten App. Die Versionshinweise stehen trotzdem unten.
    </AlertDescription>
  </Alert>

  <!-- A newer version: this card has to stand out. -->
  <Item
    v-else-if="updates.hasUpdate"
    variant="outline"
    class="border-primary/60 bg-primary/10 shadow-lg"
    data-testid="update-available"
  >
    <ItemMedia class="size-9 rounded-lg bg-primary text-primary-foreground">
      <CircleArrowDownIcon />
    </ItemMedia>
    <ItemContent>
      <ItemTitle>Version {{ state.next }} ist verfügbar</ItemTitle>
      <ItemDescription>
        <template v-if="state.status === 'downloading'">
          Wird heruntergeladen … {{ Math.round(state.progress) }} %
        </template>
        <template v-else-if="state.status === 'downloaded'">
          Heruntergeladen – CameraDraw startet zum Installieren kurz neu.
        </template>
        <template v-else-if="state.status === 'error'">
          Download fehlgeschlagen: {{ state.error }}
        </template>
        <template v-else>Installiert ist {{ state.current }}. Was neu ist, steht unten.</template>
      </ItemDescription>
    </ItemContent>
    <ItemActions class="basis-full">
      <Progress v-if="state.status === 'downloading'" :model-value="state.progress" class="h-1.5" />
      <Button v-else-if="state.status === 'downloaded'" class="w-full" @click="updates.install()">
        <RotateCwIcon data-icon="inline-start" />
        Jetzt neu starten und installieren
      </Button>
      <Button v-else class="w-full" @click="updates.download()">
        <CircleArrowDownIcon data-icon="inline-start" />
        {{ state.status === 'error' ? 'Erneut versuchen' : 'Herunterladen und installieren' }}
      </Button>
    </ItemActions>
  </Item>

  <Alert v-else-if="state.status === 'error'" variant="destructive">
    <CircleAlertIcon />
    <AlertTitle>Update-Prüfung fehlgeschlagen</AlertTitle>
    <AlertDescription>{{ state.error }}</AlertDescription>
  </Alert>

  <Item v-else variant="muted">
    <ItemMedia variant="icon">
      <Spinner v-if="state.status === 'checking'" />
      <CircleCheckIcon v-else />
    </ItemMedia>
    <ItemContent>
      <ItemTitle>
        {{
          state.status === 'checking'
            ? 'Suche nach Updates …'
            : state.status === 'up-to-date'
              ? 'CameraDraw ist auf dem neuesten Stand'
              : 'Noch nicht nach Updates gesucht'
        }}
      </ItemTitle>
      <ItemDescription v-if="state.checkedAt">
        Zuletzt geprüft: {{ formatDateTime(state.checkedAt) }}
      </ItemDescription>
    </ItemContent>
  </Item>
</template>

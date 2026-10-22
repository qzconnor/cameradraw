<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  CloudOffIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  SparklesIcon
} from '@lucide/vue'
import SidePanel from '@/components/common/SidePanel.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { compareVersions } from '@/lib/version'
import { usePanelsStore } from '@/stores/panels'
import { useUpdatesStore } from '@/stores/updates'
import UpdateStatus from './UpdateStatus.vue'

const updates = useUpdatesStore()
const panels = usePanelsStore()
const open = computed(() => panels.isOpen('updates'))

/** Version installed by an update since the notes were opened last – highlighted this time. */
const justUpdated = ref<string | null>(null)

watch(open, (isOpen) => {
  if (!isOpen) return
  if (updates.unseen) justUpdated.value = updates.state.current
  updates.markSeen()
  // Every time: a list loaded earlier may be outdated (or empty) by now.
  void updates.loadReleases()
})

const dateFormat = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric'
})
const formatDate = (iso: string): string => (iso ? dateFormat.format(new Date(iso)) : '')

const isInstalled = (version: string): boolean => version === updates.state.current
const isNewer = (version: string): boolean =>
  !!updates.state.current && compareVersions(version, updates.state.current) > 0

/** Links in the notes open in the browser; anchors within the notes are ignored. */
function onNotesClick(event: MouseEvent): void {
  const link = (event.target as HTMLElement).closest('a')
  if (!link) return
  event.preventDefault()
  if (/^https?:/.test(link.href)) window.open(link.href, '_blank')
}

const canCheck = computed(
  () => !['unsupported', 'checking', 'downloading', 'downloaded'].includes(updates.state.status)
)
</script>

<template>
  <SidePanel name="updates">
    <SheetHeader class="h-13 flex-row items-center gap-2 border-b py-0 pr-12 pl-4">
      <SparklesIcon class="size-4 text-muted-foreground" />
      <SheetTitle>Updates</SheetTitle>
      <Badge v-if="updates.state.current" variant="secondary" class="tabular-nums">
        Version {{ updates.state.current }}
      </Badge>
      <SheetDescription class="sr-only">
        Neue Versionen von CameraDraw und was sich darin geändert hat.
      </SheetDescription>
    </SheetHeader>

    <ScrollArea class="min-h-0 flex-1">
      <div class="flex flex-col gap-5 p-4">
        <UpdateStatus />

        <section class="flex flex-col gap-3" aria-label="Versionshinweise">
          <h3 class="text-xs font-medium text-muted-foreground">Versionshinweise</h3>

          <div v-if="updates.releasesLoading && !updates.releases" class="flex flex-col gap-3">
            <Skeleton v-for="n in 2" :key="n" class="h-32 w-full rounded-xl" />
          </div>

          <Empty v-else-if="updates.releasesError" class="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CloudOffIcon />
              </EmptyMedia>
              <EmptyTitle>Versionshinweise nicht erreichbar</EmptyTitle>
              <EmptyDescription>{{ updates.releasesError }}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" @click="updates.loadReleases()">
                Erneut laden
              </Button>
            </EmptyContent>
          </Empty>

          <Empty v-else-if="!updates.releases?.length" class="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ScrollTextIcon />
              </EmptyMedia>
              <EmptyTitle>Noch keine Versionen</EmptyTitle>
              <EmptyDescription
                >Sobald eine Version veröffentlicht ist, steht sie hier.</EmptyDescription
              >
            </EmptyHeader>
            <!-- GitHub may answer with an empty list for a moment right after a release. -->
            <EmptyContent>
              <Button
                variant="outline"
                size="sm"
                :disabled="updates.releasesLoading"
                @click="updates.loadReleases()"
              >
                Erneut laden
              </Button>
            </EmptyContent>
          </Empty>

          <template v-else>
            <article
              v-for="release in updates.releases"
              :key="release.version"
              :class="
                cn(
                  'flex flex-col gap-2 rounded-xl p-4 ring-1 ring-foreground/10',
                  (release.version === justUpdated || isNewer(release.version)) &&
                    'bg-primary/5 ring-2 ring-primary/50'
                )
              "
            >
              <header class="flex items-center gap-2">
                <h4 class="text-base font-semibold tabular-nums">{{ release.version }}</h4>
                <Badge v-if="release.version === justUpdated">Gerade aktualisiert</Badge>
                <Badge v-else-if="isInstalled(release.version)" variant="secondary">
                  Installiert
                </Badge>
                <Badge v-else-if="isNewer(release.version)">Neu</Badge>
                <time class="ml-auto text-xs text-muted-foreground" :datetime="release.date">
                  {{ formatDate(release.date) }}
                </time>
              </header>
              <!-- eslint-disable-next-line vue/no-v-html -- rendered and sanitized by GitHub -->
              <div class="release-notes" @click="onNotesClick" v-html="release.html" />
              <Button
                as="a"
                variant="link"
                size="xs"
                class="self-start px-0"
                :href="release.url"
                target="_blank"
                rel="noreferrer"
              >
                Auf GitHub ansehen
                <ExternalLinkIcon data-icon="inline-end" />
              </Button>
            </article>
          </template>
        </section>
      </div>
    </ScrollArea>

    <div class="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2.5">
      <p class="text-xs text-muted-foreground">Updates werden alle 4 Stunden gesucht.</p>
      <Button variant="outline" size="sm" :disabled="!canCheck" @click="updates.check()">
        <RefreshCwIcon
          data-icon="inline-start"
          :class="updates.state.status === 'checking' && 'animate-spin'"
        />
        Jetzt suchen
      </Button>
    </div>
  </SidePanel>
</template>

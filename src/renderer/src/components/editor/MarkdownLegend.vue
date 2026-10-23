<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { ChevronDownIcon, SquareIcon } from '@lucide/vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

/**
 * Texts are Markdown – what can be written, and how it looks, as a legend beside the picture. It
 * folds away to a small button (remembered), so it never covers a text for long.
 */
const open = useLocalStorage('cameradraw.markdownLegendOpen', true)

type Look =
  | 'heading'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'list'
  | 'numbered'
  | 'task'
  | 'quote'
  | 'table'
  | 'rule'

const ROWS: { syntax: string; look: Look; result?: string; key?: string }[] = [
  { syntax: '# Überschrift', look: 'heading', result: 'Überschrift' },
  { syntax: '**fett**', look: 'bold', result: 'fett', key: 'B' },
  { syntax: '_kursiv_', look: 'italic', result: 'kursiv', key: 'I' },
  { syntax: '~~weg~~', look: 'strike', result: 'weg' },
  { syntax: '`Code`', look: 'code', result: 'Code' },
  { syntax: '- Liste', look: 'list', result: 'Liste' },
  { syntax: '1. Schritt', look: 'numbered', result: 'Schritt' },
  { syntax: '- [ ] Aufgabe', look: 'task', result: 'Aufgabe' },
  { syntax: '> Zitat', look: 'quote', result: 'Zitat' },
  { syntax: '| A | B |', look: 'table' },
  { syntax: '---', look: 'rule' }
]

const LOOKS: Partial<Record<Look, string>> = {
  heading: 'text-sm font-bold',
  bold: 'font-extrabold',
  italic: 'italic',
  strike: 'line-through',
  code: 'rounded-sm bg-foreground/15 px-1 font-mono',
  quote: 'border-l-2 border-foreground/50 pl-1.5'
}
</script>

<template>
  <!-- The keyboard stays with the text being typed (mousedown.prevent on the button). -->
  <Collapsible
    v-model:open="open"
    role="note"
    aria-label="Markdown"
    :class="cn('glass-panel overflow-hidden text-xs', open ? 'w-60' : 'w-max')"
  >
    <CollapsibleTrigger
      class="flex w-full items-center gap-2 px-3 py-2 text-left outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
      :aria-label="open ? 'Markdown-Legende einklappen' : 'Markdown-Legende zeigen'"
      @mousedown.prevent
    >
      <span
        class="rounded-sm border border-foreground/30 px-1 font-mono text-[10px] leading-4 font-semibold"
        aria-hidden="true"
        >M↓</span
      >
      <span class="font-medium text-foreground">Markdown</span>
      <ChevronDownIcon
        :class="
          cn('ml-auto size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')
        "
      />
    </CollapsibleTrigger>

    <CollapsibleContent
      class="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
    >
      <dl class="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 px-3 pt-1 pb-2.5">
        <template v-for="row in ROWS" :key="row.syntax">
          <dt class="flex items-center gap-1.5 font-mono whitespace-nowrap text-muted-foreground">
            {{ row.syntax }}
          </dt>
          <dd class="flex min-w-0 items-center gap-1.5 text-foreground">
            <template v-if="row.look === 'list'">
              <span class="size-1.5 shrink-0 rounded-full bg-current" />{{ row.result }}
            </template>
            <template v-else-if="row.look === 'numbered'">
              <span class="tabular-nums">1.</span>{{ row.result }}
            </template>
            <template v-else-if="row.look === 'task'">
              <SquareIcon class="size-3.5 shrink-0" />{{ row.result }}
            </template>
            <span
              v-else-if="row.look === 'table'"
              class="grid grid-cols-2 border border-foreground/40 text-[10px] leading-4"
            >
              <span class="border-r border-foreground/40 bg-foreground/10 px-1.5 font-bold">A</span>
              <span class="bg-foreground/10 px-1.5 font-bold">B</span>
            </span>
            <span
              v-else-if="row.look === 'rule'"
              class="h-0.5 w-12 rounded-full bg-foreground/60"
            />
            <span v-else :class="LOOKS[row.look]">{{ row.result }}</span>
            <KbdGroup v-if="row.key" class="ml-auto">
              <Kbd>Strg</Kbd>
              <Kbd>{{ row.key }}</Kbd>
            </KbdGroup>
          </dd>
        </template>
      </dl>
      <p
        class="flex items-center gap-1.5 border-t border-foreground/10 px-3 py-2 text-muted-foreground"
      >
        <Kbd>Esc</Kbd> fertig
      </p>
    </CollapsibleContent>
  </Collapsible>
</template>

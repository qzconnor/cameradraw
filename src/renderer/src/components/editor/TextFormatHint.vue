<script setup lang="ts">
import { Kbd, KbdGroup } from '@/components/ui/kbd'

/** Shown while a text is typed: texts are Markdown – the most useful parts of it. */
const EXAMPLES: { syntax: string; key?: string }[] = [
  { syntax: '# Überschrift' },
  { syntax: '**fett**', key: 'B' },
  { syntax: '_kursiv_', key: 'I' },
  { syntax: '~~durchgestrichen~~' },
  { syntax: '`Code`' },
  { syntax: '- Liste' },
  { syntax: '- [ ] Aufgabe' },
  { syntax: '> Zitat' },
  { syntax: '| Tabelle |' }
]
</script>

<template>
  <div
    role="note"
    aria-label="Markdown"
    class="glass-panel pointer-events-none flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 py-1.5 text-xs text-muted-foreground"
  >
    <span class="font-medium text-foreground">Markdown</span>
    <span v-for="example in EXAMPLES" :key="example.syntax" class="flex items-center gap-1">
      <span class="font-mono">{{ example.syntax }}</span>
      <KbdGroup v-if="example.key">
        <Kbd>Strg</Kbd>
        <Kbd>{{ example.key }}</Kbd>
      </KbdGroup>
    </span>
    <span class="flex items-center gap-1"><Kbd>Esc</Kbd> fertig</span>
  </div>
</template>

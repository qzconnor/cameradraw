<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { ChevronDownIcon } from '@lucide/vue'
import HintTooltip from '@/components/common/HintTooltip.vue'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { DEFAULT_FONT, cssFontFamily, systemFonts } from '@/editor/fonts'
import { refocusTypedText } from '@/lib/keyboard'

/**
 * The font of texts – like the colour, one button that opens the choice: the app's own font, the
 * ones used last and every installed one, each shown in itself, with a search.
 */
const font = defineModel<string>({ required: true })

const RECENT_COUNT = 5
const recent = useLocalStorage<string[]>('cameradraw.recentFonts', [])

const open = ref(false)
const installed = ref<string[] | null>(null)
const list = ref<InstanceType<typeof CommandList> | null>(null)

/** Fonts used last that are still installed. */
const recentFonts = computed(() =>
  installed.value ? recent.value.filter((name) => installed.value!.includes(name)) : []
)

// Read ahead, so the list is there when it opens.
onMounted(async () => {
  installed.value ??= await systemFonts()
})

watch(open, async (value) => {
  if (!value) return
  installed.value ??= await systemFonts()
  // The current font in view – in the list of all of them, not among those used last.
  await nextTick()
  const element = list.value?.$el as HTMLElement | undefined
  const current = [...(element?.querySelectorAll('[data-checked="true"]') ?? [])].pop()
  current?.scrollIntoView({ block: 'center', behavior: 'instant' })
})

function pick(name: string): void {
  font.value = name
  if (name !== DEFAULT_FONT) {
    recent.value = [name, ...recent.value.filter((other) => other !== name)].slice(0, RECENT_COUNT)
  }
  open.value = false
}

/** Enter in the search takes the first font found – unless one is highlighted (the list does). */
function pickFirstMatch(): void {
  const element = list.value?.$el as HTMLElement | undefined
  if (!element || element.querySelector('[data-highlighted]')) return
  element.querySelector<HTMLElement>('[data-slot="command-item"]')?.click()
}

/** Back into the text being typed, if there is one – otherwise to the button as usual. */
function onCloseAutoFocus(e: Event): void {
  if (refocusTypedText()) e.preventDefault()
}
</script>

<template>
  <Popover v-model:open="open">
    <!-- Own anchor outside the tooltip: inside it, the popover would open off-screen. -->
    <PopoverAnchor as-child>
      <div class="flex">
        <HintTooltip :label="`Schriftart · ${font}`">
          <PopoverTrigger as-child>
            <!-- In a narrow window only "Aa" in the font, so the toolbar fits. -->
            <Button
              variant="ghost"
              class="w-32 justify-between gap-1 px-2.5 max-xl:w-auto max-xl:px-2"
              aria-label="Schriftart"
              @mousedown.prevent
            >
              <span class="truncate" :style="{ fontFamily: cssFontFamily(font) }">
                <span class="max-xl:hidden">{{ font }}</span>
                <span class="hidden font-semibold max-xl:inline">Aa</span>
              </span>
              <ChevronDownIcon class="opacity-60" />
            </Button>
          </PopoverTrigger>
        </HintTooltip>
      </div>
    </PopoverAnchor>

    <PopoverContent
      class="w-72 p-0"
      :side-offset="10"
      aria-label="Schriftart"
      @close-auto-focus="onCloseAutoFocus"
    >
      <Command class="rounded-lg!">
        <CommandInput
          placeholder="Schrift suchen …"
          aria-label="Schrift suchen"
          @keydown.enter="pickFirstMatch"
        />
        <CommandList ref="list" class="max-h-80">
          <CommandEmpty>Keine Schrift gefunden.</CommandEmpty>
          <CommandGroup heading="Standard">
            <CommandItem
              :value="DEFAULT_FONT"
              :data-checked="font === DEFAULT_FONT"
              @select="pick(DEFAULT_FONT)"
            >
              <span
                class="truncate text-base"
                :style="{ fontFamily: cssFontFamily(DEFAULT_FONT) }"
                >{{ DEFAULT_FONT }}</span
              >
              <span class="text-xs text-muted-foreground">Schrift der App</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup v-if="recentFonts.length" heading="Zuletzt verwendet">
            <!-- Own values: the same font is listed again below. -->
            <CommandItem
              v-for="name in recentFonts"
              :key="name"
              :value="`recent:${name}`"
              :data-checked="font === name"
              @select="pick(name)"
            >
              <span class="truncate text-base" :style="{ fontFamily: cssFontFamily(name) }">{{
                name
              }}</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Installiert">
            <div
              v-if="!installed"
              class="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground"
            >
              <Spinner /> Schriften werden gelesen …
            </div>
            <div v-else-if="!installed.length" class="px-2 py-1.5 text-sm text-muted-foreground">
              Keine installierten Schriften gefunden.
            </div>
            <!-- Only the rows in view are laid out – each loads its font when it shows. -->
            <CommandItem
              v-for="name in installed"
              :key="name"
              :value="name"
              :data-checked="font === name"
              class="[contain-intrinsic-size:auto_2.25rem] [content-visibility:auto]"
              @select="pick(name)"
            >
              <span class="truncate text-base" :style="{ fontFamily: cssFontFamily(name) }">{{
                name
              }}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>

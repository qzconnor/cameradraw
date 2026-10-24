import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'

/** How readily edges light up. */
export type PeakingLevel = 'low' | 'medium' | 'high'

export const PEAKING_LEVELS: { id: PeakingLevel; label: string }[] = [
  { id: 'low', label: 'Wenig' },
  { id: 'medium', label: 'Mittel' },
  { id: 'high', label: 'Viel' }
]

/**
 * How steep an edge has to be to light up (brightness 0–1 per pixel): a crisp black/white edge
 * reaches 0.5, the same edge out of focus stays far below.
 */
export const PEAKING_SLOPES: Record<PeakingLevel, number> = {
  low: 0.09,
  medium: 0.06,
  high: 0.035
}

/** The noise never lights up: edges have to be this many times steeper than it. */
const NOISE_MARGIN = 4
/**
 * How much steeper an edge has to be right at a pixel than over a few pixels around it (see
 * `lib/peaking.ts`): a blurred edge is about 1, a crisp one up to 3 – the edge of a bright pad out
 * of focus is steep enough, but not crisp.
 */
const MIN_RATIO = 1.4

/** Colours of the peaks – they have to stand out on the picture, not match the app. */
export const PEAKING_COLORS: { value: string; label: string }[] = [
  { value: '#ff2d55', label: 'Rot' },
  { value: '#39ff14', label: 'Grün' },
  { value: '#ffe600', label: 'Gelb' },
  { value: '#00b4ff', label: 'Blau' }
]

export const isPeakingLevel = (value: unknown): value is PeakingLevel =>
  value === 'low' || value === 'medium' || value === 'high'

/** The highest sharpness seen fades by this factor per measurement (about halved in 8 s). */
const BEST_FADE = 0.99

/**
 * "Schärfehilfe": edges in focus light up in the live picture (focus peaking), and a meter shows
 * how sharp the picture is compared with the sharpest it was a moment ago – turning the focus
 * until the meter is full finds the sharpest setting.
 */
export const useFocusPeakingStore = defineStore('focusPeaking', () => {
  const enabled = useLocalStorage('cameradraw.peaking', false)
  const level = useLocalStorage<PeakingLevel>('cameradraw.peakingLevel', 'medium')
  const color = useLocalStorage('cameradraw.peakingColor', PEAKING_COLORS[0].value)

  /** Sharpness of the live picture (see `lib/sharpness.ts`), null while it is not measured. */
  const sharpness = ref<number | null>(null)
  /** The highest sharpness of the last seconds – slowly forgotten, e.g. after moving the sample. */
  const best = ref<number | null>(null)
  /** Noise of the picture as steepness, see `Sharpness.noise`. */
  const noise = ref(0)

  /** How sharp the picture is compared with the sharpest of the last seconds (0–1). */
  const relative = computed(() =>
    sharpness.value !== null && best.value ? Math.min(1, sharpness.value / best.value) : 0
  )

  /** Steepness an edge needs to light up. */
  const minSlope = computed(() =>
    Math.max(PEAKING_SLOPES[level.value] ?? PEAKING_SLOPES.medium, noise.value * NOISE_MARGIN)
  )
  const minRatio = MIN_RATIO

  /** A new measurement – smoothed a little, so the meter does not flicker with the noise. */
  function measured(value: number, noiseLevel: number): void {
    const smooth = sharpness.value === null ? value : (sharpness.value + value) / 2
    sharpness.value = smooth
    best.value = Math.max(smooth, (best.value ?? 0) * BEST_FADE)
    noise.value = noiseLevel
  }

  /** Nothing is measured (switched off, camera not live). */
  function reset(): void {
    sharpness.value = null
    best.value = null
  }

  return {
    enabled,
    level,
    color,
    sharpness,
    best,
    noise,
    relative,
    minSlope,
    minRatio,
    measured,
    reset
  }
})

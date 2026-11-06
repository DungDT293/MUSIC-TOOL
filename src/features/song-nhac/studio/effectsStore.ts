import { create } from 'zustand'

export interface CompositionEffects {
  /** 0..1 — gaussian-ish blur applied to the whole composition. */
  blur: number
  /** Whole-composition opacity over black. */
  alpha: number
  /** Colour tint (hex) mixed into the composition by `tintStrength`. */
  tint: string
  tintStrength: number
  /** Camera shake on the kick drum, 0..1. */
  shake: number
  /** Mirror the composition horizontally. */
  mirror: boolean
  /** Composition zoom, 1 = normal. */
  zoom: number
}

export const DEFAULT_EFFECTS: CompositionEffects = {
  blur: 0,
  alpha: 1,
  tint: '#ffffff',
  tintStrength: 0,
  shake: 0,
  mirror: false,
  zoom: 1,
}

interface EffectsStore extends CompositionEffects {
  setEffect: <K extends keyof CompositionEffects>(key: K, value: CompositionEffects[K]) => void
  reset: () => void
}

export const useCompositionEffects = create<EffectsStore>((set) => ({
  ...DEFAULT_EFFECTS,
  setEffect: (key, value) => set({ [key]: value } as Partial<EffectsStore>),
  reset: () => set({ ...DEFAULT_EFFECTS }),
}))

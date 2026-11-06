import { create } from 'zustand'
import type { VisualizerLayer } from './layerTypes'

const STORAGE_KEY = 'song-nhac.user-presets.v1'

export type PresetPatch = Partial<
  Pick<
    VisualizerLayer,
    | 'waveStyle'
    | 'colorMode'
    | 'color1'
    | 'color2'
    | 'barCount'
    | 'barWidth'
    | 'speed'
    | 'opacity'
    | 'glowEnabled'
    | 'glowIntensity'
    | 'mirror'
    | 'sensitivity'
  >
>

export interface UserPreset {
  id: string
  name: string
  createdAt: number
  visualizer: PresetPatch
}

function load(): UserPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(presets: UserPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {
    // ignore quota problems; presets still work for this session
  }
}

interface UserPresetsStore {
  presets: UserPreset[]
  save: (name: string, visualizer: PresetPatch) => UserPreset
  remove: (id: string) => void
  rename: (id: string, name: string) => void
}

export const useUserPresets = create<UserPresetsStore>((set, get) => ({
  presets: load(),
  save: (name, visualizer) => {
    const preset: UserPreset = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || 'Preset của tôi',
      createdAt: Date.now(),
      visualizer,
    }
    const next = [preset, ...get().presets].slice(0, 40)
    persist(next)
    set({ presets: next })
    return preset
  },
  remove: (id) => {
    const next = get().presets.filter((item) => item.id !== id)
    persist(next)
    set({ presets: next })
  },
  rename: (id, name) => {
    const next = get().presets.map((item) => (item.id === id ? { ...item, name } : item))
    persist(next)
    set({ presets: next })
  },
}))

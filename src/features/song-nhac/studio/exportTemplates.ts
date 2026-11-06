import { create } from 'zustand'

export type ExportCodec = 'h264' | 'hevc'
export type BitrateTier = 'high' | 'balanced' | 'light'

export interface ExportTemplate {
  id: string
  name: string
  width: number
  height: number
  fps: number
  codec: ExportCodec
  bitrateTier: BitrateTier
  /** Built-ins cannot be removed. */
  builtIn?: boolean
}

export const BUILT_IN_TEMPLATES: ExportTemplate[] = [
  { id: 'yt-1080p30', name: 'YouTube 1080p30', width: 1920, height: 1080, fps: 30, codec: 'h264', bitrateTier: 'balanced', builtIn: true },
  { id: 'yt-1080p60', name: 'YouTube 1080p60', width: 1920, height: 1080, fps: 60, codec: 'h264', bitrateTier: 'high', builtIn: true },
  { id: 'yt-4k30', name: '4K 2160p30', width: 3840, height: 2160, fps: 30, codec: 'hevc', bitrateTier: 'high', builtIn: true },
  { id: 'shorts-9x16', name: 'Shorts 9:16', width: 1080, height: 1920, fps: 30, codec: 'h264', bitrateTier: 'balanced', builtIn: true },
  { id: 'square-1x1', name: 'Vuông 1:1', width: 1080, height: 1080, fps: 30, codec: 'h264', bitrateTier: 'balanced', builtIn: true },
  { id: 'light-720p', name: 'Nhẹ 720p30', width: 1280, height: 720, fps: 30, codec: 'h264', bitrateTier: 'light', builtIn: true },
]

const STORAGE_KEY = 'song-nhac.export-templates.v1'

function loadUserTemplates(): ExportTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(templates: ExportTemplate[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
  } catch {
    // ignore quota problems
  }
}

interface ExportTemplateStore {
  templates: ExportTemplate[]
  save: (template: Omit<ExportTemplate, 'id' | 'builtIn'>) => void
  remove: (id: string) => void
}

export const useExportTemplates = create<ExportTemplateStore>((set, get) => ({
  templates: loadUserTemplates(),
  save: (template) => {
    const entry: ExportTemplate = {
      ...template,
      id: `user-${Date.now().toString(36)}`,
    }
    const next = [entry, ...get().templates].slice(0, 20)
    persist(next)
    set({ templates: next })
  },
  remove: (id) => {
    const next = get().templates.filter((item) => item.id !== id)
    persist(next)
    set({ templates: next })
  },
}))

/** Built-ins first, then the user's own templates (newest first). */
export function listTemplates(userTemplates: ExportTemplate[]): ExportTemplate[] {
  return [...BUILT_IN_TEMPLATES, ...userTemplates]
}

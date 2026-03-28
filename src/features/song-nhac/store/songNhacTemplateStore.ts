/**
 * Templates / Presets — Lưu và load layout layer.
 * Lưu trong localStorage; khi load sẽ regenerate IDs.
 */

import { create } from 'zustand'
import type { SongNhacLayer, SongNhacGroupLayer } from '../types/layerTypes'
import { isSongNhacImageLayer, isSongNhacGroupLayer } from '../types/layerTypes'

const STORAGE_KEY = 'songNhac.templates'

export interface SongNhacTemplate {
  id: string
  name: string
  layers: SongNhacLayer[]
  createdAt: number
}

function nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function loadTemplates(): SongNhacTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SongNhacTemplate[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveTemplatesToStorage(templates: SongNhacTemplate[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[song-nhac] Failed to save templates', e)
    }
  }
}

/** Chuyển blob URL sang data URL (để lưu template). */
async function blobUrlToDataUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return url
  }
}

/** Clone layers và đổi ID; map parentId/children. */
function cloneAndRegenerateIds(layers: SongNhacLayer[]): SongNhacLayer[] {
  const idMap = new Map<string, string>()
  const result: SongNhacLayer[] = []

  for (const layer of layers) {
    const newId = nextId(layer.type === 'image' ? 'img' : layer.type === 'text' ? 'txt' : 'grp')
    idMap.set(layer.id, newId)
  }

  for (const layer of layers) {
    const newId = idMap.get(layer.id)!
    if (isSongNhacGroupLayer(layer)) {
      result.push({
        ...layer,
        id: newId,
        children: layer.children.map((c) => idMap.get(c) ?? c),
      })
    } else {
      const base = layer as { parentId?: string }
      result.push({
        ...layer,
        id: newId,
        parentId: base.parentId ? idMap.get(base.parentId) : undefined,
      } as SongNhacLayer)
    }
  }
  return result
}

interface SongNhacTemplateState {
  templates: SongNhacTemplate[]
  loadTemplates: () => void
  saveTemplate: (name: string, layers: SongNhacLayer[]) => Promise<string | null>
  loadTemplate: (id: string) => SongNhacLayer[] | null
  deleteTemplate: (id: string) => void
}

export const useSongNhacTemplateStore = create<SongNhacTemplateState>((set, get) => ({
  templates: loadTemplates(),

  loadTemplates: () => set({ templates: loadTemplates() }),

  saveTemplate: async (name, layers) => {
    if (layers.length === 0) return null
    const toSave = await Promise.all(
      layers.map(async (l) => {
        if (isSongNhacImageLayer(l) && l.src?.startsWith('blob:')) {
          const dataUrl = await blobUrlToDataUrl(l.src)
          return { ...l, src: dataUrl }
        }
        return l
      })
    )
    const template: SongNhacTemplate = {
      id: nextId('tpl'),
      name: name.trim() || `Template ${Date.now()}`,
      layers: JSON.parse(JSON.stringify(toSave)),
      createdAt: Date.now(),
    }
    const next = [...get().templates, template]
    set({ templates: next })
    saveTemplatesToStorage(next)
    return template.id
  },

  loadTemplate: (id) => {
    const tpl = get().templates.find((t) => t.id === id)
    if (!tpl) return null
    return cloneAndRegenerateIds(tpl.layers)
  },

  deleteTemplate: (id) => {
    const next = get().templates.filter((t) => t.id !== id)
    set({ templates: next })
    saveTemplatesToStorage(next)
  },
}))

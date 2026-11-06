import type { StudioAnyLayer } from './layerTypes'

const STORAGE_KEY = 'songNhac.templates'
const SCHEMA_VERSION = 2

export interface StudioTemplate {
  id: string
  name: string
  createdAt: number
  version: number
  layers: StudioAnyLayer[]
}

function readAll(): StudioTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StudioTemplate[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && Array.isArray(item.layers))
  } catch {
    return []
  }
}

function writeAll(templates: StudioTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
}

/** Deep-clones layers and gives every layer (and group child reference) a fresh id. */
export function cloneLayersWithNewIds(layers: StudioAnyLayer[]): StudioAnyLayer[] {
  const idMap = new Map<string, string>()
  const suffix = Math.random().toString(36).slice(2, 6)
  const cloned = layers.map((layer, index) => {
    const nextId = `${layer.type}-${Date.now().toString(36)}-${suffix}-${index}`
    idMap.set(layer.id, nextId)
    return { ...layer, id: nextId } as StudioAnyLayer
  })
  return cloned.map((layer) => {
    if (layer.type === 'group') {
      return { ...layer, children: layer.children.map((childId) => idMap.get(childId) ?? childId) }
    }
    if ('parentId' in layer && layer.parentId) {
      return { ...layer, parentId: idMap.get(layer.parentId) ?? layer.parentId }
    }
    return layer
  })
}

export function listTemplates(): StudioTemplate[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt)
}

export function saveTemplate(name: string, layers: StudioAnyLayer[]): StudioTemplate {
  const template: StudioTemplate = {
    id: `tpl-${Date.now().toString(36)}`,
    name: name.trim() || `Template ${listTemplates().length + 1}`,
    createdAt: Date.now(),
    version: SCHEMA_VERSION,
    layers: cloneLayersWithNewIds(layers),
  }
  const templates = readAll()
  templates.push(template)
  writeAll(templates.slice(-40))
  return template
}

export function deleteTemplate(id: string): void {
  writeAll(readAll().filter((template) => template.id !== id))
}

export function loadTemplate(id: string): StudioAnyLayer[] | null {
  const template = readAll().find((item) => item.id === id)
  if (!template) return null
  return cloneLayersWithNewIds(template.layers)
}

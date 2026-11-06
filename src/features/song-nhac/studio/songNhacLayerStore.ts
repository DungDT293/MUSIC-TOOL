import { create } from 'zustand'
import {
  createGroupLayer,
  createImageLayer,
  createIntroLayer,
  createLogoLayer,
  createOutroLayer,
  createTextLayer,
  createVideoLayer,
  createVisualizerLayer,
  createParticlesLayer,
  createLyricsLayer,
  type LyricLine,
  type StudioAutomationProperty,
  isGroupLayer,
  type StudioAnyLayer,
} from './layerTypes'

export const HISTORY_LIMIT = 50
const PASTE_OFFSET = 30
const DUPLICATE_OFFSET = 20

function cloneLayers(layers: StudioAnyLayer[]): StudioAnyLayer[] {
  try {
    return structuredClone(layers)
  } catch {
    return JSON.parse(JSON.stringify(layers)) as StudioAnyLayer[]
  }
}

export interface SelectionModifiers {
  ctrlKey?: boolean
  shiftKey?: boolean
}

export interface LayerStoreState {
  layers: StudioAnyLayer[]
  selectedLayerId: string | null
  selectedIds: string[]
  clipboard: StudioAnyLayer[]
  historyPast: StudioAnyLayer[][]
  historyFuture: StudioAnyLayer[][]
  historyGestureActive: boolean
  expandedGroupIds: Record<string, boolean>
  editingGroupId: string | null
  focusContentInputId: string | null

  setLayers: (layers: StudioAnyLayer[]) => void
  applyTemplateLayers: (layers: StudioAnyLayer[]) => void
  setSelectedLayerId: (id: string | null) => void
  setSelection: (id: string | null, modifiers?: SelectionModifiers) => void
  getLayer: (id: string) => StudioAnyLayer | undefined

  addImageLayer: (name?: string, src?: string) => string
  addTextLayer: (name?: string, text?: string) => string
  addVisualizerLayer: (name?: string, waveStyle?: string) => string
  addVideoLayer: (name?: string, src?: string) => string
  addLogoLayer: (src?: string) => string
  addIntroLayer: (durationSec?: number) => string
  addOutroLayer: (totalSec: number, durationSec?: number) => string
  addParticlesLayer: (name?: string) => string
  addLyricsLayer: (name?: string, lines?: LyricLine[]) => string
  /** Time used when inserting keyframes from the inspector. */
  currentTimeSec: number
  setCurrentTime: (timeSec: number) => void
  addKeyframe: (layerId: string, property: StudioAutomationProperty, value: number, timeSec?: number) => void
  clearAutomation: (layerId: string, property: StudioAutomationProperty) => void
  /** Moves one keyframe in time (drag on the timeline). */
  moveKeyframe: (layerId: string, property: StudioAutomationProperty, fromTimeSec: number, toTimeSec: number) => void
  addGroup: () => string

  removeLayer: (id: string) => void
  removeSelectedLayers: () => void
  duplicateLayer: (id: string) => void
  duplicateSelectedLayers: () => void
  copyLayer: (id: string) => void
  copySelectedLayers: () => void
  pasteLayers: () => void

  reorderLayer: (from: number, to: number) => void
  moveLayerUp: (id: string) => void
  moveLayerDown: (id: string) => void
  moveGroup: (groupId: string, dx: number, dy: number) => void
  moveSelectedLayers: (dx: number, dy: number) => void
  moveLayerInGroup: (groupId: string, from: number, to: number) => void
  addLayerToGroup: (layerId: string, groupId: string) => void
  removeFromGroup: (layerId: string) => void

  updateLayer: (id: string, patch: Partial<StudioAnyLayer>) => void
  updateLayerWithHistory: (id: string, patch: Partial<StudioAnyLayer>) => void

  pushHistorySnapshot: (layers: StudioAnyLayer[]) => void
  beginHistoryGesture: () => void
  endHistoryGesture: () => void
  undo: () => void
  redo: () => void

  setFocusContentInputId: (id: string | null) => void
  setEditingGroupId: (id: string | null) => void
  toggleGroupExpanded: (id: string) => void
}

export const useSongNhacLayerStore = create<LayerStoreState>((set, get) => ({
  layers: [createVisualizerLayer()],
  selectedLayerId: null,
  selectedIds: [],
  clipboard: [],
  historyPast: [],
  historyFuture: [],
  historyGestureActive: false,
  expandedGroupIds: {},
  editingGroupId: null,
  focusContentInputId: null,

  setLayers: (layers) => set({ layers }),

  applyTemplateLayers: (layers) => {
    get().pushHistorySnapshot(get().layers)
    set({ layers, selectedLayerId: null, selectedIds: [] })
  },

  setSelectedLayerId: (id) => set({ selectedLayerId: id, selectedIds: id ? [id] : [] }),

  setSelection: (id, modifiers = {}) => {
    const state = get()
    if (!id) {
      set({ selectedLayerId: null, selectedIds: [] })
      return
    }
    const layer = state.layers.find((item) => item.id === id)
    if (layer && isGroupLayer(layer)) {
      set({ selectedLayerId: id, selectedIds: [id] })
      return
    }
    if (modifiers.ctrlKey) {
      const exists = state.selectedIds.includes(id)
      const next = exists ? state.selectedIds.filter((item) => item !== id) : [...state.selectedIds, id]
      set({ selectedIds: next, selectedLayerId: exists ? next[next.length - 1] ?? null : id })
      return
    }
    if (modifiers.shiftKey && state.selectedLayerId) {
      const rootIds = state.layers.filter((item) => !isGroupLayer(item) && !item.parentId).map((item) => item.id)
      const from = rootIds.indexOf(state.selectedLayerId)
      const to = rootIds.indexOf(id)
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from]
        set({ selectedIds: rootIds.slice(start, end + 1), selectedLayerId: id })
        return
      }
    }
    set({ selectedLayerId: id, selectedIds: [id] })
  },

  getLayer: (id) => get().layers.find((layer) => layer.id === id),

  addImageLayer: (name, src) => {
    const layer = createImageLayer(src ?? '', name || 'Ảnh')
    const state = get()
    state.pushHistorySnapshot(state.layers)
    set({ layers: [...state.layers, layer], selectedLayerId: layer.id, selectedIds: [layer.id] })
    return layer.id
  },

  addTextLayer: (name, text) => {
    const layer = createTextLayer(text ?? 'Tên bài hát')
    if (name) layer.name = name
    const state = get()
    state.pushHistorySnapshot(state.layers)
    set({ layers: [...state.layers, layer], selectedLayerId: layer.id, selectedIds: [layer.id] })
    return layer.id
  },

  addVisualizerLayer: (name, waveStyle) => {
    const layer = createVisualizerLayer(name || 'Sóng nhạc')
    if (waveStyle) layer.waveStyle = waveStyle
    const state = get()
    state.pushHistorySnapshot(state.layers)
    set({ layers: [...state.layers, layer], selectedLayerId: layer.id, selectedIds: [layer.id] })
    return layer.id
  },

  addVideoLayer: (name, src) => {
    const layer = createVideoLayer(src ?? '', name || 'Video')
    const state = get()
    state.pushHistorySnapshot(state.layers)
    set({ layers: [...state.layers, layer], selectedLayerId: layer.id, selectedIds: [layer.id] })
    return layer.id
  },

  addLogoLayer: (src) => {
    const layer = createLogoLayer(src ?? '')
    const state = get()
    state.pushHistorySnapshot(state.layers)
    set({ layers: [...state.layers, layer], selectedLayerId: layer.id, selectedIds: [layer.id] })
    return layer.id
  },

  addIntroLayer: (durationSec = 5) => {
    const layer = createIntroLayer(durationSec)
    const state = get()
    state.pushHistorySnapshot(state.layers)
    set({ layers: [...state.layers, layer], selectedLayerId: layer.id, selectedIds: [layer.id] })
    return layer.id
  },

  addOutroLayer: (totalSec, durationSec = 5) => {
    const layer = createOutroLayer(totalSec, durationSec)
    const state = get()
    state.pushHistorySnapshot(state.layers)
    set({ layers: [...state.layers, layer], selectedLayerId: layer.id, selectedIds: [layer.id] })
    return layer.id
  },

  currentTimeSec: 0,
  setCurrentTime: (timeSec) => set({ currentTimeSec: Math.max(0, timeSec) }),
  addKeyframe: (layerId, property, value, timeSec) => {
    const state = get()
    const at = timeSec ?? state.currentTimeSec
    state.pushHistorySnapshot(state.layers)
    const layers = state.layers.map((layer) => {
      if (layer.id !== layerId || layer.type === 'group') return layer
      const automations = [...(layer.automations ?? [])]
      const index = automations.findIndex((item) => item.property === property)
      const keyframe = { timeSec: Number(at.toFixed(3)), value }
      if (index >= 0) {
        const keys = automations[index].keyframes.filter((item) => Math.abs(item.timeSec - keyframe.timeSec) > 0.001)
        keys.push(keyframe)
        keys.sort((a, b) => a.timeSec - b.timeSec)
        automations[index] = { property, keyframes: keys }
      } else {
        automations.push({ property, keyframes: [keyframe] })
      }
      return { ...layer, automations } as typeof layer
    })
    set({ layers })
  },
  moveKeyframe: (layerId, property, fromTimeSec, toTimeSec) => {
    const next = Math.max(0, toTimeSec)
    const layers = get().layers.map((layer) => {
      if (layer.id !== layerId || layer.type === 'group') return layer
      const automations = (layer.automations ?? []).map((automation) => {
        if (automation.property !== property) return automation
        const keyframes = automation.keyframes
          .map((frame) => (Math.abs(frame.timeSec - fromTimeSec) < 0.001 ? { ...frame, timeSec: next } : frame))
          // Dropping a key onto another one keeps a single key instead of a zero-length segment.
          .filter((frame, index, all) => all.findIndex((other) => Math.abs(other.timeSec - frame.timeSec) < 0.001) === index)
          .sort((a, b) => a.timeSec - b.timeSec)
        return { ...automation, keyframes }
      })
      return { ...layer, automations } as typeof layer
    })
    set({ layers })
  },
  clearAutomation: (layerId, property) => {
    const state = get()
    state.pushHistorySnapshot(state.layers)
    const layers = state.layers.map((layer) =>
      layer.id === layerId && layer.type !== 'group'
        ? ({ ...layer, automations: (layer.automations ?? []).filter((item) => item.property !== property) } as typeof layer)
        : layer,
    )
    set({ layers })
  },

  addLyricsLayer: (name, lines) => {
    const layer = createLyricsLayer(name || 'Lyrics', lines ?? [])
    const state = get()
    state.pushHistorySnapshot(state.layers)
    set({ layers: [...state.layers, layer], selectedLayerId: layer.id, selectedIds: [layer.id] })
    return layer.id
  },

  addParticlesLayer: (name) => {
    const layer = createParticlesLayer(name || 'Hạt')
    const state = get()
    state.pushHistorySnapshot(state.layers)
    set({ layers: [...state.layers, layer], selectedLayerId: layer.id, selectedIds: [layer.id] })
    return layer.id
  },

  addGroup: () => {
    const group = createGroupLayer()
    const state = get()
    state.pushHistorySnapshot(state.layers)
    set({ layers: [...state.layers, group], selectedLayerId: group.id, selectedIds: [group.id] })
    return group.id
  },

  removeLayer: (id) => {
    const state = get()
    const group = state.layers.find((layer) => layer.id === id)
    const ids = new Set<string>([id])
    if (group && isGroupLayer(group)) group.children.forEach((childId) => ids.add(childId))
    state.pushHistorySnapshot(state.layers)
    set({
      layers: state.layers.filter((layer) => !ids.has(layer.id)),
      selectedLayerId: state.selectedLayerId && ids.has(state.selectedLayerId) ? null : state.selectedLayerId,
      selectedIds: state.selectedIds.filter((item) => !ids.has(item)),
    })
  },

  removeSelectedLayers: () => {
    const state = get()
    if (!state.selectedIds.length) return
    const ids = new Set<string>(state.selectedIds)
    for (const layer of state.layers) {
      if (isGroupLayer(layer) && ids.has(layer.id)) layer.children.forEach((childId) => ids.add(childId))
    }
    state.pushHistorySnapshot(state.layers)
    set({
      layers: state.layers.filter((layer) => !ids.has(layer.id)),
      selectedLayerId: null,
      selectedIds: [],
    })
  },

  duplicateLayer: (id) => {
    const state = get()
    const layer = state.layers.find((item) => item.id === id)
    if (!layer) return
    const copy = cloneLayers([layer])[0] as StudioAnyLayer
    copy.id = `${copy.type}-${Date.now().toString(36)}-dup`
    if (!isGroupLayer(copy) && 'transform' in copy) {
      copy.transform = { ...copy.transform, x: copy.transform.x + DUPLICATE_OFFSET, y: copy.transform.y + DUPLICATE_OFFSET }
    }
    if (isGroupLayer(copy)) copy.children = []
    state.pushHistorySnapshot(state.layers)
    set({ layers: [...state.layers, copy], selectedLayerId: copy.id, selectedIds: [copy.id] })
  },

  duplicateSelectedLayers: () => {
    const state = get()
    for (const id of state.selectedIds) state.duplicateLayer(id)
  },

  copyLayer: (id) => {
    const layer = get().layers.find((item) => item.id === id)
    if (layer) set({ clipboard: cloneLayers([layer]) })
  },

  copySelectedLayers: () => {
    const state = get()
    const picked = state.layers.filter((layer) => state.selectedIds.includes(layer.id))
    set({ clipboard: cloneLayers(picked) })
  },

  pasteLayers: () => {
    const state = get()
    if (!state.clipboard.length) return
    state.pushHistorySnapshot(state.layers)
    const pasted = cloneLayers(state.clipboard).map((layer) => {
      const copy = { ...layer, id: `${layer.type}-${Date.now().toString(36)}-p${Math.random().toString(36).slice(2, 5)}` } as StudioAnyLayer
      if (!isGroupLayer(copy) && 'transform' in copy) {
        copy.transform = { ...copy.transform, x: copy.transform.x + PASTE_OFFSET, y: copy.transform.y + PASTE_OFFSET }
      }
      if (isGroupLayer(copy)) copy.children = []
      return copy
    })
    set({
      layers: [...state.layers, ...pasted],
      selectedLayerId: pasted[pasted.length - 1]?.id ?? null,
      selectedIds: pasted.map((layer) => layer.id),
    })
  },

  reorderLayer: (from, to) => {
    const state = get()
    if (from === to || from < 0 || to < 0 || from >= state.layers.length || to >= state.layers.length) return
    state.pushHistorySnapshot(state.layers)
    const next = [...state.layers]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    set({ layers: next })
  },

  moveLayerUp: (id) => {
    const state = get()
    const index = state.layers.findIndex((layer) => layer.id === id)
    if (index < 0) return
    state.reorderLayer(index, Math.min(state.layers.length - 1, index + 1))
  },

  moveLayerDown: (id) => {
    const state = get()
    const index = state.layers.findIndex((layer) => layer.id === id)
    if (index < 0) return
    state.reorderLayer(index, Math.max(0, index - 1))
  },

  moveGroup: (groupId, dx, dy) => {
    const state = get()
    const group = state.layers.find((layer) => layer.id === groupId)
    if (!group || !isGroupLayer(group)) return
    const ids = new Set(group.children)
    set({
      layers: state.layers.map((layer) => {
        if (!ids.has(layer.id) || isGroupLayer(layer) || !('transform' in layer)) return layer
        return { ...layer, transform: { ...layer.transform, x: layer.transform.x + dx, y: layer.transform.y + dy } }
      }),
    })
  },

  moveSelectedLayers: (dx, dy) => {
    const state = get()
    const ids = new Set(state.selectedIds)
    set({
      layers: state.layers.map((layer) => {
        if (!ids.has(layer.id) || isGroupLayer(layer) || !('transform' in layer)) return layer
        return { ...layer, transform: { ...layer.transform, x: layer.transform.x + dx, y: layer.transform.y + dy } }
      }),
    })
  },

  moveLayerInGroup: (groupId, from, to) => {
    const state = get()
    const group = state.layers.find((layer) => layer.id === groupId)
    if (!group || !isGroupLayer(group)) return
    if (from < 0 || to < 0 || from >= group.children.length || to >= group.children.length) return
    const children = [...group.children]
    const [moved] = children.splice(from, 1)
    children.splice(to, 0, moved)
    const next = state.layers.map((layer) => (layer.id === groupId ? { ...group, children } : layer))
    set({ layers: next })
  },

  addLayerToGroup: (layerId, groupId) => {
    const state = get()
    const group = state.layers.find((layer) => layer.id === groupId)
    if (!group || !isGroupLayer(group)) return
    const next = state.layers.map((layer) => {
      if (layer.id === layerId && 'transform' in layer) return { ...layer, parentId: groupId }
      if (layer.id === groupId && isGroupLayer(layer)) return { ...layer, children: [...layer.children, layerId] }
      return layer
    })
    state.pushHistorySnapshot(state.layers)
    set({ layers: next })
  },

  removeFromGroup: (layerId) => {
    const state = get()
    const layer = state.layers.find((item) => item.id === layerId)
    if (!layer || !('parentId' in layer) || !layer.parentId) return
    const groupId = layer.parentId
    const next = state.layers.map((item) => {
      if (item.id === layerId && 'parentId' in item) {
        const { parentId: _parentId, ...rest } = item
        return rest as StudioAnyLayer
      }
      if (item.id === groupId && isGroupLayer(item)) {
        return { ...item, children: item.children.filter((id) => id !== layerId) }
      }
      return item
    })
    state.pushHistorySnapshot(state.layers)
    set({ layers: next })
  },

  updateLayer: (id, patch) => {
    set({
      layers: get().layers.map((layer) => (layer.id === id ? ({ ...layer, ...patch } as StudioAnyLayer) : layer)),
    })
  },

  updateLayerWithHistory: (id, patch) => {
    const state = get()
    state.pushHistorySnapshot(state.layers)
    state.updateLayer(id, patch)
  },

  pushHistorySnapshot: (layers) => {
    const state = get()
    const past = [...state.historyPast, cloneLayers(layers)]
    if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT)
    set({ historyPast: past, historyFuture: [] })
  },

  beginHistoryGesture: () => {
    const state = get()
    if (state.historyGestureActive) return
    state.pushHistorySnapshot(state.layers)
    set({ historyGestureActive: true })
  },

  endHistoryGesture: () => set({ historyGestureActive: false }),

  undo: () => {
    const state = get()
    if (!state.historyPast.length) return
    const past = [...state.historyPast]
    const previous = past.pop() as StudioAnyLayer[]
    set({
      layers: previous,
      historyPast: past,
      historyFuture: [cloneLayers(state.layers), ...state.historyFuture].slice(0, HISTORY_LIMIT),
      selectedLayerId: state.selectedLayerId && previous.some((layer) => layer.id === state.selectedLayerId) ? state.selectedLayerId : null,
      selectedIds: state.selectedIds.filter((id) => previous.some((layer) => layer.id === id)),
    })
  },

  redo: () => {
    const state = get()
    if (!state.historyFuture.length) return
    const future = [...state.historyFuture]
    const next = future.shift() as StudioAnyLayer[]
    set({
      layers: next,
      historyFuture: future,
      historyPast: [...state.historyPast, cloneLayers(state.layers)].slice(-HISTORY_LIMIT),
      selectedLayerId: state.selectedLayerId && next.some((layer) => layer.id === state.selectedLayerId) ? state.selectedLayerId : null,
      selectedIds: state.selectedIds.filter((id) => next.some((layer) => layer.id === id)),
    })
  },

  setFocusContentInputId: (id) => set({ focusContentInputId: id }),
  setEditingGroupId: (id) => set({ editingGroupId: id }),
  toggleGroupExpanded: (id) => set((state) => ({ expandedGroupIds: { ...state.expandedGroupIds, [id]: !state.expandedGroupIds[id] } })),
}))

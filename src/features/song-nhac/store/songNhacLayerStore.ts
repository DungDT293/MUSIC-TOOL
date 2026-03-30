/**
 * Phase 2 — Layer store cho Sóng nhạc (chức năng 11).
 * UI-only: layers list, selection, add/remove/reorder.
 * History (undo/redo) cho Gizmo: 1 gesture = 1 undo step.
 */

import { create } from 'zustand'
import type {
  SongNhacLayer,
  SongNhacImageLayer,
  SongNhacTextLayer,
  SongNhacGroupLayer,
  SongNhacVisualizerLayer,
  SongNhacVideoLayer,
  SongNhacWaveStyleId,
} from '../types/layerTypes'
import { DEFAULT_TRANSFORM } from '../types/layerTypes'

function nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function cloneLayers(layers: SongNhacLayer[]): SongNhacLayer[] {
  try {
    const sc = (globalThis as { structuredClone?: (v: unknown) => SongNhacLayer[] }).structuredClone
    if (typeof sc === 'function') return sc(layers)
  } catch {
    /* fallback */
  }
  return JSON.parse(JSON.stringify(layers)) as SongNhacLayer[]
}

interface SongNhacLayerState {
  layers: SongNhacLayer[]
  selectedLayerId: string | null
  selectedIds: string[]
  setLayers: (layers: SongNhacLayer[]) => void
  applyTemplateLayers: (layers: SongNhacLayer[]) => void
  setSelectedLayerId: (id: string | null) => void
  /** Multi-select: id = layer clicked, ctrlKey = toggle, shiftKey = range. */
  setSelection: (id: string | null, modifiers?: { ctrlKey?: boolean; shiftKey?: boolean }) => void
  addImageLayer: (name?: string, src?: string) => string
  addTextLayer: (name?: string, text?: string) => string
  addVisualizerLayer: (name?: string, waveStyle?: SongNhacWaveStyleId) => string
  addVideoLayer: (name?: string, src?: string) => string
  /** Thêm logo/watermark layer (image, role='watermark', luôn vẽ trên cùng) */
  addLogoLayer: (src?: string) => string
  /** Thêm intro image layer (hiện trong N giây đầu, có fade-in/out) */
  addIntroLayer: (durationSec?: number) => string
  /** Thêm outro image layer (hiện trong N giây cuối, có fade-in/out) */
  addOutroLayer: (totalDurationSec: number, durationSec?: number) => string
  removeLayer: (id: string) => void
  removeSelectedLayers: () => void
  duplicateLayer: (id: string) => string | null
  copyLayer: (id: string) => void
  copySelectedLayers: () => void
  pasteLayers: () => string | null
  duplicateSelectedLayers: () => void
  clipboard: SongNhacLayer[]
  reorderLayer: (fromIndex: number, toIndex: number) => void
  moveLayerUp: (id: string) => void
  moveLayerDown: (id: string) => void
  updateLayer: (id: string, partial: Partial<SongNhacLayer>) => void
  /** Cập nhật layer và push history trước đó (cho Inspector commit / atomic actions). */
  updateLayerWithHistory: (id: string, partial: Partial<SongNhacLayer>) => void
  getLayer: (id: string) => SongNhacLayer | undefined
  /** History — 1 gesture = 1 undo step */
  historyPast: SongNhacLayer[][]
  historyFuture: SongNhacLayer[][]
  historyLimit: number
  historyGestureActive: boolean
  pushHistorySnapshot: (layers: SongNhacLayer[]) => void
  beginHistoryGesture: () => void
  endHistoryGesture: () => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  /** Khi set, Inspector focus vào ô nội dung text của layer đó (double-click trên canvas). */
  focusContentInputId: string | null
  setFocusContentInputId: (id: string | null) => void
  /** Group: đang edit group nào (cho phép reorder con). */
  editingGroupId: string | null
  setEditingGroupId: (id: string | null) => void
  /** Group: danh sách group đang mở rộng. */
  expandedGroupIds: Record<string, boolean>
  toggleGroupExpanded: (id: string) => void
  addGroup: () => string
  addLayerToGroup: (layerId: string, groupId: string) => void
  removeFromGroup: (layerId: string) => void
  moveLayerInGroup: (groupId: string, fromIndex: number, toIndex: number) => void
  /** Di chuyển cả group trên canvas (cập nhật transform của tất cả children). */
  moveGroup: (groupId: string, deltaX: number, deltaY: number) => void
  /** Di chuyển tất cả layers trong selectedIds. */
  moveSelectedLayers: (deltaX: number, deltaY: number) => void
}

const HISTORY_LIMIT = 50

const PASTE_OFFSET = 30

export const useSongNhacLayerStore = create<SongNhacLayerState>((set, get) => ({
  layers: [],
  selectedLayerId: null,
  selectedIds: [],
  clipboard: [],
  historyPast: [],
  historyFuture: [],
  historyLimit: HISTORY_LIMIT,
  historyGestureActive: false,

  setLayers: (layers) => set({ layers }),

  /** Áp dụng layers từ template (push history trước). */
  applyTemplateLayers: (layers: SongNhacLayer[]) => {
    get().pushHistorySnapshot(get().layers)
    set({ layers, selectedLayerId: null })
  },

  setSelectedLayerId: (id) =>
    set({ selectedLayerId: id, selectedIds: id ? [id] : [] }),

  setSelection: (id, modifiers) => {
    const { layers, selectedIds, selectedLayerId } = get()
    if (!id) {
      set({ selectedLayerId: null, selectedIds: [] })
      return
    }
    if (modifiers?.ctrlKey) {
      const idx = selectedIds.indexOf(id)
      const next =
        idx >= 0
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id]
      set({
        selectedLayerId: next.length > 0 ? id : null,
        selectedIds: next.length > 0 ? next : [],
      })
      return
    }
    if (modifiers?.shiftKey && selectedLayerId) {
      const fromIdx = layers.findIndex((l) => l.id === selectedLayerId)
      const toIdx = layers.findIndex((l) => l.id === id)
      if (fromIdx >= 0 && toIdx >= 0) {
        const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
        const next = layers
          .slice(lo, hi + 1)
          .filter((l) => l.type !== 'group')
          .map((l) => l.id)
        set({ selectedLayerId: id, selectedIds: next.length > 0 ? next : [id] })
        return
      }
    }
    set({ selectedLayerId: id, selectedIds: [id] })
  },

  pushHistorySnapshot: (layers) => {
    const snapshot = cloneLayers(layers)
    set((state) => {
      const nextPast = [...state.historyPast, snapshot]
      const limitedPast =
        nextPast.length > state.historyLimit ? nextPast.slice(-state.historyLimit) : nextPast
      return {
        historyPast: limitedPast,
        historyFuture: [],
      }
    })
  },

  beginHistoryGesture: () => {
    const state = get()
    if (state.historyGestureActive) return
    const snapshot = cloneLayers(state.layers)
    const nextPast = [...state.historyPast, snapshot]
    const limitedPast =
      nextPast.length > state.historyLimit ? nextPast.slice(-state.historyLimit) : nextPast
    set({
      historyPast: limitedPast,
      historyFuture: [],
      historyGestureActive: true,
    })
  },

  endHistoryGesture: () => {
    set({ historyGestureActive: false })
  },

  undo: () => {
    const state = get()
    if (state.historyPast.length === 0) return
    const currentSnapshot = cloneLayers(state.layers)
    const past = [...state.historyPast]
    const prevSnapshot = past.pop()!
    const future = [currentSnapshot, ...state.historyFuture]
    const newLayers = prevSnapshot
    const existingIds = new Set(newLayers.map((l) => l.id))
    const newSelectedId =
      state.selectedLayerId && existingIds.has(state.selectedLayerId)
        ? state.selectedLayerId
        : null
    const newSelectedIds = state.selectedIds.filter((id) => existingIds.has(id))
    set({
      layers: newLayers,
      historyPast: past,
      historyFuture: future,
      selectedLayerId: newSelectedId,
      selectedIds: newSelectedIds.length > 0 ? newSelectedIds : (newSelectedId ? [newSelectedId] : []),
    })
  },

  redo: () => {
    const state = get()
    if (state.historyFuture.length === 0) return
    const currentSnapshot = cloneLayers(state.layers)
    const future = [...state.historyFuture]
    const nextSnapshot = future.shift()!
    const past = [...state.historyPast, currentSnapshot]
    const newLayers = nextSnapshot
    const existingIds = new Set(newLayers.map((l) => l.id))
    const newSelectedId =
      state.selectedLayerId && existingIds.has(state.selectedLayerId)
        ? state.selectedLayerId
        : null
    const newSelectedIds = state.selectedIds.filter((id) => existingIds.has(id))
    set({
      layers: newLayers,
      historyPast: past,
      historyFuture: future,
      selectedLayerId: newSelectedId,
      selectedIds: newSelectedIds.length > 0 ? newSelectedIds : (newSelectedId ? [newSelectedId] : []),
    })
  },

  canUndo: () => get().historyPast.length > 0,
  canRedo: () => get().historyFuture.length > 0,

  addImageLayer: (name, src) => {
    get().pushHistorySnapshot(get().layers)
    const id = nextId('img')
    const layer: SongNhacImageLayer = {
      id,
      type: 'image',
      name: name ?? `Image ${get().layers.length + 1}`,
      visible: true,
      src,
      waveAroundEnabled: true,
      transform: { ...DEFAULT_TRANSFORM },
    }
    set((s) => ({ layers: [...s.layers, layer], selectedLayerId: id }))
    return id
  },

  addTextLayer: (name, text) => {
    get().pushHistorySnapshot(get().layers)
    const id = nextId('txt')
    const layer: SongNhacTextLayer = {
      id,
      type: 'text',
      name: name ?? `Text ${get().layers.length + 1}`,
      visible: true,
      text: text ?? 'New Text',
      fontSize: 24,
      color: '#ffffff',
      transform: { ...DEFAULT_TRANSFORM },
    }
    set((s) => ({ layers: [...s.layers, layer], selectedLayerId: id }))
    return id
  },

  addVisualizerLayer: (name, waveStyle) => {
    get().pushHistorySnapshot(get().layers)
    const id = nextId('viz')
    const layer: SongNhacVisualizerLayer = {
      id,
      type: 'visualizer',
      name: name ?? `Wave ${get().layers.length + 1}`,
      visible: true,
      waveStyle: waveStyle ?? 'circlebars',
      transform: { ...DEFAULT_TRANSFORM },
    }
    set((s) => ({ layers: [...s.layers, layer], selectedLayerId: id }))
    return id
  },

  addVideoLayer: (name, src) => {
    get().pushHistorySnapshot(get().layers)
    const id = nextId('vid')
    const layer: SongNhacVideoLayer = {
      id,
      type: 'video',
      name: name ?? `Video ${get().layers.length + 1}`,
      visible: true,
      src,
      muted: true,
      loop: true,
      transform: { ...DEFAULT_TRANSFORM },
    }
    set((s) => ({ layers: [...s.layers, layer], selectedLayerId: id }))
    return id
  },

  addLogoLayer: (src) => {
    get().pushHistorySnapshot(get().layers)
    const id = nextId('logo')
    const layer: SongNhacImageLayer = {
      id,
      type: 'image',
      name: 'Logo / Watermark',
      visible: true,
      src,
      role: 'watermark',
      fitMode: 'free',
      transform: {
        ...DEFAULT_TRANSFORM,
        x: 0,
        y: 0,
        scaleX: 0.25,
        scaleY: 0.25,
      },
      filter: { opacity: 0.85 },
    }
    set((s) => ({ layers: [...s.layers, layer], selectedLayerId: id }))
    return id
  },

  addIntroLayer: (durationSec = 5) => {
    get().pushHistorySnapshot(get().layers)
    const id = nextId('intro')
    const layer: SongNhacImageLayer = {
      id,
      type: 'image',
      name: `Intro (${durationSec}s)`,
      visible: true,
      fitMode: 'cover',
      transform: { ...DEFAULT_TRANSFORM },
      timeRange: {
        startSec: 0,
        endSec: durationSec,
        fadeInSec: 0.5,
        fadeOutSec: 1,
      },
    }
    set((s) => ({ layers: [...s.layers, layer], selectedLayerId: id }))
    return id
  },

  addOutroLayer: (totalDurationSec, durationSec = 5) => {
    get().pushHistorySnapshot(get().layers)
    const id = nextId('outro')
    const startSec = Math.max(0, totalDurationSec - durationSec)
    const layer: SongNhacImageLayer = {
      id,
      type: 'image',
      name: `Outro (${durationSec}s)`,
      visible: true,
      fitMode: 'cover',
      transform: { ...DEFAULT_TRANSFORM },
      timeRange: {
        startSec,
        endSec: totalDurationSec,
        fadeInSec: 1,
        fadeOutSec: 0.5,
      },
    }
    set((s) => ({ layers: [...s.layers, layer], selectedLayerId: id }))
    return id
  },

  removeSelectedLayers: () => {
    const { selectedIds, layers } = get()
    if (selectedIds.length === 0) return
    get().pushHistorySnapshot(layers)
    const ids = new Set(selectedIds)

    // When a group is selected, also collect its children so they don't become orphans
    for (const id of selectedIds) {
      const layer = layers.find((l) => l.id === id)
      if (layer?.type === 'group') {
        const group = layer as SongNhacGroupLayer
        for (const childId of group.children) ids.add(childId)
      }
    }

    const next = layers
      .filter((l) => !ids.has(l.id))
      .map((l) => {
        if (l.type === 'group') {
          const g = l as SongNhacGroupLayer
          return { ...g, children: g.children.filter((c) => !ids.has(c)) }
        }
        return l
      })
    set({ layers: next, selectedLayerId: null, selectedIds: [] })
  },

  removeLayer: (id) => {
    const { layers } = get()
    const layer = layers.find((l) => l.id === id)
    get().pushHistorySnapshot(layers)
    if (layer?.type === 'group') {
      const group = layer as SongNhacGroupLayer
      // Bug #16 fix: also remove all children of the group, not just strip parentId.
      // Previously children were kept in the array as orphaned top-level layers.
      const childIds = new Set(group.children ?? [])
      const next = layers.filter((l) => l.id !== id && !childIds.has(l.id))
      set({ layers: next, selectedLayerId: get().selectedLayerId === id ? null : get().selectedLayerId })
    } else {
      const parentId = (layer as { parentId?: string }).parentId
      set((s) => ({
        layers: s.layers
          .filter((l) => l.id !== id)
          .map((l) =>
            l.type === 'group' && (l as SongNhacGroupLayer).children.includes(id)
              ? { ...l, children: (l as SongNhacGroupLayer).children.filter((c) => c !== id) }
              : l
          ),
        selectedLayerId: s.selectedLayerId === id ? null : s.selectedLayerId,
      }))
    }
  },

  duplicateLayer: (id) => {
    const layer = get().getLayer(id)
    if (!layer || layer.type === 'group') return null
    get().pushHistorySnapshot(get().layers)
    const prefixMap: Record<string, string> = { image: 'img', text: 'txt', visualizer: 'viz', video: 'vid' }
    const newId = nextId(prefixMap[layer.type] ?? layer.type)
    const t = layer.transform ? { ...layer.transform } : { ...DEFAULT_TRANSFORM }
    t.x += 20
    t.y += 20
    const copy: SongNhacLayer = { ...layer, id: newId, name: layer.name + ' (copy)', transform: t }
    const idx = get().layers.findIndex((l) => l.id === id)
    const insertIdx = idx >= 0 ? idx + 1 : get().layers.length
    const next = [...get().layers]
    next.splice(insertIdx, 0, copy)
    set({ layers: next, selectedLayerId: newId })
    return newId
  },

  copyLayer: (id) => {
    const layer = get().getLayer(id)
    if (!layer || layer.type === 'group') return
    const copied = cloneLayers([layer])
    set({ clipboard: copied })
  },

  copySelectedLayers: () => {
    const { selectedIds, layers } = get()
    const toCopy = selectedIds
      .map((id) => layers.find((l) => l.id === id))
      .filter((l): l is SongNhacLayer => !!l && l.type !== 'group')
    if (toCopy.length === 0) return
    set({ clipboard: cloneLayers(toCopy) })
  },

  pasteLayers: () => {
    const { clipboard, layers } = get()
    if (clipboard.length === 0) return null
    get().pushHistorySnapshot(layers)
    const prefixMap: Record<string, string> = { image: 'img', text: 'txt', visualizer: 'viz', video: 'vid' }
    const newLayers: SongNhacLayer[] = clipboard.map((l) => {
      const newId = nextId(prefixMap[l.type] ?? l.type)
      const t = l.transform ? { ...l.transform } : { ...DEFAULT_TRANSFORM }
      t.x += PASTE_OFFSET
      t.y += PASTE_OFFSET
      return { ...l, id: newId, name: l.name + ' (paste)', transform: t }
    })
    const next = [...layers, ...newLayers]
    const lastId = newLayers[newLayers.length - 1].id
    set({ layers: next, selectedLayerId: lastId })
    return lastId
  },

  duplicateSelectedLayers: () => {
    const { selectedIds, layers } = get()
    if (selectedIds.length === 0) return
    get().pushHistorySnapshot(layers)
    const prefixMap: Record<string, string> = { image: 'img', text: 'txt', visualizer: 'viz', video: 'vid' }
    const toDup = selectedIds
      .map((id) => layers.find((l) => l.id === id))
      .filter((l): l is SongNhacLayer => !!l && l.type !== 'group')
    const newLayers: SongNhacLayer[] = []
    for (const layer of toDup) {
      const newId = nextId(prefixMap[layer.type] ?? layer.type)
      const t = layer.transform ? { ...layer.transform } : { ...DEFAULT_TRANSFORM }
      t.x += 20
      t.y += 20
      const copy: SongNhacLayer = { ...layer, id: newId, name: layer.name + ' (copy)', transform: t }
      newLayers.push(copy)
    }
    const idx = layers.findIndex((l) => l.id === selectedIds[0])
    const insertIdx = idx >= 0 ? idx + 1 : layers.length
    const next = [...layers]
    next.splice(insertIdx, 0, ...newLayers)
    const lastId = newLayers[newLayers.length - 1]?.id ?? null
    set({ layers: next, selectedLayerId: lastId, selectedIds: newLayers.map((l) => l.id) })
  },

  reorderLayer: (fromIndex, toIndex) => {
    const { layers } = get()
    if (fromIndex < 0 || fromIndex >= layers.length || toIndex < 0 || toIndex >= layers.length) return
    get().pushHistorySnapshot(layers)
    const next = [...layers]
    const [removed] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, removed)
    set({ layers: next })
  },

  moveLayerUp: (id) => {
    const { layers } = get()
    const layer = layers.find((l) => l.id === id)
    if (!layer) return
    const idx = layers.findIndex((l) => l.id === id)
    if (idx <= 0) return
    const endIdx =
      layer.type === 'group'
        ? layers.findLastIndex((l) => l.id === id || (l as { parentId?: string }).parentId === id)
        : idx
    get().pushHistorySnapshot(layers)
    const block = layers.slice(idx, endIdx + 1)
    const next = [...layers.slice(0, idx - 1), ...block, layers[idx - 1], ...layers.slice(endIdx + 1)]
    set({ layers: next })
  },

  moveLayerDown: (id) => {
    const { layers } = get()
    const layer = layers.find((l) => l.id === id)
    if (!layer) return
    const idx = layers.findIndex((l) => l.id === id)
    const endIdx =
      layer.type === 'group'
        ? layers.findLastIndex((l) => l.id === id || (l as { parentId?: string }).parentId === id)
        : idx
    if (endIdx >= layers.length - 1) return
    get().pushHistorySnapshot(layers)
    const block = layers.slice(idx, endIdx + 1)
    const next = [...layers.slice(0, idx), layers[endIdx + 1], ...block, ...layers.slice(endIdx + 2)]
    set({ layers: next })
  },

  updateLayer: (id, partial) => {
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, ...partial } : l)),
    }))
  },

  updateLayerWithHistory: (id, partial) => {
    get().pushHistorySnapshot(get().layers)
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, ...partial } : l)),
    }))
  },

  getLayer: (id) => get().layers.find((l) => l.id === id),

  focusContentInputId: null as string | null,
  setFocusContentInputId: (id) => set({ focusContentInputId: id }),

  editingGroupId: null as string | null,
  setEditingGroupId: (id) => set({ editingGroupId: id }),

  expandedGroupIds: {} as Record<string, boolean>,
  toggleGroupExpanded: (id) =>
    set((s) => ({
      expandedGroupIds: {
        ...s.expandedGroupIds,
        [id]: !s.expandedGroupIds[id],
      },
    })),

  addGroup: () => {
    get().pushHistorySnapshot(get().layers)
    const id = nextId('grp')
    const group: SongNhacGroupLayer = {
      id,
      type: 'group',
      name: `Group ${get().layers.filter((l) => l.type === 'group').length + 1}`,
      children: [],
    }
    set((s) => ({ layers: [...s.layers, group], selectedLayerId: id }))
    return id
  },

  addLayerToGroup: (layerId, groupId) => {
    const { layers } = get()
    const layer = layers.find((l) => l.id === layerId)
    const group = layers.find((l) => l.type === 'group' && l.id === groupId) as SongNhacGroupLayer | undefined
    if (!layer || !group || layer.type === 'group') return
    get().pushHistorySnapshot(layers)
    const groupIdx = layers.findIndex((l) => l.id === groupId)
    const lastChildIdx = layers.findLastIndex((l) => (l as { parentId?: string }).parentId === groupId)
    const insertAfter = lastChildIdx >= 0 ? lastChildIdx : groupIdx
    const next = layers.filter((l) => l.id !== layerId)
    const layerWithParent = { ...layer, parentId: groupId } as SongNhacLayer
    next.splice(insertAfter + 1, 0, layerWithParent)
    const updatedGroup: SongNhacGroupLayer = { ...group, children: [...group.children, layerId] }
    const nextWithGroup = next.map((l) => (l.id === groupId ? updatedGroup : l))
    set({ layers: nextWithGroup })
  },

  removeFromGroup: (layerId) => {
    const { layers } = get()
    const layer = layers.find((l) => l.id === layerId)
    if (!layer || layer.type === 'group') return
    const parentId = (layer as { parentId?: string }).parentId
    if (!parentId) return
    get().pushHistorySnapshot(layers)
    const group = layers.find((l) => l.type === 'group' && l.id === parentId) as SongNhacGroupLayer | undefined
    if (!group) return
    const { parentId: _, ...rest } = layer as { parentId?: string }
    const updatedLayer = rest as SongNhacLayer
    const updatedGroup = { ...group, children: group.children.filter((c) => c !== layerId) }
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === layerId ? updatedLayer : l.id === parentId ? updatedGroup : l
      ),
    }))
  },

  moveSelectedLayers: (deltaX, deltaY) => {
    const { selectedIds, layers } = get()
    const ids = new Set(selectedIds)
    set((s) => ({
      layers: s.layers.map((l) => {
        if (!ids.has(l.id) || l.type === 'group') return l
        const t = l.transform ?? { ...DEFAULT_TRANSFORM }
        return {
          ...l,
          transform: { ...t, x: t.x + deltaX, y: t.y + deltaY },
        }
      }),
    }))
  },

  moveGroup: (groupId, deltaX, deltaY) => {
    const { layers } = get()
    const group = layers.find((l) => l.type === 'group' && l.id === groupId) as SongNhacGroupLayer | undefined
    if (!group) return
    set((s) => ({
      layers: s.layers.map((l) => {
        if ((l as { parentId?: string }).parentId !== groupId) return l
        const t = l.transform ?? { ...DEFAULT_TRANSFORM }
        return {
          ...l,
          transform: {
            ...t,
            x: t.x + deltaX,
            y: t.y + deltaY,
          },
        }
      }),
    }))
  },

  moveLayerInGroup: (groupId, fromIndex, toIndex) => {
    const { layers } = get()
    const group = layers.find((l) => l.type === 'group' && l.id === groupId) as SongNhacGroupLayer | undefined
    if (!group || fromIndex < 0 || toIndex < 0 || fromIndex >= group.children.length || toIndex >= group.children.length)
      return
    get().pushHistorySnapshot(layers)
    const nextChildren = [...group.children]
    const [removed] = nextChildren.splice(fromIndex, 1)
    nextChildren.splice(toIndex, 0, removed)
    const childLayers = nextChildren.map((id) => layers.find((l) => l.id === id)!).filter(Boolean)
    const groupIdx = layers.findIndex((l) => l.id === groupId)
    const before = layers.slice(0, groupIdx)
    const after = layers.slice(groupIdx + 1).filter((l) => (l as { parentId?: string }).parentId !== groupId)
    const next = [...before, { ...group, children: nextChildren }, ...childLayers, ...after]
    set({ layers: next })
  },
}))

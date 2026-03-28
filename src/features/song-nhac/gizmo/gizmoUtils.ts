/**
 * Gizmo — hit-test và bounds cho layers.
 * Dùng chung coordinate system với drawLayers (canvas internal).
 */

import type { SongNhacLayer } from '../types/layerTypes'
import { DEFAULT_TRANSFORM } from '../types/layerTypes'
import { isSongNhacImageLayer, isSongNhacGroupLayer, isSongNhacVisualizerLayer, isSongNhacVideoLayer } from '../types/layerTypes'

/** Kích thước layer trong local space (trước scale). */
function getLayerLocalSize(layer: SongNhacLayer): { w: number; h: number } {
  if (isSongNhacGroupLayer(layer)) return { w: 0, h: 0 }
  if (isSongNhacImageLayer(layer)) {
    const w = layer.naturalWidth ?? 120
    const h = layer.naturalHeight ?? 80
    return { w, h }
  }
  if (isSongNhacVisualizerLayer(layer)) {
    // Visualizer vẽ ở ~55% canvas size — dùng kích thước cố định đủ lớn để hit test
    // drawLayers.ts dòng 1550: baseSize = Math.min(width, height) * 0.55
    const size = 400 // Approximate default visualizer bounding size
    return { w: size, h: size }
  }
  if (isSongNhacVideoLayer(layer)) {
    // Video layer — dùng kích thước 16:9 mặc định nếu không có naturalWidth
    const w = (layer as any).naturalWidth ?? 640
    const h = (layer as any).naturalHeight ?? 360
    return { w, h }
  }
  // Text layer fallback
  const text = layer.text ?? 'New Text'
  const fontSize = layer.fontSize ?? 24
  const w = Math.max(80, text.length * fontSize * 0.55)
  const h = fontSize * 1.5
  return { w, h }
}

/** 4 góc của rect (trước rotate) trong local space, đã scale. */
function getScaledCorners(w: number, h: number, scaleX: number, scaleY: number): [number, number][] {
  const hw = (w / 2) * scaleX
  const hh = (h / 2) * scaleY
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ]
}

/** Xoay điểm (x,y) quanh gốc, góc deg. */
function rotatePoint(x: number, y: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [x * c - y * s, x * s + y * c]
}

/** AABB từ 4 góc. */
function aabbFromCorners(corners: [number, number][]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of corners) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}

/** Bounding box của layer trong canvas coordinates. */
export function getLayerBounds(
  layer: SongNhacLayer,
  canvasWidth: number,
  canvasHeight: number
): { minX: number; minY: number; maxX: number; maxY: number } {
  const t = layer.transform ?? DEFAULT_TRANSFORM
  const cx = canvasWidth / 2
  const cy = canvasHeight / 2
  const centerX = cx + t.x
  const centerY = cy + t.y

  const { w, h } = getLayerLocalSize(layer)
  const corners = getScaledCorners(w, h, t.scaleX, t.scaleY)
  const rotated = corners.map(([x, y]) => rotatePoint(x, y, t.rotation))
  const translated = rotated.map(([x, y]) => [x + centerX, y + centerY] as [number, number])
  const aabb = aabbFromCorners(translated)
  return aabb
}

/** 4 góc của layer trong canvas coordinates (để vẽ outline + handles). */
export function getLayerCorners(
  layer: SongNhacLayer,
  canvasWidth: number,
  canvasHeight: number
): [[number, number], [number, number], [number, number], [number, number]] {
  const t = layer.transform ?? DEFAULT_TRANSFORM
  const cx = canvasWidth / 2
  const cy = canvasHeight / 2
  const centerX = cx + t.x
  const centerY = cy + t.y

  const { w, h } = getLayerLocalSize(layer)
  const corners = getScaledCorners(w, h, t.scaleX, t.scaleY)
  const rotated = corners.map(([x, y]) => rotatePoint(x, y, t.rotation))
  return rotated.map(([x, y]) => [x + centerX, y + centerY] as [number, number]) as [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ]
}

/** Vị trí rotate handle (trên center-top của layer). */
export function getRotateHandlePosition(
  layer: SongNhacLayer,
  canvasWidth: number,
  canvasHeight: number,
  offset: number = 28
): [number, number] {
  const corners = getLayerCorners(layer, canvasWidth, canvasHeight)
  const topCenterX = (corners[0][0] + corners[1][0]) / 2
  const topCenterY = (corners[0][1] + corners[1][1]) / 2
  const centerX = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4
  const centerY = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4
  const dx = topCenterX - centerX
  const dy = topCenterY - centerY
  const len = Math.hypot(dx, dy) || 1
  return [
    centerX + (dx / len) * (len + offset),
    centerY + (dy / len) * (len + offset),
  ]
}

const HANDLE_HIT_RADIUS = 16

/** Ngưỡng snap (px) khi giữ Shift — căn vào tâm canvas hoặc layer khác. */
export const SNAP_THRESHOLD = 12

export interface AlignmentLine {
  type: 'horizontal' | 'vertical'
  value: number
  source: 'canvas' | 'layer'
}

/** Các đường căn chỉnh khi giữ Shift: tâm canvas + tâm/edge của layers khác. */
export function getAlignmentLines(
  layers: SongNhacLayer[],
  excludeLayerId: string,
  canvasWidth: number,
  canvasHeight: number
): AlignmentLine[] {
  const lines: AlignmentLine[] = []
  const cx = canvasWidth / 2
  const cy = canvasHeight / 2
  lines.push({ type: 'horizontal', value: cy, source: 'canvas' })
  lines.push({ type: 'vertical', value: cx, source: 'canvas' })

  for (const layer of layers) {
    if (layer.id === excludeLayerId || !layer.visible || isSongNhacGroupLayer(layer)) continue
    const t = (layer as { transform?: typeof DEFAULT_TRANSFORM }).transform ?? DEFAULT_TRANSFORM
    const centerX = cx + t.x
    const centerY = cy + t.y
    lines.push({ type: 'horizontal', value: centerY, source: 'layer' })
    lines.push({ type: 'vertical', value: centerX, source: 'layer' })
  }
  const EPS = 1
  const deduped: AlignmentLine[] = []
  for (const line of lines) {
    const exists = deduped.some(
      (d) => d.type === line.type && Math.abs(d.value - line.value) < EPS
    )
    if (!exists) deduped.push(line)
  }
  return deduped
}

/** Snap position (x,y) to alignment lines; trả về { x, y } đã snap. */
export function snapToAlignment(
  x: number,
  y: number,
  lines: AlignmentLine[]
): { x: number; y: number } {
  let outX = x
  let outY = y
  for (const line of lines) {
    if (line.type === 'horizontal' && Math.abs(y - line.value) <= SNAP_THRESHOLD) {
      outY = line.value
    }
    if (line.type === 'vertical' && Math.abs(x - line.value) <= SNAP_THRESHOLD) {
      outX = line.value
    }
  }
  return { x: outX, y: outY }
}

/** Hit-test handles: 'nw'|'ne'|'sw'|'se'|'rotate'|null. */
export function hitTestHandles(
  layer: SongNhacLayer,
  canvasX: number,
  canvasY: number,
  canvasWidth: number,
  canvasHeight: number
): 'nw' | 'ne' | 'sw' | 'se' | 'rotate' | null {
  const corners = getLayerCorners(layer, canvasWidth, canvasHeight)
  const handles: ['nw', 'ne', 'sw', 'se'] = ['nw', 'ne', 'sw', 'se']
  for (let i = 0; i < 4; i++) {
    const [hx, hy] = corners[i]
    if (Math.hypot(canvasX - hx, canvasY - hy) <= HANDLE_HIT_RADIUS) return handles[i]
  }
  const [rx, ry] = getRotateHandlePosition(layer, canvasWidth, canvasHeight)
  if (Math.hypot(canvasX - rx, canvasY - ry) <= HANDLE_HIT_RADIUS) return 'rotate'
  return null
}

/** Bounding box của group (union AABB của tất cả children). */
export function getGroupBounds(
  layers: SongNhacLayer[],
  groupId: string,
  canvasWidth: number,
  canvasHeight: number
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const group = layers.find((l) => l.type === 'group' && l.id === groupId) as
    | { children: string[] }
    | undefined
  if (!group) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of group.children) {
    const layer = layers.find((l) => l.id === id)
    if (!layer || isSongNhacGroupLayer(layer)) continue
    const b = getLayerBounds(layer, canvasWidth, canvasHeight)
    minX = Math.min(minX, b.minX)
    minY = Math.min(minY, b.minY)
    maxX = Math.max(maxX, b.maxX)
    maxY = Math.max(maxY, b.maxY)
  }
  if (minX === Infinity) return null
  return { minX, minY, maxX, maxY }
}

/** Kiểm tra (canvasX, canvasY) có nằm trong group bounds không. */
export function hitTestGroup(
  layers: SongNhacLayer[],
  groupId: string,
  canvasX: number,
  canvasY: number,
  canvasWidth: number,
  canvasHeight: number
): boolean {
  const b = getGroupBounds(layers, groupId, canvasWidth, canvasHeight)
  if (!b) return false
  return canvasX >= b.minX && canvasX <= b.maxX && canvasY >= b.minY && canvasY <= b.maxY
}

/** Kiểm tra layerId có phải là con của groupId không. */
export function isChildOfGroup(
  layers: SongNhacLayer[],
  layerId: string,
  groupId: string
): boolean {
  const group = layers.find((l) => l.type === 'group' && l.id === groupId) as
    | { children: string[] }
    | undefined
  return !!group?.children.includes(layerId)
}

/** Hit-test: trả về layer id nếu (canvasX, canvasY) nằm trong layer. Layers từ dưới lên (index 0 trước), trả về layer trên cùng. */
export function hitTestLayers(
  layers: SongNhacLayer[],
  canvasX: number,
  canvasY: number,
  canvasWidth: number,
  canvasHeight: number
): string | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (!layer.visible || isSongNhacGroupLayer(layer)) continue
    const b = getLayerBounds(layer, canvasWidth, canvasHeight)
    if (canvasX >= b.minX && canvasX <= b.maxX && canvasY >= b.minY && canvasY <= b.maxY) {
      return layer.id
    }
  }
  return null
}

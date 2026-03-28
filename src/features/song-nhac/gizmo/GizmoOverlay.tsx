/**
 * Gizmo overlay — hit-test, chọn layer, kéo di chuyển/resize/xoay trên canvas.
 * Overlay trùm lên canvas, bắt pointer events, không chạm pointer handlers của canvas.
 */

import { useRef, useCallback, useState, useEffect } from 'react'
import {
  hitTestLayers,
  hitTestHandles,
  hitTestGroup,
  isChildOfGroup,
  getGroupBounds,
  getLayerCorners,
  getRotateHandlePosition,
  getAlignmentLines,
  snapToAlignment,
  SNAP_THRESHOLD,
} from './gizmoUtils'
import type { SongNhacLayer } from '../types/layerTypes'
import { isSongNhacTextLayer, isSongNhacGroupLayer } from '../types/layerTypes'

export interface GizmoOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  layers: SongNhacLayer[]
  selectedLayerId: string | null
  selectedIds?: string[]
  onSelectLayer: (id: string | null) => void
  onSetSelection?: (id: string | null, modifiers?: { ctrlKey?: boolean; shiftKey?: boolean }) => void
  onUpdateLayerTransform: (id: string, deltaX: number, deltaY: number) => void
  onMoveSelectedLayers?: (deltaX: number, deltaY: number) => void
  onUpdateLayerScale: (id: string, scaleX: number, scaleY: number) => void
  onUpdateLayerRotation: (id: string, rotation: number) => void
  onBeginHistoryGesture?: () => void
  onEndHistoryGesture?: () => void
  onEditTextLayer?: (id: string) => void
  showGrid?: boolean
  onCanvasSizeChange?: (size: { w: number; h: number; displayW: number; displayH: number } | null) => void
  onMoveGroup?: (groupId: string, deltaX: number, deltaY: number) => void
}

export default function GizmoOverlay({
  containerRef,
  layers,
  selectedLayerId,
  selectedIds = [],
  onSelectLayer,
  onSetSelection,
  onUpdateLayerTransform,
  onUpdateLayerScale,
  onUpdateLayerRotation,
  onMoveSelectedLayers,
  onBeginHistoryGesture,
  onEndHistoryGesture,
  onEditTextLayer,
  showGrid = false,
  onCanvasSizeChange,
  onMoveGroup,
}: GizmoOverlayProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [shiftKey, setShiftKey] = useState(false)
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null)
  const lastClickRef = useRef<{ id: string; time: number } | null>(null)
  const dragRef = useRef<
    | { mode: 'move'; layerId: string; startX: number; startY: number }
    | { mode: 'moveGroup'; groupId: string; startX: number; startY: number }
    | {
        mode: 'resize'
        layerId: string
        startScaleX: number
        startScaleY: number
        startDist: number
        startCenterCanvas: [number, number]
      }
    | {
        mode: 'rotate'
        layerId: string
        startRotation: number
        startAngle: number
      }
    | null
  >(null)

  const pointerToCanvas = useCallback(
    (clientX: number, clientY: number): { canvasX: number; canvasY: number } | null => {
      const container = containerRef.current
      if (!container) return null
      const canvas = container.querySelector('canvas')
      if (!canvas || !(canvas instanceof HTMLCanvasElement)) return null
      const rect = canvas.getBoundingClientRect()
      const displayX = clientX - rect.left
      const displayY = clientY - rect.top
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      return {
        canvasX: displayX * scaleX,
        canvasY: displayY * scaleY,
      }
    },
    [containerRef]
  )

  const getCanvasSize = useCallback((): { w: number; h: number } | null => {
    const container = containerRef.current
    if (!container) return null
    const canvas = container.querySelector('canvas')
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) return null
    return { w: canvas.width, h: canvas.height }
  }, [containerRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      setCanvasSize(null)
      onCanvasSizeChange?.(null)
      return
    }
    const update = () => {
      const canvas = container.querySelector('canvas') ?? container.firstElementChild
      if (canvas instanceof HTMLCanvasElement) {
        const rect = canvas.getBoundingClientRect()
        const size = { w: canvas.width, h: canvas.height, displayW: rect.width, displayH: rect.height }
        setCanvasSize({ w: size.w, h: size.h })
        onCanvasSizeChange?.(size)
      } else {
        setCanvasSize(null)
        onCanvasSizeChange?.(null)
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(container)
    return () => {
      ro.disconnect()
      onCanvasSizeChange?.(null)
    }
  }, [containerRef, onCanvasSizeChange])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftKey(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftKey(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      const pt = pointerToCanvas(e.clientX, e.clientY)
      const size = getCanvasSize()
      if (!pt || !size) return

      const selectedLayer =
        selectedLayerId ? layers.find((l) => l.id === selectedLayerId) : null

      if (selectedLayer && !selectedLayer.locked && !isSongNhacGroupLayer(selectedLayer)) {
        const handle = hitTestHandles(
          selectedLayer,
          pt.canvasX,
          pt.canvasY,
          size.w,
          size.h
        )
        if (handle === 'rotate') {
          lastClickRef.current = null
          onBeginHistoryGesture?.()
          const t = selectedLayer.transform!
          const cx = size.w / 2 + t.x
          const cy = size.h / 2 + t.y
          const startAngle = Math.atan2(
            pt.canvasY - cy,
            pt.canvasX - cx
          )
          dragRef.current = {
            mode: 'rotate',
            layerId: selectedLayer.id,
            startRotation: t.rotation,
            startAngle,
          }
          setIsDragging(true)
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          return
        }
        if (handle) {
          lastClickRef.current = null
          onBeginHistoryGesture?.()
          const t = selectedLayer.transform!
          const cx = size.w / 2 + t.x
          const cy = size.h / 2 + t.y
          const startDist = Math.hypot(pt.canvasX - cx, pt.canvasY - cy) || 1
          dragRef.current = {
            mode: 'resize',
            layerId: selectedLayer.id,
            startScaleX: t.scaleX,
            startScaleY: t.scaleY,
            startDist,
            startCenterCanvas: [cx, cy],
          }
          setIsDragging(true)
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          return
        }
      }

      const hitId = hitTestLayers(layers, pt.canvasX, pt.canvasY, size.w, size.h)

      if (hitId && onEditTextLayer) {
        const layer = layers.find((l) => l.id === hitId)
        if (layer && isSongNhacTextLayer(layer)) {
          const now = Date.now()
          const last = lastClickRef.current
          if (last?.id === hitId && now - last.time < 500) {
            lastClickRef.current = null
            onEditTextLayer(hitId)
            return
          }
          lastClickRef.current = { id: hitId, time: now }
        }
      }

      const selectedIsGroup = selectedLayer && isSongNhacGroupLayer(selectedLayer)
      const hitIsInSelectedGroup =
        selectedIsGroup && hitId && isChildOfGroup(layers, hitId, selectedLayer!.id)
      const hitInGroupBounds =
        selectedIsGroup &&
        onMoveGroup &&
        hitTestGroup(layers, selectedLayer!.id, pt.canvasX, pt.canvasY, size.w, size.h)

      if (hitIsInSelectedGroup || hitInGroupBounds) {
        lastClickRef.current = null
        onBeginHistoryGesture?.()
        dragRef.current = {
          mode: 'moveGroup',
          groupId: selectedLayer!.id,
          startX: e.clientX,
          startY: e.clientY,
        }
        setIsDragging(true)
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        return
      }

      if (onSetSelection) {
        onSetSelection(hitId, { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey })
      } else {
        onSelectLayer(hitId)
      }

      if (hitId) {
        const layer = layers.find((l) => l.id === hitId)
        if (layer?.transform && !layer.locked) {
          lastClickRef.current = null
          onBeginHistoryGesture?.()
          dragRef.current = {
            mode: 'move',
            layerId: hitId,
            startX: e.clientX,
            startY: e.clientY,
          }
          setIsDragging(true)
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }
      }
    },
    [layers, selectedLayerId, pointerToCanvas, getCanvasSize, onSelectLayer, onSetSelection, onBeginHistoryGesture, onEditTextLayer, onMoveGroup]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return

      const pt = pointerToCanvas(e.clientX, e.clientY)
      const size = getCanvasSize()
      if (!pt || !size) return

      if (drag.mode === 'move') {
        const container = containerRef.current
        if (!container) return
        const canvas = container.querySelector('canvas')
        if (!canvas || !(canvas instanceof HTMLCanvasElement)) return
        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height
        let deltaX = (e.clientX - drag.startX) * scaleX
        let deltaY = (e.clientY - drag.startY) * scaleY

        const layer = layers.find((l) => l.id === drag.layerId)
        const t = layer?.transform
        if (t) {
          const cx = size.w / 2
          const cy = size.h / 2
          let centerX = cx + t.x + deltaX
          let centerY = cy + t.y + deltaY
          if (e.shiftKey) {
            const lines = getAlignmentLines(layers, drag.layerId, size.w, size.h)
            const snapped = snapToAlignment(centerX, centerY, lines)
            centerX = snapped.x
            centerY = snapped.y
          } else if (showGrid) {
            const snapped = snapToGrid(centerX, centerY, GRID_STEP)
            centerX = snapped.x
            centerY = snapped.y
          }
          deltaX = centerX - cx - t.x
          deltaY = centerY - cy - t.y
        }

        const useMultiMove =
          onMoveSelectedLayers &&
          selectedIds.length > 1 &&
          selectedIds.includes(drag.layerId)
        if (useMultiMove) {
          onMoveSelectedLayers(deltaX, deltaY)
        } else {
          onUpdateLayerTransform(drag.layerId, deltaX, deltaY)
        }
        dragRef.current = { ...drag, startX: e.clientX, startY: e.clientY }
        return
      }

      if (drag.mode === 'moveGroup' && onMoveGroup) {
        const container = containerRef.current
        if (!container) return
        const canvas = container.querySelector('canvas')
        if (!canvas || !(canvas instanceof HTMLCanvasElement)) return
        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height
        let deltaX = (e.clientX - drag.startX) * scaleX
        let deltaY = (e.clientY - drag.startY) * scaleY
        if (showGrid) {
          const b = getGroupBounds(layers, drag.groupId, size.w, size.h)
          if (b) {
            const centerX = (b.minX + b.maxX) / 2 + deltaX
            const centerY = (b.minY + b.maxY) / 2 + deltaY
            const snapped = snapToGrid(centerX, centerY, GRID_STEP)
            deltaX = snapped.x - (b.minX + b.maxX) / 2
            deltaY = snapped.y - (b.minY + b.maxY) / 2
          }
        }
        onMoveGroup(drag.groupId, deltaX, deltaY)
        dragRef.current = { ...drag, startX: e.clientX, startY: e.clientY }
        return
      }

      if (drag.mode === 'resize') {
        const [cx, cy] = drag.startCenterCanvas
        const curDist = Math.hypot(pt.canvasX - cx, pt.canvasY - cy) || 1
        const factor = curDist / drag.startDist
        const newScaleX = Math.max(0.1, drag.startScaleX * factor)
        const newScaleY = Math.max(0.1, drag.startScaleY * factor)
        onUpdateLayerScale(drag.layerId, newScaleX, newScaleY)
        dragRef.current = {
          ...drag,
          startDist: curDist,
          startScaleX: newScaleX,
          startScaleY: newScaleY,
        }
        return
      }

      if (drag.mode === 'rotate') {
        const layer = layers.find((l) => l.id === drag.layerId)
        const t = layer?.transform
        if (!t) return
        const cx = size.w / 2 + t.x
        const cy = size.h / 2 + t.y
        const curAngle = Math.atan2(pt.canvasY - cy, pt.canvasX - cx)
        const deltaDeg = ((curAngle - drag.startAngle) * 180) / Math.PI
        onUpdateLayerRotation(drag.layerId, drag.startRotation + deltaDeg)
      }
    },
    [
      layers,
      containerRef,
      pointerToCanvas,
      getCanvasSize,
      showGrid,
      selectedIds,
      onUpdateLayerTransform,
      onUpdateLayerScale,
      onUpdateLayerRotation,
      onMoveSelectedLayers,
      onMoveGroup,
    ]
  )

  const endDrag = useCallback(() => {
    if (dragRef.current) {
      onEndHistoryGesture?.()
      dragRef.current = null
    }
    setIsDragging(false)
  }, [onEndHistoryGesture])

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
      endDrag()
    },
    [endDrag]
  )

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
      endDrag()
    },
    [endDrag]
  )

  useEffect(() => {
    const onBlur = () => endDrag()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [endDrag])

  const selectedLayer = selectedLayerId
    ? layers.find((l) => l.id === selectedLayerId)
    : null
  const selectedLayersForOutline = selectedIds
    .map((id) => layers.find((l) => l.id === id))
    .filter((l): l is SongNhacLayer => !!l && !isSongNhacGroupLayer(l))

  const getCursor = () => {
    if (isDragging && dragRef.current) {
      if (dragRef.current.mode === 'resize') return 'nwse-resize'
      if (dragRef.current.mode === 'rotate') return 'grabbing'
      if (dragRef.current.mode === 'moveGroup') return 'grabbing'
    }
    return isDragging ? 'grabbing' : selectedLayerId ? (selectedLayer?.locked ? 'default' : 'grab') : 'default'
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        pointerEvents: 'auto',
        cursor: getCursor(),
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerUp}
    >
      {(selectedLayer || selectedLayersForOutline.length > 0 || showGrid) && canvasSize && (
        <svg
          viewBox={`0 0 ${canvasSize.w} ${canvasSize.h}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          {showGrid && <GridOverlay canvasSize={canvasSize} />}
          {shiftKey && selectedLayer && (
            <AlignmentGuides canvasSize={canvasSize} layer={selectedLayer} layers={layers} />
          )}
          {selectedLayersForOutline.map((layer) => (
            <SelectionOutline
              key={layer.id}
              layer={layer}
              canvasSize={canvasSize}
              showHandles={layer.id === selectedLayerId}
            />
          ))}
          {selectedLayer && isSongNhacGroupLayer(selectedLayer) && (
            <GroupBoundsOutline
              layers={layers}
              groupId={selectedLayer.id}
              canvasSize={canvasSize}
            />
          )}
        </svg>
      )}
    </div>
  )
}

const GRID_STEP = 50

function snapToGrid(x: number, y: number, step: number): { x: number; y: number } {
  return {
    x: Math.round(x / step) * step,
    y: Math.round(y / step) * step,
  }
}

function GridOverlay({ canvasSize }: { canvasSize: { w: number; h: number } }) {
  const { w, h } = canvasSize
  const lines: React.ReactNode[] = []
  for (let x = 0; x <= w; x += GRID_STEP) {
    lines.push(
      <line
        key={`v-${x}`}
        x1={x}
        y1={0}
        x2={x}
        y2={h}
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={1}
      />
    )
  }
  for (let y = 0; y <= h; y += GRID_STEP) {
    lines.push(
      <line
        key={`h-${y}`}
        x1={0}
        y1={y}
        x2={w}
        y2={y}
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={1}
      />
    )
  }
  return <g>{lines}</g>
}

function AlignmentGuides({
  canvasSize,
  layer,
  layers,
}: {
  canvasSize: { w: number; h: number }
  layer: SongNhacLayer
  layers: SongNhacLayer[]
}) {
  const corners = getLayerCorners(layer, canvasSize.w, canvasSize.h)
  const layerCenterX = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4
  const layerCenterY = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4
  const lines = getAlignmentLines(layers, layer.id, canvasSize.w, canvasSize.h)

  // Chỉ hiện lines gần layer (trong phạm vi snap) — tránh hiện quá nhiều lines gây rối
  const activeLines = lines.filter((line) => {
    const dist = line.type === 'horizontal'
      ? Math.abs(layerCenterY - line.value)
      : Math.abs(layerCenterX - line.value)
    return dist <= SNAP_THRESHOLD * 3
  })

  const strokeActive = 'rgba(0,220,255,0.9)'
  const strokeNear = 'rgba(0,180,255,0.4)'

  return (
    <>
      {/* Canvas center crosshair — luôn hiện khi giữ Shift */}
      <line x1={canvasSize.w / 2} y1={0} x2={canvasSize.w / 2} y2={canvasSize.h}
        stroke="rgba(255,255,0,0.3)" strokeWidth={1} strokeDasharray="8 6" />
      <line x1={0} y1={canvasSize.h / 2} x2={canvasSize.w} y2={canvasSize.h / 2}
        stroke="rgba(255,255,0,0.3)" strokeWidth={1} strokeDasharray="8 6" />

      {activeLines.map((line, i) => {
        const dist = line.type === 'horizontal'
          ? Math.abs(layerCenterY - line.value)
          : Math.abs(layerCenterX - line.value)
        const isSnapped = dist <= SNAP_THRESHOLD
        return line.type === 'horizontal' ? (
          <line
            key={`h-${i}`}
            x1={0}
            y1={line.value}
            x2={canvasSize.w}
            y2={line.value}
            stroke={isSnapped ? strokeActive : strokeNear}
            strokeWidth={isSnapped ? 2 : 1}
            strokeDasharray="6 4"
          />
        ) : (
          <line
            key={`v-${i}`}
            x1={line.value}
            y1={0}
            x2={line.value}
            y2={canvasSize.h}
            stroke={isSnapped ? strokeActive : strokeNear}
            strokeWidth={isSnapped ? 2 : 1}
            strokeDasharray="6 4"
          />
        )
      })}
    </>
  )
}

function GroupBoundsOutline({
  layers,
  groupId,
  canvasSize,
}: {
  layers: SongNhacLayer[]
  groupId: string
  canvasSize: { w: number; h: number }
}) {
  const b = getGroupBounds(layers, groupId, canvasSize.w, canvasSize.h)
  if (!b) return null
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  return (
    <rect
      x={b.minX}
      y={b.minY}
      width={w}
      height={h}
      fill="none"
      stroke="rgba(0,180,255,0.5)"
      strokeWidth={2}
      strokeDasharray="8 4"
    />
  )
}

function SelectionOutline({
  layer,
  canvasSize,
  showHandles = true,
}: {
  layer: SongNhacLayer
  canvasSize: { w: number; h: number }
  showHandles?: boolean
}) {
  const corners = getLayerCorners(layer, canvasSize.w, canvasSize.h)
  const [rx, ry] = getRotateHandlePosition(layer, canvasSize.w, canvasSize.h)
  const pathD = `M ${corners[0][0]} ${corners[0][1]} L ${corners[1][0]} ${corners[1][1]} L ${corners[2][0]} ${corners[2][1]} L ${corners[3][0]} ${corners[3][1]} Z`
  const centerX = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4
  const centerY = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4
  const r = 8
  return (
    <>
      <path
        d={pathD}
        fill="none"
        stroke="rgba(0,122,204,0.9)"
        strokeWidth={2}
      />
      {showHandles && (
        <>
          <line
            x1={centerX}
            y1={centerY}
            x2={rx}
            y2={ry}
            stroke="rgba(0,122,204,0.7)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          {corners.map(([x, y], i) => (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={r}
              fill="rgba(255,255,255,0.9)"
              stroke="rgba(0,122,204,0.9)"
              strokeWidth={1.5}
            />
          ))}
          <circle
            cx={rx}
            cy={ry}
            r={r}
            fill="rgba(255,255,255,0.9)"
            stroke="rgba(0,122,204,0.9)"
            strokeWidth={1.5}
          />
        </>
      )}
    </>
  )
}

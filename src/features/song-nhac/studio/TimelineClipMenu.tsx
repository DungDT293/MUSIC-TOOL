import { useEffect, useRef } from 'react'
import type { StudioLayer } from './layerTypes'
import { useSongNhacLayerStore } from './songNhacLayerStore'

export interface ClipMenuState {
  x: number
  y: number
  layerId: string
}

interface TimelineClipMenuProps {
  menu: ClipMenuState
  playhead: number
  duration: number
  snapEnabled: boolean
  onClose: () => void
  onToggleSnap: () => void
}

const itemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 10px',
  background: 'transparent',
  border: 'none',
  color: '#e2e8f0',
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

/** Right-click menu for a clip on the timeline. */
export function TimelineClipMenu({
  menu,
  playhead,
  duration,
  snapEnabled,
  onClose,
  onToggleSnap,
}: TimelineClipMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const layer = useSongNhacLayerStore.getState().layers.find((item) => item.id === menu.layerId)
  if (!layer || layer.type === 'group') return null
  const store = useSongNhacLayerStore.getState()
  const total = duration > 0 ? duration : 1
  const currentStart = layer.timeRange ? Math.max(0, layer.timeRange.startSec) : 0
  const currentEnd =
    layer.timeRange && Number.isFinite(layer.timeRange.endSec) ? Math.min(total, layer.timeRange.endSec) : total
  const setRange = (startSec: number, endSec: number) => {
    store.updateLayerWithHistory(menu.layerId, {
      timeRange: {
        startSec: Number(Math.max(0, startSec).toFixed(3)),
        endSec: Number(Math.min(total, Math.max(startSec + 0.2, endSec)).toFixed(3)),
        fadeInSec: layer.timeRange?.fadeInSec ?? 0,
        fadeOutSec: layer.timeRange?.fadeOutSec ?? 0,
      },
    } as never)
  }

  const items: Array<{ label: string; action: () => void; danger?: boolean }> = [
    { label: `Bắt đầu tại ${playhead.toFixed(2)}s`, action: () => setRange(playhead, Math.max(playhead + 0.2, currentEnd)) },
    { label: `Kết thúc tại ${playhead.toFixed(2)}s`, action: () => setRange(Math.min(playhead - 0.2, currentStart), playhead) },
    { label: 'Phủ toàn bộ bài', action: () => setRange(0, total) },
    { label: 'Xoá khoảng thời gian', action: () => store.updateLayerWithHistory(menu.layerId, { timeRange: undefined } as never) },
    { label: layer.visible ? 'Ẩn clip' : 'Hiện clip', action: () => store.updateLayerWithHistory(menu.layerId, { visible: !layer.visible } as never) },
    { label: 'Nhân bản', action: () => store.duplicateLayer(menu.layerId) },
    { label: snapEnabled ? 'Tắt bắt dính (snap)' : 'Bật bắt dính (snap)', action: onToggleSnap },
    { label: 'Xoá lớp', action: () => store.removeLayer(menu.layerId), danger: true },
  ]

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: Math.min(menu.x, window.innerWidth - 230),
        top: Math.min(menu.y, window.innerHeight - 280),
        zIndex: 2000,
        minWidth: 210,
        padding: 4,
        borderRadius: 8,
        border: '1px solid #1e293b',
        background: '#0b1220',
        boxShadow: '0 12px 30px rgba(0, 0, 0, 0.55)',
      }}
    >
      <div style={{ padding: '4px 10px 6px', fontSize: 10, color: '#64748b', letterSpacing: 0.4 }}>
        {`${(layer as StudioLayer).name} · ${currentStart.toFixed(1)}–${currentEnd.toFixed(1)}s`}
      </div>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => {
            item.action()
            onClose()
          }}
          style={{ ...itemStyle, color: item.danger ? '#fca5a5' : itemStyle.color }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = '#16233b'
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = 'transparent'
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

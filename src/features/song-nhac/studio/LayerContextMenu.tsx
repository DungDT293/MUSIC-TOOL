import { useEffect, useRef } from 'react'
import {
  DEFAULT_FILTER,
  DEFAULT_TRANSFORM,
  isVisualizerLayer,
  type StudioAnyLayer,
} from './layerTypes'
import { useSongNhacLayerStore } from './songNhacLayerStore'

export interface LayerMenuState {
  x: number
  y: number
  layerId: string
}

interface LayerContextMenuProps {
  menu: LayerMenuState
  onClose: () => void
  onChoosePreset?: (layerId: string) => void
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

/**
 * Right-click menu for a layer, mirroring the reference editor's layer context menu:
 * preset, automation, visibility, stacking, duplicate, reset and delete.
 */
export function LayerContextMenu({ menu, onClose, onChoosePreset }: LayerContextMenuProps) {
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

  const layer: StudioAnyLayer | undefined = useSongNhacLayerStore.getState().layers.find((item) => item.id === menu.layerId)
  if (!layer) return null
  const store = useSongNhacLayerStore.getState()
  const isGroup = layer.type === 'group'

  const run = (action: () => void) => () => {
    action()
    onClose()
  }

  const items: Array<{ label: string; action: () => void; hidden?: boolean; danger?: boolean }> = [
    {
      label: 'Chọn preset sóng…',
      hidden: !isVisualizerLayer(layer),
      action: () => onChoosePreset?.(layer.id),
    },
    {
      label: 'Thêm keyframe độ mờ',
      hidden: isGroup,
      action: () => store.addKeyframe(layer.id, 'opacity', (layer as { filter?: { opacity: number } }).filter?.opacity ?? 1),
    },
    {
      label: !isGroup && (layer as { visible?: boolean }).visible ? 'Ẩn lớp' : 'Hiện lớp',
      hidden: isGroup,
      action: () =>
        store.updateLayerWithHistory(layer.id, {
          visible: !(layer as { visible?: boolean }).visible,
        } as never),
    },
    { label: 'Nhân bản', action: () => store.duplicateLayer(layer.id) },
    { label: 'Đưa lên trên', action: () => store.moveLayerUp(layer.id) },
    { label: 'Đưa xuống dưới', action: () => store.moveLayerDown(layer.id) },
    {
      label: 'Đặt lại biến đổi',
      hidden: isGroup,
      action: () =>
        store.updateLayerWithHistory(layer.id, {
          transform: { ...DEFAULT_TRANSFORM },
          filter: { ...DEFAULT_FILTER },
        }),
    },
    { label: 'Xoá lớp', action: () => store.removeLayer(layer.id), danger: true },
  ]

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: Math.min(menu.x, window.innerWidth - 210),
        top: Math.min(menu.y, window.innerHeight - 260),
        zIndex: 2000,
        minWidth: 190,
        padding: 4,
        borderRadius: 8,
        border: '1px solid #1e293b',
        background: '#0b1220',
        boxShadow: '0 12px 30px rgba(0, 0, 0, 0.55)',
      }}
    >
      <div style={{ padding: '4px 10px 6px', fontSize: 10, color: '#64748b', letterSpacing: 0.4 }}>
        {layer.name.toUpperCase()}
      </div>
      {items
        .filter((item) => !item.hidden)
        .map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={run(item.action)}
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

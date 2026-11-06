import type { StudioLayer, StudioLayerType } from './layerTypes'

const panelStyle: React.CSSProperties = {
  background: '#0b1220',
  border: '1px solid #1e293b',
  borderRadius: 10,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const headerStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#93c5fd',
  letterSpacing: 0.4,
  textTransform: 'uppercase',
}

const buttonStyle: React.CSSProperties = {
  flex: 1,
  padding: '6px 8px',
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  fontSize: 12,
  cursor: 'pointer',
}

const miniButtonStyle: React.CSSProperties = {
  padding: '2px 6px',
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 4,
  color: '#cbd5e1',
  fontSize: 11,
  cursor: 'pointer',
}

export interface LayersPanelProps {
  layers: StudioLayer[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: (type: Exclude<StudioLayerType, 'visualizer'>) => void
  onToggleVisible: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onRemove: (id: string) => void
}

export function LayersPanel(props: LayersPanelProps) {
  const { layers, selectedId, onSelect, onAdd, onToggleVisible, onMove, onRemove } = props

  return (
    <section style={panelStyle}>
      <div style={headerStyle}>Lớp</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" style={buttonStyle} onClick={() => onAdd('image')}>Thêm ảnh</button>
        <button type="button" style={buttonStyle} onClick={() => onAdd('video')}>Thêm video</button>
        <button type="button" style={buttonStyle} onClick={() => onAdd('text')}>Thêm chữ</button>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {layers.map((layer) => {
          const active = layer.id === selectedId
          return (
            <li
              key={layer.id}
              onClick={() => onSelect(layer.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '5px 6px',
                borderRadius: 6,
                cursor: 'pointer',
                background: active ? '#1d4ed8' : '#0f172a',
                border: `1px solid ${active ? '#3b82f6' : '#1e293b'}`,
                opacity: layer.visible ? 1 : 0.5,
              }}
            >
              <span style={{ flex: 1, fontSize: 12, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {layer.name}
              </span>
              <button
                type="button"
                style={miniButtonStyle}
                onClick={(event) => { event.stopPropagation(); onToggleVisible(layer.id) }}
                title={layer.visible ? 'Ẩn lớp' : 'Hiện lớp'}
              >
                {layer.visible ? 'Ẩn' : 'Hiện'}
              </button>
              <button
                type="button"
                style={miniButtonStyle}
                onClick={(event) => { event.stopPropagation(); onMove(layer.id, -1) }}
                title="Đưa lên"
              >
                Lên
              </button>
              <button
                type="button"
                style={miniButtonStyle}
                onClick={(event) => { event.stopPropagation(); onMove(layer.id, 1) }}
                title="Đưa xuống"
              >
                Xuống
              </button>
              {layer.type !== 'visualizer' && (
                <button
                  type="button"
                  style={{ ...miniButtonStyle, color: '#fca5a5' }}
                  onClick={(event) => { event.stopPropagation(); onRemove(layer.id) }}
                  title="Xoá lớp"
                >
                  Xoá
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

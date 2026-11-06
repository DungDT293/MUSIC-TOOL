import type { StudioLayer, TextLayer } from './layerTypes'

const panelStyle: React.CSSProperties = {
  background: '#0b1220',
  border: '1px solid #1e293b',
  borderRadius: 10,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const headerStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#93c5fd',
  letterSpacing: 0.4,
  textTransform: 'uppercase',
}

const labelStyle: React.CSSProperties = { fontSize: 11, color: '#94a3b8', minWidth: 70 }
const valueStyle: React.CSSProperties = { fontSize: 11, color: '#e2e8f0', minWidth: 44, textAlign: 'right' }
const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  fontSize: 12,
  padding: '5px 7px',
}
const buttonStyle: React.CSSProperties = {
  padding: '6px 8px',
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  fontSize: 12,
  cursor: 'pointer',
}

export interface InspectorPanelProps {
  layer: StudioLayer | null
  onUpdate: (patch: Partial<StudioLayer>) => void
  onPickMedia: () => void
}

function Row({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={labelStyle}>{label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
      {value !== undefined && <span style={valueStyle}>{value}</span>}
    </div>
  )
}

function SliderRow(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format?: (value: number) => string
  onChange: (value: number) => void
}) {
  const { label, value, min, max, step, format, onChange } = props
  return (
    <Row label={label} value={format ? format(value) : value.toFixed(2)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: '100%' }}
      />
    </Row>
  )
}

export function InspectorPanel({ layer, onUpdate, onPickMedia }: InspectorPanelProps) {
  if (!layer) {
    return (
      <section style={panelStyle}>
        <div style={headerStyle}>Thuộc tính</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>Chọn một lớp để chỉnh.</div>
      </section>
    )
  }

  const t = layer.transform
  const setTransform = (patch: Partial<typeof t>) => onUpdate({ transform: { ...t, ...patch } } as Partial<StudioLayer>)

  return (
    <section style={panelStyle}>
      <div style={headerStyle}>Thuộc tính · {layer.name}</div>

      <SliderRow label="Ngang" value={t.x} min={-0.5} max={0.5} step={0.01} onChange={(x) => setTransform({ x })} />
      <SliderRow label="Dọc" value={t.y} min={-0.5} max={0.5} step={0.01} onChange={(y) => setTransform({ y })} />
      <SliderRow
        label="Tỉ lệ"
        value={t.scale}
        min={0.1}
        max={3}
        step={0.01}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(scale) => setTransform({ scale })}
      />
      <SliderRow
        label="Xoay"
        value={t.rotation}
        min={-180}
        max={180}
        step={1}
        format={(value) => `${Math.round(value)}°`}
        onChange={(rotation) => setTransform({ rotation })}
      />
      <SliderRow
        label="Mờ"
        value={t.opacity}
        min={0}
        max={1}
        step={0.01}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(opacity) => setTransform({ opacity })}
      />

      {(layer.type === 'image' || layer.type === 'video') && (
        <>
          <Row label="Fit">
            <select
              style={inputStyle}
              value={layer.fit}
              onChange={(event) => onUpdate({ fit: event.target.value as 'cover' | 'contain' } as Partial<StudioLayer>)}
            >
              <option value="cover">Cover (tràn khung)</option>
              <option value="contain">Contain (vừa khung)</option>
            </select>
          </Row>
          <button type="button" style={buttonStyle} onClick={onPickMedia}>Đổi tệp</button>
        </>
      )}

      {layer.type === 'text' && (
        <>
          <textarea
            style={{ ...inputStyle, minHeight: 48, resize: 'vertical' }}
            value={(layer as TextLayer).text}
            onChange={(event) => onUpdate({ text: event.target.value, name: event.target.value.slice(0, 24) } as Partial<StudioLayer>)}
          />
          <SliderRow
            label="Cỡ chữ"
            value={(layer as TextLayer).fontSize}
            min={16}
            max={160}
            step={1}
            format={(value) => `${Math.round(value)}px`}
            onChange={(fontSize) => onUpdate({ fontSize } as Partial<StudioLayer>)}
          />
          <Row label="Màu chữ">
            <input
              type="color"
              value={(layer as TextLayer).color}
              onChange={(event) => onUpdate({ color: event.target.value } as Partial<StudioLayer>)}
              style={{ width: 40, height: 26, background: 'transparent', border: 'none' }}
            />
            <input
              type="color"
              value={(layer as TextLayer).strokeColor}
              onChange={(event) => onUpdate({ strokeColor: event.target.value } as Partial<StudioLayer>)}
              style={{ width: 40, height: 26, background: 'transparent', border: 'none' }}
              title="Màu viền"
            />
            <input
              type="number"
              min={0}
              max={16}
              step={1}
              value={(layer as TextLayer).strokeWidth}
              onChange={(event) => onUpdate({ strokeWidth: Number(event.target.value) } as Partial<StudioLayer>)}
              style={{ ...inputStyle, width: 64 }}
              title="Độ dày viền"
            />
          </Row>
          <Row label="Đậm">
            <select
              style={inputStyle}
              value={(layer as TextLayer).weight}
              onChange={(event) => onUpdate({ weight: Number(event.target.value) } as Partial<StudioLayer>)}
            >
              <option value={400}>Thường</option>
              <option value={600}>Bán đậm</option>
              <option value={700}>Đậm</option>
              <option value={900}>Rất đậm</option>
            </select>
          </Row>
        </>
      )}
    </section>
  )
}

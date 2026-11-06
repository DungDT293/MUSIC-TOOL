import { useEffect, useRef } from 'react'
import {
  FONT_FAMILIES,
  buildCssFilter,
  DEFAULT_FILTER,
  isGroupLayer,
  isImageLayer,
  isTextLayer,
  isVideoLayer,
  isVisualizerLayer,
  type StudioLayerFilter,
} from './layerTypes'
import { useSongNhacLayerStore } from './songNhacLayerStore'

const WAVE_STYLES = [
  { id: 'circlebars', label: 'Vòng tròn' },
  { id: 'bars', label: 'Cột' },
  { id: 'line', label: 'Đường' },
  { id: 'waveform', label: 'Sóng âm' },
  { id: 'dots', label: 'Điểm' },
  { id: 'ring', label: 'Vành' },
  { id: 'particles', label: 'Hạt' },
]

const panelStyle: React.CSSProperties = {
  background: '#0b1220',
  border: '1px solid #1e293b',
  borderRadius: 10,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}
const headerStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 12,
  fontWeight: 700,
  color: '#93c5fd',
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  borderBottom: '1px solid #1e293b',
}
const bodyStyle: React.CSSProperties = { padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }
const labelStyle: React.CSSProperties = { fontSize: 11, color: '#94a3b8', minWidth: 84 }
const valueStyle: React.CSSProperties = { fontSize: 11, color: '#e2e8f0', minWidth: 48, textAlign: 'right' }
const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  fontSize: 12,
  padding: '4px 6px',
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

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} style={{ borderTop: '1px solid #1e293b', paddingTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>{title}</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </details>
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
  onCommit?: () => void
}) {
  const { label, value, min, max, step, format, onChange, onCommit } = props
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={labelStyle}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        style={{ flex: 1 }}
      />
      <span style={valueStyle}>{format ? format(value) : value.toFixed(2)}</span>
    </div>
  )
}

function NumRow(props: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
}) {
  const { label, value, min, max, step = 1, onChange } = props
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={labelStyle}>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => {
          const raw = Number(event.target.value)
          if (!Number.isFinite(raw)) return
          let next = raw
          if (min !== undefined && max !== undefined) next = Math.max(min, Math.min(max, raw))
          onChange(next)
        }}
        style={{ ...inputStyle, flex: 1 }}
      />
    </div>
  )
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={labelStyle}>{label}</span>
      <input
        type="color"
        value={value.startsWith('#') ? value : '#000000'}
        onChange={(event) => onChange(event.target.value)}
        style={{ width: 40, height: 26, background: 'transparent', border: 'none' }}
      />
      <span style={{ ...valueStyle, minWidth: 70, textAlign: 'left', fontFamily: 'monospace' }}>{value}</span>
    </div>
  )
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#cbd5e1', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} style={{ accentColor: '#0ea5e9' }} />
      {label}
    </label>
  )
}

export function InspectorPanel() {
  const layers = useSongNhacLayerStore((state) => state.layers)
  const selectedLayerId = useSongNhacLayerStore((state) => state.selectedLayerId)
  const updateLayer = useSongNhacLayerStore((state) => state.updateLayer)
  const updateLayerWithHistory = useSongNhacLayerStore((state) => state.updateLayerWithHistory)
  const beginHistoryGesture = useSongNhacLayerStore((state) => state.beginHistoryGesture)
  const endHistoryGesture = useSongNhacLayerStore((state) => state.endHistoryGesture)
  const setFocusContentInputId = useSongNhacLayerStore((state) => state.setFocusContentInputId)
  const focusContentInputId = useSongNhacLayerStore((state) => state.focusContentInputId)
  const contentInputRef = useRef<HTMLInputElement>(null)

  const layer = layers.find((item) => item.id === selectedLayerId) ?? null

  useEffect(() => {
    if (layer && focusContentInputId === layer.id && contentInputRef.current) {
      contentInputRef.current.focus()
      contentInputRef.current.select()
      requestAnimationFrame(() => setFocusContentInputId(null))
    }
  }, [focusContentInputId, layer, setFocusContentInputId])

  if (!layer) {
    return (
      <section style={panelStyle}>
        <div style={headerStyle}>Thuộc tính</div>
        <div style={{ ...bodyStyle, color: '#64748b', fontSize: 12 }}>Chọn một lớp để chỉnh sửa.</div>
      </section>
    )
  }

  if (isGroupLayer(layer)) {
    return (
      <section style={panelStyle}>
        <div style={headerStyle}>Group</div>
        <div style={bodyStyle}>
          <input style={inputStyle} value={layer.name} onChange={(event) => updateLayer(layer.id, { name: event.target.value })} />
          <div style={{ fontSize: 11, color: '#64748b' }}>{layer.children.length} lớp con</div>
        </div>
      </section>
    )
  }

  const t = layer.transform
  const f = layer.filter

  const setTransform = (patch: Partial<typeof t>) => updateLayer(layer.id, { transform: { ...t, ...patch } })
  const setFilter = (patch: Partial<StudioLayerFilter>) => updateLayer(layer.id, { filter: { ...f, ...patch } })
  const commit = () => updateLayerWithHistory(layer.id, {})

  return (
    <section style={panelStyle}>
      <div style={headerStyle}>Thuộc tính · {layer.name}</div>
      <div style={{ ...bodyStyle, maxHeight: 520, overflowY: 'auto' }}>
        <Section title="Transform">
          <NumRow label="Vị trí X" value={t.x} min={-9999} max={9999} onChange={(x) => setTransform({ x })} />
          <NumRow label="Vị trí Y" value={t.y} min={-9999} max={9999} onChange={(y) => setTransform({ y })} />
          <NumRow label="Scale X" value={t.scaleX} min={0.05} max={10} step={0.05} onChange={(scaleX) => setTransform({ scaleX })} />
          <NumRow label="Scale Y" value={t.scaleY} min={0.05} max={10} step={0.05} onChange={(scaleY) => setTransform({ scaleY })} />
          <SliderRow
            label="Xoay"
            value={t.rotation}
            min={-180}
            max={180}
            step={1}
            format={(value) => `${Math.round(value)}°`}
            onChange={(rotation) => setTransform({ rotation })}
            onCommit={commit}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={buttonStyle} onClick={() => setTransform({ flipX: !t.flipX })}>
              Lật ngang
            </button>
            <button type="button" style={buttonStyle} onClick={() => setTransform({ flipY: !t.flipY })}>
              Lật dọc
            </button>
          </div>
        </Section>

        {isTextLayer(layer) && (
          <>
            <Section title="Văn bản">
              <input
                ref={contentInputRef}
                style={inputStyle}
                value={layer.text}
                onChange={(event) => updateLayer(layer.id, { text: event.target.value })}
              />
              <NumRow label="Cỡ chữ" value={layer.fontSize} min={6} max={500} onChange={(fontSize) => updateLayer(layer.id, { fontSize })} />
              <ColorRow label="Màu chữ" value={layer.color} onChange={(color) => updateLayer(layer.id, { color })} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={labelStyle}>Font</span>
                <select style={inputStyle} value={layer.fontFamily} onChange={(event) => updateLayer(layer.id, { fontFamily: event.target.value })}>
                  {FONT_FAMILIES.map((family) => (
                    <option key={family} value={family}>{family}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  style={{ ...buttonStyle, flex: 1, fontWeight: 700 }}
                  onClick={() => updateLayer(layer.id, { fontWeight: layer.fontWeight === '700' ? '400' : '700' })}
                >
                  B
                </button>
                <button
                  type="button"
                  style={{ ...buttonStyle, flex: 1, fontStyle: 'italic' }}
                  onClick={() => updateLayer(layer.id, { italic: !layer.italic })}
                >
                  I
                </button>
              </div>
            </Section>

            <Section title="Viền & bóng chữ" defaultOpen={false}>
              <ColorRow label="Màu viền" value={layer.strokeColor} onChange={(strokeColor) => updateLayer(layer.id, { strokeColor })} />
              <SliderRow
                label="Độ dày viền"
                value={layer.strokeWidth}
                min={0}
                max={20}
                step={0.5}
                format={(value) => `${value}px`}
                onChange={(strokeWidth) => updateLayer(layer.id, { strokeWidth })}
                onCommit={commit}
              />
              <SliderRow
                label="Blur bóng"
                value={layer.textShadowBlur}
                min={0}
                max={40}
                step={1}
                onChange={(textShadowBlur) => updateLayer(layer.id, { textShadowBlur })}
                onCommit={commit}
              />
              <ColorRow label="Màu bóng" value={layer.textShadowColor.startsWith('#') ? layer.textShadowColor : '#000000'} onChange={(textShadowColor) => updateLayer(layer.id, { textShadowColor })} />
            </Section>
          </>
        )}

        {(isImageLayer(layer) || isVideoLayer(layer)) && (
          <Section title={isImageLayer(layer) ? 'Ảnh' : 'Video'}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={labelStyle}>Fit</span>
              <select
                style={inputStyle}
                value={layer.fitMode}
                onChange={(event) => updateLayer(layer.id, { fitMode: event.target.value as 'free' | 'contain' | 'cover' })}
              >
                <option value="free">Tự do</option>
                <option value="contain">Fit (vừa khung)</option>
                <option value="cover">Cover (tràn khung)</option>
              </select>
            </div>
            {isImageLayer(layer) && (
              <>
                <CheckRow label="Ảnh đập theo beat" checked={layer.beatPulse} onChange={(beatPulse) => updateLayerWithHistory(layer.id, { beatPulse })} />
                <CheckRow
                  label="Sóng quanh ảnh"
                  checked={Boolean(layer.waveAroundEnabled)}
                  onChange={(waveAroundEnabled) => updateLayerWithHistory(layer.id, { waveAroundEnabled })}
                />
                <SliderRow
                  label="Cường độ đập"
                  value={layer.beatIntensity}
                  min={0}
                  max={1.5}
                  step={0.05}
                  format={(value) => `${Math.round(value * 100)}%`}
                  onChange={(beatIntensity) => updateLayer(layer.id, { beatIntensity })}
                  onCommit={commit}
                />
              </>
            )}
            {isVideoLayer(layer) && (
              <>
                <CheckRow label="Tắt tiếng" checked={layer.muted} onChange={(muted) => updateLayer(layer.id, { muted })} />
                <CheckRow label="Lặp" checked={layer.loop} onChange={(loop) => updateLayer(layer.id, { loop })} />
              </>
            )}
          </Section>
        )}

        {!isVisualizerLayer(layer) && (
        <Section title="Hiệu ứng hình ảnh" defaultOpen={false}>
          <SliderRow
            label="Độ mờ"
            value={f.opacity}
            min={0}
            max={1}
            step={0.01}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(opacity) => setFilter({ opacity })}
            onCommit={commit}
          />
          <SliderRow
            label="Sáng"
            value={f.brightness}
            min={0}
            max={3}
            step={0.05}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(brightness) => setFilter({ brightness })}
            onCommit={commit}
          />
          <SliderRow
            label="Tương phản"
            value={f.contrast}
            min={0}
            max={3}
            step={0.05}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(contrast) => setFilter({ contrast })}
            onCommit={commit}
          />
          <SliderRow
            label="Bão hoà"
            value={f.saturation}
            min={0}
            max={3}
            step={0.05}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(saturation) => setFilter({ saturation })}
            onCommit={commit}
          />
          <SliderRow
            label="Hue"
            value={f.hue}
            min={0}
            max={360}
            step={1}
            format={(value) => `${Math.round(value)}°`}
            onChange={(hue) => setFilter({ hue })}
            onCommit={commit}
          />
          <SliderRow
            label="Đen trắng"
            value={f.grayscale}
            min={0}
            max={1}
            step={0.01}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(grayscale) => setFilter({ grayscale })}
            onCommit={commit}
          />
          <SliderRow
            label="Blur"
            value={f.blur}
            min={0}
            max={40}
            step={0.5}
            format={(value) => `${value}px`}
            onChange={(blur) => setFilter({ blur })}
            onCommit={commit}
          />
          <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{buildCssFilter(f)}</div>
          <button type="button" style={buttonStyle} onClick={() => updateLayerWithHistory(layer.id, { filter: { ...DEFAULT_FILTER } })}>
            Đặt lại hiệu ứng
          </button>
        </Section>
        )}

        {isVisualizerLayer(layer) && (
          <>
            <Section title="Kiểu sóng">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {WAVE_STYLES.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    style={{
                      ...buttonStyle,
                      flex: '0 0 auto',
                      background: layer.waveStyle === style.id ? '#1d4ed8' : '#1e293b',
                      borderColor: layer.waveStyle === style.id ? '#3b82f6' : '#334155',
                    }}
                    onClick={() => updateLayerWithHistory(layer.id, { waveStyle: style.id })}
                  >
                    {style.label}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Màu sắc">
              <div style={{ display: 'flex', gap: 6 }}>
                {(['rainbow', 'solid', 'gradient'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    style={{
                      ...buttonStyle,
                      flex: 1,
                      background: layer.colorMode === mode ? '#1d4ed8' : '#1e293b',
                    }}
                    onClick={() => updateLayerWithHistory(layer.id, { colorMode: mode })}
                  >
                    {mode === 'rainbow' ? 'Cầu vồng' : mode === 'solid' ? 'Đơn sắc' : 'Gradient'}
                  </button>
                ))}
              </div>
              <ColorRow label="Màu chính" value={layer.color1} onChange={(color1) => updateLayer(layer.id, { color1 })} />
              <ColorRow label="Màu phụ" value={layer.color2} onChange={(color2) => updateLayer(layer.id, { color2 })} />
            </Section>

            <Section title="Tham số sóng">
              <SliderRow
                label="Số thanh"
                value={layer.barCount}
                min={16}
                max={256}
                step={8}
                format={(value) => `${Math.round(value)}`}
                onChange={(barCount) => updateLayer(layer.id, { barCount: Math.round(barCount) })}
                onCommit={commit}
              />
              <SliderRow
                label="Tốc độ"
                value={layer.speed}
                min={0.1}
                max={5}
                step={0.1}
                format={(value) => `${value.toFixed(1)}x`}
                onChange={(speed) => updateLayer(layer.id, { speed })}
                onCommit={commit}
              />
              <SliderRow
                label="Độ nhạy"
                value={layer.sensitivity}
                min={0.1}
                max={3}
                step={0.1}
                format={(value) => `${value.toFixed(1)}x`}
                onChange={(sensitivity) => updateLayer(layer.id, { sensitivity })}
                onCommit={commit}
              />
              <CheckRow label="Glow" checked={layer.glowEnabled} onChange={(glowEnabled) => updateLayerWithHistory(layer.id, { glowEnabled })} />
              <CheckRow label="Đối xứng" checked={layer.mirror} onChange={(mirror) => updateLayerWithHistory(layer.id, { mirror })} />
              <SliderRow
                label="Độ mờ sóng"
                value={layer.opacity}
                min={0}
                max={1}
                step={0.01}
                format={(value) => `${Math.round(value * 100)}%`}
                onChange={(opacity) => updateLayer(layer.id, { opacity })}
                onCommit={commit}
              />
            </Section>
          </>
        )}

        <Section title="Thời gian hiển thị" defaultOpen={Boolean(layer.timeRange) || layer.role === 'watermark'}>
          <CheckRow
            label="Logo / Watermark (luôn trên cùng)"
            checked={layer.role === 'watermark'}
            onChange={(value) => updateLayerWithHistory(layer.id, { role: value ? 'watermark' : 'normal' })}
          />
          <CheckRow
            label="Chỉ hiển thị trong khoảng thời gian"
            checked={Boolean(layer.timeRange)}
            onChange={(value) =>
              updateLayerWithHistory(
                layer.id,
                value ? { timeRange: { startSec: 0, endSec: 5, fadeInSec: 0.5, fadeOutSec: 0.5 } } : { timeRange: undefined },
              )
            }
          />
          {layer.timeRange && (
            <>
              <div style={{ display: 'flex', gap: 6 }}>
                {[3, 5, 10].map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    style={{ ...buttonStyle, flex: 1 }}
                    onClick={() => updateLayerWithHistory(layer.id, { timeRange: { startSec: 0, endSec: seconds, fadeInSec: 0.5, fadeOutSec: 0.5 } })}
                  >
                    Intro {seconds}s
                  </button>
                ))}
              </div>
              <NumRow
                label="Bắt đầu (giây)"
                value={layer.timeRange.startSec}
                min={0}
                step={0.5}
                onChange={(startSec) => updateLayer(layer.id, { timeRange: { ...layer.timeRange!, startSec: Math.max(0, startSec) } })}
              />
              <NumRow
                label="Kết thúc (giây)"
                value={layer.timeRange.endSec}
                min={0}
                step={0.5}
                onChange={(endSec) => updateLayer(layer.id, { timeRange: { ...layer.timeRange!, endSec: Math.max(layer.timeRange!.startSec + 0.1, endSec) } })}
              />
              <SliderRow
                label="Fade in"
                value={layer.timeRange.fadeInSec}
                min={0}
                max={3}
                step={0.1}
                format={(value) => `${value.toFixed(1)}s`}
                onChange={(fadeInSec) => updateLayer(layer.id, { timeRange: { ...layer.timeRange!, fadeInSec } })}
                onCommit={commit}
              />
              <SliderRow
                label="Fade out"
                value={layer.timeRange.fadeOutSec}
                min={0}
                max={3}
                step={0.1}
                format={(value) => `${value.toFixed(1)}s`}
                onChange={(fadeOutSec) => updateLayer(layer.id, { timeRange: { ...layer.timeRange!, fadeOutSec } })}
                onCommit={commit}
              />
            </>
          )}
        </Section>

        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={buttonStyle} onClick={() => beginHistoryGesture()}>
            Bắt đầu ghi
          </button>
          <button type="button" style={buttonStyle} onClick={() => endHistoryGesture()}>
            Kết thúc ghi
          </button>
        </div>
      </div>
    </section>
  )
}

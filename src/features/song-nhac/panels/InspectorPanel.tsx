/**
 * Phase 2 — Inspector: thuộc tính layer khi chọn.
 * V3: Thêm Hiệu ứng layer (flip, opacity, brightness, contrast, blur, hue, tint, shadow, borderRadius).
 *     Text extras: font, outline, text shadow.
 *     BUG FIX: setTransform(layerId, partial) đúng.
 */

import { useRef, useEffect, useCallback, useState } from 'react'
import { useSongNhacLayerStore } from '../store/songNhacLayerStore'
import { useSongNhacRuntimeStore } from '../store/songNhacRuntimeStore'
import type { SongNhacLayer, SongNhacTransform, SongNhacLayerFilter } from '../types/layerTypes'
import {
  isSongNhacImageLayer,
  isSongNhacTextLayer,
  isSongNhacGroupLayer,
  isSongNhacVisualizerLayer,
  isSongNhacVideoLayer,
  DEFAULT_TRANSFORM,
  DEFAULT_FILTER,
} from '../types/layerTypes'
import type { SongNhacWaveStyleId, SongNhacColorMode } from '../types/layerTypes'
import { getAllWaveMetas } from '../runtime/render/waves'

/* ── Styles ── */
const panelStyle: React.CSSProperties = {
  height: '100%',
  background: '#16162a',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.08)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  fontSize: 11,
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 5,
  color: 'rgba(255,255,255,0.9)',
  boxSizing: 'border-box',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'rgba(255,255,255,0.45)',
  marginBottom: 3,
  letterSpacing: 0.3,
}

/* ── Small components ── */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  onCommit,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display?: string
  onChange: (v: number) => void
  onCommit?: () => void
  disabled?: boolean
}) {
  return (
    <FieldRow label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onMouseUp={onCommit}
          onTouchEnd={onCommit}
          disabled={disabled}
          style={{ flex: 1, accentColor: '#4d9fff', cursor: disabled ? 'not-allowed' : 'pointer' }}
        />
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {display ?? value}
        </span>
      </div>
    </FieldRow>
  )
}

function NumInput({
  value,
  onChange,
  onBlur,
  min,
  max,
  step = 1,
  style: extraStyle,
}: {
  value: number
  onChange: (v: number) => void
  onBlur?: () => void
  min?: number
  max?: number
  step?: number
  style?: React.CSSProperties
}) {
  const v = Number.isFinite(value) ? value : 0
  return (
    <input
      type="number"
      value={v}
      onChange={(e) => {
        const n = parseFloat(e.target.value)
        if (!Number.isFinite(n)) return
        const clamped = min != null && max != null ? Math.max(min, Math.min(max, n)) : n
        onChange(clamped)
      }}
      onBlur={onBlur}
      min={min}
      max={max}
      step={step}
      style={{ ...inputStyle, ...extraStyle }}
    />
  )
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'rgba(255,255,255,0.7)', cursor: 'pointer', marginBottom: 8 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: '#4d9fff', width: 14, height: 14 }}
      />
      {label}
    </label>
  )
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <FieldRow label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="color"
          value={value || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 36, height: 28, border: 'none', cursor: 'pointer', borderRadius: 4, padding: 2, background: 'transparent' }}
        />
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace' }}>{value || '—'}</span>
      </div>
    </FieldRow>
  )
}

/* ── Accordion Section ── */
function Section({ title, icon, defaultOpen = true, badge, children }: {
  title: string
  icon: string
  defaultOpen?: boolean
  badge?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 12px', background: 'rgba(0,0,0,0.15)', border: 'none',
          color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 11,
          fontWeight: 600, letterSpacing: 0.3, textAlign: 'left',
        }}
      >
        <span>{icon}</span>
        <span style={{ flex: 1 }}>{title}</span>
        {badge && <span style={{ fontSize: 9, background: 'rgba(77,159,255,0.3)', color: '#a8d4ff', padding: '1px 5px', borderRadius: 8, fontWeight: 700 }}>{badge}</span>}
        <span style={{ fontSize: 9, opacity: 0.5 }}>{open ? '^' : 'v'}</span>
      </button>
      {open && <div style={{ padding: '10px 12px' }}>{children}</div>}
    </div>
  )
}

/* ── Wave style picker — TỰ ĐỘNG từ registry ── */
// Khi thêm wave mới: chỉ cần tạo file waves/xxx.ts + import trong waves/index.ts
// → UI tự động hiện style mới mà KHÔNG cần sửa file này!
const WAVE_STYLES: { value: SongNhacWaveStyleId; label: string; icon: string }[] =
  getAllWaveMetas().map(m => ({
    value: m.id as SongNhacWaveStyleId,
    label: m.label,
    icon: m.icon,
  }))

const FONT_FAMILIES = [
  { value: 'system-ui, sans-serif', label: 'System UI' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
  { value: '"Courier New", monospace', label: 'Courier New' },
  { value: 'Impact, sans-serif', label: 'Impact' },
  { value: '"Comic Sans MS", cursive', label: 'Comic Sans' },
]

/* ── Filter Section component ── */
function FilterSection({
  filter,
  onChangeFilter,
  onCommitFilter,
  showBorderRadius = true,
}: {
  filter: SongNhacLayerFilter | undefined
  onChangeFilter: (partial: Partial<SongNhacLayerFilter>) => void
  onCommitFilter?: () => void
  showBorderRadius?: boolean
}) {
  const f = { ...DEFAULT_FILTER, ...filter }
  return (
    <>
      {/* Flip */}
      <FieldRow label="Lật ảnh">
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => {/* flip handled via transform */}}
            style={{ flex: 1, padding: '5px', fontSize: 11, border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer' }}
            title="Xem mục Transform để lật (flipX/flipY)"
          >
            ↔ Xem Transform
          </button>
        </div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>Dùng flipX/flipY trong section Transform</div>
      </FieldRow>

      <SliderField
        label="Độ mờ (Opacity)"
        value={Math.round((f.opacity ?? 1) * 100)}
        min={0} max={100} step={1}
        display={`${Math.round((f.opacity ?? 1) * 100)}%`}
        onChange={(v) => onChangeFilter({ opacity: v / 100 })}
        onCommit={onCommitFilter}
      />
      <SliderField
        label="Độ sáng (Brightness)"
        value={Math.round((f.brightness ?? 1) * 100)}
        min={0} max={300} step={5}
        display={`${Math.round((f.brightness ?? 1) * 100)}%`}
        onChange={(v) => onChangeFilter({ brightness: v / 100 })}
        onCommit={onCommitFilter}
      />
      <SliderField
        label="Tương phản (Contrast)"
        value={Math.round((f.contrast ?? 1) * 100)}
        min={0} max={300} step={5}
        display={`${Math.round((f.contrast ?? 1) * 100)}%`}
        onChange={(v) => onChangeFilter({ contrast: v / 100 })}
        onCommit={onCommitFilter}
      />
      <SliderField
        label="Bão hoà (Saturation)"
        value={Math.round((f.saturation ?? 1) * 100)}
        min={0} max={300} step={5}
        display={`${Math.round((f.saturation ?? 1) * 100)}%`}
        onChange={(v) => onChangeFilter({ saturation: v / 100 })}
        onCommit={onCommitFilter}
      />
      <SliderField
        label="Xoay màu (Hue)"
        value={f.hue ?? 0}
        min={0} max={360} step={1}
        display={`${f.hue ?? 0}°`}
        onChange={(v) => onChangeFilter({ hue: v })}
        onCommit={onCommitFilter}
      />
      <SliderField
        label="Trắng đen (Grayscale)"
        value={Math.round((f.grayscale ?? 0) * 100)}
        min={0} max={100} step={1}
        display={`${Math.round((f.grayscale ?? 0) * 100)}%`}
        onChange={(v) => onChangeFilter({ grayscale: v / 100 })}
        onCommit={onCommitFilter}
      />
      <SliderField
        label="Sepia"
        value={Math.round((f.sepia ?? 0) * 100)}
        min={0} max={100} step={1}
        display={`${Math.round((f.sepia ?? 0) * 100)}%`}
        onChange={(v) => onChangeFilter({ sepia: v / 100 })}
        onCommit={onCommitFilter}
      />
      <SliderField
        label="Blur (px)"
        value={f.blur ?? 0}
        min={0} max={40} step={0.5}
        display={`${f.blur ?? 0}px`}
        onChange={(v) => onChangeFilter({ blur: v })}
        onCommit={onCommitFilter}
      />

      {/* Tint */}
      <FieldRow label="Tô màu (Tint)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <input
            type="color"
            value={f.tintColor || '#ffffff'}
            onChange={(e) => onChangeFilter({ tintColor: e.target.value })}
            onBlur={onCommitFilter}
            style={{ width: 36, height: 28, border: 'none', cursor: 'pointer', borderRadius: 4, padding: 2 }}
          />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace' }}>{f.tintColor || '#ffffff'}</span>
        </div>
        <SliderField
          label="Độ đặc tint"
          value={Math.round((f.tintOpacity ?? 0) * 100)}
          min={0} max={100} step={1}
          display={`${Math.round((f.tintOpacity ?? 0) * 100)}%`}
          onChange={(v) => onChangeFilter({ tintOpacity: v / 100 })}
          onCommit={onCommitFilter}
        />
      </FieldRow>

      {/* Shadow */}
      <FieldRow label="Bóng đổ (Shadow)">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
          <div>
            <div style={labelStyle}>Offset X</div>
            <NumInput value={f.shadowOffsetX ?? 0} onChange={(v) => onChangeFilter({ shadowOffsetX: v })} onBlur={onCommitFilter} min={-100} max={100} step={1} />
          </div>
          <div>
            <div style={labelStyle}>Offset Y</div>
            <NumInput value={f.shadowOffsetY ?? 0} onChange={(v) => onChangeFilter({ shadowOffsetY: v })} onBlur={onCommitFilter} min={-100} max={100} step={1} />
          </div>
        </div>
        <SliderField
          label="Độ mờ bóng"
          value={f.shadowBlur ?? 0}
          min={0} max={60} step={1}
          display={`${f.shadowBlur ?? 0}px`}
          onChange={(v) => onChangeFilter({ shadowBlur: v })}
          onCommit={onCommitFilter}
        />
        <FieldRow label="Màu bóng">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              value={f.shadowColor?.startsWith('rgba') ? '#000000' : (f.shadowColor ?? '#000000')}
              onChange={(e) => onChangeFilter({ shadowColor: e.target.value })}
              onBlur={onCommitFilter}
              style={{ width: 36, height: 28, border: 'none', cursor: 'pointer', borderRadius: 4, padding: 2 }}
            />
          </div>
        </FieldRow>
      </FieldRow>

      {showBorderRadius && (
        <SliderField
          label="Bo góc (Border Radius)"
          value={f.borderRadius ?? 0}
          min={0} max={500} step={1}
          display={`${f.borderRadius ?? 0}px`}
          onChange={(v) => onChangeFilter({ borderRadius: v })}
          onCommit={onCommitFilter}
        />
      )}

      {/* Reset button */}
      <button
        type="button"
        onClick={() => onChangeFilter({ ...DEFAULT_FILTER })}
        style={{
          width: '100%', padding: '5px', fontSize: 10,
          border: '1px solid rgba(255,100,100,0.3)', borderRadius: 4,
          background: 'rgba(255,100,100,0.08)', color: 'rgba(255,180,180,0.8)',
          cursor: 'pointer', marginTop: 4,
        }}
      >
        ↺ Reset tất cả hiệu ứng
      </button>
    </>
  )
}

/* ── Main component ── */
export default function InspectorPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const contentInputRef = useRef<HTMLInputElement>(null)
  const selectedLayerId = useSongNhacLayerStore((s) => s.selectedLayerId)
  const getLayer = useSongNhacLayerStore((s) => s.getLayer)
  const updateLayer = useSongNhacLayerStore((s) => s.updateLayer)
  const updateLayerWithHistory = useSongNhacLayerStore((s) => s.updateLayerWithHistory)
  const pushHistorySnapshot = useSongNhacLayerStore((s) => s.pushHistorySnapshot)
  const layers = useSongNhacLayerStore((s) => s.layers)
  const focusContentInputId = useSongNhacLayerStore((s) => s.focusContentInputId)
  const setFocusContentInputId = useSongNhacLayerStore((s) => s.setFocusContentInputId)
  const beginHistoryGesture = useSongNhacLayerStore((s) => s.beginHistoryGesture)
  const endHistoryGesture = useSongNhacLayerStore((s) => s.endHistoryGesture)

  const imageBeatEnabled = useSongNhacRuntimeStore((s) => s.imageBeatEnabled)
  const setImageBeatEnabled = useSongNhacRuntimeStore((s) => s.setImageBeatEnabled)
  const imageBeatIntensity = useSongNhacRuntimeStore((s) => s.imageBeatIntensity)
  const setImageBeatIntensity = useSongNhacRuntimeStore((s) => s.setImageBeatIntensity)
  const waveAroundImageEnabled = useSongNhacRuntimeStore((s) => s.waveAroundImageEnabled)
  const setWaveAroundImageEnabled = useSongNhacRuntimeStore((s) => s.setWaveAroundImageEnabled)
  const waveAroundIntensity = useSongNhacRuntimeStore((s) => s.waveAroundIntensity)
  const setWaveAroundIntensity = useSongNhacRuntimeStore((s) => s.setWaveAroundIntensity)
  const waveAroundStyle = useSongNhacRuntimeStore((s) => s.waveAroundStyle)
  const setWaveAroundStyle = useSongNhacRuntimeStore((s) => s.setWaveAroundStyle)

  const layer = selectedLayerId ? getLayer(selectedLayerId) : null

  const onInspectorChange = useCallback(
    (fn: () => void) => { beginHistoryGesture(); fn() },
    [beginHistoryGesture]
  )

  // For discrete controls (checkboxes, dropdowns, buttons): begin+fn+end in one shot
  const onInspectorChangeFinal = useCallback(
    (fn: () => void) => { beginHistoryGesture(); fn(); endHistoryGesture() },
    [beginHistoryGesture, endHistoryGesture]
  )

  // BUG FIX: setTransform nhận đúng layerId
  const setTransform = useCallback(
    (layerId: string, partial: Partial<SongNhacTransform>) => {
      const current = getLayer(layerId)
      const currentT = current?.transform ?? { ...DEFAULT_TRANSFORM }
      updateLayer(layerId, { transform: { ...currentT, ...partial } })
    },
    [getLayer, updateLayer]
  )

  const setFilter = useCallback(
    (layerId: string, partial: Partial<SongNhacLayerFilter>) => {
      const current = getLayer(layerId)
      const currentF = (current as any)?.filter ?? {}
      updateLayer(layerId, { filter: { ...currentF, ...partial } })
    },
    [getLayer, updateLayer]
  )

  useEffect(() => {
    if (focusContentInputId && layer?.id === focusContentInputId && isSongNhacTextLayer(layer)) {
      setFocusContentInputId(null)
      const input = contentInputRef.current
      if (input) requestAnimationFrame(() => { input.focus(); input.select?.() })
    }
  }, [focusContentInputId, layer, setFocusContentInputId])

  useEffect(() => {
    const onBlur = () => endHistoryGesture()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [endHistoryGesture])

  if (!layer) {
    return (
      <div style={panelStyle}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>
          Inspector
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>🔍</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 }}>
            Chọn một layer trong danh sách<br />để chỉnh thuộc tính.
          </div>
        </div>
      </div>
    )
  }

  if (isSongNhacGroupLayer(layer)) {
    return (
      <div style={panelStyle}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 12, fontWeight: 700, color: '#fff' }}>
          [grp] {layer.name}
        </div>
        <div style={{ padding: '12px 14px' }}>
          <FieldRow label="Tên group">
            <input type="text" value={layer.name}
              onChange={(e) => onInspectorChange(() => updateLayer(layer.id, { name: e.target.value }))}
              onBlur={endHistoryGesture} style={inputStyle} />
          </FieldRow>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
            Group có {layer.children.length} layer.<br />Double-click group trong Layers để chỉnh thứ tự.
          </div>
        </div>
      </div>
    )
  }

  const t = layer.transform ?? { ...DEFAULT_TRANSFORM }
  const f = (layer as any).filter as SongNhacLayerFilter | undefined
  const typeIcon = { image: '[img]', text: '[txt]', visualizer: '[wav]', video: '[vid]' }[layer.type] ?? '[?]'

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 16 }}>{typeIcon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            type="text"
            value={layer.name}
            onChange={(e) => onInspectorChange(() => updateLayer(layer.id, { name: e.target.value }))}
            onBlur={endHistoryGesture}
            style={{ ...inputStyle, padding: '3px 6px', fontSize: 12, fontWeight: 600, background: 'transparent', border: '1px solid transparent' }}
            onFocus={(e) => { e.target.style.background = 'rgba(0,0,0,0.3)'; e.target.style.border = '1px solid rgba(255,255,255,0.2)' }}
            onBlurCapture={(e) => { e.target.style.background = 'transparent'; e.target.style.border = '1px solid transparent' }}
          />
        </div>
        <button
          type="button"
          onClick={() => updateLayerWithHistory(layer.id, { locked: !layer.locked })}
          title={layer.locked ? 'Mở khóa' : 'Khóa'}
          style={{ padding: '3px 7px', fontSize: 12, border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, background: layer.locked ? 'rgba(0,122,204,0.25)' : 'transparent', color: 'rgba(255,255,255,0.8)', cursor: 'pointer' }}
        >
          {layer.locked ? 'Khoa' : 'Mo'}
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ── Transform ── */}
        <Section title="Transform" icon="[xy]" defaultOpen={true}>
          {/* Flip buttons */}
          <FieldRow label="Lật ảnh / video">
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { key: 'flipX' as const, label: '↔ Lật ngang' },
                { key: 'flipY' as const, label: '↕ Lật dọc' },
              ].map(({ key, label }) => {
                const active = !!(t as any)[key]
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onInspectorChangeFinal(() => setTransform(layer.id, { [key]: !active }))}
                    style={{
                      flex: 1, padding: '6px 4px', fontSize: 10, fontWeight: active ? 700 : 400,
                      border: `1px solid ${active ? 'rgba(77,159,255,0.6)' : 'rgba(255,255,255,0.12)'}`,
                      borderRadius: 5,
                      background: active ? 'rgba(77,159,255,0.2)' : 'rgba(255,255,255,0.04)',
                      color: active ? '#a8d4ff' : 'rgba(255,255,255,0.65)',
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </FieldRow>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <FieldRow label="Vị trí X">
              <NumInput value={t.x} onChange={(v) => onInspectorChange(() => setTransform(layer.id, { x: v }))} onBlur={endHistoryGesture} min={-9999} max={9999} />
            </FieldRow>
            <FieldRow label="Vị trí Y">
              <NumInput value={t.y} onChange={(v) => onInspectorChange(() => setTransform(layer.id, { y: v }))} onBlur={endHistoryGesture} min={-9999} max={9999} />
            </FieldRow>
            <FieldRow label="Scale X">
              <NumInput value={t.scaleX} onChange={(v) => onInspectorChange(() => setTransform(layer.id, { scaleX: v }))} onBlur={endHistoryGesture} min={-10} max={10} step={0.05} />
            </FieldRow>
            <FieldRow label="Scale Y">
              <NumInput value={t.scaleY} onChange={(v) => onInspectorChange(() => setTransform(layer.id, { scaleY: v }))} onBlur={endHistoryGesture} min={-10} max={10} step={0.05} />
            </FieldRow>
          </div>
          <FieldRow label="Xoay (°)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range" min={-180} max={180} step={1}
                value={t.rotation}
                onChange={(e) => onInspectorChange(() => setTransform(layer.id, { rotation: parseFloat(e.target.value) }))}
                onMouseUp={endHistoryGesture}
                onKeyUp={endHistoryGesture}
                style={{ flex: 1, accentColor: '#4d9fff' }}
              />
              <NumInput
                value={t.rotation}
                onChange={(v) => onInspectorChange(() => setTransform(layer.id, { rotation: v }))}
                onBlur={endHistoryGesture}
                min={-360} max={360}
                style={{ width: 56, padding: '4px 6px', textAlign: 'center' }}
              />
            </div>
          </FieldRow>
        </Section>

        {/* ── Image props ── */}
        {isSongNhacImageLayer(layer) && (
          <Section title="Ảnh" icon="[img]" defaultOpen={true}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              {layer.src && (
                <img src={layer.src} alt="" style={{ width: 52, height: 52, objectFit: 'contain', background: 'rgba(0,0,0,0.3)', borderRadius: 5, flexShrink: 0 }} />
              )}
              <div style={{ flex: 1 }}>
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => {
                  const file = e.target.files?.[0]; e.target.value = ''
                  if (file && file.type.startsWith('image/')) {
                    pushHistorySnapshot(layers)
                    const url = URL.createObjectURL(file)
                    updateLayer(layer.id, { src: url })
                    const img = new Image()
                    img.onload = () => updateLayer(layer.id, { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })
                    img.src = url
                  }
                }} />
                <button type="button" onClick={() => fileInputRef.current?.click()} style={{ padding: '5px 12px', fontSize: 11, border: '1px solid rgba(255,255,255,0.2)', borderRadius: 5, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)', cursor: 'pointer' }}>
                  {layer.src ? 'Đổi ảnh…' : 'Chọn ảnh…'}
                </button>
                {layer.naturalWidth && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>{layer.naturalWidth} × {layer.naturalHeight}px</div>}
              </div>
            </div>
            <FieldRow label="Fit mode">
              <select value={layer.fitMode ?? 'free'} onChange={(e) => onInspectorChangeFinal(() => updateLayer(layer.id, { fitMode: e.target.value as any }))} style={{ ...inputStyle, paddingRight: 24 }}>
                <option value="free">Tự do</option>
                <option value="contain">Fit (vừa khung)</option>
                <option value="cover">Cover (tràn khung)</option>
              </select>
            </FieldRow>
          </Section>
        )}

        {/* ── Video props ── */}
        {isSongNhacVideoLayer(layer) && (
          <Section title="Video" icon="[vid]" defaultOpen={true}>
            <FieldRow label="Fit mode">
              <select value={(layer as any).fitMode ?? 'free'} onChange={(e) => onInspectorChangeFinal(() => updateLayer(layer.id, { fitMode: e.target.value as any }))} style={{ ...inputStyle, paddingRight: 24 }}>
                <option value="free">Tự do</option>
                <option value="contain">Fit (vừa khung)</option>
                <option value="cover">Cover (tràn khung)</option>
              </select>
            </FieldRow>
            <CheckRow
              label="Tắt tiếng (Muted)"
              checked={(layer as any).muted !== false}
              onChange={(v) => onInspectorChangeFinal(() => updateLayer(layer.id, { muted: v }))}
            />
            <CheckRow
              label="Lặp (Loop)"
              checked={(layer as any).loop !== false}
              onChange={(v) => onInspectorChangeFinal(() => updateLayer(layer.id, { loop: v }))}
            />
          </Section>
        )}

        {/* ── Text props ── */}
        {isSongNhacTextLayer(layer) && (
          <Section title="Văn bản" icon="[txt]" defaultOpen={true}>
            <FieldRow label="Nội dung">
              <input ref={contentInputRef} type="text" value={layer.text ?? ''}
                onChange={(e) => onInspectorChange(() => updateLayer(layer.id, { text: e.target.value }))}
                onBlur={endHistoryGesture} placeholder="Nhập văn bản…" style={inputStyle} />
            </FieldRow>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <FieldRow label="Cỡ chữ (px)">
                <NumInput value={layer.fontSize ?? 24} onChange={(v) => onInspectorChange(() => updateLayer(layer.id, { fontSize: v }))} onBlur={endHistoryGesture} min={6} max={500} />
              </FieldRow>
              <FieldRow label="Màu chữ">
                <input type="color" value={layer.color ?? '#ffffff'}
                  onChange={(e) => onInspectorChange(() => updateLayer(layer.id, { color: e.target.value }))}
                  onBlur={endHistoryGesture}
                  style={{ width: '100%', height: 30, border: 'none', cursor: 'pointer', borderRadius: 4, padding: 2 }} />
              </FieldRow>
            </div>
            <FieldRow label="Font">
              <select value={layer.fontFamily ?? 'system-ui, sans-serif'} onChange={(e) => onInspectorChangeFinal(() => updateLayer(layer.id, { fontFamily: e.target.value }))} style={{ ...inputStyle, paddingRight: 24 }}>
                {FONT_FAMILIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </FieldRow>
            <FieldRow label="Kiểu chữ">
              <div style={{ display: 'flex', gap: 4 }}>
                {[
                  { label: 'B', key: 'fontWeight', onValue: 'bold', offValue: 'normal', style: { fontWeight: 'bold' } },
                  { label: 'I', key: 'italic', onValue: true, offValue: false, style: { fontStyle: 'italic' } },
                ].map(({ label, key, onValue, offValue, style: btnStyle }) => {
                  const active = (layer as any)[key] === onValue
                  return (
                    <button key={key} type="button"
                      onClick={() => onInspectorChangeFinal(() => updateLayer(layer.id, { [key]: active ? offValue : onValue } as any))}
                      style={{ width: 32, height: 28, ...btnStyle, border: `1px solid ${active ? 'rgba(77,159,255,0.6)' : 'rgba(255,255,255,0.15)'}`, borderRadius: 4, background: active ? 'rgba(77,159,255,0.2)' : 'rgba(255,255,255,0.04)', color: active ? '#a8d4ff' : 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 13 }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </FieldRow>
          </Section>
        )}

        {/* ── Text outline & shadow ── */}
        {isSongNhacTextLayer(layer) && (
          <Section title="Viền & Bóng chữ" icon="🖋️" defaultOpen={false}>
            <FieldRow label="Màu viền (Outline)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="color" value={layer.strokeColor || '#000000'}
                  onChange={(e) => onInspectorChange(() => updateLayer(layer.id, { strokeColor: e.target.value }))}
                  onBlur={endHistoryGesture}
                  style={{ width: 36, height: 28, border: 'none', cursor: 'pointer', borderRadius: 4, padding: 2 }} />
                <NumInput value={layer.strokeWidth ?? 0} onChange={(v) => onInspectorChange(() => updateLayer(layer.id, { strokeWidth: v }))} onBlur={endHistoryGesture} min={0} max={20} step={0.5} style={{ flex: 1, padding: '4px 6px' }} />
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>px</span>
              </div>
            </FieldRow>
            <FieldRow label="Bóng chữ (Text Shadow)">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                <div><div style={labelStyle}>Offset X</div><NumInput value={layer.textShadowOffsetX ?? 0} onChange={(v) => onInspectorChange(() => updateLayer(layer.id, { textShadowOffsetX: v }))} onBlur={endHistoryGesture} min={-50} max={50} /></div>
                <div><div style={labelStyle}>Offset Y</div><NumInput value={layer.textShadowOffsetY ?? 2} onChange={(v) => onInspectorChange(() => updateLayer(layer.id, { textShadowOffsetY: v }))} onBlur={endHistoryGesture} min={-50} max={50} /></div>
              </div>
              <SliderField label="Blur bóng" value={layer.textShadowBlur ?? 0} min={0} max={40} step={1} display={`${layer.textShadowBlur ?? 0}px`} onChange={(v) => onInspectorChange(() => updateLayer(layer.id, { textShadowBlur: v }))} onCommit={endHistoryGesture} />
              <FieldRow label="Màu bóng">
                <input type="color" value={layer.textShadowColor || '#000000'}
                  onChange={(e) => onInspectorChange(() => updateLayer(layer.id, { textShadowColor: e.target.value }))}
                  onBlur={endHistoryGesture}
                  style={{ width: 36, height: 28, border: 'none', cursor: 'pointer', borderRadius: 4, padding: 2 }} />
              </FieldRow>
            </FieldRow>
          </Section>
        )}

        {/* ── Visualizer props ── */}
        {isSongNhacVisualizerLayer(layer) && (
          <>
            <Section title="Kiểu sóng" icon="[wav]" defaultOpen={true}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {WAVE_STYLES.map((ws) => {
                  const active = layer.waveStyle === ws.value
                  return (
                    <button key={ws.value} type="button"
                      onClick={() => onInspectorChangeFinal(() => updateLayer(layer.id, { waveStyle: ws.value }))}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                        padding: '5px 6px', border: `1px solid ${active ? 'rgba(77,159,255,0.6)' : 'rgba(255,255,255,0.1)'}`,
                        borderRadius: 5, background: active ? 'rgba(77,159,255,0.15)' : 'rgba(255,255,255,0.03)',
                        color: active ? '#a8d4ff' : 'rgba(255,255,255,0.6)', cursor: 'pointer',
                        fontSize: 10, fontWeight: active ? 700 : 400, minWidth: 52,
                      }}
                    >
                      <span style={{ fontSize: 16 }}>{ws.icon}</span>
                      <span style={{ whiteSpace: 'nowrap' }}>{ws.label}</span>
                    </button>
                  )
                })}
              </div>
            </Section>

            <Section title="Màu sắc" icon="[clr]" defaultOpen={true}>
              <FieldRow label="Chế độ màu">
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['rainbow', 'solid', 'gradient'] as SongNhacColorMode[]).map((cm) => {
                    const active = (layer.colorMode ?? 'rainbow') === cm
                    const labels = { rainbow: 'Rainbow', solid: 'Solid', gradient: 'Gradient' }
                    return (
                      <button key={cm} type="button" onClick={() => onInspectorChangeFinal(() => updateLayer(layer.id, { colorMode: cm }))}
                        style={{ flex: 1, padding: '5px 4px', fontSize: 10, fontWeight: active ? 700 : 400, border: `1px solid ${active ? 'rgba(77,159,255,0.6)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 5, background: active ? 'rgba(77,159,255,0.15)' : 'rgba(255,255,255,0.03)', color: active ? '#a8d4ff' : 'rgba(255,255,255,0.6)', cursor: 'pointer' }}
                      >
                        {labels[cm]}
                      </button>
                    )
                  })}
                </div>
              </FieldRow>
              {(layer.colorMode === 'solid' || layer.colorMode === 'gradient') && (
                <FieldRow label="Màu chính">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={layer.color1 ?? '#00ccff'} onChange={(e) => onInspectorChange(() => updateLayer(layer.id, { color1: e.target.value }))} onBlur={endHistoryGesture} style={{ width: 40, height: 28, border: 'none', cursor: 'pointer', borderRadius: 4, padding: 2 }} />
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{layer.color1 ?? '#00ccff'}</span>
                  </div>
                </FieldRow>
              )}
              {layer.colorMode === 'gradient' && (
                <FieldRow label="Màu phụ">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={layer.color2 ?? '#ff0066'} onChange={(e) => onInspectorChange(() => updateLayer(layer.id, { color2: e.target.value }))} onBlur={endHistoryGesture} style={{ width: 40, height: 28, border: 'none', cursor: 'pointer', borderRadius: 4, padding: 2 }} />
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{layer.color2 ?? '#ff0066'}</span>
                  </div>
                </FieldRow>
              )}
            </Section>

            <Section title="Tham số sóng" icon="⚙️" defaultOpen={true}>
              <SliderField label="Số thanh/điểm" value={layer.barCount ?? 128} min={16} max={256} step={8} display={String(layer.barCount ?? 128)} onChange={(v) => onInspectorChange(() => updateLayer(layer.id, { barCount: Math.round(v) }))} onCommit={endHistoryGesture} />
              <SliderField label="Tốc độ animation" value={Math.round((layer.speed ?? 1) * 100)} min={10} max={500} step={10} display={`${Math.round((layer.speed ?? 1) * 100)}%`} onChange={(v) => onInspectorChange(() => updateLayer(layer.id, { speed: v / 100 }))} onCommit={endHistoryGesture} />
              <SliderField label="Độ nhạy (sensitivity)" value={Math.round((layer.sensitivity ?? 1) * 100)} min={10} max={300} step={10} display={`${Math.round((layer.sensitivity ?? 1) * 100)}%`} onChange={(v) => onInspectorChange(() => updateLayer(layer.id, { sensitivity: v / 100 }))} onCommit={endHistoryGesture} />
              <SliderField label="Độ mờ (opacity)" value={Math.round((layer.opacity ?? 1) * 100)} min={0} max={100} step={5} display={`${Math.round((layer.opacity ?? 1) * 100)}%`} onChange={(v) => onInspectorChange(() => updateLayer(layer.id, { opacity: v / 100 }))} onCommit={endHistoryGesture} />
            </Section>

            <Section title="Hiệu ứng sóng" icon="✨" defaultOpen={false}>
              <CheckRow label="Glow (phát sáng)" checked={layer.glowEnabled !== false} onChange={(v) => onInspectorChangeFinal(() => updateLayer(layer.id, { glowEnabled: v }))} />
              {layer.glowEnabled !== false && (
                <SliderField label="Cường độ glow" value={Math.round((layer.glowIntensity ?? 0.5) * 100)} min={0} max={300} step={5} display={`${Math.round((layer.glowIntensity ?? 0.5) * 100)}%`} onChange={(v) => onInspectorChange(() => updateLayer(layer.id, { glowIntensity: v / 100 }))} onCommit={endHistoryGesture} />
              )}
              <CheckRow label="Mirror (đối xứng)" checked={!!layer.mirror} onChange={(v) => onInspectorChangeFinal(() => updateLayer(layer.id, { mirror: v }))} />
            </Section>
          </>
        )}

        {/* ── Image/Video effects ── */}
        {(isSongNhacImageLayer(layer) || isSongNhacVideoLayer(layer)) && (
          <Section title="Hiệu ứng hình ảnh" icon="[fx]" defaultOpen={false} badge="Mới">
            <FilterSection
              filter={f}
              onChangeFilter={(partial) => onInspectorChange(() => setFilter(layer.id, partial))}
              onCommitFilter={endHistoryGesture}
              showBorderRadius={true}
            />
          </Section>
        )}

        {/* ── Text filter ── */}
        {isSongNhacTextLayer(layer) && (
          <Section title="Hiệu ứng văn bản" icon="✨" defaultOpen={false} badge="Mới">
            <FilterSection
              filter={f}
              onChangeFilter={(partial) => onInspectorChange(() => setFilter(layer.id, partial))}
              onCommitFilter={endHistoryGesture}
              showBorderRadius={false}
            />
          </Section>
        )}

        {/* ── Image beat + wave effects ── */}
        {isSongNhacImageLayer(layer) && (
          <Section title="Hiệu ứng nhạc" icon="[mus]" defaultOpen={false}>
            <CheckRow label="Ảnh đập theo beat" checked={imageBeatEnabled} onChange={setImageBeatEnabled} />
            {imageBeatEnabled && (
              <SliderField label="Cường độ đập" value={Math.round((imageBeatIntensity || 0) * 100)} min={0} max={150} step={5} display={`${Math.round((imageBeatIntensity || 0) * 100)}%`} onChange={(v) => setImageBeatIntensity(v / 100)} />
            )}
            <CheckRow label="Sóng quanh ảnh" checked={waveAroundImageEnabled} onChange={setWaveAroundImageEnabled} />
            {waveAroundImageEnabled && (
              <>
                <FieldRow label="Kiểu sóng quanh ảnh">
                  <select value={waveAroundStyle} onChange={(e) => setWaveAroundStyle(e.target.value as any)} style={{ ...inputStyle, paddingRight: 24 }}>
                    {WAVE_STYLES.map((ws) => <option key={ws.value} value={ws.value}>{ws.icon} {ws.label}</option>)}
                  </select>
                </FieldRow>
                <SliderField label="Cường độ sóng" value={Math.round((waveAroundIntensity ?? 0) * 100)} min={0} max={100} step={5} display={`${Math.round((waveAroundIntensity ?? 0) * 100)}%`} onChange={(v) => setWaveAroundIntensity(v / 100)} />
                <CheckRow
                  label={`Áp dụng cho layer "${layer.name}"`}
                  checked={!!layer.waveAroundEnabled}
                  onChange={(v) => onInspectorChangeFinal(() => updateLayer(layer.id, { waveAroundEnabled: v }))}
                />
              </>
            )}
          </Section>
        )}

        {/* ── Time Range & Role (all non-group layers) ── */}
        {!isSongNhacGroupLayer(layer) && (
          <Section title="Thời gian hiển thị" icon="⏱️" defaultOpen={!!(layer as any).timeRange || (layer as any).role === 'watermark'} badge={(layer as any).timeRange ? 'Bật' : undefined}>
            {/* Role: watermark */}
            <CheckRow
              label="Logo / Watermark (luôn trên cùng)"
              checked={(layer as any).role === 'watermark'}
              onChange={(v) => onInspectorChangeFinal(() => updateLayer(layer.id, { role: v ? 'watermark' : 'normal' } as any))}
            />

            {/* TimeRange toggle */}
            <CheckRow
              label="Chỉ hiển thị trong khoảng thời gian"
              checked={!!(layer as any).timeRange}
              onChange={(v) => {
                if (v) {
                  onInspectorChangeFinal(() => updateLayer(layer.id, { timeRange: { startSec: 0, endSec: 5, fadeInSec: 0.5, fadeOutSec: 0.5 } } as any))
                } else {
                  onInspectorChangeFinal(() => {
                    updateLayer(layer.id, { timeRange: undefined } as any)
                  })
                }
              }}
            />

            {!!(layer as any).timeRange && (() => {
              const tr = (layer as any).timeRange as { startSec: number; endSec: number; fadeInSec?: number; fadeOutSec?: number }
              // setTrFinal: for buttons (presets) — begins and ends gesture immediately
              const setTrFinal = (partial: Partial<typeof tr>) =>
                onInspectorChangeFinal(() => updateLayer(layer.id, { timeRange: { ...tr, ...partial } } as any))
              // setTr: for number inputs — begins gesture, ends on blur
              const setTr = (partial: Partial<typeof tr>) =>
                onInspectorChange(() => updateLayer(layer.id, { timeRange: { ...tr, ...partial } } as any))
              return (
                <>
                  {/* Quick presets */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                    {[
                      { label: 'Intro 3s', s: 0, e: 3 },
                      { label: 'Intro 5s', s: 0, e: 5 },
                      { label: 'Intro 10s', s: 0, e: 10 },
                    ].map((p) => (
                      <button key={p.label} type="button"
                        onClick={() => setTrFinal({ startSec: p.s, endSec: p.e })}
                        style={{ fontSize: 10, padding: '3px 7px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, background: 'rgba(77,159,255,0.1)', color: '#a8d4ff', cursor: 'pointer' }}
                      >{p.label}</button>
                    ))}
                  </div>

                  <FieldRow label="Bắt đầu (giây)">
                    <input type="number" min={0} step={0.5}
                      value={tr.startSec}
                      onChange={(e) => setTr({ startSec: Math.max(0, parseFloat(e.target.value) || 0) })}
                      onBlur={endHistoryGesture}
                      style={{ ...inputStyle, width: 80 }}
                    />
                  </FieldRow>
                  <FieldRow label="Kết thúc (giây)">
                    <input type="number" min={0} step={0.5}
                      value={tr.endSec}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        if (Number.isFinite(v)) setTr({ endSec: v })
                      }}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value)
                        if (Number.isFinite(v)) setTr({ endSec: Math.max(tr.startSec + 0.1, v) })
                        endHistoryGesture()
                      }}
                      style={{ ...inputStyle, width: 80 }}
                    />
                  </FieldRow>
                  <SliderField
                    label="Fade-in (giây)"
                    value={Math.round((tr.fadeInSec ?? 0) * 10)}
                    min={0} max={30} step={1}
                    display={`${((tr.fadeInSec ?? 0)).toFixed(1)}s`}
                    onChange={(v) => setTr({ fadeInSec: v / 10 })}
                    onCommit={endHistoryGesture}
                  />
                  <SliderField
                    label="Fade-out (giây)"
                    value={Math.round((tr.fadeOutSec ?? 0) * 10)}
                    min={0} max={30} step={1}
                    display={`${((tr.fadeOutSec ?? 0)).toFixed(1)}s`}
                    onChange={(v) => setTr({ fadeOutSec: v / 10 })}
                    onCommit={endHistoryGesture}
                  />
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', paddingTop: 4 }}>
                    Hiển thị: {tr.startSec.toFixed(1)}s → {tr.endSec.toFixed(1)}s ({(tr.endSec - tr.startSec).toFixed(1)}s)
                  </div>
                </>
              )
            })()}
          </Section>
        )}

      </div>
    </div>
  )
}

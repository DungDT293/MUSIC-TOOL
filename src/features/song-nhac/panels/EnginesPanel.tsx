/**
 * Chức năng 13 — Background & Engine panel.
 * V3: Card-based engine picker, per-engine settings in collapsible accordion.
 */

import { useState } from 'react'
import { useSongNhacRuntimeStore } from '../store/songNhacRuntimeStore'
import type { VisualizerLayoutId } from '../store/songNhacRuntimeStore'
import type { EngineType } from '../runtime/engine/types'

/* ── Shared style helpers ── */
const sec: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
}

const sectionTitle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.8,
  color: 'rgba(255,255,255,0.35)',
  textTransform: 'uppercase',
  marginBottom: 8,
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  fontSize: 11,
  background: '#0f0f1e',
  color: '#e8e8e8',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 5,
  outline: 'none',
  cursor: 'pointer',
}

const sliderRow = (label: string, value: string): React.CSSProperties => ({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 })

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={sectionTitle}>{children}</div>
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display?: string
  onChange: (v: number) => void
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.65)', marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.45)', fontSize: 10 }}>
          {display ?? value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#4d9fff', cursor: 'pointer' }}
      />
    </div>
  )
}

/* ── Engine definitions ── */
interface EngineOption {
  value: EngineType
  label: string
  icon: string
  desc: string
  color: string
}

const ENGINE_OPTIONS: EngineOption[] = [
  { value: 'none', label: 'Nền sạch', icon: '⬛', desc: 'Chỉ nền đen / blur / gradient', color: '#444' },
  { value: 'threejs', label: 'Three.js Bars', icon: '📊', desc: 'Thanh 3D phát sáng (WebGL)', color: '#005f9e' },
  { value: 'butterchurn', label: 'MilkDrop', icon: '🌀', desc: 'Hiệu ứng psychedelic cổ điển', color: '#4b0082' },
  { value: 'audiomotion', label: 'Spectrum Pro', icon: '📈', desc: 'Phân tích phổ âm chuyên nghiệp', color: '#004d40' },
  { value: 'wavejs', label: 'Wave.js', icon: '〰️', desc: 'Nhiều kiểu sóng đa dạng', color: '#1a3a5c' },
  { value: 'vanta', label: 'Vanta 3D', icon: '~', desc: 'Nền 3D phản hồi theo nhịp', color: '#3a1a1a' },
]

const AUDIOMOTION_MODES = [
  { value: 0, label: 'Tần số rời rạc' },
  { value: 1, label: '1/24 octave' },
  { value: 2, label: '1/12 octave' },
  { value: 3, label: '1/8 octave' },
  { value: 4, label: '1/6 octave' },
  { value: 5, label: '1/4 octave' },
  { value: 6, label: '1/3 octave' },
  { value: 7, label: 'Nửa octave' },
  { value: 8, label: 'Full octave' },
  { value: 10, label: 'Biểu đồ vùng' },
]

const AUDIOMOTION_GRADIENTS = [
  { value: 'classic', label: 'Classic' },
  { value: 'prism', label: 'Prism' },
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'orangered', label: 'Orange Red' },
  { value: 'steelblue', label: 'Steel Blue' },
]

const WAVEJS_ANIMATIONS = [
  { value: 'wave', label: 'Wave' },
  { value: 'bars', label: 'Bars' },
  { value: 'bars blocks', label: 'Bars Blocks' },
  { value: 'dualbars', label: 'Dual Bars' },
  { value: 'fireworks', label: 'Fireworks' },
  { value: 'flower', label: 'Flower' },
  { value: 'orbs', label: 'Orbs' },
  { value: 'ring', label: 'Ring' },
  { value: 'rings', label: 'Rings' },
  { value: 'round bars', label: 'Round Bars' },
  { value: 'round wave', label: 'Round Wave' },
  { value: 'shine', label: 'Shine' },
  { value: 'star', label: 'Star' },
  { value: 'web', label: 'Web' },
]

const VANTA_EFFECTS = [
  { value: 'waves', label: 'Sóng biển' },
  { value: 'birds', label: '🐦 Đàn chim' },
  { value: 'fog', label: '🌫️ Sương mù' },
  { value: 'net', label: '🕸️ Lưới 3D' },
  { value: 'rings', label: 'Vòng tròn' },
  { value: 'dots', label: '· Chấm' },
  { value: 'globe', label: '🌐 Quả cầu' },
  { value: 'cells', label: '🔬 Tế bào' },
  { value: 'trunk', label: '🌲 Thân cây' },
  { value: 'topology', label: '🗻 Địa hình' },
  { value: 'halo', label: '☀️ Vầng sáng' },
]

const LAYOUT_OPTIONS: { value: VisualizerLayoutId; label: string }[] = [
  { value: 'circular', label: 'Circular' },
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'mirror', label: 'Mirror' },
]

export default function EnginesPanel() {
  const bgEngine = useSongNhacRuntimeStore((s) => s.bgEngine)
  const setBgEngine = useSongNhacRuntimeStore((s) => s.setBgEngine)
  const bgMode = useSongNhacRuntimeStore((s) => s.bgMode)
  const setBgMode = useSongNhacRuntimeStore((s) => s.setBgMode)
  const visualizerLayout = useSongNhacRuntimeStore((s) => s.visualizerLayout)
  const setVisualizerLayout = useSongNhacRuntimeStore((s) => s.setVisualizerLayout)
  const bloomStrength = useSongNhacRuntimeStore((s) => s.bloomStrength)
  const setBloomStrength = useSongNhacRuntimeStore((s) => s.setBloomStrength)
  const bloomRadius = useSongNhacRuntimeStore((s) => s.bloomRadius)
  const setBloomRadius = useSongNhacRuntimeStore((s) => s.setBloomRadius)
  const bloomThreshold = useSongNhacRuntimeStore((s) => s.bloomThreshold)
  const setBloomThreshold = useSongNhacRuntimeStore((s) => s.setBloomThreshold)
  const audiomotionMode = useSongNhacRuntimeStore((s) => s.audiomotionMode)
  const setAudiomotionMode = useSongNhacRuntimeStore((s) => s.setAudiomotionMode)
  const audiomotionGradient = useSongNhacRuntimeStore((s) => s.audiomotionGradient)
  const setAudiomotionGradient = useSongNhacRuntimeStore((s) => s.setAudiomotionGradient)
  const audiomotionRadial = useSongNhacRuntimeStore((s) => s.audiomotionRadial)
  const setAudiomotionRadial = useSongNhacRuntimeStore((s) => s.setAudiomotionRadial)
  const audiomotionLedBars = useSongNhacRuntimeStore((s) => s.audiomotionLedBars)
  const setAudiomotionLedBars = useSongNhacRuntimeStore((s) => s.setAudiomotionLedBars)
  const wavejsAnimation = useSongNhacRuntimeStore((s) => s.wavejsAnimation)
  const setWavejsAnimation = useSongNhacRuntimeStore((s) => s.setWavejsAnimation)
  const vantaEffect = useSongNhacRuntimeStore((s) => s.vantaEffect)
  const setVantaEffect = useSongNhacRuntimeStore((s) => s.setVantaEffect)

  return (
    <div style={{ fontSize: 12, color: '#e8e8e8', paddingBottom: 12 }}>

      {/* ── 1. Background mode ── */}
      <div style={sec}>
        <SectionLabel>Kiểu nền</SectionLabel>
        <div style={{ display: 'flex', gap: 4 }}>
          {(
            [
              { value: 'dark' as const, label: '⬛ Đen' },
              { value: 'blur' as const, label: '🌫 Blur' },
              { value: 'gradient' as const, label: 'Gradient' },
            ] as const
          ).map((opt) => {
            const active = bgMode === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setBgMode(opt.value)}
                style={{
                  flex: 1,
                  padding: '6px 4px',
                  fontSize: 10,
                  fontWeight: active ? 600 : 400,
                  border: `1px solid ${active ? 'rgba(77,159,255,0.7)' : 'rgba(255,255,255,0.12)'}`,
                  borderRadius: 5,
                  background: active ? 'rgba(77,159,255,0.18)' : 'rgba(255,255,255,0.03)',
                  color: active ? '#a8d4ff' : 'rgba(255,255,255,0.55)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        {bgMode === 'blur' && (
          <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
            Blur từ ảnh layer đầu tiên (hoặc đen nếu không có ảnh)
          </div>
        )}
      </div>

      {/* ── 2. Engine picker ── */}
      <div style={sec}>
        <SectionLabel>Engine hiệu ứng</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {ENGINE_OPTIONS.map((opt) => {
            const active = bgEngine === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setBgEngine(opt.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: `1px solid ${active ? 'rgba(77,159,255,0.6)' : 'rgba(255,255,255,0.08)'}`,
                  background: active
                    ? `linear-gradient(135deg, ${opt.color}55 0%, rgba(77,159,255,0.12) 100%)`
                    : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>{opt.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: active ? 700 : 500, color: active ? '#fff' : 'rgba(255,255,255,0.75)' }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>
                    {opt.desc}
                  </div>
                </div>
                {active && (
                  <span style={{ fontSize: 10, color: '#4d9fff', flexShrink: 0, fontWeight: 700 }}>v</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── 3. Engine-specific settings ── */}

      {/* ThreeJS */}
      {bgEngine === 'threejs' && (
        <div style={sec}>
          <SectionLabel>Three.js — Cài đặt</SectionLabel>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 4 }}>Layout</div>
            <select
              value={visualizerLayout}
              onChange={(e) => setVisualizerLayout(e.target.value as VisualizerLayoutId)}
              style={selectStyle}
            >
              {LAYOUT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <SliderField
            label="Bloom Strength"
            value={bloomStrength}
            min={0} max={5} step={0.1}
            display={bloomStrength.toFixed(1)}
            onChange={setBloomStrength}
          />
          <SliderField
            label="Bloom Radius"
            value={bloomRadius}
            min={0} max={2} step={0.1}
            display={bloomRadius.toFixed(1)}
            onChange={setBloomRadius}
          />
          <SliderField
            label="Bloom Threshold"
            value={bloomThreshold}
            min={0} max={1} step={0.05}
            display={bloomThreshold.toFixed(2)}
            onChange={setBloomThreshold}
          />
        </div>
      )}

      {/* Butterchurn */}
      {bgEngine === 'butterchurn' && (
        <div style={sec}>
          <SectionLabel>MilkDrop — Presets</SectionLabel>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 8, fontStyle: 'italic' }}>
            Hơn 100 preset psychedelic. Chuyển ngẫu nhiên hoặc lần lượt.
          </div>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('butterchurn:random'))}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 11,
              fontWeight: 600,
              background: 'linear-gradient(135deg, #4b0082, #7b2fbe)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6,
              cursor: 'pointer',
              marginBottom: 6,
            }}
          >
            Random Preset
          </button>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('butterchurn:prev'))}
              style={{
                flex: 1, padding: '6px 8px', fontSize: 11,
                background: 'rgba(255,255,255,0.06)', color: '#e8e8e8',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, cursor: 'pointer',
              }}
            >
              &lt; Trước
            </button>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('butterchurn:next'))}
              style={{
                flex: 1, padding: '6px 8px', fontSize: 11,
                background: 'rgba(255,255,255,0.06)', color: '#e8e8e8',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, cursor: 'pointer',
              }}
            >
              Sau &gt;
            </button>
          </div>
        </div>
      )}

      {/* AudioMotion */}
      {bgEngine === 'audiomotion' && (
        <div style={sec}>
          <SectionLabel>Spectrum Analyzer — Cài đặt</SectionLabel>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 4 }}>Chế độ phổ</div>
            <select value={audiomotionMode} onChange={(e) => setAudiomotionMode(parseInt(e.target.value))} style={selectStyle}>
              {AUDIOMOTION_MODES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 4 }}>Màu gradient</div>
            <select value={audiomotionGradient} onChange={(e) => setAudiomotionGradient(e.target.value)} style={selectStyle}>
              {AUDIOMOTION_GRADIENTS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'rgba(255,255,255,0.7)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={audiomotionRadial}
                onChange={(e) => setAudiomotionRadial(e.target.checked)}
                style={{ accentColor: '#4d9fff', width: 14, height: 14 }}
              />
              Radial (dạng tròn)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'rgba(255,255,255,0.7)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={audiomotionLedBars}
                onChange={(e) => setAudiomotionLedBars(e.target.checked)}
                style={{ accentColor: '#4d9fff', width: 14, height: 14 }}
              />
              LED Bars (phân đoạn)
            </label>
          </div>
        </div>
      )}

      {/* Wave.js */}
      {bgEngine === 'wavejs' && (
        <div style={sec}>
          <SectionLabel>Wave.js — Kiểu animation</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {WAVEJS_ANIMATIONS.map((opt) => {
              const active = wavejsAnimation === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setWavejsAnimation(opt.value)}
                  style={{
                    padding: '4px 8px',
                    fontSize: 10,
                    border: `1px solid ${active ? 'rgba(77,159,255,0.6)' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: 4,
                    background: active ? 'rgba(77,159,255,0.2)' : 'rgba(255,255,255,0.03)',
                    color: active ? '#a8d4ff' : 'rgba(255,255,255,0.6)',
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Vanta */}
      {bgEngine === 'vanta' && (
        <div style={sec}>
          <SectionLabel>Vanta 3D — Chọn hiệu ứng</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {VANTA_EFFECTS.map((opt) => {
              const active = vantaEffect === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setVantaEffect(opt.value)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px 10px',
                    fontSize: 11,
                    border: `1px solid ${active ? 'rgba(77,159,255,0.5)' : 'rgba(255,255,255,0.07)'}`,
                    borderRadius: 5,
                    background: active ? 'rgba(77,159,255,0.15)' : 'rgba(255,255,255,0.02)',
                    color: active ? '#a8d4ff' : 'rgba(255,255,255,0.65)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 8, fontStyle: 'italic' }}>
            Tự động phản hồi theo nhịp bass
          </div>
        </div>
      )}
    </div>
  )
}

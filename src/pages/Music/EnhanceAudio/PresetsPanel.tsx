import { useState } from 'react'
import type {
  EQSettings, CompressorSettings, LoudnormSettings, StereoSettings,
  NoiseGateSettings, LimiterSettings, ExciterSettings, NoiseReductionSettings,
} from '../../../types/ipc'
import { MASTER_PRESETS, type MasterPreset } from './presets'

interface AllSettings {
  eq: EQSettings
  compressor: CompressorSettings
  loudnorm: LoudnormSettings
  stereo: StereoSettings
  noiseGate: NoiseGateSettings
  limiter: LimiterSettings
  exciter: ExciterSettings
  noiseReduction: NoiseReductionSettings
}

interface Props {
  currentSettings: AllSettings
  onApply: (settings: Partial<AllSettings>) => void
  disabled?: boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  platform: 'Nen tang',
  genre: 'The loai nhac',
  voice: 'Giong noi/hat',
  utility: 'Tien ich',
}

const CATEGORY_COLORS: Record<string, string> = {
  platform: '#0ea5e9',
  genre: '#8b5cf6',
  voice: '#10b981',
  utility: '#f59e0b',
}

export default function PresetsPanel({ currentSettings, onApply, disabled }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<string>('platform')
  const [appliedPreset, setAppliedPreset] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const categories = ['platform', 'genre', 'voice', 'utility']
  const filtered = MASTER_PRESETS.filter(p => p.category === selectedCategory)

  const handleApply = (preset: MasterPreset) => {
    // Merge preset values onto current settings (only override what preset defines)
    const merged: Partial<AllSettings> = {}

    if (preset.eq) {
      merged.eq = { ...currentSettings.eq, ...preset.eq } as EQSettings
    }
    if (preset.compressor) {
      merged.compressor = { ...currentSettings.compressor, ...preset.compressor } as CompressorSettings
    }
    if (preset.loudnorm) {
      merged.loudnorm = { ...currentSettings.loudnorm, ...preset.loudnorm } as LoudnormSettings
    }
    if (preset.stereo) {
      merged.stereo = { ...currentSettings.stereo, ...preset.stereo } as StereoSettings
    }
    if (preset.noiseGate) {
      merged.noiseGate = { ...currentSettings.noiseGate, ...preset.noiseGate } as NoiseGateSettings
    }
    if (preset.limiter) {
      merged.limiter = { ...currentSettings.limiter, ...preset.limiter } as LimiterSettings
    }
    if (preset.exciter) {
      merged.exciter = { ...currentSettings.exciter, ...preset.exciter } as ExciterSettings
    }
    if (preset.noiseReduction) {
      merged.noiseReduction = { ...currentSettings.noiseReduction, ...preset.noiseReduction } as NoiseReductionSettings
    }

    onApply(merged)
    setAppliedPreset(preset.name)
  }

  if (!expanded) {
    return (
      <div style={{ border: '1px solid #333', borderRadius: '6px', padding: '10px 12px', marginBottom: '10px', backgroundColor: '#1e1e1e' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff' }}>Presets chuyen nghiep</span>
          {appliedPreset && (
            <span style={{ fontSize: '11px', color: '#40a9ff', backgroundColor: '#0a1929', padding: '2px 6px', borderRadius: '10px' }}>
              {appliedPreset}
            </span>
          )}
          <button
            onClick={() => setExpanded(true)}
            disabled={disabled}
            style={{ marginLeft: 'auto', fontSize: '11px', padding: '3px 10px', backgroundColor: '#007acc', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Chon preset
          </button>
        </div>
        <div style={{ fontSize: '11px', color: '#555', marginTop: '4px' }}>
          15 preset chuyen nghiep — pop, EDM, jazz, podcast, streaming (YouTube, Spotify, Apple Music...)
        </div>
      </div>
    )
  }

  return (
    <div style={{ border: '1px solid #3a3a00', borderRadius: '6px', padding: '12px', marginBottom: '10px', backgroundColor: '#1e1e00' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff' }}>Presets chuyen nghiep</span>
        {appliedPreset && (
          <span style={{ fontSize: '11px', color: '#40a9ff', backgroundColor: '#0a1929', padding: '2px 6px', borderRadius: '10px' }}>
            Da ap dung: {appliedPreset}
          </span>
        )}
        <button
          onClick={() => setExpanded(false)}
          style={{ marginLeft: 'auto', fontSize: '11px', padding: '3px 8px', backgroundColor: '#333', color: '#aaa', border: '1px solid #444', borderRadius: '4px', cursor: 'pointer' }}
        >
          Thu gon
        </button>
      </div>

      {/* Category tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '10px', flexWrap: 'wrap' }}>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            style={{
              fontSize: '11px', padding: '4px 10px', borderRadius: '12px', cursor: 'pointer', border: 'none',
              backgroundColor: selectedCategory === cat ? CATEGORY_COLORS[cat] : '#2a2a2a',
              color: selectedCategory === cat ? '#fff' : '#888',
              fontWeight: selectedCategory === cat ? 'bold' : 'normal',
            }}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Preset cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {filtered.map(preset => {
          const isActive = appliedPreset === preset.name
          const catColor = CATEGORY_COLORS[preset.category]
          return (
            <div
              key={preset.name}
              style={{
                padding: '8px 10px',
                backgroundColor: isActive ? '#0a1929' : '#252526',
                border: `1px solid ${isActive ? '#40a9ff' : '#333'}`,
                borderRadius: '5px',
                cursor: 'pointer',
                transition: 'border-color 0.15s',
              }}
              onClick={() => !disabled && handleApply(preset)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: catColor, flexShrink: 0 }} />
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: isActive ? '#40a9ff' : '#ddd' }}>
                  {preset.name}
                </span>
                {/* Badges for what's enabled */}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '3px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {preset.eq?.enabled && <Badge label="EQ" color="#059669" />}
                  {preset.compressor?.enabled && <Badge label="Comp" color="#7c3aed" />}
                  {preset.loudnorm?.enabled && <Badge label="LUFS" color="#0ea5e9" />}
                  {preset.stereo?.enabled && <Badge label="Stereo" color="#d97706" />}
                  {preset.noiseGate?.enabled && <Badge label="Gate" color="#dc2626" />}
                  {preset.exciter?.enabled && <Badge label="Exciter" color="#f59e0b" />}
                  {preset.limiter?.enabled && <Badge label="Limit" color="#6366f1" />}
                  {preset.noiseReduction?.enabled && <Badge label="NR" color="#10b981" />}
                </div>
              </div>
              <div style={{ fontSize: '11px', color: '#666', marginTop: '3px', paddingLeft: '14px' }}>
                {preset.description}
              </div>
              {/* Show key values */}
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px', paddingLeft: '14px', flexWrap: 'wrap' }}>
                {preset.loudnorm?.integratedLufs != null && (
                  <span style={{ fontSize: '10px', color: '#555' }}>
                    {preset.loudnorm.integratedLufs} LUFS
                  </span>
                )}
                {preset.compressor?.ratio != null && (
                  <span style={{ fontSize: '10px', color: '#555' }}>
                    {preset.compressor.ratio}:1 ratio
                  </span>
                )}
                {preset.stereo?.amount != null && preset.stereo.enabled && (
                  <span style={{ fontSize: '10px', color: '#555' }}>
                    {preset.stereo.amount}x stereo
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: '8px', padding: '6px 8px', backgroundColor: '#1a1a00', borderRadius: '4px', fontSize: '11px', color: '#666', lineHeight: '1.4' }}>
        Nhan vao preset de ap dung. Tat ca thong so se duoc cap nhat ngay lap tuc — ban van co the chinh chinh sau khi ap dung.
      </div>
    </div>
  )
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: '9px', padding: '1px 4px', borderRadius: '3px',
      backgroundColor: `${color}22`, color, border: `1px solid ${color}44`,
      fontWeight: 'bold',
    }}>
      {label}
    </span>
  )
}

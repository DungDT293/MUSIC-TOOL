/**
 * Chức năng 13 — EXPORT VIDEO (UX). Preset + Resolution / FPS.
 * Low | Medium | Full | Custom. Custom → unlock width/height/fps.
 * Dùng aspectRatio từ store → width/height đúng tỉ lệ (16:9, 4:3, 1:1).
 */

import type { ExportPresetId } from './exportConfigTypes'
import type { AspectRatioId } from './exportConfigTypes'
import { getDimensionsForPresetAndAspectRatio } from './exportConfigTypes'

function getPresetLabel(id: ExportPresetId, aspectRatio: AspectRatioId): string {
  if (id === 'custom') return 'Custom'
  const d = getDimensionsForPresetAndAspectRatio(id, aspectRatio)
  const names: Record<string, string> = { low: 'Low', medium: 'Medium', full: 'Full HD', '2k': '2K' }
  return `${names[id] ?? id} (${d.width}×${d.height}, ${d.fps}fps)`
}

export interface ExportPresetSelectorProps {
  presetId: ExportPresetId
  width: number
  height: number
  fps: number
  aspectRatio: AspectRatioId
  onPresetChange: (id: ExportPresetId) => void
  onWidthChange: (v: number) => void
  onHeightChange: (v: number) => void
  onFpsChange: (v: number) => void
}

export default function ExportPresetSelector({
  presetId,
  width,
  height,
  fps,
  aspectRatio,
  onPresetChange,
  onWidthChange,
  onHeightChange,
  onFpsChange,
}: ExportPresetSelectorProps) {
  const isCustom = presetId === 'custom'
  const styleBlock = { marginBottom: 8, fontSize: 12 }
  const labelStyle = { color: 'rgba(255,255,255,0.7)', marginRight: 8, minWidth: 80 }
  const inputStyle = {
    padding: '4px 6px',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 4,
    background: 'rgba(0,0,0,0.3)',
    color: '#e8e8e8',
    width: 72,
    fontSize: 12,
  }

  return (
    <div style={styleBlock}>
      <div style={{ ...styleBlock, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {(['low', 'medium', 'full', '2k', 'custom'] as const).map((id) => (
          <label key={id} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="exportPreset"
              checked={presetId === id}
              onChange={() => {
                onPresetChange(id)
                if (id !== 'custom') {
                  const p = getDimensionsForPresetAndAspectRatio(id, aspectRatio)
                  onWidthChange(p.width)
                  onHeightChange(p.height)
                  onFpsChange(p.fps)
                }
              }}
              style={{ marginRight: 4 }}
            />
            <span style={{ color: 'rgba(255,255,255,0.85)' }}>{getPresetLabel(id, aspectRatio)}</span>
          </label>
        ))}
      </div>
      {isCustom && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 6 }}>
          <span style={labelStyle}>Width</span>
          <input
            type="number"
            min={320}
            max={4096}
            value={width}
            onChange={(e) => onWidthChange(Math.max(320, Math.min(4096, e.target.valueAsNumber || 320)))}
            style={inputStyle}
          />
          <span style={labelStyle}>Height</span>
          <input
            type="number"
            min={180}
            max={2160}
            value={height}
            onChange={(e) => onHeightChange(Math.max(180, Math.min(2160, e.target.valueAsNumber || 180)))}
            style={inputStyle}
          />
          <span style={labelStyle}>FPS</span>
          <input
            type="number"
            min={15}
            max={120}
            value={fps}
            onChange={(e) => onFpsChange(Math.max(15, Math.min(120, e.target.valueAsNumber || 30)))}
            style={inputStyle}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Chức năng 13 — EXPORT VIDEO (UX). Range: Full track hoặc In/Out (sec).
 * Validate: 0 ≤ in < out ≤ trackDuration.
 */

import type { ExportRange } from './exportConfigTypes'

export interface ExportRangeSelectorProps {
  range: ExportRange
  trackDurationSec: number
  onRangeChange: (range: ExportRange) => void
}

export default function ExportRangeSelector({
  range,
  trackDurationSec,
  onRangeChange,
}: ExportRangeSelectorProps) {
  const isFull = range.type === 'full'
  const inSec = range.type === 'range' ? range.inSec : 0
  const outSec = range.type === 'range' ? range.outSec : Math.max(0.5, trackDurationSec)
  const durationSec = range.type === 'full' ? trackDurationSec : Math.max(0, outSec - inSec)

  const styleBlock = { marginBottom: 8, fontSize: 12 }
  const labelStyle = { color: 'rgba(255,255,255,0.7)', marginRight: 8, minWidth: 60 }
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
      <div style={{ ...styleBlock, display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="radio"
            name="exportRange"
            checked={isFull}
            onChange={() => onRangeChange({ type: 'full' })}
            style={{ marginRight: 4 }}
          />
          <span style={{ color: 'rgba(255,255,255,0.85)' }}>Full track</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="radio"
            name="exportRange"
            checked={!isFull}
            onChange={() =>
              onRangeChange({
                type: 'range',
                inSec: 0,
                outSec: Math.max(0.5, trackDurationSec),
              })
            }
            style={{ marginRight: 4 }}
          />
          <span style={{ color: 'rgba(255,255,255,0.85)' }}>In – Out</span>
        </label>
        {trackDurationSec > 0 && (
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
            Track: {trackDurationSec.toFixed(1)}s
          </span>
        )}
      </div>
      {!isFull && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 6 }}>
          <span style={labelStyle}>In (s)</span>
          <input
            type="number"
            min={0}
            max={Math.max(0, outSec - 0.5)}
            step={0.5}
            value={inSec}
            onChange={(e) => {
              const v = Math.max(0, Math.min(outSec - 0.5, e.target.valueAsNumber ?? 0))
              onRangeChange({ type: 'range', inSec: v, outSec })
            }}
            style={inputStyle}
          />
          <span style={labelStyle}>Out (s)</span>
          <input
            type="number"
            min={Math.min(inSec + 0.5, trackDurationSec)}
            max={trackDurationSec || 3600}
            step={0.5}
            value={outSec}
            onChange={(e) => {
              const v = Math.max(inSec + 0.5, Math.min(trackDurationSec || 3600, e.target.valueAsNumber ?? inSec + 1))
              onRangeChange({ type: 'range', inSec, outSec: v })
            }}
            style={inputStyle}
          />
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>Duration: {durationSec.toFixed(1)}s</span>
        </div>
      )}
      {isFull && trackDurationSec > 0 && (
        <div style={{ marginTop: 4, color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>
          Duration: {trackDurationSec.toFixed(1)}s
        </div>
      )}
      {isFull && trackDurationSec <= 0 && (
        <div style={{ marginTop: 4, color: 'rgba(255,180,80,0.9)', fontSize: 11 }}>
          Play audio to load track duration for full export.
        </div>
      )}
    </div>
  )
}

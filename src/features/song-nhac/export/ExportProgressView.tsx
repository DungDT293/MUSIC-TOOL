/**
 * Chức năng 13 — EXPORT VIDEO (UX). Progress bar + ETA + Speed + Cancel + Retry.
 */

import { useRef, useMemo, useState, useEffect } from 'react'

interface ExportProgressViewProps {
  frameIndex: number
  totalFrames: number
  /** Timestamp (Date.now()) when export started — used for ETA calc */
  startedAt: number
  /** Export resolution info */
  resWidth?: number
  resHeight?: number
  resFps?: number
  onCancel: () => void
  onRetryCpu?: () => void
  suggestedRetryWithCpu: boolean
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '--:--'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function ExportProgressView({
  frameIndex,
  totalFrames,
  startedAt,
  resWidth,
  resHeight,
  resFps,
  onCancel,
  onRetryCpu,
  suggestedRetryWithCpu,
}: ExportProgressViewProps) {
  const done = frameIndex + 1
  const pct = totalFrames > 0 ? Math.min(100, (100 * done) / totalFrames) : 0
  // Preparing: chưa có progress nào (totalFrames=0 hoặc frameIndex=0 và totalFrames=0)
  const isPreparing = totalFrames === 0
  // Finalizing: tất cả frame đã render xong, FFmpeg đang mux/faststart
  const isFinalizing = !isPreparing && done >= totalFrames

  // Elapsed timer: tick mỗi giây để elapsed luôn cập nhật (không phụ thuộc progress events)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // Speed / ETA — use a smoothed speed (rolling average of last 30 updates)
  const speedHistoryRef = useRef<number[]>([])
  const lastUpdateRef = useRef<{ frame: number; time: number }>({ frame: 0, time: startedAt })

  const { elapsedSec, speedFps, etaSec } = useMemo(() => {
    const now = Date.now()
    const elapsed = Math.max(0, (now - startedAt) / 1000)

    // Calculate instantaneous speed from last update
    const dt = (now - lastUpdateRef.current.time) / 1000
    const df = done - lastUpdateRef.current.frame
    if (dt > 0.05 && df > 0) {
      speedHistoryRef.current.push(df / dt)
      if (speedHistoryRef.current.length > 30) speedHistoryRef.current.shift()
    }
    lastUpdateRef.current = { frame: done, time: now }

    // Average speed (fallback to overall speed)
    const hist = speedHistoryRef.current
    const avgSpeed = hist.length > 0
      ? hist.reduce((a, b) => a + b, 0) / hist.length
      : elapsed > 0.5 ? done / elapsed : 0

    const remaining = totalFrames - done
    const eta = avgSpeed > 0 ? remaining / avgSpeed : 0

    return { elapsedSec: elapsed, speedFps: avgSpeed, etaSec: eta }
  }, [frameIndex, totalFrames, startedAt, done, tick])

  const infoColor = 'rgba(255,255,255,0.6)'
  const labelColor = 'rgba(255,255,255,0.4)'

  return (
    <div style={{ marginTop: 12, fontSize: 12 }}>
      {/* Status line */}
      <div style={{ color: 'rgba(255,255,255,0.85)', marginBottom: 6, fontWeight: 500 }}>
        {isPreparing
          ? '🔄 Đang chuẩn bị export (decode audio)…'
          : isFinalizing
            ? '⏳ Đang hoàn tất video (mux audio + faststart)…'
            : `Exporting… ${done} / ${totalFrames} frames`}
      </div>
      {/* Progress bar */}
      <div
        style={{
          height: 8,
          background: 'rgba(0,0,0,0.4)',
          borderRadius: 4,
          overflow: 'hidden',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            height: '100%',
            width: isPreparing ? '30%' : `${pct}%`,
            marginLeft: isPreparing ? `${(tick * 5) % 70}%` : undefined,
            background: isPreparing
              ? 'rgba(255,200,80,0.5)'
              : isFinalizing
                ? 'linear-gradient(90deg, rgba(0,122,204,0.8), rgba(80,200,120,0.8))'
                : 'rgba(0,122,204,0.8)',
            transition: 'width 0.15s ease',
          }}
        />
      </div>
      {/* Time info grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '4px 12px',
          marginBottom: 10,
          fontSize: 11,
        }}
      >
        <div>
          <span style={{ color: labelColor }}>Elapsed: </span>
          <span style={{ color: infoColor }}>{fmtTime(elapsedSec)}</span>
        </div>
        <div>
          <span style={{ color: labelColor }}>ETA: </span>
          <span style={{ color: isPreparing ? 'rgba(255,200,80,0.7)' : isFinalizing ? 'rgba(80,200,120,0.8)' : infoColor }}>
            {isPreparing ? 'Đang chuẩn bị…' : isFinalizing ? 'Finalizing…' : fmtTime(etaSec)}
          </span>
        </div>
        <div>
          <span style={{ color: labelColor }}>Speed: </span>
          <span style={{ color: infoColor }}>{speedFps > 0 ? `${speedFps.toFixed(1)} fps` : '—'}</span>
        </div>
        <div>
          <span style={{ color: labelColor }}>Progress: </span>
          <span style={{ color: infoColor }}>{pct.toFixed(1)}%</span>
        </div>
        {(resWidth && resHeight) && (
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={{ color: labelColor }}>Output: </span>
            <span style={{ color: infoColor }}>{resWidth}×{resHeight}{resFps ? ` @ ${resFps}fps` : ''}</span>
          </div>
        )}
      </div>
      {/* Buttons */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '6px 12px',
            border: '1px solid rgba(255,80,80,0.5)',
            borderRadius: 4,
            background: 'transparent',
            color: 'rgba(255,120,120,0.9)',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Cancel
        </button>
        {suggestedRetryWithCpu && onRetryCpu && (
          <button
            type="button"
            onClick={onRetryCpu}
            style={{
              padding: '6px 12px',
              border: '1px solid rgba(255,180,80,0.6)',
              borderRadius: 4,
              background: 'rgba(255,180,80,0.15)',
              color: 'rgba(255,200,100,0.95)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Retry with CPU
          </button>
        )}
      </div>
    </div>
  )
}

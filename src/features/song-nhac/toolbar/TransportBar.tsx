/**
 * Polish 3.6 — Transport bar: Play/Pause, time, seek.
 * Event-based: setInterval 300ms; sync playhead với timeline (setPlayheadTimeSec).
 * Seek chỉ commit trên pointerup; không đặt trong Preview.
 */

import type { RefObject } from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { PlaybackState } from '../types/PlaybackState'
import { useSongNhacTimelineStore } from '../store/songNhacTimelineStore'

const TICK_MS = 300

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export interface TransportBarProps {
  audioRef: RefObject<HTMLAudioElement | null>
  durationSec: number
  playbackState: PlaybackState
  /** Có audio đã chọn (audioFileUrl) — dùng để enable Play ngay khi chọn, không cần đợi decode xong. */
  hasAudio: boolean
  onPlay: () => void
  onPause: () => void
}

export default function TransportBar({
  audioRef,
  durationSec,
  playbackState,
  hasAudio: hasAudioProp,
  onPlay,
  onPause,
}: TransportBarProps) {
  const [currentTimeSec, setCurrentTimeSec] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [dragValueSec, setDragValueSec] = useState(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const setPlayheadTimeSec = useSongNhacTimelineStore((s) => s.setPlayheadTimeSec)

  const hasDuration = durationSec > 0
  const hasAudio = hasAudioProp || hasDuration
  const displayCurrent = isDragging ? dragValueSec : currentTimeSec
  const clampedDuration = Math.max(0, durationSec)

  // Phase 1: Sync timeline playhead with audio.currentTime (interval + on no-audio reset)
  useEffect(() => {
    if (!hasDuration) {
      setCurrentTimeSec(0)
      setPlayheadTimeSec(0)
      if (tickRef.current) {
        clearInterval(tickRef.current)
        tickRef.current = null
      }
      return
    }
    tickRef.current = setInterval(() => {
      if (audioRef.current) {
        const now = audioRef.current.currentTime
        if (Number.isFinite(now)) {
          setCurrentTimeSec(now)
          setPlayheadTimeSec(now)
        }
      }
    }, TICK_MS)
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current)
        tickRef.current = null
      }
    }
  }, [hasDuration, audioRef, setPlayheadTimeSec])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!hasDuration) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    setDragValueSec(audioRef.current?.currentTime ?? 0)
  }, [hasDuration, audioRef])

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLInputElement>) => {
      if (!isDragging || !hasDuration) return
      const input = e.currentTarget
      const pct = input.valueAsNumber
      const sec = (pct / 100) * clampedDuration
      setDragValueSec(Math.max(0, Math.min(clampedDuration, sec)))
    },
    [isDragging, hasDuration, clampedDuration]
  )

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (!isDragging) return
    const el = audioRef.current
    if (el && clampedDuration > 0) {
      const seekTo = Math.max(0, Math.min(clampedDuration, dragValueSec))
      el.currentTime = seekTo
      setCurrentTimeSec(seekTo)
      setPlayheadTimeSec(seekTo)
    }
    setIsDragging(false)
  }, [isDragging, audioRef, clampedDuration, dragValueSec, setPlayheadTimeSec])

  const handleRangeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isDragging || !hasDuration) return
      const pct = Number(e.target.value)
      const sec = (pct / 100) * clampedDuration
      setDragValueSec(Math.max(0, Math.min(clampedDuration, sec)))
    },
    [isDragging, hasDuration, clampedDuration]
  )

  const playDisabled = !hasAudio

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 10px',
        background: '#16162a',
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.08)',
        fontSize: 12,
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {playbackState === 'playing' ? (
        <button
          type="button"
          onClick={onPause}
          title="Pause"
          style={btnStyle}
        >
          ⏸
        </button>
      ) : (
        <button
          type="button"
          disabled={playDisabled}
          onClick={onPlay}
          title={playDisabled ? 'Load audio to play' : 'Play'}
          style={{
            ...btnStyle,
            color: playDisabled ? 'rgba(255,255,255,0.4)' : undefined,
            cursor: playDisabled ? 'not-allowed' : undefined,
          }}
        >
          ▶
        </button>
      )}
      <span style={{ color: 'rgba(255,255,255,0.85)', minWidth: 36 }}>
        {formatTime(displayCurrent)}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={clampedDuration > 0 ? (displayCurrent / clampedDuration) * 100 : 0}
        disabled={!hasDuration}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onChange={handleRangeChange}
        style={{
          flex: 1,
          minWidth: 60,
          accentColor: 'rgba(0,122,204,0.8)',
          cursor: hasDuration ? 'pointer' : 'not-allowed',
        }}
      />
      <span style={{ color: 'rgba(255,255,255,0.6)', minWidth: 36 }}>
        {formatTime(clampedDuration)}
      </span>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid rgba(255,255,255,0.3)',
  borderRadius: 4,
  background: 'transparent',
  color: 'rgba(255,255,255,0.9)',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
}

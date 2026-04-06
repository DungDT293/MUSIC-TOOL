/**
 * Chức năng 13 - Sóng nhạc (Music Visualizer)
 * V2: Left panel dùng 2 tabs — Layers và Background/Engine.
 * Play chỉ từ user click; không auto-play trong effect (tránh Chromium autoplay block).
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import VisualizerLayout from './VisualizerLayout'
import PreviewViewport from './PreviewViewport'
import LayersPanel from './panels/LayersPanel'
import EnginesPanel from './panels/EnginesPanel'
import InspectorPanel from './panels/InspectorPanel'
import TimelineView from './timeline/TimelineView'
import { useTimelineCompute } from './timeline/useTimelineCompute'
import VisualizerToolbar from './toolbar/VisualizerToolbar'
import TransportBar from './toolbar/TransportBar'
import ExportDialog from './export/ExportDialog'
import AudioSourceSelector from './AudioSourceSelector'
import { useSongNhacAudioStore } from './store/songNhacAudioStore'
import { decodeAudioFromFileUrl } from './utils/decodeAudioFromFileUrl'
import { useSongNhacKeyboardShortcuts } from './hooks/useSongNhacKeyboardShortcuts'
import type { PlaybackState } from './types/PlaybackState'

export type { PlaybackState }

type LeftTab = 'layers' | 'background'

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '7px 4px',
  fontSize: 11,
  fontWeight: active ? 600 : 400,
  border: 'none',
  borderBottom: active ? '2px solid #4d9fff' : '2px solid transparent',
  background: 'transparent',
  color: active ? '#fff' : 'rgba(255,255,255,0.5)',
  cursor: 'pointer',
  transition: 'color 0.15s, border-color 0.15s',
  letterSpacing: 0.3,
})

export default function SongNhacScreen() {
  useSongNhacKeyboardShortcuts()
  const { startCompute } = useTimelineCompute()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioFileUrl = useSongNhacAudioStore((s) => s.audioFileUrl)
  const durationSec = useSongNhacAudioStore((s) => s.durationSec)
  const setDurationSec = useSongNhacAudioStore((s) => s.setDurationSec)
  const [playState, setPlayState] = useState<PlaybackState>('no-audio')
  const [playError, setPlayError] = useState<string | null>(null)
  const [leftTab, setLeftTab] = useState<LeftTab>('layers')

  useEffect(() => {
    if (!audioFileUrl) {
      setPlayState('no-audio')
      return
    }
    setPlayState('paused')
    setPlayError(null)
  }, [audioFileUrl])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onPlay = () => {
      setPlayState('playing')
      setPlayError(null)
    }
    const onPause = () => setPlayState('paused')
    const onEnded = () => setPlayState('paused')
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
    return () => {
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
    }
  }, [audioFileUrl])

  useEffect(() => {
    if (!audioFileUrl) return
    const el = audioRef.current
    if (!el) return
    el.pause()
    el.currentTime = 0
  }, [audioFileUrl])

  const handlePlay = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    setPlayError(null)
    el.play().catch((err) => {
      const msg = err?.message || err?.name || 'NotAllowedError'
      console.error('[SongNhac] Play failed:', err?.name, err?.message)
      if (msg.includes('no supported sources') || msg.includes('NotSupportedError')) {
        setPlayError('File audio không tồn tại hoặc không thể đọc. Hãy chọn lại track hoặc scan lại thư mục nhạc.')
      } else if (msg === 'NotAllowedError') {
        setPlayError('Trình duyệt chặn phát. Đóng app (thoát hẳn) rồi mở lại, sau đó bấm Play.')
      } else {
        setPlayError(`Không thể phát: ${msg}`)
      }
    })
  }, [])
  const handlePause = useCallback(() => {
    audioRef.current?.pause()
  }, [])

  useEffect(() => {
    if (!audioFileUrl) return
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      decodeAudioFromFileUrl(audioFileUrl)
        .then(({ channelData, sampleRate, duration }) => {
          if (cancelled) return
          if (!Number.isFinite(duration) || duration <= 0) {
            console.warn('[SongNhac] Invalid duration from decode', duration)
            return
          }
          setDurationSec(duration)
          try {
            startCompute(channelData, sampleRate, duration)
          } catch (e) {
            console.warn('[SongNhac] startCompute failed', e)
          }
        })
        .catch((err) => console.warn('[SongNhac] decodeAudioFromFileUrl failed', err))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [audioFileUrl, startCompute, setDurationSec])

  const leftPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#16162a', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
      {/* Audio source selector */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '8px 10px' }}>
        <AudioSourceSelector />
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.2)' }}>
        <button type="button" style={tabBtnStyle(leftTab === 'layers')} onClick={() => setLeftTab('layers')}>
          Layers
        </button>
        <button type="button" style={tabBtnStyle(leftTab === 'background')} onClick={() => setLeftTab('background')}>
          🌌 Nền & Engine
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {leftTab === 'layers' ? (
          <LayersPanel />
        ) : (
          <EnginesPanel />
        )}
      </div>
    </div>
  )

  return (
    <>
      <audio
        ref={audioRef}
        src={audioFileUrl ?? undefined}
        preload="metadata"
        crossOrigin="anonymous"
        style={{ display: 'none' }}
        onError={(e) => {
          const el = e.currentTarget
          const src = el?.src || audioFileUrl || ''
          const isUNC = src.includes('%5C%5C') || src.includes('\\\\') || decodeURIComponent(src).startsWith('\\\\')
          console.error('[SongNhac] Audio load error:', el?.error?.message, 'src:', src.slice(0, 120))
          if (isUNC) {
            setPlayError('Không thể truy cập file nhạc trên mạng (network share). Kiểm tra kết nối mạng hoặc chọn file từ máy local.')
          } else {
            setPlayError('File audio không tồn tại hoặc không thể đọc. Hãy chọn lại track hoặc scan lại thư mục nhạc.')
          }
        }}
      />
      <VisualizerLayout
        leftPanel={leftPanel}
        preview={
          <PreviewViewport
            onTimelineCompute={startCompute}
            audioRef={audioRef}
            audioFileUrl={audioFileUrl}
          />
        }
        rightPanel={<InspectorPanel />}
        timeline={<TimelineView />}
        transport={
          <TransportBar
            audioRef={audioRef}
            durationSec={durationSec ?? 0}
            playbackState={playState}
            hasAudio={!!audioFileUrl}
            onPlay={handlePlay}
            onPause={handlePause}
          />
        }
        toolbar={
          <>
            {playError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 4,
                  padding: '5px 10px',
                  background: 'rgba(255,180,80,0.15)',
                  border: '1px solid rgba(255,180,80,0.4)',
                  borderRadius: 4,
                  fontSize: 11,
                  color: 'rgba(255,220,140,0.95)',
                }}
              >
                <span style={{ flex: 1 }}>{playError}</span>
                <button
                  type="button"
                  onClick={() => setPlayError(null)}
                  style={{
                    padding: '2px 8px',
                    border: '1px solid rgba(255,255,255,0.3)',
                    borderRadius: 4,
                    background: 'transparent',
                    color: 'rgba(255,255,255,0.8)',
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                >
                  Đóng
                </button>
              </div>
            )}
            <VisualizerToolbar
              playbackState={playState}
              onPlay={handlePlay}
              onPause={handlePause}
            />
          </>
        }
      />
      <ExportDialog />
    </>
  )
}

import { useRef, useEffect, useCallback } from 'react'
import type { UseAudioChainReturn } from './useAudioChain'

interface Props {
  chain: UseAudioChainReturn
  selectedFilePath: string | null
  lufs: number
  gainReduction: number
  onRequestLoudnormPreview?: () => void
  previewLoading?: boolean
}

function formatTime(s: number): string {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

const LUFS_TARGET = -14

export default function PreviewPlayer({ chain, selectedFilePath, lufs, gainReduction, onRequestLoudnormPreview, previewLoading }: Props) {
  const { audioRef, isReady, setBypass } = chain
  const bypassRef = useRef(false)

  // When file changes, update audio src using blob URL (avoids CSP file:// restriction)
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !selectedFilePath) return

    let cancelled = false
    let prevBlobUrl = ''

    async function loadAudio() {
      const api = window.api
      let url = ''

      if (api?.readFileAsBase64) {
        const res = await api.readFileAsBase64(selectedFilePath!)
        if (!cancelled && res?.ok && res.base64) {
          const binary = atob(res.base64)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
          const blob = new Blob([bytes], { type: res.mime ?? 'audio/mpeg' })
          url = URL.createObjectURL(blob)
          prevBlobUrl = url
        }
      }

      if (!cancelled && audio) {
        if (!url) {
          // Fallback: manual file:// URL
          const norm = selectedFilePath!.replace(/\\/g, '/')
          url = `file:///${norm.split('/').map(encodeURIComponent).join('/')}`
        }
        if (audio.src !== url) {
          audio.src = url
          audio.load()
        }
      }
    }

    loadAudio()
    return () => {
      cancelled = true
      if (prevBlobUrl) URL.revokeObjectURL(prevBlobUrl)
    }
  }, [selectedFilePath, audioRef])

  const handleBypassToggle = useCallback(() => {
    bypassRef.current = !bypassRef.current
    setBypass(bypassRef.current)
  }, [setBypass])

  const lufsOk = isFinite(lufs)
  const lufsColor = !lufsOk ? '#555'
    : lufs > -8 ? '#ef4444'
    : lufs > -14 ? '#22c55e'
    : lufs > -20 ? '#f59e0b'
    : '#888'

  const lufsTargetOff = lufsOk ? lufs - LUFS_TARGET : 0
  const lufsSign = lufsTargetOff > 0 ? '+' : ''

  return (
    <div style={{ border: '1px solid #333', borderRadius: '6px', padding: '12px', marginBottom: '10px', backgroundColor: '#1a1a1a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#ccc' }}>Nghe thử real-time</span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {/* LUFS meter */}
          {lufsOk && (
            <span style={{ fontSize: '12px', color: lufsColor, fontWeight: 'bold' }}>
              {lufs.toFixed(1)} LUFS ({lufsSign}{lufsTargetOff.toFixed(1)})
            </span>
          )}
          {/* Bypass button */}
          <button
            onClick={handleBypassToggle}
            disabled={!isReady}
            title="So sánh A/B: bật/tắt toàn bộ xử lý"
            style={{
              fontSize: '11px', padding: '3px 8px',
              backgroundColor: bypassRef.current ? '#3a3a1a' : '#2d2d2d',
              color: bypassRef.current ? '#f59e0b' : '#888',
              border: `1px solid ${bypassRef.current ? '#f59e0b' : '#444'}`,
              borderRadius: '3px', cursor: 'pointer',
            }}
          >
            A/B
          </button>
        </div>
      </div>

      {/* Audio element */}
      <audio
        ref={audioRef}
        controls
        style={{ width: '100%', height: '36px', backgroundColor: '#1a1a1a' }}
      />

      {/* Meters row */}
      {lufsOk && (
        <div style={{ marginTop: '6px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* LUFS bar */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '10px', color: '#555', marginBottom: '2px' }}>Loudness (approx.)</div>
            <div style={{ height: '4px', backgroundColor: '#333', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.max(0, Math.min(100, ((lufs + 40) / 40) * 100))}%`,
                backgroundColor: lufsColor,
                transition: 'width 0.1s',
              }} />
            </div>
          </div>
          {/* Gain reduction */}
          {gainReduction < -0.5 && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '10px', color: '#555', marginBottom: '2px' }}>Gain Reduction</div>
              <div style={{ height: '4px', backgroundColor: '#333', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, Math.abs(gainReduction) * 5)}%`,
                  backgroundColor: gainReduction < -6 ? '#ef4444' : '#3b82f6',
                  transition: 'width 0.05s',
                }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Status */}
      <div style={{ marginTop: '6px', fontSize: '11px', color: '#555' }}>
        {!isReady && 'Web Audio chua san sang — nhan Play de khoi dong.'}
        {isReady && !selectedFilePath && 'Chon mot file ben trai de nghe thu.'}
        {isReady && selectedFilePath && 'Real-time: EQ, Compressor, Stereo hoat dong ngay khi keo slider.'}
      </div>
    </div>
  )
}

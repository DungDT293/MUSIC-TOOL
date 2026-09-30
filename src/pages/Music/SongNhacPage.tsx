import { useCallback, useEffect, useRef, useState } from 'react'
import { audioFrameFromAnalyser, emptyAudioFrame } from '../../features/song-nhac/core/audioBands'
import { renderSongNhacFrame } from '../../features/song-nhac/core/renderSongNhacFrame'
import { SONG_NHAC_STYLES, clampRenderConfig, type SongNhacStyle } from '../../features/song-nhac/core/types'
import type { SongNhacExportProgress } from '../../../shared/songNhacChannels'

function localFileUrl(filePath: string): string {
  return `app://local-file/?path=${encodeURIComponent(filePath)}`
}

export default function SongNhacPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const previousBassRef = useRef(0)
  const [audioPath, setAudioPath] = useState('')
  const [outputPath, setOutputPath] = useState('')
  const [style, setStyle] = useState<SongNhacStyle>('neon-tunnel')
  const [isPlaying, setIsPlaying] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState<SongNhacExportProgress | null>(null)
  const [message, setMessage] = useState('Chọn audio để bắt đầu.')

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    const audio = audioRef.current
    if (!canvas || !analyser || !audio) return
    const context = canvas.getContext('2d')
    if (!context) return
    const frequencyData = new Uint8Array(analyser.frequencyBinCount)
    const waveformData = new Uint8Array(analyser.fftSize)
    const render = () => {
      analyser.getByteFrequencyData(frequencyData)
      analyser.getByteTimeDomainData(waveformData)
      const frame = audioFrameFromAnalyser(audio.currentTime, frequencyData, waveformData, previousBassRef.current)
      previousBassRef.current = frame.bass
      renderSongNhacFrame(context, canvas.width, canvas.height, frame, clampRenderConfig({ style, quality: 'balanced', intensity: 1, seed: 93 }))
      rafRef.current = requestAnimationFrame(render)
    }
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    render()
  }, [style])

  // Create MediaElementSource only after user click. React StrictMode runs effects
  // twice in development, while one HTMLMediaElement can own only one source node.
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    sourceRef.current?.disconnect()
    analyserRef.current?.disconnect()
    void contextRef.current?.close()
    contextRef.current = null
    analyserRef.current = null
    sourceRef.current = null
  }, [])

  const ensureAudioGraph = () => {
    const audio = audioRef.current
    if (!audio) return null
    if (contextRef.current && analyserRef.current && sourceRef.current) return contextRef.current

    const context = new AudioContext({ latencyHint: 'interactive' })
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.8
    const source = context.createMediaElementSource(audio)
    source.connect(analyser)
    analyser.connect(context.destination)
    contextRef.current = context
    analyserRef.current = analyser
    sourceRef.current = source
    return context
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (context) renderSongNhacFrame(context, canvas.width, canvas.height, emptyAudioFrame(), clampRenderConfig({ style, quality: 'balanced', intensity: 1, seed: 93 }))
  }, [style])

  useEffect(() => {
    const unsubscribe = window.api.songNhac?.onProgress?.(setProgress)
    return unsubscribe
  }, [])

  const chooseAudio = async () => {
    const selected = await window.api.selectAudioFile()
    if (!selected || !audioRef.current) return
    setAudioPath(selected)
    audioRef.current.src = localFileUrl(selected)
    audioRef.current.load()
    setMessage('Audio sẵn sàng. Bấm Phát để xem visualizer.')
    setProgress(null)
  }

  const chooseOutput = async () => {
    const result = await window.api.dialog.saveVideoFile('song-nhac.mp4')
    if (!result.canceled && result.filePath) setOutputPath(result.filePath)
  }

  const togglePlay = async () => {
    const audio = audioRef.current
    if (!audio || !audioPath) return
    const context = ensureAudioGraph()
    if (context?.state === 'suspended') await context.resume()
    if (audio.paused) {
      await audio.play()
      setIsPlaying(true)
      draw()
    } else {
      audio.pause()
      setIsPlaying(false)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }

  const startExport = async () => {
    if (!audioPath || !outputPath || isExporting) return
    const requestId = crypto.randomUUID()
    setIsExporting(true)
    setMessage('Đang xuất MP4…')
    try {
      const result = await window.api.songNhac.start({ requestId, audioPath, outputPath, style, width: 1920, height: 1080, fps: 30 })
      setMessage(result.success ? `Xuất xong: ${result.outputPath}` : (result.error || 'Xuất Song Nhạc thất bại.'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsExporting(false)
    }
  }

  const cancelExport = async () => {
    if (progress?.requestId) await window.api.songNhac.cancel(progress.requestId)
  }

  return (
    <section style={{ minHeight: '100%', color: '#e5e7eb', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1 style={{ marginTop: 0 }}>Sóng nhạc</h1>
      <p style={{ color: '#94a3b8' }}>Canvas 2D pseudo-3D · Web Audio FFT · MP4 export</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 18 }}>
        <div style={{ background: '#020617', border: '1px solid #1e40af', borderRadius: 12, padding: 12 }}>
          <canvas ref={canvasRef} width={960} height={540} style={{ display: 'block', width: '100%', borderRadius: 8 }} />
          <audio ref={audioRef} onPlay={() => { setIsPlaying(true); draw() }} onPause={() => setIsPlaying(false)} style={{ display: 'none' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: '#081124', border: '1px solid #172554', borderRadius: 12, padding: 16 }}>
          <button type="button" onClick={chooseAudio}>Chọn audio</button>
          <div style={{ fontSize: 11, wordBreak: 'break-all', color: '#94a3b8' }}>{audioPath || 'Chưa chọn audio'}</div>
          <button type="button" onClick={togglePlay} disabled={!audioPath}>{isPlaying ? 'Tạm dừng preview' : 'Phát preview'}</button>
          <label>Style<select value={style} onChange={(event) => setStyle(event.target.value as SongNhacStyle)} style={{ display: 'block', width: '100%', marginTop: 6 }}>{SONG_NHAC_STYLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <button type="button" onClick={chooseOutput}>Chọn output MP4</button>
          <div style={{ fontSize: 11, wordBreak: 'break-all', color: '#94a3b8' }}>{outputPath || 'Chưa chọn output'}</div>
          <button type="button" onClick={startExport} disabled={!audioPath || !outputPath || isExporting}>{isExporting ? 'Đang xuất…' : 'Xuất MP4'}</button>
          {isExporting && <button type="button" onClick={cancelExport}>Hủy export</button>}
          {progress && <div style={{ color: '#67e8f9', fontSize: 12 }}>{progress.percent.toFixed(1)}% · {progress.timeSec.toFixed(1)}s / {progress.totalSec.toFixed(1)}s</div>}
          <div style={{ color: '#cbd5e1', fontSize: 12 }}>{message}</div>
        </div>
      </div>
    </section>
  )
}

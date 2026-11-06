import { useCallback, useEffect, useRef, useState } from 'react'
import { audioFrameFromAnalyser, emptyAudioFrame } from '../../features/song-nhac/core/audioBands'
import type { SongNhacAudioFrame } from '../../features/song-nhac/core/types'
import { renderSongNhacFrame } from '../../features/song-nhac/core/renderSongNhacFrame'
import { SONG_NHAC_STYLES, clampRenderConfig, type SongNhacStyle } from '../../features/song-nhac/core/types'
import { AveeVisualizerEngine, AVEE_THEMES, type AveeColorTheme } from '../../features/song-nhac/three/AveeVisualizerEngine'
import { exportSongNhacFrames } from '../../features/song-nhac/export/exportSongNhacFrames'
import { LayersPanel } from '../../features/song-nhac/studio/LayersPanel'
import { InspectorPanel } from '../../features/song-nhac/studio/InspectorPanel'
import { useSongNhacLayerStore } from '../../features/song-nhac/studio/songNhacLayerStore'
import type { SongNhacExportProgress } from '../../../shared/songNhacChannels'

function localFileUrl(filePath: string): string {
  return `app://local-file/?path=${encodeURIComponent(filePath)}`
}

/** Gentle synthetic spectrum used before playback so the preview is never a black box. */
function idleAudioFrame(timeSec: number): SongNhacAudioFrame {
  const bins = 96
  const data = new Uint8Array(bins)
  for (let i = 0; i < bins; i += 1) {
    const wave = 0.5 + 0.5 * Math.sin(timeSec * 1.7 + i * 0.32)
    const falloff = Math.exp(-i / 42)
    data[i] = Math.round((0.18 + 0.62 * wave) * falloff * 255)
  }
  return {
    timeSec,
    frequencyData: data,
    waveformData: new Uint8Array(0),
    bass: 0.28 + 0.08 * Math.sin(timeSec * 1.7),
    mid: 0.2,
    treble: 0.12,
    rms: 0.2,
    beat: 0,
  }
}

export default function SongNhacPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const previousBassRef = useRef(0)

  const aveeEngineRef = useRef<AveeVisualizerEngine | null>(null)
  const webglUnavailableRef = useRef(false)
  const exportAbortRef = useRef<AbortController | null>(null)
  const exportRequestIdRef = useRef('')
  const exportModeRef = useRef<'frames' | 'legacy' | null>(null)

  const [audioPath, setAudioPath] = useState('')
  const [logoPath, setLogoPath] = useState('')
  const [outputPath, setOutputPath] = useState('')
  const [style, setStyle] = useState<SongNhacStyle>('avee-circle')
  const [theme, setTheme] = useState<AveeColorTheme>('cyberpunk')
  const [intensity, setIntensity] = useState<number>(1.0)
  const [showParticles, setShowParticles] = useState<boolean>(true)
  const [showLogo, setShowLogo] = useState<boolean>(true)

  const [isPlaying, setIsPlaying] = useState(false)
  const [webglFallback, setWebglFallback] = useState(false)
  const layers = useSongNhacLayerStore((state) => state.layers)
  const layersRef = useRef(layers)
  const dragRef = useRef<null | {
    startX: number
    startY: number
    baseX: number
    baseY: number
    baseRotation: number
    mode: 'move' | 'rotate'
  }>(null)

  const onCanvasPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const state = useSongNhacLayerStore.getState()
    const layer = state.layers.find((item) => item.id === state.selectedLayerId)
    if (!layer || layer.type === 'group' || layer.locked) return
    event.currentTarget.setPointerCapture(event.pointerId)
    state.beginHistoryGesture()
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: layer.transform.x,
      baseY: layer.transform.y,
      baseRotation: layer.transform.rotation,
      mode: event.shiftKey ? 'rotate' : 'move',
    }
  }

  const onCanvasPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const state = useSongNhacLayerStore.getState()
    const layer = state.layers.find((item) => item.id === state.selectedLayerId)
    if (!layer || layer.type === 'group') return
    const rect = event.currentTarget.getBoundingClientRect()
    const dx = ((event.clientX - drag.startX) / Math.max(1, rect.width)) * 1920
    const dy = ((event.clientY - drag.startY) / Math.max(1, rect.height)) * 1080
    if (drag.mode === 'rotate') {
      state.updateLayer(layer.id, { transform: { ...layer.transform, rotation: drag.baseRotation + dx * 0.4 } })
    } else {
      state.updateLayer(layer.id, { transform: { ...layer.transform, x: drag.baseX + dx, y: drag.baseY + dy } })
    }
  }

  const onCanvasPointerUp = () => {
    if (!dragRef.current) return
    dragRef.current = null
    useSongNhacLayerStore.getState().endHistoryGesture()
  }

  const onCanvasWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    const state = useSongNhacLayerStore.getState()
    const layer = state.layers.find((item) => item.id === state.selectedLayerId)
    if (!layer || layer.type === 'group' || layer.locked) return
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.05 : 0.95
    state.updateLayerWithHistory(layer.id, {
      transform: {
        ...layer.transform,
        scaleX: Math.max(0.05, layer.transform.scaleX * factor),
        scaleY: Math.max(0.05, layer.transform.scaleY * factor),
      },
    })
  }

  const onCanvasDoubleClick = () => {
    const state = useSongNhacLayerStore.getState()
    const layer = state.layers.find((item) => item.id === state.selectedLayerId)
    if (layer?.type === 'text') state.setFocusContentInputId(layer.id)
  }
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState<SongNhacExportProgress | null>(null)
  const [message, setMessage] = useState('Chọn audio để bắt đầu.')

  // Re-create Avee engine when canvas mounts or style switches
  const initAveeEngine = useCallback(() => {
    if (aveeEngineRef.current) {
      aveeEngineRef.current.dispose()
      aveeEngineRef.current = null
    }

    const canvas = canvasRef.current
    if (!canvas || style !== 'avee-circle' || webglUnavailableRef.current) return

    try {
      aveeEngineRef.current = new AveeVisualizerEngine(canvas, {
        theme,
        logoUrl: logoPath ? localFileUrl(logoPath) : null,
        intensity,
        showParticles,
        showLogo,
      })
      aveeEngineRef.current.setLayers(useSongNhacLayerStore.getState().layers)
    } catch (error) {
      // No usable WebGL context (VM, old driver, blocked GPU). Remember the failure so the
      // animation loop does not retry every frame, and let the caller draw the 2D fallback.
      webglUnavailableRef.current = true
      aveeEngineRef.current = null
      console.warn('[SongNhac] Không tạo được WebGL, chuyển sang bộ dựng canvas 2D:', error)
      // Surface the reason instead of silently degrading: without it the preview just
      // looks wrong and there is no way to tell whether the engine failed.
      setMessage(`Preview đang dùng chế độ 2D (WebGL lỗi: ${error instanceof Error ? error.message : String(error)})`)
      // Force a fresh 2D canvas element in case the failed WebGL init already bound a
      // context to the current one (a canvas cannot switch context types).
      setWebglFallback(true)
    }
  }, [style, theme, intensity, logoPath, showParticles, showLogo])

  useEffect(() => {
    if (style === 'avee-circle') initAveeEngine()
    if (aveeEngineRef.current) {
      // Initial render frame
      aveeEngineRef.current.render(emptyAudioFrame())
    } else {
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (canvas && context) {
        renderSongNhacFrame(
          context,
          canvas.width,
          canvas.height,
          emptyAudioFrame(),
          clampRenderConfig({ style, quality: 'balanced', intensity: 1, seed: 93 }),
        )
      }
    }

    return () => {
      if (aveeEngineRef.current) {
        aveeEngineRef.current.dispose()
        aveeEngineRef.current = null
      }
    }
  }, [style, initAveeEngine, webglFallback])

  // Sync Avee options without re-creating engine
  useEffect(() => {
    if (aveeEngineRef.current && style === 'avee-circle') {
      aveeEngineRef.current.setOptions({
        theme,
        intensity,
        showParticles,
        showLogo,
        logoUrl: logoPath ? localFileUrl(logoPath) : null,
      })
    }
  }, [theme, intensity, showParticles, showLogo, logoPath, style])

  const draw = useCallback(() => {
    const analyser = analyserRef.current
    const audio = audioRef.current

    const frequencyData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    const waveformData = analyser ? new Uint8Array(analyser.fftSize) : null

    const render = () => {
      // Re-read the element every frame: the canvas is remounted when the visualizer
      // style switches between the WebGL engine and the 2D fallback.
      const canvas = canvasRef.current
      if (!canvas) {
        rafRef.current = requestAnimationFrame(render)
        return
      }
      // Keep-alive pages stay mounted while hidden; skip the GPU work in that case.
      if (!canvas.offsetParent) {
        rafRef.current = requestAnimationFrame(render)
        return
      }

      let frame: ReturnType<typeof emptyAudioFrame>
      if (analyser && frequencyData && waveformData && audio && !audio.paused) {
        analyser.getByteFrequencyData(frequencyData)
        analyser.getByteTimeDomainData(waveformData)
        frame = audioFrameFromAnalyser(audio.currentTime, frequencyData, waveformData, previousBassRef.current)
        previousBassRef.current = frame.bass
      } else {
        // Idle animation: without it the preview is a black rectangle until the user
        // presses play, which reads as "broken" rather than "waiting for audio".
        frame = idleAudioFrame(performance.now() / 1000)
      }

      if (style === 'avee-circle' && !webglUnavailableRef.current && !aveeEngineRef.current) {
        initAveeEngine()
      }
      if (aveeEngineRef.current && style === 'avee-circle') {
        aveeEngineRef.current.render(frame)
      } else {
        const context = canvas.getContext('2d')
        if (context) {
          renderSongNhacFrame(
            context,
            canvas.width,
            canvas.height,
            frame,
            clampRenderConfig({ style, quality: 'balanced', intensity, seed: 93 }),
          )
        }
      }

      rafRef.current = requestAnimationFrame(render)
    }

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    render()
  }, [style, intensity, initAveeEngine])

  // Idle animation runs from mount: the preview reacts (gently) before any audio is loaded.
  useEffect(() => {
    draw()
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [draw])

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    sourceRef.current?.disconnect()
    analyserRef.current?.disconnect()
    void contextRef.current?.close()
    contextRef.current = null
    analyserRef.current = null
    sourceRef.current = null
    if (aveeEngineRef.current) {
      aveeEngineRef.current.dispose()
      aveeEngineRef.current = null
    }
  }, [])

  const ensureAudioGraph = () => {
    const audio = audioRef.current
    if (!audio) return null
    if (contextRef.current && analyserRef.current && sourceRef.current) return contextRef.current

    const context = new AudioContext({ latencyHint: 'interactive' })
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.78
    const source = context.createMediaElementSource(audio)
    source.connect(analyser)
    analyser.connect(context.destination)
    contextRef.current = context
    analyserRef.current = analyser
    sourceRef.current = source
    return context
  }

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
    setMessage('Audio sẵn sàng. Bấm Phát preview để thưởng thức sóng nhạc.')
    setProgress(null)
  }

  const chooseLogo = async () => {
    const selected = await window.api.selectImageFile()
    if (selected) {
      setLogoPath(selected)
      if (aveeEngineRef.current) {
        aveeEngineRef.current.loadLogo(localFileUrl(selected))
      }
    }
  }

  const resetDefaultLogo = () => {
    setLogoPath('')
    if (aveeEngineRef.current) {
      aveeEngineRef.current.resetDefaultLogo()
    }
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

  useEffect(() => {
    layersRef.current = layers
    aveeEngineRef.current?.setLayers(layers)
  }, [layers, webglFallback])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      ) {
        return
      }
      const state = useSongNhacLayerStore.getState()
      const modifier = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (modifier && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) state.redo()
        else state.undo()
        return
      }
      if (modifier && key === 'y') {
        event.preventDefault()
        state.redo()
        return
      }
      if (modifier && key === 'c') {
        state.copySelectedLayers()
        return
      }
      if (modifier && key === 'v') {
        state.pasteLayers()
        return
      }
      if (modifier && key === 'd') {
        event.preventDefault()
        state.duplicateSelectedLayers()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        state.removeSelectedLayers()
        return
      }
      if (event.key === 'Escape') {
        state.setSelection(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const startExport = async () => {
    if (!audioPath || !outputPath || isExporting) return
    const requestId = crypto.randomUUID()
    exportRequestIdRef.current = requestId
    setIsExporting(true)
    setMessage('Đang xuất MP4…')
    setProgress(null)
    try {
      // avee-circle renders through the Three.js engine frame by frame, so the exported
      // file matches the preview. The remaining styles still use the FFmpeg filter path.
      if (style === 'avee-circle') {
        exportModeRef.current = 'frames'
        const controller = new AbortController()
        exportAbortRef.current = controller
        const result = await exportSongNhacFrames({
          requestId,
          audioPath,
          outputPath,
          width: 1920,
          height: 1080,
          fps: 30,
          theme,
          intensity,
          quality: 'balanced',
          seed: 93,
          layers,
          signal: controller.signal,
          onProgress: (percent, rendered, total) => setProgress({
            requestId,
            percent,
            timeSec: rendered / 30,
            totalSec: total / 30,
          }),
        })
        setMessage(result.success ? `Xuất xong: ${result.outputPath}` : result.error || 'Xuất Song Nhạc thất bại.')
      } else {
        exportModeRef.current = 'legacy'
        const result = await window.api.songNhac.start({
          requestId,
          audioPath,
          outputPath,
          style,
          width: 1920,
          height: 1080,
          fps: 30,
        })
        setMessage(result.success ? `Xuất xong: ${result.outputPath}` : result.error || 'Xuất Song Nhạc thất bại.')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      exportModeRef.current = null
      exportAbortRef.current = null
      setIsExporting(false)
    }
  }

  const cancelExport = async () => {
    const requestId = exportRequestIdRef.current
    if (!requestId) return
    if (exportModeRef.current === 'frames') {
      // Abort stops the render loop, then main drops the partial stream and temp file.
      exportAbortRef.current?.abort()
      await window.api.songNhac.framesCancel(requestId)
      setMessage('Đã hủy xuất video.')
    } else {
      await window.api.songNhac.cancel(requestId)
    }
  }

  return (
    <section style={{ minHeight: '100%', color: '#e5e7eb', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1 style={{ marginTop: 0, marginBottom: 4, fontSize: 24, fontWeight: 700 }}>Sóng nhạc</h1>
      <p style={{ color: '#94a3b8', marginTop: 0, marginBottom: 18, fontSize: 13 }}>
        Visualizer 3D phong cách Avee Player · WebGL Three.js · Beat Audio Reactive
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 18 }}>
        {/* Canvas Display Viewport */}
        <div
          style={{
            background: '#020617',
            border: '1px solid #1e293b',
            borderRadius: 12,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            position: 'relative',
          }}
        >
          {/* Key forces fresh canvas element on style switch to avoid WebGL / 2D context collision */}
          <canvas
            key={style === 'avee-circle' && !webglFallback ? 'canvas-three' : 'canvas-2d'}
            ref={canvasRef}
            width={1600}
            height={900}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
            onWheel={onCanvasWheel}
            onDoubleClick={onCanvasDoubleClick}
            style={{
              display: 'block',
              width: '100%',
              aspectRatio: '16/9',
              borderRadius: 8,
              background: '#040714',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            }}
          />
          <audio
            ref={audioRef}
            onPlay={() => {
              setIsPlaying(true)
              draw()
            }}
            onPause={() => setIsPlaying(false)}
            style={{ display: 'none' }}
          />

          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 14,
              width: '100%',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <button
              type="button"
              onClick={togglePlay}
              disabled={!audioPath}
              style={{
                padding: '9px 24px',
                background: isPlaying ? '#dc2626' : '#0284c7',
                border: 'none',
                borderRadius: 6,
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 14,
                cursor: audioPath ? 'pointer' : 'not-allowed',
                opacity: audioPath ? 1 : 0.6,
                transition: 'all 0.2s',
              }}
            >
              {isPlaying ? 'Tạm dừng preview' : 'Phát preview'}
            </button>
            <button
              type="button"
              onClick={() => useSongNhacLayerStore.getState().undo()}
              style={{
                padding: '9px 14px',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 6,
                color: '#e2e8f0',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Hoàn tác
            </button>
            <button
              type="button"
              onClick={() => useSongNhacLayerStore.getState().redo()}
              style={{
                padding: '9px 14px',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 6,
                color: '#e2e8f0',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Làm lại
            </button>
          </div>
        </div>

        {/* Controls Sidebar */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            background: '#090e1a',
            border: '1px solid #1e293b',
            borderRadius: 12,
            padding: 18,
            fontSize: 13,
          }}
        >
          {/* 1. Audio File */}
          <div>
            <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 6 }}>1. Tệp âm thanh</div>
            <button
              type="button"
              onClick={chooseAudio}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 6,
                color: '#f8fafc',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              Chọn tệp audio
            </button>
            <div
              style={{
                fontSize: 11,
                wordBreak: 'break-all',
                color: '#94a3b8',
                marginTop: 4,
                padding: '4px 6px',
                background: '#040714',
                borderRadius: 4,
              }}
            >
              {audioPath ? audioPath.split(/[/\\]/).pop() : 'Chưa chọn audio'}
            </div>
          </div>

          {/* 2. Visualizer Style */}
          <div>
            <label style={{ fontWeight: 600, color: '#f1f5f9', display: 'block', marginBottom: 6 }}>
              2. Kiểu sóng nhạc
            </label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as SongNhacStyle)}
              style={{
                width: '100%',
                padding: '8px 10px',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 6,
                color: '#e2e8f0',
                outline: 'none',
              }}
            >
              {SONG_NHAC_STYLES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          {/* 3. Avee Player Specific Settings */}
          {style === 'avee-circle' && (
            <div
              style={{
                background: '#040714',
                border: '1px solid #1e293b',
                borderRadius: 8,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ fontWeight: 600, color: '#38bdf8', fontSize: 12, textTransform: 'uppercase' }}>
                Tùy chỉnh Avee Player
              </div>

              {/* Logo Select */}
              <div>
                <label style={{ color: '#cbd5e1', display: 'block', marginBottom: 4, fontSize: 12 }}>
                  Logo trung tâm:
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={chooseLogo}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      background: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: 4,
                      color: '#f8fafc',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    Chọn ảnh logo
                  </button>
                  {logoPath && (
                    <button
                      type="button"
                      onClick={resetDefaultLogo}
                      style={{
                        padding: '6px 10px',
                        background: '#334155',
                        border: 'none',
                        borderRadius: 4,
                        color: '#fca5a5',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Mặc định
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                  {logoPath ? logoPath.split(/[/\\]/).pop() : 'Đang dùng logo 93 Media'}
                </div>
              </div>

              {/* Color Theme */}
              <div>
                <label style={{ color: '#cbd5e1', display: 'block', marginBottom: 4, fontSize: 12 }}>
                  Tông màu neon:
                </label>
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as AveeColorTheme)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: 4,
                    color: '#e2e8f0',
                    fontSize: 12,
                    outline: 'none',
                  }}
                >
                  {(Object.keys(AVEE_THEMES) as AveeColorTheme[]).map((key) => (
                    <option key={key} value={key}>
                      {AVEE_THEMES[key].name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Intensity Slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1', fontSize: 12 }}>
                  <span>Độ nhạy đập beat:</span>
                  <span style={{ color: '#38bdf8', fontWeight: 600 }}>{intensity.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={intensity}
                  onChange={(e) => setIntensity(Number(e.target.value))}
                  style={{ width: '100%', marginTop: 6, accentColor: '#0ea5e9' }}
                />
              </div>

              {/* Toggles */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#cbd5e1' }}>
                  <input
                    type="checkbox"
                    checked={showParticles}
                    onChange={(e) => setShowParticles(e.target.checked)}
                    style={{ accentColor: '#0ea5e9' }}
                  />
                  Hạt bụi sao phát sáng (Particles)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#cbd5e1' }}>
                  <input
                    type="checkbox"
                    checked={showLogo}
                    onChange={(e) => setShowLogo(e.target.checked)}
                    style={{ accentColor: '#0ea5e9' }}
                  />
                  Logo và vòng viền trung tâm
                </label>
              </div>
            </div>
          )}

          {/* Layers + inspector */}
          <LayersPanel />
          <InspectorPanel />

          {/* 4. Output MP4 */}
          <div>
            <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 6 }}>3. Xuất video MP4</div>
            <button
              type="button"
              onClick={chooseOutput}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 6,
                color: '#f8fafc',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              Chọn nơi lưu MP4
            </button>
            <div
              style={{
                fontSize: 11,
                wordBreak: 'break-all',
                color: '#94a3b8',
                marginTop: 4,
                padding: '4px 6px',
                background: '#040714',
                borderRadius: 4,
              }}
            >
              {outputPath ? outputPath.split(/[/\\]/).pop() : 'Chưa chọn nơi lưu'}
            </div>
          </div>

          <button
            type="button"
            onClick={startExport}
            disabled={!audioPath || !outputPath || isExporting}
            style={{
              padding: '10px 14px',
              background: isExporting ? '#64748b' : '#059669',
              border: 'none',
              borderRadius: 6,
              color: '#ffffff',
              fontWeight: 700,
              fontSize: 14,
              cursor: !audioPath || !outputPath || isExporting ? 'not-allowed' : 'pointer',
              opacity: !audioPath || !outputPath || isExporting ? 0.6 : 1,
              marginTop: 4,
            }}
          >
            {isExporting ? 'Đang xuất video…' : 'Bắt đầu xuất MP4'}
          </button>

          {isExporting && (
            <button
              type="button"
              onClick={cancelExport}
              style={{
                padding: '7px 12px',
                background: '#dc2626',
                border: 'none',
                borderRadius: 6,
                color: '#ffffff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Hủy xuất
            </button>
          )}

          {progress && (
            <div style={{ color: '#67e8f9', fontSize: 12 }}>
              Tiến độ: {progress.percent.toFixed(1)}% ({progress.timeSec.toFixed(1)}s / {progress.totalSec.toFixed(1)}s)
            </div>
          )}

          <div
            style={{
              color: '#94a3b8',
              fontSize: 12,
              lineHeight: 1.5,
              background: '#040714',
              padding: 10,
              borderRadius: 6,
              border: '1px solid #1e293b',
            }}
          >
            {message}
          </div>
        </div>
      </div>
    </section>
  )
}

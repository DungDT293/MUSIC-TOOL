import { useCallback, useEffect, useRef, useState } from 'react'
import { audioFrameFromAnalyser, emptyAudioFrame } from '../../features/song-nhac/core/audioBands'
import type { SongNhacAudioFrame } from '../../features/song-nhac/core/types'
import { renderSongNhacFrame } from '../../features/song-nhac/core/renderSongNhacFrame'
import { SONG_NHAC_STYLES, clampRenderConfig, type SongNhacStyle } from '../../features/song-nhac/core/types'
import { AveeVisualizerEngine, AVEE_THEMES, type AveeColorTheme } from '../../features/song-nhac/three/AveeVisualizerEngine'
import { exportSongNhacFrames } from '../../features/song-nhac/export/exportSongNhacFrames'
import { FrameEncoder } from '../../features/song-nhac/export/frameEncoder'
import { LayersPanel } from '../../features/song-nhac/studio/LayersPanel'
import { InspectorPanel } from '../../features/song-nhac/studio/InspectorPanel'
import { useSongNhacLayerStore } from '../../features/song-nhac/studio/songNhacLayerStore'
import { WAVE_PRESETS } from '../../features/song-nhac/studio/builtInPresets'
import type { SongNhacExportProgress } from '../../../shared/songNhacChannels'


const TRACK_COLORS: Record<string, string> = {
  visualizer: '#f472b6',
  image: '#38bdf8',
  video: '#22d3ee',
  text: '#a78bfa',
  group: '#475569',
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const total = Math.floor(seconds)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}
const PREVIEW_SIZES = [
  { label: '720p', width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
  { label: '1440p', width: 2560, height: 1440 },
  { label: '4K', width: 3840, height: 2160 },
]

const RAIL_ITEMS: Array<{ id: 'composition' | 'presets' | 'export'; short: string; hint: string }> = [
  { id: 'composition', short: 'Lớp', hint: 'Cây lớp của composition' },
  { id: 'presets', short: 'Preset', hint: 'Thư viện preset sóng' },
  { id: 'export', short: 'Xuất', hint: 'Cài đặt xuất video' },
]

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
  const selectedLayerId = useSongNhacLayerStore((state) => state.selectedLayerId)
  const canUndo = useSongNhacLayerStore((state) => state.historyPast.length > 0)
  const canRedo = useSongNhacLayerStore((state) => state.historyFuture.length > 0)
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

  // React attaches wheel listeners as passive, so preventDefault() there only logs
  // "Unable to preventDefault inside passive event listener". Bind it natively instead:
  // without that the page scrolls while the user is trying to zoom the layer.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
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
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [style, webglFallback])

  const onCanvasDoubleClick = () => {
    const state = useSongNhacLayerStore.getState()
    const layer = state.layers.find((item) => item.id === state.selectedLayerId)
    if (layer?.type === 'text') state.setFocusContentInputId(layer.id)
  }

  const [selectionBounds, setSelectionBounds] = useState<null | { x: number; y: number; width: number; height: number }>(null)
  const scaleRef = useRef<null | { startX: number; startY: number; scaleX: number; scaleY: number; width: number; height: number }>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const engine = aveeEngineRef.current
      if (!engine || !selectedLayerId) {
        setSelectionBounds(null)
        return
      }
      const bounds = engine.getLayerBoundsPx(selectedLayerId)
      setSelectionBounds(bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null)
    })
    return () => cancelAnimationFrame(frame)
  }, [layers, selectedLayerId, webglFallback, style])

  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const state = useSongNhacLayerStore.getState()
    const layer = state.layers.find((item) => item.id === state.selectedLayerId)
    if (!layer || layer.type === 'group' || !selectionBounds) return
    event.currentTarget.setPointerCapture(event.pointerId)
    state.beginHistoryGesture()
    scaleRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      scaleX: layer.transform.scaleX,
      scaleY: layer.transform.scaleY,
      width: Math.max(1, selectionBounds.width),
      height: Math.max(1, selectionBounds.height),
    }
  }

  const onHandlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = scaleRef.current
    if (!drag) return
    const state = useSongNhacLayerStore.getState()
    const layer = state.layers.find((item) => item.id === state.selectedLayerId)
    const canvas = canvasRef.current
    if (!layer || layer.type === 'group' || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const dxPx = ((event.clientX - drag.startX) / Math.max(1, rect.width)) * 1920
    const dyPx = ((event.clientY - drag.startY) / Math.max(1, rect.height)) * 1080
    // Drag the corner: width/height follow the pointer distance from the start box.
    const nextScaleX = Math.max(0.05, drag.scaleX * (1 + dxPx / drag.width))
    const nextScaleY = Math.max(0.05, drag.scaleY * (1 + dyPx / drag.height))
    state.updateLayer(layer.id, {
      transform: {
        ...layer.transform,
        scaleX: event.shiftKey ? nextScaleX : nextScaleX,
        scaleY: event.shiftKey ? nextScaleX : nextScaleY,
      },
    })
  }

  const onHandlePointerUp = () => {
    if (!scaleRef.current) return
    scaleRef.current = null
    useSongNhacLayerStore.getState().endHistoryGesture()
    setSelectionBounds((current) => current)
  }
  const [leftTab, setLeftTab] = useState<'composition' | 'presets' | 'export'>('composition')
  const [rightTab, setRightTab] = useState<'objects' | 'visualizer'>('objects')
  const [audioDuration, setAudioDuration] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [waveformUrl, setWaveformUrl] = useState('')

  // Waveform picture for the timeline, rendered once per audio file by ffmpeg.
  useEffect(() => {
    let cancelled = false
    if (!audioPath) {
      setWaveformUrl('')
      return
    }
    window.api.songNhac
      .waveformImage?.(audioPath, 1600, 96)
      .then((result) => {
        if (!cancelled && result?.success && result.dataUrl) setWaveformUrl(result.dataUrl)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [audioPath])
  const tracks = layers.filter((layer) => layer.type !== 'group')
  const [isExporting, setIsExporting] = useState(false)
  const [exportWidth, setExportWidth] = useState(1920)
  const [exportHeight, setExportHeight] = useState(1080)
  const [exportFps, setExportFps] = useState(30)
  const [rangeStart, setRangeStart] = useState<number | ''>('')
  const [rangeEnd, setRangeEnd] = useState<number | ''>('')
  const [exportCodec, setExportCodec] = useState<'h264' | 'hevc'>('h264')
  const [bitrateTier, setBitrateTier] = useState<'high' | 'balanced' | 'light'>('balanced')
  const [hevcSupported, setHevcSupported] = useState(false)

  useEffect(() => {
    let cancelled = false
    FrameEncoder.probe('hevc', 1920, 1080, 30, 6_000_000)
      .then((supported) => { if (!cancelled) setHevcSupported(supported) })
      .catch(() => { if (!cancelled) setHevcSupported(false) })
    return () => { cancelled = true }
  }, [])
  const [progress, setProgress] = useState<SongNhacExportProgress | null>(null)
  const [message, setMessage] = useState('Chọn audio để bắt đầu.')

  // Re-create Avee engine when canvas mounts or style switches
  // Latest engine options without making initAveeEngine depend on them: changing the theme
  // must not rebuild the whole scene (it re-fetched every image and flickered).
  const engineSettingsRef = useRef({ theme, intensity, logoPath, showParticles, showLogo })
  engineSettingsRef.current = { theme, intensity, logoPath, showParticles, showLogo }

  const initAveeEngine = useCallback(() => {
    if (aveeEngineRef.current) {
      aveeEngineRef.current.dispose()
      aveeEngineRef.current = null
    }

    const canvas = canvasRef.current
    if (!canvas || style !== 'avee-circle' || webglUnavailableRef.current) return

    try {
      const settings = engineSettingsRef.current
      aveeEngineRef.current = new AveeVisualizerEngine(canvas, {
        theme: settings.theme,
        logoUrl: settings.logoPath ? localFileUrl(settings.logoPath) : null,
        intensity: settings.intensity,
        showParticles: settings.showParticles,
        showLogo: settings.showLogo,
        onContextLost: () => {
          setMessage('GPU bị treo (WebGL context lost). Hãy khởi động lại app trước khi xuất video.')
        },
      })
      aveeEngineRef.current.setLayers(useSongNhacLayerStore.getState().layers)
      aveeEngineRef.current.setSelectedLayer(useSongNhacLayerStore.getState().selectedLayerId)
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
  }, [style])

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

  // Dev-only hook so the editor can be exercised without the native file dialog.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as Record<string, unknown>).__songNhacSetAudio = (path: string) => {
      setAudioPath(path)
      const audio = audioRef.current
      if (audio) {
        audio.src = localFileUrl(path)
        audio.load()
      }
    }
  }, [])

  const applyWavePreset = (presetId: string) => {
    const preset = WAVE_PRESETS.find((item) => item.id === presetId)
    if (!preset) return
    const state = useSongNhacLayerStore.getState()
    const viz = state.layers.find((layer) => layer.type === 'visualizer')
    if (!viz) return
    state.updateLayerWithHistory(viz.id, preset.visualizer as never)
    state.setSelection(viz.id)
  }

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
    aveeEngineRef.current?.setSelectedLayer(selectedLayerId)
  }, [layers, selectedLayerId, webglFallback])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Keep-alive router keeps this page mounted while hidden; only react on its route.
      if (!window.location.hash.includes('/music/song-nhac')) return
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
          width: exportWidth,
          height: exportHeight,
          fps: exportFps,
          rangeStartSec: typeof rangeStart === 'number' ? rangeStart : undefined,
          rangeEndSec: typeof rangeEnd === 'number' ? rangeEnd : undefined,
          codec: exportCodec,
          bitrateTier,
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
          width: exportWidth,
          height: exportHeight,
          fps: exportFps,
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
    <section style={{ height: 'calc(100vh - 96px)', minHeight: 0, display: 'flex', flexDirection: 'column', color: '#e5e7eb', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1 style={{ marginTop: 0, marginBottom: 4, fontSize: 24, fontWeight: 700 }}>Sóng nhạc</h1>
      <p style={{ color: '#94a3b8', marginTop: 0, marginBottom: 18, fontSize: 13 }}>
        Visualizer 3D phong cách Avee Player · WebGL Three.js · Beat Audio Reactive
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '48px 250px minmax(0, 1fr) 340px', gap: 12, flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 6, background: '#0b1220', border: '1px solid #1e293b', borderRadius: 10, padding: 6, overflow: 'auto' }}>
          {RAIL_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.hint}
              onClick={() => setLeftTab(item.id)}
              style={{
                width: '100%',
                height: 34,
                borderRadius: 8,
                border: leftTab === item.id ? '1px solid #0ea5e9' : '1px solid #1e293b',
                background: leftTab === item.id ? '#0c4a6e' : '#0f172a',
                color: leftTab === item.id ? '#e0f2fe' : '#94a3b8',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {item.short}
            </button>
          ))}
        </aside>

        <aside style={{ background: '#0b1220', border: '1px solid #1e293b', borderRadius: 10, padding: 10, overflow: 'auto', minHeight: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: 0.6, color: '#64748b', fontWeight: 700, marginBottom: 8 }}>
            {leftTab === 'composition' ? 'COMPOSITION' : leftTab === 'presets' ? 'PRESET SÓNG' : 'XUẤT VIDEO'}
          </div>
          {leftTab === 'composition' && <LayersPanel />}
          {leftTab === 'presets' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {WAVE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyWavePreset(preset.id)}
                  title={preset.description}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    padding: 8,
                    borderRadius: 8,
                    border: '1px solid #1e293b',
                    background: '#0f172a',
                    color: '#cbd5e1',
                    fontSize: 11,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      height: 34,
                      borderRadius: 6,
                      background: `linear-gradient(135deg, ${preset.visualizer.color1 ?? '#22d3ee'}, ${preset.visualizer.color2 ?? '#f472b6'})`,
                    }}
                  />
                  {preset.name}
                </button>
              ))}
            </div>
          )}
          {leftTab === 'export' && (
            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
              Cài đặt xuất nằm ở cột bên phải: độ phân giải, FPS, codec, chất lượng và khoảng thời gian.
            </div>
          )}
        </aside>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, letterSpacing: 0.8, color: '#64748b', fontWeight: 700 }}>PREVIEW</span>
            {PREVIEW_SIZES.map((item) => {
              const active = exportWidth === item.width && exportHeight === item.height
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setExportWidth(item.width)
                    setExportHeight(item.height)
                  }}
                  style={{
                    padding: '3px 10px',
                    borderRadius: 999,
                    border: active ? '1px solid #0ea5e9' : '1px solid #1e293b',
                    background: active ? '#0c4a6e' : '#0f172a',
                    color: active ? '#e0f2fe' : '#94a3b8',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  {item.label}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setExportFps(exportFps === 60 ? 30 : 60)}
              style={{
                marginLeft: 'auto',
                padding: '3px 10px',
                borderRadius: 999,
                border: '1px solid #1e293b',
                background: '#0f172a',
                color: '#94a3b8',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {exportFps} fps
            </button>
          </div>
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
          <div style={{ position: 'relative', width: '100%' }}>
          <canvas
            key={style === 'avee-circle' && !webglFallback ? 'canvas-three' : 'canvas-2d'}
            ref={canvasRef}
            width={1600}
            height={900}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
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
          {selectionBounds && (
            <>
              <div
                style={{
                  position: 'absolute',
                  left: `${((selectionBounds.x + 960) / 1920) * 100}%`,
                  top: `${((selectionBounds.y + 540) / 1080) * 100}%`,
                  width: `${(selectionBounds.width / 1920) * 100}%`,
                  height: `${(selectionBounds.height / 1080) * 100}%`,
                  border: '1px solid rgba(96,165,250,0.9)',
                  pointerEvents: 'none',
                }}
              />
              {([
                ['nwse-resize', 0, 0],
                ['nesw-resize', 100, 0],
                ['nesw-resize', 0, 100],
                ['nwse-resize', 100, 100],
              ] as const).map(([cursor, xPercent, yPercent]) => (
                <div
                  key={`${xPercent}-${yPercent}`}
                  onPointerDown={onHandlePointerDown}
                  onPointerMove={onHandlePointerMove}
                  onPointerUp={onHandlePointerUp}
                  onPointerCancel={onHandlePointerUp}
                  style={{
                    position: 'absolute',
                    left: `calc(${((selectionBounds.x + 960) / 1920) * 100 + xPercent * (selectionBounds.width / 1920) * 100}% - 6px)`,
                    top: `calc(${((selectionBounds.y + 540) / 1080) * 100 + yPercent * (selectionBounds.height / 1080) * 100}% - 6px)`,
                    width: 12,
                    height: 12,
                    background: '#60a5fa',
                    border: '1px solid #1e3a8a',
                    borderRadius: 3,
                    cursor,
                    touchAction: 'none',
                  }}
                />
              ))}
            </>
          )}
          </div>
          <audio
            ref={audioRef}
            onPlay={() => {
              setIsPlaying(true)
              draw()
            }}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration
              setAudioDuration(Number.isFinite(value) ? value : 0)
            }}
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
              disabled={!canUndo}
              title={canUndo ? 'Hoàn tác (Ctrl+Z)' : 'Không có gì để hoàn tác'}
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
              disabled={!canRedo}
              title={canRedo ? 'Làm lại (Ctrl+Shift+Z)' : 'Không có gì để làm lại'}
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
            padding: 14,
            fontSize: 13,
            overflowY: 'auto',
            minHeight: 0,
          }}
        >
          {/* 1. Audio File */}
          {/* Objects / Visualizer tabs */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['objects', 'visualizer'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setRightTab(tab)}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: rightTab === tab ? '1px solid #0ea5e9' : '1px solid #1e293b',
                  background: rightTab === tab ? '#0c4a6e' : '#0f172a',
                  color: rightTab === tab ? '#e0f2fe' : '#94a3b8',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  cursor: 'pointer',
                }}
              >
                {tab === 'objects' ? 'OBJECTS' : 'VISUALIZER'}
              </button>
            ))}
          </div>

          {rightTab === 'visualizer' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {WAVE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyWavePreset(preset.id)}
                    title={preset.description}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      padding: 6,
                      borderRadius: 8,
                      border: '1px solid #1e293b',
                      background: '#0f172a',
                      color: '#cbd5e1',
                      fontSize: 10,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      style={{
                        height: 30,
                        borderRadius: 5,
                        background: `linear-gradient(135deg, ${preset.visualizer.color1 ?? '#22d3ee'}, ${preset.visualizer.color2 ?? '#f472b6'})`,
                      }}
                    />
                    {preset.name}
                  </button>
                ))}
              </div>
              <InspectorPanel />
            </div>
          ) : (
            <>
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
            {style !== 'avee-circle' && (
              <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 6, lineHeight: 1.4 }}>
                Chỉ chế độ “Avee Player” mới hiển thị và xuất được ảnh / video / chữ theo lớp. Các kiểu còn lại chỉ vẽ sóng.
              </div>
            )}
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
            {layers.some((layer) => layer.type === 'video' && layer.visible) && (
              <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 6, lineHeight: 1.4 }}>
                Lớp video phát theo thời gian thực nên khi xuất, cảnh video có thể lệch vài giây so với preview. Ảnh và chữ thì chính xác tuyệt đối.
              </div>
            )}
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
            <label style={{ fontSize: 11, color: '#94a3b8' }}>
              Độ phân giải
              <select
                value={`${exportWidth}x${exportHeight}`}
                onChange={(event) => {
                  const [w, h] = event.target.value.split('x').map(Number)
                  setExportWidth(w)
                  setExportHeight(h)
                }}
                style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12, padding: '4px 6px' }}
              >
                <option value="1280x720">720p</option>
                <option value="1920x1080">1080p</option>
                <option value="2560x1440">1440p</option>
                <option value="3840x2160">4K</option>
              </select>
            </label>
            <label style={{ fontSize: 11, color: '#94a3b8' }}>
              FPS
              <select
                value={exportFps}
                onChange={(event) => setExportFps(Number(event.target.value))}
                style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12, padding: '4px 6px' }}
              >
                <option value={24}>24</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </label>
            <label style={{ fontSize: 11, color: '#94a3b8' }}>
              Codec
              <select
                value={exportCodec}
                onChange={(event) => setExportCodec(event.target.value as 'h264' | 'hevc')}
                style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12, padding: '4px 6px' }}
              >
                <option value="h264">H.264 (tương thích)</option>
                <option value="hevc" disabled={!hevcSupported}>
                  HEVC {hevcSupported ? '(nhỏ hơn ~35%)' : '(máy không hỗ trợ)'}
                </option>
              </select>
            </label>
            <label style={{ fontSize: 11, color: '#94a3b8' }}>
              Chất lượng
              <select
                value={bitrateTier}
                onChange={(event) => setBitrateTier(event.target.value as 'high' | 'balanced' | 'light')}
                style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12, padding: '4px 6px' }}
              >
                <option value="high">Cao (~8 Mbps)</option>
                <option value="balanced">Cân bằng (~6.4 Mbps)</option>
                <option value="light">Nhẹ (~4.4 Mbps)</option>
              </select>
            </label>
            <label style={{ fontSize: 11, color: '#94a3b8' }}>
              Từ giây
              <input
                type="number"
                min={0}
                step={1}
                value={rangeStart}
                placeholder="0"
                onChange={(event) => setRangeStart(event.target.value === '' ? '' : Number(event.target.value))}
                style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12, padding: '4px 6px' }}
              />
            </label>
            <label style={{ fontSize: 11, color: '#94a3b8' }}>
              Đến giây (trống = hết)
              <input
                type="number"
                min={0}
                step={1}
                value={rangeEnd}
                onChange={(event) => setRangeEnd(event.target.value === '' ? '' : Number(event.target.value))}
                style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12, padding: '4px 6px' }}
              />
            </label>
          </div>

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
            </>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div style={{ marginTop: 12, background: '#0b1220', border: '1px solid #1e293b', borderRadius: 10, padding: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 11, color: '#94a3b8' }}>
          <button
            type="button"
            onClick={togglePlay}
            disabled={!audioPath}
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              border: '1px solid #334155',
              background: isPlaying ? '#7f1d1d' : '#0c4a6e',
              color: '#e2e8f0',
              fontSize: 11,
              cursor: audioPath ? 'pointer' : 'not-allowed',
            }}
          >
            {isPlaying ? 'Tạm dừng' : 'Phát'}
          </button>
          <span style={{ fontFamily: 'monospace' }}>{formatClock(playhead)} / {formatClock(audioDuration)}</span>
          <span style={{ marginLeft: 'auto', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tracks.length} lớp · {audioPath ? audioPath.split(/[\\/]/).pop() : 'chưa chọn audio'}
          </span>
        </div>

        <div style={{ position: 'relative', paddingLeft: 132 }}>
          {waveformUrl && (
            <div
              style={{
                height: 54,
                marginBottom: 6,
                background: '#0f172a',
                border: '1px solid #1e293b',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              <img
                src={waveformUrl}
                alt=""
                style={{ display: 'block', width: '100%', height: '100%', objectFit: 'fill' }}
              />
            </div>
          )}
          <div style={{ position: 'absolute', left: 132, right: 0, top: 0, bottom: 0, pointerEvents: 'none' }}>
            <div
              style={{
                position: 'absolute',
                left: `${audioDuration > 0 ? Math.min(100, (playhead / audioDuration) * 100) : 0}%`,
                top: 0,
                bottom: 0,
                width: 2,
                background: '#0ea5e9',
                boxShadow: '0 0 8px #0ea5e9',
              }}
            />
          </div>

          {tracks.length === 0 && <div style={{ fontSize: 11, color: '#475569' }}>Chưa có lớp nào để hiển thị trên timeline.</div>}

          {tracks.map((layer) => {
            const total = audioDuration > 0 ? audioDuration : 1
            const start = layer.timeRange ? Math.max(0, layer.timeRange.startSec) : 0
            const end = layer.timeRange
              ? Math.min(total, Number.isFinite(layer.timeRange.endSec) ? layer.timeRange.endSec : total)
              : total
            const left = Math.max(0, Math.min(100, (start / total) * 100))
            const width = Math.max(0.5, Math.min(100 - left, ((end - start) / total) * 100))
            return (
              <div key={layer.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div
                  style={{
                    width: 124,
                    fontSize: 11,
                    color: layer.visible ? '#cbd5e1' : '#475569',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={layer.name}
                >
                  {layer.name}
                </div>
                <div style={{ position: 'relative', flex: 1, height: 18, background: '#0f172a', borderRadius: 4, border: '1px solid #1e293b' }}>
                  <div
                    style={{
                      position: 'absolute',
                      left: `${left}%`,
                      width: `${width}%`,
                      top: 0,
                      bottom: 0,
                      borderRadius: 4,
                      background: TRACK_COLORS[layer.type] ?? '#64748b',
                      opacity: layer.visible ? 0.85 : 0.3,
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

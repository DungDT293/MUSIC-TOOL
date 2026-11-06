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
import { useCompositionEffects } from '../../features/song-nhac/studio/effectsStore'
import { parseLyrics } from '../../features/song-nhac/studio/lyrics'
import { TimelineClipMenu, type ClipMenuState } from '../../features/song-nhac/studio/TimelineClipMenu'
import { useMediaLibrary, type MediaKind } from '../../features/song-nhac/studio/mediaLibraryStore'
import { useExportQueue, type ExportJob } from '../../features/song-nhac/studio/exportQueueStore'
import { useUserPresets } from '../../features/song-nhac/studio/userPresetsStore'
import { useProjectHistory } from '../../features/song-nhac/studio/projectHistoryStore'
import {
  renderPresetThumbnails,
  renderUserPresetThumbnails,
} from '../../features/song-nhac/studio/presetThumbnails'
import type { StudioLayer } from '../../features/song-nhac/studio/layerTypes'
import type { LyricSearchHit } from '../../../shared/songNhacChannels'
import type { StudioAutomationProperty } from '../../features/song-nhac/studio/layerTypes'
import type { SongNhacExportProgress } from '../../../shared/songNhacChannels'


const TRACK_COLORS: Record<string, string> = {
  visualizer: '#f472b6',
  image: '#38bdf8',
  video: '#22d3ee',
  text: '#a78bfa',
  group: '#475569',
}

const transportStyle: React.CSSProperties = {
  width: 28,
  height: 22,
  borderRadius: 6,
  border: '1px solid #334155',
  background: '#0f172a',
  color: '#cbd5e1',
  cursor: 'pointer',
  fontSize: 10,
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

const projectButtonStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #334155',
  background: '#0f172a',
  color: '#e2e8f0',
  fontSize: 12,
  cursor: 'pointer',
}

const miniIconStyle: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: 5,
  border: '1px solid #334155',
  background: '#0f172a',
  fontSize: 10,
  cursor: 'pointer',
}

const LEFT_TITLES: Record<string, string> = {
  composition: 'COMPOSITION',
  presets: 'PRESET SÓNG',
  effects: 'HIỆU ỨNG',
  analyzer: 'ANALYZER',
  media: 'MEDIA',
  lyrics: 'LYRICS',
  project: 'PROJECT',
  export: 'XUẤT VIDEO',
}

const RAIL_ITEMS: Array<{ id: 'composition' | 'presets' | 'effects' | 'analyzer' | 'media' | 'lyrics' | 'project' | 'export'; short: string; hint: string }> = [
  { id: 'composition', short: 'Lớp', hint: 'Cây lớp của composition' },
  { id: 'presets', short: 'Preset', hint: 'Thư viện preset sóng' },
  { id: 'effects', short: 'Hiệu ứng', hint: 'Hiệu ứng toàn composition' },
  { id: 'analyzer', short: 'Analyzer', hint: 'Dải tần theo từng lớp' },
  { id: 'media', short: 'Media', hint: 'Thư viện ảnh / video / audio' },
  { id: 'lyrics', short: 'Lyrics', hint: 'Lời bài hát theo thời gian' },
  { id: 'project', short: 'Project', hint: 'Lưu / mở project' },
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
  const [leftTab, setLeftTab] = useState<'composition' | 'presets' | 'effects' | 'analyzer' | 'media' | 'lyrics' | 'project' | 'export'>('composition')
  const [mediaTab, setMediaTab] = useState<MediaKind>('image')
  const mediaLibrary = useMediaLibrary()
  const selectedIds = useSongNhacLayerStore((state) => state.selectedIds)
  const queueJobs = useExportQueue((state) => state.jobs)
  const projectHistory = useProjectHistory()
  const userPresets = useUserPresets()
  const [presetName, setPresetName] = useState('')
  const [lyricQuery, setLyricQuery] = useState('')
  const [lyricHits, setLyricHits] = useState<LyricSearchHit[]>([])
  const [lyricBusy, setLyricBusy] = useState(false)
  const [lyricError, setLyricError] = useState('')
  const [clipMenu, setClipMenu] = useState<ClipMenuState | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const seekGuardRef = useRef(0)
  const [presetThumbs, setPresetThumbs] = useState<Record<string, string>>({})
  const [userPresetThumbs, setUserPresetThumbs] = useState<Record<string, string>>({})
  const [snapGuide, setSnapGuide] = useState<number | null>(null)
  const [lyricsText, setLyricsText] = useState('')
  const effects = useCompositionEffects()
  const [rightTab, setRightTab] = useState<'objects' | 'visualizer'>('visualizer')

  // Selecting a layer should land on the panel that can edit it, otherwise the click
  // looks like it did nothing.
  useEffect(() => {
    if (selectedLayerId) setRightTab('visualizer')
  }, [selectedLayerId])
  const [audioDuration, setAudioDuration] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [timelineZoom, setTimelineZoom] = useState(1)
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
  const tracks = layers.filter((layer): layer is StudioLayer => layer.type !== 'group')
  const tickStep = (() => {
    for (const candidate of [5, 10, 15, 30, 60, 120, 300, 600]) {
      if (audioDuration > 0 && audioDuration / candidate <= 12) return candidate
    }
    return 900
  })()
  const tickMarks =
    audioDuration > 0
      ? Array.from({ length: Math.floor(audioDuration / tickStep) + 1 }, (_, index) => index * tickStep)
      : []
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
      aveeEngineRef.current.setEffects(useCompositionEffects.getState())
      if (import.meta.env.DEV) {
        ;(window as unknown as Record<string, unknown>).__songNhacEngine = aveeEngineRef.current
        ;(window as unknown as Record<string, unknown>).__songNhacStore = useSongNhacLayerStore
        ;(window as unknown as Record<string, unknown>).__songNhacMedia = useMediaLibrary
        ;(window as unknown as Record<string, unknown>).__songNhacQueue = useExportQueue
        ;(window as unknown as Record<string, unknown>).__songNhacBatch = enqueueBatchFiles
        ;(window as unknown as Record<string, unknown>).__songNhacHistory = useProjectHistory
        ;(window as unknown as Record<string, unknown>).__songNhacApplyPreset = (id: string) => applyWavePreset(id)
      }
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
        // Once a track is loaded, idle time follows the playhead so seeking previews
        // lyrics and keyframes at the right moment.
        frame = idleAudioFrame(audio && audio.readyState > 0 && audio.duration ? audio.currentTime : performance.now() / 1000)
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

  /** Drop image / video / audio straight onto the stage, like the reference editor. */
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files ?? [])
    if (!files.length) return
    const store = useSongNhacLayerStore.getState()
    for (const file of files) {
      const filePath = window.api.getPathForFile?.(file) ?? ''
      if (!filePath) continue
      const name = filePath.split(/[\\/]/).pop() ?? 'Media'
      const lower = filePath.toLowerCase()
      if (/\.(mp3|m4a|wav|aac|flac|ogg)$/.test(lower)) {
        setAudioPath(filePath)
        const audio = audioRef.current
        if (audio) {
          audio.src = localFileUrl(filePath)
          audio.load()
        }
        continue
      }
      if (/\.(png|jpe?g|webp|gif|bmp)$/.test(lower)) {
        const id = store.addImageLayer(name, localFileUrl(filePath))
        store.setSelection(id)
        continue
      }
      if (/\.(mp4|mov|webm|mkv|m4v)$/.test(lower)) {
        const id = store.addVideoLayer(name, localFileUrl(filePath))
        store.setSelection(id)
      }
    }
    setMessage('Đã thêm file kéo thả vào composition.')
  }

  /**
   * Snaps a candidate time to the nearest interesting mark (0, track end, playhead or
   * another clip edge) and reports the guide to draw.
   */
  const snapTime = (value: number, targets: number[], tolerance: number): { value: number; guide: number | null } => {
    let best = value
    let guide: number | null = null
    let bestDistance = tolerance
    for (const target of targets) {
      const distance = Math.abs(target - value)
      if (distance <= bestDistance) {
        bestDistance = distance
        best = target
        guide = target
      }
    }
    return { value: best, guide }
  }
  /** Drag a clip edge (or its body) to retime a layer on the timeline. */
  const beginClipDrag = (
    event: React.PointerEvent<HTMLElement>,
    layer: StudioLayer,
    mode: 'start' | 'end' | 'move',
  ) => {
    const lane = (event.currentTarget as HTMLElement).closest('[data-lane]') as HTMLElement | null
    if (!lane) return
    event.preventDefault()
    event.stopPropagation()
    const rect = lane.getBoundingClientRect()
    const total = audioDuration > 0 ? audioDuration : 1
    const secPerPx = total / Math.max(1, rect.width)
    const startX = event.clientX
    const origStart = layer.timeRange ? Math.max(0, layer.timeRange.startSec) : 0
    const origEnd =
      layer.timeRange && Number.isFinite(layer.timeRange.endSec) ? Math.min(total, layer.timeRange.endSec) : total
    const store = useSongNhacLayerStore.getState()
    // Dragging the body of a selected clip moves the whole selection.
    const selection = store.selectedIds
    const groupIds =
      mode === 'move' && selection.length > 1 && selection.includes(layer.id) ? selection.slice() : [layer.id]
    // Snap marks: composition edges, the playhead, other clip edges and the time grid.
    const targets = [0, total, playhead]
    for (const item of store.layers) {
      if (groupIds.includes(item.id) || item.type === 'group') continue
      if (item.timeRange) {
        targets.push(Math.max(0, item.timeRange.startSec))
        if (Number.isFinite(item.timeRange.endSec)) targets.push(Math.min(total, item.timeRange.endSec))
      } else {
        targets.push(0, total)
      }
    }
    // A 1s grid up to 4 minutes, 5s beyond that, so short edits still land on seconds.
    const gridStep = total <= 240 ? 1 : total <= 900 ? 5 : 15
    for (let mark = gridStep; mark < total; mark += gridStep) targets.push(mark)
    const tolerance = snapEnabled ? 8 * secPerPx : 0
    store.beginHistoryGesture()
    const onMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) * secPerPx
      let start = origStart
      let end = origEnd
      let guide: number | null = null
      if (mode === 'start') {
        const snapped = snapTime(Math.max(0, Math.min(origEnd - 0.2, origStart + delta)), targets, tolerance)
        start = snapped.value
        guide = snapped.guide
      } else if (mode === 'end') {
        const snapped = snapTime(Math.max(origStart + 0.2, Math.min(total, origEnd + delta)), targets, tolerance)
        end = snapped.value
        guide = snapped.guide
      } else {
        const length = Math.max(0.2, origEnd - origStart)
        const snapped = snapTime(Math.max(0, Math.min(total - length, origStart + delta)), targets, tolerance)
        start = snapped.value
        end = start + length
        guide = snapped.guide
        if (guide === null) {
          const snappedEnd = snapTime(end, targets, tolerance)
          if (snappedEnd.guide !== null) {
            end = snappedEnd.value
            start = Math.max(0, end - length)
            guide = snappedEnd.guide
          }
        }
      }
      setSnapGuide(guide)
      const appliedDelta = start - origStart
      const layersNow = useSongNhacLayerStore.getState().layers
      if (mode !== 'move' || groupIds.length === 1) {
        const current = layersNow.find((item) => item.id === layer.id)
        const previous = current && current.type !== 'group' ? current.timeRange : undefined
        useSongNhacLayerStore.getState().updateLayer(layer.id, {
          timeRange: {
            startSec: Number(start.toFixed(3)),
            endSec: Number(end.toFixed(3)),
            fadeInSec: previous?.fadeInSec ?? 0,
            fadeOutSec: previous?.fadeOutSec ?? 0,
          },
        })
      } else {
        for (const id of groupIds) {
          const target = layersNow.find((item) => item.id === id)
          if (!target || target.type === 'group') continue
          const baseStart = target.timeRange ? Math.max(0, target.timeRange.startSec) : 0
          const baseEnd =
            target.timeRange && Number.isFinite(target.timeRange.endSec)
              ? Math.min(total, target.timeRange.endSec)
              : total
          const length = Math.max(0.2, baseEnd - baseStart)
          const nextStart = Math.max(0, Math.min(total - length, baseStart + appliedDelta))
          useSongNhacLayerStore.getState().updateLayer(id, {
            timeRange: {
              startSec: Number(nextStart.toFixed(3)),
              endSec: Number((nextStart + length).toFixed(3)),
              fadeInSec: target.timeRange?.fadeInSec ?? 0,
              fadeOutSec: target.timeRange?.fadeOutSec ?? 0,
            },
          })
        }
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      useSongNhacLayerStore.getState().endHistoryGesture()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  /** Drag a keyframe diamond along the timeline (snaps to the grid and other keys). */
  const beginKeyframeDrag = (
    event: React.PointerEvent<HTMLElement>,
    layer: StudioLayer,
    property: StudioAutomationProperty,
    keyframeTime: number,
  ) => {
    if (event.button !== 0) return
    const lane = (event.currentTarget as HTMLElement).closest('[data-lane]') as HTMLElement | null
    if (!lane) return
    event.preventDefault()
    event.stopPropagation()
    const rect = lane.getBoundingClientRect()
    const total = audioDuration > 0 ? audioDuration : 1
    const secPerPx = total / Math.max(1, rect.width)
    const startX = event.clientX
    const origin = keyframeTime
    const gridStep = total <= 240 ? 1 : total <= 900 ? 5 : 15
    const targets: number[] = [0, total, playhead]
    for (let mark = gridStep; mark < total; mark += gridStep) targets.push(mark)
    for (const automation of layer.automations ?? []) {
      for (const frame of automation.keyframes) targets.push(frame.timeSec)
    }
    const tolerance = snapEnabled ? 8 * secPerPx : 0
    const store = useSongNhacLayerStore.getState()
    store.beginHistoryGesture()
    let current = origin
    const onMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) * secPerPx
      const candidate = Math.max(0, Math.min(total, origin + delta))
      const snapped = snapTime(candidate, targets, tolerance)
      setSnapGuide(snapped.guide)
      if (Math.abs(snapped.value - current) < 0.001) return
      useSongNhacLayerStore.getState().moveKeyframe(layer.id, property, current, snapped.value)
      current = snapped.value
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setSnapGuide(null)
      useSongNhacLayerStore.getState().endHistoryGesture()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const seekToTime = (seconds: number) => {
    // Seeking must move the playhead even before audio is decoded: keyframe, lyric and
    // automation previews all read the clock, and they should not need playback.
    const limit = audioDuration > 0 ? audioDuration : Math.max(0, seconds)
    const next = Math.max(0, Math.min(limit, seconds))
    setPlayhead(next)
    useSongNhacLayerStore.getState().setCurrentTime(next)
    // A manual seek makes the element emit a stale timeupdate for the old position.
    seekGuardRef.current = performance.now()
    const audio = audioRef.current
    if (audio && audioDuration > 0 && audio.readyState > 0) audio.currentTime = next
  }

  const seekTo = (event: React.MouseEvent<HTMLDivElement>) => {    const audio = audioRef.current
    if (!audio || !audioDuration) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))
    const next = ratio * audioDuration
    audio.currentTime = next
    setPlayhead(next)
    useSongNhacLayerStore.getState().setCurrentTime(next)
  }

  /** Visualizers targeted by a preset: the selection when it has any, else the first. */
  const presetTargets = () => {
    const state = useSongNhacLayerStore.getState()
    const selected = state.layers.filter(
      (layer) => layer.type === 'visualizer' && state.selectedIds.includes(layer.id),
    )
    if (selected.length) return selected
    const first = state.layers.find((layer) => layer.type === 'visualizer')
    return first ? [first] : []
  }

  const applyVisualizerPatch = (patch: Record<string, unknown>) => {
    const targets = presetTargets()
    if (!targets.length) return false
    const state = useSongNhacLayerStore.getState()
    // One history entry for the whole multi-layer apply.
    state.pushHistorySnapshot(state.layers)
    for (const target of targets) state.updateLayer(target.id, patch as never)
    return true
  }

  const saveCurrentPreset = () => {
    const viz = useSongNhacLayerStore.getState().layers.find((layer) => layer.type === 'visualizer')
    if (!viz || viz.type !== 'visualizer') {
      setMessage('Chưa có lớp sóng để lưu preset.')
      return
    }
    // window.prompt() is disabled in Electron, so the name comes from the inline field.
    const name = presetName.trim() || `Preset ${userPresets.presets.length + 1}`
    useUserPresets.getState().save(name, {
      waveStyle: viz.waveStyle,
      colorMode: viz.colorMode,
      color1: viz.color1,
      color2: viz.color2,
      barCount: viz.barCount,
      barWidth: viz.barWidth,
      speed: viz.speed,
      opacity: viz.opacity,
      glowEnabled: viz.glowEnabled,
      glowIntensity: viz.glowIntensity,
      mirror: viz.mirror,
      sensitivity: viz.sensitivity,
    })
    setMessage(`Đã lưu preset: ${name}`)
  }

  const applyWavePreset = (presetId: string) => {
    const preset = WAVE_PRESETS.find((item) => item.id === presetId)
    if (!preset) return
    if (!applyVisualizerPatch(preset.visualizer as Record<string, unknown>)) {
      setMessage('Chưa có lớp sóng để áp preset.')
    }
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

  // Composition effects are global; push them into the live engine whenever they change.
  useEffect(() => {
    const engine = aveeEngineRef.current
    if (!engine) return
    engine.setEffects(effects)
    // The preview only renders while audio plays; redraw so a slider change is visible.
    if (!isPlaying) draw()
  }, [effects, isPlaying, draw])
  interface SongNhacProjectFile {
    app: 'song-nhac'
    version: number
    savedAt: string
    audioPath: string
    outputPath: string
    settings: Record<string, unknown>
    effects: Record<string, unknown>
    layers: unknown[]
  }

  const applyMediaItem = (kind: MediaKind, filePath: string) => {
    const name = filePath.split(/[\\/]/).pop() || 'Media'
    const store = useSongNhacLayerStore.getState()
    if (kind === 'audio') {
      setAudioPath(filePath)
      const audio = audioRef.current
      if (audio) {
        audio.src = localFileUrl(filePath)
        audio.load()
      }
      return
    }
    if (kind === 'video') store.addVideoLayer(name, localFileUrl(filePath))
    else store.addImageLayer(name, localFileUrl(filePath))
  }

  const addMediaFromDialog = async () => {
    const filters =
      mediaTab === 'image'
        ? [{ name: 'Ảnh', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
        : mediaTab === 'video'
          ? [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi'] }]
          : [{ name: 'Audio', extensions: ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg'] }]
    const picked = await window.api.dialog.openFile({ properties: ['openFile'], filters })
    const filePath = picked.filePaths?.[0]
    if (picked.canceled || !filePath) return
    useMediaLibrary.getState().add(mediaTab, filePath)
    applyMediaItem(mediaTab, filePath)
  }
  const searchLyricsOnline = async () => {
    const query = lyricQuery.trim()
    if (!query) {
      setLyricError('Nhập tên bài hát để tìm lời.')
      return
    }
    setLyricBusy(true)
    setLyricError('')
    try {
      const result = await window.api.songNhac.lyricsSearch(query)
      if (!result.success) {
        setLyricHits([])
        setLyricError(result.error || 'Tìm lời thất bại.')
        return
      }
      setLyricHits(result.hits ?? [])
      if (!(result.hits ?? []).length) setLyricError('Không tìm thấy lời cho từ khoá này.')
    } catch (error) {
      setLyricError(error instanceof Error ? error.message : String(error))
    } finally {
      setLyricBusy(false)
    }
  }

  const useLyricHit = (hit: LyricSearchHit) => {
    const text = hit.syncedLyrics?.trim() || hit.plainLyrics?.trim() || ''
    if (!text) {
      setLyricError('Bài này không có lời kèm theo.')
      return
    }
    setLyricsText(text)
    setLyricError('')
    setMessage(`Đã nạp lời: ${hit.trackName} — ${hit.artistName}`)
  }
  const createLyricsLayer = () => {
    const lines = parseLyrics(lyricsText, audioDuration)
    if (!lines.length) {
      setMessage('Chưa có lời để tạo lớp lyric.')
      return
    }
    useSongNhacLayerStore.getState().addLyricsLayer('Lyrics', lines)
    setLeftTab('composition')
    setMessage(`Đã tạo lớp lyric với ${lines.length} dòng.`)
  }
  const buildProjectPayload = (): SongNhacProjectFile => ({
    app: 'song-nhac',
    version: 2,
    savedAt: new Date().toISOString(),
    audioPath,
    outputPath,
    settings: {
      style,
      theme,
      intensity,
      showParticles,
      showLogo,
      exportWidth,
      exportHeight,
      exportFps,
      exportCodec,
      bitrateTier,
    },
    effects: {
      blur: effects.blur,
      alpha: effects.alpha,
      tint: effects.tint,
      tintStrength: effects.tintStrength,
      shake: effects.shake,
      mirror: effects.mirror,
      zoom: effects.zoom,
      fxaa: effects.fxaa,
      blurMode: effects.blurMode,
    },
    layers,
  })

  const applyProjectData = (data: SongNhacProjectFile): boolean => {
    if (data.app !== 'song-nhac' || !Array.isArray(data.layers)) return false
    useSongNhacLayerStore.getState().applyTemplateLayers(data.layers as never)
    const settings = data.settings ?? {}
    if (typeof settings.style === 'string') setStyle(settings.style as SongNhacStyle)
    if (typeof settings.theme === 'string') setTheme(settings.theme as AveeColorTheme)
    if (typeof settings.intensity === 'number') setIntensity(settings.intensity)
    if (typeof settings.showParticles === 'boolean') setShowParticles(settings.showParticles)
    if (typeof settings.showLogo === 'boolean') setShowLogo(settings.showLogo)
    if (typeof settings.exportWidth === 'number') setExportWidth(settings.exportWidth)
    if (typeof settings.exportHeight === 'number') setExportHeight(settings.exportHeight)
    if (typeof settings.exportFps === 'number') setExportFps(settings.exportFps)
    if (settings.exportCodec === 'h264' || settings.exportCodec === 'hevc') setExportCodec(settings.exportCodec)
    if (settings.bitrateTier === 'high' || settings.bitrateTier === 'balanced' || settings.bitrateTier === 'light') {
      setBitrateTier(settings.bitrateTier)
    }
    if (data.effects) useCompositionEffects.setState(data.effects as never)
    if (data.outputPath) setOutputPath(data.outputPath)
    if (data.audioPath) {
      setAudioPath(data.audioPath)
      const audio = audioRef.current
      if (audio) {
        audio.src = localFileUrl(data.audioPath)
        audio.load()
      }
    }
    return true
  }

  const saveProject = async () => {
    try {
      const picked = await window.api.dialog.saveProjectFile(`song-nhac-${new Date().toISOString().slice(0, 10)}.json`)
      if (picked.canceled || !picked.filePath) return
      const result = await window.api.songNhac.projectSave(
        picked.filePath,
        JSON.stringify(buildProjectPayload(), null, 2),
      )
      if (result.success) {
        useProjectHistory.getState().remember(picked.filePath, picked.filePath.split(/[\\/]/).pop() || 'Project')
        useProjectHistory.getState().clearDraft()
        setMessage(`Đã lưu project: ${picked.filePath}`)
      } else {
        setMessage(result.error || 'Lưu project thất bại.')
      }
    } catch (error) {
      setMessage(`Lưu project lỗi: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const openProject = async () => {
    try {
      const picked = await window.api.dialog.openFile({
        title: 'Mở project Sóng nhạc',
        properties: ['openFile'],
        filters: [{ name: 'Song Nhac Project', extensions: ['json'] }],
      })
      const filePath = picked.filePaths?.[0]
      if (picked.canceled || !filePath) return
      const result = await window.api.songNhac.projectOpen(filePath)
      if (!result.success || !result.data) {
        setMessage(result.error || 'Mở project thất bại.')
        return
      }
      const data = JSON.parse(result.data) as SongNhacProjectFile
      if (!applyProjectData(data)) {
        setMessage('File này không phải project Sóng nhạc.')
        return
      }
      useProjectHistory.getState().remember(filePath, filePath.split(/[\\/]/).pop() || 'Project')
      setMessage(`Đã mở project: ${filePath}`)
    } catch (error) {
      setMessage(`Mở project lỗi: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const openRecentProject = async (filePath: string) => {
    try {
      const result = await window.api.songNhac.projectOpen(filePath)
      if (!result.success || !result.data) {
        setMessage(result.error || 'Mở project thất bại.')
        return
      }
      if (!applyProjectData(JSON.parse(result.data) as SongNhacProjectFile)) {
        setMessage('File này không phải project Sóng nhạc.')
        return
      }
      useProjectHistory.getState().remember(filePath, filePath.split(/[\\/]/).pop() || 'Project')
      setMessage(`Đã mở project: ${filePath}`)
    } catch (error) {
      setMessage(`Mở project lỗi: ${error instanceof Error ? error.message : String(error)}`)
    }
  }



  // Real rendered preview per preset (cached per theme in localStorage).
  useEffect(() => {
    let cancelled = false
    renderPresetThumbnails(theme)
      .then((map) => {
        if (!cancelled) setPresetThumbs(map)
      })
      .catch(() => {
        // Thumbnails are cosmetic: a failure leaves the colour swatches in place.
      })
    return () => {
      cancelled = true
    }
  }, [theme])
  // Thumbnails for the presets the user saved (regenerated when the list changes).
  useEffect(() => {
    if (!userPresets.presets.length) {
      setUserPresetThumbs({})
      return
    }
    let cancelled = false
    renderUserPresetThumbnails(
      userPresets.presets.map((preset) => ({ id: preset.id, visualizer: preset.visualizer as Record<string, unknown> })),
      theme,
    )
      .then((map) => {
        if (!cancelled) setUserPresetThumbs(map)
      })
      .catch(() => {
        // Cosmetic only: the colour swatch stays when rendering fails.
      })
    return () => {
      cancelled = true
    }
  }, [userPresets.presets, theme])

  // Autosave draft: a crash or a closed window never loses the whole edit.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        useProjectHistory.getState().setDraft(JSON.stringify(buildProjectPayload()))
      } catch {
        // Dragging a slider can exceed the storage quota; ignore.
      }
    }, 1200)
    return () => clearTimeout(timer)
  }, [
    layers,
    effects,
    style,
    theme,
    intensity,
    showParticles,
    showLogo,
    exportWidth,
    exportHeight,
    exportFps,
    exportCodec,
    bitrateTier,
    audioPath,
    outputPath,
  ])

  // Restore the autosaved draft once, on first mount.
  const draftRestoredRef = useRef(false)
  useEffect(() => {
    if (draftRestoredRef.current) return
    draftRestoredRef.current = true
    const draft = useProjectHistory.getState().draft
    if (!draft) return
    try {
      const data = JSON.parse(draft.json) as SongNhacProjectFile
      if (applyProjectData(data)) {
        setMessage(`Đã khôi phục bản nháp lúc ${new Date(draft.savedAt).toLocaleTimeString()}`)
      }
    } catch {
      // Corrupt draft: ignore it.
    }
  }, [])

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

  const buildJobSnapshot = () => ({
    width: exportWidth,
    height: exportHeight,
    fps: exportFps,
    codec: exportCodec,
    bitrateTier,
    theme,
    intensity,
    layers: layers.map((layer) => JSON.parse(JSON.stringify(layer)) as (typeof layers)[number]),
    effects: {
      blur: effects.blur,
      alpha: effects.alpha,
      tint: effects.tint,
      tintStrength: effects.tintStrength,
      shake: effects.shake,
      mirror: effects.mirror,
      zoom: effects.zoom,
      fxaa: effects.fxaa,
      blurMode: effects.blurMode,
    },
    // Batch/jobs inherit the export range so a section can be rendered too.
    rangeStartSec: typeof rangeStart === 'number' ? rangeStart : undefined,
    rangeEndSec: typeof rangeEnd === 'number' ? rangeEnd : undefined,
  })

  const enqueueCurrentJob = async () => {
    if (!audioPath) {
      setMessage('Chưa chọn file nhạc để xếp hàng đợi.')
      return
    }
    let target = outputPath
    if (!target) {
      const picked = await window.api.dialog.saveVideoFile(`song-nhac-${Date.now()}.mp4`)
      if (picked.canceled || !picked.filePath) return
      target = picked.filePath
      setOutputPath(target)
    }
    const name = target.split(/[\\/]/).pop() || 'Video'
    useExportQueue.getState().enqueue({ name, audioPath, outputPath: target, snapshot: buildJobSnapshot() })
    setMessage(`Đã thêm vào hàng đợi: ${name}`)
  }

  /**
   * Batch export: pick any number of tracks and one output folder, then queue one job per
   * track using the current project as the template.
   */
  /** Queues one job per track, using the current project as the template. */
  const enqueueBatchFiles = (files: string[], folder: string) => {
    const snapshot = buildJobSnapshot()
    const separator = folder.includes('\\') ? '\\' : '/'
    let added = 0
    for (const file of files) {
      const base = (file.split(/[\\/]/).pop() || 'track').replace(/\.[^.]+$/, '')
      const outputPath = `${folder}${folder.endsWith(separator) ? '' : separator}${base}.mp4`
      useExportQueue.getState().enqueue({ name: `${base}.mp4`, audioPath: file, outputPath, snapshot })
      added += 1
    }
    setMessage(`Đã thêm ${added} bài vào hàng đợi (thư mục: ${folder}).`)
    return added
  }

  const enqueueBatch = async () => {
    const files = await window.api.selectAudioFilesMulti()
    if (!files?.length) return
    const folder = await window.api.selectFolder()
    if (!folder) return
    enqueueBatchFiles(files, folder)
  }

  const runQueuedJob = async (job: ExportJob) => {
    const queue = useExportQueue.getState()
    queue.update(job.id, { status: 'running', progress: 0, message: 'Đang xuất…' })
    const requestId = crypto.randomUUID()
    exportRequestIdRef.current = requestId
    setIsExporting(true)
    const controller = new AbortController()
    exportAbortRef.current = controller
    exportModeRef.current = 'frames'
    try {
      const result = await exportSongNhacFrames({
        requestId,
        audioPath: job.audioPath,
        outputPath: job.outputPath,
        width: job.snapshot.width,
        height: job.snapshot.height,
        fps: job.snapshot.fps,
        codec: job.snapshot.codec,
        bitrateTier: job.snapshot.bitrateTier,
        theme: job.snapshot.theme as AveeColorTheme,
        intensity: job.snapshot.intensity,
        quality: 'balanced',
        seed: 93,
        layers: job.snapshot.layers,
        effects: job.snapshot.effects,
        rangeStartSec: job.snapshot.rangeStartSec,
        rangeEndSec: job.snapshot.rangeEndSec,
        signal: controller.signal,
        onProgress: (percent) => {
          useExportQueue.getState().update(job.id, { progress: percent })
          setProgress({ requestId, percent, timeSec: 0, totalSec: 0 })
        },
      })
      if (controller.signal.aborted) {
        useExportQueue.getState().update(job.id, { status: 'canceled', message: 'Đã huỷ.' })
      } else {
        useExportQueue.getState().update(job.id, {
          status: result.success ? 'done' : 'error',
          progress: result.success ? 100 : 0,
          message: result.success ? result.outputPath : result.error || 'Xuất thất bại.',
        })
        setMessage(result.success ? `Xuất xong: ${result.outputPath}` : result.error || 'Xuất thất bại.')
      }
    } catch (error) {
      useExportQueue.getState().update(job.id, {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      exportModeRef.current = null
      exportAbortRef.current = null
      setIsExporting(false)
      setProgress(null)
    }
  }

  const cancelQueuedJob = async (job: ExportJob) => {
    if (job.status === 'running') {
      exportAbortRef.current?.abort()
      await window.api.songNhac.framesCancel(exportRequestIdRef.current ?? '')
    }
    useExportQueue.getState().update(job.id, { status: 'canceled', message: 'Đã huỷ.' })
  }

  useEffect(() => {
    if (isExporting) return
    const next = useExportQueue.getState().nextPending()
    if (!next) return
    // The main process finishes the mux a moment after the last frame; starting the next
    // job immediately would be rejected with "export already running".
    const timer = setTimeout(() => {
      void runQueuedJob(next)
    }, 1500)
    return () => clearTimeout(timer)
  }, [queueJobs, isExporting])
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

  // Editor keyboard shortcuts. Typing in a field must never trigger them.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      // The keep-alive router keeps this page mounted while hidden.
      if (!window.location.hash.includes('/music/song-nhac')) return
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return
      const mod = event.ctrlKey || event.metaKey
      const store = useSongNhacLayerStore.getState()

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (mod && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
        event.preventDefault()
        store.redo()
        return
      }
      if (mod && event.key.toLowerCase() === 'c') {
        if (!store.selectedIds.length) return
        event.preventDefault()
        store.copySelectedLayers()
        setMessage(`Đã sao chép ${store.selectedIds.length} lớp.`)
        return
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'v') {
        ;(window as unknown as Record<string, unknown>).__branch = 'shift-v'
        event.preventDefault()
        store.pasteLayersAt(store.currentTimeSec)
        setMessage(`Đã dán tại ${store.currentTimeSec.toFixed(2)}s.`)
        return
      }
      if (mod && event.key.toLowerCase() === 'v') {
        ;(window as unknown as Record<string, unknown>).__branch = 'plain-v'
        event.preventDefault()
        store.pasteLayers()
        setMessage('Đã dán lớp.')
        return
      }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        store.duplicateSelectedLayers()
        return
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveProject()
        return
      }
      if (event.key === 'Escape') {
        store.setSelection(null)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!store.selectedIds.length) return
        event.preventDefault()
        for (const id of store.selectedIds.slice()) store.removeLayer(id)
        return
      }
      if (event.key === ' ') {
        event.preventDefault()
        void togglePlay()
        return
      }
      if (!mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        setSnapEnabled((value) => !value)
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const step = (event.shiftKey ? 5 : 1) * (event.key === 'ArrowLeft' ? -1 : 1)
        // Read the clock from the store: the effect closure would hold a stale playhead.
        seekToTime(useSongNhacLayerStore.getState().currentTimeSec + step)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveProject, togglePlay])
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
            {LEFT_TITLES[leftTab] ?? 'COMPOSITION'}
          </div>
          {leftTab === 'composition' && <LayersPanel onChoosePreset={() => setLeftTab('presets')} />}
          {leftTab === 'media' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#cbd5e1' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {([
                  { key: 'image', label: 'Ảnh' },
                  { key: 'video', label: 'Video' },
                  { key: 'audio', label: 'Audio' },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setMediaTab(tab.key)}
                    style={{
                      flex: 1,
                      padding: '5px 0',
                      borderRadius: 6,
                      border: `1px solid ${mediaTab === tab.key ? '#0ea5e9' : '#1e293b'}`,
                      background: mediaTab === tab.key ? '#0c4a6e' : '#0f172a',
                      color: mediaTab === tab.key ? '#e0f2fe' : '#94a3b8',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={addMediaFromDialog} style={projectButtonStyle}>
                Thêm file…
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(mediaLibrary[mediaTab] ?? []).map((item) => (
                  <div
                    key={item.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '5px 7px',
                      borderRadius: 6,
                      border: '1px solid #1e293b',
                      background: '#0f172a',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => applyMediaItem(mediaTab, item.path)}
                      title={item.path}
                      style={{
                        flex: 1,
                        textAlign: 'left',
                        background: 'transparent',
                        border: 'none',
                        color: '#cbd5e1',
                        fontSize: 11,
                        cursor: 'pointer',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => useMediaLibrary.getState().remove(mediaTab, item.path)}
                      title="Xoá khỏi thư viện"
                      style={{ ...miniIconStyle, color: '#fca5a5' }}
                    >
                      x
                    </button>
                  </div>
                ))}
                {(mediaLibrary[mediaTab] ?? []).length === 0 && (
                  <div style={{ fontSize: 11, color: '#475569' }}>Chưa có file nào. Bấm "Thêm file…" để nạp.</div>
                )}
              </div>
            </div>
          )}
          {leftTab === 'lyrics' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#cbd5e1' }}>
              <div style={{ color: '#94a3b8', lineHeight: 1.5 }}>
                Dán lời (mỗi dòng một câu). Có timestamp LRC <code>[00:12.34]</code> thì dùng luôn, không thì tự chia đều theo độ dài nhạc.
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={lyricQuery}
                  onChange={(event) => setLyricQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void searchLyricsOnline()
                  }}
                  placeholder="Tìm lời trên LRCLIB (tên bài)"
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: '1px solid #334155',
                    background: '#0f172a',
                    color: '#e2e8f0',
                    fontSize: 11,
                  }}
                />
                <button
                  type="button"
                  onClick={searchLyricsOnline}
                  disabled={lyricBusy}
                  style={{ ...projectButtonStyle, padding: '6px 10px', opacity: lyricBusy ? 0.6 : 1 }}
                >
                  {lyricBusy ? 'Đang tìm…' : 'Tìm'}
                </button>
              </div>
              {lyricError && <div style={{ fontSize: 11, color: '#fca5a5' }}>{lyricError}</div>}
              {lyricHits.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 170, overflowY: 'auto' }}>
                  {lyricHits.map((hit) => (
                    <button
                      key={hit.id}
                      type="button"
                      onClick={() => useLyricHit(hit)}
                      title={hit.albumName || ''}
                      style={{
                        textAlign: 'left',
                        padding: '5px 7px',
                        borderRadius: 6,
                        border: '1px solid #1e293b',
                        background: '#0f172a',
                        color: '#cbd5e1',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ color: '#e2e8f0' }}>{hit.trackName}</div>
                      <div style={{ color: '#64748b' }}>
                        {hit.artistName}
                        {hit.syncedLyrics ? ' · có timestamp' : ' · chỉ lời thường'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <textarea
                value={lyricsText}
                onChange={(event) => setLyricsText(event.target.value)}
                placeholder={'[00:12.00] Câu đầu tiên\n[00:16.50] Câu thứ hai\n\nhoặc dán lời thường, không cần timestamp'}
                style={{
                  minHeight: 160,
                  resize: 'vertical',
                  padding: 8,
                  borderRadius: 8,
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  fontSize: 12,
                  fontFamily: 'inherit',
                }}
              />
              <button type="button" onClick={createLyricsLayer} style={projectButtonStyle}>
                Tạo lớp lyric
              </button>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                {parseLyrics(lyricsText, audioDuration).length} dòng
              </div>
            </div>
          )}
          {leftTab === 'project' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#cbd5e1' }}>
              <div style={{ color: '#94a3b8', lineHeight: 1.5 }}>
                Lưu toàn bộ lớp, keyframe, hiệu ứng và cài đặt xuất vào một file .json để mở lại sau.
              <div style={{ marginTop: 2, padding: 7, borderRadius: 8, background: '#0f172a', border: '1px solid #1e293b', fontSize: 11, color: '#94a3b8', lineHeight: 1.7 }}>
                <div style={{ fontSize: 10, letterSpacing: 0.5, color: '#475569', marginBottom: 2 }}>PHÍM TẮT</div>
                <div>Space — phát / dừng</div>
                <div>← → — tua 1s (Shift: 5s)</div>
                <div>Ctrl+D — nhân bản lớp</div>
                <div>Delete — xoá lớp đang chọn</div>
                <div>Ctrl+Z / Ctrl+Shift+Z — hoàn tác / làm lại</div>
                <div>S — bật/tắt bắt dính (snap)</div>
                <div>Ctrl+S — lưu project</div>
              </div>
              </div>
              <button type="button" onClick={saveProject} style={projectButtonStyle}>
                Lưu project (.json)
              </button>
              <button type="button" onClick={openProject} style={projectButtonStyle}>
                Mở project (.json)
              </button>
              <div style={{ marginTop: 4, fontSize: 11, color: '#64748b' }}>
                Bản nháp tự lưu: {projectHistory.draft ? new Date(projectHistory.draft.savedAt).toLocaleTimeString() : 'chưa có'}
              </div>
              <div style={{ marginTop: 6, fontSize: 10, letterSpacing: 0.5, color: '#475569' }}>GẦN ĐÂY</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {projectHistory.recents.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => openRecentProject(item.path)}
                    title={item.path}
                    style={{
                      textAlign: 'left',
                      padding: '5px 7px',
                      borderRadius: 6,
                      border: '1px solid #1e293b',
                      background: '#0f172a',
                      color: '#cbd5e1',
                      fontSize: 11,
                      cursor: 'pointer',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.name}
                  </button>
                ))}
                {projectHistory.recents.length === 0 && (
                  <div style={{ fontSize: 11, color: '#475569' }}>Chưa mở project nào.</div>
                )}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
                {layers.length} lớp · {tracks.reduce((sum, layer) => sum + (layer.automations ?? []).reduce((count, item) => count + item.keyframes.length, 0), 0)} keyframe
              </div>
            </div>
          )}
          {leftTab === 'analyzer' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#cbd5e1' }}>
              {tracks.map((layer) => {
                const analyzer = layer.analyzer ?? { bandStart: 0, bandEnd: 1, sensitivity: 1, smoothing: 0.35 }
                return (
                  <button
                    key={layer.id}
                    type="button"
                    onClick={() => useSongNhacLayerStore.getState().setSelection(layer.id)}
                    style={{
                      textAlign: 'left',
                      padding: 8,
                      borderRadius: 8,
                      border: '1px solid #1e293b',
                      background: '#0f172a',
                      color: '#cbd5e1',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ marginBottom: 6 }}>{layer.name}</div>
                    <div style={{ position: 'relative', height: 10, background: '#020617', borderRadius: 5, overflow: 'hidden' }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: `${analyzer.bandStart * 100}%`,
                          width: `${Math.max(2, (analyzer.bandEnd - analyzer.bandStart) * 100)}%`,
                          top: 0,
                          bottom: 0,
                          background: 'linear-gradient(90deg, #22d3ee, #f472b6)',
                        }}
                      />
                    </div>
                    <div style={{ marginTop: 4, color: '#64748b' }}>
                      {Math.round(analyzer.bandStart * 100)}–{Math.round(analyzer.bandEnd * 100)}% · nhạy {analyzer.sensitivity.toFixed(2)}x · mượt {Math.round(analyzer.smoothing * 100)}%
                    </div>
                  </button>
                )
              })}
              {tickMarks.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <div style={{ width: 124, fontSize: 9, letterSpacing: 0.5, color: '#475569' }}>TIMELINE</div>
              <div style={{ position: 'relative', flex: 1, height: 14 }}>
                {tickMarks.map((tick) => (
                  <div
                    key={tick}
                    style={{
                      position: 'absolute',
                      left: `${Math.min(100, (tick / audioDuration) * 100)}%`,
                      top: 0,
                      transform: 'translateX(-50%)',
                      fontSize: 9,
                      color: '#64748b',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatClock(tick)}
                  </div>
                ))}
              </div>
            </div>
          )}
          {tracks.length === 0 && <div style={{ color: '#475569' }}>Chưa có lớp nào.</div>}
            </div>
          )}
          {leftTab === 'effects' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: '#cbd5e1' }}>
              {([
                { key: 'blur', label: 'Mờ toàn khung', min: 0, max: 1, step: 0.01, format: (value: number) => `${Math.round(value * 100)}%` },
                { key: 'alpha', label: 'Độ đậm', min: 0, max: 1, step: 0.01, format: (value: number) => `${Math.round(value * 100)}%` },
                { key: 'tintStrength', label: 'Pha màu', min: 0, max: 1, step: 0.01, format: (value: number) => `${Math.round(value * 100)}%` },
                { key: 'shake', label: 'Rung theo beat', min: 0, max: 1, step: 0.01, format: (value: number) => `${Math.round(value * 100)}%` },
                { key: 'zoom', label: 'Thu phóng', min: 0.6, max: 1.6, step: 0.01, format: (value: number) => `${value.toFixed(2)}x` },
              ] as const).map((item) => (
                <label key={item.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{item.label}</span>
                    <span style={{ color: '#94a3b8' }}>{item.format(effects[item.key] as number)}</span>
                  </span>
                  <input
                    type="range"
                    min={item.min}
                    max={item.max}
                    step={item.step}
                    value={effects[item.key] as number}
                    onChange={(event) => effects.setEffect(item.key, Number(event.target.value) as never)}
                    style={{ width: '100%' }}
                  />
                </label>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Màu pha</span>
                <input
                  type="color"
                  value={effects.tint}
                  onChange={(event) => effects.setEffect('tint', event.target.value)}
                  style={{ flex: 1, height: 26, background: 'transparent', border: '1px solid #334155', borderRadius: 6 }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={effects.mirror} onChange={(event) => effects.setEffect('mirror', event.target.checked)} style={{ accentColor: '#0ea5e9' }} />
                Lật ngang toàn khung
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={effects.fxaa} onChange={(event) => effects.setEffect('fxaa', event.target.checked)} style={{ accentColor: '#0ea5e9' }} />
                Khử răng cưa (FXAA)
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Kiểu làm mờ</span>
                <select
                  value={effects.blurMode}
                  onChange={(event) => effects.setEffect('blurMode', event.target.value as 'fast' | 'two-pass')}
                  style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 12 }}
                >
                  <option value="fast">Nhanh (1 pass)</option>
                  <option value="two-pass">Hai pass (mượt hơn)</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => effects.reset()}
                style={{ marginTop: 4, padding: '6px 10px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#cbd5e1', fontSize: 12, cursor: 'pointer' }}
              >
                Đặt lại hiệu ứng
              </button>
            </div>
          )}
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
                      background: presetThumbs[preset.id]
                        ? `url(${presetThumbs[preset.id]}) center / cover no-repeat`
                        : `linear-gradient(135deg, ${preset.visualizer.color1 ?? '#22d3ee'}, ${preset.visualizer.color2 ?? '#f472b6'})`,
                    }}
                  />
                  {preset.name}
                </button>
              ))}
            </div>
          )}
          {leftTab === 'presets' && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 10, letterSpacing: 0.5, color: '#475569' }}>PRESET CỦA TÔI</div>
              <input
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                placeholder={`Preset ${userPresets.presets.length + 1}`}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  fontSize: 11,
                }}
              />
              <button type="button" onClick={saveCurrentPreset} style={projectButtonStyle}>
                Lưu preset hiện tại
              </button>
              {userPresets.presets.map((preset) => (
                <div key={preset.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => applyVisualizerPatch(preset.visualizer)}
                    title="Áp preset này cho lớp sóng"
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid #1e293b',
                      background: '#0f172a',
                      color: '#cbd5e1',
                      fontSize: 11,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      overflow: 'hidden',
                    }}
                  >
                    <span
                      style={{
                        width: 26,
                        height: 16,
                        borderRadius: 3,
                        flexShrink: 0,
                        background: userPresetThumbs[preset.id]
                          ? `url(${userPresetThumbs[preset.id]}) center / cover no-repeat`
                          : `linear-gradient(135deg, ${preset.visualizer.color1 ?? '#22d3ee'}, ${preset.visualizer.color2 ?? '#f472b6'})`,
                      }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {preset.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => useUserPresets.getState().remove(preset.id)}
                    title="Xoá preset"
                    style={{ ...miniIconStyle, color: '#fca5a5' }}
                  >
                    x
                  </button>
                </div>
              ))}
              {userPresets.presets.length === 0 && (
                <div style={{ fontSize: 11, color: '#475569' }}>Chưa có preset tự tạo.</div>
              )}
            </div>
          )}
          {leftTab === 'export' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
              <div>
                Cài đặt xuất nằm ở cột bên phải: độ phân giải, FPS, codec, chất lượng và khoảng thời gian.
              </div>
              <button type="button" onClick={enqueueCurrentJob} style={projectButtonStyle}>
                Thêm vào hàng đợi
              </button>
              <button type="button" onClick={enqueueBatch} style={projectButtonStyle}>
                Xuất hàng loạt (nhiều bài)…
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {queueJobs.map((job) => (
                  <div
                    key={job.id}
                    style={{
                      padding: 7,
                      borderRadius: 8,
                      border: '1px solid #1e293b',
                      background: '#0f172a',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          flex: 1,
                          color: '#e2e8f0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={job.outputPath}
                      >
                        {job.name}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 999,
                          background:
                            job.status === 'done'
                              ? '#14532d'
                              : job.status === 'error'
                                ? '#7f1d1d'
                                : job.status === 'running'
                                  ? '#0c4a6e'
                                  : job.status === 'canceled'
                                    ? '#3f3f46'
                                    : '#1e293b',
                          color: '#e2e8f0',
                        }}
                      >
                        {job.status === 'pending'
                          ? 'chờ'
                          : job.status === 'running'
                            ? `${Math.round(job.progress)}%`
                            : job.status === 'done'
                              ? 'xong'
                              : job.status === 'canceled'
                                ? 'huỷ'
                                : 'lỗi'}
                      </span>
                      {job.status === 'running' && (
                        <button type="button" onClick={() => cancelQueuedJob(job)} style={miniIconStyle}>
                          dừng
                        </button>
                      )}
                      {(job.status === 'pending' || job.status === 'running' || job.status === 'canceled') && (
                        <button
                          type="button"
                          onClick={() => useExportQueue.getState().remove(job.id)}
                          style={miniIconStyle}
                        >
                          x
                        </button>
                      )}
                    </div>
                    {job.status === 'running' && (
                      <div style={{ height: 4, background: '#020617', borderRadius: 2, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${Math.max(2, Math.min(100, job.progress))}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, #22d3ee, #f472b6)',
                          }}
                        />
                      </div>
                    )}
                    {job.message && (
                      <div style={{ fontSize: 10, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {job.message}
                      </div>
                    )}
                  </div>
                ))}
                {queueJobs.length === 0 && <div style={{ fontSize: 11, color: '#475569' }}>Hàng đợi trống.</div>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => useExportQueue.getState().undo()}
                  disabled={!useExportQueue.getState().canUndo()}
                  style={{ ...projectButtonStyle, flex: 1, opacity: useExportQueue.getState().canUndo() ? 1 : 0.45 }}
                >
                  Hoàn tác
                </button>
                <button
                  type="button"
                  onClick={() => useExportQueue.getState().redo()}
                  disabled={!useExportQueue.getState().canRedo()}
                  style={{ ...projectButtonStyle, flex: 1, opacity: useExportQueue.getState().canRedo() ? 1 : 0.45 }}
                >
                  Làm lại
                </button>
              </div>
              {queueJobs.some((job) => job.status === 'done' || job.status === 'error') && (
                <button
                  type="button"
                  onClick={() => useExportQueue.getState().clearFinished()}
                  style={projectButtonStyle}
                >
                  Xoá việc đã xong
                </button>
              )}
            </div>
          )}
        </aside>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, letterSpacing: 0.8, color: '#64748b', fontWeight: 700 }}>PREVIEW</span>
            <span style={{ fontSize: 10, color: '#475569' }}>Kéo trên khung để di chuyển · Shift+kéo để xoay · lăn chuột để thu phóng</span>
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
          <div
            style={{ position: 'relative', width: '100%' }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={handleDrop}
          >
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
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime
              setPlayhead(time)
              // Ignore the stale update the element fires right after a manual seek.
              if (performance.now() - seekGuardRef.current < 450) return
              useSongNhacLayerStore.getState().setCurrentTime(time)
            }}
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
                {WAVE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyWavePreset(preset.id)}
                    title={`${preset.name} — ${preset.description}`}
                    style={{
                      padding: 0,
                      width: '100%',
                      aspectRatio: '1 / 1',
                      borderRadius: 8,
                      border: '1px solid #1e293b',
                      background: presetThumbs[preset.id]
                          ? `url(${presetThumbs[preset.id]}) center / cover no-repeat`
                          : `linear-gradient(135deg, ${preset.visualizer.color1 ?? '#22d3ee'}, ${preset.visualizer.color2 ?? '#f472b6'})`,
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                {WAVE_PRESETS.length} preset · bấm để áp vào lớp sóng đang chọn
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11, color: '#94a3b8' }}>
          <button
            type="button"
            onClick={() => setTimelineZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))))}
            title="Thu nhỏ timeline"
            style={{ width: 24, height: 22, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#cbd5e1', cursor: 'pointer' }}
          >
            -
          </button>
          <span style={{ fontFamily: 'monospace', minWidth: 34 }}>{timelineZoom.toFixed(2)}x</span>
          <button
            type="button"
            onClick={() => setTimelineZoom((value) => Math.min(8, Number((value + 0.25).toFixed(2))))}
            title="Phóng to timeline"
            style={{ width: 24, height: 22, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#cbd5e1', cursor: 'pointer' }}
          >
            +
          </button>
          <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{formatClock(playhead)} / {formatClock(audioDuration)}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '0 auto' }}>
            <button type="button" onClick={() => seekToTime(0)} disabled={!audioPath} style={transportStyle}>
              |&lt;
            </button>
            <button type="button" onClick={() => seekToTime(playhead - 5)} disabled={!audioPath} style={transportStyle}>
              &lt;&lt;
            </button>
            <button
              type="button"
              onClick={togglePlay}
              disabled={!audioPath}
              style={{
                padding: '3px 14px',
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
            <button type="button" onClick={() => seekToTime(playhead + 5)} disabled={!audioPath} style={transportStyle}>
              &gt;&gt;
            </button>
            <button type="button" onClick={() => seekToTime(audioDuration)} disabled={!audioPath} style={transportStyle}>
              &gt;|
            </button>
          </span>
          <span style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tracks.length} lớp · {audioPath ? audioPath.split(/[\\/]/).pop() : 'chưa chọn audio'}
          </span>
        </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
        <div style={{ position: 'relative', paddingLeft: 132, width: `${timelineZoom * 100}%`, minWidth: '100%' }}>
          {waveformUrl && (
            <div
              onClick={seekTo}
              style={{
                height: 54,
                marginBottom: 6,
                background: '#0f172a',
                border: '1px solid #1e293b',
                borderRadius: 6,
                overflow: 'hidden',
                cursor: audioDuration > 0 ? 'pointer' : 'default',
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
            {snapGuide !== null && audioDuration > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: `${Math.max(0, Math.min(100, (snapGuide / audioDuration) * 100))}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: '#fbbf24',
                  boxShadow: '0 0 6px #fbbf24',
                }}
              />
            )}
          </div>

          {tickMarks.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <div style={{ width: 124, fontSize: 9, letterSpacing: 0.5, color: '#475569' }}>TIMELINE</div>
              <div style={{ position: 'relative', flex: 1, height: 14 }}>
                {tickMarks.map((tick) => (
                  <div
                    key={tick}
                    style={{
                      position: 'absolute',
                      left: `${Math.min(100, (tick / audioDuration) * 100)}%`,
                      top: 0,
                      transform: 'translateX(-50%)',
                      fontSize: 9,
                      color: '#64748b',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatClock(tick)}
                  </div>
                ))}
              </div>
            </div>
          )}
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
                <div
                  data-lane
                  style={{
                    position: 'relative',
                    flex: 1,
                    height: 18,
                    background: '#0f172a',
                    borderRadius: 4,
                    border: '1px solid #1e293b',
                  }}
                >
                  <div
                    onPointerDown={(event) => {
                      // Right-click must reach onContextMenu instead of starting a drag.
                      if (event.button !== 0) return
                      const store = useSongNhacLayerStore.getState()
                      const already = store.selectedIds.includes(layer.id)
                      if (!already) {
                        store.setSelection(layer.id, { ctrlKey: event.ctrlKey || event.metaKey, shiftKey: event.shiftKey })
                      }
                      beginClipDrag(event, layer, 'move')
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      useSongNhacLayerStore.getState().setSelection(layer.id)
                      setClipMenu({ x: event.clientX, y: event.clientY, layerId: layer.id })
                    }}
                    title={`${formatClock(start)} → ${formatClock(end)} (kéo để dời, kéo mép để đổi độ dài)`}
                    style={{
                      position: 'absolute',
                      left: `${left}%`,
                      width: `${width}%`,
                      top: 0,
                      bottom: 0,
                      borderRadius: 4,
                      background: TRACK_COLORS[layer.type] ?? '#64748b',
                      opacity: layer.visible ? 0.85 : 0.3,
                      cursor: 'grab',
                      boxShadow: selectedIds.includes(layer.id) ? '0 0 0 1px #38bdf8 inset' : undefined,
                    }}
                  />
                  <div
                    onPointerDown={(event) => beginClipDrag(event, layer, 'start')}
                    style={{
                      position: 'absolute',
                      left: `calc(${left}% - 3px)`,
                      width: 7,
                      top: 0,
                      bottom: 0,
                      cursor: 'ew-resize',
                      borderRadius: 3,
                      background: 'rgba(226, 232, 240, 0.55)',
                    }}
                  />
                  <div
                    onPointerDown={(event) => beginClipDrag(event, layer, 'end')}
                    style={{
                      position: 'absolute',
                      left: `calc(${left + width}% - 4px)`,
                      width: 7,
                      top: 0,
                      bottom: 0,
                      cursor: 'ew-resize',
                      borderRadius: 3,
                      background: 'rgba(226, 232, 240, 0.55)',
                    }}
                  />
                  {(layer.automations ?? []).flatMap((automation) =>
                    automation.keyframes.map((keyframe) => (
                      <div
                        key={`${layer.id}-${automation.property}-${keyframe.timeSec}`}
                        title={`${automation.property} = ${keyframe.value} @ ${keyframe.timeSec}s (kéo để đổi giờ)`}
                        onPointerDown={(dragEvent) => beginKeyframeDrag(dragEvent, layer, automation.property, keyframe.timeSec)}
                        style={{
                          position: 'absolute',
                          left: `calc(${Math.max(0, Math.min(100, (keyframe.timeSec / Math.max(0.001, audioDuration || 1)) * 100))}% - 4px)`,
                          top: 1,
                          width: 8,
                          height: 8,
                          background: '#fbbf24',
                          transform: 'rotate(45deg)',
                          borderRadius: 1,
                          cursor: 'ew-resize',
                        }}
                      />
                    )),
                  )}
                </div>
              </div>
            )
          })}
        </div>
        </div>
        {clipMenu && (
          <TimelineClipMenu
            menu={clipMenu}
            playhead={playhead}
            duration={audioDuration}
            snapEnabled={snapEnabled}
            onClose={() => setClipMenu(null)}
            onToggleSnap={() => setSnapEnabled((value) => !value)}
          />
        )}
      </div>
    </section>
  )
}

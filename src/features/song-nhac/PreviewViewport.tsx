/**
 * Chức năng 13 — Preview viewport.
 * Bước 6: Nhận audioRef + audioFileUrl từ cha; gọi attachAudio khi có. Giữ Play demo.
 * Không subscribe FFT / currentTime / waveform.
 */

import { useRef, useEffect, useCallback, useState } from 'react'
import { VisualizerRuntime } from './runtime'
import { useSongNhacRuntimeStore } from './store/songNhacRuntimeStore'
import { useSongNhacLayerStore } from './store/songNhacLayerStore'
import { songNhacLayersToDrawable } from './runtime/render/songNhacLayersToDrawable'
import GizmoOverlay from './gizmo/GizmoOverlay'

const RULER_TICK_STEP = 50
const ZOOM_SAFE_MIN = 0.25
const ZOOM_SAFE_MAX = 2

function clampZoomSafe(z: number): number {
  if (!Number.isFinite(z) || z <= 0) return 1
  return Math.max(ZOOM_SAFE_MIN, Math.min(ZOOM_SAFE_MAX, z))
}

function RulerHorizontal({ canvasW, displayW }: { canvasW: number; displayW: number }) {
  const scale = displayW / canvasW
  const ticks: React.ReactNode[] = []
  for (let x = 0; x <= canvasW; x += RULER_TICK_STEP) {
    const px = x * scale
    ticks.push(
      <div
        key={x}
        style={{
          position: 'absolute',
          left: px,
          top: 0,
          height: '100%',
          borderLeft: '1px solid rgba(255,255,255,0.25)',
          fontSize: 9,
          color: 'rgba(255,255,255,0.6)',
          paddingLeft: 2,
          lineHeight: '24px',
        }}
      >
        {x}
      </div>
    )
  }
  return (
    <div
      style={{
        position: 'relative',
        background: '#1a1a2e',
        borderBottom: '1px solid rgba(255,255,255,0.15)',
        fontSize: 9,
        color: 'rgba(255,255,255,0.6)',
      }}
    >
      {ticks}
    </div>
  )
}

function RulerVertical({ canvasH, displayH }: { canvasH: number; displayH: number }) {
  const scale = displayH / canvasH
  const ticks: React.ReactNode[] = []
  for (let y = 0; y <= canvasH; y += RULER_TICK_STEP) {
    const py = y * scale
    ticks.push(
      <div
        key={y}
        style={{
          position: 'absolute',
          top: py,
          left: 0,
          width: '100%',
          borderTop: '1px solid rgba(255,255,255,0.25)',
          fontSize: 9,
          color: 'rgba(255,255,255,0.6)',
          paddingTop: 2,
          textAlign: 'center',
        }}
      >
        {y}
      </div>
    )
  }
  return (
    <div
      style={{
        position: 'relative',
        background: '#1a1a2e',
        borderRight: '1px solid rgba(255,255,255,0.15)',
        fontSize: 9,
        color: 'rgba(255,255,255,0.6)',
      }}
    >
      {ticks}
    </div>
  )
}

const ASPECT_RATIO_VALUE: Record<string, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '9:16': 9 / 16,
  '4:5': 4 / 5,
  '2.35:1': 2.35,
  '2:1': 2,
  '1.85:1': 1.85,
  '3:4': 3 / 4,
  '5.8-inch': 9 / 19.5,
}

const DEMO_AUDIO_URL = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'

export type OnTimelineCompute = (
  channelData: Float32Array,
  sampleRate: number,
  duration: number
) => void

export interface PreviewViewportProps {
  onTimelineCompute?: OnTimelineCompute
  /** Bước 6: ref đến <audio> do SongNhacScreen sở hữu (playlist track). */
  audioRef?: React.RefObject<HTMLAudioElement | null>
  /** Bước 6: file URL của track đã chọn; khi set → attachAudio + play. */
  audioFileUrl?: string | null
}

export default function PreviewViewport({ onTimelineCompute, audioRef: externalAudioRef, audioFileUrl }: PreviewViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<VisualizerRuntime | null>(null)
  const demoAudioRef = useRef<HTMLAudioElement | null>(null)
  const quality = useSongNhacRuntimeStore((s) => s.quality)
  const fpsText = useSongNhacRuntimeStore((s) => s.fpsText)
  const setFpsText = useSongNhacRuntimeStore((s) => s.setFpsText)
  const aspectRatio = useSongNhacRuntimeStore((s) => s.aspectRatio)
  const previewZoom = useSongNhacRuntimeStore((s) => s.previewZoom)
  const showGrid = useSongNhacRuntimeStore((s) => s.showGrid)
  const showRulers = useSongNhacRuntimeStore((s) => s.showRulers)
  const visualizerLayout = useSongNhacRuntimeStore((s) => s.visualizerLayout)
  const bloomStrength = useSongNhacRuntimeStore((s) => s.bloomStrength)
  const bloomRadius = useSongNhacRuntimeStore((s) => s.bloomRadius)
  const bloomThreshold = useSongNhacRuntimeStore((s) => s.bloomThreshold)
  const bgEngine = useSongNhacRuntimeStore((s) => s.bgEngine)
  const vantaEffect = useSongNhacRuntimeStore((s) => s.vantaEffect)
  const bgMode = useSongNhacRuntimeStore((s) => s.bgMode)
  const wavejsAnimation = useSongNhacRuntimeStore((s) => s.wavejsAnimation)
  const audiomotionMode = useSongNhacRuntimeStore((s) => s.audiomotionMode)
  const audiomotionGradient = useSongNhacRuntimeStore((s) => s.audiomotionGradient)
  const audiomotionRadial = useSongNhacRuntimeStore((s) => s.audiomotionRadial)
  const audiomotionLedBars = useSongNhacRuntimeStore((s) => s.audiomotionLedBars)
  const threejsPreset = useSongNhacRuntimeStore((s) => s.threejsPreset)
  const [canvasSize, setCanvasSize] = useState<{
    w: number
    h: number
    displayW: number
    displayH: number
  } | null>(null)
  const handleCanvasSizeChange = useCallback(
    (size: { w: number; h: number; displayW: number; displayH: number } | null) => {
      setCanvasSize(size)
    },
    []
  )
  const zoomIn = useSongNhacRuntimeStore((s) => s.zoomIn)
  const zoomOut = useSongNhacRuntimeStore((s) => s.zoomOut)
  const layers = useSongNhacLayerStore((s) => s.layers)
  const selectedLayerId = useSongNhacLayerStore((s) => s.selectedLayerId)
  const selectedIds = useSongNhacLayerStore((s) => s.selectedIds)
  const setSelectedLayerId = useSongNhacLayerStore((s) => s.setSelectedLayerId)
  const setSelection = useSongNhacLayerStore((s) => s.setSelection)
  const moveSelectedLayers = useSongNhacLayerStore((s) => s.moveSelectedLayers)
  const updateLayer = useSongNhacLayerStore((s) => s.updateLayer)
  const moveGroup = useSongNhacLayerStore((s) => s.moveGroup)
  const getLayer = useSongNhacLayerStore((s) => s.getLayer)
  const beginHistoryGesture = useSongNhacLayerStore((s) => s.beginHistoryGesture)
  const endHistoryGesture = useSongNhacLayerStore((s) => s.endHistoryGesture)
  const setFocusContentInputId = useSongNhacLayerStore((s) => s.setFocusContentInputId)

  const handleEditTextLayer = useCallback(
    (id: string) => {
      setSelectedLayerId(id)
      setFocusContentInputId(id)
    },
    [setSelectedLayerId, setFocusContentInputId]
  )

  const handleMoveGroup = useCallback(
    (groupId: string, deltaX: number, deltaY: number) => {
      moveGroup(groupId, deltaX, deltaY)
    },
    [moveGroup]
  )

  const handleUpdateLayerTransform = useCallback(
    (id: string, deltaX: number, deltaY: number) => {
      const layer = getLayer(id)
      if (!layer?.transform) return
      updateLayer(id, {
        transform: {
          ...layer.transform,
          x: layer.transform.x + deltaX,
          y: layer.transform.y + deltaY,
        },
      })
    },
    [getLayer, updateLayer]
  )

  const handleUpdateLayerScale = useCallback(
    (id: string, scaleX: number, scaleY: number) => {
      const layer = getLayer(id)
      if (!layer?.transform) return
      updateLayer(id, {
        transform: {
          ...layer.transform,
          scaleX,
          scaleY,
        },
      })
    },
    [getLayer, updateLayer]
  )

  const handleUpdateLayerRotation = useCallback(
    (id: string, rotation: number) => {
      const layer = getLayer(id)
      if (!layer?.transform) return
      updateLayer(id, {
        transform: {
          ...layer.transform,
          rotation,
        },
      })
    },
    [getLayer, updateLayer]
  )

  // NOTE: attachAudio effect moved AFTER the mount effect (below) so that
  // runtimeRef.current is guaranteed to be set on the first render.
  // See the useEffect after the mount effect block.

  const handlePlayDemo = async () => {
    if (!demoAudioRef.current || !runtimeRef.current) return
    try {
      const res = await fetch(DEMO_AUDIO_URL)
      const arrayBuffer = await res.arrayBuffer()
      const audioCtx = new AudioContext()
      const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0))
      const channelData = decoded.getChannelData(0)
      const sampleRate = decoded.sampleRate
      const duration = decoded.duration
      audioCtx.close()

      const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' })
      demoAudioRef.current.src = URL.createObjectURL(blob)
      await demoAudioRef.current.play()
      runtimeRef.current.attachAudio(demoAudioRef.current)

      onTimelineCompute?.(channelData, sampleRate, duration)
    } catch (e) {
      console.warn('[PreviewViewport] Demo play failed:', e)
    }
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const runtime = new VisualizerRuntime()
    runtimeRef.current = runtime
    runtime.mount(el, {
      quality,
      fpsReportIntervalMs: 500,
      onFps: (fps) => setFpsText(`${fps} fps`),
      getLayers: () => songNhacLayersToDrawable(useSongNhacLayerStore.getState().layers),
    })

    return () => {
      runtime.destroy()
      runtimeRef.current = null
      setFpsText('— fps')
    }
  }, [setFpsText])

  useEffect(() => {
    runtimeRef.current?.setQuality(quality)
  }, [quality])

  // Visualizer layout → runtime.setLayout
  useEffect(() => {
    runtimeRef.current?.setLayout(visualizerLayout)
  }, [visualizerLayout])

  // Bloom params → runtime.setBloomParams
  useEffect(() => {
    runtimeRef.current?.setBloomParams(bloomStrength, bloomRadius, bloomThreshold)
  }, [bloomStrength, bloomRadius, bloomThreshold])

  // ThreeJS preset → runtime.setThreejsPreset
  useEffect(() => {
    runtimeRef.current?.setThreejsPreset(threejsPreset)
  }, [threejsPreset])

  // Background engine switching → runtime.setBgEngine
  // Then apply current sub-settings AFTER engine is ready (setBgEngine is async).
  useEffect(() => {
    let cancelled = false
    const runtime = runtimeRef.current
    if (!runtime) return

    ;(async () => {
      await runtime.setBgEngine(bgEngine)
      if (cancelled) return
      // Apply current sub-settings after engine is loaded & initialized
      if (bgEngine === 'threejs') {
        // Re-apply ThreeJS settings from store (setBgEngine uses hardcoded defaults)
        runtime.setLayout(visualizerLayout)
        runtime.setBloomParams(bloomStrength, bloomRadius, bloomThreshold)
        runtime.setThreejsPreset(threejsPreset)
      } else {
        const engine = runtime.getAltEngine() as any
        if (!engine) return
        switch (bgEngine) {
          case 'vanta':
            engine.setEffect?.(vantaEffect)
            break
          case 'wavejs':
            engine.setAnimation?.(wavejsAnimation)
            break
          case 'audiomotion':
            engine.setMode?.(audiomotionMode)
            engine.setGradient?.(audiomotionGradient)
            engine.setRadial?.(audiomotionRadial)
            engine.setLedBars?.(audiomotionLedBars)
            break
        }
      }
    })()

    return () => { cancelled = true }
  }, [bgEngine]) // eslint-disable-line react-hooks/exhaustive-deps

  // Background mode switching
  useEffect(() => {
    runtimeRef.current?.setBgMode(bgMode)
  }, [bgMode])

  // Wire blur background image from first image layer src
  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    if (bgMode !== 'blur') {
      // Not blur mode — clear cached blur image
      runtime.setBlurImage(null)
      return
    }
    // Find first image layer with a src
    const imageLayer = layers.find((l) => l.type === 'image' && (l as any).src)
    const src = imageLayer ? (imageLayer as any).src as string : null
    runtime.setBlurImage(src)
  }, [bgMode, layers])

  // Vanta effect change (after engine is already loaded)
  useEffect(() => {
    if (bgEngine !== 'vanta') return
    const engine = runtimeRef.current?.getAltEngine() as any
    engine?.setEffect?.(vantaEffect)
  }, [vantaEffect]) // eslint-disable-line react-hooks/exhaustive-deps

  // Wave.js animation change (after engine is already loaded)
  useEffect(() => {
    if (bgEngine !== 'wavejs') return
    const engine = runtimeRef.current?.getAltEngine() as any
    engine?.setAnimation?.(wavejsAnimation)
  }, [wavejsAnimation]) // eslint-disable-line react-hooks/exhaustive-deps

  // AudioMotion settings changes (after engine is already loaded)
  useEffect(() => {
    if (bgEngine !== 'audiomotion') return
    const engine = runtimeRef.current?.getAltEngine() as any
    engine?.setMode?.(audiomotionMode)
  }, [audiomotionMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (bgEngine !== 'audiomotion') return
    const engine = runtimeRef.current?.getAltEngine() as any
    engine?.setGradient?.(audiomotionGradient)
  }, [audiomotionGradient]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (bgEngine !== 'audiomotion') return
    const engine = runtimeRef.current?.getAltEngine() as any
    engine?.setRadial?.(audiomotionRadial)
  }, [audiomotionRadial]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (bgEngine !== 'audiomotion') return
    const engine = runtimeRef.current?.getAltEngine() as any
    engine?.setLedBars?.(audiomotionLedBars)
  }, [audiomotionLedBars]) // eslint-disable-line react-hooks/exhaustive-deps

  // Butterchurn preset control events
  useEffect(() => {
    if (bgEngine !== 'butterchurn') return
    // Get engine lazily in each handler (engine may not exist yet during initial mount)
    const onRandom = () => (runtimeRef.current?.getAltEngine() as any)?.randomPreset?.()
    const onNext = () => (runtimeRef.current?.getAltEngine() as any)?.nextPreset?.()
    const onPrev = () => (runtimeRef.current?.getAltEngine() as any)?.prevPreset?.()
    window.addEventListener('butterchurn:random', onRandom)
    window.addEventListener('butterchurn:next', onNext)
    window.addEventListener('butterchurn:prev', onPrev)
    return () => {
      window.removeEventListener('butterchurn:random', onRandom)
      window.removeEventListener('butterchurn:next', onNext)
      window.removeEventListener('butterchurn:prev', onPrev)
    }
  }, [bgEngine])

  // Bước 6: attachAudio — MUST be after mount effect so runtimeRef.current exists.
  useEffect(() => {
    if (!audioFileUrl || !externalAudioRef?.current || !runtimeRef.current) return
    const el = externalAudioRef.current
    runtimeRef.current.attachAudio(el)
  }, [audioFileUrl, externalAudioRef])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      if (e.deltaY < 0) zoomIn()
      else if (e.deltaY > 0) zoomOut()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomIn, zoomOut])

  const ratio = ASPECT_RATIO_VALUE[aspectRatio] ?? 16 / 9

  // CapCut-style: frame trong frame — preview area (cinema) > canvas frame (viền, padding) > canvas
  return (
    <div
      ref={viewportRef}
      data-preview-viewport
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        background: '#0a0a12',
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          maxWidth: '100%',
          maxHeight: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#0d0d14',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.4)',
          boxSizing: 'border-box',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            transform: `scale(${clampZoomSafe(previewZoom)})`,
            transformOrigin: 'center center',
            aspectRatio: ratio,
            width: '100%',
            maxWidth: '100%',
            height: '100%',
            maxHeight: '100%',
            display: showRulers ? 'grid' : 'flex',
            gridTemplateColumns: showRulers ? '24px 1fr' : undefined,
            gridTemplateRows: showRulers ? '24px 1fr' : undefined,
            alignItems: showRulers ? 'stretch' : 'center',
            justifyContent: showRulers ? 'stretch' : 'center',
          }}
        >
          {showRulers && (
            <>
              <div
                style={{
                  background: '#1a1a2e',
                  borderRight: '1px solid rgba(255,255,255,0.15)',
                  borderBottom: '1px solid rgba(255,255,255,0.15)',
                }}
              />
              {canvasSize ? (
                <RulerHorizontal
                  canvasW={canvasSize.w}
                  displayW={canvasSize.displayW}
                />
              ) : (
                <div style={{ background: '#1a1a2e', borderBottom: '1px solid rgba(255,255,255,0.15)' }} />
              )}
              {canvasSize ? (
                <RulerVertical
                  canvasH={canvasSize.h}
                  displayH={canvasSize.displayH}
                />
              ) : (
                <div style={{ background: '#1a1a2e', borderRight: '1px solid rgba(255,255,255,0.15)' }} />
              )}
            </>
          )}
          <div
            ref={containerRef}
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              overflow: 'hidden',
              borderRadius: showRulers ? 0 : 6,
              borderTopLeftRadius: 0,
            }}
          >
        <GizmoOverlay
          containerRef={containerRef}
          layers={layers}
          selectedLayerId={selectedLayerId}
          selectedIds={selectedIds}
          onSelectLayer={setSelectedLayerId}
          onSetSelection={setSelection}
          onUpdateLayerTransform={handleUpdateLayerTransform}
          onUpdateLayerScale={handleUpdateLayerScale}
          onUpdateLayerRotation={handleUpdateLayerRotation}
          onMoveSelectedLayers={moveSelectedLayers}
          onBeginHistoryGesture={beginHistoryGesture}
          onEndHistoryGesture={endHistoryGesture}
          onEditTextLayer={handleEditTextLayer}
          showGrid={showGrid}
          onCanvasSizeChange={handleCanvasSizeChange}
          onMoveGroup={handleMoveGroup}
        />
          </div>
        </div>
      </div>
      <audio ref={demoAudioRef} style={{ display: 'none' }} crossOrigin="anonymous" />
      <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={handlePlayDemo}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            background: 'rgba(0,122,204,0.5)',
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 4,
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Play demo
        </button>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          fontSize: 11,
          color: 'rgba(255,255,255,0.5)',
          pointerEvents: 'none',
        }}
      >
        {fpsText}
      </div>
    </div>
  )
}

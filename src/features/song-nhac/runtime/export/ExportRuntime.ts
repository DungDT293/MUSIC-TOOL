/**
 * Chức năng 13 — Bước 5. ExportRuntime: render frame-by-frame, không RAF.
 * V2: Chuyển sang JPEG capture (47x nhỏ hơn) → FFmpeg MJPEG pipe.
 * V3: Support alt engines (butterchurn/audiomotion/wavejs/vanta) from store.
 * V5: Fake AudioContext cho butterchurn/audiomotion/wavejs trong offline export.
 * TimeSource = frameIndex/fps; AudioSource = seek + getFrame; FrameSink = capture.
 */

import { CanvasHost } from '../canvas/CanvasHost'
import type { CanvasSet } from '../canvas/CanvasHost'
import { ThreeJsEngine } from '../engine/threejs/ThreeJsEngine'
import { EngineHost } from '../engine/EngineHost'
import { WaveBarsEngine } from '../engine/wave/WaveBarsEngine'
import { renderOneFrame } from './renderOneFrame'
import { captureCompositeToJPEG } from './captureFrame'
import { createFakeAudioForExport, type FakeAudioExportContext } from './fakeAudioForExport'
import type { DrawableLayer } from '../render/drawLayers'
import type {
  ExportConfig,
  FrameSink,
  SeekableAudioSource,
  ExportProgress,
} from './types'
import type { EngineType, WebGLVisualizerEngine } from '../engine/types'
import { useSongNhacRuntimeStore } from '../../store/songNhacRuntimeStore'

const EMPTY_FREQ = new Uint8Array(128)
const EMPTY_WAVE = new Uint8Array(128)

// Engines that need a live AudioContext (no frame.frequencyData support)
const NEEDS_LIVE_AUDIO_ENGINES: EngineType[] = ['butterchurn', 'audiomotion', 'wavejs']

export interface ExportRuntimeOptions {
  config: ExportConfig
  audioSource: SeekableAudioSource
  frameSink: FrameSink
  onProgress?: (p: ExportProgress) => void
  isCancelled?: () => boolean
  skipYield?: boolean
  getLayers?: () => DrawableLayer[]
  /**
   * WebCodecs mode: skip captureCompositeToJPEG entirely.
   * The FrameSink reads directly from compositeCanvas via VideoFrame API.
   * frameSink.writeFrame() is called with an empty buffer as a signal.
   */
  useWebCodecs?: boolean
  /**
   * Callback when CanvasSet is ready — used by WebCodecs to bind the canvas.
   */
  onCanvasReady?: (set: import('../canvas/CanvasHost').CanvasSet) => void
}

/**
 * Export: for each frame → render → capture → send via IPC.
 * V5: Fake AudioContext cho butterchurn/audiomotion/wavejs — engine nhận FFT data
 *     qua monkey-patched AnalyserNode, render đúng hiệu ứng như preview.
 */
export async function runExportRuntime(options: ExportRuntimeOptions): Promise<void> {
  const { config, audioSource, frameSink, onProgress, isCancelled, skipYield = false, getLayers, useWebCodecs = false, onCanvasReady } = options
  const { width, height, fps, durationSec, devicePixelRatio = 1, startSec = 0 } = config
  const totalFrames = Math.max(1, Math.floor(durationSec * fps))

  const container = document.createElement('div')
  container.style.width = `${width}px`
  container.style.height = `${height}px`
  container.style.position = 'absolute'
  container.style.left = '0'
  container.style.top = '0'
  container.style.pointerEvents = 'none'
  container.style.visibility = 'hidden'
  document.body.appendChild(container)

  // Read the active engine from the store
  const storeState = useSongNhacRuntimeStore.getState()
  const activeBgEngine: EngineType = storeState.bgEngine ?? 'none'
  const bgMode: 'dark' | 'blur' | 'gradient' = storeState.bgMode ?? 'dark'
  const barCount: number = storeState.barCount ?? 128

  /** Draw background according to bgMode (matches preview VisualizerRuntime.drawBackground). */
  function drawExportBackground(ctx: CanvasRenderingContext2D, bw: number, bh: number): void {
    ctx.clearRect(0, 0, bw, bh)
    switch (bgMode) {
      case 'gradient': {
        const grd = ctx.createLinearGradient(0, 0, bw, bh)
        grd.addColorStop(0, '#0a0a1e')
        grd.addColorStop(0.5, '#1a0a2e')
        grd.addColorStop(1, '#0a1a2e')
        ctx.fillStyle = grd
        ctx.fillRect(0, 0, bw, bh)
        break
      }
      case 'dark':
      case 'blur':
      default:
        // Blur background in export falls back to dark (no image available in offscreen).
        ctx.fillStyle = '#0d0d14'
        ctx.fillRect(0, 0, bw, bh)
        break
    }
  }

  let threeEngine: ThreeJsEngine | null = null
  let engineHostFallback: EngineHost | null = null
  let altEngine: WebGLVisualizerEngine | null = null
  let altEngineInited = false
  let fakeAudio: FakeAudioExportContext | null = null
  const forceSoftware = config.forceSoftwareRenderer === true

  let currentSet: CanvasSet | null = null
  const host = new CanvasHost(
    (set) => {
      currentSet = set
      // Notify caller (e.g. WebCodecsFrameSink) that canvasSet is ready
      onCanvasReady?.(set)

      if (!threeEngine && !engineHostFallback && !altEngine && set.webglCanvas) {
        if (forceSoftware || activeBgEngine === 'wave2d') {
          console.log('[ExportRuntime] Software rendering mode: using Canvas 2D')
          engineHostFallback = new EngineHost()
          engineHostFallback.setEngine(new WaveBarsEngine())
        } else if (activeBgEngine === 'threejs') {
          try {
            threeEngine = new ThreeJsEngine({
              barCount: barCount,
              layout: storeState.visualizerLayout ?? 'circular',
              bloomStrength: storeState.bloomStrength ?? 1.5,
              bloomRadius: storeState.bloomRadius ?? 0.4,
              bloomThreshold: storeState.bloomThreshold ?? 0.1,
              devicePixelRatio: 1, // Export: canvas already at target resolution
            })
            threeEngine.initWithCanvas(set.webglCanvas, {
              width: set.webglCanvas.width,
              height: set.webglCanvas.height,
            })
            // Apply preset from store
            if (storeState.threejsPreset) {
              threeEngine.setPreset(storeState.threejsPreset as any)
            }
            console.log('[ExportRuntime] ThreeJsEngine initialized (WebGL + Bloom)')
          } catch (e) {
            console.warn('[ExportRuntime] ThreeJsEngine failed, using Canvas 2D fallback:', e)
            threeEngine?.destroy()
            threeEngine = null
            engineHostFallback = new EngineHost()
            engineHostFallback.setEngine(new WaveBarsEngine())
          }
        }
        // For alt engines (butterchurn/audiomotion/wavejs/vanta):
        // They will be initialized after the host mounts, in the setup section below.
      }
    },
    {
      quality: 'full',
      devicePixelRatio,
    }
  )
  host.mount(container)

  // ── Initialize alt engine (butterchurn/audiomotion/wavejs/vanta) ──
  // butterchurn/audiomotion/wavejs need a live AudioContext → we create a fake one
  // with monkey-patched AnalyserNode that returns our pre-computed FFT data.
  if (!forceSoftware && ['butterchurn', 'audiomotion', 'wavejs', 'vanta'].includes(activeBgEngine)) {
    try {
      switch (activeBgEngine) {
        case 'butterchurn': {
          const { ButterchurnEngine } = await import('../engine/butterchurn/ButterchurnEngine')
          altEngine = new ButterchurnEngine({
            presetName: storeState.butterchurnPreset || undefined,
          })
          break
        }
        case 'audiomotion': {
          const { AudioMotionEngine } = await import('../engine/audiomotion/AudioMotionEngine')
          altEngine = new AudioMotionEngine({
            mode: (storeState.audiomotionMode ?? 3) as any,
            gradient: (storeState.audiomotionGradient ?? 'prism') as any,
            radial: storeState.audiomotionRadial ?? false,
            ledBars: storeState.audiomotionLedBars ?? false,
          })
          break
        }
        case 'wavejs': {
          const { WaveJsEngine } = await import('../engine/wavejs/WaveJsEngine')
          altEngine = new WaveJsEngine({
            animation: (storeState.wavejsAnimation ?? 'shine rings') as any,
          })
          break
        }
        case 'vanta': {
          const { VantaEngine } = await import('../engine/vanta/VantaEngine')
          altEngine = new VantaEngine({
            effect: (storeState.vantaEffect ?? 'waves') as any,
          })
          break
        }
      }

      if (altEngine && currentSet?.webglCanvas) {
        const canvas = currentSet.webglCanvas
        await altEngine.initWithCanvas(canvas, {
          width: canvas.width,
          height: canvas.height,
        })
        altEngineInited = true
        console.log(`[ExportRuntime] Alt engine initialized: ${activeBgEngine}`)

        // For engines needing live AudioContext → create fake audio environment
        if (NEEDS_LIVE_AUDIO_ENGINES.includes(activeBgEngine) && altEngine.attachAudioSource) {
          fakeAudio = createFakeAudioForExport()
          altEngine.attachAudioSource(fakeAudio.fakeSource, fakeAudio.audioContext)
          console.log(`[ExportRuntime] Fake AudioContext attached to ${activeBgEngine} — will feed pre-computed FFT data per frame`)
        }
      }
    } catch (err) {
      console.error(`[ExportRuntime] Failed to load engine "${activeBgEngine}":`, err)
      // Fallback to Canvas 2D
      if (!threeEngine && !engineHostFallback) {
        engineHostFallback = new EngineHost()
        engineHostFallback.setEngine(new WaveBarsEngine())
      }
    }
  }

  // If no engine was set up (bgEngine = 'none'), no background engine renders
  // renderOneFrame will still render layers on overlay2dCanvas

  // JPEG quality: 0.92 cho chất lượng tốt — JPEG chỉ là format trung gian,
  // chất lượng cuối cùng do video codec (h264) quyết định.
  // 0.92 giữ nét gần như lossless, tránh artifact JPEG bị bake vào H.264.
  const jpegQuality = 0.92

  try {
    const BATCH = 30
    for (let i = 0; i < totalFrames; i++) {
      if (isCancelled?.()) break

      const timeSec = startSec + i / fps
      await audioSource.seek(timeSec)
      const { frequencyData, waveformData } = audioSource.getFrame(timeSec)
      const frame = {
        timeSec,
        frequencyData: frequencyData.length ? frequencyData : EMPTY_FREQ,
        waveformData: waveformData.length ? waveformData : EMPTY_WAVE,
      }

      // Update fake audio context with current frame's FFT data
      // → monkey-patched AnalyserNodes in butterchurn/audiomotion/wavejs will return this data
      if (fakeAudio) {
        fakeAudio.setFrameData(frame.frequencyData, frame.waveformData)
      }

      if (currentSet) {
        const layers = getLayers?.()

        if (threeEngine) {
          // ThreeJS path: WebGL render + overlay layers
          threeEngine.resize({ width: currentSet.webglCanvas.width, height: currentSet.webglCanvas.height })
          threeEngine.render(frame)
          renderOneFrame(currentSet, null, frame, layers)
        } else if (altEngine && altEngineInited) {
          // Alt engine path: render background via alt engine, then overlay layers
          // Draw clean background first
          const bgCtx = currentSet.webglCanvas.getContext('2d')
          if (bgCtx) {
            drawExportBackground(bgCtx, currentSet.webglCanvas.width, currentSet.webglCanvas.height)
          }
          altEngine.resize({
            width: currentSet.webglCanvas.width,
            height: currentSet.webglCanvas.height,
          })
          try { altEngine.render(frame) } catch {}
          renderOneFrame(currentSet, null, frame, layers)
        } else if (engineHostFallback) {
          // Canvas 2D fallback path
          renderOneFrame(currentSet, engineHostFallback, frame, layers)
        } else {
          // No engine (bgEngine = 'none'): just render layers
          const bgCtx = currentSet.webglCanvas.getContext('2d')
          if (bgCtx) {
            drawExportBackground(bgCtx, currentSet.webglCanvas.width, currentSet.webglCanvas.height)
          }
          renderOneFrame(currentSet, null, frame, layers)
        }

        if (useWebCodecs) {
          // WebCodecs path: FrameSink reads directly from compositeCanvas via VideoFrame
          // No JPEG encode, no CPU readback — GPU-to-GPU pipeline
          await frameSink.writeFrame(new ArrayBuffer(0))
        } else {
          // JPEG capture: ~100-300KB thay vì 14MB raw RGBA
          const jpegBuffer = await captureCompositeToJPEG(currentSet, jpegQuality)
          await frameSink.writeFrame(jpegBuffer)
        }
      }

      onProgress?.({ frameIndex: i, totalFrames, timeSec })

      if (i % BATCH === BATCH - 1) {
        if ('checkBackPressure' in frameSink && typeof (frameSink as any).checkBackPressure === 'function') {
          await (frameSink as any).checkBackPressure()
        }
        if (!skipYield) {
          await new Promise<void>((r) => setTimeout(r, 0))
        }
      }
    }
  } finally {
    await frameSink.close()
    threeEngine?.destroy()
    threeEngine = null
    altEngine?.destroy()
    altEngine = null
    fakeAudio?.destroy()
    fakeAudio = null
    engineHostFallback?.destroy?.()
    engineHostFallback = null
    host.unmount()
    if (container.parentNode) container.parentNode.removeChild(container)
  }
}

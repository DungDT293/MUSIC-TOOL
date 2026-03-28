/**
 * Chức năng 13 — Bước 5. ExportRuntime: render frame-by-frame, không RAF.
 * V2: Chuyển sang JPEG capture (47x nhỏ hơn) → FFmpeg MJPEG pipe.
 * TimeSource = frameIndex/fps; AudioSource = seek + getFrame; FrameSink = capture.
 */

import { CanvasHost } from '../canvas/CanvasHost'
import type { CanvasSet } from '../canvas/CanvasHost'
import { ThreeJsEngine } from '../engine/threejs/ThreeJsEngine'
import { EngineHost } from '../engine/EngineHost'
import { WaveBarsEngine } from '../engine/wave/WaveBarsEngine'
import { renderOneFrame } from './renderOneFrame'
import { captureCompositeToJPEG } from './captureFrame'
import type { DrawableLayer } from '../render/drawLayers'
import type {
  ExportConfig,
  FrameSink,
  SeekableAudioSource,
  ExportProgress,
} from './types'

const EMPTY_FREQ = new Uint8Array(128)
const EMPTY_WAVE = new Uint8Array(128)

export interface ExportRuntimeOptions {
  config: ExportConfig
  audioSource: SeekableAudioSource
  frameSink: FrameSink
  onProgress?: (p: ExportProgress) => void
  isCancelled?: () => boolean
  skipYield?: boolean
  getLayers?: () => DrawableLayer[]
}

/**
 * Export: for each frame → render → capture JPEG → send via IPC.
 * JPEG pipe: 14MB/frame → ~300KB/frame (47x reduction).
 */
export async function runExportRuntime(options: ExportRuntimeOptions): Promise<void> {
  const { config, audioSource, frameSink, onProgress, isCancelled, skipYield = false, getLayers } = options
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

  let threeEngine: ThreeJsEngine | null = null
  let engineHostFallback: any = null
  const forceSoftware = config.forceSoftwareRenderer === true

  let currentSet: CanvasSet | null = null
  const host = new CanvasHost(
    (set) => {
      currentSet = set

      if (!threeEngine && !engineHostFallback && set.webglCanvas) {
        if (forceSoftware) {
          console.log('[ExportRuntime] Software rendering mode: using Canvas 2D')
          engineHostFallback = new EngineHost()
          engineHostFallback.setEngine(new WaveBarsEngine())
        } else {
          try {
            threeEngine = new ThreeJsEngine({
              barCount: 128,
              layout: 'circular',
              bloomStrength: 1.5,
              bloomRadius: 0.4,
              bloomThreshold: 0.1,
            })
            threeEngine.initWithCanvas(set.webglCanvas, {
              width: set.webglCanvas.width,
              height: set.webglCanvas.height,
            })
            console.log('[ExportRuntime] ThreeJsEngine initialized (WebGL + Bloom)')
          } catch (e) {
            console.warn('[ExportRuntime] ThreeJsEngine failed, using Canvas 2D fallback:', e)
            threeEngine?.destroy()
            threeEngine = null
            engineHostFallback = new EngineHost()
            engineHostFallback.setEngine(new WaveBarsEngine())
          }
        }
      }
    },
    {
      quality: 'full',
      devicePixelRatio,
    }
  )
  host.mount(container)

  // JPEG quality: 0.85 cho tốc độ + chất lượng OK (giảm ~40% so với 0.92)
  const jpegQuality = 0.85

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

      if (currentSet) {
        const layers = getLayers?.()

        if (threeEngine) {
          threeEngine.resize({ width: currentSet.webglCanvas.width, height: currentSet.webglCanvas.height })
          threeEngine.render(frame)
          renderOneFrame(currentSet, null, frame, layers)
        } else {
          renderOneFrame(currentSet, engineHostFallback, frame, layers)
        }

        // JPEG capture: ~300KB thay vì 14MB raw RGBA
        const jpegBuffer = await captureCompositeToJPEG(currentSet, jpegQuality)
        await frameSink.writeFrame(jpegBuffer)
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
    engineHostFallback?.destroy?.()
    engineHostFallback = null
    host.unmount()
    if (container.parentNode) container.parentNode.removeChild(container)
  }
}

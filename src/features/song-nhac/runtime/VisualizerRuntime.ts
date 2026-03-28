/**
 * Chức năng 13 — Runtime (Bước 1–3).
 * RAF + FFT pull + engine; không callback/setState/store cho DSP.
 *
 * V3: Multi-engine support — ThreeJS, Butterchurn, AudioMotion, WaveJs, Vanta.
 * User chọn engine background trong EnginesPanel → store.bgEngine.
 * Runtime switch engine khi setBgEngine() được gọi.
 *
 * Fallback: Nếu WebGL không khả dụng → WaveBarsEngine (Canvas 2D).
 */

import { CanvasHost } from './canvas/CanvasHost'
import type { CanvasSet } from './canvas/CanvasHost'
import { createFpsMeter } from './canvas/fpsMeter'
import { AudioAnalyzerRealtime } from './audio/AudioAnalyzerRealtime'
import { ThreeJsEngine } from './engine/threejs/ThreeJsEngine'
import { EngineHost } from './engine/EngineHost'
import { WaveBarsEngine } from './engine/wave/WaveBarsEngine'
import { renderOneFrame } from './export/renderOneFrame'
import type { PreviewQuality, RuntimeEvents, RuntimeOptions } from './types'
import type { EngineType, WebGLVisualizerEngine } from './engine/types'

const EMPTY_FREQ = new Uint8Array(128)
const EMPTY_WAVE = new Uint8Array(128)

export type BgMode = 'dark' | 'blur' | 'gradient'

export class VisualizerRuntime {
  private container: HTMLElement | null = null
  private opts: RuntimeOptions & RuntimeEvents = {}
  private host: CanvasHost | null = null
  private currentSet: CanvasSet | null = null
  private fpsMeter: ReturnType<typeof createFpsMeter> | null = null
  private rafId: number | null = null
  private startTime = 0
  private audio: AudioAnalyzerRealtime | null = null
  private attachedAudioEl: HTMLAudioElement | null = null
  private threeEngine: ThreeJsEngine | null = null
  private threeInited = false
  private useCanvas2dFallback = false
  private engineHost: EngineHost | null = null

  /** Active background engine type. */
  private activeBgEngine: EngineType = 'none'
  /** Alt engine instance (lazy loaded). */
  private altEngine: WebGLVisualizerEngine | null = null
  private altEngineInited = false

  /** Background mode: dark/blur/gradient. */
  private bgMode: BgMode = 'dark'
  /** Cached blurred image for 'blur' bg mode. */
  private blurImageCache: HTMLCanvasElement | null = null
  private blurImageSrc: string | null = null

  mount(container: HTMLElement, options?: RuntimeOptions & RuntimeEvents): void {
    if (this.container) return
    this.container = container
    this.startTime = performance.now()
    this.opts = {
      quality: 'full',
      fpsReportIntervalMs: 500,
      ...options,
    }
    const dpr = this.opts.devicePixelRatio ?? Math.min(2, window.devicePixelRatio || 1)

    // Chỉ tạo ThreeJsEngine nếu bgEngine === 'threejs'
    // Nếu bgEngine khác → webglCanvas giữ nguyên 2D context
    if (this.activeBgEngine === 'threejs') {
      this.threeEngine = new ThreeJsEngine({
        barCount: 128,
        layout: 'circular',
        bloomStrength: 1.5,
        bloomRadius: 0.4,
        bloomThreshold: 0.1,
      })
    }

    this.host = new CanvasHost(
      (set) => {
        this.currentSet = set
        // Chỉ init ThreeJS nếu engine đúng là threejs VÀ chưa init
        if (this.activeBgEngine === 'threejs' && !this.threeInited && !this.useCanvas2dFallback && this.threeEngine && set.webglCanvas) {
          try {
            this.threeEngine.initWithCanvas(set.webglCanvas, {
              width: set.webglCanvas.width,
              height: set.webglCanvas.height,
            })
            this.threeInited = true
          } catch (e) {
            console.warn('[VisualizerRuntime] ThreeJsEngine init failed, falling back to Canvas 2D:', e)
            this.threeEngine.destroy()
            this.threeEngine = null
            this.useCanvas2dFallback = true
            this.engineHost = new EngineHost()
            this.engineHost.setEngine(new WaveBarsEngine())
          }
        }
      },
      {
        quality: this.opts.quality ?? 'full',
        devicePixelRatio: dpr,
      }
    )
    this.host.mount(container)

    if (this.opts.onFps) {
      this.fpsMeter = createFpsMeter(
        this.opts.onFps,
        this.opts.fpsReportIntervalMs ?? 500
      )
    }

    const loop = () => {
      if (document.hidden) {
        // Skip render khi tab không visible — giảm CPU/GPU usage
        this.rafId = requestAnimationFrame(loop)
        return
      }
      const set = this.currentSet
      if (set) {
        const t = (performance.now() - this.startTime) / 1000
        const freq = this.audio?.getFrequencyData() ?? EMPTY_FREQ
        const wave = this.audio?.getWaveformData() ?? EMPTY_WAVE
        const frame = { timeSec: t, frequencyData: freq, waveformData: wave }
        const layers = this.opts.getLayers?.() ?? []

        if (this.activeBgEngine === 'none') {
          // Nền sạch
          this.renderCleanBackground(set)
          renderOneFrame(set, null, frame, layers)
        } else if (this.threeInited && this.threeEngine && this.activeBgEngine === 'threejs') {
          // ThreeJS path
          this.threeEngine.resize({
            width: set.webglCanvas.width,
            height: set.webglCanvas.height,
          })
          this.threeEngine.render(frame)
          renderOneFrame(set, null, frame, layers)
        } else if (this.activeBgEngine !== 'threejs') {
          // Alt engines: render nền sạch + overlay layers
          // Alt engines render vào canvas riêng, chưa tích hợp composite pipeline
          this.renderCleanBackground(set)
          if (this.altEngine && this.altEngineInited) {
            // Alt engine render vào canvas/container riêng → blit vào webglCanvas
            try {
              this.altEngine.render(frame)
              // Blit alt engine output vào webglCanvas
              this.blitAltEngineToWebgl(set)
            } catch {}
          }
          renderOneFrame(set, null, frame, layers)
        } else {
          // Canvas 2D fallback
          renderOneFrame(set, this.engineHost, frame, layers)
        }
      }
      this.fpsMeter?.tick()
      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  /**
   * Nền sạch: chỉ vẽ background mode (đen/blur/gradient), không engine.
   * webglCanvas được clear và vẽ background. ThreeJS không render.
   */
  private renderCleanBackground(set: CanvasSet): void {
    const ctx = set.webglCanvas.getContext('2d')
    if (!ctx) return
    const w = set.webglCanvas.width
    const h = set.webglCanvas.height
    ctx.clearRect(0, 0, w, h)
    this.drawBackground(ctx, w, h)
  }

  /**
   * Blit alt engine output vào webglCanvas.
   * Alt engines render vào container/canvas riêng → tìm canvas con và drawImage.
   */
  private blitAltEngineToWebgl(set: CanvasSet): void {
    const ctx = set.webglCanvas.getContext('2d')
    if (!ctx) return
    const w = set.webglCanvas.width
    const h = set.webglCanvas.height

    // Tìm canvas output từ alt engine
    const engine = this.altEngine as any
    if (!engine) return

    // AudioMotion: engine.analyzer.canvas
    if (engine.analyzer?.canvas) {
      try {
        ctx.drawImage(engine.analyzer.canvas, 0, 0, w, h)
      } catch {}
      return
    }

    // Vanta: container querySelector('canvas')
    if (engine._container || engine.container) {
      const container = engine._container || engine.container
      const vantaCanvas = container?.querySelector?.('canvas')
      if (vantaCanvas) {
        try {
          ctx.drawImage(vantaCanvas, 0, 0, w, h)
        } catch {}
      }
      return
    }

    // WaveJs: offscreenCanvas
    if (engine.offscreenCanvas) {
      try {
        ctx.drawImage(engine.offscreenCanvas, 0, 0, w, h)
      } catch {}
    }
  }

  /**
   * Vẽ background theo bgMode.
   */
  private drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    switch (this.bgMode) {
      case 'dark':
        ctx.fillStyle = '#0d0d14'
        ctx.fillRect(0, 0, w, h)
        break
      case 'gradient': {
        const grd = ctx.createLinearGradient(0, 0, w, h)
        grd.addColorStop(0, '#0a0a1e')
        grd.addColorStop(0.5, '#1a0a2e')
        grd.addColorStop(1, '#0a1a2e')
        ctx.fillStyle = grd
        ctx.fillRect(0, 0, w, h)
        break
      }
      case 'blur':
        if (this.blurImageCache) {
          ctx.drawImage(this.blurImageCache, 0, 0, w, h)
        } else {
          ctx.fillStyle = '#0d0d14'
          ctx.fillRect(0, 0, w, h)
        }
        break
    }
  }

  attachAudio(audioEl: HTMLAudioElement): void {
    if (this.attachedAudioEl === audioEl) {
      this.audio?.resume()
      return
    }
    this.audio?.destroy()
    this.audio = null
    this.attachedAudioEl = audioEl
    try {
      this.audio = new AudioAnalyzerRealtime(audioEl)
      this.audio.resume()

      // Attach audio source to alt engine
      if (this.altEngine && this.altEngine.attachAudioSource && this.audio) {
        const source = (this.audio as any).source
        const ctx = (this.audio as any).audioCtx || (this.audio as any).ctx
        if (source && ctx) {
          this.altEngine.attachAudioSource(source, ctx)
        }
      }
    } catch (e) {
      console.error('[VisualizerRuntime] AudioAnalyzerRealtime failed', e)
    }
  }

  /** Switch background engine at runtime. */
  async setBgEngine(type: EngineType): Promise<void> {
    if (type === this.activeBgEngine) return
    const prevEngine = this.activeBgEngine
    console.log(`[VisualizerRuntime] Switching engine: ${prevEngine} → ${type}`)

    // Destroy current alt engine
    if (this.altEngine) {
      this.altEngine.destroy()
      this.altEngine = null
      this.altEngineInited = false
    }

    // Nếu đang chuyển TỪ ThreeJS sang engine khác/none:
    // ThreeJS đã chiếm WebGL context trên webglCanvas →
    // phải destroy ThreeJS + tạo canvas mới để có 2D context
    if (prevEngine === 'threejs' && type !== 'threejs' && this.threeEngine) {
      console.log('[VisualizerRuntime] Destroying ThreeJS + replacing webglCanvas for 2D context')
      this.threeEngine.destroy()
      this.threeEngine = null
      this.threeInited = false
      // Tạo canvas mới (canvas cũ đã bị WebGL chiếm, không thể getContext('2d'))
      if (this.host) {
        this.host.replaceWebglCanvas()
      }
    }

    this.activeBgEngine = type

    // Nếu chuyển sang ThreeJS → cần init lại
    if (type === 'threejs') {
      if (!this.threeEngine && this.currentSet?.webglCanvas) {
        // Tạo canvas mới cho WebGL
        if (this.host) {
          // Set threeInited=true TẠM để onRender callback không double-init
          this.threeInited = true
          this.host.replaceWebglCanvas()
          this.threeInited = false
        }
        try {
          this.threeEngine = new ThreeJsEngine({
            barCount: 128,
            layout: 'circular',
            bloomStrength: 1.5,
            bloomRadius: 0.4,
            bloomThreshold: 0.1,
          })
          const canvas = this.currentSet.webglCanvas
          this.threeEngine.initWithCanvas(canvas, {
            width: canvas.width,
            height: canvas.height,
          })
          this.threeInited = true
          console.log('[VisualizerRuntime] ThreeJS re-initialized')
        } catch (e) {
          console.warn('[VisualizerRuntime] ThreeJS re-init failed:', e)
          this.threeInited = false
        }
      }
      return
    }

    if (type === 'none' || type === 'wave2d') {
      return
    }

    // Lazy load engine mới
    try {
      switch (type) {
        case 'butterchurn': {
          const { ButterchurnEngine } = await import('./engine/butterchurn/ButterchurnEngine')
          this.altEngine = new ButterchurnEngine()
          break
        }
        case 'audiomotion': {
          const { AudioMotionEngine } = await import('./engine/audiomotion/AudioMotionEngine')
          this.altEngine = new AudioMotionEngine()
          break
        }
        case 'wavejs': {
          const { WaveJsEngine } = await import('./engine/wavejs/WaveJsEngine')
          this.altEngine = new WaveJsEngine()
          break
        }
        case 'vanta': {
          const { VantaEngine } = await import('./engine/vanta/VantaEngine')
          this.altEngine = new VantaEngine()
          break
        }
      }

      if (this.altEngine && this.currentSet?.webglCanvas) {
        await this._initAltEngine(this.currentSet.webglCanvas)
      }
    } catch (err) {
      console.error(`[VisualizerRuntime] Failed to load engine "${type}":`, err)
      this.activeBgEngine = 'none'
    }
  }

  private async _initAltEngine(canvas: HTMLCanvasElement): Promise<void> {
    if (!this.altEngine || this.altEngineInited) return
    try {
      await this.altEngine.initWithCanvas(canvas, {
        width: canvas.width,
        height: canvas.height,
      })
      this.altEngineInited = true
      console.log(`[VisualizerRuntime] Alt engine initialized: ${this.activeBgEngine}`)

      if (this.altEngine.attachAudioSource && this.audio) {
        const source = (this.audio as any).source
        const ctx = (this.audio as any).audioCtx || (this.audio as any).ctx
        if (source && ctx) {
          this.altEngine.attachAudioSource(source, ctx)
        }
      }
    } catch (err) {
      console.error(`[VisualizerRuntime] Alt engine init failed:`, err)
    }
  }

  /** Get the active alt engine (for settings). */
  getAltEngine(): WebGLVisualizerEngine | null {
    return this.altEngine
  }

  getActiveBgEngine(): EngineType {
    return this.activeBgEngine
  }

  setBgMode(mode: BgMode): void {
    this.bgMode = mode
  }

  /** Set blur background from image URL. */
  setBlurImage(imageUrl: string | null): void {
    if (!imageUrl) {
      this.blurImageCache = null
      this.blurImageSrc = null
      return
    }
    if (imageUrl === this.blurImageSrc) return
    this.blurImageSrc = imageUrl

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      // Create blurred version
      const c = document.createElement('canvas')
      c.width = 320  // Low res for blur
      c.height = 180
      const ctx = c.getContext('2d')
      if (!ctx) return
      // Draw dark overlay + scaled image
      ctx.fillStyle = '#0d0d14'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.globalAlpha = 0.4
      ctx.filter = 'blur(20px) brightness(0.4)'
      ctx.drawImage(img, -20, -20, c.width + 40, c.height + 40)
      ctx.globalAlpha = 1
      ctx.filter = 'none'
      this.blurImageCache = c
    }
    img.src = imageUrl
  }

  setLayout(layout: 'circular' | 'horizontal' | 'mirror'): void {
    this.threeEngine?.setLayout(layout)
  }

  setBloomParams(strength?: number, radius?: number, threshold?: number): void {
    this.threeEngine?.setBloomParams(strength, radius, threshold)
  }

  setQuality(q: PreviewQuality): void {
    this.opts.quality = q
    this.host?.setQuality(q)
  }

  resize(): void {
    this.host?.resize()
  }

  destroy(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.fpsMeter = null
    this.audio?.destroy()
    this.audio = null
    this.attachedAudioEl = null
    this.threeEngine?.destroy()
    this.threeEngine = null
    this.threeInited = false
    this.altEngine?.destroy()
    this.altEngine = null
    this.altEngineInited = false
    this.engineHost?.destroy()
    this.engineHost = null
    this.useCanvas2dFallback = false
    this.host?.unmount()
    this.host = null
    this.currentSet = null
    this.container = null
    this.blurImageCache = null
    this.blurImageSrc = null
  }
}

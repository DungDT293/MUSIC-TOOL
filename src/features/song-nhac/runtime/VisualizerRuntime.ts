/**
 * Chức năng 13 — Runtime (Bước 1–3).
 * RAF + FFT pull + engine; không callback/setState/store cho DSP.
 *
 * V3: Multi-engine support — ThreeJS, Butterchurn, AudioMotion, WaveJs, Vanta.
 * User chọn engine background trong EnginesPanel → store.bgEngine.
 * Runtime switch engine khi setBgEngine() được gọi.
 *
 * Fallback: Nếu WebGL không khả dụng → WaveBarsEngine (Canvas 2D).
 *
 * V4 audit fixes:
 * - Async race guard: generation counter prevents stale setBgEngine/_initAltEngine
 * - Use public accessors on AudioAnalyzerRealtime (no more `as any`)
 * - Stale blur image onload guard
 * - Engine leak in catch block
 * - Cache ThreeJS resize to avoid per-frame GPU churn
 */

import { CanvasHost } from './canvas/CanvasHost'
import type { CanvasSet } from './canvas/CanvasHost'
import { createFpsMeter } from './canvas/fpsMeter'
import { AudioAnalyzerRealtime } from './audio/AudioAnalyzerRealtime'
import { ThreeJsEngine } from './engine/threejs/ThreeJsEngine'
import { EngineHost } from './engine/EngineHost'
import { WaveBarsEngine } from './engine/wave/WaveBarsEngine'
import { renderOneFrame, resetBeatState } from './export/renderOneFrame'
import { resetDrawLayersState, clearAllMediaCaches } from './render/drawLayers'
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
  /** Whether the current webglCanvas has a WebGL context (cannot use 2D). */
  private canvasHasWebGLContext = false

  /** Generation counter — increments on each setBgEngine call to detect stale async. */
  private engineGeneration = 0

  /** Background mode: dark/blur/gradient. */
  private bgMode: BgMode = 'dark'
  /** Cached blurred image for 'blur' bg mode. */
  private blurImageCache: HTMLCanvasElement | null = null
  private blurImageSrc: string | null = null

  /** Cached ThreeJS render size to avoid resize() every RAF frame. */
  private lastThreeSize = { width: 0, height: 0 }

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
            this.canvasHasWebGLContext = true
            this.host?.markWebGLContextCreated()
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
        } else if (this.activeBgEngine === 'wave2d') {
          // Canvas 2D bars (WaveBarsEngine) via engineHost
          renderOneFrame(set, this.engineHost, frame, layers)
        } else if (this.threeInited && this.threeEngine && this.activeBgEngine === 'threejs') {
          // ThreeJS path — only resize when canvas dimensions actually change
          const tw = set.webglCanvas.width
          const th = set.webglCanvas.height
          if (tw !== this.lastThreeSize.width || th !== this.lastThreeSize.height) {
            this.threeEngine.resize({ width: tw, height: th })
            this.lastThreeSize = { width: tw, height: th }
          }
          this.threeEngine.render(frame)
          renderOneFrame(set, null, frame, layers)
        } else if (this.activeBgEngine !== 'threejs') {
          // Alt engines (butterchurn/audiomotion/wavejs/vanta):
          this.renderCleanBackground(set)
          if (this.altEngine && this.altEngineInited) {
            try {
              this.altEngine.render(frame)
            } catch {}
          }
          renderOneFrame(set, null, frame, layers)
        } else {
          // Canvas 2D fallback (ThreeJS init failed)
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
    if (!ctx) {
      // Canvas may already have WebGL context — cannot get 2d. This is a state-machine bug.
      console.warn('[VisualizerRuntime] renderCleanBackground: cannot get 2d context on webglCanvas')
      return
    }
    const w = set.webglCanvas.width
    const h = set.webglCanvas.height
    ctx.clearRect(0, 0, w, h)
    this.drawBackground(ctx, w, h)
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

  /** Helper: attach audio source to an engine using public accessors (no `as any`). */
  private attachAudioToEngine(engine: WebGLVisualizerEngine): void {
    if (!engine.attachAudioSource || !this.audio) return
    const source = this.audio.getSourceNode()
    const ctx = this.audio.getAudioContext()
    if (source && ctx) {
      engine.attachAudioSource(source, ctx)
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

    // Reset animation state from previous track to prevent ghost artifacts
    resetBeatState()
    resetDrawLayersState()

    try {
      this.audio = new AudioAnalyzerRealtime(audioEl)
      this.audio.resume()

      // Attach audio source to alt engine using public accessors
      if (this.altEngine) {
        this.attachAudioToEngine(this.altEngine)
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

    // Increment generation counter to invalidate any in-flight async from previous calls
    const gen = ++this.engineGeneration

    // Destroy current alt engine
    if (this.altEngine) {
      this.altEngine.destroy()
      this.altEngine = null
      this.altEngineInited = false
    }

    // Destroy wave2d engineHost if switching away
    if (prevEngine === 'wave2d' && this.engineHost) {
      this.engineHost.destroy()
      this.engineHost = null
      this.useCanvas2dFallback = false
    }

    // Engines that use WebGL directly on the host webglCanvas (cannot co-exist with 2D context)
    const WEBGL_ENGINES: EngineType[] = ['threejs']
    const prevUsedWebGL = WEBGL_ENGINES.includes(prevEngine) || this.canvasHasWebGLContext
    const nextUsesWebGL = WEBGL_ENGINES.includes(type)

    // Nếu đang chuyển TỪ engine WebGL sang engine 2D hoặc none:
    if (prevUsedWebGL && !nextUsesWebGL) {
      if (this.threeEngine) {
        console.log('[VisualizerRuntime] Destroying ThreeJS + replacing webglCanvas for 2D context')
        this.threeEngine.destroy()
        this.threeEngine = null
        this.threeInited = false
        this.lastThreeSize = { width: 0, height: 0 }
      }
      if (this.host) {
        this.host.replaceWebglCanvas()
      }
      this.canvasHasWebGLContext = false
    }
    // Nếu chuyển từ 2D engine sang WebGL engine
    else if (!prevUsedWebGL && nextUsesWebGL && prevEngine !== 'none') {
      if (this.host) {
        this.host.replaceWebglCanvas()
      }
      this.canvasHasWebGLContext = false
    }

    this.activeBgEngine = type

    // Nếu chuyển sang ThreeJS → cần init lại
    if (type === 'threejs') {
      const set = this.currentSet
      if (!this.threeEngine && set?.webglCanvas) {
        if (this.host) {
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
          const canvas = this.currentSet!.webglCanvas
          // FIX: await initWithCanvas — it's async (loads THREE + postprocessing).
          // Without await, threeInited is set true before engine is ready,
          // causing render() to early-return on every frame until imports finish.
          await this.threeEngine.initWithCanvas(canvas, {
            width: canvas.width,
            height: canvas.height,
          })
          this.threeInited = true
          this.canvasHasWebGLContext = true
          this.lastThreeSize = { width: canvas.width, height: canvas.height }
          this.host?.markWebGLContextCreated()
          console.log('[VisualizerRuntime] ThreeJS re-initialized')
        } catch (e) {
          console.warn('[VisualizerRuntime] ThreeJS re-init failed:', e)
          this.threeInited = false
        }
      }
      return
    }

    if (type === 'none') {
      return
    }

    // wave2d: dùng EngineHost + WaveBarsEngine (Canvas 2D bars)
    if (type === 'wave2d') {
      if (!this.engineHost) {
        this.engineHost = new EngineHost()
        this.engineHost.setEngine(new WaveBarsEngine())
      }
      return
    }

    // Lazy load engine mới — with generation guard after each await
    try {
      let newEngine: WebGLVisualizerEngine | null = null

      switch (type) {
        case 'butterchurn': {
          const { ButterchurnEngine } = await import('./engine/butterchurn/ButterchurnEngine')
          if (gen !== this.engineGeneration) return // stale — another switch happened
          const { useSongNhacRuntimeStore: bcStore } = await import('../store/songNhacRuntimeStore')
          newEngine = new ButterchurnEngine({
            onPresetChange: (name) => bcStore.getState().setButterchurnPreset(name),
          })
          break
        }
        case 'audiomotion': {
          const { AudioMotionEngine } = await import('./engine/audiomotion/AudioMotionEngine')
          if (gen !== this.engineGeneration) return
          newEngine = new AudioMotionEngine()
          break
        }
        case 'wavejs': {
          const { WaveJsEngine } = await import('./engine/wavejs/WaveJsEngine')
          if (gen !== this.engineGeneration) return
          newEngine = new WaveJsEngine()
          break
        }
        case 'vanta': {
          const { VantaEngine } = await import('./engine/vanta/VantaEngine')
          if (gen !== this.engineGeneration) return
          newEngine = new VantaEngine()
          break
        }
      }

      if (!newEngine) return

      this.altEngine = newEngine

      if (this.currentSet?.webglCanvas) {
        await this._initAltEngine(this.currentSet.webglCanvas, gen)
      }
    } catch (err) {
      console.error(`[VisualizerRuntime] Failed to load engine "${type}":`, err)
      // Clean up partially constructed engine to prevent leaks
      if (gen === this.engineGeneration) {
        this.altEngine?.destroy()
        this.altEngine = null
        this.altEngineInited = false
        this.activeBgEngine = 'none'
      }
    }
  }

  private async _initAltEngine(canvas: HTMLCanvasElement, gen: number): Promise<void> {
    const engine = this.altEngine
    if (!engine || this.altEngineInited) return
    try {
      await engine.initWithCanvas(canvas, {
        width: canvas.width,
        height: canvas.height,
      })
      // Check if another setBgEngine call superseded us during the await
      if (gen !== this.engineGeneration || this.altEngine !== engine) return
      this.altEngineInited = true
      console.log(`[VisualizerRuntime] Alt engine initialized: ${this.activeBgEngine}`)

      this.attachAudioToEngine(engine)
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

    const expectedSrc = imageUrl
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      // Guard: skip if another setBlurImage superseded this one, or runtime destroyed
      if (this.blurImageSrc !== expectedSrc || !this.container) return
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

  setThreejsPreset(presetId: string): void {
    this.threeEngine?.setPreset(presetId as any)
  }

  setQuality(q: PreviewQuality): void {
    this.opts.quality = q
    this.host?.setQuality(q)
  }

  resize(): void {
    this.host?.resize()
    // Propagate resize to alt engine
    if (this.altEngine && this.altEngineInited && this.currentSet?.webglCanvas) {
      this.altEngine.resize({
        width: this.currentSet.webglCanvas.width,
        height: this.currentSet.webglCanvas.height,
      })
    }
  }

  destroy(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    // Increment generation to invalidate any in-flight async engine init
    this.engineGeneration++
    this.fpsMeter = null
    this.audio?.destroy()
    this.audio = null
    this.attachedAudioEl = null
    this.threeEngine?.destroy()
    this.threeEngine = null
    this.threeInited = false
    this.lastThreeSize = { width: 0, height: 0 }
    this.altEngine?.destroy()
    this.altEngine = null
    this.altEngineInited = false
    this.canvasHasWebGLContext = false
    this.engineHost?.destroy()
    this.engineHost = null
    this.useCanvas2dFallback = false
    this.host?.unmount()
    this.host = null
    this.currentSet = null
    this.container = null
    this.blurImageCache = null
    this.blurImageSrc = null
    // Clean up all module-level state and media caches to prevent memory leaks
    resetBeatState()
    resetDrawLayersState()
    clearAllMediaCaches()
  }
}

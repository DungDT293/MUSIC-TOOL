/**
 * Butterchurn Engine — MilkDrop 2 presets (WebGL).
 *
 * Tích hợp butterchurn (https://github.com/jberg/butterchurn)
 * để render 2000+ MilkDrop preset lên WebGL canvas.
 *
 * Implements WebGLVisualizerEngine interface.
 *
 * Architecture:
 * - Butterchurn requires its OWN WebGL canvas (can't share with 2D context).
 * - We create a hidden offscreen canvas for Butterchurn to render into.
 * - Each frame, we blit from that offscreen canvas → the runtime's webglCanvas (2D).
 * - AudioContext is deferred: createVisualizer() runs when attachAudioSource() provides
 *   the real AudioContext, avoiding orphan AudioContext + cross-context errors.
 */

import type { Size, EngineRenderFrame, WebGLVisualizerEngine } from '../types'

// Lazy import để tránh load lúc khởi động
let butterchurnModule: any = null
let presetsModule: any = null

async function loadButterchurn() {
  if (!butterchurnModule) {
    butterchurnModule = await import('butterchurn')
  }
  if (!presetsModule) {
    presetsModule = await import('butterchurn-presets')
  }
  const bc = butterchurnModule.default || butterchurnModule
  // butterchurn-presets exports a class with getPresets() static method.
  // ESM import gives { default: PresetsClass }, CJS gives PresetsClass directly.
  // Calling the class as a function throws "Cannot call a class as a function".
  const presetsRef = presetsModule.default || presetsModule
  let rawPresets: Record<string, any>
  if (typeof presetsRef?.getPresets === 'function') {
    rawPresets = presetsRef.getPresets()
  } else if (typeof presetsRef === 'object' && presetsRef !== null) {
    rawPresets = presetsRef
  } else {
    rawPresets = {}
  }
  return {
    butterchurn: bc,
    presets: rawPresets,
  }
}

export interface ButterchurnConfig {
  presetName?: string
  /** Thời gian chuyển preset (giây). */
  blendDuration?: number
  /** Callback khi preset thay đổi (load/next/prev/random). */
  onPresetChange?: (name: string) => void
}

export class ButterchurnEngine implements WebGLVisualizerEngine {
  private visualizer: any = null
  /** The runtime's target canvas (2D context) — we blit INTO this. */
  private targetCanvas: HTMLCanvasElement | null = null
  /** Our own offscreen WebGL canvas for Butterchurn rendering. */
  private glCanvas: HTMLCanvasElement | null = null
  private size: Size = { width: 0, height: 0 }
  private audioContext: AudioContext | null = null
  private audioSource: MediaElementAudioSourceNode | null = null
  private presets: Record<string, any> = {}
  private presetNames: string[] = []
  private currentPresetName = ''
  private config: ButterchurnConfig
  private inited = false
  private destroyed = false
  /** Butterchurn lib reference (cached after lazy load). */
  private bcLib: any = null
  // FIX H-01: WebGL context loss recovery state
  private contextLost = false
  private glContextLostHandler: ((e: Event) => void) | null = null
  private glContextRestoredHandler: (() => void) | null = null

  constructor(config: ButterchurnConfig = {}) {
    this.config = config
  }

  async initWithCanvas(canvas: HTMLCanvasElement, size: Size): Promise<void> {
    this.targetCanvas = canvas
    this.size = size
    this.destroyed = false

    try {
      const { butterchurn, presets } = await loadButterchurn()
      if (this.destroyed) return

      this.bcLib = butterchurn
      this.presets = presets
      this.presetNames = Object.keys(presets)

      if (this.presetNames.length === 0) {
        console.warn('[ButterchurnEngine] No presets available')
        return
      }

      // Create a SEPARATE offscreen canvas for Butterchurn (WebGL).
      // The runtime's webglCanvas may already have a 2D context,
      // and a canvas can only have one context type.
      this.glCanvas = document.createElement('canvas')
      this.glCanvas.width = size.width
      this.glCanvas.height = size.height

      // FIX H-01: Register WebGL context loss/restore listeners.
      // GPU driver resets (sleep/wake, driver crash, resource pressure) cause silent
      // context loss — without these listeners the canvas goes permanently black.
      this._setupContextLossHandlers(this.glCanvas)

      // Defer createVisualizer until attachAudioSource provides the real AudioContext.
      // If audio is already attached (re-init scenario), create now.
      if (this.audioContext) {
        this._createVisualizer()
      }

      console.log(`[ButterchurnEngine] Loaded ${this.presetNames.length} presets, waiting for audio...`)
    } catch (err) {
      console.error('[ButterchurnEngine] Init failed:', err)
    }
  }

  /** Create the butterchurn visualizer instance. Requires audioContext + glCanvas. */
  private _createVisualizer(): void {
    if (this.visualizer || !this.bcLib || !this.glCanvas || !this.audioContext) return
    try {
      this.visualizer = this.bcLib.createVisualizer(
        this.audioContext,
        this.glCanvas,
        {
          width: this.size.width,
          height: this.size.height,
          pixelRatio: 1,
          textureRatio: 1,
        }
      )

      // Connect audio if source already available
      if (this.audioSource) {
        try {
          this.visualizer.connectAudio(this.audioSource)
        } catch (e) {
          console.warn('[ButterchurnEngine] connectAudio failed:', e)
        }
      }

      // Load initial preset
      const presetName = this.config.presetName && this.presets[this.config.presetName]
        ? this.config.presetName
        : this.presetNames[Math.floor(Math.random() * this.presetNames.length)]

      this.loadPreset(presetName, false)
      this.inited = true
      console.log(`[ButterchurnEngine] Visualizer created, active preset: ${presetName}`)
    } catch (err) {
      console.error('[ButterchurnEngine] createVisualizer failed:', err)
    }
  }

  loadPreset(name: string, blend = true): void {
    if (!this.visualizer || !this.presets[name]) return
    this.currentPresetName = name
    const duration = blend ? (this.config.blendDuration ?? 2.0) : 0
    this.visualizer.loadPreset(this.presets[name], duration)
    this.config.onPresetChange?.(name)
  }

  nextPreset(): void {
    if (this.presetNames.length === 0) return
    const idx = this.presetNames.indexOf(this.currentPresetName)
    const nextIdx = (idx + 1) % this.presetNames.length
    this.loadPreset(this.presetNames[nextIdx])
  }

  prevPreset(): void {
    if (this.presetNames.length === 0) return
    const idx = this.presetNames.indexOf(this.currentPresetName)
    const prevIdx = (idx - 1 + this.presetNames.length) % this.presetNames.length
    this.loadPreset(this.presetNames[prevIdx])
  }

  randomPreset(): void {
    if (this.presetNames.length === 0) return
    const idx = Math.floor(Math.random() * this.presetNames.length)
    this.loadPreset(this.presetNames[idx])
  }

  getPresetNames(): string[] {
    return [...this.presetNames]
  }

  getCurrentPreset(): string {
    return this.currentPresetName
  }

  attachAudioSource(source: MediaElementAudioSourceNode, audioContext: AudioContext): void {
    this.audioContext = audioContext
    this.audioSource = source

    // If visualizer not yet created (deferred from init), create now
    if (!this.visualizer && this.bcLib && this.glCanvas) {
      this._createVisualizer()
    } else if (this.visualizer) {
      // Reconnect audio to existing visualizer
      try {
        this.visualizer.connectAudio(source)
      } catch (e) {
        console.warn('[ButterchurnEngine] connectAudio failed:', e)
      }
    }
  }

  resize(size: Size): void {
    this.size = size
    if (this.glCanvas) {
      this.glCanvas.width = size.width
      this.glCanvas.height = size.height
    }
    if (this.visualizer) {
      this.visualizer.setRendererSize(size.width, size.height)
    }
  }

  render(frame: EngineRenderFrame): void {
    if (!this.visualizer || !this.inited || !this.targetCanvas || !this.glCanvas) return
    // FIX H-01: Skip rendering while GPU context is lost — avoid WebGL errors
    if (this.contextLost) return
    try {
      // Render into our offscreen WebGL canvas
      this.visualizer.render()

      // Blit from offscreen WebGL canvas → target canvas (2D)
      const ctx = this.targetCanvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, this.size.width, this.size.height)
        ctx.drawImage(this.glCanvas, 0, 0, this.size.width, this.size.height)
      }
    } catch (err) {
      // Butterchurn render error — skip frame
      console.warn('[ButterchurnEngine] Render error:', err)
    }
  }

  destroy(): void {
    this.destroyed = true
    this.inited = false
    // FIX H-01: Remove context loss listeners before destroying canvas
    this._teardownContextLossHandlers()
    if (this.visualizer) {
      try {
        this.visualizer.dispose?.()
      } catch {}
      this.visualizer = null
    }
    // Release WebGL context on offscreen canvas
    if (this.glCanvas) {
      try {
        const gl = this.glCanvas.getContext('webgl2') || this.glCanvas.getContext('webgl')
        if (gl) {
          const ext = gl.getExtension('WEBGL_lose_context')
          ext?.loseContext()
        }
      } catch {}
      this.glCanvas = null
    }
    this.targetCanvas = null
    this.audioContext = null
    this.audioSource = null
    this.bcLib = null
    this.presets = {}
    this.presetNames = []
    this.contextLost = false
  }

  // ═══════════════════════════════════════════════════════════════
  // FIX H-01: WebGL context loss/restore handling.
  //
  // GPU drivers can reset at any time (sleep/wake, TDR on Windows,
  // driver crash, resource pressure). When this happens:
  //   1. webglcontextlost fires — we must call preventDefault() to
  //      ALLOW the browser to attempt restoration (without it, the
  //      context is permanently dead).
  //   2. webglcontextrestored fires — we rebuild the Butterchurn
  //      visualizer on the same canvas (shaders, buffers, state).
  // ═══════════════════════════════════════════════════════════════

  private _setupContextLossHandlers(canvas: HTMLCanvasElement): void {
    this._teardownContextLossHandlers() // idempotent

    this.glContextLostHandler = (e: Event) => {
      e.preventDefault() // CRITICAL: allows browser to attempt restoration
      this.contextLost = true
      console.warn('[ButterchurnEngine] WebGL context lost — GPU driver reset detected. Waiting for restore...')
    }

    this.glContextRestoredHandler = () => {
      console.log('[ButterchurnEngine] WebGL context restored — rebuilding visualizer...')
      this.contextLost = false

      // Rebuild the Butterchurn visualizer with the same canvas.
      // The old visualizer's WebGL state is gone, but the canvas element
      // gets a fresh context from the browser.
      const savedPreset = this.currentPresetName
      if (this.visualizer) {
        try { this.visualizer.dispose?.() } catch {}
        this.visualizer = null
      }
      this.inited = false

      // Re-create visualizer if we have all the pieces
      if (this.bcLib && this.glCanvas && this.audioContext) {
        this._createVisualizer()
        // Restore the preset that was playing
        if (savedPreset && this.presets[savedPreset]) {
          this.loadPreset(savedPreset, false)
        }
        console.log(`[ButterchurnEngine] Visualizer rebuilt successfully, preset: ${this.currentPresetName}`)
      }
    }

    canvas.addEventListener('webglcontextlost', this.glContextLostHandler)
    canvas.addEventListener('webglcontextrestored', this.glContextRestoredHandler)
  }

  private _teardownContextLossHandlers(): void {
    if (this.glCanvas && this.glContextLostHandler) {
      this.glCanvas.removeEventListener('webglcontextlost', this.glContextLostHandler)
    }
    if (this.glCanvas && this.glContextRestoredHandler) {
      this.glCanvas.removeEventListener('webglcontextrestored', this.glContextRestoredHandler)
    }
    this.glContextLostHandler = null
    this.glContextRestoredHandler = null
  }
}

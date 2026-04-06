/**
 * AudioMotion Engine — Professional spectrum analyzer (Canvas 2D).
 *
 * Tích hợp audiomotion-analyzer (https://github.com/hvianna/audioMotion-analyzer)
 * để render spectrum analyzer chuyên nghiệp với nhiều mode và gradient.
 *
 * FIX V2: Defer Analyzer creation until AudioContext is available.
 *  - AudioMotion creates its own AudioContext on construction if none is supplied.
 *  - When VisualizerRuntime later calls attachAudioSource() with a *different*
 *    AudioContext, connectInput() throws DOMException.
 *  - Solution: save canvas+size in initWithCanvas(), wait for attachAudioSource()
 *    to supply the real AudioContext, THEN create the Analyzer.
 *  - If no audio ever arrives, create the Analyzer lazily on the first render().
 */

import type { Size, EngineRenderFrame, WebGLVisualizerEngine } from '../types'

// Lazy import
let AudioMotionAnalyzer: any = null

async function loadAudioMotion() {
  if (!AudioMotionAnalyzer) {
    const mod = await import('audiomotion-analyzer')
    AudioMotionAnalyzer = mod.default || mod
  }
  return AudioMotionAnalyzer
}

export type AudioMotionMode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10
export type AudioMotionGradient = 'classic' | 'prism' | 'rainbow' | 'orangered' | 'steelblue' | 'cool' | 'warm'

export interface AudioMotionConfig {
  mode?: AudioMotionMode
  gradient?: AudioMotionGradient
  barSpace?: number
  lumiBars?: boolean
  radial?: boolean
  reflexRatio?: number
  showPeaks?: boolean
  mirror?: -1 | 0 | 1
  splitLayout?: boolean
  roundBars?: boolean
  ledBars?: boolean
}

// Danh sách mode hiển thị
export const AUDIOMOTION_MODES: { value: AudioMotionMode; label: string }[] = [
  { value: 0, label: 'Discrete frequencies' },
  { value: 1, label: '1/24th octave bands' },
  { value: 2, label: '1/12th octave bands' },
  { value: 3, label: '1/8th octave bands' },
  { value: 4, label: '1/6th octave bands' },
  { value: 5, label: '1/4th octave bands' },
  { value: 6, label: '1/3rd octave bands' },
  { value: 7, label: 'Half octave bands' },
  { value: 8, label: 'Full octave bands' },
  { value: 10, label: 'Area graph' },
]

export const AUDIOMOTION_GRADIENTS: { value: string; label: string }[] = [
  { value: 'classic', label: 'Classic' },
  { value: 'prism', label: 'Prism' },
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'orangered', label: 'Orange Red' },
  { value: 'steelblue', label: 'Steel Blue' },
]

export class AudioMotionEngine implements WebGLVisualizerEngine {
  private analyzer: any = null
  private targetCanvas: HTMLCanvasElement | null = null
  private container: HTMLDivElement | null = null
  private size: Size = { width: 0, height: 0 }
  private config: AudioMotionConfig
  private inited = false
  private destroyed = false
  /** Saved audio context from attachAudioSource — used to create Analyzer with matching context. */
  private audioCtx: AudioContext | null = null
  /** Saved audio source — connected once Analyzer is created. */
  private audioSource: MediaElementAudioSourceNode | null = null
  /** True once the Analyzer module has been loaded (but Analyzer may not be created yet). */
  private moduleLoaded = false

  constructor(config: AudioMotionConfig = {}) {
    this.config = {
      mode: 3,
      gradient: 'prism',
      barSpace: 0.25,
      lumiBars: false,
      radial: false,
      reflexRatio: 0.3,
      showPeaks: true,
      mirror: 0,
      roundBars: true,
      ledBars: false,
      ...config,
    }
  }

  async initWithCanvas(canvas: HTMLCanvasElement, size: Size): Promise<void> {
    this.targetCanvas = canvas
    this.size = size
    this.destroyed = false

    try {
      await loadAudioMotion()
      if (this.destroyed) return
      this.moduleLoaded = true

      // Create off-screen container (Analyzer needs a DOM element)
      this.container = document.createElement('div')
      this.container.style.position = 'fixed'
      this.container.style.left = '-9999px'
      this.container.style.top = '-9999px'
      this.container.style.width = `${size.width}px`
      this.container.style.height = `${size.height}px`
      document.body.appendChild(this.container)

      this.inited = true

      // If audio was already attached, create the Analyzer now
      if (this.audioCtx && this.audioSource) {
        this._createAnalyzer()
      }

      console.log('[AudioMotionEngine] Initialized (deferred analyzer creation), mode:', this.config.mode)
    } catch (err) {
      console.error('[AudioMotionEngine] Init failed:', err)
    }
  }

  /**
   * Create the actual AudioMotion Analyzer instance.
   * Called once both canvas+container AND audioCtx are available.
   */
  private _createAnalyzer(): void {
    if (this.analyzer || this.destroyed || !this.container || !AudioMotionAnalyzer) return

    try {
      const opts: any = {
        mode: this.config.mode,
        gradient: this.config.gradient,
        barSpace: this.config.barSpace,
        lumiBars: this.config.lumiBars,
        radial: this.config.radial,
        reflexRatio: this.config.reflexRatio,
        showPeaks: this.config.showPeaks,
        mirror: this.config.mirror,
        roundBars: this.config.roundBars,
        ledBars: this.config.ledBars,
        showBgColor: true,
        bgAlpha: 1,
        overlay: false,
        showScaleX: false,
        showScaleY: false,
        fftSize: 8192,
        smoothing: 0.7,
        weightingFilter: 'D',
        connectSpeakers: false, // don't double-connect to speakers
      }

      // CRITICAL: pass the SAME AudioContext so connectInput won't throw
      if (this.audioCtx) {
        opts.audioCtx = this.audioCtx
      }

      this.analyzer = new AudioMotionAnalyzer(this.container, opts)

      // Connect saved audio source
      if (this.audioSource) {
        try {
          this.analyzer.connectInput(this.audioSource)
          console.log('[AudioMotionEngine] Audio source connected successfully')
        } catch (err: any) {
          console.warn('[AudioMotionEngine] connectInput failed:', err?.message)
          // Fallback: try HTMLMediaElement directly
          try {
            const mediaEl = (this.audioSource as any).mediaElement as HTMLMediaElement
            if (mediaEl) {
              this.analyzer.connectInput(mediaEl)
              console.log('[AudioMotionEngine] Fallback: connected via HTMLMediaElement')
            }
          } catch (e2: any) {
            console.warn('[AudioMotionEngine] connectInput(mediaElement) also failed:', e2?.message)
          }
        }
      }

      console.log('[AudioMotionEngine] Analyzer created, mode:', this.config.mode)
    } catch (err) {
      console.error('[AudioMotionEngine] Analyzer creation failed:', err)
    }
  }

  /**
   * Create the Analyzer WITHOUT audio context (visual-only fallback).
   * Used when render() is called but no audio has been attached yet.
   */
  private _createAnalyzerWithoutAudio(): void {
    if (this.analyzer || this.destroyed || !this.container || !AudioMotionAnalyzer) return
    try {
      this.analyzer = new AudioMotionAnalyzer(this.container, {
        mode: this.config.mode,
        gradient: this.config.gradient,
        barSpace: this.config.barSpace,
        lumiBars: this.config.lumiBars,
        radial: this.config.radial,
        reflexRatio: this.config.reflexRatio,
        showPeaks: this.config.showPeaks,
        mirror: this.config.mirror,
        roundBars: this.config.roundBars,
        ledBars: this.config.ledBars,
        showBgColor: true,
        bgAlpha: 1,
        overlay: false,
        showScaleX: false,
        showScaleY: false,
        fftSize: 8192,
        smoothing: 0.7,
        weightingFilter: 'D',
        connectSpeakers: false,
      })
      console.log('[AudioMotionEngine] Analyzer created (no audio)')
    } catch (err) {
      console.error('[AudioMotionEngine] Analyzer creation (no audio) failed:', err)
    }
  }

  attachAudioSource(source: MediaElementAudioSourceNode, audioContext: AudioContext): void {
    this.audioSource = source
    this.audioCtx = audioContext

    if (this.inited && !this.analyzer) {
      // Analyzer hasn't been created yet → create it now with the correct AudioContext
      this._createAnalyzer()
    } else if (this.analyzer) {
      // Analyzer already exists — try to connect
      // This can happen if user switches tracks (new source, same context)
      try {
        this.analyzer.connectInput(source)
      } catch (err: any) {
        console.warn('[AudioMotionEngine] connectInput on existing analyzer failed:', err?.message)
        // Destroy and recreate with correct context
        try {
          this.analyzer.destroy()
        } catch {}
        this.analyzer = null
        this._createAnalyzer()
      }
    }
  }

  setMode(mode: AudioMotionMode): void {
    this.config.mode = mode
    if (this.analyzer) this.analyzer.mode = mode
  }

  setGradient(gradient: string): void {
    if (this.analyzer) this.analyzer.gradient = gradient
  }

  setRadial(radial: boolean): void {
    this.config.radial = radial
    if (this.analyzer) this.analyzer.radial = radial
  }

  setLumiBars(v: boolean): void {
    this.config.lumiBars = v
    if (this.analyzer) this.analyzer.lumiBars = v
  }

  setMirror(v: -1 | 0 | 1): void {
    this.config.mirror = v
    if (this.analyzer) this.analyzer.mirror = v
  }

  setLedBars(v: boolean): void {
    this.config.ledBars = v
    if (this.analyzer) this.analyzer.ledBars = v
  }

  setRoundBars(v: boolean): void {
    this.config.roundBars = v
    if (this.analyzer) this.analyzer.roundBars = v
  }

  resize(size: Size): void {
    this.size = size
    if (this.container) {
      this.container.style.width = `${size.width}px`
      this.container.style.height = `${size.height}px`
    }
  }

  render(frame: EngineRenderFrame): void {
    if (!this.targetCanvas || !this.inited) return

    // Lazy-create analyzer on first render if no audio has arrived
    if (!this.analyzer && this.moduleLoaded) {
      this._createAnalyzerWithoutAudio()
    }
    if (!this.analyzer) return

    // AudioMotion renders internally via its own RAF.
    // Blit the analyzer's canvas → our target canvas each frame.
    try {
      const analyzerCanvas = this.analyzer.canvas as HTMLCanvasElement
      if (analyzerCanvas) {
        const ctx = this.targetCanvas.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, this.size.width, this.size.height)
          ctx.drawImage(analyzerCanvas, 0, 0, this.size.width, this.size.height)
        }
      }
    } catch {}
  }

  destroy(): void {
    this.destroyed = true
    this.inited = false
    this.moduleLoaded = false
    if (this.analyzer) {
      try {
        this.analyzer.destroy()
      } catch {}
      this.analyzer = null
    }
    // Remove container
    if (this.container?.parentNode) {
      this.container.parentNode.removeChild(this.container)
    }
    this.container = null
    this.targetCanvas = null
    this.audioSource = null
    this.audioCtx = null
  }
}

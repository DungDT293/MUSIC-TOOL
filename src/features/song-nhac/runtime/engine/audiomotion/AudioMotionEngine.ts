/**
 * AudioMotion Engine — Professional spectrum analyzer (Canvas 2D).
 *
 * Tích hợp audiomotion-analyzer (https://github.com/hvianna/audioMotion-analyzer)
 * để render spectrum analyzer chuyên nghiệp với nhiều mode và gradient.
 *
 * Renders offscreen rồi blit kết quả vào webglCanvas của CanvasHost.
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
  private offscreenCanvas: HTMLCanvasElement | null = null
  private targetCanvas: HTMLCanvasElement | null = null
  private size: Size = { width: 0, height: 0 }
  private config: AudioMotionConfig
  private inited = false
  private destroyed = false

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
      const Analyzer = await loadAudioMotion()
      if (this.destroyed) return

      // audioMotion-analyzer cần một container div
      this.offscreenCanvas = document.createElement('canvas')
      this.offscreenCanvas.width = size.width
      this.offscreenCanvas.height = size.height

      // Container tạm cho audioMotion
      const container = document.createElement('div')
      container.style.position = 'fixed'
      container.style.left = '-9999px'
      container.style.top = '-9999px'
      container.style.width = `${size.width}px`
      container.style.height = `${size.height}px`
      document.body.appendChild(container)

      this.analyzer = new Analyzer(container, {
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
      })

      // Store container ref for cleanup
      ;(this as any)._container = container

      this.inited = true
      console.log('[AudioMotionEngine] Initialized, mode:', this.config.mode)
    } catch (err) {
      console.error('[AudioMotionEngine] Init failed:', err)
    }
  }

  attachAudioSource(source: MediaElementAudioSourceNode, audioContext: AudioContext): void {
    if (this.analyzer) {
      try {
        // AudioMotion dùng audioContext riêng — cần truyền audioCtx + source cùng context
        // Nếu source thuộc context khác → bỏ qua, AudioMotion sẽ không reactive
        // nhưng ít nhất không crash
        this.analyzer.connectInput(source)
      } catch (err: any) {
        // DOMException: cannot connect AudioNode from different audio context
        // → Bỏ qua, AudioMotion sẽ hiển thị silence visualization
        console.warn('[AudioMotionEngine] connectInput skipped (different AudioContext):', err?.message)
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
    if (this.analyzer) {
      const container = (this as any)._container as HTMLDivElement
      if (container) {
        container.style.width = `${size.width}px`
        container.style.height = `${size.height}px`
      }
    }
  }

  render(frame: EngineRenderFrame): void {
    if (!this.analyzer || !this.targetCanvas || !this.inited) return
    // audioMotion-analyzer tự render với RAF — chỉ cần blit vào target
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
    if (this.analyzer) {
      try {
        this.analyzer.destroy()
      } catch {}
      this.analyzer = null
    }
    // Remove container
    const container = (this as any)._container as HTMLDivElement
    if (container && container.parentNode) {
      container.parentNode.removeChild(container)
    }
    ;(this as any)._container = null
    this.offscreenCanvas = null
    this.targetCanvas = null
  }
}

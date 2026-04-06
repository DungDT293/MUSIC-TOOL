/**
 * Wave.js Engine — Multiple wave animation styles (Canvas 2D).
 *
 * Tích hợp @foobar404/wave v2 (https://github.com/foobar404/Wave.js)
 * để render nhiều kiểu sóng đẹp mắt.
 *
 * Architecture:
 * - Wave.js v2 API uses class constructors (Shine, Circles, Lines, etc.)
 *   NOT string keys like v1 ('shine rings').
 * - Wave constructor accepts HTMLAudioElement OR { context, source } for
 *   sharing an existing AudioContext (avoids cross-context issues).
 * - Wave.js has its own internal RAF loop that renders to the canvas.
 * - We render to an offscreen canvas, then blit to the target each frame.
 */

import type { Size, EngineRenderFrame, WebGLVisualizerEngine } from '../types'

/**
 * Mapping from user-friendly animation names to Wave.js v2 class names.
 * Wave.js v2 has 10 animation classes: Arcs, Circles, Cubes, Flower, Glob, Lines, Shine, Square, Turntable, Wave
 */
export type WaveJsAnimation =
  | 'shine'
  | 'circles'
  | 'lines'
  | 'arcs'
  | 'cubes'
  | 'flower'
  | 'glob'
  | 'square'
  | 'turntable'
  | 'wave'

export const WAVEJS_ANIMATIONS: { value: WaveJsAnimation; label: string }[] = [
  { value: 'shine', label: 'Shine' },
  { value: 'circles', label: 'Circles' },
  { value: 'lines', label: 'Lines' },
  { value: 'arcs', label: 'Arcs' },
  { value: 'cubes', label: 'Cubes' },
  { value: 'flower', label: 'Flower' },
  { value: 'glob', label: 'Glob' },
  { value: 'square', label: 'Square' },
  { value: 'turntable', label: 'Turntable' },
  { value: 'wave', label: 'Wave' },
]

/** Map WaveJsAnimation → Wave.js v2 class name on wave.animations */
const ANIM_CLASS_MAP: Record<WaveJsAnimation, string> = {
  shine: 'Shine',
  circles: 'Circles',
  lines: 'Lines',
  arcs: 'Arcs',
  cubes: 'Cubes',
  flower: 'Flower',
  glob: 'Glob',
  square: 'Square',
  turntable: 'Turntable',
  wave: 'Wave',
}

export interface WaveJsConfig {
  animation?: WaveJsAnimation
  colors?: string[]
  lineWidth?: number
}

export class WaveJsEngine implements WebGLVisualizerEngine {
  private waveInstance: any = null
  private canvas: HTMLCanvasElement | null = null
  private offscreenCanvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private size: Size = { width: 0, height: 0 }
  private config: WaveJsConfig
  private inited = false
  private destroyed = false
  /** Saved audio source for Wave.js constructor. */
  private audioSource: MediaElementAudioSourceNode | null = null
  private audioContext: AudioContext | null = null
  /** Guard to prevent concurrent startWaveJs calls. */
  private startingWave = false

  constructor(config: WaveJsConfig = {}) {
    this.config = {
      animation: 'shine',
      colors: ['#ff0066', '#00ccff', '#33ff66', '#ffcc00', '#cc66ff'],
      lineWidth: 2,
      ...config,
    }
  }

  async initWithCanvas(canvas: HTMLCanvasElement, size: Size): Promise<void> {
    this.canvas = canvas
    this.size = size
    this.destroyed = false

    // Tạo offscreen canvas để Wave.js render
    this.offscreenCanvas = document.createElement('canvas')
    this.offscreenCanvas.width = size.width
    this.offscreenCanvas.height = size.height

    // Prepare fallback ctx immediately
    this.ctx = this.offscreenCanvas.getContext('2d')

    this.inited = true
    console.log('[WaveJsEngine] Initialized, animation:', this.config.animation)
  }

  private async startWaveJs(): Promise<void> {
    if (!this.offscreenCanvas || this.destroyed || this.startingWave) return
    if (!this.audioSource || !this.audioContext) return

    this.startingWave = true
    try {
      const WaveModule = await import('@foobar404/wave')
      if (this.destroyed) { this.startingWave = false; return }

      // Wave.js v2 ESM import: mod.default = { Wave: WaveClass }
      // CJS require: mod = { Wave: WaveClass }
      // Need to extract the actual Wave constructor class.
      const Wave = WaveModule.default?.Wave || WaveModule.Wave || WaveModule.default || WaveModule

      // Clear any previous wave instance
      if (this.waveInstance) {
        try { this.waveInstance.clearAnimations?.() } catch {}
        this.waveInstance = null
      }

      // Wave.js v2: pass { context, source } to share existing AudioContext
      // This avoids creating a duplicate AudioContext + cross-context issues
      this.waveInstance = new Wave(
        { context: this.audioContext, source: this.audioSource },
        this.offscreenCanvas
      )

      // Create animation instance using v2 class constructor
      const animKey = this.config.animation || 'shine'
      const className = ANIM_CLASS_MAP[animKey] || 'Shine'
      const AnimClass = this.waveInstance.animations?.[className]

      if (AnimClass) {
        const colors = this.config.colors || ['#ff0066', '#00ccff']
        const animOpts: any = {
          lineColor: colors[0],
          lineWidth: this.config.lineWidth || 2,
          count: 100,
        }

        // Some animations support extra options
        if (['shine', 'circles', 'flower'].includes(animKey)) {
          animOpts.diameter = Math.min(this.size.width, this.size.height) * 0.6
        }
        if (['shine', 'lines', 'arcs', 'cubes', 'square'].includes(animKey)) {
          animOpts.fillColor = { gradient: colors }
        }

        const animInstance = new AnimClass(animOpts)
        this.waveInstance.addAnimation(animInstance)
        console.log('[WaveJsEngine] Wave.js v2 started with animation:', className)
      } else {
        console.warn(
          '[WaveJsEngine] Animation class not found:', className,
          '— available:', Object.keys(this.waveInstance.animations || {})
        )
        this.startFallbackRender()
      }
    } catch (err) {
      console.error('[WaveJsEngine] Failed to start Wave.js:', err)
      this.startFallbackRender()
    }
    this.startingWave = false
  }

  private startFallbackRender(): void {
    this.ctx = this.offscreenCanvas?.getContext('2d') || null
  }

  attachAudioSource(source: MediaElementAudioSourceNode, audioContext: AudioContext): void {
    this.audioSource = source
    this.audioContext = audioContext
    // Start Wave.js now that we have audio
    this.startWaveJs()
  }

  setAnimation(animation: WaveJsAnimation): void {
    this.config.animation = animation
    // Restart wave engine nếu đang chạy
    if (this.waveInstance) {
      try { this.waveInstance.clearAnimations?.() } catch {}
      this.waveInstance = null
    }
    if (this.audioSource && this.audioContext) {
      this.startWaveJs()
    }
  }

  resize(size: Size): void {
    this.size = size
    if (this.offscreenCanvas) {
      this.offscreenCanvas.width = size.width
      this.offscreenCanvas.height = size.height
    }
  }

  render(frame: EngineRenderFrame): void {
    if (!this.canvas || !this.inited) return

    if (this.offscreenCanvas) {
      const ctx = this.canvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, this.size.width, this.size.height)

        if (this.waveInstance && this.offscreenCanvas) {
          // Wave.js renders via its own RAF to offscreenCanvas → just blit
          ctx.drawImage(this.offscreenCanvas, 0, 0, this.size.width, this.size.height)
        } else if (this.ctx) {
          // Fallback render using our own visualization
          this.renderFallback(frame)
          ctx.drawImage(this.offscreenCanvas, 0, 0, this.size.width, this.size.height)
        }
      }
    }
  }

  private renderFallback(frame: EngineRenderFrame): void {
    if (!this.ctx || !this.offscreenCanvas) return
    const ctx = this.ctx
    const { width, height } = this.size
    const freq = frame.frequencyData
    const colors = this.config.colors || ['#ff0066', '#00ccff', '#33ff66']

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = 'rgba(0,0,0,0.85)'
    ctx.fillRect(0, 0, width, height)

    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) * 0.25
    const barCount = Math.min(freq.length, 128)

    for (let i = 0; i < barCount; i++) {
      const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2
      const val = freq[i] / 255
      const barLen = radius * 0.1 + val * radius * 0.9

      const x1 = cx + Math.cos(angle) * radius
      const y1 = cy + Math.sin(angle) * radius
      const x2 = cx + Math.cos(angle) * (radius + barLen)
      const y2 = cy + Math.sin(angle) * (radius + barLen)

      const colorIdx = Math.floor((i / barCount) * colors.length) % colors.length
      ctx.strokeStyle = colors[colorIdx]
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.5 + val * 0.5
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  destroy(): void {
    this.destroyed = true
    this.inited = false
    if (this.waveInstance) {
      try { this.waveInstance.clearAnimations?.() } catch {}
      this.waveInstance = null
    }
    this.offscreenCanvas = null
    this.canvas = null
    this.ctx = null
    this.audioSource = null
    this.audioContext = null
  }
}

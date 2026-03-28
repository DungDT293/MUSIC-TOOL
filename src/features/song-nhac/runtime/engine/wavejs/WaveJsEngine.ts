/**
 * Wave.js Engine — Multiple wave animation styles (Canvas 2D).
 *
 * Tích hợp @foobar404/wave (https://github.com/foobar404/Wave.js)
 * để render nhiều kiểu sóng đẹp mắt.
 *
 * Renders trực tiếp lên canvas WebGL context (dùng 2D fallback).
 */

import type { Size, EngineRenderFrame, WebGLVisualizerEngine } from '../types'

export type WaveJsAnimation =
  | 'wave'
  | 'bars'
  | 'bars blocks'
  | 'dualbars'
  | 'dualbars blocks'
  | 'fireworks'
  | 'flower'
  | 'flower blocks'
  | 'orbs'
  | 'ring'
  | 'rings'
  | 'round bars'
  | 'round wave'
  | 'shine'
  | 'shine rings'
  | 'star'
  | 'stitches'
  | 'web'

export const WAVEJS_ANIMATIONS: { value: WaveJsAnimation; label: string }[] = [
  { value: 'wave', label: 'Wave' },
  { value: 'bars', label: 'Bars' },
  { value: 'bars blocks', label: 'Bars Blocks' },
  { value: 'dualbars', label: 'Dual Bars' },
  { value: 'dualbars blocks', label: 'Dual Bars Blocks' },
  { value: 'fireworks', label: 'Fireworks' },
  { value: 'flower', label: 'Flower' },
  { value: 'flower blocks', label: 'Flower Blocks' },
  { value: 'orbs', label: 'Orbs' },
  { value: 'ring', label: 'Ring' },
  { value: 'rings', label: 'Rings' },
  { value: 'round bars', label: 'Round Bars' },
  { value: 'round wave', label: 'Round Wave' },
  { value: 'shine', label: 'Shine' },
  { value: 'shine rings', label: 'Shine Rings' },
  { value: 'star', label: 'Star' },
  { value: 'stitches', label: 'Stitches' },
  { value: 'web', label: 'Web' },
]

export interface WaveJsConfig {
  animation?: WaveJsAnimation
  colors?: string[]
  lineWidth?: number
}

export class WaveJsEngine implements WebGLVisualizerEngine {
  private wave: any = null
  private canvas: HTMLCanvasElement | null = null
  private offscreenCanvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private size: Size = { width: 0, height: 0 }
  private config: WaveJsConfig
  private inited = false
  private destroyed = false
  private audioElement: HTMLAudioElement | null = null
  private animationId: number | null = null

  constructor(config: WaveJsConfig = {}) {
    this.config = {
      animation: 'shine rings',
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

    this.inited = true
    console.log('[WaveJsEngine] Initialized, animation:', this.config.animation)
  }

  private async startWaveJs(): Promise<void> {
    if (!this.offscreenCanvas || !this.audioElement || this.destroyed) return
    try {
      const WaveModule = await import('@foobar404/wave')
      const Wave = WaveModule.default || WaveModule.Wave || WaveModule
      if (this.destroyed) return

      this.wave = new Wave(this.audioElement, this.offscreenCanvas)

      this.wave.addAnimation(
        this.wave.animations[this.config.animation as string] ||
          this.wave.animations['shine rings'],
        {
          lineColor: this.config.colors?.[0] || '#ff0066',
          lineWidth: this.config.lineWidth || 2,
          count: 100,
          fillColor: { gradient: this.config.colors || ['#ff0066', '#00ccff'] },
          diameter: Math.min(this.size.width, this.size.height) * 0.6,
        }
      )

      console.log('[WaveJsEngine] Wave.js started with animation:', this.config.animation)
    } catch (err) {
      console.error('[WaveJsEngine] Failed to start Wave.js:', err)
      // Fallback: tự render nếu Wave.js gặp lỗi
      this.startFallbackRender()
    }
  }

  private startFallbackRender(): void {
    // Fallback visualization khi Wave.js không hoạt động
    this.ctx = this.offscreenCanvas?.getContext('2d') || null
  }

  attachAudioSource(source: MediaElementAudioSourceNode, audioContext: AudioContext): void {
    // Wave.js cần HTMLAudioElement trực tiếp
    // Lấy từ source node
    const mediaEl = (source as any).mediaElement as HTMLAudioElement
    if (mediaEl) {
      this.audioElement = mediaEl
      this.startWaveJs()
    }
  }

  setAnimation(animation: WaveJsAnimation): void {
    this.config.animation = animation
    // Restart wave engine nếu đang chạy
    if (this.wave) {
      try {
        this.wave.clearAnimations?.()
      } catch {}
      this.wave = null
      if (this.audioElement) {
        this.startWaveJs()
      }
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

    // Nếu có Wave.js offscreen canvas, blit vào target
    if (this.offscreenCanvas) {
      const ctx = this.canvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, this.size.width, this.size.height)

        if (this.wave && this.offscreenCanvas) {
          ctx.drawImage(this.offscreenCanvas, 0, 0, this.size.width, this.size.height)
        } else if (this.ctx) {
          // Fallback render
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
    if (this.animationId != null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
    if (this.wave) {
      try {
        this.wave.clearAnimations?.()
      } catch {}
      this.wave = null
    }
    this.offscreenCanvas = null
    this.canvas = null
    this.ctx = null
    this.audioElement = null
  }
}

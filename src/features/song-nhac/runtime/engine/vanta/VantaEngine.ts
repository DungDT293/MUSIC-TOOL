/**
 * Vanta.js Engine — Beautiful 3D animated backgrounds (WebGL/Three.js).
 *
 * Tích hợp vanta (https://github.com/tengbao/vanta)
 * để render các background 3D ấn tượng: birds, waves, fog, net, rings, dots...
 * Audio-reactive: điều khiển speed/scale/color theo FFT data.
 */

// THREE lazy-loaded khi effect được khởi tạo
// Vanta cần THREE object nhưng chỉ khi user thực sự chọn Vanta engine
let _THREE: any = null
async function getThree() {
  if (!_THREE) _THREE = await import('three')
  return _THREE
}

import type { Size, EngineRenderFrame, WebGLVisualizerEngine } from '../types'

export type VantaEffect =
  | 'birds'
  | 'waves'
  | 'fog'
  | 'net'
  | 'rings'
  | 'dots'
  | 'globe'
  | 'cells'
  | 'trunk'
  | 'topology'
  | 'halo'

export const VANTA_EFFECTS: { value: VantaEffect; label: string }[] = [
  { value: 'waves', label: 'Waves (Sóng biển)' },
  { value: 'birds', label: 'Birds (Đàn chim)' },
  { value: 'fog', label: 'Fog (Sương mù)' },
  { value: 'net', label: 'Net (Lưới 3D)' },
  { value: 'rings', label: 'Rings (Vòng tròn)' },
  { value: 'dots', label: 'Dots (Chấm)' },
  { value: 'globe', label: 'Globe (Quả cầu)' },
  { value: 'cells', label: 'Cells (Tế bào)' },
  { value: 'trunk', label: 'Trunk (Thân cây)' },
  { value: 'topology', label: 'Topology (Địa hình)' },
  { value: 'halo', label: 'Halo (Vầng sáng)' },
]

export interface VantaConfig {
  effect?: VantaEffect
  color1?: number
  color2?: number
  backgroundColor?: number
  speed?: number
}

// Map: effect name → dynamic import function
const effectImports: Record<VantaEffect, () => Promise<any>> = {
  birds: () => import('vanta/dist/vanta.birds.min'),
  waves: () => import('vanta/dist/vanta.waves.min'),
  fog: () => import('vanta/dist/vanta.fog.min'),
  net: () => import('vanta/dist/vanta.net.min'),
  rings: () => import('vanta/dist/vanta.rings.min'),
  dots: () => import('vanta/dist/vanta.dots.min'),
  globe: () => import('vanta/dist/vanta.globe.min'),
  cells: () => import('vanta/dist/vanta.cells.min'),
  trunk: () => import('vanta/dist/vanta.trunk.min'),
  topology: () => import('vanta/dist/vanta.topology.min'),
  halo: () => import('vanta/dist/vanta.halo.min'),
}

export class VantaEngine implements WebGLVisualizerEngine {
  private vantaEffect: any = null
  private canvas: HTMLCanvasElement | null = null
  private container: HTMLDivElement | null = null
  private size: Size = { width: 0, height: 0 }
  private config: VantaConfig
  private inited = false
  private destroyed = false
  private currentEffect: VantaEffect

  // Audio-reactive smoothing
  private smoothBass = 0
  private smoothMid = 0
  private smoothTreble = 0

  constructor(config: VantaConfig = {}) {
    this.config = {
      effect: 'waves',
      color1: 0x0077be,
      color2: 0x00ccff,
      backgroundColor: 0x0a0a1e,
      speed: 1.0,
      ...config,
    }
    this.currentEffect = this.config.effect!
  }

  async initWithCanvas(canvas: HTMLCanvasElement, size: Size): Promise<void> {
    this.canvas = canvas
    this.size = size
    this.destroyed = false

    // Vanta cần một container DOM element
    this.container = document.createElement('div')
    this.container.style.position = 'fixed'
    this.container.style.left = '-9999px'
    this.container.style.top = '-9999px'
    this.container.style.width = `${size.width}px`
    this.container.style.height = `${size.height}px`
    this.container.style.overflow = 'hidden'
    document.body.appendChild(this.container)

    await this.loadEffect(this.currentEffect)
    this.inited = true
    console.log('[VantaEngine] Initialized with effect:', this.currentEffect)
  }

  private async loadEffect(effectName: VantaEffect): Promise<void> {
    // Cleanup previous
    if (this.vantaEffect) {
      try { this.vantaEffect.destroy() } catch {}
      this.vantaEffect = null
    }

    if (this.destroyed || !this.container) return

    try {
      const importFn = effectImports[effectName]
      if (!importFn) {
        console.error('[VantaEngine] Unknown effect:', effectName)
        return
      }

      // Lazy-load THREE và vanta effect song song
      const [THREE, vantaMod] = await Promise.all([getThree(), importFn()])
      if (this.destroyed) return

      const VantaFn = vantaMod.default || vantaMod

      // Cấu hình chung cho mọi effect
      const baseConfig: any = {
        el: this.container,
        THREE: THREE,
        mouseControls: false,
        touchControls: false,
        gyroControls: false,
        minHeight: this.size.height,
        minWidth: this.size.width,
        scale: 1.0,
        scaleMobile: 1.0,
        backgroundColor: this.config.backgroundColor,
      }

      // Config riêng từng effect
      switch (effectName) {
        case 'waves':
          Object.assign(baseConfig, {
            color: this.config.color1,
            shininess: 50,
            waveHeight: 15,
            waveSpeed: this.config.speed || 0.8,
            zoom: 0.9,
          })
          break
        case 'birds':
          Object.assign(baseConfig, {
            color1: this.config.color1,
            color2: this.config.color2,
            quantity: 4,
            birdSize: 1.2,
            wingSpan: 25,
            speedLimit: 4,
            separation: 50,
            alignment: 30,
            cohesion: 25,
          })
          break
        case 'fog':
          Object.assign(baseConfig, {
            highlightColor: this.config.color1,
            midtoneColor: this.config.color2,
            lowlightColor: 0x000022,
            baseColor: this.config.backgroundColor,
            blurFactor: 0.6,
            speed: this.config.speed || 1.5,
            zoom: 1,
          })
          break
        case 'net':
          Object.assign(baseConfig, {
            color: this.config.color1,
            points: 10,
            maxDistance: 25,
            spacing: 16,
            showDots: true,
          })
          break
        case 'rings':
          Object.assign(baseConfig, {
            color: this.config.color1,
            backgroundColor: this.config.backgroundColor,
          })
          break
        case 'dots':
          Object.assign(baseConfig, {
            color: this.config.color1,
            color2: this.config.color2,
            size: 3,
            spacing: 35,
          })
          break
        case 'globe':
          Object.assign(baseConfig, {
            color: this.config.color1,
            color2: this.config.color2,
            size: 1.2,
          })
          break
        case 'cells':
          Object.assign(baseConfig, {
            color1: this.config.color1,
            color2: this.config.color2,
            size: 1.5,
            speed: this.config.speed || 1,
          })
          break
        case 'trunk':
          Object.assign(baseConfig, {
            color: this.config.color1,
            spacing: 2,
            chaos: 3,
          })
          break
        case 'topology':
          Object.assign(baseConfig, {
            color: this.config.color1,
            backgroundColor: this.config.backgroundColor,
          })
          break
        case 'halo':
          Object.assign(baseConfig, {
            baseColor: this.config.color1,
            backgroundColor: this.config.backgroundColor,
            size: 1.5,
          })
          break
      }

      this.vantaEffect = VantaFn(baseConfig)
      this.currentEffect = effectName
    } catch (err) {
      console.error(`[VantaEngine] Failed to load effect "${effectName}":`, err)
    }
  }

  async setEffect(effectName: VantaEffect): Promise<void> {
    if (effectName === this.currentEffect && this.vantaEffect) return
    await this.loadEffect(effectName)
  }

  getCurrentEffect(): VantaEffect {
    return this.currentEffect
  }

  attachAudioSource(source: MediaElementAudioSourceNode, audioContext: AudioContext): void {
    // Vanta không cần audio source trực tiếp — dùng FFT data từ render frame
  }

  resize(size: Size): void {
    this.size = size
    if (this.container) {
      this.container.style.width = `${size.width}px`
      this.container.style.height = `${size.height}px`
    }
    if (this.vantaEffect) {
      try { this.vantaEffect.resize?.() } catch {}
    }
  }

  render(frame: EngineRenderFrame): void {
    if (!this.canvas || !this.inited || !this.container) return

    // Audio-reactive: điều khiển Vanta params theo FFT
    const freq = frame.frequencyData
    if (freq.length > 0 && this.vantaEffect) {
      // Tính bass / mid / treble
      let bass = 0, mid = 0, treble = 0
      const len = freq.length
      const bassEnd = Math.floor(len * 0.15)
      const midEnd = Math.floor(len * 0.5)

      for (let i = 0; i < bassEnd; i++) bass += freq[i]
      for (let i = bassEnd; i < midEnd; i++) mid += freq[i]
      for (let i = midEnd; i < len; i++) treble += freq[i]

      bass = (bass / (bassEnd * 255)) || 0
      mid = (mid / ((midEnd - bassEnd) * 255)) || 0
      treble = (treble / ((len - midEnd) * 255)) || 0

      // Smooth
      this.smoothBass += (bass - this.smoothBass) * 0.15
      this.smoothMid += (mid - this.smoothMid) * 0.12
      this.smoothTreble += (treble - this.smoothTreble) * 0.1

      // Update Vanta options based on audio
      try {
        const opts: any = {}
        switch (this.currentEffect) {
          case 'waves':
            opts.waveHeight = 10 + this.smoothBass * 30
            opts.waveSpeed = 0.5 + this.smoothMid * 2
            break
          case 'birds':
            opts.speedLimit = 2 + this.smoothBass * 8
            opts.birdSize = 0.8 + this.smoothMid * 2
            break
          case 'fog':
            opts.speed = 0.5 + this.smoothBass * 4
            opts.blurFactor = 0.3 + this.smoothMid * 0.5
            break
          case 'net':
            opts.maxDistance = 15 + this.smoothBass * 30
            break
          case 'cells':
            opts.speed = 0.5 + this.smoothBass * 3
            break
        }
        this.vantaEffect.setOptions?.(opts)
      } catch {}
    }

    // Blit vanta container canvas vào target canvas
    try {
      const vantaCanvas = this.container.querySelector('canvas') as HTMLCanvasElement
      if (vantaCanvas) {
        const ctx = this.canvas.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, this.size.width, this.size.height)
          ctx.drawImage(vantaCanvas, 0, 0, this.size.width, this.size.height)
        }
      }
    } catch {}
  }

  destroy(): void {
    this.destroyed = true
    this.inited = false
    if (this.vantaEffect) {
      try { this.vantaEffect.destroy() } catch {}
      this.vantaEffect = null
    }
    if (this.container?.parentNode) {
      this.container.parentNode.removeChild(this.container)
    }
    this.container = null
    this.canvas = null
  }
}

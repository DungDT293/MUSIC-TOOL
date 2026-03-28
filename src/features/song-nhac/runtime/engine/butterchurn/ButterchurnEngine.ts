/**
 * Butterchurn Engine — MilkDrop 2 presets (WebGL).
 *
 * Tích hợp butterchurn (https://github.com/jberg/butterchurn)
 * để render 2000+ MilkDrop preset lên WebGL canvas.
 *
 * Implements WebGLVisualizerEngine interface.
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
  // butterchurn-presets exports either a function (CJS) or object (ESM)
  let rawPresets = presetsModule.default || presetsModule
  if (typeof rawPresets === 'function') {
    rawPresets = rawPresets()
  }
  return {
    butterchurn: bc,
    presets: rawPresets as Record<string, any>,
  }
}

export interface ButterchurnConfig {
  presetName?: string
  /** Thời gian chuyển preset (giây). */
  blendDuration?: number
}

export class ButterchurnEngine implements WebGLVisualizerEngine {
  private visualizer: any = null
  private canvas: HTMLCanvasElement | null = null
  private size: Size = { width: 0, height: 0 }
  private audioContext: AudioContext | null = null
  private audioSource: MediaElementAudioSourceNode | null = null
  private presets: Record<string, any> = {}
  private presetNames: string[] = []
  private currentPresetName = ''
  private config: ButterchurnConfig
  private initPromise: Promise<void> | null = null
  private inited = false
  private destroyed = false

  constructor(config: ButterchurnConfig = {}) {
    this.config = config
  }

  async initWithCanvas(canvas: HTMLCanvasElement, size: Size): Promise<void> {
    this.canvas = canvas
    this.size = size
    this.destroyed = false

    // Init butterchurn asynchronously
    this.initPromise = this._doInit(canvas, size)
    await this.initPromise
  }

  private async _doInit(canvas: HTMLCanvasElement, size: Size): Promise<void> {
    try {
      const { butterchurn, presets } = await loadButterchurn()
      if (this.destroyed) return

      this.presets = presets
      this.presetNames = Object.keys(presets)

      if (this.presetNames.length === 0) {
        console.warn('[ButterchurnEngine] No presets available')
        return
      }

      // Create visualizer
      this.visualizer = butterchurn.createVisualizer(
        this.audioContext || new AudioContext(),
        canvas,
        {
          width: size.width,
          height: size.height,
          pixelRatio: 1,
          textureRatio: 1,
        }
      )

      // Load initial preset
      const presetName = this.config.presetName && this.presets[this.config.presetName]
        ? this.config.presetName
        : this.presetNames[Math.floor(Math.random() * this.presetNames.length)]

      this.loadPreset(presetName, false)
      this.inited = true
      console.log(`[ButterchurnEngine] Initialized with ${this.presetNames.length} presets, active: ${presetName}`)
    } catch (err) {
      console.error('[ButterchurnEngine] Init failed:', err)
    }
  }

  loadPreset(name: string, blend = true): void {
    if (!this.visualizer || !this.presets[name]) return
    this.currentPresetName = name
    const duration = blend ? (this.config.blendDuration ?? 2.0) : 0
    this.visualizer.loadPreset(this.presets[name], duration)
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
    if (this.visualizer) {
      this.visualizer.connectAudio(source)
    }
  }

  resize(size: Size): void {
    this.size = size
    if (this.visualizer) {
      this.visualizer.setRendererSize(size.width, size.height)
    }
  }

  render(frame: EngineRenderFrame): void {
    if (!this.visualizer || !this.inited) return
    try {
      this.visualizer.render()
    } catch (err) {
      // Butterchurn render error — skip frame silently
    }
  }

  destroy(): void {
    this.destroyed = true
    this.inited = false
    if (this.visualizer) {
      try {
        this.visualizer.dispose?.()
      } catch {}
      this.visualizer = null
    }
    this.canvas = null
    this.audioContext = null
    this.audioSource = null
    this.presets = {}
    this.presetNames = []
  }
}

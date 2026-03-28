/**
 * Chức năng 13 — EngineHost: giữ activeEngine, forward resize / render.
 */

import type { VisualizerEngine, Size, EngineRenderFrame } from './types'

const EMPTY_FREQ = new Uint8Array(128)
const EMPTY_WAVE = new Uint8Array(128)

export class EngineHost {
  private engine: VisualizerEngine | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private size: Size = { width: 0, height: 0 }
  private inited = false

  setEngine(engine: VisualizerEngine | null): void {
    if (this.engine) {
      this.engine.destroy()
      this.engine = null
      this.inited = false
    }
    this.engine = engine
    if (engine && this.ctx && this.size.width > 0) {
      engine.init(this.ctx, this.size)
      this.inited = true
    }
  }

  init(ctx: CanvasRenderingContext2D, size: Size): void {
    this.ctx = ctx
    this.size = size
    if (this.engine && size.width > 0 && size.height > 0) {
      this.engine.init(ctx, size)
      this.inited = true
    }
  }

  isInited(): boolean {
    return this.inited
  }

  resize(size: Size): void {
    this.size = size
    this.engine?.resize(size)
  }

  render(frame: EngineRenderFrame): void {
    if (!this.engine) return
    this.engine.render(frame)
  }

  destroy(): void {
    this.engine?.destroy()
    this.engine = null
    this.ctx = null
    this.inited = false
  }

  static emptyFrame(timeSec: number): EngineRenderFrame {
    return {
      timeSec,
      frequencyData: EMPTY_FREQ,
      waveformData: EMPTY_WAVE,
    }
  }
}

/**
 * Chức năng 13 — Engine đầu tiên: bars theo FFT (Avee-style).
 * Chỉ biết time + FFT → vẽ; không React / Zustand / Export.
 */

import type { VisualizerEngine, Size, EngineRenderFrame } from '../types'

export class WaveBarsEngine implements VisualizerEngine {
  private ctx: CanvasRenderingContext2D | null = null
  private size: Size = { width: 0, height: 0 }
  private barCount = 32
  private gap = 2

  init(ctx: CanvasRenderingContext2D, size: Size): void {
    this.ctx = ctx
    this.size = size
  }

  resize(size: Size): void {
    this.size = size
  }

  render(frame: EngineRenderFrame): void {
    const { ctx, size } = this
    if (!ctx || size.width <= 0 || size.height <= 0) return

    const { frequencyData } = frame
    ctx.clearRect(0, 0, size.width, size.height)

    const totalGap = (this.barCount - 1) * this.gap
    const barWidth = (size.width - totalGap) / this.barCount
    const step = Math.max(1, Math.floor(frequencyData.length / this.barCount))
    const centerY = size.height / 2
    const maxHeight = size.height / 2 - 4

    for (let i = 0; i < this.barCount; i++) {
      let sum = 0
      const start = i * step
      for (let j = 0; j < step && start + j < frequencyData.length; j++) {
        sum += frequencyData[start + j]
      }
      const avg = step > 0 ? sum / step : 0
      const norm = avg / 255
      const h = Math.max(2, norm * maxHeight)
      const x = i * (barWidth + this.gap)
      const yTop = centerY - h
      const yBottom = centerY + h

      ctx.fillStyle = `rgba(100, 180, 255, ${0.4 + norm * 0.5})`
      ctx.fillRect(x, yTop, barWidth, h)
      ctx.fillRect(x, centerY, barWidth, h)
    }
  }

  destroy(): void {
    this.ctx = null
    this.size = { width: 0, height: 0 }
  }
}

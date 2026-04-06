/**
 * Wave Style: Thanh (bars)
 * Icon: 📊
 * Category: basic
 *
 * V2: Nang cap — gradient fill, bar tip glow, beat pulse width, rounded cap highlight.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveLinearGrad, resolveColorRgba, applyGlow, clearGlow, speedShift } from './helpers'
import { registerWave } from './registry'

function drawWaveBars(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  if (samples.length < 4) return
  const halfW = w / 2, halfH = h / 2
  const size = Math.max(w, h)
  const maxOffset = getMaxOffset(w, h) * amplitude
  const barsPerEdge = Math.max(8, Math.min(60, Math.round((vc?.barCount ?? 112) / 4)))
  const totalBars = barsPerEdge * 4
  const shift = speedShift((animTimeMs() * 0.00012) % 1, vc?.speed)
  const bt = beat ?? 0

  // Beat pulse: scale bar width by 1.15x on strong beats
  const beatPulse = 1 + bt * 0.15

  const edgeG: [number, number, number, number][] = [
    [-halfW, -halfH, halfW, -halfH],
    [halfW, -halfH, halfW, halfH],
    [halfW, halfH, -halfW, halfH],
    [-halfW, halfH, -halfW, -halfH],
  ]

  ctx.save()
  ctx.lineCap = 'round'

  for (let edge = 0; edge < 4; edge++) {
    const isHoriz = edge === 0 || edge === 2
    const edgeLen = isHoriz ? w : h
    const spacing = edgeLen / (barsPerEdge + 1)
    const barW = Math.max(size * 0.003, spacing * 0.45) * beatPulse
    const [gx0, gy0, gx1, gy1] = edgeG[edge]!
    const eShift = (shift + edge * 0.25) % 1

    const barData: { pos: number; t: number; len: number; colorT: number }[] = []
    for (let j = 0; j < barsPerEdge; j++) {
      const mj = j < barsPerEdge / 2 ? j : barsPerEdge - 1 - j
      const gi = edge * barsPerEdge + mj
      const raw = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, gi, totalBars)
        : getSampleAt(samples, Math.floor(gi * WAVE_SEGMENTS / totalBars))
      const t = Math.pow(raw, 1.3)
      const colorT = (j / barsPerEdge + eShift) % 1
      barData.push({ pos: (j + 1) * spacing, t, len: Math.max(size * 0.005, t * maxOffset), colorT })
    }

    // Pass 1: Wide soft glow
    ctx.lineWidth = barW * 2.2
    ctx.strokeStyle = resolveLinearGrad(ctx, gx0, gy0, gx1, gy1, eShift, 0.25, vc)
    if (vc?.glowEnabled) applyGlow(ctx, eShift, vc, bt)
    ctx.beginPath()
    for (const { pos, t, len } of barData) {
      if (t < 0.04) continue
      let sx: number, sy: number, ex: number, ey: number
      if (edge === 0) { sx = -halfW + pos; sy = -halfH; ex = sx; ey = sy - len }
      else if (edge === 1) { sx = halfW; sy = -halfH + pos; ex = sx + len; ey = sy }
      else if (edge === 2) { sx = -halfW + pos; sy = halfH; ex = sx; ey = sy + len }
      else { sx = -halfW; sy = -halfH + pos; ex = sx - len; ey = sy }
      ctx.moveTo(sx, sy)
      ctx.lineTo(ex, ey)
    }
    ctx.stroke()
    if (vc?.glowEnabled) clearGlow(ctx)

    // Pass 2: Sharp bars with gradient
    ctx.lineWidth = barW
    ctx.strokeStyle = resolveLinearGrad(ctx, gx0, gy0, gx1, gy1, eShift, 0.92, vc)
    ctx.beginPath()
    for (const { pos, t, len } of barData) {
      if (t < 0.02) continue
      let sx: number, sy: number, ex: number, ey: number
      if (edge === 0) { sx = -halfW + pos; sy = -halfH; ex = sx; ey = sy - len }
      else if (edge === 1) { sx = halfW; sy = -halfH + pos; ex = sx + len; ey = sy }
      else if (edge === 2) { sx = -halfW + pos; sy = halfH; ex = sx; ey = sy + len }
      else { sx = -halfW; sy = -halfH + pos; ex = sx - len; ey = sy }
      ctx.moveTo(sx, sy)
      ctx.lineTo(ex, ey)
    }
    ctx.stroke()

    // Pass 3: Bar tip highlight dots — bright circle at the end of tall bars
    for (const { pos, t, len, colorT } of barData) {
      if (t < 0.35) continue
      let ex: number, ey: number
      if (edge === 0) { ex = -halfW + pos; ey = -halfH - len }
      else if (edge === 1) { ex = halfW + len; ey = -halfH + pos }
      else if (edge === 2) { ex = -halfW + pos; ey = halfH + len }
      else { ex = -halfW - len; ey = halfH - pos }
      const tipR = barW * (0.6 + t * 0.8)
      ctx.beginPath()
      ctx.arc(ex, ey, tipR, 0, Math.PI * 2)
      ctx.fillStyle = resolveColorRgba(colorT, 0.6 + t * 0.4, vc)
      ctx.fill()
    }
  }

  ctx.restore()
}

// === Registration ===
registerWave('bars', drawWaveBars, {
  id: 'bars',
  label: 'Thanh',
  icon: '📊',
  category: 'basic',
})

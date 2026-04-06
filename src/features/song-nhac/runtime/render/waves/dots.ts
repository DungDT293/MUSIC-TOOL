/**
 * Wave Style: Cham (dots)
 * Icon: ·
 * Category: basic
 *
 * V2: Pulsating dots (sin wave offset), arc connections, outer micro-dot ring.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba, applyGlow, clearGlow, speedShift } from './helpers'
import { registerWave } from './registry'

function drawWaveDots(
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
  const maxOff = getMaxOffset(w, h) * amplitude * 0.7
  const dotsPerEdge = 18
  const totalDots = dotsPerEdge * 4
  const shift = speedShift((animTimeMs() * 0.00012) % 1, vc?.speed)
  const time = animTimeMs()
  const maxDotR = size * 0.013
  const minDotR = size * 0.004
  const bt = beat ?? 0

  // Pre-compute all dot positions with pulsating radius
  const dots: { x: number; y: number; t: number; rad: number }[] = []
  for (let i = 0; i < totalDots; i++) {
    const rawT = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, i, totalDots)
      : getSampleAt(samples, Math.floor(i * WAVE_SEGMENTS / totalDots))
    const t = Math.pow(rawT, 1.15)
    const offset = maxOff * (0.08 + 0.92 * t)
    // Pulsating: each dot has its own sine phase
    const pulse = 1 + 0.2 * Math.sin(time * 0.004 + i * 0.4)
    const rad = (minDotR + t * (maxDotR - minDotR)) * pulse
    const edge = Math.floor(i / dotsPerEdge)
    const f = ((i % dotsPerEdge) + 0.5) / dotsPerEdge

    let cx_: number, cy_: number
    if (edge === 0) { cx_ = -halfW + f * w; cy_ = -halfH - offset }
    else if (edge === 1) { cx_ = halfW + offset; cy_ = -halfH + f * h }
    else if (edge === 2) { cx_ = halfW - f * w; cy_ = halfH + offset }
    else { cx_ = -halfW - offset; cy_ = halfH - f * h }

    dots.push({ x: cx_, y: cy_, t, rad })
  }

  ctx.save()

  // Batch dots by edge (4 draws instead of 72)
  for (let edge = 0; edge < 4; edge++) {
    const start = edge * dotsPerEdge, end = start + dotsPerEdge
    const midT = (((edge * dotsPerEdge + dotsPerEdge / 2) / totalDots) + shift) % 1

    ctx.fillStyle = resolveColorRgba(midT, 0.85, vc)
    if (vc?.glowEnabled) applyGlow(ctx, midT, vc, bt)
    ctx.beginPath()
    for (let i = start; i < end; i++) {
      const d = dots[i]!
      if (d.t < 0.03) continue
      ctx.moveTo(d.x + d.rad, d.y)
      ctx.arc(d.x, d.y, d.rad, 0, Math.PI * 2)
    }
    ctx.fill()
    if (vc?.glowEnabled) clearGlow(ctx)
  }

  // Arc connections — curved lines between adjacent dots (replaces straight lines)
  ctx.lineCap = 'round'
  for (let edge = 0; edge < 4; edge++) {
    const start = edge * dotsPerEdge, end = start + dotsPerEdge
    const midT = (((edge * dotsPerEdge + dotsPerEdge / 2) / totalDots) + shift) % 1
    ctx.strokeStyle = resolveColorRgba(midT, 0.18, vc)
    ctx.lineWidth = size * 0.0015
    for (let i = start; i < end - 1; i++) {
      const a = dots[i]!, b = dots[i + 1]!
      const avgT = (a.t + b.t) / 2
      if (avgT < 0.12) continue
      // Curve via quadratic bezier — control point offset perpendicular
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const dx = b.x - a.x, dy = b.y - a.y
      const len = Math.sqrt(dx * dx + dy * dy)
      const nx = -dy / (len || 1), ny = dx / (len || 1)
      const curvature = size * 0.008 * avgT
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.quadraticCurveTo(mx + nx * curvature, my + ny * curvature, b.x, b.y)
      ctx.stroke()
    }
  }

  // Outer micro-dots: smaller, fainter ring beyond the main dots
  const microDotsPerEdge = 12
  const microR = size * 0.0025
  for (let edge = 0; edge < 4; edge++) {
    const midT = (((edge * dotsPerEdge + dotsPerEdge / 2) / totalDots) + shift) % 1
    ctx.fillStyle = resolveColorRgba(midT, 0.3, vc)
    ctx.beginPath()
    for (let j = 0; j < microDotsPerEdge; j++) {
      const f = (j + 0.5) / microDotsPerEdge
      const microOff = maxOff * 1.2
      let mx: number, my: number
      if (edge === 0) { mx = -halfW + f * w; my = -halfH - microOff }
      else if (edge === 1) { mx = halfW + microOff; my = -halfH + f * h }
      else if (edge === 2) { mx = halfW - f * w; my = halfH + microOff }
      else { mx = -halfW - microOff; my = halfH - f * h }
      ctx.moveTo(mx + microR, my)
      ctx.arc(mx, my, microR, 0, Math.PI * 2)
    }
    ctx.fill()
  }

  ctx.restore()
}

// === Registration ===
registerWave('dots', drawWaveDots, {
  id: 'dots',
  label: 'Cham',
  icon: '·',
  category: 'basic',
})

/**
 * Wave Style: Duong (line)
 * Icon: 〰️
 * Category: basic
 *
 * V2: Multi-layer depth effect (3 lines), breathing line width (bass), improved smoothness.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveConicGrad, applyGlow, clearGlow, speedShift, smoothPath } from './helpers'
import { registerWave } from './registry'

function drawWaveLine(
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
  const maxOff = getMaxOffset(w, h) * amplitude
  const margin = size * 0.006
  const shift = speedShift((animTimeMs() * 0.00015) % 1, vc?.speed)
  const segs = 48
  const bt = beat ?? 0
  const bassEnergy = bands?.bass ?? 0

  // Breathing: line width pulses with bass
  const breathScale = 1 + bassEnergy * 0.3

  // Build base points
  function buildPts(offsetScale: number): [number, number][] {
    const pts: [number, number][] = []
    for (let i = 0; i < segs; i++) {
      const rawT = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, i, segs)
        : getSampleAt(samples, Math.floor(i * WAVE_SEGMENTS / segs))
      const t = rawT * rawT
      const r = (margin + maxOff * (0.03 + 0.97 * t)) * offsetScale
      const perimT = i / segs
      const side = Math.floor(perimT * 4) % 4
      const f = (perimT * 4) % 1
      if (side === 0)      pts.push([-halfW + f * w, -halfH - r])
      else if (side === 1) pts.push([halfW + r,      -halfH + f * h])
      else if (side === 2) pts.push([halfW - f * w,   halfH + r])
      else                 pts.push([-halfW - r,       halfH - f * h])
    }
    return pts
  }

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Layer 1 (outer, faint, large offset) — depth background
  const pts1 = buildPts(1.15)
  ctx.beginPath()
  smoothPath(ctx, pts1, true)
  ctx.strokeStyle = resolveConicGrad(ctx, (shift + 0.1) % 1, 0.12, vc)
  ctx.lineWidth = size * 0.008 * breathScale
  ctx.stroke()

  // Layer 2 (middle) — main line
  const pts2 = buildPts(1.0)

  // Pass 1: Wide soft glow
  ctx.beginPath()
  smoothPath(ctx, pts2, true)
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 0.25, vc)
  ctx.lineWidth = size * 0.014 * breathScale
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, bt)
  ctx.stroke()
  if (vc?.glowEnabled) clearGlow(ctx)

  // Pass 2: Bright core
  ctx.beginPath()
  smoothPath(ctx, pts2, true)
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 1, vc)
  ctx.lineWidth = size * 0.0035 * breathScale
  ctx.stroke()

  // Layer 3 (inner, subtle) — inner depth
  const pts3 = buildPts(0.7)
  ctx.beginPath()
  smoothPath(ctx, pts3, true)
  ctx.strokeStyle = resolveConicGrad(ctx, (shift + 0.2) % 1, 0.1, vc)
  ctx.lineWidth = size * 0.005 * breathScale
  ctx.stroke()

  ctx.restore()
}

// === Registration ===
registerWave('line', drawWaveLine, {
  id: 'line',
  label: 'Duong',
  icon: '〰️',
  category: 'basic',
})

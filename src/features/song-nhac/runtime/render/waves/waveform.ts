/**
 * Wave Style: Song am (waveform)
 * Icon: ~
 * Category: basic
 *
 * V2: Multi-band fill (bass/mid/treble layers), gradient fill, peak markers at loudest points.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveConicGrad, resolveColorRgba, applyGlow, clearGlow, speedShift, smoothPath } from './helpers'
import { registerWave } from './registry'

function drawWaveWaveform(
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
  const margin = size * 0.004
  const shift = speedShift((animTimeMs() * 0.00015) % 1, vc?.speed)
  const segs = 48
  const bt = beat ?? 0
  const bassE = bands?.bass ?? 0
  const trebleE = bands?.treble ?? 0

  // Helper: compute perimeter point + normal direction
  function perimPoint(i: number, r: number): [number, number] {
    const perimT = i / segs
    const side = Math.floor(perimT * 4) % 4
    const f = (perimT * 4) % 1
    let px: number, py: number, nx: number, ny: number
    if (side === 0) { px = -halfW + f * w; py = -halfH; nx = 0; ny = -1 }
    else if (side === 1) { px = halfW; py = -halfH + f * h; nx = 1; ny = 0 }
    else if (side === 2) { px = halfW - f * w; py = halfH; nx = 0; ny = 1 }
    else { px = -halfW; py = halfH - f * h; nx = -1; ny = 0 }
    return [px + nx * r, py + ny * r]
  }

  // Build raw spectrum values + points for 3 layers
  const rawVals: number[] = []
  const outerPts: [number, number][] = []
  const midPts: [number, number][] = []
  const innerPts: [number, number][] = []
  const basePts: [number, number][] = []

  for (let i = 0; i < segs; i++) {
    const rawT = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, i, segs)
      : getSampleAt(samples, Math.floor(i * WAVE_SEGMENTS / segs))
    const t = rawT * rawT
    rawVals.push(t)
    const rOuter = margin + maxOff * (0.06 + 0.94 * t)
    const rMid = margin + maxOff * (0.04 + 0.55 * t * (0.5 + bassE * 0.5))
    const rInner = margin + maxOff * (0.02 + 0.3 * t * (0.3 + trebleE * 0.7))
    const rBase = margin + maxOff * 0.02 * t
    outerPts.push(perimPoint(i, rOuter))
    midPts.push(perimPoint(i, rMid))
    innerPts.push(perimPoint(i, rInner))
    basePts.push(perimPoint(i, rBase))
  }

  ctx.save()

  // Layer 1: Inner band fill (treble-reactive, faint)
  ctx.beginPath()
  ctx.moveTo(innerPts[0]![0], innerPts[0]![1])
  for (let i = 1; i < segs; i++) ctx.lineTo(innerPts[i]![0], innerPts[i]![1])
  const revBase = [...basePts].reverse()
  for (const [x, y] of revBase) ctx.lineTo(x, y)
  ctx.closePath()
  ctx.fillStyle = resolveConicGrad(ctx, (shift + 0.4) % 1, 0.06, vc)
  ctx.fill()

  // Layer 2: Mid band fill (bass-reactive)
  ctx.beginPath()
  ctx.moveTo(midPts[0]![0], midPts[0]![1])
  for (let i = 1; i < segs; i++) ctx.lineTo(midPts[i]![0], midPts[i]![1])
  const revInner = [...innerPts].reverse()
  for (const [x, y] of revInner) ctx.lineTo(x, y)
  ctx.closePath()
  ctx.fillStyle = resolveConicGrad(ctx, (shift + 0.2) % 1, 0.07, vc)
  ctx.fill()

  // Layer 3: Outer band fill (full spectrum)
  ctx.beginPath()
  smoothPath(ctx, outerPts, false)
  const revMid = [...midPts].reverse()
  for (let i = 0; i < revMid.length; i++) {
    const [x, y] = revMid[i]!
    if (i === 0) ctx.lineTo(x, y)
    else {
      const prev = revMid[i - 1]!
      ctx.quadraticCurveTo(prev[0], prev[1], (prev[0] + x) / 2, (prev[1] + y) / 2)
    }
  }
  ctx.closePath()
  ctx.fillStyle = resolveConicGrad(ctx, shift, 0.1, vc)
  ctx.fill()

  // Pass 1: Wide glow
  ctx.beginPath()
  smoothPath(ctx, outerPts, true)
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 0.3, vc)
  ctx.lineWidth = size * 0.009
  ctx.lineJoin = 'round'
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, bt)
  ctx.stroke()
  if (vc?.glowEnabled) clearGlow(ctx)

  // Pass 2: Sharp core
  ctx.beginPath()
  smoothPath(ctx, outerPts, true)
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 1, vc)
  ctx.lineWidth = size * 0.0025
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()

  // Peak markers: bright dots at the loudest spectrum points
  const threshold = 0.5
  for (let i = 0; i < segs; i++) {
    if (rawVals[i]! < threshold) continue
    const pt = outerPts[i]!
    const peakR = size * 0.004 * (0.5 + rawVals[i]! * 1.0)
    const colorT = (i / segs + shift) % 1
    ctx.beginPath()
    ctx.arc(pt[0], pt[1], peakR, 0, Math.PI * 2)
    ctx.fillStyle = resolveColorRgba(colorT, 0.6 + rawVals[i]! * 0.4, vc)
    ctx.fill()
  }

  ctx.restore()
}

// === Registration ===
registerWave('waveform', drawWaveWaveform, {
  id: 'waveform',
  label: 'Song am',
  icon: '~',
  category: 'basic',
})

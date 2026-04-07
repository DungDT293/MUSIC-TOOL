/**
 * Wave Style: Vanh (ring)
 * Icon: ⭕
 * Category: basic
 *
 * V2: Dual ring (treble-reactive inner ring), pulsing fill, rotating glow spots.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveConicGrad, resolveColorRgba, applyGlow, clearGlow, speedShift, smoothPath } from './helpers'
import { registerWave } from './registry'

function drawWaveRing(
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
  const size = Math.max(w, h)
  const baseR = Math.sqrt(w * w + h * h) / 2 + size * 0.005
  const maxOff = getMaxOffset(w, h) * amplitude * 1.2
  const shift = speedShift((animTimeMs() * 0.00015) % 1, vc?.speed)
  const ringSegs = 56
  const bt = beat ?? 0
  const treble = bands?.treble ?? 0

  const outerPts: [number, number][] = []
  const innerPts: [number, number][] = []
  for (let i = 0; i < ringSegs; i++) {
    const mi = i < ringSegs / 2 ? i : ringSegs - 1 - i
    const rawT = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, mi, ringSegs / 2)
      : getSampleAt(samples, Math.floor((mi / (ringSegs / 2)) * WAVE_SEGMENTS))
    const t = Math.pow(rawT, 0.85)
    const outer = baseR + t * maxOff
    const inner = baseR + t * maxOff * 0.15
    const angle = (i / ringSegs) * Math.PI * 2 - Math.PI / 2
    const cos = Math.cos(angle), sin = Math.sin(angle)
    outerPts.push([cos * outer, sin * outer])
    innerPts.push([cos * inner, sin * inner])
  }

  ctx.save()

  // Filled band (semi-transparent, pulsing with beat)
  const fillAlpha = 0.07 + bt * 0.08
  ctx.beginPath()
  const n = outerPts.length
  ctx.moveTo(outerPts[0]![0], outerPts[0]![1])
  for (let i = 1; i < n; i++) ctx.lineTo(outerPts[i]![0], outerPts[i]![1])
  const revInner = [...innerPts].reverse()
  for (let i = 0; i < revInner.length; i++) {
    ctx.lineTo(revInner[i]![0], revInner[i]![1])
  }
  ctx.closePath()
  ctx.fillStyle = resolveConicGrad(ctx, shift, fillAlpha, vc)
  ctx.fill()

  // Pass 1: Wide soft glow (outer ring)
  ctx.beginPath()
  smoothPath(ctx, outerPts, true)
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 0.3, vc)
  ctx.lineWidth = size * 0.01
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, bt)
  ctx.stroke()
  if (vc?.glowEnabled) clearGlow(ctx)

  // Pass 2: Sharp core (outer ring)
  ctx.beginPath()
  smoothPath(ctx, outerPts, true)
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 1, vc)
  ctx.lineWidth = size * 0.0025
  ctx.stroke()

  // Inner ring — treble-reactive, smaller radius
  const innerRingR = baseR * 0.65
  const innerRingOff = maxOff * 0.5
  const innerRingPts: [number, number][] = []
  for (let i = 0; i < ringSegs; i++) {
    // Use higher spectrum bins for treble
    const mi = i < ringSegs / 2 ? i + ringSegs / 4 : ringSegs - 1 - i + ringSegs / 4
    const rawT = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, Math.min(mi, 63), ringSegs)
      : getSampleAt(samples, Math.floor((i / ringSegs) * WAVE_SEGMENTS))
    const t = Math.pow(rawT, 1.3) * treble * 1.5
    const r = innerRingR + t * innerRingOff
    const angle = (i / ringSegs) * Math.PI * 2 - Math.PI / 2
    innerRingPts.push([Math.cos(angle) * r, Math.sin(angle) * r])
  }

  if (treble > 0.1) {
    ctx.beginPath()
    smoothPath(ctx, innerRingPts, true)
    ctx.strokeStyle = resolveConicGrad(ctx, (shift + 0.3) % 1, 0.15 + treble * 0.3, vc)
    ctx.lineWidth = size * 0.003
    ctx.stroke()
  }

  // Rotating glow spots — 5 spots orbiting the outer ring
  const spotCount = 5
  const spotTime = speedShift(animTimeMs() * 0.0003, vc?.speed)
  for (let s = 0; s < spotCount; s++) {
    const spotAngle = spotTime + (s / spotCount) * Math.PI * 2
    const spotIdx = Math.floor(((spotAngle / (Math.PI * 2)) % 1 + 1) % 1 * ringSegs) % ringSegs
    const pt = outerPts[spotIdx]!
    const spotR = size * 0.008 * (0.6 + bt * 0.5)
    const colorT = (s / spotCount + shift) % 1
    ctx.beginPath()
    ctx.arc(pt[0], pt[1], spotR, 0, Math.PI * 2)
    ctx.fillStyle = resolveColorRgba(colorT, 0.5 + bt * 0.3, vc)
    ctx.fill()
  }

  ctx.restore()
}

// === Registration ===
registerWave('ring', drawWaveRing, {
  id: 'ring',
  label: 'Vanh',
  icon: '⭕',
  category: 'basic',
})

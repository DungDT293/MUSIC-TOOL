/**
 * Wave Style: Radar quet (radar)
 * Icon: 📡
 * Category: tech
 *
 * Vong tron radar voi tia quet quay, dots hien thi theo spectrum.
 * Concentric rings, grid lines, fading sweep trail.
 */

import { type FrequencyBands, type VisualizerColorOptions, getSpectrumAt, animTimeMs, resolveColorRgba, applyGlow, clearGlow, speedShift } from './helpers'
import { registerWave } from './registry'

function drawWaveRadar(
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
  const maxR = Math.sqrt(w * w + h * h) / 2 + size * 0.02
  const shift = speedShift((animTimeMs() * 0.00008) % 1, vc?.speed)
  const bt = beat ?? 0
  const sweepAngle = speedShift(animTimeMs() * 0.0015, vc?.speed) % (Math.PI * 2)

  ctx.save()

  // Concentric rings (4 rings)
  const ringCount = 4
  for (let r = 1; r <= ringCount; r++) {
    const radius = (r / ringCount) * maxR
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.strokeStyle = resolveColorRgba(shift, 0.06 + r * 0.015, vc)
    ctx.lineWidth = size * 0.001
    ctx.stroke()
  }

  // Cross-hair grid lines (4 lines, 45 degree spacing)
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(Math.cos(angle) * maxR, Math.sin(angle) * maxR)
    ctx.strokeStyle = resolveColorRgba(shift, 0.04, vc)
    ctx.lineWidth = size * 0.0005
    ctx.stroke()
  }

  // Sweep beam — gradient arc with fading trail
  const trailAngle = Math.PI * 0.4 // trail covers ~72 degrees
  const sweepGrad = ctx.createConicGradient(sweepAngle - trailAngle, 0, 0)
  sweepGrad.addColorStop(0, resolveColorRgba(shift, 0, vc))
  sweepGrad.addColorStop(0.7, resolveColorRgba(shift, 0.04, vc))
  sweepGrad.addColorStop(0.95, resolveColorRgba(shift, 0.12 + bt * 0.08, vc))
  sweepGrad.addColorStop(1, resolveColorRgba(shift, 0.2 + bt * 0.1, vc))

  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.arc(0, 0, maxR, sweepAngle - trailAngle, sweepAngle)
  ctx.closePath()
  ctx.fillStyle = sweepGrad
  ctx.fill()

  // Sweep line (leading edge)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(Math.cos(sweepAngle) * maxR, Math.sin(sweepAngle) * maxR)
  ctx.strokeStyle = resolveColorRgba(shift, 0.6 + bt * 0.3, vc)
  ctx.lineWidth = size * 0.002
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, bt)
  ctx.stroke()
  if (vc?.glowEnabled) clearGlow(ctx)

  // Blip dots — spectrum-driven, placed along radial directions
  // Each spectrum bin maps to a direction, amplitude maps to distance from center
  const blipCount = 32
  for (let i = 0; i < blipCount; i++) {
    const rawT = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, i, blipCount)
      : 0
    if (rawT < 0.15) continue

    const t = Math.pow(rawT, 1.1)
    const blipAngle = (i / blipCount) * Math.PI * 2 - Math.PI / 2
    const blipDist = maxR * (0.2 + 0.7 * t)

    // Only show blips near the sweep (within trail angle)
    let angleDiff = sweepAngle - blipAngle
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
    if (angleDiff < 0 || angleDiff > trailAngle * 1.5) continue

    // Fade with distance from sweep
    const fadeFactor = 1 - (angleDiff / (trailAngle * 1.5))
    const blipAlpha = fadeFactor * (0.3 + t * 0.7)

    const bx = Math.cos(blipAngle) * blipDist
    const by = Math.sin(blipAngle) * blipDist
    const blipR = size * 0.004 * (0.5 + t * 1.0) * (1 + bt * 0.3)
    const colorT = (i / blipCount + shift) % 1

    // Glow ring
    if (t > 0.4) {
      ctx.beginPath()
      ctx.arc(bx, by, blipR * 2.5, 0, Math.PI * 2)
      ctx.fillStyle = resolveColorRgba(colorT, blipAlpha * 0.2, vc)
      ctx.fill()
    }

    // Core dot
    ctx.beginPath()
    ctx.arc(bx, by, blipR, 0, Math.PI * 2)
    ctx.fillStyle = resolveColorRgba(colorT, blipAlpha, vc)
    ctx.fill()
  }

  // Center dot
  const centerR = size * 0.006 * (1 + bt * 0.3)
  ctx.beginPath()
  ctx.arc(0, 0, centerR, 0, Math.PI * 2)
  ctx.fillStyle = resolveColorRgba(shift, 0.7, vc)
  ctx.fill()

  // Center ring
  ctx.beginPath()
  ctx.arc(0, 0, centerR * 2.5, 0, Math.PI * 2)
  ctx.strokeStyle = resolveColorRgba(shift, 0.2, vc)
  ctx.lineWidth = size * 0.001
  ctx.stroke()

  ctx.restore()
}

// === Registration ===
registerWave('radar', drawWaveRadar, {
  id: 'radar',
  label: 'Radar quet',
  icon: '📡',
  category: 'tech',
})

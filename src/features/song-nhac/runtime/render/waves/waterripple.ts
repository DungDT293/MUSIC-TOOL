/**
 * Wave Style: Gợn nước (waterripple)
 * Icon: 💧
 * Category: nature
 */

import { type FrequencyBands, type VisualizerColorOptions, getSpectrumAt, animTimeMs, resolveColorRgba, applyGlow, clearGlow, smoothPath, deterministicRandom } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

// ─── WATER RIPPLE ───────────────────────────────────────────────────────────
// Concentric sine-wave rings emanating from center, distorted by audio.
// Simulates water surface with gentle glow — bass triggers new ripple bursts.

// Persistent state for ripple phases (survives across frames for smooth animation)
let ripplePhases: number[] | null = null

function drawWaveWaterRipple(
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
  const spd = vc?.speed ?? 1
  const time = animTimeMs() * 0.001 * spd
  const shift = (time * 0.04) % 1
  const bassE = bands?.bass ?? 0.3
  const midE = bands?.mid ?? 0.3
  const trebleE = bands?.treble ?? 0.2
  const beatVal = beat ?? 0

  // Initialize ripple phase offsets (random per ring for organic feel)
  if (!ripplePhases || ripplePhases.length !== 12) {
    ripplePhases = []
    for (let i = 0; i < 12; i++) ripplePhases.push(deterministicRandom(i * 127.1 + 7) * Math.PI * 2)
  }

  ctx.save()

  const maxR = Math.sqrt(w * w + h * h) / 2 + size * 0.1
  const ringCount = 12
  const ringSpacing = maxR / (ringCount + 1)

  // Water surface tint — very subtle dark blue-green gradient over entire area
  const waterGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, maxR)
  waterGrad.addColorStop(0, `rgba(10, 40, 80, ${0.025 + bassE * 0.02})`)
  waterGrad.addColorStop(0.5, `rgba(5, 25, 60, ${0.02 + bassE * 0.015})`)
  waterGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = waterGrad
  ctx.beginPath()
  ctx.arc(0, 0, maxR, 0, Math.PI * 2)
  ctx.fill()

  // Draw concentric ripple rings
  for (let ring = 0; ring < ringCount; ring++) {
    const baseRadius = (ring + 1) * ringSpacing
    // Animate outward expansion — each ring pulses at slightly different speed
    const phase = ripplePhases[ring]!
    const expandFactor = 1 + Math.sin(time * (1.2 + ring * 0.12) + phase) * 0.06

    // Audio modulation: inner rings respond to bass, outer to treble
    const bandMix = ring < 4 ? bassE : ring < 8 ? midE : trebleE
    const audioDisplacement = bandMix * amplitude * size * 0.015

    const segs = 72
    const pts: [number, number][] = []
    for (let i = 0; i < segs; i++) {
      const angle = (i / segs) * Math.PI * 2
      // Sine perturbation along the ring — multiple harmonics for realism
      const specVal = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, Math.floor((i / segs) * 32), 64) : 0.3
      const rippleDisp = Math.sin(angle * 3 + time * 1.5 + phase) * size * 0.005 * amplitude
        + Math.sin(angle * 7 - time * 1.0 + phase * 2) * size * 0.0025 * amplitude
        + specVal * audioDisplacement
      const r = baseRadius * expandFactor + rippleDisp
      pts.push([Math.cos(angle) * r, Math.sin(angle) * r])
    }

    // Opacity fades with distance from center — near rings are brighter
    const distFade = 1 - ring / ringCount
    const ringAlpha = distFade * (0.12 + bandMix * 0.15 + beatVal * 0.1)

    // Pass 1: Wide soft glow ring
    ctx.beginPath()
    smoothPath(ctx, pts, true)
    ctx.strokeStyle = resolveColorRgba(shift + ring * 0.08, ringAlpha * 0.35, vc)
    ctx.lineWidth = size * 0.006 * (0.5 + bandMix * 0.3)
    if (vc?.glowEnabled) applyGlow(ctx, shift + ring * 0.08, vc, beatVal)
    ctx.stroke()
    if (vc?.glowEnabled) clearGlow(ctx)

    // Pass 2: Sharp core ring
    ctx.beginPath()
    smoothPath(ctx, pts, true)
    ctx.strokeStyle = resolveColorRgba(shift + ring * 0.08, ringAlpha * 0.65, vc)
    ctx.lineWidth = size * 0.0015 * (0.5 + bandMix * 0.5)
    ctx.stroke()
  }

  // Bass burst — bright flash ring on strong beats (gentler)
  if (beatVal > 0.45) {
    const burstR = size * 0.1 * (1 + beatVal * 0.4)
    const burstGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, burstR)
    burstGrad.addColorStop(0, resolveColorRgba(shift, (beatVal - 0.45) * 0.2, vc))
    burstGrad.addColorStop(0.6, resolveColorRgba(shift + 0.2, (beatVal - 0.45) * 0.07, vc))
    burstGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = burstGrad
    ctx.beginPath()
    ctx.arc(0, 0, burstR, 0, Math.PI * 2)
    ctx.fill()
  }

  // Caustic light patches — very subtle bright spots that shift like underwater light
  const causticCount = 6
  for (let i = 0; i < causticCount; i++) {
    const cAngle = (i / causticCount) * Math.PI * 2 + time * 0.25
    const cDist = size * 0.12 + Math.sin(time * 0.5 + i * 1.8) * size * 0.06
    const cx = Math.cos(cAngle) * cDist
    const cy = Math.sin(cAngle) * cDist
    const cSize = size * 0.035 * (0.5 + midE * 0.4 + Math.sin(time + i * 2.3) * 0.15)
    const cAlpha = 0.02 + midE * 0.025
    const cGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cSize)
    cGrad.addColorStop(0, resolveColorRgba(shift + i * 0.12, cAlpha, vc))
    cGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = cGrad
    ctx.beginPath()
    ctx.arc(cx, cy, cSize, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

// ═══ Registration ═══
registerWave('waterripple', drawWaveWaterRipple, {
  id: 'waterripple',
  label: 'Gợn nước',
  icon: '💧',
  category: 'nature',
})
registerWaveCleanup(() => { ripplePhases = null })

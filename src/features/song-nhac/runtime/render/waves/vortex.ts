/**
 * Wave Style: Xoáy nước (vortex)
 * Icon: 🌊
 * Category: nature
 *
 * Spiral vortex with particles being pulled toward center.
 * Spectrum drives vortex strength — bass = suction force, treble = outer ripples.
 * Beat causes vortex to pulse and particles to scatter momentarily.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSpectrumAt, animTimeMs, resolveColorRgba, applyGlow, clearGlow, smoothPath } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

function drawWaveVortex(
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
  const baseR = Math.sqrt(w * w + h * h) / 2
  const maxOff = getMaxOffset(w, h) * amplitude
  const spd = vc?.speed ?? 1
  const time = animTimeMs() * 0.001 * spd
  const shift = (time * 0.025) % 1
  const beatV = beat ?? 0
  const bassE = bands?.bass ?? 0.5
  const midE = bands?.mid ?? 0.4
  const trebleE = bands?.treble ?? 0.3

  // Vortex rotation speed driven by bass
  const vortexSpeed = 1.5 + bassE * 2
  const rot = time * vortexSpeed

  ctx.save()

  // ── Core suction glow (bass-reactive center) ──
  if (bassE > 0.2) {
    const coreR = baseR * 0.15 + bassE * baseR * 0.1
    const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR)
    coreGrad.addColorStop(0, resolveColorRgba(shift, 0.2 + beatV * 0.1, vc))
    coreGrad.addColorStop(0.5, resolveColorRgba(shift + 0.3, 0.08, vc))
    coreGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = coreGrad
    ctx.beginPath()
    ctx.arc(0, 0, coreR, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── Spiral arms (4 arms, driven by spectrum) ──
  const armCount = 4
  const ptsPerArm = 32

  for (let arm = 0; arm < armCount; arm++) {
    const armOff = (arm / armCount) * Math.PI * 2
    const armShift = (shift + arm / armCount) % 1

    const pts: [number, number][] = []
    for (let i = 0; i < ptsPerArm; i++) {
      const progress = i / ptsPerArm
      // Logarithmic spiral: r = a * e^(b*theta)
      const theta = armOff + progress * Math.PI * 4 + rot
      const spiralProgress = 1 - progress // outer → inner

      // Spectrum drives arm thickness
      const specIdx = Math.floor(progress * 63)
      const specVal = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, specIdx, 64)
        : 0.3

      // Vortex funnel: radius decreases as we go inward
      const funnelR = baseR * (0.15 + spiralProgress * 0.85)
      const audioModulate = 1 + specVal * 0.4 * amplitude
      const beatPulse = 1 + beatV * 0.1 * spiralProgress // beat pushes outer more

      const r = funnelR * audioModulate * beatPulse
      pts.push([Math.cos(theta) * r, Math.sin(theta) * r])
    }

    // Wide water trail
    ctx.beginPath()
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
    const trailAlpha = 0.15 + midE * 0.1
    ctx.strokeStyle = resolveColorRgba(armShift, trailAlpha, vc)
    ctx.lineWidth = size * (0.008 - 0.004 * (arm % 2))
    if (vc?.glowEnabled) applyGlow(ctx, armShift, vc, beatV)
    ctx.stroke()
    if (vc?.glowEnabled) clearGlow(ctx)

    // Sharp core line
    ctx.beginPath()
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
    ctx.strokeStyle = resolveColorRgba(armShift, 0.6, vc)
    ctx.lineWidth = size * 0.002
    ctx.stroke()

    // White foam core
    ctx.beginPath()
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
    ctx.strokeStyle = `rgba(255,255,255,${0.2 + bassE * 0.15})`
    ctx.lineWidth = size * 0.001
    ctx.stroke()
  }

  // ── Debris particles spiraling inward ──
  const particleCount = 16
  for (let p = 0; p < particleCount; p++) {
    // Deterministic spiral orbit
    const seed = p * 73.7
    const orbitPhase = ((time * (0.5 + p * 0.1) + seed) % 8) / 8 // 0–1 lifecycle
    const orbitAngle = seed + orbitPhase * Math.PI * 6 + rot * 0.5
    const orbitR = baseR * (0.9 - orbitPhase * 0.75) // spirals inward

    // Beat scatters particles outward temporarily
    const scatterR = orbitR + beatV * size * 0.02

    const px = Math.cos(orbitAngle) * scatterR
    const py = Math.sin(orbitAngle) * scatterR

    const particleAlpha = (1 - orbitPhase) * 0.6
    const particleSize = size * (0.003 + (1 - orbitPhase) * 0.003)
    const particleShift = (shift + p / particleCount) % 1

    ctx.fillStyle = resolveColorRgba(particleShift, particleAlpha, vc)
    ctx.beginPath()
    ctx.arc(px, py, particleSize, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── Outer ripple rings (treble-reactive) ──
  if (trebleE > 0.25) {
    const rippleCount = 3
    for (let r = 0; r < rippleCount; r++) {
      const ripplePhase = ((time * 0.6 + r * 0.33) % 1)
      const rippleR = baseR * (0.7 + ripplePhase * 0.35)
      const rippleAlpha = (1 - ripplePhase) * trebleE * 0.2

      ctx.beginPath()
      ctx.arc(0, 0, rippleR, 0, Math.PI * 2)
      ctx.strokeStyle = resolveColorRgba((shift + r * 0.3) % 1, rippleAlpha, vc)
      ctx.lineWidth = size * 0.001 * (1 - ripplePhase)
      ctx.stroke()
    }
  }

  ctx.restore()
}

// ═══ Registration ═══
registerWave('vortex', drawWaveVortex, {
  id: 'vortex',
  label: 'Xoáy nước',
  icon: '🌊',
  category: 'nature',
})

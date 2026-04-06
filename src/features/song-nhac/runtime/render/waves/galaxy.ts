/**
 * Wave Style: Thiên hà (galaxy)
 * Icon: 🌌
 * Category: nature
 *
 * V2: Twinkling stars scattered between arms, nebula glow between arms,
 *     beat spiral expansion, dust lane depth effect.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba, applyGlow, clearGlow } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

function drawWaveGalaxy(
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
  const maxOff = getMaxOffset(w, h) * amplitude * 1.3
  const spd = vc?.speed ?? 1
  const time = animTimeMs() * 0.001 * spd
  const shift = (time * 0.015) % 1
  const beatV = beat ?? 0
  const bassE = bands?.bass ?? 0.5

  // ── Beat spiral expansion: arms unwind slightly on beat ──
  const rot = time * 0.5 + beatV * 0.15

  ctx.save()

  const armCount = 3
  const ptsPerArm = 28

  for (let arm = 0; arm < armCount; arm++) {
    const armOff = (arm / armCount) * Math.PI * 2
    const armShift = (shift + arm / armCount) % 1

    const pts: [number, number][] = []
    for (let i = 0; i < ptsPerArm; i++) {
      const progress = i / ptsPerArm
      const specIdx = Math.floor(progress * 63)
      const rawT = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, specIdx, 64)
        : getSampleAt(samples, Math.floor(progress * WAVE_SEGMENTS))
      const t = Math.pow(rawT, 1.1)
      const angle = armOff + progress * Math.PI * 3.5 + rot
      const spiralR = baseR + progress * maxOff * (0.3 + t * 0.7) * (1 + beatV * 0.08)
      pts.push([Math.cos(angle) * spiralR, Math.sin(angle) * spiralR])
    }

    // ── Nebula glow between arms (bass-reactive, rendered first) ──
    if (bassE > 0.25 && pts.length > 6) {
      ctx.save()
      ctx.globalAlpha = 0.4
      for (let i = 4; i < ptsPerArm; i += 8) {
        const [px, py] = pts[i]!
        const nebulaR = size * 0.04 * (0.5 + bassE * 0.5)
        const nGrad = ctx.createRadialGradient(px, py, 0, px, py, nebulaR)
        nGrad.addColorStop(0, resolveColorRgba((armShift + i * 0.02) % 1, 0.12 + beatV * 0.05, vc))
        nGrad.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = nGrad
        ctx.beginPath()
        ctx.arc(px, py, nebulaR, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    // Wide glow trail
    ctx.beginPath()
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
    ctx.strokeStyle = resolveColorRgba(armShift, 0.25, vc)
    ctx.lineWidth = size * 0.007
    if (vc?.glowEnabled) applyGlow(ctx, armShift, vc, beatV)
    ctx.stroke()
    if (vc?.glowEnabled) clearGlow(ctx)

    // Sharp trail
    ctx.beginPath()
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
    ctx.strokeStyle = resolveColorRgba(armShift, 0.7, vc)
    ctx.lineWidth = size * 0.002
    ctx.stroke()

    // ── Dust lane: subtle dark semi-transparent strip along inner edge ──
    ctx.beginPath()
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'
    ctx.lineWidth = size * 0.005
    ctx.stroke()

    // White core
    ctx.beginPath()
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = size * 0.001
    ctx.stroke()

    // Star particles on arm (batched)
    ctx.fillStyle = resolveColorRgba(armShift, 0.65, vc)
    ctx.beginPath()
    for (let i = 0; i < ptsPerArm; i += 5) {
      const [px, py] = pts[i]!
      const dotR = size * 0.004
      ctx.moveTo(px + dotR, py)
      ctx.arc(px, py, dotR, 0, Math.PI * 2)
    }
    ctx.fill()

    // ── Twinkling stars: scattered sparkles near arm with varying alpha ──
    const twinkleCount = 6
    for (let s = 0; s < twinkleCount; s++) {
      // Deterministic pseudo-random positioning based on arm + index + time
      const seed = arm * 100 + s
      const phase = Math.sin(seed * 127.1 + time * 0.7) * 0.5 + 0.5 // twinkle
      if (phase < 0.3) continue // star is dim, skip drawing

      const armProg = (Math.sin(seed * 43.7) * 0.5 + 0.5) // where along the arm
      const armIdx = Math.floor(armProg * (ptsPerArm - 1))
      const [bx, by] = pts[armIdx]!
      // Offset perpendicular to arm
      const offsetDist = size * 0.02 * (Math.sin(seed * 73.3) * 0.5 + 0.5)
      const offsetAngle = Math.sin(seed * 91.7) * Math.PI * 2
      const sx = bx + Math.cos(offsetAngle) * offsetDist
      const sy = by + Math.sin(offsetAngle) * offsetDist

      const starAlpha = phase * 0.7 * (0.5 + bassE * 0.5)
      const starSize = size * (0.002 + phase * 0.003)
      ctx.fillStyle = `rgba(255,255,255,${starAlpha})`
      ctx.beginPath()
      ctx.arc(sx, sy, starSize, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Central pulse (cheap radial gradient fill) — enhanced with beat
  if (bassE > 0.2) {
    const pulseR = baseR + bassE * maxOff * 0.35 * (1 + beatV * 0.15)
    const cGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, pulseR)
    cGrad.addColorStop(0, resolveColorRgba(shift, bassE * 0.15 + beatV * 0.05, vc))
    cGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = cGrad
    ctx.beginPath()
    ctx.arc(0, 0, pulseR, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

// ═══ Registration ═══
registerWave('galaxy', drawWaveGalaxy, {
  id: 'galaxy',
  label: 'Thiên hà',
  icon: '🌌',
  category: 'nature',
})

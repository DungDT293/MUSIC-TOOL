/**
 * Wave Style: Bùng nổ (starburst)
 * Icon: 💥
 * Category: artistic
 *
 * V2: Secondary burst ring (phase-offset), particle trails on strong beat,
 *     lens flare at center, rotating outer ring with mini spectrum bars.
 */

import { type FrequencyBands, type VisualizerColorOptions, getSpectrumAt, animTimeMs, resolveColorRgba, applyGlow, clearGlow } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

// ── Persistent particle state ──
interface BurstParticle {
  angle: number
  radius: number
  speed: number
  life: number    // 0–1, decreasing
  hueShift: number
  size: number
}

let _particles: BurstParticle[] = []
const MAX_PARTICLES = 60

registerWaveCleanup(() => { _particles = [] })

function drawWaveStarburst(
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
  const shift = (time * 0.025) % 1
  const bassE = bands?.bass ?? 0.3
  const midE = bands?.mid ?? 0.3
  const trebleE = bands?.treble ?? 0.2
  const beatVal = beat ?? 0
  const dt = 0.016 * spd // approximate frame delta

  ctx.save()

  const rayCount = Math.max(16, Math.min(64, vc?.barCount ?? 36))
  const innerR = size * 0.04 * (0.8 + bassE * 0.4)
  const maxOuterR = size * 0.35 * amplitude
  const rotAngle = time * 0.15

  // ── Lens flare at center ──
  // Multi-layer radial flare with anamorphic horizontal streak
  const flareIntensity = 0.15 + beatVal * 0.25 + bassE * 0.1

  // Horizontal anamorphic streak
  ctx.save()
  const streakGrad = ctx.createLinearGradient(-size * 0.25, 0, size * 0.25, 0)
  streakGrad.addColorStop(0, 'rgba(0,0,0,0)')
  streakGrad.addColorStop(0.3, resolveColorRgba(shift + 0.05, flareIntensity * 0.15, vc))
  streakGrad.addColorStop(0.5, resolveColorRgba(shift, flareIntensity * 0.3, vc))
  streakGrad.addColorStop(0.7, resolveColorRgba(shift + 0.05, flareIntensity * 0.15, vc))
  streakGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = streakGrad
  ctx.fillRect(-size * 0.25, -size * 0.003, size * 0.5, size * 0.006)
  ctx.restore()

  // Core flare layers
  for (let fl = 0; fl < 3; fl++) {
    const flR = innerR * (2 + fl * 1.5) * (1 + beatVal * 0.2)
    const flAlpha = flareIntensity * (0.12 - fl * 0.03)
    const flGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, flR)
    flGrad.addColorStop(0, resolveColorRgba(shift + fl * 0.08, flAlpha, vc))
    flGrad.addColorStop(0.5, resolveColorRgba(shift + fl * 0.08 + 0.1, flAlpha * 0.3, vc))
    flGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = flGrad
    ctx.beginPath()
    ctx.arc(0, 0, flR, 0, Math.PI * 2)
    ctx.fill()
  }

  // Small ghost flares (secondary reflections offset from center)
  const ghostCount = 4
  for (let g = 0; g < ghostCount; g++) {
    const gDist = innerR * (3 + g * 2.5)
    const gAngle = rotAngle * 0.3 + g * Math.PI * 0.6
    const gx = Math.cos(gAngle) * gDist * 0.5
    const gy = Math.sin(gAngle) * gDist * 0.3
    const gR = size * 0.008 * (1 + g * 0.3)
    const gAlpha = flareIntensity * 0.06 * (1 - g * 0.15)
    ctx.fillStyle = resolveColorRgba(shift + g * 0.15, gAlpha, vc)
    ctx.beginPath()
    ctx.arc(gx, gy, gR, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── Central glow ──
  const centerGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, innerR * 3)
  centerGrad.addColorStop(0, resolveColorRgba(shift, 0.25 + beatVal * 0.25, vc))
  centerGrad.addColorStop(0.4, resolveColorRgba(shift + 0.1, 0.08, vc))
  centerGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = centerGrad
  ctx.beginPath()
  ctx.arc(0, 0, innerR * 3, 0, Math.PI * 2)
  ctx.fill()

  // ── Primary rays ──
  for (let i = 0; i < rayCount; i++) {
    const angle = rotAngle + (i / rayCount) * Math.PI * 2
    const specVal = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, i * 2, rayCount * 2) : 0.3

    const rayLen = innerR + specVal * maxOuterR * (1 + beatVal * 0.3)
    const ix = Math.cos(angle) * innerR
    const iy = Math.sin(angle) * innerR
    const ox = Math.cos(angle) * rayLen
    const oy = Math.sin(angle) * rayLen

    // Ray gradient
    const rayGrad = ctx.createLinearGradient(ix, iy, ox, oy)
    const rayAlpha = 0.3 + specVal * 0.5 + beatVal * 0.15
    rayGrad.addColorStop(0, resolveColorRgba(shift + i / rayCount, rayAlpha, vc))
    rayGrad.addColorStop(0.6, resolveColorRgba(shift + i / rayCount + 0.1, rayAlpha * 0.4, vc))
    rayGrad.addColorStop(1, 'rgba(0,0,0,0)')

    ctx.beginPath()
    ctx.moveTo(ix, iy)
    ctx.lineTo(ox, oy)
    ctx.strokeStyle = rayGrad
    ctx.lineWidth = size * 0.002 * (0.4 + specVal * 0.6)
    ctx.stroke()

    // Tip glow dot
    if (specVal > 0.3) {
      const tipR = size * 0.003 * specVal
      ctx.fillStyle = resolveColorRgba(shift + i / rayCount, (specVal - 0.3) * 0.8, vc)
      ctx.beginPath()
      ctx.arc(ox, oy, tipR, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ── Secondary burst ring (phase-offset, counter-rotation) ──
  const ring2Rot = -time * 0.1 // counter rotate
  const ring2RayCount = Math.floor(rayCount * 0.6)
  const ring2InnerR = innerR * 1.8
  const ring2MaxLen = maxOuterR * 0.5

  for (let i = 0; i < ring2RayCount; i++) {
    const angle = ring2Rot + (i / ring2RayCount) * Math.PI * 2
    const specVal = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, Math.floor((i / ring2RayCount) * 48), 64) : 0.25

    const rayLen = ring2InnerR + specVal * ring2MaxLen * (0.8 + midE * 0.4)
    const ix = Math.cos(angle) * ring2InnerR
    const iy = Math.sin(angle) * ring2InnerR
    const ox = Math.cos(angle) * rayLen
    const oy = Math.sin(angle) * rayLen

    const rayAlpha = 0.15 + specVal * 0.3
    ctx.beginPath()
    ctx.moveTo(ix, iy)
    ctx.lineTo(ox, oy)
    ctx.strokeStyle = resolveColorRgba(shift + 0.3 + i / ring2RayCount * 0.4, rayAlpha, vc)
    ctx.lineWidth = size * 0.0015 * (0.3 + specVal * 0.5)
    ctx.stroke()

    // Tip dots for secondary ring
    if (specVal > 0.25) {
      ctx.fillStyle = resolveColorRgba(shift + 0.3 + i / ring2RayCount * 0.4, specVal * 0.4, vc)
      ctx.beginPath()
      ctx.arc(ox, oy, size * 0.002 * specVal, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Secondary ring circle
  ctx.beginPath()
  ctx.arc(0, 0, ring2InnerR, 0, Math.PI * 2)
  ctx.strokeStyle = resolveColorRgba(shift + 0.3, 0.15 + midE * 0.1, vc)
  ctx.lineWidth = size * 0.0006
  ctx.setLineDash([size * 0.005, size * 0.008])
  ctx.stroke()
  ctx.setLineDash([])

  // ── Rotating outer ring with mini spectrum bars ──
  const outerRingR = maxOuterR * 0.85
  const outerBarCount = 48
  const outerBarMaxH = size * 0.025
  const outerRingRot = time * 0.08

  // Outer ring circle (subtle)
  ctx.beginPath()
  ctx.arc(0, 0, outerRingR, 0, Math.PI * 2)
  ctx.strokeStyle = resolveColorRgba(shift + 0.5, 0.06 + trebleE * 0.04, vc)
  ctx.lineWidth = size * 0.0004
  ctx.stroke()

  // Mini spectrum bars on outer ring
  for (let i = 0; i < outerBarCount; i++) {
    const angle = outerRingRot + (i / outerBarCount) * Math.PI * 2
    const specVal = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, Math.floor((i / outerBarCount) * 64), 64) : 0.2

    const barH = specVal * outerBarMaxH * (0.6 + trebleE * 0.4)
    if (barH < size * 0.001) continue

    const ix = Math.cos(angle) * outerRingR
    const iy = Math.sin(angle) * outerRingR
    const ox = Math.cos(angle) * (outerRingR + barH)
    const oy = Math.sin(angle) * (outerRingR + barH)

    ctx.beginPath()
    ctx.moveTo(ix, iy)
    ctx.lineTo(ox, oy)
    ctx.strokeStyle = resolveColorRgba(shift + 0.5 + i / outerBarCount * 0.3, 0.2 + specVal * 0.4, vc)
    ctx.lineWidth = size * 0.002
    ctx.stroke()
  }

  // ── Inner ring ──
  ctx.beginPath()
  ctx.arc(0, 0, innerR, 0, Math.PI * 2)
  ctx.strokeStyle = resolveColorRgba(shift, 0.5 + beatVal * 0.3, vc)
  ctx.lineWidth = size * 0.001
  ctx.stroke()

  // ── Particle trails — spawn on strong beat ──
  // Spawn new particles
  if (beatVal > 0.4 && _particles.length < MAX_PARTICLES) {
    const spawnCount = Math.floor(beatVal * 6)
    for (let s = 0; s < spawnCount && _particles.length < MAX_PARTICLES; s++) {
      const angle = rotAngle + Math.sin(time * 7 + s * 3.7) * Math.PI * 2
      _particles.push({
        angle,
        radius: innerR * 1.2,
        speed: size * (0.08 + Math.sin(time * 5 + s * 2.3) * 0.04) * (0.5 + beatVal),
        life: 1,
        hueShift: (s * 0.15 + shift) % 1,
        size: size * 0.003 * (0.5 + beatVal * 0.5),
      })
    }
  }

  // Update and draw particles
  const aliveParticles: BurstParticle[] = []
  for (const p of _particles) {
    p.radius += p.speed * dt
    p.life -= dt * 0.7

    if (p.life <= 0) continue
    aliveParticles.push(p)

    const px = Math.cos(p.angle) * p.radius
    const py = Math.sin(p.angle) * p.radius
    const pAlpha = p.life * 0.7

    // Particle trail (3 dots decreasing in size)
    for (let t = 0; t < 3; t++) {
      const trailR = p.radius - t * p.speed * 0.08
      if (trailR < innerR) continue
      const tx = Math.cos(p.angle) * trailR
      const ty = Math.sin(p.angle) * trailR
      const tAlpha = pAlpha * (1 - t * 0.3)
      const tSize = p.size * (1 - t * 0.25)
      ctx.fillStyle = resolveColorRgba(p.hueShift + t * 0.05, tAlpha, vc)
      ctx.beginPath()
      ctx.arc(tx, ty, tSize, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  _particles = aliveParticles

  // ── Beat halo — expanding ring on strong beat ──
  if (beatVal > 0.3) {
    const haloR = innerR + beatVal * maxOuterR * 0.4
    ctx.beginPath()
    ctx.arc(0, 0, haloR, 0, Math.PI * 2)
    ctx.strokeStyle = resolveColorRgba(shift, (beatVal - 0.3) * 0.25, vc)
    ctx.lineWidth = size * 0.004 * beatVal
    if (vc?.glowEnabled) applyGlow(ctx, shift, vc, beatVal)
    ctx.stroke()
    if (vc?.glowEnabled) clearGlow(ctx)

    // Second halo (delayed, wider)
    const halo2R = innerR + beatVal * maxOuterR * 0.65
    ctx.beginPath()
    ctx.arc(0, 0, halo2R, 0, Math.PI * 2)
    ctx.strokeStyle = resolveColorRgba(shift + 0.15, (beatVal - 0.3) * 0.12, vc)
    ctx.lineWidth = size * 0.002 * beatVal
    ctx.stroke()
  }

  ctx.restore()
}

// ═══ Registration ═══
registerWave('starburst', drawWaveStarburst, {
  id: 'starburst',
  label: 'Bùng nổ',
  icon: '💥',
  category: 'artistic',
})

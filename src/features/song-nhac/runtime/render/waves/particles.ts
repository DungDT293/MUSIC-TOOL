/**
 * Wave Style: Hạt sáng (particles)
 * Icon: ✦
 * Category: artistic
 *
 * V2: Trails, attraction to center on bass, sparkle stars, size diversity
 */

import { type FrequencyBands, type VisualizerColorOptions, animTimeMs, resolveColorRgba, deterministicRandom } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  alpha: number
  hue: number
  twinklePhase: number
  /** V2: previous positions for trail */
  prevX: number
  prevY: number
  /** V2: sparkle flag */
  sparkle: boolean
}

let particlePool: Particle[] | null = null
const PARTICLE_COUNT = 60 // V2: increased from 45

function ensureParticles(): Particle[] {
  if (particlePool && particlePool.length === PARTICLE_COUNT) return particlePool
  particlePool = []
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const x = deterministicRandom(i * 73.1 + 1) - 0.5
    const y = deterministicRandom(i * 73.1 + 2) - 0.5
    particlePool.push({
      x, y,
      vx: (deterministicRandom(i * 73.1 + 3) - 0.5) * 0.00015,
      vy: -(0.0002 + deterministicRandom(i * 73.1 + 4) * 0.0004),
      // V2: more size diversity — mix of micro and macro
      size: i < 15 ? 0.001 + deterministicRandom(i * 73.1 + 5) * 0.0015 : 0.002 + deterministicRandom(i * 73.1 + 5) * 0.004,
      alpha: 0.2 + deterministicRandom(i * 73.1 + 6) * 0.45,
      hue: deterministicRandom(i * 73.1 + 7),
      twinklePhase: deterministicRandom(i * 73.1 + 8) * Math.PI * 2,
      prevX: x,
      prevY: y,
      sparkle: deterministicRandom(i * 73.1 + 9) < 0.08, // ~8% chance to be a sparkle star
    })
  }
  return particlePool
}

function drawWaveParticles(
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
  const shift = (time * 0.03) % 1
  const bassE = bands?.bass ?? 0.3
  const trebleE = bands?.treble ?? 0.2
  const beatVal = beat ?? 0

  const particles = ensureParticles()

  ctx.save()

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]!

    // Save previous position for trail
    p.prevX = p.x
    p.prevY = p.y

    // Update position
    const sway = Math.sin(time * 0.5 + p.twinklePhase) * 0.00012 * spd
    p.x += (p.vx + sway) * spd
    p.y += p.vy * spd * (1 + beatVal * 0.3)

    // V2: Attraction toward center on strong bass
    if (bassE > 0.5) {
      const attractForce = (bassE - 0.5) * 0.0003 * spd
      p.x -= p.x * attractForce
      p.y -= p.y * attractForce
    }

    // Wrap around
    if (p.y < -0.55) {
      p.y = 0.55
      p.x = deterministicRandom(animTimeMs() * 0.1 + i * 47.3) - 0.5
      p.hue = deterministicRandom(animTimeMs() * 0.1 + i * 47.3 + 11)
      p.size = i < 15 ? 0.001 + deterministicRandom(animTimeMs() * 0.1 + i * 47.3 + 23) * 0.0015 : 0.002 + deterministicRandom(animTimeMs() * 0.1 + i * 47.3 + 23) * 0.004
      p.sparkle = deterministicRandom(animTimeMs() * 0.1 + i * 47.3 + 37) < 0.08
      p.prevX = p.x
      p.prevY = p.y
    }
    if (p.x < -0.55) p.x = 0.55
    if (p.x > 0.55) p.x = -0.55

    const twinkle = 0.5 + 0.5 * Math.sin(time * 1.8 + p.twinklePhase)
    const pAlpha = p.alpha * twinkle * (0.5 + bassE * 0.35 + beatVal * 0.2)

    const px = p.x * w
    const py = p.y * h
    const pr = p.size * size * (0.7 + trebleE * 0.4)

    // V2: Trail effect — faint line from previous to current position
    const trailPx = p.prevX * w
    const trailPy = p.prevY * h
    const dx = px - trailPx
    const dy = py - trailPy
    const trailDist = Math.sqrt(dx * dx + dy * dy)
    if (trailDist > 0.5 && trailDist < size * 0.05) {
      const trailGrad = ctx.createLinearGradient(trailPx, trailPy, px, py)
      trailGrad.addColorStop(0, 'rgba(0,0,0,0)')
      trailGrad.addColorStop(1, resolveColorRgba(shift + p.hue, pAlpha * 0.15, vc))
      ctx.strokeStyle = trailGrad
      ctx.lineWidth = pr * 0.4
      ctx.beginPath()
      ctx.moveTo(trailPx, trailPy)
      ctx.lineTo(px, py)
      ctx.stroke()
    }

    // Outer glow
    const glowR = pr * 3.5
    const pGrad = ctx.createRadialGradient(px, py, 0, px, py, glowR)
    pGrad.addColorStop(0, resolveColorRgba(shift + p.hue, pAlpha * 0.3, vc))
    pGrad.addColorStop(0.35, resolveColorRgba(shift + p.hue, pAlpha * 0.1, vc))
    pGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = pGrad
    ctx.beginPath()
    ctx.arc(px, py, glowR, 0, Math.PI * 2)
    ctx.fill()

    // V2: Sparkle star shape for special particles
    if (p.sparkle && pAlpha > 0.15) {
      const sSize = pr * 2
      const sAlpha = Math.min(1, pAlpha * 1.2)
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(time * 2 + p.twinklePhase)
      ctx.strokeStyle = `rgba(255, 255, 255, ${sAlpha * 0.5})`
      ctx.lineWidth = sSize * 0.15
      // 4-point star
      ctx.beginPath()
      ctx.moveTo(0, -sSize)
      ctx.lineTo(0, sSize)
      ctx.moveTo(-sSize, 0)
      ctx.lineTo(sSize, 0)
      ctx.stroke()
      // Diagonal rays (fainter)
      ctx.strokeStyle = `rgba(255, 255, 255, ${sAlpha * 0.25})`
      ctx.lineWidth = sSize * 0.1
      ctx.beginPath()
      const d = sSize * 0.7
      ctx.moveTo(-d, -d)
      ctx.lineTo(d, d)
      ctx.moveTo(d, -d)
      ctx.lineTo(-d, d)
      ctx.stroke()
      ctx.restore()
    }

    // Bright core
    ctx.fillStyle = `rgba(255, 255, 250, ${Math.min(1, pAlpha * 0.7)})`
    ctx.beginPath()
    ctx.arc(px, py, pr * 0.5, 0, Math.PI * 2)
    ctx.fill()
  }

  // Beat burst particles
  if (beatVal > 0.55) {
    const burstCount = Math.floor((beatVal - 0.55) * 12)
    for (let i = 0; i < burstCount; i++) {
      const angle = (i / burstCount) * Math.PI * 2 + time * 3
      const dist = size * 0.04 * (0.5 + deterministicRandom(animTimeMs() * 3 + i * 49.7) * 0.5) * beatVal
      const bx = Math.cos(angle) * dist
      const by = Math.sin(angle) * dist
      const br = size * 0.0025 * beatVal
      ctx.fillStyle = resolveColorRgba(shift + i * 0.06, (beatVal - 0.55) * 1.0, vc)
      ctx.beginPath()
      ctx.arc(bx, by, br, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.restore()
}

registerWave('particles', drawWaveParticles, {
  id: 'particles',
  label: 'Hạt sáng',
  icon: '✦',
  category: 'artistic',
})
registerWaveCleanup(() => { particlePool = null })

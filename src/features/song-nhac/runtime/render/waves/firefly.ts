/**
 * Wave Style: Dom dom (firefly)
 * Icon: 🔥
 * Category: nature
 *
 * Dom dom bay lung linh trong dem toi.
 * Lissajous flight paths, synchronized blink on bass, warm glow trails.
 */

import { type FrequencyBands, type VisualizerColorOptions, animTimeMs, resolveColorRgba, deterministicRandom } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

interface Firefly {
  /** Lissajous parameters */
  freqX: number
  freqY: number
  phaseX: number
  phaseY: number
  /** Orbit radius (normalised) */
  radius: number
  /** Blink phase */
  blinkPhase: number
  blinkSpeed: number
  /** Color warmth: 0 = yellow, 1 = green */
  warmth: number
  /** Size */
  size: number
}

let fireflyPool: Firefly[] | null = null
const FIREFLY_COUNT = 35

function ensureFireflies(): Firefly[] {
  if (fireflyPool && fireflyPool.length === FIREFLY_COUNT) return fireflyPool
  fireflyPool = []
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    fireflyPool.push({
      freqX: 0.3 + deterministicRandom(i * 73.1 + 1) * 0.6,
      freqY: 0.2 + deterministicRandom(i * 73.1 + 2) * 0.5,
      phaseX: deterministicRandom(i * 73.1 + 3) * Math.PI * 2,
      phaseY: deterministicRandom(i * 73.1 + 4) * Math.PI * 2,
      radius: 0.15 + deterministicRandom(i * 73.1 + 5) * 0.3,
      blinkPhase: deterministicRandom(i * 73.1 + 6) * Math.PI * 2,
      blinkSpeed: 1.5 + deterministicRandom(i * 73.1 + 7) * 2.5,
      warmth: deterministicRandom(i * 73.1 + 8),
      size: 0.003 + deterministicRandom(i * 73.1 + 9) * 0.004,
    })
  }
  return fireflyPool
}

/** Warm yellow-green palette */
function fireflyColor(warmth: number, alpha: number): string {
  // warmth 0 = warm yellow (#ffe066), 1 = cool green (#88ff44)
  const r = Math.round(255 - warmth * 119) // 255 → 136
  const g = Math.round(224 + warmth * 31)   // 224 → 255
  const b = Math.round(102 - warmth * 34)   // 102 → 68
  return `rgba(${r},${g},${b},${alpha})`
}

function drawWaveFirefly(
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
  const shift = (time * 0.02) % 1
  const bassE = bands?.bass ?? 0.3
  const trebleE = bands?.treble ?? 0.2
  const beatVal = beat ?? 0

  const fireflies = ensureFireflies()

  ctx.save()

  // Synchronous flash factor: strong bass → all fireflies glow together
  const syncFlash = bassE > 0.6 ? (bassE - 0.6) * 2.5 : 0

  for (let i = 0; i < fireflies.length; i++) {
    const f = fireflies[i]!

    // Lissajous flight path
    const fx = Math.sin(time * f.freqX + f.phaseX) * f.radius * w
    const fy = Math.cos(time * f.freqY + f.phaseY) * f.radius * h

    // Blink: each firefly has its own rhythm, synced on strong bass
    const blink = 0.5 + 0.5 * Math.sin(time * f.blinkSpeed + f.blinkPhase)
    const brightness = Math.max(blink, syncFlash)
    const fAlpha = (0.15 + brightness * 0.7) * (0.5 + amplitude * 0.5)

    const fSize = f.size * size * (0.6 + trebleE * 0.4 + beatVal * 0.2)

    // Trail — short glowing tail behind the firefly
    const trailAngle = Math.atan2(
      -Math.sin(time * f.freqY + f.phaseY) * f.freqY,
      Math.cos(time * f.freqX + f.phaseX) * f.freqX
    )
    const tailLen = fSize * 3 * (0.5 + brightness * 0.5)
    const tx = fx - Math.cos(trailAngle) * tailLen
    const ty = fy - Math.sin(trailAngle) * tailLen

    // Use vc colors if available, otherwise warm palette
    const useVc = vc?.colorMode && vc.colorMode !== 'rainbow'

    if (tailLen > 0.5) {
      const tailGrad = ctx.createLinearGradient(tx, ty, fx, fy)
      tailGrad.addColorStop(0, 'rgba(0,0,0,0)')
      tailGrad.addColorStop(1, useVc
        ? resolveColorRgba(shift + f.warmth, fAlpha * 0.3, vc)
        : fireflyColor(f.warmth, fAlpha * 0.3))
      ctx.strokeStyle = tailGrad
      ctx.lineWidth = fSize * 0.6
      ctx.beginPath()
      ctx.moveTo(tx, ty)
      ctx.lineTo(fx, fy)
      ctx.stroke()
    }

    // Outer glow halo
    const glowR = fSize * 4
    const glowGrad = ctx.createRadialGradient(fx, fy, 0, fx, fy, glowR)
    glowGrad.addColorStop(0, useVc
      ? resolveColorRgba(shift + f.warmth, fAlpha * 0.4, vc)
      : fireflyColor(f.warmth, fAlpha * 0.4))
    glowGrad.addColorStop(0.3, useVc
      ? resolveColorRgba(shift + f.warmth, fAlpha * 0.12, vc)
      : fireflyColor(f.warmth, fAlpha * 0.12))
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glowGrad
    ctx.beginPath()
    ctx.arc(fx, fy, glowR, 0, Math.PI * 2)
    ctx.fill()

    // Bright core
    ctx.fillStyle = `rgba(255, 255, 240, ${Math.min(1, fAlpha * 0.8)})`
    ctx.beginPath()
    ctx.arc(fx, fy, fSize * 0.5, 0, Math.PI * 2)
    ctx.fill()
  }

  // Ambient warm glow at center when many fireflies are bright
  if (bassE > 0.3) {
    const ambR = size * 0.15
    const ambGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, ambR)
    ambGrad.addColorStop(0, fireflyColor(0.5, bassE * 0.04))
    ambGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = ambGrad
    ctx.beginPath()
    ctx.arc(0, 0, ambR, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

registerWave('firefly', drawWaveFirefly, {
  id: 'firefly',
  label: 'Đom đóm',
  icon: '🪲',
  category: 'nature',
})
registerWaveCleanup(() => { fireflyPool = null })

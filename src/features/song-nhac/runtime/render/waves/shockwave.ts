/**
 * Wave Style: Sóng xung (shockwave)
 * Icon: 💥
 * Category: tech
 *
 * Beat-driven expanding rings — each beat spawns a new ring that expands
 * outward and fades. Like a bass drop visual shockwave blast.
 * Spectrum drives ring thickness and color intensity.
 * Persistent ring pool (max 8) managed via module-level state.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, animTimeMs, resolveColorRgba, applyGlow, clearGlow } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

// ── Persistent state: ring pool ──
interface ShockRing {
  birthTime: number  // time when ring was created
  intensity: number  // initial beat intensity (0–1)
  colorT: number     // color shift at birth
}

const MAX_RINGS = 8
let ringPool: ShockRing[] = []
let lastSpawnTime = 0
let prevBeat = 0 // track beat transitions

function drawWaveShockwave(
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
  const shift = (time * 0.03) % 1
  const beatV = beat ?? 0
  const bassE = bands?.bass ?? 0.5
  const midE = bands?.mid ?? 0.4
  const trebleE = bands?.treble ?? 0.3

  // Ring lifetime in seconds
  const RING_LIFETIME = 1.8 / spd
  // Minimum interval between spawns (seconds)
  const MIN_SPAWN_INTERVAL = 0.15

  // ── Spawn new ring on beat onset (rising edge detection) ──
  const beatThreshold = 0.45
  if (beatV > beatThreshold && prevBeat <= beatThreshold && time - lastSpawnTime > MIN_SPAWN_INTERVAL) {
    ringPool.push({
      birthTime: time,
      intensity: beatV,
      colorT: shift,
    })
    lastSpawnTime = time
    // Cap pool size
    if (ringPool.length > MAX_RINGS) {
      ringPool = ringPool.slice(-MAX_RINGS)
    }
  }
  prevBeat = beatV

  // ── Remove expired rings ──
  ringPool = ringPool.filter(r => time - r.birthTime < RING_LIFETIME)

  ctx.save()

  // ── Ambient core: subtle bass-reactive center glow ──
  if (bassE > 0.2 || beatV > 0.3) {
    const coreR = baseR * 0.08 * (1 + bassE * 0.5 + beatV * 0.4)
    const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR)
    coreGrad.addColorStop(0, resolveColorRgba(shift, 0.15 + beatV * 0.2, vc))
    coreGrad.addColorStop(0.6, resolveColorRgba(shift + 0.2, 0.05, vc))
    coreGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = coreGrad
    ctx.beginPath()
    ctx.arc(0, 0, coreR, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── Draw expanding rings ──
  for (const ring of ringPool) {
    const age = time - ring.birthTime
    const progress = Math.min(1, age / RING_LIFETIME) // 0–1 lifecycle
    const easeProgress = 1 - Math.pow(1 - progress, 2) // ease-out quad

    // Ring expands from center to maxOff
    const ringR = baseR * 0.05 + easeProgress * (maxOff * 1.5 + baseR * 0.3)

    // Fade out as ring expands
    const fadeAlpha = Math.pow(1 - progress, 1.5) * ring.intensity
    if (fadeAlpha < 0.01) continue

    // Ring thickness: starts thick, thins out
    const thickness = size * (0.008 + ring.intensity * 0.006) * (1 - progress * 0.7)

    // ── Glow pass (wide, semi-transparent) ──
    ctx.beginPath()
    ctx.arc(0, 0, ringR, 0, Math.PI * 2)
    ctx.strokeStyle = resolveColorRgba(ring.colorT, fadeAlpha * 0.3, vc)
    ctx.lineWidth = thickness * 3
    if (vc?.glowEnabled) applyGlow(ctx, ring.colorT, vc, ring.intensity * (1 - progress))
    ctx.stroke()
    if (vc?.glowEnabled) clearGlow(ctx)

    // ── Color pass (medium) ──
    ctx.beginPath()
    ctx.arc(0, 0, ringR, 0, Math.PI * 2)
    ctx.strokeStyle = resolveColorRgba(ring.colorT, fadeAlpha * 0.7, vc)
    ctx.lineWidth = thickness * 1.5
    ctx.stroke()

    // ── White hot core (thin, bright) ──
    ctx.beginPath()
    ctx.arc(0, 0, ringR, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(255,255,255,${fadeAlpha * 0.6})`
    ctx.lineWidth = thickness * 0.5
    ctx.stroke()

    // ── Shockwave distortion lines (radial burst lines at ring edge) ──
    if (ring.intensity > 0.6 && progress < 0.5) {
      const lineCount = 16
      const lineAlpha = fadeAlpha * 0.4 * (1 - progress * 2)
      ctx.lineWidth = size * 0.001
      for (let l = 0; l < lineCount; l++) {
        const angle = (l / lineCount) * Math.PI * 2
        const innerR = ringR - thickness * 2
        const outerR = ringR + thickness * 2
        const cos = Math.cos(angle), sin = Math.sin(angle)
        ctx.strokeStyle = resolveColorRgba((ring.colorT + l / lineCount) % 1, lineAlpha, vc)
        ctx.beginPath()
        ctx.moveTo(cos * innerR, sin * innerR)
        ctx.lineTo(cos * outerR, sin * outerR)
        ctx.stroke()
      }
    }
  }

  // ── Static spectrum ring: always-visible thin ring showing current spectrum ──
  if (spectrum && spectrum.length > 0) {
    const specSegs = 48
    const specR = baseR * 0.12
    const specPts: [number, number][] = []
    for (let i = 0; i < specSegs; i++) {
      const angle = (i / specSegs) * Math.PI * 2 - Math.PI / 2
      const mi = i < specSegs / 2 ? i : specSegs - 1 - i
      const specVal = spectrum.length > 0
        ? (spectrum[Math.floor(mi / specSegs * spectrum.length)] ?? 0) / 255
        : 0.3
      const r = specR + specVal * maxOff * 0.15 * amplitude
      specPts.push([Math.cos(angle) * r, Math.sin(angle) * r])
    }
    ctx.beginPath()
    for (let i = 0; i < specPts.length; i++) {
      if (i === 0) ctx.moveTo(specPts[i]![0], specPts[i]![1])
      else ctx.lineTo(specPts[i]![0], specPts[i]![1])
    }
    ctx.closePath()
    ctx.strokeStyle = resolveColorRgba(shift, 0.2 + midE * 0.15, vc)
    ctx.lineWidth = size * 0.001
    ctx.stroke()
  }

  ctx.restore()
}

// ═══ Registration ═══
registerWave('shockwave', drawWaveShockwave, {
  id: 'shockwave',
  label: 'Sóng xung',
  icon: '💥',
  category: 'tech',
})

// ═══ Cleanup ═══
registerWaveCleanup(() => {
  ringPool = []
  lastSpawnTime = 0
  prevBeat = 0
})

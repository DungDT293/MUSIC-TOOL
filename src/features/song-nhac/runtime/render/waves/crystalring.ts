/**
 * Wave Style: Pha lê (crystalring)
 * Icon: 💎
 * Category: artistic
 *
 * V2: Beat breathing (ring radius pulses with beat inhale/exhale),
 *     light ray projections from peak spectrum points outward,
 *     color temperature warm→cool shift based on audio energy,
 *     enhanced sparkle system.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, applyGlow, clearGlow, smoothPath } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

function drawWaveCrystalRing(
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
  const maxOff = getMaxOffset(w, h) * amplitude * 1.1
  const spd = vc?.speed ?? 1
  const time = animTimeMs() * 0.001 * spd
  const shift = (time * 0.02) % 1
  const ringSegs = 64
  const beatV = beat ?? 0
  const bassE = bands?.bass ?? 0.5
  const midE = bands?.mid ?? 0.4
  const trebleE = bands?.treble ?? 0.3

  // ── Beat breathing: ring radius pulses (inhale/exhale) ──
  const breathe = 1 + beatV * 0.04 * Math.sin(time * 3)
  const baseR = (Math.sqrt(w * w + h * h) / 2 + size * 0.005) * breathe

  // ── Color temperature shift: warm→cool based on total energy ──
  const totalEnergy = (bassE * 2 + midE + trebleE) / 4
  // Crystal/rainbow refraction colors — lerp warm/cool
  const crystalColors: [number, number, number][] = [
    [180 + Math.floor(totalEnergy * 40), 220, 255],   // ice blue → warmer blue
    [220, 200 - Math.floor(totalEnergy * 30), 255],   // lavender → deeper violet
    [255, 200 + Math.floor(totalEnergy * 30), 220],   // rose quartz → warmer
    [200, 255, 240 - Math.floor(totalEnergy * 40)],   // mint → teal
    [255, 240, 200],                                    // champagne
    [200, 220, 255],                                    // periwinkle
    [255, 220, 240],                                    // pink diamond
  ]

  function crystalColor(t: number, alpha: number): string {
    const ct = ((t % 1) + 1) % 1
    const s = ct * (crystalColors.length - 1)
    const i = Math.min(Math.floor(s), crystalColors.length - 2)
    const f = s - i
    const a = crystalColors[i]!
    const b = crystalColors[i + 1]!
    return `rgba(${a[0] + (b[0] - a[0]) * f | 0},${a[1] + (b[1] - a[1]) * f | 0},${a[2] + (b[2] - a[2]) * f | 0},${alpha})`
  }

  ctx.save()

  // Ring 1: Outer crystal ring (main audio reactive)
  const outerPts: [number, number][] = []
  const innerPts: [number, number][] = []
  const specValues: number[] = [] // cache for light ray pass
  for (let i = 0; i < ringSegs; i++) {
    // Full 360°: map spectrum across all segments (no mirror)
    const rawT = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, i, ringSegs)
      : getSampleAt(samples, Math.floor((i / ringSegs) * WAVE_SEGMENTS))
    specValues.push(rawT)
    const t = Math.pow(rawT, 1.1)
    const angle = (i / ringSegs) * Math.PI * 2 - Math.PI / 2

    // Crystal facet effect: slight angular jumps
    const facetAngle = Math.floor(angle * 6) / 6
    const facetBlend = 0.7 + 0.3 * Math.cos((angle - facetAngle) * 18)

    const outerR = baseR + t * maxOff * facetBlend * (1 + beatV * 0.06)
    const innerR = baseR + t * maxOff * 0.12
    const cos = Math.cos(angle), sin = Math.sin(angle)
    outerPts.push([cos * outerR, sin * outerR])
    innerPts.push([cos * innerR, sin * innerR])
  }

  // Filled band: frosted glass effect
  ctx.beginPath()
  const n = outerPts.length
  ctx.moveTo(outerPts[0]![0], outerPts[0]![1])
  for (let i = 1; i < n; i++) ctx.lineTo(outerPts[i]![0], outerPts[i]![1])
  const revInner = [...innerPts].reverse()
  for (let i = 0; i < revInner.length; i++) {
    ctx.lineTo(revInner[i]![0], revInner[i]![1])
  }
  ctx.closePath()
  const frostGrad = ctx.createRadialGradient(0, 0, baseR * 0.8, 0, 0, baseR + maxOff)
  frostGrad.addColorStop(0, crystalColor(shift, 0.05))
  frostGrad.addColorStop(0.5, crystalColor(shift + 0.3, 0.08 + beatV * 0.03))
  frostGrad.addColorStop(1, crystalColor(shift + 0.6, 0.03))
  ctx.fillStyle = frostGrad
  ctx.fill()

  // Pass 1: Wide soft diffused glow
  ctx.beginPath()
  smoothPath(ctx, outerPts, true)
  ctx.strokeStyle = crystalColor(shift, 0.2 + beatV * 0.08)
  ctx.lineWidth = size * 0.012 * (1 + beatV * 0.15)
  ctx.lineJoin = 'round'
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, beatV)
  ctx.stroke()
  if (vc?.glowEnabled) clearGlow(ctx)

  // Pass 2: Rainbow refraction edge (shifting colors along ring)
  ctx.beginPath()
  smoothPath(ctx, outerPts, true)
  const refractionGrad = ctx.createConicGradient(-Math.PI / 2, 0, 0)
  for (let s = 0; s <= 1; s += 0.14) {
    refractionGrad.addColorStop(s, crystalColor(shift + s, 0.7))
  }
  ctx.strokeStyle = refractionGrad
  ctx.lineWidth = size * 0.004
  ctx.stroke()

  // Pass 3: White diamond sparkle core
  ctx.beginPath()
  smoothPath(ctx, outerPts, true)
  ctx.strokeStyle = `rgba(255, 255, 255, 0.5)`
  ctx.lineWidth = size * 0.001
  ctx.stroke()

  // ── Light ray projections from peak spectrum points outward ──
  if (trebleE > 0.25) {
    ctx.save()
    ctx.globalAlpha = 0.5
    for (let i = 0; i < ringSegs; i += 4) {
      const rawT = specValues[i]!
      if (rawT < 0.6) continue

      const angle = (i / ringSegs) * Math.PI * 2 - Math.PI / 2
      const [px, py] = outerPts[i]!
      const rayLen = size * 0.03 * rawT * (1 + beatV * 0.3)
      const cos = Math.cos(angle), sin = Math.sin(angle)
      const rx = px + cos * rayLen
      const ry = py + sin * rayLen
      const rayShift = (shift + i / ringSegs) % 1

      // Gradient ray
      const rayGrad = ctx.createLinearGradient(px, py, rx, ry)
      rayGrad.addColorStop(0, crystalColor(rayShift, 0.4 * rawT))
      rayGrad.addColorStop(0.5, crystalColor(rayShift + 0.1, 0.15))
      rayGrad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.strokeStyle = rayGrad
      ctx.lineWidth = size * 0.002 * rawT
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(rx, ry)
      ctx.stroke()
    }
    ctx.restore()
  }

  // Diamond sparkle particles at peak points — enhanced with beat
  ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + bassE * 0.4 + beatV * 0.15})`
  for (let i = 0; i < ringSegs; i += 4) {
    const rawT = specValues[i]!
    if (rawT < 0.5) continue
    const [px, py] = outerPts[i]!
    const sparkleSize = size * 0.005 * rawT * (1 + beatV * 0.2)
    // 4-pointed star
    ctx.beginPath()
    ctx.moveTo(px, py - sparkleSize)
    ctx.lineTo(px + sparkleSize * 0.3, py)
    ctx.lineTo(px, py + sparkleSize)
    ctx.lineTo(px - sparkleSize * 0.3, py)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(px - sparkleSize, py)
    ctx.lineTo(px, py + sparkleSize * 0.3)
    ctx.lineTo(px + sparkleSize, py)
    ctx.lineTo(px, py - sparkleSize * 0.3)
    ctx.closePath()
    ctx.fill()
  }

  // ═══ Scanning highlight — bright spot orbiting around the ring ═══
  const scanAngle = time * 1.2
  const scanI = Math.floor(((scanAngle / (Math.PI * 2)) % 1) * ringSegs) % ringSegs
  const scanRad = size * 0.025 * (0.8 + bassE * 0.5) * (1 + beatV * 0.15)
  const sp = outerPts[scanI]!
  const scanGrad = ctx.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], scanRad)
  scanGrad.addColorStop(0, 'rgba(255, 255, 255, 0.8)')
  scanGrad.addColorStop(0.3, crystalColor(shift, 0.5))
  scanGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = scanGrad
  ctx.beginPath()
  ctx.arc(sp[0], sp[1], scanRad, 0, Math.PI * 2)
  ctx.fill()

  // ═══ Inner refraction ring (subtle prismatic halo closer to image) ═══
  const innerRingR = baseR * 0.92
  ctx.beginPath()
  ctx.arc(0, 0, innerRingR, 0, Math.PI * 2)
  const innerGrad = ctx.createConicGradient(-Math.PI / 2 + time * 0.3, 0, 0)
  for (let s = 0; s <= 1; s += 0.125) {
    innerGrad.addColorStop(s, crystalColor(shift + s + 0.5, 0.12 + bassE * 0.08))
  }
  ctx.strokeStyle = innerGrad
  ctx.lineWidth = size * 0.002
  ctx.stroke()

  ctx.restore()
}

// ═══ Registration ═══
registerWave('crystalring', drawWaveCrystalRing, {
  id: 'crystalring',
  label: 'Pha lê',
  icon: '🔮',
  category: 'artistic',
})

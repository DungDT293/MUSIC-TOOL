/**
 * Wave Style: Xoắn ADN (helix)
 * Icon: 🧬
 * Category: tech
 *
 * V2: Spline smooth strands, depth fog, enzyme particles along strands,
 *     phosphorescence trail glow.
 */

import { type FrequencyBands, type VisualizerColorOptions, getSpectrumAt, animTimeMs, resolveColorRgba, applyGlow, clearGlow, smoothPath, deterministicRandom } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

// Persistent enzyme particles
interface EnzymeParticle { t: number; strand: 0 | 1; speed: number }
let enzymeParticles: EnzymeParticle[] | null = null
const ENZYME_COUNT = 12

function drawWaveHelix(
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
  const midE = bands?.mid ?? 0.3
  const beatVal = beat ?? 0

  // Init enzymes
  if (!enzymeParticles || enzymeParticles.length !== ENZYME_COUNT) {
    enzymeParticles = []
    for (let i = 0; i < ENZYME_COUNT; i++) {
      enzymeParticles.push({
        t: deterministicRandom(i * 73.1 + 11),
        strand: (i % 2) as 0 | 1,
        speed: 0.003 + deterministicRandom(i * 47.3 + 29) * 0.005,
      })
    }
  }

  ctx.save()

  const strandCount = 80
  const helixLen = w * 0.85
  const helixR = size * 0.12 * amplitude * (1 + bassE * 0.3)
  const startX = -helixLen / 2
  const rotSpeed = time * 1.8

  // Build two strands with 3D depth
  const strandA: { x: number; y: number; z: number }[] = []
  const strandB: { x: number; y: number; z: number }[] = []
  for (let i = 0; i < strandCount; i++) {
    const t = i / (strandCount - 1)
    const x = startX + t * helixLen
    const angle = t * Math.PI * 6 + rotSpeed
    const specVal = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, Math.floor(t * 48), 64) : 0.3
    const r = helixR * (0.5 + specVal * 0.8)
    strandA.push({ x, y: Math.sin(angle) * r, z: Math.cos(angle) })
    strandB.push({ x, y: Math.sin(angle + Math.PI) * r, z: Math.cos(angle + Math.PI) })
  }

  // Connecting rungs (draw behind strands for depth)
  for (let i = 0; i < strandCount; i += 5) {
    const a = strandA[i]!, b = strandB[i]!
    const avgZ = (a.z + b.z) / 2
    const depthFade = 0.3 + (avgZ + 1) * 0.35  // depth fog
    const specVal = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, Math.floor((i / strandCount) * 48), 64) : 0.2
    const alpha = (0.06 + specVal * 0.12 + beatVal * 0.05) * depthFade
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = resolveColorRgba(shift + i / strandCount * 0.5, alpha, vc)
    ctx.lineWidth = size * 0.001 * (0.5 + specVal * 0.5) * depthFade
    ctx.stroke()
  }

  // Draw strand A — smooth spline with depth fog
  const ptsA: [number, number][] = strandA.map(p => [p.x, p.y])
  ctx.beginPath()
  smoothPath(ctx, ptsA, false)
  // Depth-averaged alpha
  const avgDepthA = strandA.reduce((s, p) => s + (p.z + 1) / 2, 0) / strandA.length
  ctx.strokeStyle = resolveColorRgba(shift, (0.5 + beatVal * 0.2) * (0.5 + avgDepthA * 0.5), vc)
  ctx.lineWidth = size * 0.003 * (0.7 + bassE * 0.3)
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, beatVal)
  ctx.stroke()
  if (vc?.glowEnabled) clearGlow(ctx)

  // Phosphorescence trail for strand A (wider, dimmer)
  ctx.beginPath()
  smoothPath(ctx, ptsA, false)
  ctx.strokeStyle = resolveColorRgba(shift, 0.08 + beatVal * 0.04, vc)
  ctx.lineWidth = size * 0.012
  ctx.stroke()

  // Draw strand B
  const ptsB: [number, number][] = strandB.map(p => [p.x, p.y])
  ctx.beginPath()
  smoothPath(ctx, ptsB, false)
  const avgDepthB = strandB.reduce((s, p) => s + (p.z + 1) / 2, 0) / strandB.length
  ctx.strokeStyle = resolveColorRgba(shift + 0.5, (0.5 + beatVal * 0.2) * (0.5 + avgDepthB * 0.5), vc)
  ctx.lineWidth = size * 0.003 * (0.7 + bassE * 0.3)
  if (vc?.glowEnabled) applyGlow(ctx, shift + 0.5, vc, beatVal)
  ctx.stroke()
  if (vc?.glowEnabled) clearGlow(ctx)

  // Phosphorescence trail for strand B
  ctx.beginPath()
  smoothPath(ctx, ptsB, false)
  ctx.strokeStyle = resolveColorRgba(shift + 0.5, 0.08 + beatVal * 0.04, vc)
  ctx.lineWidth = size * 0.012
  ctx.stroke()

  // Node dots with depth fog
  for (let i = 0; i < strandCount; i += 3) {
    const a = strandA[i]!, b = strandB[i]!
    const specVal = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, Math.floor((i / strandCount) * 48), 64) : 0.3
    // Strand A dot — depth-aware
    const depthA = (a.z + 1) / 2
    const sizeA = size * 0.003 * (0.3 + depthA * 0.7) * (0.6 + specVal * 0.6)
    const alphaA = (0.2 + depthA * 0.4 + specVal * 0.2)
    ctx.fillStyle = resolveColorRgba(shift + i / strandCount, alphaA, vc)
    ctx.beginPath()
    ctx.arc(a.x, a.y, sizeA, 0, Math.PI * 2)
    ctx.fill()
    // Strand B dot
    const depthB = (b.z + 1) / 2
    const sizeB = size * 0.003 * (0.3 + depthB * 0.7) * (0.6 + specVal * 0.6)
    const alphaB = (0.2 + depthB * 0.4 + specVal * 0.2)
    ctx.fillStyle = resolveColorRgba(shift + 0.5 + i / strandCount, alphaB, vc)
    ctx.beginPath()
    ctx.arc(b.x, b.y, sizeB, 0, Math.PI * 2)
    ctx.fill()
  }

  // Enzyme particles — small bright dots running along strands
  for (const enz of enzymeParticles!) {
    enz.t += enz.speed * spd * (1 + beatVal * 0.5)
    if (enz.t > 1) enz.t -= 1
    const idx = Math.floor(enz.t * (strandCount - 1))
    const strand = enz.strand === 0 ? strandA : strandB
    const pt = strand[idx]!
    const depth = (pt.z + 1) / 2
    const enzR = size * 0.004 * (0.5 + depth * 0.5)
    // Bright glow
    const enzGrad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, enzR * 2)
    enzGrad.addColorStop(0, resolveColorRgba(shift + enz.t, 0.6 * depth, vc))
    enzGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = enzGrad
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, enzR * 2, 0, Math.PI * 2)
    ctx.fill()
    // White center
    ctx.fillStyle = `rgba(255,255,255,${0.5 * depth})`
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, enzR * 0.4, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

// ═══ Registration ═══
registerWave('helix', drawWaveHelix, {
  id: 'helix',
  label: 'Xoắn ADN',
  icon: '🧬',
  category: 'tech',
})
registerWaveCleanup(() => { enzymeParticles = null })

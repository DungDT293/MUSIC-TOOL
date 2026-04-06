/**
 * Wave Style: Sét (lightning)
 * Icon: ⚡
 * Category: nature
 *
 * V2: Bolt branching on high energy, beat flash overlay,
 *     thunder afterglow at bolt base, fixed icon ⚡.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba, applyGlow, clearGlow, speedShift } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

function drawWaveLightning(
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
  const halfW = w / 2, halfH = h / 2
  const size = Math.max(w, h)
  const maxLen = getMaxOffset(w, h) * amplitude * 1.5
  const spd = vc?.speed ?? 1
  const shift = speedShift((animTimeMs() * 0.0002) % 1, spd)
  const seed = Math.floor(animTimeMs() / (80 / spd))
  const beatV = beat ?? 0

  const rng = (n: number) => {
    const x = Math.sin(seed * 9301 + n * 49297) * 49297
    return x - Math.floor(x)
  }

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // ── Beat flash: brief white-blue overlay on strong beats ──
  if (beatV > 0.75) {
    const flashAlpha = (beatV - 0.75) * 1.5
    ctx.fillStyle = `rgba(200,220,255,${Math.min(0.12, flashAlpha * 0.35)})`
    ctx.fillRect(-halfW, -halfH, w, h)
  }

  const boltsPerEdge = 7
  const allBolts: { pts: [number, number][]; colorT: number; t: number; sx: number; sy: number }[] = []

  for (let edge = 0; edge < 4; edge++) {
    const isHoriz = edge === 0 || edge === 2
    const edgeLen = isHoriz ? w : h

    for (let j = 0; j < boltsPerEdge; j++) {
      const gIdx = edge * boltsPerEdge + j
      const rawT = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, gIdx, boltsPerEdge * 4)
        : getSampleAt(samples, Math.floor(gIdx * WAVE_SEGMENTS / (boltsPerEdge * 4)))
      if (rawT < 0.12) continue

      const t = Math.pow(rawT, 1.2)
      const boltLen = t * maxLen * (1 + beatV * 0.15)
      const pos = (j + 0.5) / boltsPerEdge * edgeLen

      let sx: number, sy: number, nx: number, ny: number
      if (edge === 0) { sx = -halfW + pos; sy = -halfH; nx = 0; ny = -1 }
      else if (edge === 1) { sx = halfW; sy = -halfH + pos; nx = 1; ny = 0 }
      else if (edge === 2) { sx = -halfW + pos; sy = halfH; nx = 0; ny = 1 }
      else { sx = -halfW; sy = halfH - pos; nx = -1; ny = 0 }

      const segs = 5 + Math.floor(t * 3)
      const pts: [number, number][] = [[sx, sy]]
      for (let s = 1; s <= segs; s++) {
        const p = s / segs
        const mx = sx + nx * boltLen * p
        const my = sy + ny * boltLen * p
        const perpAmt = boltLen * 0.35 * (1 - p)
        const jSeed = gIdx * 100 + s
        const px = isHoriz ? (rng(jSeed) - 0.5) * perpAmt : 0
        const py = !isHoriz ? (rng(jSeed + 50) - 0.5) * perpAmt : 0
        pts.push([mx + px, my + py])
      }

      const colorT = ((edge * boltsPerEdge + j) / (boltsPerEdge * 4) + shift) % 1
      allBolts.push({ pts, colorT, t, sx, sy })

      // ── Bolt branching: 1 sub-branch from midpoint for strong bolts ──
      if (t > 0.5 && segs > 4) {
        const branchStart = Math.floor(segs * 0.4)
        const branchPt = pts[branchStart]
        if (branchPt) {
          const branchLen = boltLen * 0.4 * t
          const branchSegs = 3
          const branchPts: [number, number][] = [branchPt]
          const branchDir = rng(gIdx * 200) > 0.5 ? 1 : -1
          for (let s = 1; s <= branchSegs; s++) {
            const p = s / branchSegs
            const bx = branchPt[0] + nx * branchLen * p + (isHoriz ? 0 : branchDir * branchLen * p * 0.5)
            const by = branchPt[1] + ny * branchLen * p + (!isHoriz ? 0 : branchDir * branchLen * p * 0.5)
            const jp = branchLen * 0.2 * (1 - p)
            branchPts.push([
              bx + (rng(gIdx * 300 + s) - 0.5) * jp,
              by + (rng(gIdx * 301 + s) - 0.5) * jp,
            ])
          }
          allBolts.push({ pts: branchPts, colorT: (colorT + 0.1) % 1, t: t * 0.6, sx, sy })
        }
      }
    }
  }

  // Pass 1: PRISM colour strokes
  ctx.lineWidth = size * 0.004
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, beatV)
  for (const bolt of allBolts) {
    ctx.beginPath()
    ctx.moveTo(bolt.pts[0]![0], bolt.pts[0]![1])
    for (let s = 1; s < bolt.pts.length; s++) ctx.lineTo(bolt.pts[s]![0], bolt.pts[s]![1])
    ctx.strokeStyle = resolveColorRgba(bolt.colorT, 0.55, vc)
    ctx.stroke()
  }
  if (vc?.glowEnabled) clearGlow(ctx)

  // Pass 2: White core
  ctx.lineWidth = size * 0.0018
  for (const bolt of allBolts) {
    ctx.beginPath()
    ctx.moveTo(bolt.pts[0]![0], bolt.pts[0]![1])
    for (let s = 1; s < bolt.pts.length; s++) ctx.lineTo(bolt.pts[s]![0], bolt.pts[s]![1])
    ctx.strokeStyle = `rgba(255,255,255,${0.65 + bolt.t * 0.35})`
    ctx.stroke()
  }

  // ── Thunder afterglow: persistent glow at bolt base for strong bolts ──
  for (const bolt of allBolts) {
    if (bolt.t > 0.6) {
      const glowR = size * 0.02 * bolt.t * (1 + beatV * 0.3)
      const grad = ctx.createRadialGradient(bolt.sx, bolt.sy, 0, bolt.sx, bolt.sy, glowR)
      grad.addColorStop(0, resolveColorRgba(bolt.colorT, 0.3 * bolt.t, vc))
      grad.addColorStop(0.5, resolveColorRgba(bolt.colorT, 0.08, vc))
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(bolt.sx, bolt.sy, glowR, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.restore()
}

// ═══ Registration ═══
registerWave('lightning', drawWaveLightning, {
  id: 'lightning',
  label: 'Sét',
  icon: '⚡',
  category: 'nature',
})

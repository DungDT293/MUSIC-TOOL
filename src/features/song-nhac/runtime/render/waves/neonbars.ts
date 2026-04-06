/**
 * Wave Style: Neon 3D (neonbars)
 * Icon: 💡
 * Category: tech
 *
 * V2: Performance — reduced passes for small bars (t < 0.3: 2 passes instead of 5),
 *     beat pulse wave propagating from center, bar reflections (mirror ghost),
 *     connecting arcs between adjacent high bar tips.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, speedShift } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

function drawWaveNeonBars(
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
  const maxOffset = getMaxOffset(w, h) * amplitude * 1.2
  const barsPerEdge = Math.max(8, Math.min(60, Math.round((vc?.barCount ?? 112) / 4)))
  const totalBars = barsPerEdge * 4
  const spd = vc?.speed ?? 1
  const shift = speedShift((animTimeMs() * 0.00015) % 1, spd)
  const time = animTimeMs() * 0.001 * spd

  // Neon colors: hot pink, electric cyan, violet
  const neonPink: [number, number, number] = [255, 20, 120]
  const neonCyan: [number, number, number] = [0, 255, 230]
  const neonViolet: [number, number, number] = [160, 40, 255]

  function neonColorAt(t: number, alpha: number): string {
    const ct = ((t % 1) + 1) % 1
    let r: number, g: number, b: number
    if (ct < 0.33) {
      const f = ct * 3
      r = neonPink[0] + (neonCyan[0] - neonPink[0]) * f
      g = neonPink[1] + (neonCyan[1] - neonPink[1]) * f
      b = neonPink[2] + (neonCyan[2] - neonPink[2]) * f
    } else if (ct < 0.66) {
      const f = (ct - 0.33) * 3
      r = neonCyan[0] + (neonViolet[0] - neonCyan[0]) * f
      g = neonCyan[1] + (neonViolet[1] - neonCyan[1]) * f
      b = neonCyan[2] + (neonViolet[2] - neonCyan[2]) * f
    } else {
      const f = (ct - 0.66) * 3
      r = neonViolet[0] + (neonPink[0] - neonViolet[0]) * f
      g = neonViolet[1] + (neonPink[1] - neonViolet[1]) * f
      b = neonViolet[2] + (neonPink[2] - neonViolet[2]) * f
    }
    return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`
  }

  const bassE = bands?.bass ?? 0.5
  const beatV = beat ?? 0

  ctx.save()
  ctx.lineCap = 'butt'

  // ═══ Pass 0: Corner glow beacons (bass-reactive neon bloom) ═══
  if (bassE > 0.3) {
    const cornerGlowR = size * 0.06 * (0.3 + bassE * 0.7) * (1 + beatV * 0.2)
    const corners: [number, number][] = [
      [-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH],
    ]
    for (let c = 0; c < 4; c++) {
      const [cx, cy] = corners[c]!
      const cShift = (shift + c * 0.25) % 1
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cornerGlowR)
      grad.addColorStop(0, neonColorAt(cShift, 0.35 * bassE))
      grad.addColorStop(0.5, neonColorAt(cShift + 0.15, 0.12 * bassE))
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, cornerGlowR, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ── Beat pulse wave: expanding ring from center on beat ──
  if (beatV > 0.4) {
    const pulsePhase = (time * 3) % 1
    const pulseR = size * 0.1 + pulsePhase * size * 0.45
    const pulseAlpha = (1 - pulsePhase) * beatV * 0.15
    ctx.beginPath()
    ctx.arc(0, 0, pulseR, 0, Math.PI * 2)
    ctx.strokeStyle = neonColorAt(shift, pulseAlpha)
    ctx.lineWidth = size * 0.003 * (1 - pulsePhase)
    ctx.stroke()
  }

  // Collect bar tips for connecting arcs
  const barTips: { x: number; y: number; t: number; colorT: number; edge: number }[] = []

  for (let edge = 0; edge < 4; edge++) {
    const isHoriz = edge === 0 || edge === 2
    const edgeLen = isHoriz ? w : h
    const spacing = edgeLen / (barsPerEdge + 1)
    const barW = Math.max(size * 0.004, spacing * 0.55)
    const eShift = (shift + edge * 0.25) % 1

    for (let j = 0; j < barsPerEdge; j++) {
      const mj = j < barsPerEdge / 2 ? j : barsPerEdge - 1 - j
      const gi = edge * barsPerEdge + mj
      const raw = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, gi, totalBars)
        : getSampleAt(samples, Math.floor(gi * WAVE_SEGMENTS / totalBars))
      const t = Math.pow(raw, 1.2)
      if (t < 0.03) continue

      const len = Math.max(size * 0.005, t * maxOffset)
      const pos = (j + 1) * spacing
      const colorT = ((gi / totalBars) + eShift) % 1

      let sx: number, sy: number, ex: number, ey: number
      if (edge === 0) { sx = -halfW + pos; sy = -halfH; ex = sx; ey = sy - len }
      else if (edge === 1) { sx = halfW; sy = -halfH + pos; ex = sx + len; ey = sy }
      else if (edge === 2) { sx = -halfW + pos; sy = halfH; ex = sx; ey = sy + len }
      else { sx = -halfW; sy = -halfH + pos; ex = sx - len; ey = sy }

      // Scan line flicker effect
      const scanLine = Math.sin(j * 0.5 + time * 3) * 0.5 + 0.5
      const scanAlpha = 0.7 + scanLine * 0.3

      // Bass-reactive bar stretch + beat boost
      const bassStretch = 1 + bassE * 0.35 + beatV * 0.1
      const exB = sx + (ex - sx) * bassStretch
      const eyB = sy + (ey - sy) * bassStretch

      // ── Performance optimization: fewer passes for small bars ──
      if (t < 0.3) {
        // Small bars: just 2 passes (glow + core)
        ctx.lineWidth = barW * 2
        ctx.strokeStyle = neonColorAt(colorT, 0.25 * t * scanAlpha)
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(exB, eyB); ctx.stroke()

        ctx.lineWidth = barW * 0.8
        ctx.strokeStyle = neonColorAt(colorT, 0.8 * scanAlpha)
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(exB, eyB); ctx.stroke()
      } else {
        // Pass 1: Wide outer glow
        ctx.lineWidth = barW * 3
        ctx.strokeStyle = neonColorAt(colorT, 0.15 * t * scanAlpha)
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(exB, eyB); ctx.stroke()

        // Pass 2: Medium glow
        ctx.lineWidth = barW * 1.8
        ctx.strokeStyle = neonColorAt(colorT, 0.4 * t * scanAlpha)
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(exB, eyB); ctx.stroke()

        // Pass 3: Sharp bright core
        ctx.lineWidth = barW * 0.8
        ctx.strokeStyle = neonColorAt(colorT, 0.95 * scanAlpha)
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(exB, eyB); ctx.stroke()

        // Pass 4: White hot center on high peaks
        if (t > 0.6) {
          ctx.lineWidth = barW * 0.3
          ctx.strokeStyle = `rgba(255,255,255,${(t - 0.6) * 2.5 * scanAlpha})`
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(exB, eyB); ctx.stroke()
        }

        // Pass 5: Tip particle sparkle on very high peaks
        if (t > 0.75) {
          const sparkSize = size * 0.004 * t
          ctx.fillStyle = neonColorAt(colorT, 0.8)
          ctx.beginPath()
          ctx.arc(exB, eyB, sparkSize, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = `rgba(255,255,255,${(t - 0.75) * 3})`
          ctx.lineWidth = 0.5
          ctx.beginPath()
          ctx.moveTo(exB - sparkSize * 1.8, eyB)
          ctx.lineTo(exB + sparkSize * 1.8, eyB)
          ctx.moveTo(exB, eyB - sparkSize * 1.8)
          ctx.lineTo(exB, eyB + sparkSize * 1.8)
          ctx.stroke()
        }
      }

      // ── Bar reflection: mirror ghost (very subtle) ──
      if (t > 0.4) {
        // Reflect inward with reduced opacity
        const refLen = len * 0.3
        let rxE: number, ryE: number
        if (edge === 0) { rxE = sx; ryE = -halfH + refLen }
        else if (edge === 1) { rxE = halfW - refLen; ryE = sy }
        else if (edge === 2) { rxE = sx; ryE = halfH - refLen }
        else { rxE = -halfW + refLen; ryE = sy }
        ctx.lineWidth = barW * 0.6
        ctx.strokeStyle = neonColorAt(colorT, 0.08 * t)
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(rxE, ryE); ctx.stroke()
      }

      // Collect tip for connecting arcs
      if (t > 0.5) {
        barTips.push({ x: exB, y: eyB, t, colorT, edge })
      }
    }
  }

  // ── Connecting arcs: neon lines between adjacent high bar tips (treble-reactive) ──
  const trebleE = bands?.treble ?? 0.3
  if (trebleE > 0.35 && barTips.length > 2) {
    ctx.globalAlpha = 0.3 * trebleE
    ctx.lineWidth = size * 0.001
    // Connect consecutive tips on the same edge
    for (let i = 0; i < barTips.length - 1; i++) {
      const a = barTips[i]!, b = barTips[i + 1]!
      if (a.edge !== b.edge) continue
      const dx = b.x - a.x, dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > size * 0.15) continue // skip if too far apart
      ctx.strokeStyle = neonColorAt((a.colorT + b.colorT) / 2, 0.5 * trebleE)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      // Slight curve via midpoint
      ctx.quadraticCurveTo(
        (a.x + b.x) / 2 + dy * 0.15,
        (a.y + b.y) / 2 - dx * 0.15,
        b.x, b.y,
      )
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  // ═══ Scanning laser line (sweeps around the border) ═══
  const scanAngle = (time * 0.8) % 4
  const scanEdge = Math.floor(scanAngle) % 4
  const scanPos = (scanAngle - scanEdge)
  const scanIsHoriz = scanEdge === 0 || scanEdge === 2
  const scanEdgeLen = scanIsHoriz ? w : h
  const scanPx = scanPos * scanEdgeLen
  let scanX: number, scanY: number
  if (scanEdge === 0) { scanX = -halfW + scanPx; scanY = -halfH }
  else if (scanEdge === 1) { scanX = halfW; scanY = -halfH + scanPx }
  else if (scanEdge === 2) { scanX = halfW - scanPx; scanY = halfH }
  else { scanX = -halfW; scanY = halfH - scanPx }
  const scanGrad = ctx.createRadialGradient(scanX, scanY, 0, scanX, scanY, size * 0.08)
  scanGrad.addColorStop(0, neonColorAt(shift, 0.5))
  scanGrad.addColorStop(0.4, neonColorAt(shift + 0.1, 0.15))
  scanGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = scanGrad
  ctx.beginPath()
  ctx.arc(scanX, scanY, size * 0.08, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

// ═══ Registration ═══
registerWave('neonbars', drawWaveNeonBars, {
  id: 'neonbars',
  label: 'Neon 3D',
  icon: '💡',
  category: 'tech',
})

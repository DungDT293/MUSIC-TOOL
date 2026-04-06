/**
 * Wave Style: Luoi kim cuong (diamondgrid)
 * Icon: 💎
 * Category: geometric
 *
 * Grid pattern hinh thoi quanh rect. Moi cell sang theo spectrum.
 * Connection lines tao mang luoi dep.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba, applyGlow, clearGlow, speedShift } from './helpers'
import { registerWave } from './registry'

function drawWaveDiamondGrid(
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
  const maxOff = getMaxOffset(w, h) * amplitude
  const shift = speedShift((animTimeMs() * 0.0001) % 1, vc?.speed)
  const bt = beat ?? 0
  const cellsPerEdge = 8
  const totalCells = cellsPerEdge * 4

  // Diamond node positions around the rect
  interface Node {
    x: number; y: number
    outerX: number; outerY: number
    t: number // spectrum amplitude 0-1
    idx: number
  }

  const nodes: Node[] = []
  for (let i = 0; i < totalCells; i++) {
    const edge = Math.floor(i / cellsPerEdge)
    const j = i % cellsPerEdge
    const f = (j + 0.5) / cellsPerEdge

    // Base position on rect edge
    let bx: number, by: number, nx: number, ny: number
    if (edge === 0) { bx = -halfW + f * w; by = -halfH; nx = 0; ny = -1 }
    else if (edge === 1) { bx = halfW; by = -halfH + f * h; nx = 1; ny = 0 }
    else if (edge === 2) { bx = halfW - f * w; by = halfH; nx = 0; ny = 1 }
    else { bx = -halfW; by = halfH - f * h; nx = -1; ny = 0 }

    const rawT = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, i, totalCells)
      : getSampleAt(samples, Math.floor((i / totalCells) * WAVE_SEGMENTS))
    const t = Math.pow(rawT, 1.2)
    const offset = maxOff * (0.15 + 0.85 * t)

    nodes.push({
      x: bx, y: by,
      outerX: bx + nx * offset,
      outerY: by + ny * offset,
      t, idx: i,
    })
  }

  ctx.save()

  // Diamond grid connections: connect each node to its neighbors + cross connections
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Outer connections (between adjacent outer nodes)
  for (let i = 0; i < totalCells; i++) {
    const a = nodes[i]!
    const b = nodes[(i + 1) % totalCells]!
    const avgT = (a.t + b.t) / 2
    if (avgT < 0.05) continue

    const colorT = (i / totalCells + shift) % 1
    ctx.beginPath()
    ctx.moveTo(a.outerX, a.outerY)
    ctx.lineTo(b.outerX, b.outerY)
    ctx.strokeStyle = resolveColorRgba(colorT, 0.15 + avgT * 0.3, vc)
    ctx.lineWidth = size * 0.001 + avgT * size * 0.002
    ctx.stroke()
  }

  // Radial connections (base to outer) for each node
  for (let i = 0; i < totalCells; i++) {
    const n = nodes[i]!
    if (n.t < 0.08) continue
    const colorT = (i / totalCells + shift) % 1
    ctx.beginPath()
    ctx.moveTo(n.x, n.y)
    ctx.lineTo(n.outerX, n.outerY)
    ctx.strokeStyle = resolveColorRgba(colorT, 0.1 + n.t * 0.2, vc)
    ctx.lineWidth = size * 0.001
    ctx.stroke()
  }

  // Cross-connections: diamond pattern (every other node connects to skip-1 neighbor)
  for (let i = 0; i < totalCells; i += 2) {
    const a = nodes[i]!
    const b = nodes[(i + 2) % totalCells]!
    const avgT = (a.t + b.t) / 2
    if (avgT < 0.15) continue

    const colorT = (i / totalCells + shift) % 1
    // Midpoint arc for diamond shape
    const mx = (a.outerX + b.outerX) / 2
    const my = (a.outerY + b.outerY) / 2
    ctx.beginPath()
    ctx.moveTo(a.outerX, a.outerY)
    ctx.lineTo(mx, my)
    ctx.lineTo(b.outerX, b.outerY)
    ctx.strokeStyle = resolveColorRgba(colorT, 0.08 + avgT * 0.15, vc)
    ctx.lineWidth = size * 0.0008
    ctx.stroke()
  }

  // Node dots — diamond-shaped highlights at outer positions
  for (let i = 0; i < totalCells; i++) {
    const n = nodes[i]!
    if (n.t < 0.05) continue
    const colorT = (i / totalCells + shift) % 1

    // Glow
    if (vc?.glowEnabled && n.t > 0.3) {
      applyGlow(ctx, colorT, vc, bt)
    }

    // Diamond shape (rotated square)
    const dSize = size * 0.005 * (0.4 + n.t * 1.2) * (1 + bt * 0.3)
    ctx.save()
    ctx.translate(n.outerX, n.outerY)
    ctx.rotate(Math.PI / 4)
    ctx.beginPath()
    ctx.rect(-dSize / 2, -dSize / 2, dSize, dSize)
    ctx.fillStyle = resolveColorRgba(colorT, 0.5 + n.t * 0.5, vc)
    ctx.fill()
    ctx.restore()

    if (vc?.glowEnabled && n.t > 0.3) clearGlow(ctx)
  }

  // Beat flash: brief bright ring on beat
  if (bt > 0.5) {
    const flashR = Math.sqrt(halfW * halfW + halfH * halfH) + maxOff * 0.5
    ctx.beginPath()
    ctx.arc(0, 0, flashR, 0, Math.PI * 2)
    ctx.strokeStyle = resolveColorRgba(shift, bt * 0.15, vc)
    ctx.lineWidth = size * 0.003
    ctx.stroke()
  }

  ctx.restore()
}

// === Registration ===
registerWave('diamondgrid', drawWaveDiamondGrid, {
  id: 'diamondgrid',
  label: 'Luoi kim cuong',
  icon: '💎',
  category: 'geometric',
})

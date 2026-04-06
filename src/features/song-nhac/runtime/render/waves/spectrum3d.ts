/**
 * Wave Style: Phổ 3D (spectrum3d)
 * Icon: 📐
 * Category: tech
 *
 * V2: Mountain silhouette connecting lines, color temperature mapping
 *     (bass=warm, treble=cool), ground plane grid, improved depth.
 */

import { type FrequencyBands, type VisualizerColorOptions, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba } from './helpers'
import { registerWave } from './registry'

function drawWaveSpectrum3d(
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
  const halfW = w / 2, halfH = h / 2
  const spd = vc?.speed ?? 1
  const time = animTimeMs() * 0.001 * spd
  const shift = (time * 0.03) % 1
  const bassE = bands?.bass ?? 0.3
  const beatVal = beat ?? 0

  ctx.save()

  const barCount = Math.max(12, Math.min(48, vc?.barCount ?? 24))
  const rowCount = 6
  const totalWidth = w * 0.8
  const barGap = totalWidth * 0.01

  // ── Ground plane grid (subtle perspective grid) ──
  ctx.strokeStyle = resolveColorRgba(shift, 0.04, vc)
  ctx.lineWidth = size * 0.0003
  const gridRows = 8
  const gridCols = 12
  for (let r = 0; r < gridRows; r++) {
    const depth = r / (gridRows - 1)
    const perspScale = 1 - depth * 0.5
    const gw = totalWidth * perspScale
    const gy = halfH * 0.55 - depth * halfH * 0.7
    ctx.beginPath()
    ctx.moveTo(-gw / 2, gy)
    ctx.lineTo(gw / 2, gy)
    ctx.stroke()
  }
  for (let c = 0; c <= gridCols; c++) {
    const t = c / gridCols
    const x0 = -totalWidth / 2 + t * totalWidth
    const x1 = -totalWidth * 0.25 + t * totalWidth * 0.5
    ctx.beginPath()
    ctx.moveTo(x0, halfH * 0.55)
    ctx.lineTo(x1, halfH * 0.55 - halfH * 0.7)
    ctx.stroke()
  }

  // ── Render rows back to front ──
  for (let row = rowCount - 1; row >= 0; row--) {
    const depth = row / (rowCount - 1)
    const perspectiveScale = 1 - depth * 0.5
    const rowY = halfH * 0.5 - depth * halfH * 0.7
    const rowAlpha = 1 - depth * 0.6
    const rowWidth = totalWidth * perspectiveScale
    const rowBarW = (rowWidth - (barCount - 1) * barGap * perspectiveScale) / barCount
    const startX = -rowWidth / 2
    const maxBarH = halfH * 0.4 * amplitude * perspectiveScale
    const rowTimeOffset = row * 0.15

    // Collect bar tops for mountain silhouette
    const barTops: [number, number][] = []

    for (let i = 0; i < barCount; i++) {
      const specIdx = Math.floor((i / barCount) * 64)
      let specVal = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, specIdx, 64)
        : getSampleAt(samples, Math.floor((i / barCount) * WAVE_SEGMENTS))
      specVal = Math.max(0, specVal * (0.7 + 0.3 * Math.sin(time * 2 + i * 0.3 + rowTimeOffset)))

      const barH = Math.max(size * 0.002, specVal * maxBarH * (1 + beatVal * 0.2))
      const bx = startX + i * (rowBarW + barGap * perspectiveScale)
      const by = rowY

      // Color temperature: bass bins = warm (red/orange), treble = cool (cyan/blue)
      const freqT = i / barCount  // 0 = bass, 1 = treble
      const tempShift = shift + freqT * 0.4  // spread color across spectrum

      // Bar gradient
      const barGrad = ctx.createLinearGradient(0, by, 0, by - barH)
      const barAlpha = rowAlpha * (0.3 + specVal * 0.6)
      barGrad.addColorStop(0, resolveColorRgba(tempShift + depth * 0.1, barAlpha * 0.9, vc))
      barGrad.addColorStop(0.7, resolveColorRgba(tempShift + depth * 0.1 + 0.08, barAlpha * 0.5, vc))
      barGrad.addColorStop(1, resolveColorRgba(tempShift + depth * 0.1 + 0.15, barAlpha * 0.1, vc))
      ctx.fillStyle = barGrad

      const radius = Math.min(rowBarW * 0.3, size * 0.003)
      ctx.beginPath()
      ctx.roundRect(bx, by, rowBarW, -barH, [radius, radius, 0, 0])
      ctx.fill()

      // Cap dot on front row
      if (row === 0 && specVal > 0.15) {
        ctx.fillStyle = resolveColorRgba(tempShift, 0.8, vc)
        ctx.fillRect(bx, by - barH, rowBarW, -size * 0.002)
      }

      // Record bar top center for mountain line
      barTops.push([bx + rowBarW / 2, by - barH])
    }

    // Mountain silhouette — connecting line across bar tops
    if (barTops.length > 1) {
      ctx.beginPath()
      ctx.moveTo(barTops[0]![0], barTops[0]![1])
      for (let i = 1; i < barTops.length; i++) {
        ctx.lineTo(barTops[i]![0], barTops[i]![1])
      }
      ctx.strokeStyle = resolveColorRgba(shift + depth * 0.15, rowAlpha * 0.2, vc)
      ctx.lineWidth = size * 0.001 * perspectiveScale
      ctx.stroke()
    }
  }

  // Beat pulse
  if (beatVal > 0.3) {
    const pulseR = size * 0.3 * beatVal
    const pulseGrad = ctx.createRadialGradient(0, halfH * 0.2, 0, 0, halfH * 0.2, pulseR)
    pulseGrad.addColorStop(0, resolveColorRgba(shift, (beatVal - 0.3) * 0.08, vc))
    pulseGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = pulseGrad
    ctx.beginPath()
    ctx.arc(0, halfH * 0.2, pulseR, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

// ═══ Registration ═══
registerWave('spectrum3d', drawWaveSpectrum3d, {
  id: 'spectrum3d',
  label: 'Phổ 3D',
  icon: '📐',
  category: 'tech',
})

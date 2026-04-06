/**
 * Wave Style: Nốt nhạc (musicnotes)
 * Icon: 🎵
 * Category: artistic
 */

import { type FrequencyBands, type VisualizerColorOptions, getSpectrumAt, animTimeMs, resolveColorRgba, applyGlow, clearGlow } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

// ─── MUSIC NOTES CIRCLE (H2O Style) ─────────────────────────────────────────
// Faithful recreation of the H2O Music / Pandora Remix visual style:
//  • Rotating 360° ring of glowing musical note symbols (♪ ♫ ♩ ♬)
//  • Subtle grid overlay behind the image
//  • Two concentric orbit rings with connecting arc segments
//  • Side EQ bars: horizontal rect bars on LEFT and RIGHT, beat-reactive
//  • Corner accent dots, orbiting highlight dot
//  • Cyan/blue-white color palette with soft glow

const MUSIC_NOTE_SYMBOLS = ['♪', '♫', '♩', '♬', '♪', '♫', '♩', '♬', '♪', '♫', '♩', '♬', '♪', '♫', '♩', '♬']

function drawWaveMusicNotes(
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
  const shift = (time * 0.02) % 1
  const bassE = bands?.bass ?? 0.3
  const midE = bands?.mid ?? 0.3
  const trebleE = bands?.treble ?? 0.2
  const beatVal = beat ?? 0

  ctx.save()

  // ─── 1. Subtle Grid Overlay ──────────────────────────────────────────────
  {
    const gridSpacing = size * 0.04
    const gridAlpha = 0.035 + bassE * 0.015
    ctx.strokeStyle = `rgba(100, 180, 255, ${gridAlpha})`
    ctx.lineWidth = 0.5
    ctx.beginPath()
    for (let x = -halfW - gridSpacing; x <= halfW + gridSpacing; x += gridSpacing) {
      ctx.moveTo(x, -halfH - gridSpacing)
      ctx.lineTo(x, halfH + gridSpacing)
    }
    for (let y = -halfH - gridSpacing; y <= halfH + gridSpacing; y += gridSpacing) {
      ctx.moveTo(-halfW - gridSpacing, y)
      ctx.lineTo(halfW + gridSpacing, y)
    }
    ctx.stroke()
  }

  // ─── 2. Orbit Rings ──────────────────────────────────────────────────────
  const noteCount = 16
  const baseR = Math.min(halfW, halfH) * 0.88
  const maxOffset = size * 0.035 * amplitude
  const rotationAngle = time * 0.21

  // Outer soft glow ring
  ctx.beginPath()
  ctx.arc(0, 0, baseR * 1.04, 0, Math.PI * 2)
  ctx.strokeStyle = resolveColorRgba(shift, 0.04 + bassE * 0.03, vc)
  ctx.lineWidth = size * 0.006
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, beatVal)
  ctx.stroke()
  if (vc?.glowEnabled) clearGlow(ctx)

  // Main circle ring
  ctx.beginPath()
  ctx.arc(0, 0, baseR, 0, Math.PI * 2)
  ctx.strokeStyle = resolveColorRgba(shift, 0.07 + bassE * 0.05, vc)
  ctx.lineWidth = size * 0.002
  ctx.stroke()

  // Inner thin ring
  ctx.beginPath()
  ctx.arc(0, 0, baseR * 0.94, 0, Math.PI * 2)
  ctx.strokeStyle = resolveColorRgba(shift + 0.3, 0.04 + midE * 0.03, vc)
  ctx.lineWidth = size * 0.0008
  ctx.stroke()

  // Connecting arc segments between notes
  for (let i = 0; i < noteCount; i++) {
    const angle1 = rotationAngle + (i / noteCount) * Math.PI * 2
    const angle2 = rotationAngle + ((i + 1) / noteCount) * Math.PI * 2
    const specVal = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, i * 4, 64) : 0.3
    const arcR = baseR + specVal * maxOffset * 0.25
    ctx.beginPath()
    ctx.arc(0, 0, arcR, angle1 + 0.03, angle2 - 0.03)
    ctx.strokeStyle = resolveColorRgba(shift + i / noteCount, 0.1 + specVal * 0.25, vc)
    ctx.lineWidth = size * 0.003 * (0.5 + specVal * 0.5)
    ctx.stroke()
  }

  // ─── 3. Music Note Symbols (rotating) ────────────────────────────────────
  for (let i = 0; i < noteCount; i++) {
    const angle = rotationAngle + (i / noteCount) * Math.PI * 2
    const specVal = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, i * 4, 64) : 0.3

    const noteR = baseR + specVal * maxOffset
    const nx = Math.cos(angle) * noteR
    const ny = Math.sin(angle) * noteR

    // Note glow halo
    const glowSize = size * 0.032 * (0.5 + specVal * 0.6 + beatVal * 0.3)
    const noteGrad = ctx.createRadialGradient(nx, ny, 0, nx, ny, glowSize)
    noteGrad.addColorStop(0, resolveColorRgba(shift + i / noteCount, 0.2 + specVal * 0.25, vc))
    noteGrad.addColorStop(0.35, resolveColorRgba(shift + i / noteCount, 0.06 + specVal * 0.08, vc))
    noteGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = noteGrad
    ctx.beginPath()
    ctx.arc(nx, ny, glowSize, 0, Math.PI * 2)
    ctx.fill()

    // Note symbol
    const noteChar = MUSIC_NOTE_SYMBOLS[i % MUSIC_NOTE_SYMBOLS.length]!
    const fontSize = size * 0.028 * (0.7 + specVal * 0.5 + beatVal * 0.2)
    ctx.save()
    ctx.translate(nx, ny)
    ctx.font = `${fontSize}px serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowBlur = 6 + specVal * 10
    ctx.shadowColor = resolveColorRgba(shift + i / noteCount, 0.4 + specVal * 0.3, vc)
    ctx.fillStyle = resolveColorRgba(shift + i / noteCount, 0.65 + specVal * 0.35, vc)
    ctx.fillText(noteChar, 0, 0)
    ctx.shadowBlur = 0
    ctx.restore()
  }

  // ─── 4. Side EQ Bars (H2O signature) ─────────────────────────────────────
  // Horizontal rect bars on LEFT and RIGHT sides, beat-reactive
  {
    const eqBarCount = 12
    const barGap = size * 0.005
    const barHeight = size * 0.008
    const totalH = eqBarCount * (barHeight + barGap) - barGap
    const startY = -totalH / 2
    const maxBarLen = size * 0.12 * amplitude
    const eqGap = size * 0.04

    for (let side = 0; side < 2; side++) {
      const xSign = side === 0 ? -1 : 1
      const baseX = xSign * (halfW + eqGap)

      for (let j = 0; j < eqBarCount; j++) {
        const mj = j < eqBarCount / 2 ? j : eqBarCount - 1 - j
        const specVal = spectrum && spectrum.length > 0
          ? getSpectrumAt(spectrum, mj * 5, 64) : 0.3
        const t = Math.pow(specVal, 1.2)
        const barLen = Math.max(size * 0.006, t * maxBarLen * (1 + beatVal * 0.3))

        const by = startY + j * (barHeight + barGap)
        const bx = side === 0 ? baseX - barLen : baseX
        const bw = barLen
        const colorT = (shift + j / eqBarCount) % 1

        // Glow backdrop
        ctx.fillStyle = resolveColorRgba(colorT, 0.08 + t * 0.12, vc)
        ctx.beginPath()
        ctx.roundRect(
          bx - (side === 0 ? barHeight * 0.4 : -barHeight * 0.4),
          by - barHeight * 0.3,
          bw + barHeight * 0.8,
          barHeight + barHeight * 0.6,
          size * 0.002
        )
        ctx.fill()

        // Main bar with gradient
        const gradX0 = side === 0 ? bx + bw : bx
        const gradX1 = side === 0 ? bx : bx + bw
        const barGrad = ctx.createLinearGradient(gradX0, 0, gradX1, 0)
        barGrad.addColorStop(0, resolveColorRgba(colorT, 0.8 + beatVal * 0.2, vc))
        barGrad.addColorStop(0.5, resolveColorRgba(colorT + 0.05, 0.6, vc))
        barGrad.addColorStop(1, resolveColorRgba(colorT + 0.1, 0.15, vc))
        ctx.fillStyle = barGrad
        ctx.beginPath()
        ctx.roundRect(bx, by, bw, barHeight, size * 0.001)
        ctx.fill()

        // Bright tip
        if (t > 0.15) {
          const tipW = size * 0.004
          const tipX = side === 0 ? bx : bx + bw - tipW
          ctx.fillStyle = resolveColorRgba(colorT, 0.9, vc)
          ctx.fillRect(tipX, by, tipW, barHeight)
        }
      }
    }
  }

  // ─── 5. Corner Accent Dots ───────────────────────────────────────────────
  {
    const corners: [number, number][] = [
      [-halfW, -halfH], [halfW, -halfH],
      [-halfW, halfH], [halfW, halfH],
    ]
    const cornerR = size * 0.004 * (0.6 + beatVal * 0.5)
    for (let ci = 0; ci < corners.length; ci++) {
      const [cx, cy] = corners[ci]!
      const cGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cornerR * 4)
      cGrad.addColorStop(0, resolveColorRgba(shift + ci * 0.25, 0.25 + beatVal * 0.15, vc))
      cGrad.addColorStop(0.5, resolveColorRgba(shift + ci * 0.25, 0.08, vc))
      cGrad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = cGrad
      ctx.beginPath()
      ctx.arc(cx, cy, cornerR * 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = `rgba(255, 255, 255, ${0.45 + beatVal * 0.25})`
      ctx.beginPath()
      ctx.arc(cx, cy, cornerR * 0.8, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ─── 6. Orbiting Highlight Dot ───────────────────────────────────────────
  const orbitAngle = time * 1.2
  const orbitR = baseR * 0.98
  const ox = Math.cos(orbitAngle) * orbitR
  const oy = Math.sin(orbitAngle) * orbitR
  const dotR = size * 0.005 * (0.5 + beatVal * 0.6)
  const dotGrad = ctx.createRadialGradient(ox, oy, 0, ox, oy, dotR * 4.5)
  dotGrad.addColorStop(0, 'rgba(255,255,255,0.6)')
  dotGrad.addColorStop(0.25, resolveColorRgba(shift, 0.3, vc))
  dotGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = dotGrad
  ctx.beginPath()
  ctx.arc(ox, oy, dotR * 4.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.beginPath()
  ctx.arc(ox, oy, dotR, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

// ═══ Registration ═══
registerWave('musicnotes', drawWaveMusicNotes, {
  id: 'musicnotes',
  label: 'Nốt nhạc',
  icon: '🎵',
  category: 'artistic',
})

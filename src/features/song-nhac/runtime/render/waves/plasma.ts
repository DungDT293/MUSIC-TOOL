/**
 * Wave Style: Plasma (plasma)
 * Icon: 🌀
 * Category: geometric
 *
 * V2: Beat-reactive ring expansion, plasma cells between rings,
 *     ring breathing via bass, glow intensity boost on beat.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba, resolveConicGrad, applyGlow, clearGlow, smoothPath } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

function drawWavePlasma(
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
  const shift = (time * 0.02) % 1
  const bassE = bands?.bass ?? 0.5
  const beatV = beat ?? 0

  // ── Beat breathing: ring base radius pulses with bass ──
  const breathe = 1 + bassE * 0.03 * Math.sin(time * 2.5)
  const breathedBaseR = baseR * breathe

  // ── Beat expansion: rings push outward on beat ──
  const beatExpand = 1 + beatV * 0.08

  ctx.save()

  // 2 concentric rings
  const ringCount = 2
  const ringRadii: number[] = [] // store for plasma cells positioning
  for (let r = 0; r < ringCount; r++) {
    const ringDist = ((r + 1) / ringCount) * maxOff * beatExpand
    const ringR = breathedBaseR + ringDist * 0.4
    ringRadii.push(ringR)
    const segs = 40
    const pts: [number, number][] = []
    const bandOff = r * 20

    for (let i = 0; i < segs; i++) {
      const angle = (i / segs) * Math.PI * 2 - Math.PI / 2
      // Full 360°: no mirror
      const rawT = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, (bandOff + i) % 64, segs)
        : getSampleAt(samples, Math.floor((i / segs) * WAVE_SEGMENTS))
      const t = Math.pow(rawT, 1.1)
      const wave = Math.sin(angle * 3 + time * (2 + r)) * 0.3 + 0.7
      const dist = t * wave * ringDist
      const finalR = ringR + dist
      pts.push([Math.cos(angle) * finalR, Math.sin(angle) * finalR])
    }

    const ringShift = (shift + r * 0.5) % 1

    // Wide soft stroke (glow)
    ctx.beginPath()
    smoothPath(ctx, pts, true)
    ctx.strokeStyle = resolveConicGrad(ctx, ringShift, 0.2 + beatV * 0.1, vc)
    ctx.lineWidth = size * (0.008 - r * 0.002) * (1 + beatV * 0.3)
    if (vc?.glowEnabled) applyGlow(ctx, ringShift, vc, beatV)
    ctx.stroke()
    if (vc?.glowEnabled) clearGlow(ctx)

    // Sharp core
    ctx.beginPath()
    smoothPath(ctx, pts, true)
    ctx.strokeStyle = resolveConicGrad(ctx, ringShift, 0.7 - r * 0.15, vc)
    ctx.lineWidth = size * (0.003 - r * 0.0005)
    ctx.stroke()
  }

  // ── Plasma cells: small glowing bubbles between the two rings ──
  if (ringRadii.length >= 2 && bassE > 0.2) {
    const innerR = ringRadii[0]!
    const outerR = ringRadii[1]!
    const midR = (innerR + outerR) / 2
    const cellCount = 12
    ctx.save()
    ctx.globalAlpha = 0.6

    for (let c = 0; c < cellCount; c++) {
      const baseAngle = (c / cellCount) * Math.PI * 2
      // Orbiting motion + spectrum-driven wobble
      const orbitAngle = baseAngle + time * 0.8 + Math.sin(time * 1.5 + c * 0.9) * 0.3
      const specVal = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, c * 5, 64)
        : 0.3
      const cellR = midR + (specVal - 0.3) * maxOff * 0.3
      const cx = Math.cos(orbitAngle) * cellR
      const cy = Math.sin(orbitAngle) * cellR
      const dotSize = size * (0.004 + specVal * 0.006) * (1 + beatV * 0.4)
      const cellShift = (shift + c / cellCount) % 1

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, dotSize * 2)
      grad.addColorStop(0, resolveColorRgba(cellShift, 0.5 + beatV * 0.3, vc))
      grad.addColorStop(0.6, resolveColorRgba(cellShift, 0.15, vc))
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, dotSize * 2, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  // Inner energy glow (cheap radial fill) — enhanced with beat
  if (bassE > 0.25) {
    const glowR = breathedBaseR + bassE * maxOff * 0.4 * (1 + beatV * 0.2)
    const grad = ctx.createRadialGradient(0, 0, breathedBaseR * 0.4, 0, 0, glowR)
    grad.addColorStop(0, resolveColorRgba(shift, (bassE * 0.12 + beatV * 0.06), vc))
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(0, 0, glowR, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

// ═══ Registration ═══
registerWave('plasma', drawWavePlasma, {
  id: 'plasma',
  label: 'Plasma',
  icon: '🌀',
  category: 'geometric',
})

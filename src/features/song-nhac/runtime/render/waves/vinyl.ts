/**
 * Wave Style: Vinyl (vinyl)
 * Icon: 💿
 * Category: artistic
 *
 * Spinning vinyl record — concentric grooves reactive to spectrum.
 * Groove depth varies with frequency, rotation speed follows BPM.
 * Label center, tonearm indicator, light reflection sweep.
 */

import { type FrequencyBands, type VisualizerColorOptions, getSpectrumAt, animTimeMs, resolveColorRgba, applyGlow, clearGlow } from './helpers'
import { registerWave } from './registry'

function drawWaveVinyl(
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
  const midE = bands?.mid ?? 0.3
  const trebleE = bands?.treble ?? 0.2
  const beatVal = beat ?? 0

  ctx.save()

  const maxR = size * 0.38
  const labelR = maxR * 0.28
  const holeR = maxR * 0.03
  // Spin angle — continuous rotation, speed influenced by beat
  const spinAngle = time * 0.5 * (0.8 + bassE * 0.4)

  ctx.rotate(spinAngle)

  // ── Vinyl disc body (dark) ──
  const discGrad = ctx.createRadialGradient(0, 0, labelR, 0, 0, maxR)
  discGrad.addColorStop(0, 'rgba(30,30,35,0.8)')
  discGrad.addColorStop(0.1, 'rgba(15,15,18,0.85)')
  discGrad.addColorStop(0.9, 'rgba(10,10,12,0.85)')
  discGrad.addColorStop(1, 'rgba(25,25,30,0.7)')
  ctx.fillStyle = discGrad
  ctx.beginPath()
  ctx.arc(0, 0, maxR, 0, Math.PI * 2)
  ctx.fill()

  // ── Groove rings ──
  const grooveCount = Math.max(16, Math.min(48, vc?.barCount ?? 32))
  const grooveStart = labelR + maxR * 0.05
  const grooveEnd = maxR * 0.95
  const grooveSpacing = (grooveEnd - grooveStart) / grooveCount

  for (let g = 0; g < grooveCount; g++) {
    const r = grooveStart + g * grooveSpacing
    const specIdx = Math.floor((g / grooveCount) * 64)
    const specVal = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, specIdx, 64) : 0.2

    // Groove wobble — audio-reactive radius variation
    const grooveAmplitude = specVal * size * 0.004 * amplitude
    const segs = 72
    const pts: [number, number][] = []

    for (let i = 0; i < segs; i++) {
      const angle = (i / segs) * Math.PI * 2
      const wobble = Math.sin(angle * 3 + time * 2 + g * 0.5) * grooveAmplitude
        + Math.sin(angle * 7 - time * 1.3 + g * 1.2) * grooveAmplitude * 0.3
      const gr = r + wobble
      pts.push([Math.cos(angle) * gr, Math.sin(angle) * gr])
    }

    // Groove color — subtle spectrum mapping
    const grooveAlpha = 0.08 + specVal * 0.15 + beatVal * 0.03
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i]![0], pts[i]![1])
      else ctx.lineTo(pts[i]![0], pts[i]![1])
    }
    ctx.closePath()
    ctx.strokeStyle = resolveColorRgba(shift + g / grooveCount * 0.3, grooveAlpha, vc)
    ctx.lineWidth = size * 0.0008
    ctx.stroke()
  }

  // ── Light reflection sweep (stationary in world — rotates opposite to disc) ──
  ctx.save()
  ctx.rotate(-spinAngle) // counter-rotate so it stays fixed
  const reflAngle = time * 0.1 // slow sweep
  const reflGrad = ctx.createLinearGradient(
    Math.cos(reflAngle) * maxR * -1, Math.sin(reflAngle) * maxR * -1,
    Math.cos(reflAngle) * maxR, Math.sin(reflAngle) * maxR
  )
  reflGrad.addColorStop(0, 'rgba(255,255,255,0)')
  reflGrad.addColorStop(0.45, 'rgba(255,255,255,0)')
  reflGrad.addColorStop(0.5, `rgba(255,255,255,${0.04 + beatVal * 0.02})`)
  reflGrad.addColorStop(0.55, 'rgba(255,255,255,0)')
  reflGrad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = reflGrad
  ctx.beginPath()
  ctx.arc(0, 0, maxR, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // ── Label center ──
  const labelGrad = ctx.createRadialGradient(0, 0, holeR, 0, 0, labelR)
  labelGrad.addColorStop(0, resolveColorRgba(shift + 0.3, 0.15, vc))
  labelGrad.addColorStop(0.3, resolveColorRgba(shift + 0.1, 0.3 + bassE * 0.1, vc))
  labelGrad.addColorStop(0.8, resolveColorRgba(shift, 0.25 + midE * 0.1, vc))
  labelGrad.addColorStop(1, resolveColorRgba(shift + 0.2, 0.1, vc))
  ctx.fillStyle = labelGrad
  ctx.beginPath()
  ctx.arc(0, 0, labelR, 0, Math.PI * 2)
  ctx.fill()

  // Label edge ring
  ctx.strokeStyle = resolveColorRgba(shift, 0.3, vc)
  ctx.lineWidth = size * 0.001
  ctx.beginPath()
  ctx.arc(0, 0, labelR, 0, Math.PI * 2)
  ctx.stroke()

  // Center hole
  ctx.fillStyle = 'rgba(5,5,8,0.9)'
  ctx.beginPath()
  ctx.arc(0, 0, holeR, 0, Math.PI * 2)
  ctx.fill()

  // Spindle ring
  ctx.strokeStyle = `rgba(180,180,190,${0.3 + beatVal * 0.1})`
  ctx.lineWidth = size * 0.0015
  ctx.beginPath()
  ctx.arc(0, 0, holeR, 0, Math.PI * 2)
  ctx.stroke()

  // ── Outer rim ──
  ctx.strokeStyle = resolveColorRgba(shift, 0.12, vc)
  ctx.lineWidth = size * 0.002
  ctx.beginPath()
  ctx.arc(0, 0, maxR, 0, Math.PI * 2)
  ctx.stroke()

  // ── Beat pulse — glow from grooves ──
  if (beatVal > 0.3 && vc?.glowEnabled) {
    ctx.save()
    const pulseR = labelR + (maxR - labelR) * bassE
    const pulseGrad = ctx.createRadialGradient(0, 0, labelR, 0, 0, pulseR)
    pulseGrad.addColorStop(0, resolveColorRgba(shift, (beatVal - 0.3) * 0.08, vc))
    pulseGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = pulseGrad
    ctx.beginPath()
    ctx.arc(0, 0, pulseR, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  ctx.restore()
}

// ═══ Registration ═══
registerWave('vinyl', drawWaveVinyl, {
  id: 'vinyl',
  label: 'Đĩa than',
  icon: '💿',
  category: 'artistic',
})

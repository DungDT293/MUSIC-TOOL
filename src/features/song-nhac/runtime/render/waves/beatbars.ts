/**
 * Wave Style: Beat Bar (beatbars)
 * Icon: 🥁
 * Category: tech
 *
 * V2: Thêm peak hold indicators, stereo-like separation,
 *     improved reflection with ripple, bass sub-section.
 */

import { type FrequencyBands, type VisualizerColorOptions, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba, applyGlow, clearGlow } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

// Persistent peak hold state
let peakHolds: { height: number; velocity: number }[] | null = null

function drawWaveBeatBars(
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
  const shift = (time * 0.05) % 1
  const bassE = bands?.bass ?? 0.3
  const beatVal = beat ?? 0

  const barCount = Math.max(16, Math.min(64, vc?.barCount ?? 32))
  const totalBarWidth = w * 0.94
  const gap = totalBarWidth * 0.008
  const barW = (totalBarWidth - (barCount - 1) * gap) / barCount
  const maxBarH = halfH * 0.65 * amplitude

  // Init peak holds
  if (!peakHolds || peakHolds.length !== barCount) {
    peakHolds = []
    for (let i = 0; i < barCount; i++) peakHolds.push({ height: 0, velocity: 0 })
  }

  ctx.save()

  const startX = -totalBarWidth / 2
  const bottomY = halfH * 0.95

  // Pre-compute bar heights
  const barData: { x: number; h: number; specVal: number; colorT: number }[] = []
  for (let i = 0; i < barCount; i++) {
    const specVal = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, i, barCount)
      : getSampleAt(samples, Math.floor((i / barCount) * WAVE_SEGMENTS))
    const t = Math.pow(specVal, 1.1)
    const barH = Math.max(size * 0.003, t * maxBarH * (1 + beatVal * 0.25))

    // Stereo-like effect: bars at edges get slight boost from bass, center from treble
    const centerDist = Math.abs(i - barCount / 2) / (barCount / 2)
    const stereoBoost = 1 + centerDist * bassE * 0.15

    barData.push({
      x: startX + i * (barW + gap),
      h: barH * stereoBoost,
      specVal,
      colorT: i / barCount,
    })

    // Update peak hold — gravity fall
    const peak = peakHolds[i]!
    if (barH > peak.height) {
      peak.height = barH
      peak.velocity = 0
    } else {
      peak.velocity += 0.15 // gravity
      peak.height -= peak.velocity
      if (peak.height < 0) peak.height = 0
    }
  }

  // Pass 1: Glow backdrop
  for (const bar of barData) {
    if (bar.specVal < 0.05) continue
    const bx = bar.x - barW * 0.25
    const bw = barW * 1.5
    const bh = bar.h * 1.15
    const glowAlpha = 0.08 + bar.specVal * 0.12
    ctx.fillStyle = resolveColorRgba(shift + bar.colorT, glowAlpha, vc)
    if (vc?.glowEnabled) applyGlow(ctx, shift + bar.colorT, vc, beatVal)
    ctx.beginPath()
    ctx.roundRect(bx, bottomY, bw, -bh, size * 0.003)
    ctx.fill()
    if (vc?.glowEnabled) clearGlow(ctx)
  }

  // Pass 2: Main bars
  for (const bar of barData) {
    if (bar.specVal < 0.02) continue
    const barGrad = ctx.createLinearGradient(0, bottomY, 0, bottomY - bar.h)
    barGrad.addColorStop(0, resolveColorRgba(shift + bar.colorT, 0.85 + beatVal * 0.15, vc))
    barGrad.addColorStop(0.5, resolveColorRgba(shift + bar.colorT + 0.08, 0.6, vc))
    barGrad.addColorStop(1, resolveColorRgba(shift + bar.colorT + 0.15, 0.12, vc))
    ctx.fillStyle = barGrad
    ctx.beginPath()
    const radius = Math.min(barW * 0.35, size * 0.004)
    ctx.roundRect(bar.x, bottomY, barW, -bar.h, [radius, radius, 0, 0])
    ctx.fill()
  }

  // Pass 3: Peak hold indicators (bright cap that falls with gravity)
  for (let i = 0; i < barCount; i++) {
    const bar = barData[i]!
    const peak = peakHolds[i]!
    if (peak.height < size * 0.005) continue
    const capH = size * 0.003
    const capY = bottomY - peak.height
    ctx.fillStyle = resolveColorRgba(shift + bar.colorT, 0.9, vc)
    ctx.fillRect(bar.x, capY, barW, -capH)
  }

  // Pass 4: Reflection with ripple
  ctx.globalAlpha = 0.12
  for (let i = 0; i < barData.length; i++) {
    const bar = barData[i]!
    if (bar.specVal < 0.05) continue
    const reflH = bar.h * 0.25
    // Ripple distortion on reflection
    const ripple = Math.sin(time * 3 + i * 0.4) * size * 0.001
    const reflGrad = ctx.createLinearGradient(0, bottomY + ripple, 0, bottomY + reflH + ripple)
    reflGrad.addColorStop(0, resolveColorRgba(shift + bar.colorT, 0.2, vc))
    reflGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = reflGrad
    ctx.beginPath()
    const radius = Math.min(barW * 0.35, size * 0.004)
    ctx.roundRect(bar.x, bottomY + ripple, barW, reflH, [0, 0, radius, radius])
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // Beat sweep
  if (beatVal > 0.4) {
    const sweepX = ((time * 0.7) % 1) * totalBarWidth + startX
    const sweepW = totalBarWidth * 0.12
    const sweepGrad = ctx.createLinearGradient(sweepX - sweepW / 2, 0, sweepX + sweepW / 2, 0)
    sweepGrad.addColorStop(0, 'rgba(255,255,255,0)')
    sweepGrad.addColorStop(0.5, `rgba(255,255,255,${(beatVal - 0.4) * 0.12})`)
    sweepGrad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = sweepGrad
    ctx.fillRect(startX, bottomY - maxBarH, totalBarWidth, maxBarH)
  }

  ctx.restore()
}

// ═══ Registration ═══
registerWave('beatbars', drawWaveBeatBars, {
  id: 'beatbars',
  label: 'Beat Bar',
  icon: '🥁',
  category: 'tech',
})
registerWaveCleanup(() => { peakHolds = null })

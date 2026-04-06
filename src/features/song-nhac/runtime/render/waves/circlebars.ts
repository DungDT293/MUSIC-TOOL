/**
 * Wave Style: Tia tron (circlebars)
 * Icon: ◎
 * Category: basic
 *
 * V2: Inner mirror bars, base ring glow on beat, per-bar gradient tips.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveConicGrad, resolveColorRgba, applyGlow, clearGlow, speedShift } from './helpers'
import { registerWave } from './registry'

function drawWaveCircleBars(
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
  const radius = Math.sqrt(w * w + h * h) / 2 + size * 0.005
  const maxBarLen = getMaxOffset(w, h) * amplitude * 1.3
  const barCount = Math.max(16, Math.min(256, vc?.barCount ?? 128))
  const angleStep = (Math.PI * 2) / barCount
  const barW = Math.max(size * 0.003, radius * angleStep * 0.35)
  const shift = speedShift((animTimeMs() * 0.00012) % 1, vc?.speed)
  const spin = speedShift((animTimeMs() * 0.0002) % (Math.PI * 2), vc?.speed)
  const bt = beat ?? 0

  ctx.save()
  ctx.lineCap = 'round'
  ctx.rotate(spin)

  const barData: { amp: number; len: number; cos: number; sin: number; colorT: number }[] = []
  for (let i = 0; i < barCount; i++) {
    const angle = i * angleStep - Math.PI / 2
    const mi = i < barCount / 2 ? i : barCount - 1 - i
    const raw = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, mi, barCount / 2)
      : getSampleAt(samples, Math.floor((mi / (barCount / 2)) * WAVE_SEGMENTS))
    const amp = Math.pow(raw, 1.3)
    barData.push({
      amp,
      len: Math.max(size * 0.004, amp * maxBarLen),
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      colorT: (i / barCount + shift) % 1,
    })
  }

  // Base ring glow — pulses on beat
  if (bt > 0.2) {
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.strokeStyle = resolveColorRgba(shift, 0.08 + bt * 0.15, vc)
    ctx.lineWidth = size * 0.008 * (1 + bt * 0.5)
    ctx.stroke()
  }

  // Pass 1: Soft glow (outer bars)
  ctx.lineWidth = barW * 2
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 0.22, vc)
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, bt)
  ctx.beginPath()
  for (const { amp, len, cos, sin } of barData) {
    if (amp < 0.03) continue
    ctx.moveTo(cos * radius, sin * radius)
    ctx.lineTo(cos * (radius + len), sin * (radius + len))
  }
  ctx.stroke()
  if (vc?.glowEnabled) clearGlow(ctx)

  // Pass 2: Sharp outer bars
  ctx.lineWidth = barW
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 0.92, vc)
  ctx.beginPath()
  for (const { amp, len, cos, sin } of barData) {
    if (amp < 0.02) continue
    ctx.moveTo(cos * radius, sin * radius)
    ctx.lineTo(cos * (radius + len), sin * (radius + len))
  }
  ctx.stroke()

  // Pass 3: Inner mirror bars (shorter, more transparent) — pro spectrum look
  const innerScale = 0.35
  ctx.lineWidth = barW * 0.8
  ctx.strokeStyle = resolveConicGrad(ctx, (shift + 0.5) % 1, 0.45, vc)
  ctx.beginPath()
  for (const { amp, len, cos, sin } of barData) {
    if (amp < 0.05) continue
    const innerLen = len * innerScale
    ctx.moveTo(cos * radius, sin * radius)
    ctx.lineTo(cos * (radius - innerLen), sin * (radius - innerLen))
  }
  ctx.stroke()

  // Pass 4: Tip glow dots for high-amplitude bars
  for (const { amp, len, cos, sin, colorT } of barData) {
    if (amp < 0.5) continue
    const tipX = cos * (radius + len)
    const tipY = sin * (radius + len)
    const tipR = barW * (0.5 + amp * 0.7)
    ctx.beginPath()
    ctx.arc(tipX, tipY, tipR, 0, Math.PI * 2)
    ctx.fillStyle = resolveColorRgba(colorT, 0.5 + amp * 0.5, vc)
    ctx.fill()
  }

  ctx.restore()
}

// === Registration ===
registerWave('circlebars', drawWaveCircleBars, {
  id: 'circlebars',
  label: 'Tia tron',
  icon: '◎',
  category: 'basic',
})

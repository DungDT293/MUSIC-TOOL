/**
 * Wave Style: Nhịp tim (heartbeat)
 * Icon: 💓
 * Category: tech
 *
 * V2: Multi-lead ECG (3 parallel traces), heart pulse animation at cursor,
 *     improved grid (major/minor), BPM indicator dot pattern.
 */

import { type FrequencyBands, type VisualizerColorOptions, getSampleAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

function drawWaveHeartbeat(
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
  const halfW = w / 2
  const spd = vc?.speed ?? 1
  const time = animTimeMs() * 0.001 * spd
  const shift = (time * 0.04) % 1
  const bassE = bands?.bass ?? 0.3
  const beatVal = beat ?? 0

  ctx.save()

  const lineLen = w * 0.9
  const startX = -lineLen / 2
  const segs = 120

  // ── Grid — major/minor like ECG paper ──
  const gridSpacing = lineLen / 20

  // Minor grid (thin) — BATCHED into single path
  ctx.strokeStyle = resolveColorRgba(shift + 0.3, 0.02, vc)
  ctx.lineWidth = size * 0.0002
  const minorDiv = 5
  const minorSpacing = gridSpacing / minorDiv
  ctx.beginPath()
  for (let i = 0; i <= 20 * minorDiv; i++) {
    const gx = startX + i * minorSpacing
    ctx.moveTo(gx, -size * 0.2); ctx.lineTo(gx, size * 0.2)
  }
  for (let j = -15; j <= 15; j++) {
    const gy = j * minorSpacing
    ctx.moveTo(startX, gy); ctx.lineTo(startX + lineLen, gy)
  }
  ctx.stroke()

  // Major grid (thicker) — BATCHED
  ctx.strokeStyle = resolveColorRgba(shift + 0.3, 0.04, vc)
  ctx.lineWidth = size * 0.0004
  ctx.beginPath()
  for (let i = 0; i <= 20; i++) {
    const gx = startX + i * gridSpacing
    ctx.moveTo(gx, -size * 0.2); ctx.lineTo(gx, size * 0.2)
  }
  for (let j = -3; j <= 3; j++) {
    const gy = j * gridSpacing
    ctx.moveTo(startX, gy); ctx.lineTo(startX + lineLen, gy)
  }
  ctx.stroke()

  // Center axes
  ctx.strokeStyle = resolveColorRgba(shift, 0.08, vc)
  ctx.lineWidth = size * 0.0006
  ctx.beginPath(); ctx.moveTo(startX, 0); ctx.lineTo(startX + lineLen, 0); ctx.stroke()

  // ── Multi-lead ECG traces ──
  const leads = [
    { yOffset: 0, ampScale: 1.0, alpha: 1.0, label: 'II' },     // Main lead
    { yOffset: -size * 0.12, ampScale: 0.6, alpha: 0.4, label: 'I' },   // Upper
    { yOffset: size * 0.12, ampScale: 0.5, alpha: 0.35, label: 'III' },  // Lower
  ]

  const cursorPos = ((time * 0.35) % 1)
  const maxSpike = size * 0.25 * amplitude

  for (const lead of leads) {
    const pts: [number, number][] = []
    for (let i = 0; i < segs; i++) {
      const t = i / (segs - 1)
      const x = startX + t * lineLen
      const dist = Math.abs(t - cursorPos)
      const nearCursor = dist < 0.05

      const sampleVal = getSampleAt(samples, Math.floor(t * WAVE_SEGMENTS))
      let y = lead.yOffset + (sampleVal - 0.5) * size * 0.01

      // ECG spike at cursor
      if (nearCursor) {
        const phase = (t - cursorPos + 0.05) / 0.1
        const spikeAmp = maxSpike * lead.ampScale
        if (phase > 0.3 && phase < 0.35) y -= spikeAmp * 0.15 * beatVal
        else if (phase > 0.38 && phase < 0.42) y -= spikeAmp * 0.3 * (0.3 + beatVal * 0.7)
        else if (phase > 0.42 && phase < 0.5) y -= spikeAmp * (0.5 + beatVal * 0.5)
        else if (phase > 0.5 && phase < 0.55) y += spikeAmp * 0.2 * beatVal
        else if (phase > 0.6 && phase < 0.7) y -= spikeAmp * 0.1 * beatVal
      }

      pts.push([x, y])
    }

    // Trail fade drawing — BATCHED by alpha groups (8 groups instead of ~119 individual strokes)
    const isMainLead = lead === leads[0]
    const alphaGroups = 8
    for (let g = 0; g < alphaGroups; g++) {
      const gMin = g / alphaGroups
      const gMax = (g + 1) / alphaGroups
      // Representative alpha for this group
      const groupAlpha = (gMin + gMax) / 2

      ctx.beginPath()
      let hasSegments = false
      for (let i = 1; i < pts.length; i++) {
        const t = i / (segs - 1)
        let behind = cursorPos - t
        if (behind < 0) behind += 1
        const trailAlpha = behind < 0.02 ? 0.1 : Math.max(0.05, 0.8 - behind * 1.2)

        // Assign to alpha group
        const normalized = Math.min(1, trailAlpha)
        if (normalized >= gMin && normalized < gMax) {
          ctx.moveTo(pts[i - 1]![0], pts[i - 1]![1])
          ctx.lineTo(pts[i]![0], pts[i]![1])
          hasSegments = true
        }
      }
      if (hasSegments) {
        ctx.strokeStyle = resolveColorRgba(shift, groupAlpha * lead.alpha * (0.6 + bassE * 0.4), vc)
        ctx.lineWidth = size * 0.002 * (0.6 + groupAlpha * 0.4) * (isMainLead ? 1 : 0.6)
        ctx.stroke()
      }
    }
  }

  // ── Heart pulse at cursor position ──
  const cx = startX + cursorPos * lineLen

  // Pulsing heart shape (simplified using arcs)
  if (beatVal > 0.1) {
    const heartSize = size * 0.015 * (0.5 + beatVal * 0.8)
    const heartY = -size * 0.04

    ctx.save()
    ctx.translate(cx, heartY)
    const heartScale = 1 + Math.sin(time * 6) * 0.1 * beatVal

    ctx.scale(heartScale, heartScale)
    ctx.beginPath()
    ctx.moveTo(0, heartSize * 0.3)
    ctx.bezierCurveTo(-heartSize, -heartSize * 0.3, -heartSize * 0.5, -heartSize, 0, -heartSize * 0.5)
    ctx.bezierCurveTo(heartSize * 0.5, -heartSize, heartSize, -heartSize * 0.3, 0, heartSize * 0.3)
    ctx.fillStyle = resolveColorRgba(shift, 0.15 + beatVal * 0.2, vc)
    ctx.fill()
    ctx.restore()
  }

  // Cursor glow
  const cursorGrad = ctx.createRadialGradient(cx, 0, 0, cx, 0, size * 0.03)
  cursorGrad.addColorStop(0, resolveColorRgba(shift, 0.5 + beatVal * 0.3, vc))
  cursorGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = cursorGrad
  ctx.beginPath()
  ctx.arc(cx, 0, size * 0.03, 0, Math.PI * 2)
  ctx.fill()

  // Core dot
  ctx.fillStyle = resolveColorRgba(shift, 0.9, vc)
  ctx.beginPath()
  ctx.arc(cx, 0, size * 0.003, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

// ═══ Registration ═══
registerWave('heartbeat', drawWaveHeartbeat, {
  id: 'heartbeat',
  label: 'Nhịp tim',
  icon: '💓',
  category: 'tech',
})

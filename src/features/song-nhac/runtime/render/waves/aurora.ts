/**
 * Wave Style: Cực quang (aurora)
 * Icon: 🌈
 * Category: nature
 *
 * V2: Vertical light rays behind ribbons, star field background,
 *     sub-ribbons on treble, ground reflection, improved shimmer.
 */

import { type FrequencyBands, type VisualizerColorOptions, getSpectrumAt, animTimeMs, resolveColorRgba, applyGlow, clearGlow } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

function drawWaveAurora(
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
  const shift = (time * 0.015) % 1
  const bassE = bands?.bass ?? 0.3
  const midE = bands?.mid ?? 0.3
  const trebleE = bands?.treble ?? 0.2
  const beatVal = beat ?? 0

  ctx.save()

  // ── Star field background ──
  const starCount = 20
  for (let i = 0; i < starCount; i++) {
    // Deterministic positions from index (no Math.random in render loop)
    const sx = Math.sin(i * 7.3 + 0.5) * halfW * 0.85
    const sy = -halfH * 0.6 + Math.sin(i * 3.7 + 1.2) * halfH * 0.5
    const twinkle = Math.sin(time * (1.5 + i * 0.3) + i * 2.1) * 0.5 + 0.5
    const starAlpha = 0.05 + twinkle * 0.08 + beatVal * 0.02
    const starR = size * 0.001 * (0.5 + twinkle * 0.5)
    ctx.fillStyle = `rgba(255,255,255,${starAlpha})`
    ctx.beginPath()
    ctx.arc(sx, sy, starR, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── Vertical light rays (behind ribbons) ──
  const rayCount = 8
  for (let i = 0; i < rayCount; i++) {
    const rx = -halfW * 0.7 + (i / (rayCount - 1)) * halfW * 1.4
    const specVal = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, Math.floor((i / rayCount) * 32), 64) : 0.2
    const rayAlpha = 0.02 + specVal * 0.04 + beatVal * 0.01
    const rayWidth = size * 0.03 * (0.5 + specVal * 0.5)
    const rayGrad = ctx.createLinearGradient(rx, -halfH * 0.8, rx, halfH * 0.4)
    rayGrad.addColorStop(0, 'rgba(0,0,0,0)')
    rayGrad.addColorStop(0.2, resolveColorRgba(shift + i * 0.12, rayAlpha, vc))
    rayGrad.addColorStop(0.6, resolveColorRgba(shift + i * 0.12 + 0.1, rayAlpha * 0.6, vc))
    rayGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = rayGrad
    ctx.fillRect(rx - rayWidth / 2, -halfH * 0.8, rayWidth, halfH * 1.2)
  }

  // ── Main ribbons ──
  const ribbonCount = 5
  const segs = 48

  for (let r = 0; r < ribbonCount; r++) {
    const ribbonPhase = r * 1.3 + time * 0.4
    const ribbonY = -halfH * 0.3 + r * halfH * 0.15
    const ribbonAmplitude = size * 0.06 * amplitude * (0.5 + (r % 2 === 0 ? bassE : midE) * 0.5)
    const ribbonWidth = size * 0.04 * (0.3 + midE * 0.3 + beatVal * 0.2) * (1 - r * 0.1)

    const topPts: [number, number][] = []
    const botPts: [number, number][] = []
    for (let i = 0; i < segs; i++) {
      const t = i / (segs - 1)
      const x = -halfW * 0.9 + t * halfW * 1.8
      const specVal = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, Math.floor(t * 48), 64) : 0.3

      const wave = Math.sin(t * 4 + ribbonPhase) * ribbonAmplitude * 0.7
        + Math.sin(t * 7 - ribbonPhase * 0.6) * ribbonAmplitude * 0.3
        + specVal * ribbonAmplitude * 0.5
      const y = ribbonY + wave
      topPts.push([x, y - ribbonWidth / 2])
      botPts.push([x, y + ribbonWidth / 2])
    }

    // Filled ribbon
    ctx.beginPath()
    for (let i = 0; i < segs; i++) {
      const [x, y] = topPts[i]!
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    for (let i = segs - 1; i >= 0; i--) {
      const [x, y] = botPts[i]!
      ctx.lineTo(x, y)
    }
    ctx.closePath()

    const ribbonGrad = ctx.createLinearGradient(-halfW * 0.9, 0, halfW * 0.9, 0)
    const ribbonAlpha = 0.08 + midE * 0.08 + beatVal * 0.05
    ribbonGrad.addColorStop(0, resolveColorRgba(shift + r * 0.15, ribbonAlpha * 0.2, vc))
    ribbonGrad.addColorStop(0.3, resolveColorRgba(shift + r * 0.15 + 0.1, ribbonAlpha, vc))
    ribbonGrad.addColorStop(0.7, resolveColorRgba(shift + r * 0.15 + 0.2, ribbonAlpha * 1.2, vc))
    ribbonGrad.addColorStop(1, resolveColorRgba(shift + r * 0.15 + 0.3, ribbonAlpha * 0.3, vc))
    ctx.fillStyle = ribbonGrad
    ctx.fill()

    // Edge highlight
    ctx.beginPath()
    for (let i = 0; i < segs; i++) {
      const [x, y] = topPts[i]!
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = resolveColorRgba(shift + r * 0.15, 0.15 + trebleE * 0.15, vc)
    ctx.lineWidth = size * 0.001
    if (vc?.glowEnabled) applyGlow(ctx, shift + r * 0.15, vc, beatVal)
    ctx.stroke()
    if (vc?.glowEnabled) clearGlow(ctx)

    // Sub-ribbons on high treble — thin wisps that split off
    if (trebleE > 0.4 && r < 3) {
      const subY = ribbonY - ribbonWidth * 0.8
      ctx.beginPath()
      for (let i = 0; i < segs; i++) {
        const t = i / (segs - 1)
        const x = -halfW * 0.9 + t * halfW * 1.8
        const subWave = Math.sin(t * 9 + ribbonPhase * 1.5) * ribbonAmplitude * 0.2
        const y = subY + subWave
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = resolveColorRgba(shift + r * 0.15 + 0.3, (trebleE - 0.4) * 0.12, vc)
      ctx.lineWidth = size * 0.0005
      ctx.stroke()
    }
  }

  // ── Ground reflection ──
  ctx.globalAlpha = 0.06
  ctx.save()
  ctx.scale(1, -0.3)
  ctx.translate(0, -halfH * 2.5)
  for (let r = 0; r < 3; r++) {
    const ribbonPhase = r * 1.3 + time * 0.4
    const ribbonY = -halfH * 0.3 + r * halfH * 0.15
    const ribbonAmplitude = size * 0.04 * amplitude * 0.5
    ctx.beginPath()
    for (let i = 0; i < segs; i++) {
      const t = i / (segs - 1)
      const x = -halfW * 0.9 + t * halfW * 1.8
      const wave = Math.sin(t * 4 + ribbonPhase) * ribbonAmplitude
      const y = ribbonY + wave
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = resolveColorRgba(shift + r * 0.15, 0.3, vc)
    ctx.lineWidth = size * 0.003
    ctx.stroke()
  }
  ctx.restore()
  ctx.globalAlpha = 1

  // ── Shimmer sparkles ──
  if (beatVal > 0.2) {
    const sparkleCount = Math.floor(beatVal * 12)
    for (let i = 0; i < sparkleCount; i++) {
      const sx = (Math.sin(time * 3 + i * 2.7) * 0.4) * w
      const sy = (-halfH * 0.3 + Math.sin(time * 1.5 + i * 1.9) * halfH * 0.25)
      const sr = size * 0.002 * (0.5 + beatVal * 0.5)
      ctx.fillStyle = `rgba(255,255,255,${0.3 + beatVal * 0.3})`
      ctx.beginPath()
      ctx.arc(sx, sy, sr, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.restore()
}

// ═══ Registration ═══
registerWave('aurora', drawWaveAurora, {
  id: 'aurora',
  label: 'Cực quang',
  icon: '🌈',
  category: 'nature',
})

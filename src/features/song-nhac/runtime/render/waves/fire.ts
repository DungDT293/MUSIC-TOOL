/**
 * Wave Style: Lửa (fire)
 * Icon: 🔥
 * Category: nature
 *
 * V2: Fixed unused beat parameter (was _beat), beat intensifies flames,
 *     ember particles rising from flame tips, flame tip shifts white on high energy,
 *     heat haze glow at base. Fixed icon 🔥.
 */

import { type FrequencyBands, type VisualizerColorOptions, getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

function drawWaveFire(
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
  const maxOff = getMaxOffset(w, h) * amplitude * 1.4
  const spd = vc?.speed ?? 1
  const time = animTimeMs() * 0.003 * spd
  const beatV = beat ?? 0

  ctx.save()

  // Collect ember positions for drawing after flames
  const embers: { x: number; y: number; vx: number; vy: number; t: number }[] = []

  const flamesPerEdge = 12
  for (let edge = 0; edge < 4; edge++) {
    const isHoriz = edge === 0 || edge === 2
    const edgeLen = isHoriz ? w : h
    const flameW = edgeLen / flamesPerEdge

    for (let j = 0; j < flamesPerEdge; j++) {
      const gIdx = edge * flamesPerEdge + j
      const rawT = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, gIdx, flamesPerEdge * 4)
        : getSampleAt(samples, Math.floor(gIdx * WAVE_SEGMENTS / (flamesPerEdge * 4)))
      const t = Math.pow(rawT, 1.15)
      if (t < 0.06) continue

      // ── Beat intensifies flame flicker and height ──
      const beatBoost = 1 + beatV * 0.3
      const flicker = 0.75 + 0.25 * Math.sin(time * 5 + gIdx * 1.7)
      const fH = t * maxOff * flicker * beatBoost
      const pos = (j + 0.5) / flamesPerEdge * edgeLen
      const hw = flameW * 0.5

      ctx.beginPath()
      let g: CanvasGradient
      let tipX: number, tipY: number
      if (edge === 0) {
        const bx = -halfW + pos
        ctx.moveTo(bx - hw, -halfH)
        ctx.quadraticCurveTo(bx - hw * 0.3, -halfH - fH * 0.7, bx, -halfH - fH)
        ctx.quadraticCurveTo(bx + hw * 0.3, -halfH - fH * 0.7, bx + hw, -halfH)
        ctx.closePath()
        g = ctx.createLinearGradient(bx, -halfH, bx, -halfH - fH)
        tipX = bx; tipY = -halfH - fH
      } else if (edge === 1) {
        const by = -halfH + pos
        ctx.moveTo(halfW, by - hw)
        ctx.quadraticCurveTo(halfW + fH * 0.7, by - hw * 0.3, halfW + fH, by)
        ctx.quadraticCurveTo(halfW + fH * 0.7, by + hw * 0.3, halfW, by + hw)
        ctx.closePath()
        g = ctx.createLinearGradient(halfW, by, halfW + fH, by)
        tipX = halfW + fH; tipY = by
      } else if (edge === 2) {
        const bx = -halfW + pos
        ctx.moveTo(bx - hw, halfH)
        ctx.quadraticCurveTo(bx - hw * 0.3, halfH + fH * 0.7, bx, halfH + fH)
        ctx.quadraticCurveTo(bx + hw * 0.3, halfH + fH * 0.7, bx + hw, halfH)
        ctx.closePath()
        g = ctx.createLinearGradient(bx, halfH, bx, halfH + fH)
        tipX = bx; tipY = halfH + fH
      } else {
        const by = halfH - pos
        ctx.moveTo(-halfW, by - hw)
        ctx.quadraticCurveTo(-halfW - fH * 0.7, by - hw * 0.3, -halfW - fH, by)
        ctx.quadraticCurveTo(-halfW - fH * 0.7, by + hw * 0.3, -halfW, by + hw)
        ctx.closePath()
        g = ctx.createLinearGradient(-halfW, by, -halfW - fH, by)
        tipX = -halfW - fH; tipY = by
      }

      // ── Flame tip color: shifts white-yellow on high energy ──
      const tipWhite = Math.min(1, t * 1.5)
      const baseR = 255, baseG = Math.floor(230 + 25 * tipWhite), baseB = Math.floor(120 + 135 * tipWhite)
      g.addColorStop(0, `rgba(${baseR}, ${baseG}, ${baseB}, ${0.85 * t * beatBoost})`)
      g.addColorStop(0.4, `rgba(255, 120, 30, ${0.55 * t})`)
      g.addColorStop(1, 'rgba(160, 30, 10, 0)')
      ctx.fillStyle = g
      ctx.fill()

      // ── Heat haze: subtle glow at flame base ──
      if (t > 0.3) {
        let hx: number, hy: number
        if (edge === 0) { hx = -halfW + pos; hy = -halfH }
        else if (edge === 1) { hx = halfW; hy = -halfH + pos }
        else if (edge === 2) { hx = -halfW + pos; hy = halfH }
        else { hx = -halfW; hy = halfH - pos }
        const hazeR = size * 0.015 * t
        const hazeGrad = ctx.createRadialGradient(hx, hy, 0, hx, hy, hazeR)
        hazeGrad.addColorStop(0, `rgba(255, 180, 60, ${0.15 * t})`)
        hazeGrad.addColorStop(1, 'rgba(255, 100, 20, 0)')
        ctx.fillStyle = hazeGrad
        ctx.beginPath()
        ctx.arc(hx, hy, hazeR, 0, Math.PI * 2)
        ctx.fill()
      }

      // ── Collect ember positions for strong flames ──
      if (t > 0.4) {
        const nx = edge === 1 ? 1 : edge === 3 ? -1 : 0
        const ny = edge === 0 ? -1 : edge === 2 ? 1 : 0
        embers.push({ x: tipX, y: tipY, vx: nx, vy: ny, t })
      }
    }
  }

  // ── Ember particles: small rising sparks from flame tips ──
  if (embers.length > 0) {
    ctx.save()
    ctx.globalAlpha = 0.8
    for (const em of embers) {
      const emberCount = em.t > 0.7 ? 3 : 2
      for (let e = 0; e < emberCount; e++) {
        // Deterministic position based on time
        const seed = em.x * 13.7 + em.y * 7.3 + e * 31.1
        const phase = ((time * 2 + seed) % 3) / 3 // 0–1 lifecycle
        const drift = Math.sin(seed * 47.1) * size * 0.01
        const ex = em.x + em.vx * size * 0.03 * phase + drift
        const ey = em.y + em.vy * size * 0.03 * phase
        const emberAlpha = (1 - phase) * 0.7 * em.t
        const emberSize = size * 0.002 * (1 - phase * 0.5)

        ctx.fillStyle = `rgba(255, ${180 + Math.floor(75 * (1 - phase))}, ${50 + Math.floor(70 * phase)}, ${emberAlpha})`
        ctx.beginPath()
        ctx.arc(ex, ey, emberSize, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  ctx.restore()
}

// ═══ Registration ═══
registerWave('fire', drawWaveFire, {
  id: 'fire',
  label: 'Lửa',
  icon: '🔥',
  category: 'nature',
})

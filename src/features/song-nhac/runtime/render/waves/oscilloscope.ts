/**
 * Wave Style: Oscilloscope (oscilloscope)
 * Icon: 📟
 * Category: tech
 *
 * Classic oscilloscope display — Lissajous pattern (X-Y mode).
 * Waveform samples drive X/Y coordinates creating flowing shapes.
 * Phosphor green color, slow fade trail, grid, beam focus dot.
 */

import { type FrequencyBands, type VisualizerColorOptions, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

// Persistent trail buffer for phosphor fade effect
interface TrailPoint { x: number; y: number; age: number }
let trailBuffer: TrailPoint[] | null = null
const MAX_TRAIL = 300

function drawWaveOscilloscope(
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
  const beatVal = beat ?? 0

  // Init trail buffer
  if (!trailBuffer) trailBuffer = []

  ctx.save()

  const scopeW = w * 0.85
  const scopeH = h * 0.75
  const scopeHalfW = scopeW / 2
  const scopeHalfH = scopeH / 2

  // ── Grid ──
  ctx.strokeStyle = resolveColorRgba(shift, 0.06, vc)
  ctx.lineWidth = size * 0.0005
  const gridDivs = 10
  for (let i = 0; i <= gridDivs; i++) {
    const gx = -scopeHalfW + (i / gridDivs) * scopeW
    const gy = -scopeHalfH + (i / gridDivs) * scopeH
    ctx.beginPath(); ctx.moveTo(gx, -scopeHalfH); ctx.lineTo(gx, scopeHalfH); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(-scopeHalfW, gy); ctx.lineTo(scopeHalfW, gy); ctx.stroke()
  }

  // Major axes (brighter)
  ctx.strokeStyle = resolveColorRgba(shift, 0.12, vc)
  ctx.lineWidth = size * 0.001
  ctx.beginPath(); ctx.moveTo(-scopeHalfW, 0); ctx.lineTo(scopeHalfW, 0); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, -scopeHalfH); ctx.lineTo(0, scopeHalfH); ctx.stroke()

  // ── Lissajous curve ──
  // X = waveform sample channel, Y = time-delayed waveform (creates Lissajous)
  const pointCount = Math.min(samples.length, 64)
  const currentPoints: [number, number][] = []

  for (let i = 0; i < pointCount; i++) {
    const t = i / (pointCount - 1)
    // X: direct waveform
    const sampleX = getSampleAt(samples, Math.floor(t * WAVE_SEGMENTS))
    // Y: phase-shifted waveform (creates the Lissajous shape)
    const phaseShift = Math.floor(pointCount * 0.25) // 90 degree phase shift
    const sampleY = getSampleAt(samples, Math.floor(((t * WAVE_SEGMENTS + phaseShift) % WAVE_SEGMENTS)))

    // Spectrum modulation for shape complexity
    const specMod = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, Math.floor(t * 32), 64) : 0.3

    const x = (sampleX - 0.5) * scopeW * amplitude * (0.8 + specMod * 0.4)
    const y = (sampleY - 0.5) * scopeH * amplitude * (0.8 + bassE * 0.3)

    currentPoints.push([x, y])

    // Add to trail
    trailBuffer.push({ x, y, age: 0 })
  }

  // Age trail points
  for (let i = 0; i < trailBuffer.length; i++) {
    trailBuffer[i]!.age += 0.02 * spd
  }
  // Cull expired + cap length (O(n) instead of O(n²) splice)
  trailBuffer = trailBuffer.filter(p => p.age <= 1)
  if (trailBuffer.length > MAX_TRAIL) {
    trailBuffer = trailBuffer.slice(-MAX_TRAIL)
  }

  // ── Draw trail (phosphor fade) ──
  for (const pt of trailBuffer) {
    const fadeAlpha = Math.max(0, (1 - pt.age) * 0.15)
    if (fadeAlpha < 0.01) continue
    ctx.fillStyle = resolveColorRgba(shift, fadeAlpha, vc)
    ctx.fillRect(pt.x - size * 0.001, pt.y - size * 0.001, size * 0.002, size * 0.002)
  }

  // ── Draw current waveform (bright) ──
  if (currentPoints.length > 1) {
    // Glow pass
    ctx.beginPath()
    ctx.moveTo(currentPoints[0]![0], currentPoints[0]![1])
    for (let i = 1; i < currentPoints.length; i++) {
      ctx.lineTo(currentPoints[i]![0], currentPoints[i]![1])
    }
    ctx.strokeStyle = resolveColorRgba(shift, 0.25 + beatVal * 0.15, vc)
    ctx.lineWidth = size * 0.006
    ctx.stroke()

    // Core pass
    ctx.beginPath()
    ctx.moveTo(currentPoints[0]![0], currentPoints[0]![1])
    for (let i = 1; i < currentPoints.length; i++) {
      ctx.lineTo(currentPoints[i]![0], currentPoints[i]![1])
    }
    ctx.strokeStyle = resolveColorRgba(shift, 0.7 + beatVal * 0.2, vc)
    ctx.lineWidth = size * 0.0015
    ctx.stroke()
  }

  // ── Beam focus dot at end of trace ──
  if (currentPoints.length > 0) {
    const lastPt = currentPoints[currentPoints.length - 1]!
    const dotR = size * 0.004 * (0.8 + beatVal * 0.4)
    const dotGrad = ctx.createRadialGradient(lastPt[0], lastPt[1], 0, lastPt[0], lastPt[1], dotR * 3)
    dotGrad.addColorStop(0, resolveColorRgba(shift, 0.6, vc))
    dotGrad.addColorStop(0.3, resolveColorRgba(shift, 0.2, vc))
    dotGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = dotGrad
    ctx.beginPath()
    ctx.arc(lastPt[0], lastPt[1], dotR * 3, 0, Math.PI * 2)
    ctx.fill()

    // White hot center
    ctx.fillStyle = `rgba(255,255,255,${0.7 + beatVal * 0.3})`
    ctx.beginPath()
    ctx.arc(lastPt[0], lastPt[1], dotR * 0.5, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── Scope border ──
  ctx.strokeStyle = resolveColorRgba(shift, 0.15 + beatVal * 0.05, vc)
  ctx.lineWidth = size * 0.001
  ctx.strokeRect(-scopeHalfW, -scopeHalfH, scopeW, scopeH)

  ctx.restore()
}

// ═══ Registration ═══
registerWave('oscilloscope', drawWaveOscilloscope, {
  id: 'oscilloscope',
  label: 'Dao động ký',
  icon: '📟',
  category: 'tech',
})
registerWaveCleanup(() => { trailBuffer = null })

/**
 * Chức năng 13 — Bước 4. Vẽ timeline từ precomputed data.
 * Enhanced with 3D gradient waveform, neon glow, beat-reactive coloring.
 *
 * Visual features:
 * - Gradient waveform bars with height-based color ramp (cool blue → hot pink)
 * - Soft glow behind waveform for depth perception
 * - Neon beat markers with pulse glow
 * - Glowing playhead with halo
 * - Subtle grid lines for time reference
 * - Smooth center line with gradient
 */

import type { TimelineData } from './types'

// ─── Color palette ──────────────────────────────────────────────────────────

/** PRISM-inspired color palette for waveform height mapping */
const WAVE_COLORS: readonly [number, number, number][] = [
  [40, 80, 160],    // deep blue (quiet)
  [60, 140, 200],   // cyan (low)
  [80, 200, 180],   // teal (medium-low)
  [160, 220, 80],   // lime (medium)
  [240, 200, 40],   // gold (medium-high)
  [255, 120, 60],   // orange (high)
  [255, 60, 120],   // hot pink (peak)
]

function getWaveColor(intensity: number, alpha: number): string {
  const t = Math.max(0, Math.min(1, intensity))
  const s = t * (WAVE_COLORS.length - 1)
  const i = Math.min(Math.floor(s), WAVE_COLORS.length - 2)
  const f = s - i
  const a = WAVE_COLORS[i]!
  const b = WAVE_COLORS[i + 1]!
  return `rgba(${a[0] + (b[0] - a[0]) * f | 0},${a[1] + (b[1] - a[1]) * f | 0},${a[2] + (b[2] - a[2]) * f | 0},${alpha})`
}

// ─── Constants ──────────────────────────────────────────────────────────────

const BG_TOP = '#090918'
const BG_BOTTOM = '#0d0d22'
const GRID_COLOR = 'rgba(255,255,255,0.04)'
const GRID_TEXT_COLOR = 'rgba(255,255,255,0.15)'
const CENTER_LINE_COLOR = 'rgba(100, 140, 220, 0.12)'
const BEAT_COLOR_INNER = 'rgba(255, 220, 100, 0.85)'
const BEAT_GLOW_COLOR = 'rgba(255, 200, 60, 0.25)'
const PLAYHEAD_COLOR = 'rgba(255, 80, 80, 0.95)'
const PLAYHEAD_GLOW = 'rgba(255, 60, 60, 0.3)'
const LABEL_COLOR = 'rgba(255,255,255,0.18)'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DrawTimelineOptions {
  data: TimelineData | null
  zoom: number
  scrollPx: number
  playheadTimeSec: number
  width: number
  height: number
}

// ─── Main draw function ─────────────────────────────────────────────────────

export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  opts: DrawTimelineOptions
): void {
  const { data, zoom, scrollPx, playheadTimeSec, width, height } = opts

  // ═══ Background gradient ═══
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height)
  bgGrad.addColorStop(0, BG_TOP)
  bgGrad.addColorStop(1, BG_BOTTOM)
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, width, height)

  if (!data || data.peaks.length === 0) {
    ctx.fillStyle = LABEL_COLOR
    ctx.font = '11px system-ui'
    ctx.fillText('Timeline (load audio để xem waveform / beat)', 8, 14)
    return
  }

  const duration = data.duration
  const peaks = data.peaks
  const beats = data.beats

  const pxPerSec = (width * zoom) / duration
  const midY = height / 2

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()

  const startPx = -scrollPx
  const startTime = Math.max(0, (-startPx) / pxPerSec)
  const endTime = Math.min(duration, (-startPx + width) / pxPerSec)
  const startIdx = Math.floor((startTime / duration) * peaks.length)
  const endIdx = Math.min(peaks.length, Math.ceil((endTime / duration) * peaks.length) + 1)
  const barWidth = Math.max(1, (pxPerSec * duration) / peaks.length)

  // ═══ Time grid lines ═══
  const gridInterval = getGridInterval(pxPerSec)
  if (gridInterval > 0) {
    const gridStart = Math.ceil(startTime / gridInterval) * gridInterval
    ctx.strokeStyle = GRID_COLOR
    ctx.lineWidth = 1
    ctx.font = '9px system-ui'
    ctx.fillStyle = GRID_TEXT_COLOR
    for (let t = gridStart; t <= endTime; t += gridInterval) {
      const x = t * pxPerSec + startPx
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
      ctx.fillText(formatTime(t), x + 3, 10)
    }
  }

  // ═══ Center line ═══
  ctx.strokeStyle = CENTER_LINE_COLOR
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, midY)
  ctx.lineTo(width, midY)
  ctx.stroke()

  // ═══ Waveform glow pass (wider, softer bars behind main waveform) ═══
  for (let i = startIdx; i < endIdx; i++) {
    const t = (i / peaks.length) * duration
    const x = t * pxPerSec + startPx
    const peak = peaks[i] ?? 0
    if (peak < 0.02) continue
    const h = peak * (height / 2 - 4)
    const glowW = barWidth + 2
    const glowAlpha = 0.15 + peak * 0.15

    const glowColor = getWaveColor(peak, glowAlpha)
    ctx.fillStyle = glowColor

    // Upper glow
    ctx.fillRect(x - 1, midY - h - 2, glowW, h + 2)
    // Lower glow (mirror)
    ctx.fillRect(x - 1, midY, glowW, h + 2)
  }

  // ═══ 3D depth shadow pass (offset darker copy behind waveform) ═══
  const shadowOff = Math.max(1, barWidth * 0.5)
  for (let i = startIdx; i < endIdx; i++) {
    const t = (i / peaks.length) * duration
    const x = t * pxPerSec + startPx
    const peak = peaks[i] ?? 0
    if (peak < 0.08) continue
    const h = peak * (height / 2 - 4)
    ctx.fillStyle = getWaveColor(peak * 0.6, 0.18)
    ctx.fillRect(x + shadowOff, midY - h + shadowOff, Math.max(1, barWidth - 0.5), h - shadowOff)
    ctx.fillRect(x + shadowOff, midY + shadowOff, Math.max(1, barWidth - 0.5), h - shadowOff)
  }

  // ═══ Main waveform bars (gradient colored by intensity) ═══
  for (let i = startIdx; i < endIdx; i++) {
    const t = (i / peaks.length) * duration
    const x = t * pxPerSec + startPx
    const peak = peaks[i] ?? 0
    if (peak < 0.01) continue
    const h = peak * (height / 2 - 4)

    // Upper bar: gradient from mid (bright) to top (intense)
    const upperGrad = ctx.createLinearGradient(x, midY, x, midY - h)
    upperGrad.addColorStop(0, getWaveColor(peak * 0.3, 0.6))
    upperGrad.addColorStop(0.5, getWaveColor(peak * 0.7, 0.75))
    upperGrad.addColorStop(1, getWaveColor(peak, 0.9))
    ctx.fillStyle = upperGrad
    ctx.fillRect(x, midY - h, Math.max(1, barWidth - 0.5), h)

    // Lower bar (mirror, slightly dimmer)
    const lowerGrad = ctx.createLinearGradient(x, midY, x, midY + h)
    lowerGrad.addColorStop(0, getWaveColor(peak * 0.3, 0.45))
    lowerGrad.addColorStop(0.5, getWaveColor(peak * 0.6, 0.35))
    lowerGrad.addColorStop(1, getWaveColor(peak * 0.9, 0.2))
    ctx.fillStyle = lowerGrad
    ctx.fillRect(x, midY, Math.max(1, barWidth - 0.5), h)
  }

  // ═══ Beat markers (neon glow) ═══
  for (let i = 0; i < beats.length; i++) {
    const t = beats[i]!
    if (t < startTime || t > endTime) continue
    const x = t * pxPerSec + startPx

    // Glow behind beat line
    ctx.strokeStyle = BEAT_GLOW_COLOR
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()

    // Beat line
    ctx.strokeStyle = BEAT_COLOR_INNER
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()

    // Small diamond marker at center
    ctx.fillStyle = BEAT_COLOR_INNER
    ctx.beginPath()
    ctx.moveTo(x, midY - 4)
    ctx.lineTo(x + 3, midY)
    ctx.lineTo(x, midY + 4)
    ctx.lineTo(x - 3, midY)
    ctx.closePath()
    ctx.fill()
  }

  // ═══ Playhead (glowing) ═══
  const headX = playheadTimeSec * pxPerSec + startPx
  if (headX >= 0 && headX <= width) {
    // Wide glow
    ctx.strokeStyle = PLAYHEAD_GLOW
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.moveTo(headX, 0)
    ctx.lineTo(headX, height)
    ctx.stroke()

    // Medium glow
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.5)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(headX, 0)
    ctx.lineTo(headX, height)
    ctx.stroke()

    // Sharp line
    ctx.strokeStyle = PLAYHEAD_COLOR
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(headX, 0)
    ctx.lineTo(headX, height)
    ctx.stroke()

    // Playhead triangle marker at top
    ctx.fillStyle = PLAYHEAD_COLOR
    ctx.beginPath()
    ctx.moveTo(headX - 5, 0)
    ctx.lineTo(headX + 5, 0)
    ctx.lineTo(headX, 7)
    ctx.closePath()
    ctx.fill()
  }

  ctx.restore()

  // ═══ Energy intensity strip at top (1px high, PRISM colored by peak energy) ═══
  const stripH = 3
  for (let i = startIdx; i < endIdx; i++) {
    const t = (i / peaks.length) * duration
    const x = t * pxPerSec + startPx
    const peak = peaks[i] ?? 0
    if (peak < 0.01) continue
    ctx.fillStyle = getWaveColor(peak, 0.5 + peak * 0.5)
    ctx.fillRect(x, 0, Math.max(1, barWidth), stripH)
  }

  // ═══ Info label ═══
  ctx.fillStyle = LABEL_COLOR
  ctx.font = '10px system-ui'
  ctx.fillText(`${duration.toFixed(1)}s • ${peaks.length} peaks • ${beats.length} beats`, 8, height - 6)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Determine grid interval in seconds based on zoom level */
function getGridInterval(pxPerSec: number): number {
  if (pxPerSec > 200) return 0.5
  if (pxPerSec > 80) return 1
  if (pxPerSec > 30) return 2
  if (pxPerSec > 15) return 5
  if (pxPerSec > 6) return 10
  if (pxPerSec > 2) return 30
  return 60
}

/** Format time as m:ss or s.d */
function formatTime(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Chức năng 13 — Bước 4. Vẽ timeline từ precomputed data.
 * Chỉ gọi từ TimelineView khi data/zoom/scroll đổi; không RAF, không FFT.
 */

import type { TimelineData } from './types'

const LANE_COLOR = 'rgba(80, 120, 180, 0.5)'
const LANE_MID = 'rgba(100, 140, 200, 0.35)'
const BEAT_COLOR = 'rgba(255, 200, 80, 0.6)'
const PLAYHEAD_COLOR = 'rgba(255, 80, 80, 0.9)'
const BG = '#0f0f1a'
const LABEL_COLOR = 'rgba(255,255,255,0.12)'

export interface DrawTimelineOptions {
  data: TimelineData | null
  zoom: number
  scrollPx: number
  playheadTimeSec: number
  width: number
  height: number
}

export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  opts: DrawTimelineOptions
): void {
  const { data, zoom, scrollPx, playheadTimeSec, width, height } = opts
  ctx.fillStyle = BG
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
  const totalContentPx = duration * pxPerSec
  const midY = height / 2

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()

  const startPx = -scrollPx
  const endPx = -scrollPx + width
  const startTime = Math.max(0, startPx / pxPerSec)
  const endTime = Math.min(duration, endPx / pxPerSec)
  const startIdx = Math.floor((startTime / duration) * peaks.length)
  const endIdx = Math.min(peaks.length, Math.ceil((endTime / duration) * peaks.length) + 1)

  for (let i = startIdx; i < endIdx; i++) {
    const t = (i / peaks.length) * duration
    const x = t * pxPerSec + startPx
    const peak = peaks[i] ?? 0
    const h = (peak * (height / 2 - 4)) / 1
    ctx.fillStyle = LANE_COLOR
    ctx.fillRect(x, midY - h, Math.max(1, (pxPerSec * duration) / peaks.length), h)
    ctx.fillStyle = LANE_MID
    ctx.fillRect(x, midY, Math.max(1, (pxPerSec * duration) / peaks.length), h)
  }

  ctx.fillStyle = BEAT_COLOR
  ctx.strokeStyle = BEAT_COLOR
  ctx.lineWidth = 1
  for (let i = 0; i < beats.length; i++) {
    const t = beats[i]!
    if (t < startTime || t > endTime) continue
    const x = t * pxPerSec + startPx
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }

  const headX = playheadTimeSec * pxPerSec + startPx
  if (headX >= startPx && headX <= endPx) {
    ctx.strokeStyle = PLAYHEAD_COLOR
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(headX, 0)
    ctx.lineTo(headX, height)
    ctx.stroke()
  }

  ctx.restore()

  ctx.fillStyle = LABEL_COLOR
  ctx.font = '10px system-ui'
  ctx.fillText(`${duration.toFixed(1)}s • ${peaks.length} peaks • ${beats.length} beats`, 8, height - 6)
}

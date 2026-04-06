/**
 * Chức năng 13 — Render: webgl lane, overlay test pattern (optional FFT), composite.
 * Bước 2: overlay có thể "nhúc nhích" theo FFT. Bước 3: overlay do engine vẽ.
 */

import type { CanvasSet } from '../canvas/CanvasHost'

export type TestPatternCanvasSet = CanvasSet

/** Chỉ vẽ webgl lane (background). */
export function renderWebglLane(canvases: TestPatternCanvasSet): void {
  const { webglCanvas } = canvases
  const ctx = webglCanvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#0d0d14'
  ctx.fillRect(0, 0, webglCanvas.width, webglCanvas.height)
  const g = ctx.createLinearGradient(0, 0, webglCanvas.width, 0)
  g.addColorStop(0, 'rgba(60,40,80,0.4)')
  g.addColorStop(1, 'rgba(40,60,80,0.2)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, webglCanvas.width, webglCanvas.height)
}

/** Overlay test pattern; optional freq để line nhúc nhích (Bước 2). */
export function renderOverlayTestPattern(
  canvases: TestPatternCanvasSet,
  freq?: Uint8Array,
  _wave?: Uint8Array
): void {
  const { overlay2dCanvas } = canvases
  const ctx = overlay2dCanvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, overlay2dCanvas.width, overlay2dCanvas.height)
  const midY = overlay2dCanvas.height / 2
  let offset = 0
  if (freq && freq.length > 0) {
    let sum = 0
    for (let i = 0; i < Math.min(32, freq.length); i++) sum += freq[i]
    const avg = sum / Math.min(32, freq.length)
    offset = ((avg / 255) * 2 - 1) * 20
  }
  const y = midY + offset
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, y)
  ctx.lineTo(overlay2dCanvas.width, y)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  ctx.font = '14px system-ui'
  ctx.fillText('Overlay lane', 16, 24)
}

/** Composite: webgl + overlay → composite canvas. */
export function renderComposite(canvases: TestPatternCanvasSet): void {
  const { webglCanvas, overlay2dCanvas, compositeCanvas } = canvases
  const ctx = compositeCanvas.getContext('2d')
  if (!ctx) return
  const w = compositeCanvas.width
  const h = compositeCanvas.height
  ctx.clearRect(0, 0, w, h)
  // Ensure source-over blend BEFORE first drawImage (not after)
  ctx.globalCompositeOperation = 'source-over'
  // Use explicit destination dimensions to handle potential size mismatches
  ctx.drawImage(webglCanvas, 0, 0, w, h)
  ctx.drawImage(overlay2dCanvas, 0, 0, w, h)
}

/** Bước 1: full test pattern (webgl + overlay + composite). */
export function renderTestPattern(canvases: TestPatternCanvasSet): void {
  renderWebglLane(canvases)
  renderOverlayTestPattern(canvases)
  renderComposite(canvases)
}

/**
 * Chức năng 13 — Resize canvas theo container rect, dpr, qualityScale.
 * Set canvas.style.width/height (px) và canvas.width/height (px * dpr * qualityScale).
 * Giới hạn max 4096 mỗi chiều để tránh lỗi khi zoom quá lớn.
 */
const MAX_CANVAS_DIM = 4096

export function resizeCanvasToContainer(
  canvas: HTMLCanvasElement,
  rect: { width: number; height: number },
  dpr: number,
  qualityScale: number
): { width: number; height: number } {
  let w = Math.max(1, Math.floor(rect.width * dpr * qualityScale))
  let h = Math.max(1, Math.floor(rect.height * dpr * qualityScale))
  if (w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM) {
    const scale = Math.min(MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h)
    w = Math.max(1, Math.floor(w * scale))
    h = Math.max(1, Math.floor(h * scale))
  }
  canvas.style.width = `${rect.width}px`
  canvas.style.height = `${rect.height}px`
  canvas.width = w
  canvas.height = h
  return { width: rect.width, height: rect.height }
}

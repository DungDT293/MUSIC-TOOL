/**
 * Chức năng 13 — Tạo canvas element (off-DOM hoặc for append).
 */

export function createCanvas(className?: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.objectFit = 'contain'
  if (className) canvas.className = className
  return canvas
}

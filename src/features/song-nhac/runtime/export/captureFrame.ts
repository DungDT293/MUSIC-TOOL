/**
 * Chức năng 13 — Bước 5. Capture composite canvas → buffer cho FFmpeg.
 * v2: JPEG pipe thay vì raw RGBA → IPC nhẹ ~40-80× (8.3MB → ~150KB/frame).
 * v3: Quality 0.92 (gọi từ ExportRuntime) → gần lossless, tránh JPEG artifact bake vào H.264.
 */

import type { CanvasSet } from '../canvas/CanvasHost'

/**
 * Capture composite → RGBA buffer cho FFmpeg rawvideo pipe.
 * getImageData ~2ms (unavoidable), single call per frame.
 */
export function captureCompositeToRGBA(set: CanvasSet): Uint8ClampedArray {
  const { compositeCanvas } = set
  const ctx = compositeCanvas.getContext('2d')
  if (!ctx) return new Uint8ClampedArray(0)
  const w = compositeCanvas.width
  const h = compositeCanvas.height
  return ctx.getImageData(0, 0, w, h).data
}

/**
 * Capture composite canvas → JPEG ArrayBuffer.
 * Dùng canvas.toBlob('image/jpeg') — nhẹ hơn raw RGBA rất nhiều,
 * giảm bottleneck IPC transfer từ 8.3MB xuống ~100-200KB/frame (1080p).
 * FFmpeg input: -f image2pipe (auto-detect mjpeg).
 */
export function captureCompositeToJPEG(set: CanvasSet, quality = 0.92): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const { compositeCanvas } = set
    compositeCanvas.toBlob(
      (blob) => {
        if (!blob) { reject(new Error('canvas.toBlob returned null')); return }
        blob.arrayBuffer().then(resolve).catch(reject)
      },
      'image/jpeg',
      quality
    )
  })
}

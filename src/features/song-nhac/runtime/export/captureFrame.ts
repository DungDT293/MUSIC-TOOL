/**
 * Chức năng 13 — Bước 5. Capture composite canvas → buffer cho FFmpeg.
 * v2: JPEG pipe thay vì raw RGBA → IPC nhẹ ~40-80× (8.3MB → ~150KB/frame).
 * v3: Quality 0.92 (gọi từ ExportRuntime) → gần lossless, tránh JPEG artifact bake vào H.264.
 * v4: BMP lossless mode → tránh JPEG artifact hoàn toàn, chất lượng bằng preview.
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

/**
 * Capture composite canvas → BMP ArrayBuffer (lossless).
 * Avoids JPEG double-compression artifacts entirely — output quality
 * matches exactly what the preview shows.
 *
 * BMP format: simple header + raw BGRA pixels, no compression.
 * Size: ~5.5MB per frame at 1280×720, ~8.3MB at 1920×1080.
 * Faster to encode than PNG (no compression), FFmpeg decodes BMP very fast.
 */
const _bmpCtxCache = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>()
export function captureCompositeToBMP(set: CanvasSet): ArrayBuffer {
  const { compositeCanvas } = set
  let ctx = _bmpCtxCache.get(compositeCanvas)
  if (!ctx) {
    ctx = compositeCanvas.getContext('2d', { willReadFrequently: true })!
    if (!ctx) return new ArrayBuffer(0)
    _bmpCtxCache.set(compositeCanvas, ctx)
  }
  const w = compositeCanvas.width
  const h = compositeCanvas.height
  const imgData = ctx.getImageData(0, 0, w, h)
  const pixels = imgData.data // RGBA

  // BMP file: 14-byte file header + 40-byte DIB header + pixel data (BGRA, bottom-up)
  const rowSize = w * 4
  const pixelDataSize = rowSize * h
  const fileSize = 54 + pixelDataSize
  const buf = new ArrayBuffer(fileSize)
  const view = new DataView(buf)

  // ── BMP File Header (14 bytes) ──
  view.setUint8(0, 0x42)   // 'B'
  view.setUint8(1, 0x4D)   // 'M'
  view.setUint32(2, fileSize, true)   // File size
  view.setUint32(6, 0, true)         // Reserved
  view.setUint32(10, 54, true)       // Pixel data offset

  // ── DIB Header (BITMAPINFOHEADER, 40 bytes) ──
  view.setUint32(14, 40, true)       // DIB header size
  view.setInt32(18, w, true)         // Width
  view.setInt32(22, -h, true)        // Height (negative = top-down, no need to flip rows)
  view.setUint16(26, 1, true)        // Color planes
  view.setUint16(28, 32, true)       // Bits per pixel (32 = BGRA)
  view.setUint32(30, 0, true)        // Compression (0 = BI_RGB, uncompressed)
  view.setUint32(34, pixelDataSize, true) // Image size
  view.setUint32(38, 2835, true)     // H resolution (72 DPI)
  view.setUint32(42, 2835, true)     // V resolution (72 DPI)
  view.setUint32(46, 0, true)        // Colors in palette
  view.setUint32(50, 0, true)        // Important colors

  // ── Pixel data: convert RGBA → BGRA ──
  const dst = new Uint8Array(buf, 54)
  for (let i = 0, j = 0; i < pixels.length; i += 4, j += 4) {
    dst[j]     = pixels[i + 2]! // B
    dst[j + 1] = pixels[i + 1]! // G
    dst[j + 2] = pixels[i]!     // R
    dst[j + 3] = 255            // A (opaque)
  }

  return buf
}


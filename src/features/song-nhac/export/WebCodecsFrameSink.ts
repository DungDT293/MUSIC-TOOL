/**
 * WebCodecsFrameSink.ts — H.264 GPU encoder via WebCodecs API.
 * Encode H.264 trực tiếp trong browser, bỏ hoàn toàn JPEG intermediate.
 *
 * Flow: compositeCanvas → VideoFrame (GPU copy) → VideoEncoder (H.264 Annex B)
 *       → IPC (5-50KB thay vì 150-300KB) → FFmpeg -c:v copy (chỉ mux, không re-encode)
 *
 * Tốc độ: ~3-8x nhanh hơn JPEG pipeline.
 */

import type { FrameSink } from '../runtime/export/types'
import type { CanvasSet } from '../runtime/canvas/CanvasHost'

export interface WebCodecsFrameSinkOptions {
  jobId: string
  width: number
  height: number
  fps: number
  bitrateKbps: number
  sendFrame: (payload: { jobId: string; frameIndex: number; width: number; height: number; buffer: ArrayBuffer }) => void
  sendProgress: (payload: { jobId: string; frameIndex: number; totalFrames: number }) => void
  sendEnd: (jobId: string) => void
  waitForDrain?: (jobId: string) => Promise<void>
}

export interface WebCodecsFrameSinkWithBackPressure extends FrameSink {
  checkBackPressure(): Promise<void>
  /** Bind the canvasSet for VideoFrame capture. Must be called before first writeFrame. */
  setCanvasSet(set: CanvasSet): void
}

/**
 * Check if WebCodecs H.264 encoding is available in this renderer.
 */
export async function isWebCodecsH264Available(width: number, height: number): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return false
  try {
    const result = await VideoEncoder.isConfigSupported({
      codec: 'avc1.640034',
      width: Math.floor(width / 2) * 2,
      height: Math.floor(height / 2) * 2,
      hardwareAcceleration: 'prefer-hardware',
    })
    return result.supported === true
  } catch {
    return false
  }
}

/**
 * Create a WebCodecs-based FrameSink that encodes H.264 directly from canvas.
 * Returns null if WebCodecs is not available.
 *
 * Call setCanvasSet() before first writeFrame() — ExportRuntime creates
 * the CanvasHost which provides the CanvasSet.
 */
export async function createWebCodecsFrameSink(
  totalFrames: number,
  options: WebCodecsFrameSinkOptions,
): Promise<WebCodecsFrameSinkWithBackPressure | null> {
  const {
    jobId, width, height, fps, bitrateKbps,
    sendFrame, sendProgress, sendEnd, waitForDrain,
  } = options

  // Even dimensions for H.264
  const safeW = Math.floor(width / 2) * 2
  const safeH = Math.floor(height / 2) * 2

  // Check support
  const supported = await isWebCodecsH264Available(safeW, safeH)
  if (!supported) {
    console.warn('[WebCodecsFrameSink] H.264 encoding not supported, falling back to JPEG')
    return null
  }

  let frameIndex = 0
  let encoder: VideoEncoder | null = null
  let initError: Error | null = null
  let canvasSet: CanvasSet | null = null
  const KEYFRAME_INTERVAL = Math.round(fps * 2) // Keyframe every 2 seconds

  // FIX H2: Queue of frame indices corresponding to pending encodes.
  // VideoEncoder.output fires asynchronously — by then frameIndex has advanced.
  // We push the correct index before encode() and shift it in output().
  const pendingFrameIndices: number[] = []

  try {
    encoder = new VideoEncoder({
      output: (chunk: EncodedVideoChunk) => {
        // FIX H2: Dequeue the captured frame index (FIFO — matches encode order)
        const capturedIndex = pendingFrameIndices.shift() ?? frameIndex

        // Copy encoded H.264 chunk to ArrayBuffer
        const buf = new Uint8Array(chunk.byteLength)
        chunk.copyTo(buf)

        // Send via IPC — same channel as JPEG, but data is H.264 Annex B
        sendFrame({ jobId, frameIndex: capturedIndex, width: safeW, height: safeH, buffer: buf.buffer })

        // Throttle progress
        if (capturedIndex % 10 === 0 || capturedIndex === totalFrames) {
          sendProgress({ jobId, frameIndex: capturedIndex, totalFrames })
        }
      },
      error: (e: DOMException) => {
        console.error('[WebCodecsFrameSink] Encoder error:', e.message)
        initError = new Error(e.message)
      },
    })

    encoder.configure({
      codec: 'avc1.640034',      // H.264 High Profile Level 5.2 (supports up to 4K)
      width: safeW,
      height: safeH,
      framerate: fps,
      bitrate: bitrateKbps * 1000,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'quality',
      avc: { format: 'annexb' }, // Raw H.264 stream for FFmpeg -f h264 input
    })

    if (initError) throw initError
    console.log(`[WebCodecsFrameSink] Initialized: ${safeW}x${safeH} @ ${fps}fps, ${bitrateKbps}kbps`)
  } catch (err) {
    console.warn('[WebCodecsFrameSink] Failed to initialize:', err)
    if (encoder) try { encoder.close() } catch {}
    return null
  }

  const sink: WebCodecsFrameSinkWithBackPressure = {
    setCanvasSet(set: CanvasSet) {
      canvasSet = set
    },

    async writeFrame(_imageData: Uint8ClampedArray | ArrayBuffer): Promise<void> {
      if (!encoder || encoder.state === 'closed' || !canvasSet) return

      // Back-pressure: wait if encoder queue is full
      const MAX_QUEUE = 8
      let waited = 0
      while (encoder.encodeQueueSize > MAX_QUEUE) {
        await new Promise<void>(r => setTimeout(r, 2))
        if (++waited > 2500) break // Safety: max 5s wait
      }

      const isKey = frameIndex === 0 || frameIndex % KEYFRAME_INTERVAL === 0

      // Create VideoFrame from compositeCanvas (GPU copy, no CPU readback)
      const vf = new VideoFrame(canvasSet.compositeCanvas, {
        timestamp: Math.round(frameIndex * 1_000_000 / fps),
        duration: Math.round(1_000_000 / fps),
        alpha: 'discard',
      })

      // FIX H2: Capture current frameIndex BEFORE encode() fires the async output callback
      pendingFrameIndices.push(frameIndex)
      encoder.encode(vf, { keyFrame: isKey })
      vf.close() // Critical: free GPU texture immediately
      frameIndex++
    },

    async checkBackPressure(): Promise<void> {
      if (encoder && encoder.encodeQueueSize > 2) {
        await new Promise<void>(r => setTimeout(r, 5))
      }
      if (waitForDrain) {
        await waitForDrain(jobId)
      }
    },

    async close(): Promise<void> {
      if (encoder && encoder.state !== 'closed') {
        try {
          await encoder.flush() // Drain remaining frames
        } catch (err) {
          console.warn('[WebCodecsFrameSink] Flush error:', err)
        }
        try { encoder.close() } catch {}
        encoder = null
      }
      sendEnd(jobId)
    },
  }

  return sink
}

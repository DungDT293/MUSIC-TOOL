import type { SongNhacAudioFrame } from '../core/types'
import type { AveeVisualizerEngine } from '../three/AveeVisualizerEngine'
import { FrameEncoder } from './frameEncoder'

export interface RenderVideoOptions {
  canvas: HTMLCanvasElement
  engine: AveeVisualizerEngine
  frames: SongNhacAudioFrame[]
  fps: number
  bitrate: number
  /** h264 = widest compatibility, hevc = smaller files. */
  codec?: 'h264' | 'hevc'
  /** Emit chunks in order; the caller appends them to the raw bitstream. */
  onChunk: (chunk: Uint8Array) => void
  onProgress?: (renderedFrames: number, totalFrames: number) => void | Promise<void>
  signal?: AbortSignal
  /** Keyframe cadence in seconds. */
  keyFrameIntervalSec?: number
}

const YIELD_EVERY_FRAMES = 12
const MAX_ENCODER_QUEUE = 6

/**
 * Renders every frame of the visualizer at a fixed timestep and encodes it.
 *
 * Frames come from the pre-computed analysis array, never from a live analyser, so
 * the exported file is exactly the preview timeline — no realtime capture, no drift.
 */
export async function renderSongNhacVideo(options: RenderVideoOptions): Promise<void> {
  const { canvas, engine, frames, fps, bitrate, onChunk, onProgress, signal } = options
  const keyFrameInterval = Math.max(1, Math.round((options.keyFrameIntervalSec ?? 2) * fps))

  const codec = options.codec ?? 'h264'
  const encoder = new FrameEncoder({ width: canvas.width, height: canvas.height, fps, bitrate, codec, onChunk })
  const ready = await encoder.init()
  if (!ready) {
    console.error('[SongNhac export] encoder init failed:', encoder.diagnostics)
    throw new Error(
      `Thiết bị không hỗ trợ WebCodecs ${codec === 'hevc' ? 'HEVC (H.265)' : 'H.264'}, không thể xuất video. ${encoder.diagnostics}`,
    )
  }

  try {
    for (let index = 0; index < frames.length; index += 1) {
      if (signal?.aborted) throw new Error('Đã hủy xuất video.')
      engine.render(frames[index])
      encoder.encode(canvas, index, index % keyFrameInterval === 0)

      if (index % YIELD_EVERY_FRAMES === 0) {
        while (encoder.queueSize > MAX_ENCODER_QUEUE) {
          await new Promise((resolve) => setTimeout(resolve, 4))
          if (signal?.aborted) throw new Error('Đã hủy xuất video.')
        }
        // Yield so the renderer stays responsive while encoding a long mix, and let
        // the caller drain the chunk queue (IPC backpressure) at the same cadence.
        await onProgress?.(index, frames.length)
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    await encoder.flush()
    onProgress?.(frames.length, frames.length)
  } finally {
    encoder.close()
  }
}

/** Rough bitrate that keeps a 1080p music visual sharp without wasting disk. */
export function suggestBitrate(width: number, height: number, fps: number): number {
  const pixels = width * height
  // Music visuals are mostly dark gradients, so 10 Mbps at 1080p is already generous;
  // a 14 Mbps default turned a one-hour mix into a 6 GB upload.
  const base = pixels >= 3840 * 2160 ? 22_000_000 : pixels >= 2560 * 1440 ? 12_000_000 : pixels >= 1920 * 1080 ? 8_000_000 : 4_500_000
  return Math.round(base * Math.min(1.5, Math.max(0.6, fps / 30)))
}

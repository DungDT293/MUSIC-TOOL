/**
 * Chức năng 13 — Bước 5. FrameSink in-memory (test / debug).
 * Không gửi FFmpeg; dùng để kiểm tra ExportRuntime không drop frame.
 */

import type { FrameSink } from './types'

export function createBufferFrameSink(): FrameSink & { getFrames: () => Uint8ClampedArray[] } {
  const frames: Uint8ClampedArray[] = []

  return {
    async writeFrame(imageData: Uint8ClampedArray): Promise<void> {
      frames.push(imageData.slice(0))
    },
    async close(): Promise<void> {},
    getFrames(): Uint8ClampedArray[] {
      return frames
    },
  }
}

/**
 * Chức năng 13 — Backend wiring. FrameSink gửi frame qua IPC (transfer buffer).
 * Offscreen không giữ frame; mỗi frame gửi xong là bỏ.
 * writeFrame = fire-and-forget (sync IPC sends, no await).
 * Back-pressure handled separately via checkBackPressure().
 */

import type { FrameSink } from '../runtime/export/types'

export interface IpcFrameSinkOptions {
  jobId: string
  width: number
  height: number
  sendFrame: (payload: { jobId: string; frameIndex: number; width: number; height: number; buffer: ArrayBuffer }) => void
  sendProgress: (payload: { jobId: string; frameIndex: number; totalFrames: number }) => void
  /** Signal end of frames to main process (closes FFmpeg stdin). */
  sendEnd: (jobId: string) => void
  /** Back-pressure: invoke-based wait for main process queue to drain. */
  waitForDrain?: (jobId: string) => Promise<void>
}

export interface IpcFrameSinkWithBackPressure extends FrameSink {
  /** Call periodically (e.g. every 30 frames) to wait if main-process queue is full. */
  checkBackPressure(): Promise<void>
}

export function createIpcFrameSink(
  totalFrames: number,
  options: IpcFrameSinkOptions
): IpcFrameSinkWithBackPressure {
  const { jobId, width, height, sendFrame, sendProgress, sendEnd, waitForDrain } = options
  let frameIndex = 0

  return {
    async writeFrame(imageData: Uint8ClampedArray | ArrayBuffer): Promise<void> {
      // Hỗ trợ cả raw RGBA (Uint8ClampedArray) và JPEG (ArrayBuffer)
      let buffer: ArrayBuffer
      if (imageData instanceof ArrayBuffer) {
        buffer = imageData
      } else {
        // Safe extraction: chỉ lấy slice của view, không phải toàn bộ backing buffer
        buffer = imageData.buffer.slice(imageData.byteOffset, imageData.byteOffset + imageData.byteLength)
      }
      sendFrame({ jobId, frameIndex, width, height, buffer })
      // Throttle progress: chỉ gửi mỗi 10 frames (giảm IPC overhead)
      if (frameIndex % 10 === 0 || frameIndex === totalFrames - 1) {
        sendProgress({ jobId, frameIndex, totalFrames })
      }
      frameIndex += 1
    },
    async checkBackPressure(): Promise<void> {
      if (waitForDrain) {
        await waitForDrain(jobId)
      }
    },
    async close(): Promise<void> {
      // Signal main process that all frames have been sent → closes FFmpeg stdin
      sendEnd(jobId)
    },
  }
}

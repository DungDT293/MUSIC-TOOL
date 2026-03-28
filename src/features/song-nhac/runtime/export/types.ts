/**
 * Chức năng 13 — Bước 5. Export Phase 2 adapters.
 * Preview và Export dùng chung render-core; khác TimeSource, AudioSource, FrameSink.
 */

/** Preview: performance.now() / 1000; Export: frameIndex / fps */
export interface TimeSource {
  nowSec(): number
}

/** Preview: realtime AnalyserNode; Export: seek(audio) + getFrame(timeSec) */
export interface AudioFrame {
  frequencyData: Uint8Array
  waveformData: Uint8Array
}

export interface AudioSource {
  getFrame(timeSec: number): AudioFrame
}

/** Export-only: seek audio đến timeSec trước khi getFrame (optional) */
export interface SeekableAudioSource extends AudioSource {
  seek(timeSec: number): Promise<void>
}

/** Preview: vẽ ra canvas DOM. Export: capture → buffer → FFmpeg stdin */
export interface FrameSink {
  writeFrame(imageData: Uint8ClampedArray | ArrayBuffer): Promise<void>
  close(): Promise<void>
}

export interface ExportConfig {
  width: number
  height: number
  fps: number
  durationSec: number
  /** Device pixel ratio for canvas (export thường 1) */
  devicePixelRatio?: number
  /** Bắt buộc dùng Canvas 2D fallback thay vì WebGL (máy yếu/không có GPU). */
  forceSoftwareRenderer?: boolean
  /** Start offset (seconds) khi export từ range — frame i maps to timeSec = startSec + i/fps */
  startSec?: number
}

export interface ExportProgress {
  frameIndex: number
  totalFrames: number
  timeSec: number
}

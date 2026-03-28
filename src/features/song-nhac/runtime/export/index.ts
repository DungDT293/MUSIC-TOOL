/**
 * Chức năng 13 — Bước 5. Export Phase 2.
 * TimeSource / AudioSource / FrameSink; ExportRuntime; không Zustand, không RAF.
 */

export type {
  TimeSource,
  AudioSource,
  AudioFrame,
  SeekableAudioSource,
  FrameSink,
  ExportConfig,
  ExportProgress,
} from './types'
export { renderOneFrame } from './renderOneFrame'
export { captureCompositeToRGBA } from './captureFrame'
export { createAudioSourceExport } from './AudioSourceExport'
export { createAudioSourcePrecomputed, createAudioSourceFromPcm, createAudioSourceIpc } from './AudioSourcePrecomputed'
export { runExportRuntime } from './ExportRuntime'
export type { ExportRuntimeOptions } from './ExportRuntime'
export { createBufferFrameSink } from './BufferFrameSink'

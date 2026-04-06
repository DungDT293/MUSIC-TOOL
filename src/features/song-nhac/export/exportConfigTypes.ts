/**
 * Chức năng 13 — EXPORT VIDEO (UX) v1.
 * Contract: UI build ExportConfig → backend chỉ nhận width, height, fps, durationSec, audioFileUrl?, outputPath?, forceCpuEncoder?
 * presetId + range chỉ dùng trong dialog; durationSec đã clamp theo range.
 */

export type ExportRange =
  | { type: 'full' }
  | { type: 'range'; inSec: number; outSec: number }

export type ExportPresetId = 'low' | 'medium' | 'full' | '2k' | 'custom'

export interface ExportConfigForBackend {
  width: number
  height: number
  fps: number
  durationSec: number
  audioFileUrl?: string
  outputPath?: string
  forceCpuEncoder?: boolean
  /** Bắt buộc dùng Canvas 2D renderer thay vì WebGL (máy yếu). */
  forceSoftwareRenderer?: boolean
}

/** UI-level config (dialog state → build ForBackend before calling exportVideo). */
export interface ExportConfig {
  presetId: ExportPresetId
  width: number
  height: number
  fps: number
  durationSec: number
  range: ExportRange
  audioFileUrl?: string
  forceCpuEncoder?: boolean
  /** Bắt buộc dùng Canvas 2D renderer thay vì WebGL (máy yếu). */
  forceSoftwareRenderer?: boolean
}

/** Tỉ lệ khung — dùng chung cho Preview và Export. */
export type AspectRatioId = '16:9' | '4:3' | '1:1' | '9:16' | '4:5' | '2.35:1' | '2:1' | '1.85:1' | '3:4' | '5.8-inch'

/** Preset gốc (16:9) — dùng làm base để tính theo aspect ratio. */
export const EXPORT_PRESETS: Record<Exclude<ExportPresetId, 'custom'>, { width: number; height: number; fps: number }> = {
  low: { width: 640, height: 360, fps: 30 },
  medium: { width: 1280, height: 720, fps: 30 },
  full: { width: 1920, height: 1080, fps: 60 },
  '2k': { width: 2560, height: 1440, fps: 30 },
}

/** Chiều cao theo tier (low/medium/full/2k). */
const HEIGHT_BY_PRESET: Record<Exclude<ExportPresetId, 'custom'>, number> = {
  low: 360,
  medium: 720,
  full: 1080,
  '2k': 1440,
}

/** Tính width/height theo preset + aspect ratio. Export ra đúng tỉ lệ (16:9, 4:3, 1:1). */
export function getDimensionsForPresetAndAspectRatio(
  presetId: Exclude<ExportPresetId, 'custom'>,
  aspectRatio: AspectRatioId
): { width: number; height: number; fps: number } {
  const base = EXPORT_PRESETS[presetId]
  const h = HEIGHT_BY_PRESET[presetId]
  const even = (n: number) => n - (n % 2)
  if (aspectRatio === '16:9') {
    return { width: even(Math.round(h * (16 / 9))), height: h, fps: base.fps }
  }
  if (aspectRatio === '4:3') {
    return { width: even(Math.round(h * (4 / 3))), height: h, fps: base.fps }
  }
  if (aspectRatio === '1:1') {
    return { width: h, height: h, fps: base.fps }
  }
  if (aspectRatio === '9:16') {
    const w = even(h)
    return { width: w, height: even(Math.round(w * (16 / 9))), fps: base.fps }
  }
  if (aspectRatio === '4:5') {
    const w = even(h)
    return { width: w, height: even(Math.round(w * (5 / 4))), fps: base.fps }
  }
  if (aspectRatio === '2.35:1') {
    return { width: even(Math.round(h * 2.35)), height: h, fps: base.fps }
  }
  if (aspectRatio === '2:1') {
    return { width: even(h * 2), height: h, fps: base.fps }
  }
  if (aspectRatio === '1.85:1') {
    return { width: even(Math.round(h * 1.85)), height: h, fps: base.fps }
  }
  if (aspectRatio === '3:4') {
    return { width: even(Math.round(h * (3 / 4))), height: h, fps: base.fps }
  }
  if (aspectRatio === '5.8-inch') {
    // iPhone SE/X ratio: 2436×1125 ≈ 19.5:9
    return { width: even(Math.round(h * (9 / 19.5))), height: h, fps: base.fps }
  }
  return base
}

/** Encoder quality presets — maps UI labels → backend quality preset names. */
export type EncoderQualityId = 'speed' | 'balanced' | 'quality' | 'lowend'

export const ENCODER_QUALITY_OPTIONS: Record<EncoderQualityId, {
  label: string
  backendPreset: 'ultra-fast' | 'fast' | 'balanced' | 'lowend'
  description: string
}> = {
  lowend:   { label: 'Máy yếu',    backendPreset: 'lowend',     description: 'Tối ưu cho máy yếu: CPU encoder, CRF cao, nhanh nhất' },
  speed:    { label: 'Tốc độ',     backendPreset: 'ultra-fast', description: 'Nhanh nhất, chất lượng vừa' },
  balanced: { label: 'Cân bằng',   backendPreset: 'fast',       description: 'Cân bằng tốc độ & chất lượng' },
  quality:  { label: 'Chất lượng', backendPreset: 'balanced',   description: 'Chất lượng cao nhất, file lớn hơn, chậm hơn' },
}

/**
 * Estimate output file size (bytes) — rough estimate for UI preview.
 * Based on typical H.264 bitrate at given resolution/fps/quality.
 */
export function estimateExportFileSize(
  width: number,
  height: number,
  fps: number,
  durationSec: number,
  quality: EncoderQualityId = 'speed'
): number {
  // Base video bitrate at 1080p 30fps (Mbps)
  const baseMbps: Record<EncoderQualityId, number> = {
    lowend: 5,
    speed: 8,
    balanced: 10,
    quality: 15,
  }
  const pixelRatio = (width * height) / (1920 * 1080)
  const fpsRatio = fps / 30
  const videoBitrateMbps = baseMbps[quality] * Math.max(0.3, pixelRatio) * Math.max(0.5, fpsRatio)
  const audioBitrateMbps = 0.192 // ~192kbps AAC
  const totalBytesPerSec = (videoBitrateMbps + audioBitrateMbps) * 1_000_000 / 8
  return Math.round(totalBytesPerSec * durationSec)
}

/** Format bytes to human-readable string. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** Default audio for export when using "current track" (demo). */
export const DEFAULT_EXPORT_AUDIO_URL = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'

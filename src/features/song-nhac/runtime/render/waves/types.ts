/**
 * Wave Style Plugin System — Type definitions.
 *
 * Mỗi wave style là 1 file riêng, implement WaveDrawFn interface.
 * Registry tự động đăng ký qua registerWave().
 *
 * KIẾN TRÚC MODULAR:
 * - Mỗi agent/developer tạo file mới trong waves/ → KHÔNG conflict
 * - Thêm wave style mới = 1 file + 1 dòng import trong index.ts
 */

import type { FrequencyBands, VisualizerColorOptions } from './helpers'

/**
 * Hàm vẽ wave style — tất cả styles đều implement interface này.
 *
 * @param ctx       Canvas 2D rendering context (đã được translate/rotate bởi caller)
 * @param w         Chiều rộng vùng vẽ (pixels)
 * @param h         Chiều cao vùng vẽ (pixels)
 * @param amplitude Biên độ tổng thể (0–1+), dùng để scale wave offset
 * @param samples   Time-domain waveform data (32 vals, 0–255)
 * @param spectrum  Sub-sampled frequency spectrum (64 vals, 0–255). Optional.
 * @param bands     Pre-computed band energies { bass, mid, treble } (0–1). Optional.
 * @param vc        Per-visualizer color/animation options. Optional.
 * @param beat      Current beat level (0–1) for glow/pulse effects. Optional.
 */
export type WaveDrawFn = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
) => void

/**
 * Metadata cho mỗi wave style — dùng cho UI (InspectorPanel).
 */
export interface WaveStyleMeta {
  /** Unique ID — phải khớp với key trong registry */
  id: string
  /** Tên hiển thị trong UI (tiếng Việt) */
  label: string
  /** Icon emoji */
  icon: string
  /** Mô tả ngắn (optional) */
  description?: string
  /** Category để group trong UI (optional) */
  category?: 'basic' | 'geometric' | 'nature' | 'tech' | 'artistic'
}

/**
 * Wave style registration entry.
 */
export interface WaveStyleEntry {
  draw: WaveDrawFn
  meta: WaveStyleMeta
}

/**
 * State cleanup function — mỗi wave style có persistent state
 * cần cleanup khi switch track hoặc destroy runtime.
 */
export type WaveStateCleanup = () => void

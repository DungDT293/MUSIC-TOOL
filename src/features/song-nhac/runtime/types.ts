/**
 * Chức năng 13 — Runtime types.
 * API tối thiểu để UI gọi; không FFT/engine trong skeleton.
 * Phase 3: getLayers cho vẽ image/text lên overlay.
 */

import type { DrawableLayer } from './render/drawLayers'

export type PreviewQuality = 'low' | 'medium' | 'full'

export interface RuntimeEvents {
  /** Throttle 500ms. UI chỉ render text, không đo FPS. */
  onFps?: (fps: number) => void
}

export interface RuntimeOptions {
  quality?: PreviewQuality
  /** Optional override (default: window.devicePixelRatio) */
  devicePixelRatio?: number
  /** Default 500 */
  fpsReportIntervalMs?: number
  /** Phase 3: callback lấy layers để vẽ lên overlay (image/text). Gọi mỗi frame. */
  getLayers?: () => DrawableLayer[]
}

export const QUALITY_SCALE: Record<PreviewQuality, number> = {
  low: 0.5,
  medium: 0.75,
  full: 1,
}

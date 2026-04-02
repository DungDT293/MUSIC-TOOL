/**
 * Phase 2 — Layer types cho Sóng nhạc (chức năng 11).
 * V3: Thêm hiệu ứng layer: flip, opacity, filters (brightness/contrast/blur/hue/saturation/grayscale/sepia), tint, borderRadius, shadow.
 * V4: Thêm timeRange (intro/outro) và role (watermark/logo).
 */

export interface SongNhacTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number // degrees
  /** Lật ngang */
  flipX?: boolean
  /** Lật dọc */
  flipY?: boolean
}

/** Hiệu ứng CSS-filter áp dụng cho image/video/text layer */
export interface SongNhacLayerFilter {
  /** Độ mờ toàn layer (0–1). Mặc định 1. */
  opacity?: number
  /** Độ sáng (0–3). Mặc định 1. */
  brightness?: number
  /** Độ tương phản (0–3). Mặc định 1. */
  contrast?: number
  /** Độ bão hoà màu (0–3). Mặc định 1. */
  saturation?: number
  /** Xoay màu (0–360 độ). Mặc định 0. */
  hue?: number
  /** Mức grayscale (0–1). Mặc định 0. */
  grayscale?: number
  /** Mức sepia (0–1). Mặc định 0. */
  sepia?: number
  /** Blur (px). Mặc định 0. */
  blur?: number
  /** Tint màu: mã hex, '' = không tô. */
  tintColor?: string
  /** Độ đặc của tint (0–1). Mặc định 0. */
  tintOpacity?: number
  /** Bo góc (px). Mặc định 0. */
  borderRadius?: number
  /** Bóng đổ — blur (px). Mặc định 0. */
  shadowBlur?: number
  /** Bóng đổ — màu. Mặc định 'rgba(0,0,0,0.5)'. */
  shadowColor?: string
  /** Bóng đổ offset X (px). */
  shadowOffsetX?: number
  /** Bóng đổ offset Y (px). */
  shadowOffsetY?: number
}

/** Khoảng thời gian hiển thị layer (giây). undefined = luôn hiện. */
export interface SongNhacTimeRange {
  /** Giây bắt đầu (inclusive). 0 = ngay đầu bài. */
  startSec: number
  /** Giây kết thúc (exclusive). Infinity = đến hết bài. */
  endSec: number
  /** Thời gian fade-in (giây). 0 = không fade. */
  fadeInSec?: number
  /** Thời gian fade-out (giây). 0 = không fade. */
  fadeOutSec?: number
}

/** Role đặc biệt của layer */
export type SongNhacLayerRole =
  | 'normal'     // mặc định
  | 'watermark'  // logo watermark — luôn vẽ trên cùng, không bị ẩn bởi group

export interface SongNhacBaseLayer {
  id: string
  type: 'image' | 'text' | 'visualizer' | 'video'
  name: string
  visible: boolean
  /** Khóa: không cho move/resize/rotate trên canvas. */
  locked?: boolean
  /** Phase 3: vị trí/scale/xoay khi vẽ lên canvas; mặc định DEFAULT_TRANSFORM. */
  transform?: SongNhacTransform
  /** ID của group chứa layer này; undefined = root. */
  parentId?: string
  /** Hiệu ứng filter (brightness, contrast, blur, tint, shadow...) */
  filter?: SongNhacLayerFilter
  /** Khoảng thời gian hiển thị. undefined = luôn hiện suốt bài. */
  timeRange?: SongNhacTimeRange
  /** Role đặc biệt của layer. */
  role?: SongNhacLayerRole
}

export type SongNhacImageFitMode = 'free' | 'contain' | 'cover'

export interface SongNhacImageLayer extends SongNhacBaseLayer {
  type: 'image'
  src?: string
  naturalWidth?: number
  naturalHeight?: number
  fitMode?: SongNhacImageFitMode
  waveAroundEnabled?: boolean
}

export interface SongNhacTextLayer extends SongNhacBaseLayer {
  type: 'text'
  text?: string
  fontSize?: number
  color?: string
  /** Font family */
  fontFamily?: string
  /** Font weight: 'normal' | 'bold' | '100'–'900' */
  fontWeight?: string
  /** Italic */
  italic?: boolean
  /** Outline stroke color ('', = không outline) */
  strokeColor?: string
  /** Độ dày stroke (px) */
  strokeWidth?: number
  /** Text shadow */
  textShadowColor?: string
  textShadowBlur?: number
  textShadowOffsetX?: number
  textShadowOffsetY?: number
}

/** Wave style IDs cho visualizer layer */
export type SongNhacWaveStyleId = 'bars' | 'line' | 'ring' | 'dots' | 'waveform' | 'circlebars' | 'plasma' | 'lightning' | 'galaxy' | 'fire' | 'neonbars' | 'crystalring' | 'nebula'

/** Color mode cho visualizer */
export type SongNhacColorMode = 'rainbow' | 'solid' | 'gradient'

export interface SongNhacVisualizerLayer extends SongNhacBaseLayer {
  type: 'visualizer'
  waveStyle: SongNhacWaveStyleId
  colorMode?: SongNhacColorMode
  color1?: string
  color2?: string
  barCount?: number
  barWidth?: number
  speed?: number
  opacity?: number
  glowEnabled?: boolean
  glowIntensity?: number
  mirror?: boolean
  sensitivity?: number
}

export interface SongNhacVideoLayer extends SongNhacBaseLayer {
  type: 'video'
  src?: string
  naturalWidth?: number
  naturalHeight?: number
  fitMode?: SongNhacImageFitMode
  muted?: boolean
  loop?: boolean
  /** Volume (0–1), chỉ có tác dụng khi muted=false */
  volume?: number
}

export interface SongNhacGroupLayer {
  id: string
  type: 'group'
  name: string
  children: string[]
}

export type SongNhacLayer = SongNhacImageLayer | SongNhacTextLayer | SongNhacVisualizerLayer | SongNhacVideoLayer | SongNhacGroupLayer

export const DEFAULT_TRANSFORM: SongNhacTransform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  flipX: false,
  flipY: false,
}

export const DEFAULT_FILTER: SongNhacLayerFilter = {
  opacity: 1,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hue: 0,
  grayscale: 0,
  sepia: 0,
  blur: 0,
  tintColor: '',
  tintOpacity: 0,
  borderRadius: 0,
  shadowBlur: 0,
  shadowColor: 'rgba(0,0,0,0.5)',
  shadowOffsetX: 0,
  shadowOffsetY: 0,
}

export function isSongNhacImageLayer(layer: SongNhacLayer): layer is SongNhacImageLayer {
  return layer.type === 'image'
}

export function isSongNhacTextLayer(layer: SongNhacLayer): layer is SongNhacTextLayer {
  return layer.type === 'text'
}

export function isSongNhacVisualizerLayer(layer: SongNhacLayer): layer is SongNhacVisualizerLayer {
  return layer.type === 'visualizer'
}

export function isSongNhacGroupLayer(layer: SongNhacLayer): layer is SongNhacGroupLayer {
  return layer.type === 'group'
}

export function isSongNhacVideoLayer(layer: SongNhacLayer): layer is SongNhacVideoLayer {
  return layer.type === 'video'
}

/** Tạo CSS filter string từ SongNhacLayerFilter */
export function buildCssFilter(f: SongNhacLayerFilter | undefined): string {
  if (!f) return ''
  const parts: string[] = []
  if (f.brightness != null && f.brightness !== 1) parts.push(`brightness(${f.brightness})`)
  if (f.contrast != null && f.contrast !== 1) parts.push(`contrast(${f.contrast})`)
  if (f.saturation != null && f.saturation !== 1) parts.push(`saturate(${f.saturation})`)
  if (f.hue != null && f.hue !== 0) parts.push(`hue-rotate(${f.hue}deg)`)
  if (f.grayscale != null && f.grayscale !== 0) parts.push(`grayscale(${f.grayscale})`)
  if (f.sepia != null && f.sepia !== 0) parts.push(`sepia(${f.sepia})`)
  if (f.blur != null && f.blur !== 0) parts.push(`blur(${f.blur}px)`)
  return parts.join(' ')
}

/**
 * Kiểm tra layer có hiển thị tại thời điểm timeSec không.
 * Trả về opacity factor (0–1) — hỗ trợ fade-in/fade-out.
 * Trả về -1 nếu layer hoàn toàn bị ẩn (ngoài timeRange).
 */
export function getLayerTimeOpacity(
  layer: { timeRange?: SongNhacTimeRange },
  timeSec: number
): number {
  const tr = layer.timeRange
  if (!tr) return 1 // không có timeRange → luôn hiện 100%

  const { startSec, endSec, fadeInSec = 0, fadeOutSec = 0 } = tr
  if (timeSec < startSec || timeSec >= endSec) return -1 // ngoài range

  // Fade-in
  if (fadeInSec > 0 && timeSec < startSec + fadeInSec) {
    return (timeSec - startSec) / fadeInSec
  }
  // Fade-out
  if (fadeOutSec > 0 && timeSec >= endSec - fadeOutSec) {
    return (endSec - timeSec) / fadeOutSec
  }
  return 1
}

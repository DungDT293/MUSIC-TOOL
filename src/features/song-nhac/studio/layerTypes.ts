/**
 * Song Nhạc studio layer model.
 *
 * Units: transform x/y are pixels relative to the centre of a 1080p-high stage
 * (y grows downwards, like the old studio). The engine converts px → world units,
 * so a layout keeps its proportions at any resolution.
 */

export type StudioLayerType = 'image' | 'text' | 'visualizer' | 'video' | 'group' | 'particles'
export type StudioFitMode = 'free' | 'contain' | 'cover'
export type StudioLayerRole = 'normal' | 'watermark'
export type StudioColorMode = 'rainbow' | 'solid' | 'gradient'

export interface StudioTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  /** Degrees. */
  rotation: number
  flipX: boolean
  flipY: boolean
}

export interface StudioLayerFilter {
  opacity: number
  brightness: number
  contrast: number
  saturation: number
  /** Degrees 0..360. */
  hue: number
  grayscale: number
  sepia: number
  /** Pixels. */
  blur: number
  tintColor: string
  tintOpacity: number
  borderRadius: number
  shadowBlur: number
  shadowColor: string
  shadowOffsetX: number
  shadowOffsetY: number
}

export interface StudioTimeRange {
  startSec: number
  /** Exclusive; Infinity = until the end. */
  endSec: number
  fadeInSec: number
  fadeOutSec: number
}

export interface StudioLayerBase {
  id: string
  name: string
  type: StudioLayerType
  visible: boolean
  locked: boolean
  transform: StudioTransform
  filter: StudioLayerFilter
  timeRange?: StudioTimeRange
  role: StudioLayerRole
  parentId?: string
}

export interface ImageLayer extends StudioLayerBase {
  type: 'image'
  src: string
  naturalWidth?: number
  naturalHeight?: number
  fitMode: StudioFitMode
  waveAroundEnabled?: boolean
  /** Scale the plate with the kick drum. */
  beatPulse: boolean
  beatIntensity: number
}

export interface VideoLayer extends StudioLayerBase {
  type: 'video'
  src: string
  naturalWidth?: number
  naturalHeight?: number
  fitMode: StudioFitMode
  muted: boolean
  loop: boolean
  volume: number
}

export interface TextLayer extends StudioLayerBase {
  type: 'text'
  text: string
  fontSize: number
  color: string
  fontFamily: string
  fontWeight: string
  italic: boolean
  strokeColor: string
  strokeWidth: number
  textShadowColor: string
  textShadowBlur: number
  textShadowOffsetX: number
  textShadowOffsetY: number
}

export interface VisualizerLayer extends StudioLayerBase {
  type: 'visualizer'
  waveStyle: string
  colorMode: StudioColorMode
  color1: string
  color2: string
  barCount: number
  barWidth: number
  speed: number
  opacity: number
  glowEnabled: boolean
  glowIntensity: number
  mirror: boolean
  sensitivity: number
}

export interface GroupLayer {
  id: string
  name: string
  type: 'group'
  children: string[]
}

export type StudioLayer = ImageLayer | VideoLayer | TextLayer | VisualizerLayer | ParticlesLayer
export type StudioAnyLayer = StudioLayer | GroupLayer

export const DEFAULT_TRANSFORM: StudioTransform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  flipX: false,
  flipY: false,
}

export const DEFAULT_FILTER: StudioLayerFilter = {
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

export const FONT_FAMILIES = [
  'system-ui, sans-serif',
  'Arial, sans-serif',
  'Georgia, serif',
  '"Times New Roman", serif',
  '"Courier New", monospace',
  'Impact, sans-serif',
  '"Comic Sans MS", cursive',
] as const

let layerCounter = 0

function nextId(prefix: string): string {
  layerCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${layerCounter}`
}

export function isGroupLayer(layer: StudioAnyLayer): layer is GroupLayer {
  return layer.type === 'group'
}

export function isVisualizerLayer(layer: StudioAnyLayer): layer is VisualizerLayer {
  return layer.type === 'visualizer'
}

export function isImageLayer(layer: StudioAnyLayer): layer is ImageLayer {
  return layer.type === 'image'
}

export function isVideoLayer(layer: StudioAnyLayer): layer is VideoLayer {
  return layer.type === 'video'
}

export function isTextLayer(layer: StudioAnyLayer): layer is TextLayer {
  return layer.type === 'text'
}

/** CSS filter string for canvas-2D drawing paths. */
/** True when the filter would visibly change pixels (identity filters are skipped). */
export function hasColorFilter(filter: StudioLayerFilter): boolean {
  return (
    Math.abs(filter.brightness - 1) > 0.001 ||
    Math.abs(filter.contrast - 1) > 0.001 ||
    Math.abs(filter.saturation - 1) > 0.001 ||
    filter.hue !== 0 ||
    filter.grayscale > 0.001 ||
    filter.sepia > 0.001 ||
    filter.blur > 0.01
  )
}

export function buildCssFilter(filter: StudioLayerFilter): string {
  const parts = [
    `brightness(${filter.brightness})`,
    `contrast(${filter.contrast})`,
    `saturate(${filter.saturation})`,
    `hue-rotate(${filter.hue}deg)`,
    `grayscale(${filter.grayscale})`,
    `sepia(${filter.sepia})`,
  ]
  if (filter.blur > 0) parts.push(`blur(${filter.blur}px)`)
  return parts.join(' ')
}

/** Fade-in/out multiplier for a layer at a given time. -1 means "not visible yet". */
export function getLayerTimeOpacity(layer: StudioAnyLayer, timeSec: number): number {
  if (!('timeRange' in layer) || !layer.timeRange) return 1
  const { startSec, endSec, fadeInSec, fadeOutSec } = layer.timeRange
  if (timeSec < startSec || timeSec >= endSec) return -1
  if (fadeInSec > 0 && timeSec < startSec + fadeInSec) {
    return Math.max(0, (timeSec - startSec) / fadeInSec)
  }
  if (fadeOutSec > 0 && timeSec > endSec - fadeOutSec) {
    return Math.max(0, (endSec - timeSec) / fadeOutSec)
  }
  return 1
}

function createBase(type: StudioLayerType, name: string): StudioLayerBase {
  return {
    id: nextId(type),
    name,
    type,
    visible: true,
    locked: false,
    transform: { ...DEFAULT_TRANSFORM },
    filter: { ...DEFAULT_FILTER },
    role: 'normal',
  }
}

export function createVisualizerLayer(name = 'Sóng nhạc'): VisualizerLayer {
  return {
    ...createBase('visualizer', name),
    type: 'visualizer',
    waveStyle: 'circlebars',
    colorMode: 'gradient',
    color1: '#00ccff',
    color2: '#ff0066',
    barCount: 128,
    barWidth: 1,
    speed: 1,
    opacity: 1,
    glowEnabled: true,
    glowIntensity: 0.5,
    mirror: false,
    sensitivity: 1,
  }
}

export function createImageLayer(src = '', name = 'Ảnh'): ImageLayer {
  return {
    ...createBase('image', name),
    type: 'image',
    src,
    fitMode: 'contain',
    waveAroundEnabled: false,
    beatPulse: true,
    beatIntensity: 0.8,
  }
}

export function createVideoLayer(src = '', name = 'Video'): VideoLayer {
  return {
    ...createBase('video', name),
    type: 'video',
    src,
    fitMode: 'contain',
    muted: true,
    loop: true,
    volume: 1,
  }
}

export function createTextLayer(text = 'Tên bài hát'): TextLayer {
  return {
    ...createBase('text', text.slice(0, 24) || 'Văn bản'),
    type: 'text',
    transform: { ...DEFAULT_TRANSFORM, y: 320 },
    text,
    fontSize: 72,
    color: '#ffffff',
    fontFamily: 'system-ui, sans-serif',
    fontWeight: '700',
    italic: false,
    strokeColor: '#000000',
    strokeWidth: 0,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowBlur: 0,
    textShadowOffsetX: 0,
    textShadowOffsetY: 2,
  }
}

export interface ParticlesLayer extends StudioLayerBase {
  type: 'particles'
  /** Dot / square / star drawn by the point sprite. */
  shape: 'dot' | 'square' | 'star'
  color: string
  /** Number of points. */
  amount: number
  sizeMin: number
  sizeMax: number
  opacityMin: number
  opacityMax: number
  /** Vertical drift per second (world units). */
  speed: number
  /** Horizontal spread of the field. */
  spread: number
  /** Pulls particles down; negative floats up. */
  gravity: number
  /** Extra size on the kick drum, 0 = none. */
  beatBoost: number
  mirror: boolean
}

export function createParticlesLayer(name = 'Hạt'): ParticlesLayer {
  return {
    ...createBase('particles', name),
    type: 'particles',
    shape: 'dot',
    color: '#a5f3fc',
    amount: 600,
    sizeMin: 0.6,
    sizeMax: 2.6,
    opacityMin: 0.35,
    opacityMax: 0.9,
    speed: 0.35,
    spread: 5.2,
    gravity: 0.02,
    beatBoost: 0.6,
    mirror: true,
  }
}

export function createGroupLayer(name = 'Group'): GroupLayer {
  return { id: nextId('grp'), name, type: 'group', children: [] }
}

export function createIntroLayer(durationSec = 5): ImageLayer {
  return {
    ...createImageLayer('', 'Intro'),
    name: 'Intro',
    timeRange: { startSec: 0, endSec: durationSec, fadeInSec: 0.5, fadeOutSec: 1 },
  }
}

export function createOutroLayer(totalSec: number, durationSec = 5): ImageLayer {
  const start = Math.max(0, totalSec - durationSec)
  return {
    ...createImageLayer('', 'Outro'),
    name: 'Outro',
    timeRange: { startSec: start, endSec: totalSec, fadeInSec: 1, fadeOutSec: 0.5 },
  }
}

export function createLogoLayer(src = ''): ImageLayer {
  const layer = createImageLayer(src, 'Logo')
  layer.role = 'watermark'
  layer.fitMode = 'free'
  layer.transform = { ...DEFAULT_TRANSFORM, scaleX: 0.25, scaleY: 0.25 }
  layer.filter = { ...DEFAULT_FILTER, opacity: 0.85 }
  return layer
}

/** Size of a fitted media plane, in px of the 1080-high reference stage. */
export function fitSize(
  mediaWidth: number,
  mediaHeight: number,
  stageWidth: number,
  stageHeight: number,
  fit: StudioFitMode,
): { width: number; height: number } {
  if (mediaWidth <= 0 || mediaHeight <= 0) return { width: stageWidth, height: stageHeight }
  if (fit === 'free') {
    // Native size, but never larger than the stage: a 4000px photo would otherwise
    // flood the whole frame the moment you switch to "Tự do".
    if (mediaWidth <= stageWidth && mediaHeight <= stageHeight) {
      return { width: mediaWidth, height: mediaHeight }
    }
    const scale = Math.min(stageWidth / mediaWidth, stageHeight / mediaHeight)
    return { width: mediaWidth * scale, height: mediaHeight * scale }
  }
  const scaleX = stageWidth / mediaWidth
  const scaleY = stageHeight / mediaHeight
  const scale = fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
  return { width: mediaWidth * scale, height: mediaHeight * scale }
}

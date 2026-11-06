export type StudioLayerType = 'visualizer' | 'image' | 'video' | 'text'

export interface StudioTransform {
  /** Offset in stage fractions (-0.5 .. 0.5 of the stage width/height). */
  x: number
  y: number
  scale: number
  /** Degrees. */
  rotation: number
  opacity: number
  flipX: boolean
  flipY: boolean
}

export interface StudioLayerBase {
  id: string
  name: string
  type: StudioLayerType
  visible: boolean
  locked: boolean
  transform: StudioTransform
}

export interface VisualizerLayer extends StudioLayerBase {
  type: 'visualizer'
}

export interface ImageLayer extends StudioLayerBase {
  type: 'image'
  url: string
  fit: 'cover' | 'contain'
}

export interface VideoLayer extends StudioLayerBase {
  type: 'video'
  url: string
  fit: 'cover' | 'contain'
  muted: boolean
  loop: boolean
}

export interface TextLayer extends StudioLayerBase {
  type: 'text'
  text: string
  fontSize: number
  fontFamily: string
  weight: number
  color: string
  strokeColor: string
  strokeWidth: number
  letterSpacing: number
}

export type StudioLayer = VisualizerLayer | ImageLayer | VideoLayer | TextLayer

export const DEFAULT_TRANSFORM: StudioTransform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  flipX: false,
  flipY: false,
}

let layerCounter = 0

function nextId(prefix: string): string {
  layerCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${layerCounter}`
}

export function createVisualizerLayer(): VisualizerLayer {
  return {
    id: nextId('viz'),
    name: 'Sóng nhạc',
    type: 'visualizer',
    visible: true,
    locked: false,
    transform: { ...DEFAULT_TRANSFORM },
  }
}

export function createImageLayer(url: string, name?: string): ImageLayer {
  return {
    id: nextId('img'),
    name: name || 'Ảnh nền',
    type: 'image',
    visible: true,
    locked: false,
    transform: { ...DEFAULT_TRANSFORM },
    url,
    fit: 'cover',
  }
}

export function createVideoLayer(url: string, name?: string): VideoLayer {
  return {
    id: nextId('vid'),
    name: name || 'Video nền',
    type: 'video',
    visible: true,
    locked: false,
    transform: { ...DEFAULT_TRANSFORM },
    url,
    fit: 'cover',
    muted: true,
    loop: true,
  }
}

export function createTextLayer(text = 'Tên bài hát'): TextLayer {
  return {
    id: nextId('txt'),
    name: text.slice(0, 24) || 'Văn bản',
    type: 'text',
    visible: true,
    locked: false,
    transform: { ...DEFAULT_TRANSFORM, y: 0.32, scale: 0.8 },
    text,
    fontSize: 72,
    fontFamily: 'Segoe UI, Roboto, sans-serif',
    weight: 700,
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 0,
    letterSpacing: 0,
  }
}

/**
 * Where a fitted media plane lands inside the stage, in stage units.
 * Returns the plane width/height so each layer can keep its aspect ratio.
 */
export function fitSize(
  mediaWidth: number,
  mediaHeight: number,
  stageWidth: number,
  stageHeight: number,
  fit: 'cover' | 'contain',
): { width: number; height: number } {
  if (mediaWidth <= 0 || mediaHeight <= 0) return { width: stageWidth, height: stageHeight }
  const scaleX = stageWidth / mediaWidth
  const scaleY = stageHeight / mediaHeight
  const scale = fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
  return { width: mediaWidth * scale, height: mediaHeight * scale }
}

/**
 * Phase 3 — Vẽ layers (image/text) lên 2D context.
 * Gọi từ renderOneFrame khi có layers; không FFT, không store.
 *
 * PERF-OPTIMIZED: zero shadowBlur, minimal gradient stops,
 * reduced segment counts, batched draws.
 *
 * V5: MODULAR WAVE SYSTEM — Wave styles tách ra folder waves/
 * Mỗi style 1 file, tự đăng ký qua registerWave().
 * drawLayers.ts chỉ còn logic vẽ layer + dispatcher.
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  WAVE REGISTRY IMPORT — tất cả wave styles tự đăng ký khi import
// ═══════════════════════════════════════════════════════════════════════════════
import {
  getWaveDrawFn,
  resetAllWaveState,
  setAnimTimeSec,
  updateSmoothedSpectrum,
  resetSmoothedSpectrum,
  getAllWaveMetas,
} from './waves'
import type {
  FrequencyBands as WaveFrequencyBands,
  VisualizerColorOptions as WaveVisualizerColorOptions,
} from './waves'

// Re-export for backward compatibility
export type FrequencyBands = WaveFrequencyBands
export type VisualizerColorOptions = WaveVisualizerColorOptions

// Re-export wave registry utilities for consumers
export { getAllWaveMetas, getWaveDrawFn, resetAllWaveState } from './waves'

export interface LayerFilter {
  opacity?: number
  brightness?: number
  contrast?: number
  saturation?: number
  hue?: number
  grayscale?: number
  sepia?: number
  blur?: number
  tintColor?: string
  tintOpacity?: number
  borderRadius?: number
  shadowBlur?: number
  shadowColor?: string
  shadowOffsetX?: number
  shadowOffsetY?: number
}

export interface DrawableLayer {
  type: 'image' | 'text' | 'visualizer' | 'video'
  visible: boolean
  src?: string
  text?: string
  fontSize?: number
  color?: string
  /** Text layer extras */
  fontFamily?: string
  fontWeight?: string
  italic?: boolean
  strokeColor?: string
  strokeWidth?: number
  textShadowColor?: string
  textShadowBlur?: number
  textShadowOffsetX?: number
  textShadowOffsetY?: number
  fitMode?: 'free' | 'contain' | 'cover'
  waveAroundEnabled?: boolean
  waveStyle?: WaveStyleId
  /** Video-only: mute/volume */
  muted?: boolean
  volume?: number
  /** Visualizer props */
  opacity?: number
  sensitivity?: number
  colorMode?: 'rainbow' | 'solid' | 'gradient'
  color1?: string
  color2?: string
  glowEnabled?: boolean
  glowIntensity?: number
  mirror?: boolean
  /** barCount for bars / circlebars styles */
  barCount?: number
  /** barWidth for bars (pixel width of each bar) */
  barWidth?: number
  /** Animation speed multiplier (0–3) */
  speed?: number
  /** Hiệu ứng filter cho image/video/text */
  filter?: LayerFilter
  transform?: {
    x: number
    y: number
    scaleX: number
    scaleY: number
    rotation: number
    flipX?: boolean
    flipY?: boolean
  }
  /** Khoảng thời gian hiển thị (giây). undefined = luôn hiện. */
  timeRange?: { startSec: number; endSec: number; fadeInSec?: number; fadeOutSec?: number }
  /** Role đặc biệt. 'watermark' = luôn vẽ trên cùng. */
  role?: 'normal' | 'watermark'
}

/** Tạo CSS filter string từ LayerFilter */
function buildCssFilter(f: LayerFilter | undefined): string {
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
 * Tính opacity factor cho layer tại thời điểm timeSec.
 * Returns -1 nếu hoàn toàn ẩn (ngoài timeRange).
 * Returns 0..1 nếu trong range (hỗ trợ fade).
 */
function getTimeOpacity(layer: DrawableLayer, timeSec: number | undefined): number {
  if (timeSec == null) return 1
  const tr = layer.timeRange
  if (!tr) return 1
  const { startSec, endSec, fadeInSec = 0, fadeOutSec = 0 } = tr
  if (timeSec < startSec || timeSec >= endSec) return -1
  if (fadeInSec > 0 && timeSec < startSec + fadeInSec) {
    return (timeSec - startSec) / fadeInSec
  }
  if (fadeOutSec > 0 && timeSec >= endSec - fadeOutSec) {
    return (endSec - timeSec) / fadeOutSec
  }
  return 1
}

const DEFAULT_TRANSFORM = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }

/**
 * WaveStyleId — union type tự động từ registry.
 * Giữ string literal union cho backward compat + type safety.
 * Khi thêm wave mới: thêm ID vào union này.
 */
export type WaveStyleId = 'bars' | 'line' | 'ring' | 'dots' | 'waveform' | 'circlebars' | 'plasma' | 'lightning' | 'galaxy' | 'fire' | 'neonbars' | 'crystalring' | 'nebula' | 'waterripple' | 'particles' | 'musicnotes' | 'beatbars' | 'helix' | 'aurora' | 'heartbeat' | 'starburst' | 'matrix' | 'spectrum3d' | 'oscilloscope' | 'vinyl'

export interface WaveOptions {
  amplitude: number
  samples: number[]          // time-domain waveform (32 vals, 0–255)
  style?: WaveStyleId
  /** Sub-sampled frequency spectrum for colour mapping (64 vals, 0–255) */
  spectrum?: number[]
  /** Pre-computed band energies */
  bands?: FrequencyBands
  /** Current beat level 0–1 (for glow effects) */
  beat?: number
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESET STATE — backward compatibility
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Reset module-level animation state.
 * Call when switching tracks or destroying the runtime to avoid
 * "ghost" wave animation from the previous session bleeding into the new one.
 */
export function resetDrawLayersState(): void {
  resetAllWaveState()
  resetSmoothedSpectrum()
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WAVE DISPATCHER — Sử dụng registry thay vì switch/case
// ═══════════════════════════════════════════════════════════════════════════════

function drawWaveAroundRect(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  opts: WaveOptions,
  style: WaveStyleId,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  const { amplitude, samples, spectrum, bands } = opts
  if (samples.length < 4) return

  // Update persistent smoothed spectrum once per frame before any style reads it
  if (spectrum && spectrum.length > 0) {
    updateSmoothedSpectrum(spectrum)
  }

  // Lookup draw function from registry
  const drawFn = getWaveDrawFn(style)
  if (drawFn) {
    drawFn(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat)
  } else {
    // Fallback to 'bars' if style not found in registry
    const barsFn = getWaveDrawFn('bars')
    if (barsFn) {
      barsFn(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat)
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  IMAGE / VIDEO CACHE
// ═══════════════════════════════════════════════════════════════════════════════

const imageCache = new Map<string, HTMLImageElement>()

function getOrCreateImage(src: string): HTMLImageElement | null {
  let img = imageCache.get(src)
  if (img) return img.complete ? img : null
  img = new Image()
  img.crossOrigin = 'anonymous'
  imageCache.set(src, img)
  img.src = src
  return img.complete ? img : null
}

/** Xoá cache ảnh khi layer bị xoá — tránh leak bộ nhớ */
export function evictImageCache(src: string): void {
  imageCache.delete(src)
}

// ─── VIDEO CACHE ─────────────────────────────────────────────────────────────
const videoCache = new Map<string, HTMLVideoElement>()

function getOrCreateVideo(src: string, muted = true, volume = 1): HTMLVideoElement | null {
  let vid = videoCache.get(src)
  if (vid) {
    // Update muted/volume in case layer settings changed
    vid.muted = muted
    if (!muted) vid.volume = Math.max(0, Math.min(1, volume))
    return vid.readyState >= 2 ? vid : null // HAVE_CURRENT_DATA
  }
  vid = document.createElement('video')
  // crossOrigin chỉ cần cho remote URL (http/https), không dùng cho blob: URL
  if (!src.startsWith('blob:') && !src.startsWith('data:')) {
    vid.crossOrigin = 'anonymous'
  }
  vid.loop = true
  vid.muted = muted // respect layer setting (must be muted to autoplay when muted=true)
  if (!muted) vid.volume = Math.max(0, Math.min(1, volume))
  vid.playsInline = true
  vid.preload = 'auto'
  videoCache.set(src, vid)
  vid.src = src
  vid.load()
  vid.play().catch(() => {})
  return vid.readyState >= 2 ? vid : null
}

/** Xoá cache video khi layer bị xoá — giải phóng media resource */
export function evictVideoCache(src: string): void {
  const vid = videoCache.get(src)
  if (vid) {
    vid.pause()
    vid.src = ''
    vid.load()
  }
  videoCache.delete(src)
}

/** Clear ALL image and video caches — call when destroying runtime or switching sessions. */
export function clearAllMediaCaches(): void {
  imageCache.clear()
  for (const [, vid] of videoCache) {
    vid.pause()
    vid.src = ''
    vid.load()
  }
  videoCache.clear()
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BEAT GLOW — NO shadowBlur, wider strokes for glow
// ═══════════════════════════════════════════════════════════════════════════════

// Import prismRGBA for beat glow edge rendering
import { prismRGBA, animTimeMs } from './waves/helpers'

function drawBeatGlowEdge(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  beat: number
): void {
  if (beat < 0.03) return
  const halfW = w / 2, halfH = h / 2
  const size = Math.max(w, h)
  const shift = (animTimeMs() * 0.0003) % 1

  ctx.save()

  // Pass 1: Wide soft glow (replaces shadowBlur)
  ctx.lineWidth = size * 0.02
  ctx.strokeStyle = prismRGBA(shift, 0.35 * beat)
  ctx.strokeRect(-halfW, -halfH, w, h)

  // Pass 2: Medium PRISM edge
  ctx.lineWidth = size * 0.006
  ctx.strokeStyle = prismRGBA(shift, 0.7 * beat)
  ctx.strokeRect(-halfW, -halfH, w, h)

  // Pass 3: Sharp white core
  ctx.lineWidth = size * 0.0015
  ctx.strokeStyle = `rgba(255,255,255,${0.7 * Math.min(1, beat * 2)})`
  ctx.strokeRect(-halfW, -halfH, w, h)

  // Inner radial glow fill (on strong beat)
  if (beat > 0.2) {
    const fillAlpha = (beat - 0.2) * 0.25
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(halfW, halfH))
    grad.addColorStop(0, prismRGBA(shift, fillAlpha))
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fillRect(-halfW, -halfH, w, h)
  }

  ctx.restore()
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN DRAW FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export function drawLayers(
  ctx: CanvasRenderingContext2D,
  layers: DrawableLayer[],
  width: number,
  height: number,
  waveOptions?: WaveOptions,
  beat?: number,
  timeSec?: number
): void {
  // Set module-level animation clock — all wave functions read this
  // instead of Date.now(), ensuring export produces deterministic timing.
  // Preview passes performance.now()/1000; export passes startSec + frameIndex/fps.
  setAnimTimeSec(timeSec ?? (performance.now() / 1000))

  const cx = width / 2
  const cy = height / 2

  // Split: normal layers draw in order, watermark layers draw last (always on top)
  const normalLayers = layers.filter((l) => l.role !== 'watermark')
  const watermarkLayers = layers.filter((l) => l.role === 'watermark')

  function drawLayer(layer: DrawableLayer): void {
    if (!layer.visible) return

    // Time-range check: skip or fade
    const timeOpacity = getTimeOpacity(layer, timeSec)
    if (timeOpacity < 0) return // ngoài timeRange → ẩn hoàn toàn

    const t = layer.transform ?? DEFAULT_TRANSFORM
    const f = layer.filter
    ctx.save()
    ctx.translate(cx, cy)
    ctx.translate(t.x, t.y)
    ctx.rotate((t.rotation * Math.PI) / 180)
    ctx.scale(
      t.scaleX * (t.flipX ? -1 : 1),
      t.scaleY * (t.flipY ? -1 : 1)
    )

    // Base opacity: time-fade × filter.opacity
    const baseOpacity = timeOpacity * (f?.opacity ?? 1)
    // Global opacity (for image/video/text layers)
    if (baseOpacity !== 1 && layer.type !== 'visualizer') {
      ctx.globalAlpha = Math.max(0, Math.min(1, baseOpacity))
    }

    // CSS filter (brightness/contrast/blur/hue/grayscale/sepia/saturation)
    const cssFilter = buildCssFilter(f)
    if (cssFilter && layer.type !== 'visualizer') {
      ctx.filter = cssFilter
    }

    if (layer.type === 'image' && layer.src) {
      const img = getOrCreateImage(layer.src)
      if (img && img.naturalWidth > 0) {
        const w = img.naturalWidth
        const h = img.naturalHeight
        let fitScale = 1
        const mode = layer.fitMode ?? 'free'
        if (mode === 'contain' || mode === 'cover') {
          const safeW = width * 0.8
          const safeH = height * 0.8
          const scaleContain = Math.min(safeW / w, safeH / h)
          const scaleCover = Math.max(safeW / w, safeH / h)
          const uniform = mode === 'contain' ? scaleContain : scaleCover
          if (Number.isFinite(uniform) && uniform > 0) fitScale = uniform
        }
        ctx.scale(fitScale, fitScale)

        // Drop shadow
        if (f?.shadowBlur && f.shadowBlur > 0) {
          ctx.shadowBlur = f.shadowBlur
          ctx.shadowColor = f.shadowColor ?? 'rgba(0,0,0,0.5)'
          ctx.shadowOffsetX = f.shadowOffsetX ?? 0
          ctx.shadowOffsetY = f.shadowOffsetY ?? 0
        }

        // Border radius clip (coordinates are pre-fitScale since ctx.scale already applied)
        const br = f?.borderRadius ?? 0
        if (br > 0) {
          const r = Math.min(br, w / 2, h / 2)
          ctx.beginPath()
          ctx.roundRect(-w / 2, -h / 2, w, h, r)
          ctx.clip()
        }

        ctx.drawImage(img, -w / 2, -h / 2, w, h)

        // Reset shadow before tint/glow (avoid double shadow)
        ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0

        // Tint overlay
        if (f?.tintColor && f.tintOpacity && f.tintOpacity > 0) {
          ctx.globalAlpha = Math.max(0, Math.min(1, baseOpacity * f.tintOpacity))
          ctx.fillStyle = f.tintColor
          ctx.fillRect(-w / 2, -h / 2, w, h)
          ctx.globalAlpha = Math.max(0, Math.min(1, baseOpacity))
        }

        // Reset filter before glow/wave (những hiệu ứng này không cần filter)
        ctx.filter = 'none'

        if (beat && beat > 0.03) {
          drawBeatGlowEdge(ctx, w, h, beat)
        }
        if (layer.waveAroundEnabled && waveOptions && waveOptions.amplitude > 0 && waveOptions.samples.length >= 4) {
          drawWaveAroundRect(ctx, w, h, waveOptions, waveOptions.style ?? 'line', undefined, beat)
        }
      } else {
        ctx.fillStyle = 'rgba(80,80,120,0.6)'
        ctx.fillRect(-60, -40, 120, 80)
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.font = '12px system-ui'
        ctx.textAlign = 'center'
        ctx.fillText('Image', 0, 4)
      }
    } else if (layer.type === 'video' && layer.src) {
      const vid = getOrCreateVideo(layer.src, layer.muted !== false, layer.volume ?? 1)
      if (vid && vid.readyState >= 2 && vid.videoWidth > 0) {
        const w = vid.videoWidth
        const h = vid.videoHeight
        let fitScale = 1
        const mode = layer.fitMode ?? 'free'
        if (mode === 'contain' || mode === 'cover') {
          const safeW = width * 0.8
          const safeH = height * 0.8
          const scaleContain = Math.min(safeW / w, safeH / h)
          const scaleCover = Math.max(safeW / w, safeH / h)
          const uniform = mode === 'contain' ? scaleContain : scaleCover
          if (Number.isFinite(uniform) && uniform > 0) fitScale = uniform
        }
        ctx.scale(fitScale, fitScale)

        if (f?.shadowBlur && f.shadowBlur > 0) {
          ctx.shadowBlur = f.shadowBlur
          ctx.shadowColor = f.shadowColor ?? 'rgba(0,0,0,0.5)'
          ctx.shadowOffsetX = f.shadowOffsetX ?? 0
          ctx.shadowOffsetY = f.shadowOffsetY ?? 0
        }

        const br = f?.borderRadius ?? 0
        if (br > 0) {
          const r = Math.min(br, w / 2, h / 2)
          ctx.beginPath()
          ctx.roundRect(-w / 2, -h / 2, w, h, r)
          ctx.clip()
        }

        ctx.drawImage(vid, -w / 2, -h / 2, w, h)

        ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0

        if (f?.tintColor && f.tintOpacity && f.tintOpacity > 0) {
          ctx.globalAlpha = Math.max(0, Math.min(1, baseOpacity * f.tintOpacity))
          ctx.fillStyle = f.tintColor
          ctx.fillRect(-w / 2, -h / 2, w, h)
          ctx.globalAlpha = Math.max(0, Math.min(1, baseOpacity))
        }

        // Reset filter after video draw
        ctx.filter = 'none'
      } else {
        ctx.fillStyle = 'rgba(20,20,50,0.7)'
        ctx.fillRect(-80, -45, 160, 90)
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.font = '11px system-ui'
        ctx.textAlign = 'center'
        ctx.fillText('Đang tải video...', 0, 4)
      }
    } else if (layer.type === 'text') {
      const text = layer.text ?? 'New Text'
      const fontSize = layer.fontSize ?? 24
      const color = layer.color ?? '#ffffff'
      const family = layer.fontFamily ?? 'system-ui, sans-serif'
      const weight = layer.fontWeight ?? 'normal'
      const style = layer.italic ? 'italic ' : ''
      ctx.font = `${style}${weight} ${fontSize}px ${family}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // Text shadow
      if (f?.shadowBlur && f.shadowBlur > 0) {
        ctx.shadowBlur = f.shadowBlur
        ctx.shadowColor = f.shadowColor ?? 'rgba(0,0,0,0.5)'
        ctx.shadowOffsetX = f.shadowOffsetX ?? 0
        ctx.shadowOffsetY = f.shadowOffsetY ?? 0
      } else if (layer.textShadowBlur && layer.textShadowBlur > 0) {
        ctx.shadowBlur = layer.textShadowBlur
        ctx.shadowColor = layer.textShadowColor ?? 'rgba(0,0,0,0.6)'
        ctx.shadowOffsetX = layer.textShadowOffsetX ?? 0
        ctx.shadowOffsetY = layer.textShadowOffsetY ?? 2
      }

      // Stroke (outline) — draw stroke first (behind fill)
      if (layer.strokeColor && layer.strokeWidth && layer.strokeWidth > 0) {
        ctx.lineWidth = layer.strokeWidth
        ctx.strokeStyle = layer.strokeColor
        ctx.lineJoin = 'round'
        ctx.strokeText(text, 0, 0)
      }

      // Fill text — shadow still active (applies to fill too)
      ctx.fillStyle = color
      ctx.fillText(text, 0, 0)
      // Reset shadow AFTER fillText so both stroke and fill get shadow
      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
      // Reset filter so it doesn't bleed into subsequent layers
      ctx.filter = 'none'
    } else if (layer.type === 'visualizer') {
      // Standalone visualizer layer — vẽ sóng nhạc trực tiếp (không cần ảnh)
      if (waveOptions && waveOptions.amplitude > 0 && waveOptions.samples.length >= 4) {
        const baseSize = Math.min(width, height) * 0.55
        const vw = baseSize
        const vh = baseSize

        // Per-layer opacity: time-fade × layer opacity
        const layerOpacity = timeOpacity * (layer.opacity ?? 1)
        if (layerOpacity < 1) {
          ctx.globalAlpha = Math.max(0, Math.min(1, layerOpacity))
        }

        // Per-layer sensitivity — nhân amplitude
        const sensitivity = layer.sensitivity ?? 1
        const modWaveOptions: WaveOptions = sensitivity !== 1
          ? { ...waveOptions, amplitude: waveOptions.amplitude * sensitivity }
          : waveOptions

        // Build VisualizerColorOptions from layer props
        const layerVc: VisualizerColorOptions = {
          colorMode: layer.colorMode,
          color1: layer.color1,
          color2: layer.color2,
          glowEnabled: layer.glowEnabled,
          glowIntensity: layer.glowIntensity,
          speed: layer.speed,
          barCount: layer.barCount,
          barWidth: layer.barWidth,
        }

        // Mirror: flip horizontally around center — draw normal side first, then mirrored
        const mirrorEnabled = layer.mirror === true
        // Draw normal (unmirrored) side
        drawWaveAroundRect(ctx, vw, vh, modWaveOptions, layer.waveStyle ?? 'circlebars', layerVc, beat)

        if (mirrorEnabled) {
          // Draw mirrored side (flipped horizontally)
          ctx.save()
          ctx.scale(-1, 1)
          drawWaveAroundRect(ctx, vw, vh, modWaveOptions, layer.waveStyle ?? 'circlebars', layerVc, beat)
          ctx.restore()
        }

        if (layerOpacity < 1) {
          ctx.globalAlpha = 1
        }
      }
    }

    ctx.restore()
  }

  // Draw normal layers in order, then watermark layers on top
  for (const layer of normalLayers) drawLayer(layer)
  for (const layer of watermarkLayers) drawLayer(layer)
}

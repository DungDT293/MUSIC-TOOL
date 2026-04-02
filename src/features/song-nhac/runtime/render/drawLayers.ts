/**
 * Phase 3 — Vẽ layers (image/text) lên 2D context.
 * Gọi từ renderOneFrame khi có layers; không FFT, không store.
 *
 * PERF-OPTIMIZED: zero shadowBlur, minimal gradient stops,
 * reduced segment counts, batched draws.
 */

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

export type WaveStyleId = 'bars' | 'line' | 'ring' | 'dots' | 'waveform' | 'circlebars' | 'plasma' | 'lightning' | 'galaxy' | 'fire' | 'neonbars' | 'crystalring' | 'nebula'

export interface FrequencyBands {
  bass: number   // 0–1 normalised energy
  mid: number
  treble: number
}

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

/** Per-visualizer-layer colour / animation options */
export interface VisualizerColorOptions {
  colorMode?: 'rainbow' | 'solid' | 'gradient'
  /** Primary color (hex/css) used for solid mode */
  color1?: string
  /** Secondary color (hex/css) used for gradient mode */
  color2?: string
  /** Glow enabled */
  glowEnabled?: boolean
  /** Glow intensity 0–3 */
  glowIntensity?: number
  /** Animation speed multiplier (0–3, 1 = normal) */
  speed?: number
  /** Number of bars for bars / circlebars styles */
  barCount?: number
}

const WAVE_SEGMENTS = 64

function getMaxOffset(w: number, h: number): number {
  return Math.max(w, h) * 0.22
}

function getSampleAt(samples: number[], i: number): number {
  const n = samples.length
  if (n === 0) return 0.5
  const idx = (j: number) => ((Math.floor((j / WAVE_SEGMENTS) * n) % n) + n) % n
  const v = (j: number) => (samples[idx(j)] ?? 128) / 255
  const a = v(i - 1) * 0.25
  const c = v(i) * 0.5
  const e = v(i + 1) * 0.25
  return Math.max(0, Math.min(1, a + c + e))
}

// ─── Persistent temporal smoothing for wave-around spectrum ─────────────────
let smoothedWaveSpectrum: Float32Array | null = null
const SMOOTH_ATTACK = 0.3
const SMOOTH_DECAY  = 0.08

/**
 * Reset module-level animation state.
 * Call when switching tracks or destroying the runtime to avoid
 * "ghost" wave animation from the previous session bleeding into the new one.
 */
export function resetDrawLayersState(): void {
  smoothedWaveSpectrum = null
}

/**
 * Update the module-level smoothed spectrum buffer with asymmetric
 * attack / decay so that rising energy responds quickly while falling
 * energy fades out gradually — eliminates per-frame jitter.
 */
function updateSmoothedSpectrum(spectrum: number[]): void {
  const n = spectrum.length
  if (!smoothedWaveSpectrum || smoothedWaveSpectrum.length !== n) {
    smoothedWaveSpectrum = new Float32Array(n)
    for (let i = 0; i < n; i++) smoothedWaveSpectrum[i] = spectrum[i]! / 255
    return
  }
  for (let i = 0; i < n; i++) {
    const raw = spectrum[i]! / 255
    const prev = smoothedWaveSpectrum[i]!
    const alpha = raw > prev ? SMOOTH_ATTACK : SMOOTH_DECAY
    smoothedWaveSpectrum[i] = prev + alpha * (raw - prev)
  }
}

function getSpectrumAt(spectrum: number[], i: number, totalSegments: number): number {
  if (!spectrum || spectrum.length === 0) return 0
  const n = spectrum.length

  // Logarithmic frequency mapping: bass frequencies get more visual bins
  const logMin = Math.log10(20)
  const logMax = Math.log10(20000)
  const logFreq = logMin + (i / totalSegments) * (logMax - logMin)
  const bin = Math.min(Math.round(Math.pow(10, logFreq) / 10000 * n), n - 1)

  // Read from smoothed buffer when available, otherwise fall back to raw
  const src = smoothedWaveSpectrum && smoothedWaveSpectrum.length === n
    ? smoothedWaveSpectrum
    : null
  const prev = src ? src[Math.max(0, bin - 1)]! : (spectrum[Math.max(0, bin - 1)] ?? 0) / 255
  const curr = src ? src[bin]!                  : (spectrum[bin] ?? 0) / 255
  const next = src ? src[Math.min(n - 1, bin + 1)]! : (spectrum[Math.min(n - 1, bin + 1)] ?? 0) / 255
  return prev * 0.25 + curr * 0.5 + next * 0.25
}

// ─── PRISM palette (audioMotion-analyzer inspired) ──────────────────────────

const PRISM_RGB: readonly (readonly [number, number, number])[] = [
  [170, 51, 85],   // deep rose
  [204, 102, 102], // coral
  [238, 153, 68],  // orange
  [238, 221, 0],   // gold
  [153, 221, 85],  // lime
  [68, 221, 136],  // emerald
  [34, 204, 187],  // teal
  [0, 187, 204],   // cyan
  [0, 153, 204],   // azure
  [51, 102, 187],  // blue
]

function prismRGBA(t: number, alpha: number): string {
  const ct = ((t % 1) + 1) % 1
  const s = ct * (PRISM_RGB.length - 1)
  const i = Math.floor(s)
  const f = s - i
  const a = PRISM_RGB[Math.min(i, PRISM_RGB.length - 1)]!
  const b = PRISM_RGB[Math.min(i + 1, PRISM_RGB.length - 1)]!
  return `rgba(${a[0] + (b[0] - a[0]) * f | 0},${a[1] + (b[1] - a[1]) * f | 0},${a[2] + (b[2] - a[2]) * f | 0},${alpha})`
}

/** Linear gradient w/ PRISM — 5 stops (not 11) */
function prismLinearGrad(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  shift: number, alpha: number
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  g.addColorStop(0,    prismRGBA(shift, alpha))
  g.addColorStop(0.25, prismRGBA((shift + 0.25) % 1, alpha))
  g.addColorStop(0.5,  prismRGBA((shift + 0.5) % 1, alpha))
  g.addColorStop(0.75, prismRGBA((shift + 0.75) % 1, alpha))
  g.addColorStop(1,    prismRGBA((shift + 1) % 1, alpha))
  return g
}

/** Conic gradient w/ PRISM — 5 stops (not 11) */
function prismConicGrad(
  ctx: CanvasRenderingContext2D, shift: number, alpha: number
): CanvasGradient {
  const g = ctx.createConicGradient(-Math.PI / 2, 0, 0)
  g.addColorStop(0,    prismRGBA(shift, alpha))
  g.addColorStop(0.25, prismRGBA((shift + 0.25) % 1, alpha))
  g.addColorStop(0.5,  prismRGBA((shift + 0.5) % 1, alpha))
  g.addColorStop(0.75, prismRGBA((shift + 0.75) % 1, alpha))
  g.addColorStop(1,    prismRGBA((shift + 1) % 1, alpha))
  return g
}

// ─── Color helpers for VisualizerColorOptions ────────────────────────────────

/** Parse hex/css color to [r,g,b]. Falls back to [0,0,0] for unsupported formats. */
function hexToRgb(hex: string): [number, number, number] {
  // Strip leading whitespace, handle named colors / non-hex strings gracefully
  const trimmed = (hex ?? '').trim()
  if (!trimmed.startsWith('#')) {
    // Try to parse rgba/rgb strings: rgba(r,g,b,...) or rgb(r,g,b)
    const m = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
    if (m) return [parseInt(m[1]!), parseInt(m[2]!), parseInt(m[3]!)]
    return [0, 0, 0] // named colors, hsl, etc — fallback
  }
  const s = trimmed.replace('#', '')
  if (s.length === 3) {
    return [
      parseInt(s[0]! + s[0]!, 16),
      parseInt(s[1]! + s[1]!, 16),
      parseInt(s[2]! + s[2]!, 16),
    ]
  }
  return [
    parseInt(s.slice(0, 2), 16) || 0,
    parseInt(s.slice(2, 4), 16) || 0,
    parseInt(s.slice(4, 6), 16) || 0,
  ]
}

/** Get rgba string based on colorMode/color1/color2 (t: 0–1, alpha: 0–1) */
function resolveColorRgba(
  t: number,
  alpha: number,
  vc: VisualizerColorOptions | undefined
): string {
  if (!vc || !vc.colorMode || vc.colorMode === 'rainbow') {
    return prismRGBA(t, alpha)
  }
  if (vc.colorMode === 'solid') {
    const [r, g, b] = hexToRgb(vc.color1 ?? '#4d9fff')
    return `rgba(${r},${g},${b},${alpha})`
  }
  // gradient: lerp between color1 and color2
  const c1 = hexToRgb(vc.color1 ?? '#4d9fff')
  const c2 = hexToRgb(vc.color2 ?? '#ff4d9f')
  const ct = ((t % 1) + 1) % 1
  return `rgba(${c1[0] + (c2[0] - c1[0]) * ct | 0},${c1[1] + (c2[1] - c1[1]) * ct | 0},${c1[2] + (c2[2] - c1[2]) * ct | 0},${alpha})`
}

function resolveLinearGrad(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  shift: number, alpha: number,
  vc: VisualizerColorOptions | undefined
): CanvasGradient {
  if (!vc || !vc.colorMode || vc.colorMode === 'rainbow') {
    return prismLinearGrad(ctx, x0, y0, x1, y1, shift, alpha)
  }
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  g.addColorStop(0,   resolveColorRgba(shift,              alpha, vc))
  g.addColorStop(0.5, resolveColorRgba((shift + 0.5) % 1, alpha, vc))
  g.addColorStop(1,   resolveColorRgba((shift + 1) % 1,   alpha, vc))
  return g
}

function resolveConicGrad(
  ctx: CanvasRenderingContext2D,
  shift: number, alpha: number,
  vc: VisualizerColorOptions | undefined
): CanvasGradient {
  if (!vc || !vc.colorMode || vc.colorMode === 'rainbow') {
    return prismConicGrad(ctx, shift, alpha)
  }
  const g = ctx.createConicGradient(-Math.PI / 2, 0, 0)
  g.addColorStop(0,    resolveColorRgba(shift,              alpha, vc))
  g.addColorStop(0.25, resolveColorRgba((shift + 0.25) % 1, alpha, vc))
  g.addColorStop(0.5,  resolveColorRgba((shift + 0.5) % 1, alpha, vc))
  g.addColorStop(0.75, resolveColorRgba((shift + 0.75) % 1, alpha, vc))
  g.addColorStop(1,    resolveColorRgba((shift + 1) % 1,   alpha, vc))
  return g
}

/** Apply glow effect via ctx.shadowBlur if glowEnabled */
function applyGlow(ctx: CanvasRenderingContext2D, shift: number, vc: VisualizerColorOptions | undefined, beat: number): void {
  if (!vc?.glowEnabled) return
  const intensity = Math.min(vc.glowIntensity ?? 1, 3)
  ctx.shadowBlur = 12 * intensity * (0.6 + beat * 0.4)
  ctx.shadowColor = resolveColorRgba(shift, 0.8, vc)
}

function clearGlow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowBlur = 0
  ctx.shadowColor = 'transparent'
}

/** Speed-adjusted shift value */
function speedShift(base: number, speed: number | undefined): number {
  if (speed === undefined || speed === 1) return base
  return base * speed
}

/** Bezier path (Catmull-Rom spline) */
function smoothPath(ctx: CanvasRenderingContext2D, pts: [number, number][], closed = true): void {
  if (pts.length < 3) {
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
    if (closed) ctx.closePath()
    return
  }
  const n = pts.length
  ctx.moveTo(pts[0]![0], pts[0]![1])
  // For closed paths loop i=0..n-1; for open paths loop i=0..n-2 (no wrap-around at ends)
  const limit = closed ? n : n - 1
  for (let i = 0; i < limit; i++) {
    const p0 = pts[(i - 1 + n) % n]!
    const p1 = pts[i]!
    const p2 = pts[(i + 1) % n]!
    const p3 = pts[(i + 2) % n]!
    // For open paths: clamp boundary control points instead of wrapping
    const pp0 = closed ? p0 : (i === 0 ? p1 : p0)
    const pp3 = closed ? p3 : (i === n - 2 ? p2 : p3)
    const tension = 0.35
    const cp1x = p1[0] + (p2[0] - pp0[0]) * tension
    const cp1y = p1[1] + (p2[1] - pp0[1]) * tension
    const cp2x = p2[0] - (pp3[0] - p1[0]) * tension
    const cp2y = p2[1] - (pp3[1] - p1[1]) * tension
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1])
  }
  if (closed) ctx.closePath()
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WAVE STYLES — ZERO shadowBlur, max 2 passes, batched draws
// ═══════════════════════════════════════════════════════════════════════════════

// ─── BARS ───────────────────────────────────────────────────────────────────

function drawWaveBars(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  if (samples.length < 4) return
  const halfW = w / 2, halfH = h / 2
  const size = Math.max(w, h)
  const maxOffset = getMaxOffset(w, h) * amplitude
  const barsPerEdge = Math.max(8, Math.min(60, Math.round((vc?.barCount ?? 112) / 4)))
  const totalBars = barsPerEdge * 4
  const shift = speedShift((Date.now() * 0.00012) % 1, vc?.speed)

  const edgeG: [number, number, number, number][] = [
    [-halfW, -halfH, halfW, -halfH],
    [halfW, -halfH, halfW, halfH],
    [halfW, halfH, -halfW, halfH],
    [-halfW, halfH, -halfW, -halfH],
  ]

  ctx.save()
  ctx.lineCap = 'round'

  for (let edge = 0; edge < 4; edge++) {
    const isHoriz = edge === 0 || edge === 2
    const edgeLen = isHoriz ? w : h
    const spacing = edgeLen / (barsPerEdge + 1)
    const barW = Math.max(size * 0.003, spacing * 0.45)
    const [gx0, gy0, gx1, gy1] = edgeG[edge]!
    const eShift = (shift + edge * 0.25) % 1

    const barData: { pos: number; t: number; len: number }[] = []
    for (let j = 0; j < barsPerEdge; j++) {
      const mj = j < barsPerEdge / 2 ? j : barsPerEdge - 1 - j
      const gi = edge * barsPerEdge + mj
      const raw = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, gi, totalBars)
        : getSampleAt(samples, Math.floor(gi * WAVE_SEGMENTS / totalBars))
      const t = Math.pow(raw, 1.3)
      barData.push({ pos: (j + 1) * spacing, t, len: Math.max(size * 0.005, t * maxOffset) })
    }

    // Pass 1: Wide soft glow
    ctx.lineWidth = barW * 2.2
    ctx.strokeStyle = resolveLinearGrad(ctx, gx0, gy0, gx1, gy1, eShift, 0.25, vc)
    if (vc?.glowEnabled) applyGlow(ctx, eShift, vc, beat ?? 0)
    ctx.beginPath()
    for (const { pos, t, len } of barData) {
      if (t < 0.04) continue
      let sx: number, sy: number, ex: number, ey: number
      if (edge === 0) { sx = -halfW + pos; sy = -halfH; ex = sx; ey = sy - len }
      else if (edge === 1) { sx = halfW; sy = -halfH + pos; ex = sx + len; ey = sy }
      else if (edge === 2) { sx = -halfW + pos; sy = halfH; ex = sx; ey = sy + len }
      else { sx = -halfW; sy = -halfH + pos; ex = sx - len; ey = sy }
      ctx.moveTo(sx, sy)
      ctx.lineTo(ex, ey)
    }
    ctx.stroke()
    if (vc?.glowEnabled) clearGlow(ctx)

    // Pass 2: Sharp bars
    ctx.lineWidth = barW
    ctx.strokeStyle = resolveLinearGrad(ctx, gx0, gy0, gx1, gy1, eShift, 0.92, vc)
    ctx.beginPath()
    for (const { pos, t, len } of barData) {
      if (t < 0.02) continue
      let sx: number, sy: number, ex: number, ey: number
      if (edge === 0) { sx = -halfW + pos; sy = -halfH; ex = sx; ey = sy - len }
      else if (edge === 1) { sx = halfW; sy = -halfH + pos; ex = sx + len; ey = sy }
      else if (edge === 2) { sx = -halfW + pos; sy = halfH; ex = sx; ey = sy + len }
      else { sx = -halfW; sy = -halfH + pos; ex = sx - len; ey = sy }
      ctx.moveTo(sx, sy)
      ctx.lineTo(ex, ey)
    }
    ctx.stroke()
  }

  ctx.restore()
}

// ─── CIRCLEBARS ─────────────────────────────────────────────────────────────

function drawWaveCircleBars(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  if (samples.length < 4) return
  const size = Math.max(w, h)
  const radius = Math.sqrt(w * w + h * h) / 2 + size * 0.005
  const maxBarLen = getMaxOffset(w, h) * amplitude * 1.3
  const barCount = Math.max(16, Math.min(256, vc?.barCount ?? 128))
  const angleStep = (Math.PI * 2) / barCount
  const barW = Math.max(size * 0.003, radius * angleStep * 0.35)
  const shift = speedShift((Date.now() * 0.00012) % 1, vc?.speed)
  const spin = speedShift((Date.now() * 0.0002) % (Math.PI * 2), vc?.speed)

  ctx.save()
  ctx.lineCap = 'round'
  ctx.rotate(spin)

  const barData: { amp: number; len: number; cos: number; sin: number }[] = []
  for (let i = 0; i < barCount; i++) {
    const angle = i * angleStep - Math.PI / 2
    const mi = i < barCount / 2 ? i : barCount - 1 - i
    const raw = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, mi, barCount / 2)
      : getSampleAt(samples, Math.floor((mi / (barCount / 2)) * WAVE_SEGMENTS))
    const amp = Math.pow(raw, 1.3)
    barData.push({ amp, len: Math.max(size * 0.004, amp * maxBarLen), cos: Math.cos(angle), sin: Math.sin(angle) })
  }

  // Pass 1: Soft glow
  ctx.lineWidth = barW * 2
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 0.22, vc)
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, beat ?? 0)
  ctx.beginPath()
  for (const { amp, len, cos, sin } of barData) {
    if (amp < 0.03) continue
    ctx.moveTo(cos * radius, sin * radius)
    ctx.lineTo(cos * (radius + len), sin * (radius + len))
  }
  ctx.stroke()
  if (vc?.glowEnabled) clearGlow(ctx)

  // Pass 2: Sharp bars
  ctx.lineWidth = barW
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 0.92, vc)
  ctx.beginPath()
  for (const { amp, len, cos, sin } of barData) {
    if (amp < 0.02) continue
    ctx.moveTo(cos * radius, sin * radius)
    ctx.lineTo(cos * (radius + len), sin * (radius + len))
  }
  ctx.stroke()

  ctx.restore()
}

// ─── LINE ───────────────────────────────────────────────────────────────────

function drawWaveLine(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  if (samples.length < 4) return
  const halfW = w / 2, halfH = h / 2
  const size = Math.max(w, h)
  const maxOff = getMaxOffset(w, h) * amplitude
  const margin = size * 0.006
  const shift = speedShift((Date.now() * 0.00015) % 1, vc?.speed)
  const segs = 48

  const pts: [number, number][] = []
  for (let i = 0; i < segs; i++) {
    const rawT = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, i, segs)
      : getSampleAt(samples, Math.floor(i * WAVE_SEGMENTS / segs))
    const t = rawT * rawT
    const r = margin + maxOff * (0.03 + 0.97 * t)
    const perimT = i / segs
    const side = Math.floor(perimT * 4) % 4
    const f = (perimT * 4) % 1
    if (side === 0)      pts.push([-halfW + f * w, -halfH - r])
    else if (side === 1) pts.push([halfW + r,      -halfH + f * h])
    else if (side === 2) pts.push([halfW - f * w,   halfH + r])
    else                 pts.push([-halfW - r,       halfH - f * h])
  }

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Pass 1: Wide soft glow
  ctx.beginPath()
  smoothPath(ctx, pts, true)
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 0.25, vc)
  ctx.lineWidth = size * 0.014
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, beat ?? 0)
  ctx.stroke()
  if (vc?.glowEnabled) clearGlow(ctx)

  // Pass 2: Bright core
  ctx.beginPath()
  smoothPath(ctx, pts, true)
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 1, vc)
  ctx.lineWidth = size * 0.0035
  ctx.stroke()

  ctx.restore()
}

// ─── RING ───────────────────────────────────────────────────────────────────

function drawWaveRing(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  if (samples.length < 4) return
  const size = Math.max(w, h)
  const baseR = Math.sqrt(w * w + h * h) / 2 + size * 0.005
  const maxOff = getMaxOffset(w, h) * amplitude * 1.2
  const shift = speedShift((Date.now() * 0.00015) % 1, vc?.speed)
  const ringSegs = 56

  const outerPts: [number, number][] = []
  const innerPts: [number, number][] = []
  for (let i = 0; i < ringSegs; i++) {
    const mi = i < ringSegs / 2 ? i : ringSegs - 1 - i
    const rawT = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, mi, ringSegs / 2)
      : getSampleAt(samples, Math.floor((mi / (ringSegs / 2)) * WAVE_SEGMENTS))
    const t = Math.pow(rawT, 1.15)
    const outer = baseR + t * maxOff
    const inner = baseR + t * maxOff * 0.15
    const angle = (i / ringSegs) * Math.PI * 2 - Math.PI / 2
    const cos = Math.cos(angle), sin = Math.sin(angle)
    outerPts.push([cos * outer, sin * outer])
    innerPts.push([cos * inner, sin * inner])
  }

  ctx.save()

  // Filled band (semi-transparent): outer path forward + inner path reversed
  ctx.beginPath()
  // Draw outer path (open, not closed) then connect to reversed inner
  const n = outerPts.length
  ctx.moveTo(outerPts[0]![0], outerPts[0]![1])
  for (let i = 1; i < n; i++) ctx.lineTo(outerPts[i]![0], outerPts[i]![1])
  const revInner = [...innerPts].reverse()
  for (let i = 0; i < revInner.length; i++) {
    ctx.lineTo(revInner[i]![0], revInner[i]![1])
  }
  ctx.closePath()
  ctx.fillStyle = resolveConicGrad(ctx, shift, 0.1, vc)
  ctx.fill()

  // Pass 1: Wide soft glow
  ctx.beginPath()
  smoothPath(ctx, outerPts, true)
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 0.3, vc)
  ctx.lineWidth = size * 0.01
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, beat ?? 0)
  ctx.stroke()
  if (vc?.glowEnabled) clearGlow(ctx)

  // Pass 2: Sharp core
  ctx.beginPath()
  smoothPath(ctx, outerPts, true)
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 1, vc)
  ctx.lineWidth = size * 0.0025
  ctx.stroke()

  ctx.restore()
}

// ─── DOTS — Batched draws (single path per color band) ──────────────────────

function drawWaveDots(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  if (samples.length < 4) return
  const halfW = w / 2, halfH = h / 2
  const size = Math.max(w, h)
  const maxOff = getMaxOffset(w, h) * amplitude * 0.7
  const dotsPerEdge = 18
  const totalDots = dotsPerEdge * 4
  const shift = speedShift((Date.now() * 0.00012) % 1, vc?.speed)
  const maxDotR = size * 0.013
  const minDotR = size * 0.004

  // Pre-compute all dot positions
  const dots: { x: number; y: number; t: number; rad: number }[] = []
  for (let i = 0; i < totalDots; i++) {
    const rawT = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, i, totalDots)
      : getSampleAt(samples, Math.floor(i * WAVE_SEGMENTS / totalDots))
    const t = Math.pow(rawT, 1.15)
    const offset = maxOff * (0.08 + 0.92 * t)
    const rad = minDotR + t * (maxDotR - minDotR)
    const edge = Math.floor(i / dotsPerEdge)
    const f = ((i % dotsPerEdge) + 0.5) / dotsPerEdge

    let cx_: number, cy_: number
    if (edge === 0) { cx_ = -halfW + f * w; cy_ = -halfH - offset }
    else if (edge === 1) { cx_ = halfW + offset; cy_ = -halfH + f * h }
    else if (edge === 2) { cx_ = halfW - f * w; cy_ = halfH + offset }
    else { cx_ = -halfW - offset; cy_ = halfH - f * h }

    dots.push({ x: cx_, y: cy_, t, rad })
  }

  ctx.save()

  // Batch dots by edge (4 draws instead of 72)
  for (let edge = 0; edge < 4; edge++) {
    const start = edge * dotsPerEdge, end = start + dotsPerEdge
    const midT = (((edge * dotsPerEdge + dotsPerEdge / 2) / totalDots) + shift) % 1

    ctx.fillStyle = resolveColorRgba(midT, 0.85, vc)
    if (vc?.glowEnabled) applyGlow(ctx, midT, vc, beat ?? 0)
    ctx.beginPath()
    for (let i = start; i < end; i++) {
      const d = dots[i]!
      if (d.t < 0.03) continue
      ctx.moveTo(d.x + d.rad, d.y)
      ctx.arc(d.x, d.y, d.rad, 0, Math.PI * 2)
    }
    ctx.fill()
    if (vc?.glowEnabled) clearGlow(ctx)
  }

  // Constellation lines — batched per edge
  ctx.lineCap = 'round'
  for (let edge = 0; edge < 4; edge++) {
    const start = edge * dotsPerEdge, end = start + dotsPerEdge
    const midT = (((edge * dotsPerEdge + dotsPerEdge / 2) / totalDots) + shift) % 1
    ctx.strokeStyle = resolveColorRgba(midT, 0.2, vc)
    ctx.lineWidth = size * 0.0015
    ctx.beginPath()
    for (let i = start; i < end - 1; i++) {
      const a = dots[i]!, b = dots[i + 1]!
      const avgT = (a.t + b.t) / 2
      if (avgT < 0.12) continue
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
    }
    ctx.stroke()
  }

  ctx.restore()
}

// ─── WAVEFORM ───────────────────────────────────────────────────────────────

function drawWaveWaveform(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  if (samples.length < 4) return
  const halfW = w / 2, halfH = h / 2
  const size = Math.max(w, h)
  const maxOff = getMaxOffset(w, h) * amplitude
  const margin = size * 0.004
  const shift = speedShift((Date.now() * 0.00015) % 1, vc?.speed)
  const segs = 48

  const outerPts: [number, number][] = []
  const innerPts: [number, number][] = []
  for (let i = 0; i < segs; i++) {
    const rawT = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, i, segs)
      : getSampleAt(samples, Math.floor(i * WAVE_SEGMENTS / segs))
    const t = rawT * rawT
    const rOuter = margin + maxOff * (0.06 + 0.94 * t)
    const rInner = margin + maxOff * 0.02 * t
    const perimT = i / segs
    const side = Math.floor(perimT * 4) % 4
    const f = (perimT * 4) % 1
    let nx: number, ny: number, px: number, py: number
    if (side === 0) { px = -halfW + f * w; py = -halfH; nx = 0; ny = -1 }
    else if (side === 1) { px = halfW; py = -halfH + f * h; nx = 1; ny = 0 }
    else if (side === 2) { px = halfW - f * w; py = halfH; nx = 0; ny = 1 }
    else { px = -halfW; py = halfH - f * h; nx = -1; ny = 0 }
    outerPts.push([px + nx * rOuter, py + ny * rOuter])
    innerPts.push([px + nx * rInner, py + ny * rInner])
  }

  ctx.save()

  // Filled band
  ctx.beginPath()
  smoothPath(ctx, outerPts, false)
  const revInner = [...innerPts].reverse()
  for (let i = 0; i < revInner.length; i++) {
    const [x, y] = revInner[i]!
    if (i === 0) ctx.lineTo(x, y)
    else {
      const prev = revInner[i - 1]!
      ctx.quadraticCurveTo(prev[0], prev[1], (prev[0] + x) / 2, (prev[1] + y) / 2)
    }
  }
  ctx.closePath()
  ctx.fillStyle = resolveConicGrad(ctx, shift, 0.12, vc)
  ctx.fill()

  // Pass 1: Wide glow
  ctx.beginPath()
  smoothPath(ctx, outerPts, true)
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 0.3, vc)
  ctx.lineWidth = size * 0.009
  ctx.lineJoin = 'round'
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, beat ?? 0)
  ctx.stroke()
  if (vc?.glowEnabled) clearGlow(ctx)

  // Pass 2: Sharp core
  ctx.beginPath()
  smoothPath(ctx, outerPts, true)
  ctx.strokeStyle = resolveConicGrad(ctx, shift, 1, vc)
  ctx.lineWidth = size * 0.0025
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()

  ctx.restore()
}

// ─── PLASMA ─────────────────────────────────────────────────────────────────

function drawWavePlasma(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  if (samples.length < 4) return
  const size = Math.max(w, h)
  const baseR = Math.sqrt(w * w + h * h) / 2
  const maxOff = getMaxOffset(w, h) * amplitude
  const spd = vc?.speed ?? 1
  const time = Date.now() * 0.001 * spd
  const shift = (time * 0.02) % 1

  ctx.save()

  // 2 concentric rings (reduced from 3)
  const ringCount = 2
  for (let r = 0; r < ringCount; r++) {
    const ringDist = ((r + 1) / ringCount) * maxOff
    const ringR = baseR + ringDist * 0.4
    const segs = 40
    const pts: [number, number][] = []
    const bandOff = r * 20

    for (let i = 0; i < segs; i++) {
      const angle = (i / segs) * Math.PI * 2 - Math.PI / 2
      const mi = i < segs / 2 ? i : segs - 1 - i
      const rawT = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, (bandOff + mi) % 64, segs)
        : getSampleAt(samples, Math.floor((mi / segs) * WAVE_SEGMENTS))
      const t = Math.pow(rawT, 1.1)
      const wave = Math.sin(angle * 3 + time * (2 + r)) * 0.3 + 0.7
      const dist = t * wave * ringDist
      const finalR = ringR + dist
      pts.push([Math.cos(angle) * finalR, Math.sin(angle) * finalR])
    }

    const ringShift = (shift + r * 0.5) % 1

    // Wide soft stroke (glow replacement)
    ctx.beginPath()
    smoothPath(ctx, pts, true)
    ctx.strokeStyle = resolveConicGrad(ctx, ringShift, 0.2, vc)
    ctx.lineWidth = size * (0.008 - r * 0.002)
    if (vc?.glowEnabled) applyGlow(ctx, ringShift, vc, beat ?? 0)
    ctx.stroke()
    if (vc?.glowEnabled) clearGlow(ctx)

    // Sharp core
    ctx.beginPath()
    smoothPath(ctx, pts, true)
    ctx.strokeStyle = resolveConicGrad(ctx, ringShift, 0.7 - r * 0.15, vc)
    ctx.lineWidth = size * (0.003 - r * 0.0005)
    ctx.stroke()
  }

  // Inner energy glow (cheap radial fill)
  const bassE = bands?.bass ?? 0.5
  if (bassE > 0.3) {
    const glowR = baseR + bassE * maxOff * 0.4
    const grad = ctx.createRadialGradient(0, 0, baseR * 0.4, 0, 0, glowR)
    grad.addColorStop(0, resolveColorRgba(shift, bassE * 0.12, vc))
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(0, 0, glowR, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

// ─── LIGHTNING ──────────────────────────────────────────────────────────────

function drawWaveLightning(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  if (samples.length < 4) return
  const halfW = w / 2, halfH = h / 2
  const size = Math.max(w, h)
  const maxLen = getMaxOffset(w, h) * amplitude * 1.5
  const spd = vc?.speed ?? 1
  const shift = speedShift((Date.now() * 0.0002) % 1, spd)
  const seed = Math.floor(Date.now() / (80 / spd))

  const rng = (n: number) => {
    const x = Math.sin(seed * 9301 + n * 49297) * 49297
    return x - Math.floor(x)
  }

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  const boltsPerEdge = 7
  const allBolts: { pts: [number, number][]; colorT: number; t: number }[] = []

  for (let edge = 0; edge < 4; edge++) {
    const isHoriz = edge === 0 || edge === 2
    const edgeLen = isHoriz ? w : h

    for (let j = 0; j < boltsPerEdge; j++) {
      const gIdx = edge * boltsPerEdge + j
      const rawT = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, gIdx, boltsPerEdge * 4)
        : getSampleAt(samples, Math.floor(gIdx * WAVE_SEGMENTS / (boltsPerEdge * 4)))
      if (rawT < 0.12) continue

      const t = Math.pow(rawT, 1.2)
      const boltLen = t * maxLen
      const pos = (j + 0.5) / boltsPerEdge * edgeLen

      let sx: number, sy: number, nx: number, ny: number
      if (edge === 0) { sx = -halfW + pos; sy = -halfH; nx = 0; ny = -1 }
      else if (edge === 1) { sx = halfW; sy = -halfH + pos; nx = 1; ny = 0 }
      else if (edge === 2) { sx = -halfW + pos; sy = halfH; nx = 0; ny = 1 }
      else { sx = -halfW; sy = halfH - pos; nx = -1; ny = 0 }

      const segs = 5 + Math.floor(t * 3)
      const pts: [number, number][] = [[sx, sy]]
      for (let s = 1; s <= segs; s++) {
        const p = s / segs
        const mx = sx + nx * boltLen * p
        const my = sy + ny * boltLen * p
        const perpAmt = boltLen * 0.35 * (1 - p)
        const jSeed = gIdx * 100 + s
        const px = isHoriz ? (rng(jSeed) - 0.5) * perpAmt : 0
        const py = !isHoriz ? (rng(jSeed + 50) - 0.5) * perpAmt : 0
        pts.push([mx + px, my + py])
      }

      const colorT = ((edge * boltsPerEdge + j) / (boltsPerEdge * 4) + shift) % 1
      allBolts.push({ pts, colorT, t })
    }
  }

  // Pass 1: PRISM colour strokes
  ctx.lineWidth = size * 0.004
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, beat ?? 0)
  for (const bolt of allBolts) {
    ctx.beginPath()
    ctx.moveTo(bolt.pts[0]![0], bolt.pts[0]![1])
    for (let s = 1; s < bolt.pts.length; s++) ctx.lineTo(bolt.pts[s]![0], bolt.pts[s]![1])
    ctx.strokeStyle = resolveColorRgba(bolt.colorT, 0.55, vc)
    ctx.stroke()
  }
  if (vc?.glowEnabled) clearGlow(ctx)

  // Pass 2: White core
  ctx.lineWidth = size * 0.0018
  for (const bolt of allBolts) {
    ctx.beginPath()
    ctx.moveTo(bolt.pts[0]![0], bolt.pts[0]![1])
    for (let s = 1; s < bolt.pts.length; s++) ctx.lineTo(bolt.pts[s]![0], bolt.pts[s]![1])
    ctx.strokeStyle = `rgba(255,255,255,${0.65 + bolt.t * 0.35})`
    ctx.stroke()
  }

  ctx.restore()
}

// ─── GALAXY ─────────────────────────────────────────────────────────────────

function drawWaveGalaxy(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  if (samples.length < 4) return
  const size = Math.max(w, h)
  const baseR = Math.sqrt(w * w + h * h) / 2
  const maxOff = getMaxOffset(w, h) * amplitude * 1.3
  const spd = vc?.speed ?? 1
  const time = Date.now() * 0.001 * spd
  const shift = (time * 0.015) % 1
  const rot = time * 0.5

  ctx.save()

  const armCount = 3
  const ptsPerArm = 28

  for (let arm = 0; arm < armCount; arm++) {
    const armOff = (arm / armCount) * Math.PI * 2
    const armShift = (shift + arm / armCount) % 1

    const pts: [number, number][] = []
    for (let i = 0; i < ptsPerArm; i++) {
      const progress = i / ptsPerArm
      const specIdx = Math.floor(progress * 63)
      const rawT = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, specIdx, 64)
        : getSampleAt(samples, Math.floor(progress * WAVE_SEGMENTS))
      const t = Math.pow(rawT, 1.1)
      const angle = armOff + progress * Math.PI * 3.5 + rot
      const spiralR = baseR + progress * maxOff * (0.3 + t * 0.7)
      pts.push([Math.cos(angle) * spiralR, Math.sin(angle) * spiralR])
    }

    // Wide glow trail
    ctx.beginPath()
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
    ctx.strokeStyle = resolveColorRgba(armShift, 0.25, vc)
    ctx.lineWidth = size * 0.007
    if (vc?.glowEnabled) applyGlow(ctx, armShift, vc, beat ?? 0)
    ctx.stroke()
    if (vc?.glowEnabled) clearGlow(ctx)

    // Sharp trail
    ctx.beginPath()
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
    ctx.strokeStyle = resolveColorRgba(armShift, 0.7, vc)
    ctx.lineWidth = size * 0.002
    ctx.stroke()

    // White core
    ctx.beginPath()
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = size * 0.001
    ctx.stroke()

    // Star particles (batched single fill)
    ctx.fillStyle = resolveColorRgba(armShift, 0.65, vc)
    ctx.beginPath()
    for (let i = 0; i < ptsPerArm; i += 5) {
      const [px, py] = pts[i]!
      const dotR = size * 0.004
      ctx.moveTo(px + dotR, py)
      ctx.arc(px, py, dotR, 0, Math.PI * 2)
    }
    ctx.fill()
  }

  // Central pulse (cheap radial gradient fill)
  const bassE = bands?.bass ?? 0.5
  if (bassE > 0.2) {
    const pulseR = baseR + bassE * maxOff * 0.35
    const cGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, pulseR)
    cGrad.addColorStop(0, resolveColorRgba(shift, bassE * 0.15, vc))
    cGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = cGrad
    ctx.beginPath()
    ctx.arc(0, 0, pulseR, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

// ─── FIRE ───────────────────────────────────────────────────────────────────

function drawWaveFire(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  _beat?: number
): void {
  if (samples.length < 4) return
  const halfW = w / 2, halfH = h / 2
  const size = Math.max(w, h)
  const maxOff = getMaxOffset(w, h) * amplitude * 1.4
  const spd = vc?.speed ?? 1
  const time = Date.now() * 0.003 * spd

  ctx.save()

  const flamesPerEdge = 12
  for (let edge = 0; edge < 4; edge++) {
    const isHoriz = edge === 0 || edge === 2
    const edgeLen = isHoriz ? w : h
    const flameW = edgeLen / flamesPerEdge

    for (let j = 0; j < flamesPerEdge; j++) {
      const gIdx = edge * flamesPerEdge + j
      const rawT = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, gIdx, flamesPerEdge * 4)
        : getSampleAt(samples, Math.floor(gIdx * WAVE_SEGMENTS / (flamesPerEdge * 4)))
      const t = Math.pow(rawT, 1.15)
      if (t < 0.06) continue

      const flicker = 0.75 + 0.25 * Math.sin(time * 5 + gIdx * 1.7)
      const fH = t * maxOff * flicker
      const pos = (j + 0.5) / flamesPerEdge * edgeLen
      const hw = flameW * 0.5

      ctx.beginPath()
      let g: CanvasGradient
      if (edge === 0) {
        const bx = -halfW + pos
        ctx.moveTo(bx - hw, -halfH)
        ctx.quadraticCurveTo(bx - hw * 0.3, -halfH - fH * 0.7, bx, -halfH - fH)
        ctx.quadraticCurveTo(bx + hw * 0.3, -halfH - fH * 0.7, bx + hw, -halfH)
        ctx.closePath()
        g = ctx.createLinearGradient(bx, -halfH, bx, -halfH - fH)
      } else if (edge === 1) {
        const by = -halfH + pos
        ctx.moveTo(halfW, by - hw)
        ctx.quadraticCurveTo(halfW + fH * 0.7, by - hw * 0.3, halfW + fH, by)
        ctx.quadraticCurveTo(halfW + fH * 0.7, by + hw * 0.3, halfW, by + hw)
        ctx.closePath()
        g = ctx.createLinearGradient(halfW, by, halfW + fH, by)
      } else if (edge === 2) {
        const bx = -halfW + pos
        ctx.moveTo(bx - hw, halfH)
        ctx.quadraticCurveTo(bx - hw * 0.3, halfH + fH * 0.7, bx, halfH + fH)
        ctx.quadraticCurveTo(bx + hw * 0.3, halfH + fH * 0.7, bx + hw, halfH)
        ctx.closePath()
        g = ctx.createLinearGradient(bx, halfH, bx, halfH + fH)
      } else {
        const by = halfH - pos
        ctx.moveTo(-halfW, by - hw)
        ctx.quadraticCurveTo(-halfW - fH * 0.7, by - hw * 0.3, -halfW - fH, by)
        ctx.quadraticCurveTo(-halfW - fH * 0.7, by + hw * 0.3, -halfW, by + hw)
        ctx.closePath()
        g = ctx.createLinearGradient(-halfW, by, -halfW - fH, by)
      }

      // 3-stop gradient (reduced from 5)
      g.addColorStop(0, `rgba(255, 230, 120, ${0.85 * t})`)
      g.addColorStop(0.4, `rgba(255, 120, 30, ${0.55 * t})`)
      g.addColorStop(1, 'rgba(160, 30, 10, 0)')
      ctx.fillStyle = g
      ctx.fill()
    }
  }

  ctx.restore()
}

// ─── NEON BARS — Cyberpunk style bars with inner glow + scan lines ──────────

function drawWaveNeonBars(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  if (samples.length < 4) return
  const halfW = w / 2, halfH = h / 2
  const size = Math.max(w, h)
  const maxOffset = getMaxOffset(w, h) * amplitude * 1.2
  const barsPerEdge = Math.max(8, Math.min(60, Math.round((vc?.barCount ?? 112) / 4)))
  const totalBars = barsPerEdge * 4
  const spd = vc?.speed ?? 1
  const shift = speedShift((Date.now() * 0.00015) % 1, spd)
  const time = Date.now() * 0.001 * spd

  // Neon colors: hot pink, electric cyan, violet
  const neonPink: [number, number, number] = [255, 20, 120]
  const neonCyan: [number, number, number] = [0, 255, 230]
  const neonViolet: [number, number, number] = [160, 40, 255]

  function neonColorAt(t: number, alpha: number): string {
    const ct = ((t % 1) + 1) % 1
    let r: number, g: number, b: number
    if (ct < 0.33) {
      const f = ct * 3
      r = neonPink[0] + (neonCyan[0] - neonPink[0]) * f
      g = neonPink[1] + (neonCyan[1] - neonPink[1]) * f
      b = neonPink[2] + (neonCyan[2] - neonPink[2]) * f
    } else if (ct < 0.66) {
      const f = (ct - 0.33) * 3
      r = neonCyan[0] + (neonViolet[0] - neonCyan[0]) * f
      g = neonCyan[1] + (neonViolet[1] - neonCyan[1]) * f
      b = neonCyan[2] + (neonViolet[2] - neonCyan[2]) * f
    } else {
      const f = (ct - 0.66) * 3
      r = neonViolet[0] + (neonPink[0] - neonViolet[0]) * f
      g = neonViolet[1] + (neonPink[1] - neonViolet[1]) * f
      b = neonViolet[2] + (neonPink[2] - neonViolet[2]) * f
    }
    return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`
  }

  const bassE = bands?.bass ?? 0.5
  const beatV = beat ?? 0

  const edgeG: [number, number, number, number][] = [
    [-halfW, -halfH, halfW, -halfH],
    [halfW, -halfH, halfW, halfH],
    [halfW, halfH, -halfW, halfH],
    [-halfW, halfH, -halfW, -halfH],
  ]

  ctx.save()
  ctx.lineCap = 'butt'

  // ═══ Pass 0: Corner glow beacons (bass-reactive neon bloom at each corner) ═══
  if (bassE > 0.3) {
    const cornerGlowR = size * 0.06 * (0.3 + bassE * 0.7)
    const corners: [number, number][] = [
      [-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH],
    ]
    for (let c = 0; c < 4; c++) {
      const [cx, cy] = corners[c]!
      const cShift = (shift + c * 0.25) % 1
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cornerGlowR)
      grad.addColorStop(0, neonColorAt(cShift, 0.35 * bassE))
      grad.addColorStop(0.5, neonColorAt(cShift + 0.15, 0.12 * bassE))
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, cornerGlowR, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  for (let edge = 0; edge < 4; edge++) {
    const isHoriz = edge === 0 || edge === 2
    const edgeLen = isHoriz ? w : h
    const spacing = edgeLen / (barsPerEdge + 1)
    const barW = Math.max(size * 0.004, spacing * 0.55)
    const eShift = (shift + edge * 0.25) % 1

    for (let j = 0; j < barsPerEdge; j++) {
      const mj = j < barsPerEdge / 2 ? j : barsPerEdge - 1 - j
      const gi = edge * barsPerEdge + mj
      const raw = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, gi, totalBars)
        : getSampleAt(samples, Math.floor(gi * WAVE_SEGMENTS / totalBars))
      const t = Math.pow(raw, 1.2)
      if (t < 0.03) continue

      const len = Math.max(size * 0.005, t * maxOffset)
      const pos = (j + 1) * spacing
      const colorT = ((gi / totalBars) + eShift) % 1

      let sx: number, sy: number, ex: number, ey: number
      if (edge === 0) { sx = -halfW + pos; sy = -halfH; ex = sx; ey = sy - len }
      else if (edge === 1) { sx = halfW; sy = -halfH + pos; ex = sx + len; ey = sy }
      else if (edge === 2) { sx = -halfW + pos; sy = halfH; ex = sx; ey = sy + len }
      else { sx = -halfW; sy = -halfH + pos; ex = sx - len; ey = sy }

      // Scan line flicker effect
      const scanLine = Math.sin(j * 0.5 + time * 3) * 0.5 + 0.5
      const scanAlpha = 0.7 + scanLine * 0.3

      // Bass-reactive bar stretch: bars extend further on strong bass
      const bassStretch = 1 + bassE * 0.35
      const exB = sx + (ex - sx) * bassStretch
      const eyB = sy + (ey - sy) * bassStretch

      // Pass 1: Wide outer glow
      ctx.lineWidth = barW * 3
      ctx.strokeStyle = neonColorAt(colorT, 0.15 * t * scanAlpha)
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(exB, eyB)
      ctx.stroke()

      // Pass 2: Medium glow
      ctx.lineWidth = barW * 1.8
      ctx.strokeStyle = neonColorAt(colorT, 0.4 * t * scanAlpha)
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(exB, eyB)
      ctx.stroke()

      // Pass 3: Sharp bright core
      ctx.lineWidth = barW * 0.8
      ctx.strokeStyle = neonColorAt(colorT, 0.95 * scanAlpha)
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(exB, eyB)
      ctx.stroke()

      // Pass 4: White hot center on high peaks
      if (t > 0.6) {
        ctx.lineWidth = barW * 0.3
        ctx.strokeStyle = `rgba(255,255,255,${(t - 0.6) * 2.5 * scanAlpha})`
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(exB, eyB)
        ctx.stroke()
      }

      // Pass 5: Tip particle sparkle on very high peaks
      if (t > 0.75) {
        const sparkSize = size * 0.004 * t
        ctx.fillStyle = neonColorAt(colorT, 0.8)
        ctx.beginPath()
        ctx.arc(exB, eyB, sparkSize, 0, Math.PI * 2)
        ctx.fill()
        // Cross-hair sparkle
        ctx.strokeStyle = `rgba(255,255,255,${(t - 0.75) * 3})`
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.moveTo(exB - sparkSize * 1.8, eyB)
        ctx.lineTo(exB + sparkSize * 1.8, eyB)
        ctx.moveTo(exB, eyB - sparkSize * 1.8)
        ctx.lineTo(exB, eyB + sparkSize * 1.8)
        ctx.stroke()
      }
    }
  }

  // ═══ Scanning laser line (sweeps around the border) ═══
  const scanAngle = (time * 0.8) % 4 // 0–4 (one per edge)
  const scanEdge = Math.floor(scanAngle) % 4
  const scanPos = (scanAngle - scanEdge)
  const scanIsHoriz = scanEdge === 0 || scanEdge === 2
  const scanEdgeLen = scanIsHoriz ? w : h
  const scanPx = scanPos * scanEdgeLen
  let scanX: number, scanY: number
  if (scanEdge === 0) { scanX = -halfW + scanPx; scanY = -halfH }
  else if (scanEdge === 1) { scanX = halfW; scanY = -halfH + scanPx }
  else if (scanEdge === 2) { scanX = halfW - scanPx; scanY = halfH }
  else { scanX = -halfW; scanY = halfH - scanPx }
  const scanGrad = ctx.createRadialGradient(scanX, scanY, 0, scanX, scanY, size * 0.08)
  scanGrad.addColorStop(0, neonColorAt(shift, 0.5))
  scanGrad.addColorStop(0.4, neonColorAt(shift + 0.1, 0.15))
  scanGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = scanGrad
  ctx.beginPath()
  ctx.arc(scanX, scanY, size * 0.08, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

// ─── CRYSTAL RING — Glass/ice ring with rainbow refraction ──────────────────

function drawWaveCrystalRing(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  if (samples.length < 4) return
  const size = Math.max(w, h)
  const baseR = Math.sqrt(w * w + h * h) / 2 + size * 0.005
  const maxOff = getMaxOffset(w, h) * amplitude * 1.1
  const spd = vc?.speed ?? 1
  const time = Date.now() * 0.001 * spd
  const shift = (time * 0.02) % 1
  const ringSegs = 64

  // Crystal/rainbow refraction colors
  const crystalColors: [number, number, number][] = [
    [180, 220, 255],   // ice blue
    [220, 200, 255],   // lavender
    [255, 200, 220],   // rose quartz
    [200, 255, 240],   // mint
    [255, 240, 200],   // champagne
    [200, 220, 255],   // periwinkle
    [255, 220, 240],   // pink diamond
  ]

  function crystalColor(t: number, alpha: number): string {
    const ct = ((t % 1) + 1) % 1
    const s = ct * (crystalColors.length - 1)
    const i = Math.min(Math.floor(s), crystalColors.length - 2)
    const f = s - i
    const a = crystalColors[i]!
    const b = crystalColors[i + 1]!
    return `rgba(${a[0] + (b[0] - a[0]) * f | 0},${a[1] + (b[1] - a[1]) * f | 0},${a[2] + (b[2] - a[2]) * f | 0},${alpha})`
  }

  ctx.save()

  // Ring 1: Outer crystal ring (main audio reactive)
  const outerPts: [number, number][] = []
  const innerPts: [number, number][] = []
  for (let i = 0; i < ringSegs; i++) {
    const mi = i < ringSegs / 2 ? i : ringSegs - 1 - i
    const rawT = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, mi, ringSegs / 2)
      : getSampleAt(samples, Math.floor((mi / (ringSegs / 2)) * WAVE_SEGMENTS))
    const t = Math.pow(rawT, 1.1)
    const angle = (i / ringSegs) * Math.PI * 2 - Math.PI / 2

    // Crystal facet effect: slight angular jumps
    const facetAngle = Math.floor(angle * 6) / 6
    const facetBlend = 0.7 + 0.3 * Math.cos((angle - facetAngle) * 18)

    const outerR = baseR + t * maxOff * facetBlend
    const innerR = baseR + t * maxOff * 0.12
    const cos = Math.cos(angle), sin = Math.sin(angle)
    outerPts.push([cos * outerR, sin * outerR])
    innerPts.push([cos * innerR, sin * innerR])
  }

  // Filled band: frosted glass effect
  ctx.beginPath()
  const n = outerPts.length
  ctx.moveTo(outerPts[0]![0], outerPts[0]![1])
  for (let i = 1; i < n; i++) ctx.lineTo(outerPts[i]![0], outerPts[i]![1])
  const revInner = [...innerPts].reverse()
  for (let i = 0; i < revInner.length; i++) {
    ctx.lineTo(revInner[i]![0], revInner[i]![1])
  }
  ctx.closePath()
  // Frosted fill with gradient
  const frostGrad = ctx.createRadialGradient(0, 0, baseR * 0.8, 0, 0, baseR + maxOff)
  frostGrad.addColorStop(0, crystalColor(shift, 0.05))
  frostGrad.addColorStop(0.5, crystalColor(shift + 0.3, 0.08))
  frostGrad.addColorStop(1, crystalColor(shift + 0.6, 0.03))
  ctx.fillStyle = frostGrad
  ctx.fill()

  // Pass 1: Wide soft diffused glow
  ctx.beginPath()
  smoothPath(ctx, outerPts, true)
  ctx.strokeStyle = crystalColor(shift, 0.2)
  ctx.lineWidth = size * 0.012
  ctx.lineJoin = 'round'
  if (vc?.glowEnabled) applyGlow(ctx, shift, vc, beat ?? 0)
  ctx.stroke()
  if (vc?.glowEnabled) clearGlow(ctx)

  // Pass 2: Rainbow refraction edge (shifting colors along ring)
  ctx.beginPath()
  smoothPath(ctx, outerPts, true)
  const refractionGrad = ctx.createConicGradient(-Math.PI / 2, 0, 0)
  for (let s = 0; s <= 1; s += 0.14) {
    refractionGrad.addColorStop(s, crystalColor(shift + s, 0.7))
  }
  ctx.strokeStyle = refractionGrad
  ctx.lineWidth = size * 0.004
  ctx.stroke()

  // Pass 3: White diamond sparkle core
  ctx.beginPath()
  smoothPath(ctx, outerPts, true)
  ctx.strokeStyle = `rgba(255, 255, 255, 0.5)`
  ctx.lineWidth = size * 0.001
  ctx.stroke()

  // Diamond sparkle particles at peak points
  const bassE = bands?.bass ?? 0.5
  ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + bassE * 0.4})`
  for (let i = 0; i < ringSegs; i += 4) {
    const mi = i < ringSegs / 2 ? i : ringSegs - 1 - i
    const rawT = spectrum && spectrum.length > 0
      ? getSpectrumAt(spectrum, mi, ringSegs / 2)
      : 0
    if (rawT < 0.5) continue
    const [px, py] = outerPts[i]!
    const sparkleSize = size * 0.005 * rawT
    // 4-pointed star
    ctx.beginPath()
    ctx.moveTo(px, py - sparkleSize)
    ctx.lineTo(px + sparkleSize * 0.3, py)
    ctx.lineTo(px, py + sparkleSize)
    ctx.lineTo(px - sparkleSize * 0.3, py)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(px - sparkleSize, py)
    ctx.lineTo(px, py + sparkleSize * 0.3)
    ctx.lineTo(px + sparkleSize, py)
    ctx.lineTo(px, py - sparkleSize * 0.3)
    ctx.closePath()
    ctx.fill()
  }

  // ═══ Scanning highlight — bright spot orbiting around the ring ═══
  const scanAngle = time * 1.2
  const scanI = Math.floor(((scanAngle / (Math.PI * 2)) % 1) * ringSegs) % ringSegs
  const scanRad = size * 0.025 * (0.8 + bassE * 0.5)
  const sp = outerPts[scanI]!
  const scanGrad = ctx.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], scanRad)
  scanGrad.addColorStop(0, 'rgba(255, 255, 255, 0.8)')
  scanGrad.addColorStop(0.3, crystalColor(shift, 0.5))
  scanGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = scanGrad
  ctx.beginPath()
  ctx.arc(sp[0], sp[1], scanRad, 0, Math.PI * 2)
  ctx.fill()

  // ═══ Inner refraction ring (subtle prismatic halo closer to image) ═══
  const innerRingR = baseR * 0.92
  ctx.beginPath()
  ctx.arc(0, 0, innerRingR, 0, Math.PI * 2)
  const innerGrad = ctx.createConicGradient(-Math.PI / 2 + time * 0.3, 0, 0)
  for (let s = 0; s <= 1; s += 0.125) {
    innerGrad.addColorStop(s, crystalColor(shift + s + 0.5, 0.12 + bassE * 0.08))
  }
  ctx.strokeStyle = innerGrad
  ctx.lineWidth = size * 0.002
  ctx.stroke()

  ctx.restore()
}

// ─── NEBULA — Cosmic dust clouds with particle trails ───────────────────────

function drawWaveNebula(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  if (samples.length < 4) return
  const size = Math.max(w, h)
  const baseR = Math.sqrt(w * w + h * h) / 2
  const maxOff = getMaxOffset(w, h) * amplitude * 1.4
  const spd = vc?.speed ?? 1
  const time = Date.now() * 0.001 * spd
  const shift = (time * 0.012) % 1

  // Nebula colors
  const nebulaColors: [number, number, number][] = [
    [80, 20, 150],   // deep purple
    [20, 80, 160],   // space blue
    [0, 140, 130],   // teal
    [200, 60, 120],  // magenta
    [40, 40, 180],   // indigo
  ]

  function nebulaColor(t: number, alpha: number): string {
    const ct = ((t % 1) + 1) % 1
    const s = ct * (nebulaColors.length - 1)
    const i = Math.min(Math.floor(s), nebulaColors.length - 2)
    const f = s - i
    const a = nebulaColors[i]!
    const b = nebulaColors[i + 1]!
    return `rgba(${a[0] + (b[0] - a[0]) * f | 0},${a[1] + (b[1] - a[1]) * f | 0},${a[2] + (b[2] - a[2]) * f | 0},${alpha})`
  }

  ctx.save()

  // Multiple nebula cloud layers (spiral arms)
  const armCount = 4
  const dotsPerArm = 35
  const bassE = bands?.bass ?? 0.5

  for (let arm = 0; arm < armCount; arm++) {
    const armOff = (arm / armCount) * Math.PI * 2
    const armShift = (shift + arm / armCount) % 1
    const rot = time * 0.3

    // Build spiral arm points
    const pts: { x: number; y: number; t: number; r: number }[] = []
    for (let i = 0; i < dotsPerArm; i++) {
      const progress = i / dotsPerArm
      const specIdx = Math.floor(progress * 63)
      const rawT = spectrum && spectrum.length > 0
        ? getSpectrumAt(spectrum, specIdx, 64)
        : getSampleAt(samples, Math.floor(progress * WAVE_SEGMENTS))
      const t = Math.pow(rawT, 1.1)
      const angle = armOff + progress * Math.PI * 3 + rot
      const spiralR = baseR + progress * maxOff * (0.25 + t * 0.75)
      pts.push({
        x: Math.cos(angle) * spiralR,
        y: Math.sin(angle) * spiralR,
        t,
        r: spiralR,
      })
    }

    // Pass 1: Wide nebula cloud (soft radial gradients at each point)
    for (let i = 0; i < pts.length; i += 3) {
      const p = pts[i]!
      if (p.t < 0.05) continue
      const cloudR = size * 0.03 * (0.5 + p.t) * (1 + bassE * 0.5)
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, cloudR)
      grad.addColorStop(0, nebulaColor(armShift + i * 0.02, 0.15 * p.t))
      grad.addColorStop(0.5, nebulaColor(armShift + i * 0.02 + 0.1, 0.06 * p.t))
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(p.x, p.y, cloudR, 0, Math.PI * 2)
      ctx.fill()
    }

    // Pass 2: Trail line (glowing)
    ctx.beginPath()
    ctx.moveTo(pts[0]!.x, pts[0]!.y)
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]!
      const curr = pts[i]!
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2)
    }
    ctx.strokeStyle = nebulaColor(armShift, 0.3)
    ctx.lineWidth = size * 0.005
    if (vc?.glowEnabled) applyGlow(ctx, armShift, vc, beat ?? 0)
    ctx.stroke()
    if (vc?.glowEnabled) clearGlow(ctx)

    // Pass 3: Bright core trail
    ctx.beginPath()
    ctx.moveTo(pts[0]!.x, pts[0]!.y)
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]!
      const curr = pts[i]!
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2)
    }
    ctx.strokeStyle = nebulaColor(armShift, 0.6)
    ctx.lineWidth = size * 0.0015
    ctx.stroke()

    // Pass 4: Star particles along arm with varied sizes
    for (let i = 0; i < pts.length; i += 3) {
      const p = pts[i]!
      if (p.t < 0.25) continue
      const dotR = size * 0.003 * p.t * (0.7 + Math.sin(i * 1.3 + time * 2) * 0.3)
      // Star glow
      ctx.fillStyle = nebulaColor(armShift + i * 0.03, 0.15 * p.t)
      ctx.beginPath()
      ctx.arc(p.x, p.y, dotR * 3, 0, Math.PI * 2)
      ctx.fill()
      // Star core
      ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + p.t * 0.5})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2)
      ctx.fill()
    }

    // Pass 5: Stardust trail — tiny flickering particles between arm dots
    ctx.fillStyle = `rgba(255, 255, 255, 0.35)`
    ctx.beginPath()
    for (let i = 0; i < pts.length - 1; i += 2) {
      const p1 = pts[i]!
      const p2 = pts[i + 1]!
      if (p1.t < 0.15 && p2.t < 0.15) continue
      // Mid-point particle with jitter
      const jx = (p1.x + p2.x) / 2 + Math.sin(time * 5 + i * 2.7) * size * 0.003
      const jy = (p1.y + p2.y) / 2 + Math.cos(time * 4 + i * 1.9) * size * 0.003
      const dr = size * 0.0012 * (p1.t + p2.t) / 2
      ctx.moveTo(jx + dr, jy)
      ctx.arc(jx, jy, dr, 0, Math.PI * 2)
    }
    ctx.fill()
  }

  // ═══ Central supernova glow (multi-layered, bass-reactive) ═══
  const glowR = baseR + bassE * maxOff * 0.3
  // Outer nebula mist
  if (bassE > 0.15) {
    const outerGlowR = glowR * 1.5
    const outerGrad = ctx.createRadialGradient(0, 0, glowR * 0.3, 0, 0, outerGlowR)
    outerGrad.addColorStop(0, nebulaColor(shift + 0.5, bassE * 0.06))
    outerGrad.addColorStop(0.5, nebulaColor(shift + 0.7, bassE * 0.03))
    outerGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = outerGrad
    ctx.beginPath()
    ctx.arc(0, 0, outerGlowR, 0, Math.PI * 2)
    ctx.fill()
  }
  // Core glow
  if (bassE > 0.2) {
    const centerGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR)
    centerGrad.addColorStop(0, nebulaColor(shift, bassE * 0.15))
    centerGrad.addColorStop(0.3, nebulaColor(shift + 0.2, bassE * 0.08))
    centerGrad.addColorStop(0.6, nebulaColor(shift + 0.5, bassE * 0.03))
    centerGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = centerGrad
    ctx.beginPath()
    ctx.arc(0, 0, glowR, 0, Math.PI * 2)
    ctx.fill()
  }
  // Supernova flash on strong bass
  if (bassE > 0.65) {
    const flashR = glowR * 0.6
    const flashAlpha = (bassE - 0.65) * 2
    const flashGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, flashR)
    flashGrad.addColorStop(0, `rgba(255, 255, 255, ${flashAlpha * 0.3})`)
    flashGrad.addColorStop(0.4, nebulaColor(shift, flashAlpha * 0.15))
    flashGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = flashGrad
    ctx.beginPath()
    ctx.arc(0, 0, flashR, 0, Math.PI * 2)
    ctx.fill()
  }

  // ═══ Orbiting bright star (like a pulsar) ═══
  const orbitR = baseR * 1.1
  const orbitAngle = time * 0.6
  const starX = Math.cos(orbitAngle) * orbitR
  const starY = Math.sin(orbitAngle) * orbitR
  const starSize = size * 0.008 * (0.6 + bassE * 0.8)
  const starGrad = ctx.createRadialGradient(starX, starY, 0, starX, starY, starSize * 3)
  starGrad.addColorStop(0, 'rgba(255, 255, 255, 0.7)')
  starGrad.addColorStop(0.3, nebulaColor(shift, 0.4))
  starGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = starGrad
  ctx.beginPath()
  ctx.arc(starX, starY, starSize * 3, 0, Math.PI * 2)
  ctx.fill()
  // Star core
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.beginPath()
  ctx.arc(starX, starY, starSize * 0.5, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DISPATCHER + UTILITIES
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

  switch (style) {
    case 'bars':       drawWaveBars(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat); break
    case 'circlebars': drawWaveCircleBars(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat); break
    case 'line':       drawWaveLine(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat); break
    case 'ring':       drawWaveRing(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat); break
    case 'dots':       drawWaveDots(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat); break
    case 'waveform':   drawWaveWaveform(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat); break
    case 'plasma':     drawWavePlasma(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat); break
    case 'lightning':  drawWaveLightning(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat); break
    case 'galaxy':     drawWaveGalaxy(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat); break
    case 'fire':       drawWaveFire(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat); break
    case 'neonbars':   drawWaveNeonBars(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat); break
    case 'crystalring': drawWaveCrystalRing(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat); break
    case 'nebula':     drawWaveNebula(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat); break
    default:           drawWaveBars(ctx, w, h, amplitude, samples, spectrum, bands, vc, beat)
  }
}

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

// ─── BEAT GLOW — NO shadowBlur, wider strokes for glow ─────────────────────

function drawBeatGlowEdge(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  beat: number
): void {
  if (beat < 0.03) return
  const halfW = w / 2, halfH = h / 2
  const size = Math.max(w, h)
  const shift = (Date.now() * 0.0003) % 1

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

export function drawLayers(
  ctx: CanvasRenderingContext2D,
  layers: DrawableLayer[],
  width: number,
  height: number,
  waveOptions?: WaveOptions,
  beat?: number,
  timeSec?: number
): void {
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

        // Border radius clip
        const br = f?.borderRadius ?? 0
        if (br > 0) {
          const hw = (w * fitScale) / 2 / fitScale
          const hh = (h * fitScale) / 2 / fitScale
          const r = Math.min(br, hw, hh)
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
          drawWaveAroundRect(ctx, w, h, waveOptions, waveOptions.style ?? 'line')
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

      // Stroke (outline)
      if (layer.strokeColor && layer.strokeWidth && layer.strokeWidth > 0) {
        ctx.lineWidth = layer.strokeWidth
        ctx.strokeStyle = layer.strokeColor
        ctx.lineJoin = 'round'
        ctx.strokeText(text, 0, 0)
      }

      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
      ctx.fillStyle = color
      ctx.fillText(text, 0, 0)
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

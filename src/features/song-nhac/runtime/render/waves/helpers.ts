/**
 * Wave Style Plugin System — Shared helpers.
 *
 * Tất cả utilities dùng chung giữa các wave styles:
 * - Color resolution (rainbow/solid/gradient)
 * - Glow/shadow helpers
 * - Spectrum/sample reading
 * - PRISM palette
 * - Spline path builder
 *
 * Import vào mỗi wave file: import { resolveColorRgba, ... } from '../helpers'
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  RE-EXPORTED TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface FrequencyBands {
  bass: number   // 0–1 normalised energy
  mid: number
  treble: number
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

// ═══════════════════════════════════════════════════════════════════════════════
//  ANIMATION CLOCK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Module-level animation clock (seconds).
 * Set once per frame by drawLayers() — all wave functions read this
 * instead of Date.now() so that export produces deterministic timing.
 */
let _animTimeSec = 0

/** Set the animation clock (called by drawLayers before dispatching). */
export function setAnimTimeSec(t: number): void {
  _animTimeSec = t
}

/** Get animation time in seconds. */
export function animTimeSec(): number {
  return _animTimeSec
}

/** Get animation time in milliseconds. */
export function animTimeMs(): number {
  return _animTimeSec * 1000
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

export const WAVE_SEGMENTS = 64

// ═══════════════════════════════════════════════════════════════════════════════
//  SAMPLE / SPECTRUM READING
// ═══════════════════════════════════════════════════════════════════════════════

export function getMaxOffset(w: number, h: number): number {
  return Math.max(w, h) * 0.22
}

export function getSampleAt(samples: number[], i: number): number {
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
 * Update the module-level smoothed spectrum buffer with asymmetric
 * attack / decay so that rising energy responds quickly while falling
 * energy fades out gradually — eliminates per-frame jitter.
 */
export function updateSmoothedSpectrum(spectrum: number[]): void {
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

export function getSpectrumAt(spectrum: number[], i: number, totalSegments: number): number {
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

/** Reset smoothed spectrum — call when switching tracks or destroying runtime. */
export function resetSmoothedSpectrum(): void {
  smoothedWaveSpectrum = null
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PRISM PALETTE (audioMotion-analyzer inspired)
// ═══════════════════════════════════════════════════════════════════════════════

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

export function prismRGBA(t: number, alpha: number): string {
  const ct = ((t % 1) + 1) % 1
  const s = ct * (PRISM_RGB.length - 1)
  const i = Math.floor(s)
  const f = s - i
  const a = PRISM_RGB[Math.min(i, PRISM_RGB.length - 1)]!
  const b = PRISM_RGB[Math.min(i + 1, PRISM_RGB.length - 1)]!
  return `rgba(${a[0] + (b[0] - a[0]) * f | 0},${a[1] + (b[1] - a[1]) * f | 0},${a[2] + (b[2] - a[2]) * f | 0},${alpha})`
}

/** Linear gradient w/ PRISM — 5 stops */
export function prismLinearGrad(
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

/** Conic gradient w/ PRISM — 5 stops */
export function prismConicGrad(
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

// ═══════════════════════════════════════════════════════════════════════════════
//  COLOR HELPERS (VisualizerColorOptions)
// ═══════════════════════════════════════════════════════════════════════════════

/** Parse hex/css color to [r,g,b]. Falls back to [0,0,0] for unsupported formats. */
export function hexToRgb(hex: string): [number, number, number] {
  const trimmed = (hex ?? '').trim()
  if (!trimmed.startsWith('#')) {
    const m = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
    if (m) return [parseInt(m[1]!), parseInt(m[2]!), parseInt(m[3]!)]
    return [0, 0, 0]
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
export function resolveColorRgba(
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

export function resolveLinearGrad(
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

export function resolveConicGrad(
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
export function applyGlow(ctx: CanvasRenderingContext2D, shift: number, vc: VisualizerColorOptions | undefined, beat: number): void {
  if (!vc?.glowEnabled) return
  const intensity = Math.min(vc.glowIntensity ?? 1, 3)
  ctx.shadowBlur = 12 * intensity * (0.6 + beat * 0.4)
  ctx.shadowColor = resolveColorRgba(shift, 0.8, vc)
}

export function clearGlow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowBlur = 0
  ctx.shadowColor = 'transparent'
}

/**
 * Deterministic pseudo-random number generator.
 * Dùng thay Math.random() trong render loop để đảm bảo
 * kết quả nhất quán khi export video (frame-by-frame rendering).
 *
 * @param seed - Giá trị seed (ví dụ: animTimeMs() * 7 + index * 49)
 * @returns Số trong khoảng [0, 1)
 */
export function deterministicRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297
  return x - Math.floor(x)
}

/** Speed-adjusted shift value */
export function speedShift(base: number, speed: number | undefined): number {
  if (speed === undefined || speed === 1) return base
  return base * speed
}

/** Bezier path (Catmull-Rom spline) */
export function smoothPath(ctx: CanvasRenderingContext2D, pts: [number, number][], closed = true): void {
  if (pts.length < 3) {
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
    if (closed) ctx.closePath()
    return
  }
  const n = pts.length
  ctx.moveTo(pts[0]![0], pts[0]![1])
  const limit = closed ? n : n - 1
  for (let i = 0; i < limit; i++) {
    const p0 = pts[(i - 1 + n) % n]!
    const p1 = pts[i]!
    const p2 = pts[(i + 1) % n]!
    const p3 = pts[(i + 2) % n]!
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

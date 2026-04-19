/**
 * filterBuilder.ts — Build FFmpeg -af filter chain cho audio enhancement
 * Pure functions, zero project dependencies.
 */

export interface EQSettings {
  enabled: boolean
  highpassHz: number     // 20..1000, default 20 (<=20 = disabled)
  lowpassHz: number      // 8000..22050, default 22050 (>=20000 = disabled)
  bassGainDb: number     // -12..+12, lowshelf 110Hz
  band1Gain: number      // -12..+12, peaking 200Hz (low-mid mud)
  midGainDb: number      // -12..+12, peaking 1000Hz
  band2Gain: number      // -12..+12, peaking 4000Hz (presence)
  trebleGainDb: number   // -12..+12, highshelf 10000Hz
}

export interface CompressorSettings {
  enabled: boolean
  thresholdDb: number   // -40..0, default -18
  ratio: number         // 1..20, default 4
  attackMs: number      // 0.1..100, default 5
  releaseMs: number     // 10..1000, default 50
  makeupGainDb: number  // 0..12, default 2
  knee: number          // 1..8, default 2.83 (soft knee width)
  mix: number           // 0..1, default 1 (parallel compression blend)
}

export interface LoudnormSettings {
  enabled: boolean
  integratedLufs: number  // -23..-6, default -14
  truePeakDbtp: number    // -3..0, default -1
  lra: number             // 1..20, default 11
}

export interface StereoSettings {
  enabled: boolean
  amount: number  // 0..3: 0=mono, 1=original, 2=wide, 3=extra-wide
}

export interface NoiseGateSettings {
  enabled: boolean
  thresholdDb: number   // -80..-5, default -40 (maps to agate linear threshold)
  ratio: number         // 2..20, default 6
  attackMs: number      // 0.1..50, default 5
  releaseMs: number     // 10..2000, default 200
  rangeDb: number       // -60..0, default -24 (attenuation when gated)
}

export interface LimiterSettings {
  enabled: boolean
  thresholdDbtp: number  // -3..0, default -0.5
  attackMs: number       // 0.1..20, default 1
  releaseMs: number      // 10..500, default 50
}

export interface ExciterSettings {
  enabled: boolean
  freq: number           // 2000..12000, default 7500 (harmonic start freq)
  amount: number         // 1..50, default 20
  drive: number          // 1..10, default 5
  blend: number          // -10..10, default 2
}

export interface NoiseReductionSettings {
  enabled: boolean
  noiseReducDb: number   // 0..80, default 15
  noiseFloorDb: number   // -90..-20, default -50
}

// ── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_EQ: EQSettings = {
  enabled: false,
  highpassHz: 20, lowpassHz: 22050,
  bassGainDb: 0, band1Gain: 0, midGainDb: 0, band2Gain: 0, trebleGainDb: 0,
}

export const DEFAULT_COMPRESSOR: CompressorSettings = {
  enabled: false, thresholdDb: -18, ratio: 4,
  attackMs: 5, releaseMs: 50, makeupGainDb: 2, knee: 2.83, mix: 1,
}

export const DEFAULT_LOUDNORM: LoudnormSettings = {
  enabled: false, integratedLufs: -14, truePeakDbtp: -1, lra: 11,
}

export const DEFAULT_STEREO: StereoSettings = { enabled: false, amount: 1 }

export const DEFAULT_NOISE_GATE: NoiseGateSettings = {
  enabled: false, thresholdDb: -40, ratio: 6, attackMs: 5, releaseMs: 200, rangeDb: -24,
}

export const DEFAULT_LIMITER: LimiterSettings = {
  enabled: false, thresholdDbtp: -0.5, attackMs: 1, releaseMs: 50,
}

export const DEFAULT_EXCITER: ExciterSettings = {
  enabled: false, freq: 7500, amount: 20, drive: 5, blend: 2,
}

export const DEFAULT_NOISE_REDUCTION: NoiseReductionSettings = {
  enabled: false, noiseReducDb: 15, noiseFloorDb: -50,
}

// ── Individual filter builders ─────────────────────────────────────────────

export function buildEQFilter(eq: EQSettings): string | null {
  if (!eq.enabled) return null
  const parts: string[] = []

  // High-pass filter (remove rumble below this freq)
  if (eq.highpassHz > 20) {
    parts.push(`highpass=f=${Math.round(eq.highpassHz)}:p=2`)
  }

  // Bass: lowshelf at 110Hz
  if (eq.bassGainDb !== 0) {
    parts.push(`bass=g=${eq.bassGainDb.toFixed(1)}:f=110:w=0.5`)
  }

  // Low-mid: peaking at 200Hz (mud/warmth control)
  if (eq.band1Gain !== 0) {
    parts.push(`equalizer=f=200:t=o:w=1:g=${eq.band1Gain.toFixed(1)}`)
  }

  // Mid: peaking at 1000Hz
  if (eq.midGainDb !== 0) {
    parts.push(`equalizer=f=1000:t=o:w=1:g=${eq.midGainDb.toFixed(1)}`)
  }

  // Presence: peaking at 4000Hz (clarity, cut-through)
  if (eq.band2Gain !== 0) {
    parts.push(`equalizer=f=4000:t=o:w=1:g=${eq.band2Gain.toFixed(1)}`)
  }

  // Treble: highshelf at 10kHz (air)
  if (eq.trebleGainDb !== 0) {
    parts.push(`treble=g=${eq.trebleGainDb.toFixed(1)}:f=10000:w=0.5`)
  }

  // Low-pass filter (tame harshness above this freq)
  if (eq.lowpassHz < 20000) {
    parts.push(`lowpass=f=${Math.round(eq.lowpassHz)}:p=2`)
  }

  return parts.length > 0 ? parts.join(',') : null
}

export function buildCompressorFilter(c: CompressorSettings): string | null {
  if (!c.enabled) return null
  const threshold = Math.max(-40, Math.min(0, c.thresholdDb))
  const ratio = Math.max(1, Math.min(20, c.ratio))
  const attack = Math.max(0.1, Math.min(2000, c.attackMs))
  const release = Math.max(10, Math.min(9000, c.releaseMs))
  const makeup = Math.max(0, Math.min(12, c.makeupGainDb))
  const knee = Math.max(1, Math.min(8, c.knee ?? 2.83))
  const mix = Math.max(0, Math.min(1, c.mix ?? 1))

  return (
    `acompressor=threshold=${threshold}dB` +
    `:ratio=${ratio}` +
    `:attack=${attack}` +
    `:release=${release}` +
    `:makeup=${makeup}dB` +
    `:knee=${knee.toFixed(2)}` +
    `:mix=${mix.toFixed(2)}`
  )
}

export function buildNoiseGateFilter(g: NoiseGateSettings): string | null {
  if (!g.enabled) return null
  // agate threshold is linear (0..1), convert from dB
  const thresholdLinear = Math.pow(10, Math.max(-80, Math.min(-5, g.thresholdDb)) / 20)
  const ratio = Math.max(2, Math.min(20, g.ratio))
  const attack = Math.max(0.01, Math.min(9000, g.attackMs))
  const release = Math.max(0.01, Math.min(9000, g.releaseMs))
  // range: linear 0..1 (how much to let through when gated, 0=silence, 1=pass)
  const rangeLinear = Math.pow(10, Math.max(-60, Math.min(0, g.rangeDb)) / 20)

  return (
    `agate=threshold=${thresholdLinear.toFixed(6)}` +
    `:ratio=${ratio}` +
    `:attack=${attack}` +
    `:release=${release}` +
    `:range=${rangeLinear.toFixed(6)}` +
    `:detection=rms`
  )
}

export function buildLimiterFilter(l: LimiterSettings): string | null {
  if (!l.enabled) return null
  // alimiter limit is linear (0..1)
  const limitLinear = Math.pow(10, Math.max(-3, Math.min(0, l.thresholdDbtp)) / 20)
  const attack = Math.max(0.1, Math.min(80, l.attackMs))
  const release = Math.max(1, Math.min(8000, l.releaseMs))
  return `alimiter=level_in=1:level_out=1:limit=${limitLinear.toFixed(6)}:attack=${attack}:release=${release}:asc=1`
}

export function buildExciterFilter(e: ExciterSettings): string | null {
  if (!e.enabled) return null
  const freq = Math.max(2000, Math.min(12000, e.freq))
  const amount = Math.max(1, Math.min(50, e.amount))
  const drive = Math.max(1, Math.min(10, e.drive))
  const blend = Math.max(-10, Math.min(10, e.blend))
  return `aexciter=freq=${freq}:amount=${amount}:drive=${drive}:blend=${blend}:ceil=9999`
}

export function buildNoiseReductionFilter(n: NoiseReductionSettings): string | null {
  if (!n.enabled) return null
  const nr = Math.max(0, Math.min(80, n.noiseReducDb))
  const nf = Math.max(-90, Math.min(-20, n.noiseFloorDb))
  return `afftdn=nr=${nr}:nf=${nf}:nt=w`
}

export function buildLoudnormFilter(l: LoudnormSettings): string | null {
  if (!l.enabled) return null
  const I = Math.max(-23, Math.min(-6, l.integratedLufs))
  const TP = Math.max(-3, Math.min(0, l.truePeakDbtp))
  const LRA = Math.max(1, Math.min(20, l.lra))
  return `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}`
}

export function buildLoudnormFilterWithMeasured(
  l: LoudnormSettings,
  measured: { input_i: number; input_tp: number; input_lra: number; input_thresh: number; offset: number }
): string {
  const I = Math.max(-23, Math.min(-6, l.integratedLufs))
  const TP = Math.max(-3, Math.min(0, l.truePeakDbtp))
  const LRA = Math.max(1, Math.min(20, l.lra))
  return (
    `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}` +
    `:measured_I=${measured.input_i}` +
    `:measured_TP=${measured.input_tp}` +
    `:measured_LRA=${measured.input_lra}` +
    `:measured_thresh=${measured.input_thresh}` +
    `:offset=${measured.offset}` +
    `:linear=true`
  )
}

export function buildStereoFilter(s: StereoSettings): string | null {
  if (!s.enabled) return null
  const amount = Math.max(0, Math.min(3, s.amount))
  if (amount < 0.05) return 'pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1'
  if (Math.abs(amount - 1.0) < 0.05) return null
  if (amount > 1.0) {
    const m = ((amount - 1) / 2).toFixed(2)
    return `extrastereo=m=${m}`
  }
  const mono = (1 - amount).toFixed(2)
  const stereo = amount.toFixed(2)
  return `pan=stereo|c0=${stereo}*c0+${mono}*0.5*(c0+c1)|c1=${stereo}*c1+${mono}*0.5*(c0+c1)`
}

// ── Main chain builder ─────────────────────────────────────────────────────
// Order: NoiseReduction → NoiseGate → EQ → Compressor → Exciter → Stereo → Loudnorm → Limiter

export function buildFilterChain(
  eq?: EQSettings,
  compressor?: CompressorSettings,
  loudnorm?: LoudnormSettings,
  stereo?: StereoSettings,
  noiseGate?: NoiseGateSettings,
  limiter?: LimiterSettings,
  exciter?: ExciterSettings,
  noiseReduction?: NoiseReductionSettings,
): string | null {
  const parts: string[] = []

  const add = (f: string | null) => { if (f) parts.push(f) }

  // 1. Noise reduction first (clean signal)
  if (noiseReduction) add(buildNoiseReductionFilter(noiseReduction))
  // 2. Gate (remove silence/noise floor)
  if (noiseGate) add(buildNoiseGateFilter(noiseGate))
  // 3. EQ (shape tone)
  if (eq) add(buildEQFilter(eq))
  // 4. Compressor (dynamics)
  if (compressor) add(buildCompressorFilter(compressor))
  // 5. Exciter (add harmonics/sparkle)
  if (exciter) add(buildExciterFilter(exciter))
  // 6. Stereo widening
  if (stereo) add(buildStereoFilter(stereo))
  // 7. Loudnorm (level normalisation)
  if (loudnorm) add(buildLoudnormFilter(loudnorm))
  // 8. Limiter last (brickwall ceiling)
  if (limiter) add(buildLimiterFilter(limiter))

  return parts.length > 0 ? parts.join(',') : null
}

// ── Codec helpers ──────────────────────────────────────────────────────────

export type OutputFormat = 'mp3' | 'aac' | 'wav' | 'keep'

export function getCodecArgs(format: OutputFormat, bitrateKbps?: number, inputExt?: string): string[] {
  const resolved = format === 'keep' ? (inputExt ?? 'mp3') : format
  switch (resolved) {
    case 'mp3':  return ['-acodec', 'libmp3lame', '-b:a', `${bitrateKbps ?? 320}k`]
    case 'aac':
    case 'm4a':  return ['-acodec', 'aac', '-b:a', `${bitrateKbps ?? 256}k`]
    case 'wav':  return ['-acodec', 'pcm_s16le']
    case 'flac': return ['-acodec', 'flac']
    default:     return ['-acodec', 'libmp3lame', '-b:a', `${bitrateKbps ?? 320}k`]
  }
}

export function getOutputExtension(format: OutputFormat, inputExt?: string): string {
  if (format === 'keep') return inputExt ?? 'mp3'
  if (format === 'aac') return 'm4a'
  return format
}

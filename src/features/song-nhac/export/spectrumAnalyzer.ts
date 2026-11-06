import type { SongNhacAudioFrame } from '../core/types'

export const DEFAULT_FFT_SIZE = 2048
export const DEFAULT_BIN_COUNT = 96

/** In-place iterative radix-2 FFT. Sizes must be a power of two. */
export function fftInPlace(real: Float32Array, imag: Float32Array): void {
  const n = real.length
  if (n <= 1) return
  if ((n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two')

  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = real[i]
      real[i] = real[j]
      real[j] = tr
      const ti = imag[i]
      imag[i] = imag[j]
      imag[j] = ti
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wReal = Math.cos(angle)
    const wImag = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let curReal = 1
      let curImag = 0
      const half = len >> 1
      for (let j = 0; j < half; j += 1) {
        const uReal = real[i + j]
        const uImag = imag[i + j]
        const vReal = real[i + j + half] * curReal - imag[i + j + half] * curImag
        const vImag = real[i + j + half] * curImag + imag[i + j + half] * curReal
        real[i + j] = uReal + vReal
        imag[i + j] = uImag + vImag
        real[i + j + half] = uReal - vReal
        imag[i + j + half] = uImag - vImag
        const nextReal = curReal * wReal - curImag * wImag
        curImag = curReal * wImag + curImag * wReal
        curReal = nextReal
      }
    }
  }
}

function createHannWindow(size: number): Float32Array {
  const window = new Float32Array(size)
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)))
  }
  return window
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels
  const length = buffer.length
  if (channels === 1) return buffer.getChannelData(0)
  const mono = new Float32Array(length)
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < length; i += 1) mono[i] += data[i] / channels
  }
  return mono
}

export interface AnalyzeOptions {
  fps?: number
  fftSize?: number
  bins?: number
  /** Highest frequency represented by the last bin, in Hz. */
  maxFrequency?: number
}

/**
 * Pre-computes the exact per-frame audio payload the visualizer needs.
 *
 * The preview used to poll an AnalyserNode at whatever cadence rAF provided, which
 * made an exported frame impossible to reproduce. Everything the engine sees now
 * comes from this deterministic pass over the decoded audio.
 */
export function analyzeAudioBuffer(buffer: AudioBuffer, options: AnalyzeOptions = {}): SongNhacAudioFrame[] {
  const fps = options.fps ?? 30
  const fftSize = options.fftSize ?? DEFAULT_FFT_SIZE
  const bins = options.bins ?? DEFAULT_BIN_COUNT
  const maxFrequency = options.maxFrequency ?? 12000
  const sampleRate = buffer.sampleRate
  const mono = mixToMono(buffer)
  const durationSec = buffer.duration
  const frameCount = Math.max(1, Math.ceil(durationSec * fps))
  const window = createHannWindow(fftSize)
  const half = fftSize / 2
  const binWidth = sampleRate / fftSize

  // Pre-compute the log-spaced edges so quiet bass bins are not crushed by the
  // linear spectrum.
  const edges = new Uint32Array(bins + 1)
  const minFrequency = 30
  for (let i = 0; i <= bins; i += 1) {
    const t = i / bins
    const frequency = minFrequency * Math.pow(maxFrequency / minFrequency, t)
    edges[i] = Math.min(half - 1, Math.max(1, Math.round(frequency / binWidth)))
  }

  const real = new Float32Array(fftSize)
  const imag = new Float32Array(fftSize)
  const frames: SongNhacAudioFrame[] = []
  let bassAverage = 0
  let previousBass = 0

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const centerSample = Math.floor((frameIndex / fps) * sampleRate)
    const start = centerSample - half
    for (let i = 0; i < fftSize; i += 1) {
      const sampleIndex = start + i
      const sample = sampleIndex >= 0 && sampleIndex < mono.length ? mono[sampleIndex] : 0
      real[i] = sample * window[i]
      imag[i] = 0
    }
    fftInPlace(real, imag)

    const spectrum = new Uint8Array(bins)
    for (let b = 0; b < bins; b += 1) {
      const from = edges[b]
      const to = Math.max(edges[b] + 1, edges[b + 1])
      let peak = 0
      for (let k = from; k < to; k += 1) {
        const magnitude = Math.hypot(real[k], imag[k]) / half
        if (magnitude > peak) peak = magnitude
      }
      // 0.02..0.9 maps comfortably into 0..255 after the log companding below
      const normalized = Math.min(1, Math.pow(peak * 3.2, 0.55))
      spectrum[b] = Math.round(normalized * 255)
    }

    let bassSum = 0
    for (let b = 0; b < Math.max(1, Math.floor(bins * 0.12)); b += 1) bassSum += spectrum[b]
    const bass = bassSum / (255 * Math.max(1, Math.floor(bins * 0.12)))
    let midSum = 0
    for (let b = Math.floor(bins * 0.12); b < Math.floor(bins * 0.45); b += 1) midSum += spectrum[b]
    const mid = midSum / (255 * Math.max(1, Math.floor(bins * 0.33)))
    let trebleSum = 0
    for (let b = Math.floor(bins * 0.45); b < bins; b += 1) trebleSum += spectrum[b]
    const treble = trebleSum / (255 * Math.max(1, Math.ceil(bins * 0.55)))

    let rmsSum = 0
    for (let i = 0; i < fftSize; i += 8) rmsSum += real[i] * real[i]
    const rms = Math.min(1, Math.sqrt(rmsSum / (fftSize / 8)))

    bassAverage += (bass - bassAverage) * 0.08
    const onset = Math.max(0, bass - previousBass)
    const beat = Math.min(1, onset * 6 + Math.max(0, bass - bassAverage) * 3)
    previousBass = bass

    const waveform = new Uint8Array(128)
    const step = Math.max(1, Math.floor(fftSize / waveform.length))
    for (let i = 0; i < waveform.length; i += 1) {
      const sampleIndex = start + i * step
      const sample = sampleIndex >= 0 && sampleIndex < mono.length ? mono[sampleIndex] : 0
      waveform[i] = Math.max(0, Math.min(255, Math.round(sample * 127 + 128)))
    }

    frames.push({
      timeSec: frameIndex / fps,
      frequencyData: spectrum,
      waveformData: waveform,
      bass,
      mid,
      treble,
      rms,
      beat,
    })
  }

  return frames
}

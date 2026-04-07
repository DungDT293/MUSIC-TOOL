/**
 * Chức năng 13 — Pre-computed FFT AudioSource cho export.
 * CapCut-style: decode audio → PCM buffer → inline FFT on-demand.
 *
 * Ưu điểm so với AudioSourceExport (seek-based):
 *   - Không cần HTMLAudioElement / AnalyserNode
 *   - seek() = no-op (0ms thay vì 5-10ms)
 *   - getFrame() = inline FFT trên PCM (~0.05ms)
 *   - Tổng: ~0.05ms/frame thay vì 5-50ms/frame → 100-1000× nhanh hơn
 */

import type { SeekableAudioSource } from './types'

const FFT_SIZE = 2048
const HALF = FFT_SIZE / 2 // 1024 frequency bins

// ── Pre-compute Hann window (avoid recomputing mỗi frame) ──
const hannWindow = new Float32Array(FFT_SIZE)
for (let i = 0; i < FFT_SIZE; i++) {
  hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))
}

// ── Radix-2 Cooley-Tukey FFT in-place ──
function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    while (j & bit) {
      j ^= bit
      bit >>= 1
    }
    j ^= bit
    if (i < j) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  // Butterfly passes
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const ang = (-2 * Math.PI) / len
    const wR = Math.cos(ang)
    const wI = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cR = 1
      let cI = 0
      for (let j = 0; j < half; j++) {
        const a = i + j
        const b = a + half
        const tR = re[b] * cR - im[b] * cI
        const tI = re[b] * cI + im[b] * cR
        re[b] = re[a] - tR
        im[b] = im[a] - tI
        re[a] += tR
        im[a] += tI
        const nR = cR * wR - cI * wI
        cI = cR * wI + cI * wR
        cR = nR
      }
    }
  }
}

// ── AnalyserNode-compatible dB mapping ──
const MIN_DB = -100
const MAX_DB = -30
const DB_RANGE = MAX_DB - MIN_DB

export interface PrecomputedAudioResult {
  source: SeekableAudioSource
  sampleRate: number
  duration: number
}

/**
 * Decode audio URL → PCM buffer → trả về AudioSource với FFT on-demand.
 *
 * ⚠️ CHẬM cho file lớn (62 phút m4a → 10+ phút decode bằng Web Audio API).
 * → Dùng createAudioSourceFromPcm() thay thế (nhận PCM sẵn từ FFmpeg qua IPC).
 */
export async function createAudioSourcePrecomputed(
  audioUrl: string,
): Promise<PrecomputedAudioResult> {
  // ── 1. Fetch audio file ──
  let arrayBuffer: ArrayBuffer
  try {
    const response = await fetch(audioUrl)
    if (!response.ok) throw new Error(`fetch ${response.status}`)
    arrayBuffer = await response.arrayBuffer()
  } catch (fetchErr) {
    // Fallback XHR (app://local-file/ có thể không support fetch)
    arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', audioUrl, true)
      xhr.responseType = 'arraybuffer'
      xhr.onload = () => {
        if (xhr.status === 0 || xhr.status === 200) resolve(xhr.response)
        else reject(new Error(`XHR ${xhr.status}`))
      }
      xhr.onerror = () => reject(new Error('XHR failed'))
      xhr.send()
    })
  }
  console.log('[AudioPrecomputed] Fetched audio:', (arrayBuffer.byteLength / 1024 / 1024).toFixed(1), 'MB')

  // ── 2. Decode to PCM ──
  const audioCtx = new AudioContext()
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
  await audioCtx.close()

  const sampleRate = audioBuffer.sampleRate
  const duration = audioBuffer.duration
  // Mono mix (hoặc chỉ lấy left channel cho nhanh)
  const pcm = audioBuffer.numberOfChannels > 1
    ? mixToMono(audioBuffer)
    : audioBuffer.getChannelData(0)
  console.log('[AudioPrecomputed] Decoded:', duration.toFixed(1), 's @', sampleRate, 'Hz,', pcm.length, 'samples')

  return buildSourceFromPcm(pcm, sampleRate, duration)
}

/**
 * Tạo AudioSource từ PCM Float32Array đã decode sẵn (từ FFmpeg qua IPC).
 * Nhanh: skip fetch + Web Audio decode → chỉ cần wrap FFT logic.
 *
 * @param pcmFloat32 - Mono PCM float32 samples (from FFmpeg f32le output)
 * @param sampleRate - Sample rate (typically 44100)
 * @param duration   - Duration in seconds
 */
export function createAudioSourceFromPcm(
  pcmFloat32: Float32Array,
  sampleRate: number,
  duration: number,
): PrecomputedAudioResult {
  console.log('[AudioPrecomputed] createAudioSourceFromPcm:', duration.toFixed(1), 's @', sampleRate, 'Hz,', pcmFloat32.length, 'samples')
  return buildSourceFromPcm(pcmFloat32, sampleRate, duration)
}

/**
 * IPC-based AudioSource: PCM stays in main process memory.
 * seek() → IPC to get 2048 samples (8KB) → getFrame() computes FFT locally.
 *
 * Ưu điểm: tránh chuyển 600MB+ PCM sang offscreen renderer (gây OOM crash).
 * Chi phí: ~1ms IPC per frame (negligible vs canvas rendering + encoding).
 */
export function createAudioSourceIpc(
  sampleRate: number,
  duration: number,
  fetchSamples: (timeSec: number) => Promise<Float32Array>,
): PrecomputedAudioResult {
  console.log('[AudioPrecomputed] createAudioSourceIpc:', duration.toFixed(1), 's @', sampleRate, 'Hz')

  const fftReal = new Float32Array(FFT_SIZE)
  const fftImag = new Float32Array(FFT_SIZE)
  // Buffer holding the 2048 samples fetched in last seek()
  let currentSamples = new Float32Array(FFT_SIZE)
  // Reusable output buffers — avoid GC pressure
  const freqData = new Uint8Array(HALF)
  const waveData = new Uint8Array(HALF)

  function computeFrameFromSamples(): { frequencyData: Uint8Array; waveformData: Uint8Array } {
    // Apply Hann window to fetched samples → fftReal
    for (let i = 0; i < FFT_SIZE; i++) {
      fftReal[i] = currentSamples[i] * hannWindow[i]
      fftImag[i] = 0
    }

    fftInPlace(fftReal, fftImag)

    // Frequency data: magnitude → dB → byte
    for (let i = 0; i < HALF; i++) {
      const mag = Math.sqrt(fftReal[i] ** 2 + fftImag[i] ** 2) / FFT_SIZE
      const db = mag > 1e-10 ? 20 * Math.log10(mag) : MIN_DB
      freqData[i] = Math.max(0, Math.min(255, Math.round((255 * (db - MIN_DB)) / DB_RANGE)))
    }

    // Waveform data: PCM [-1,1] → [0,255]
    for (let i = 0; i < HALF; i++) {
      waveData[i] = Math.max(0, Math.min(255, Math.round(currentSamples[i] * 128 + 128)))
    }

    return { frequencyData: freqData, waveformData: waveData }
  }

  return {
    source: {
      async seek(timeSec: number): Promise<void> {
        // IPC: get 2048 samples from main process (8KB)
        const samples = await fetchSamples(timeSec)
        // Electron IPC may return a plain object instead of true Float32Array.
        // Always reconstruct to guarantee correct ArrayBuffer type.
        if (samples instanceof Float32Array && samples.length === FFT_SIZE) {
          currentSamples = new Float32Array(samples)
        } else {
          // Fallback: reconstruct from serialized data
          currentSamples = new Float32Array(Object.values(samples as any))
        }
      },
      getFrame(_timeSec: number) {
        return computeFrameFromSamples()
      },
    },
    sampleRate,
    duration,
  }
}

/** Internal: build SeekableAudioSource from PCM + FFT. Shared by both createAudioSource* functions. */
function buildSourceFromPcm(
  pcm: Float32Array,
  sampleRate: number,
  duration: number,
): PrecomputedAudioResult {

  // ── 3. Reusable FFT buffers (avoid allocation mỗi frame) ──
  const fftReal = new Float32Array(FFT_SIZE)
  const fftImag = new Float32Array(FFT_SIZE)
  // Reusable output buffers — avoid GC pressure from 2× new Uint8Array(1024) per frame
  const freqData = new Uint8Array(HALF)
  const waveData = new Uint8Array(HALF)

  function computeFrame(timeSec: number): { frequencyData: Uint8Array; waveformData: Uint8Array } {
    // PCM window centered at timeSec
    const centerSample = Math.floor(timeSec * sampleRate)
    const startSample = Math.max(0, centerSample - HALF)

    // Apply Hann window to PCM segment → fftReal
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = startSample + i
      fftReal[i] = (idx < pcm.length ? pcm[idx] : 0) * hannWindow[i]
      fftImag[i] = 0
    }

    fftInPlace(fftReal, fftImag)

    // ── Frequency data: magnitude → dB → byte (AnalyserNode-compatible) ──
    for (let i = 0; i < HALF; i++) {
      const mag = Math.sqrt(fftReal[i] ** 2 + fftImag[i] ** 2) / FFT_SIZE
      const db = mag > 1e-10 ? 20 * Math.log10(mag) : MIN_DB
      freqData[i] = Math.max(0, Math.min(255, Math.round((255 * (db - MIN_DB)) / DB_RANGE)))
    }

    // ── Waveform data: PCM [-1,1] → [0,255] (AnalyserNode-compatible) ──
    for (let i = 0; i < HALF; i++) {
      const idx = startSample + i
      const sample = idx < pcm.length ? pcm[idx] : 0
      waveData[i] = Math.max(0, Math.min(255, Math.round(sample * 128 + 128)))
    }

    return { frequencyData: freqData, waveformData: waveData }
  }

  return {
    source: {
      async seek(_timeSec: number): Promise<void> {
        /* no-op — PCM đã ở sẵn trong memory, FFT tính on-demand */
      },
      getFrame(timeSec: number) {
        return computeFrame(timeSec)
      },
    },
    sampleRate,
    duration,
  }
}

/** Mix stereo+ AudioBuffer → mono Float32Array */
function mixToMono(buf: AudioBuffer): Float32Array {
  const n = buf.length
  const mono = new Float32Array(n)
  const channels = buf.numberOfChannels
  for (let ch = 0; ch < channels; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < n; i++) {
      mono[i] += data[i]
    }
  }
  const scale = 1 / channels
  for (let i = 0; i < n; i++) {
    mono[i] *= scale
  }
  return mono
}

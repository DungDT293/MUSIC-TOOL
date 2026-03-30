/**
 * Chức năng 13 — Bước 5. AudioSource cho export: seek → settle → get FFT.
 * Không dùng realtime; getFrame(timeSec) deterministic theo timeSec.
 * v2: dùng 'seeked' event thay vì fixed delay 50ms → nhanh ~5-10× hơn.
 */

import type { SeekableAudioSource } from './types'

const FFT_SIZE = 2048
/** Sau seeked event, chờ thêm vài ms để analyser cập nhật buffer. */
const POST_SEEK_SETTLE_MS = 3
const EMPTY_FREQ = new Uint8Array(128)
const EMPTY_WAVE = new Uint8Array(128)

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Tạo AudioSource cho export: dùng một audio element + AnalyserNode.
 * seek(timeSec) đặt currentTime, chờ 'seeked' event, rồi cho nhỏ ms settle.
 */
export function createAudioSourceExport(audioEl: HTMLAudioElement): SeekableAudioSource {
  let ctx: AudioContext | null = null
  let source: MediaElementAudioSourceNode | null = null
  let analyser: AnalyserNode | null = null
  let freqBuffer: Uint8Array = EMPTY_FREQ
  let waveBuffer: Uint8Array = EMPTY_WAVE

  function ensureContext(): void {
    if (analyser) return
    ctx = new AudioContext()
    source = ctx.createMediaElementSource(audioEl)
    analyser = ctx.createAnalyser()
    analyser.fftSize = FFT_SIZE
    analyser.smoothingTimeConstant = 0
    source.connect(analyser)
    analyser.connect(ctx.destination)
    const n = analyser.frequencyBinCount
    freqBuffer = new Uint8Array(n)
    waveBuffer = new Uint8Array(n)
  }

  let lastSeekTime = -1

  return {
    async seek(timeSec: number): Promise<void> {
      // Skip seek nếu đã ở đúng vị trí (sequential frames cách nhau < 1ms)
      if (Math.abs(audioEl.currentTime - timeSec) < 0.001 && lastSeekTime >= 0) return
      audioEl.currentTime = timeSec
      lastSeekTime = timeSec
      // Bug #9 fix: check seeking AFTER adding the listener to eliminate the
      // race where 'seeked' fires before addEventListener is called.
      // Also add a 5s timeout so export never hangs forever.
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          audioEl.removeEventListener('seeked', onSeeked)
          reject(new Error('AudioSourceExport: seek timed out after 5s'))
        }, 5000)
        const onSeeked = () => {
          clearTimeout(timeoutId)
          resolve()
        }
        if (!audioEl.seeking) {
          clearTimeout(timeoutId)
          resolve()
          return
        }
        audioEl.addEventListener('seeked', onSeeked, { once: true })
      })
      // Cho analyser nhỏ ms cập nhật buffer
      await delay(POST_SEEK_SETTLE_MS)
    },

    getFrame(_timeSec: number): { frequencyData: Uint8Array; waveformData: Uint8Array } {
      ensureContext()
      if (!analyser) return { frequencyData: EMPTY_FREQ.slice(), waveformData: EMPTY_WAVE.slice() }
      analyser.getByteFrequencyData(freqBuffer)
      analyser.getByteTimeDomainData(waveBuffer)
      return { frequencyData: freqBuffer.slice(0), waveformData: waveBuffer.slice(0) }
    },
  }
}

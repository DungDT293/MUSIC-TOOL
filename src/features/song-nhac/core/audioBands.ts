import type { SongNhacAudioFrame } from './types'

function averageRange(data: ArrayLike<number>, start: number, end: number): number {
  if (end <= start) return 0
  let sum = 0
  for (let i = start; i < end; i += 1) sum += Number(data[i] ?? 0)
  return sum / (end - start) / 255
}

export function audioFrameFromAnalyser(
  timeSec: number,
  frequencyData: Uint8Array,
  waveformData: Uint8Array,
  previousBass = 0,
): SongNhacAudioFrame {
  const size = frequencyData.length
  const bass = averageRange(frequencyData, 0, Math.max(1, Math.floor(size * 0.08)))
  const mid = averageRange(frequencyData, Math.floor(size * 0.08), Math.max(1, Math.floor(size * 0.25)))
  const treble = averageRange(frequencyData, Math.floor(size * 0.25), size)

  let rmsSum = 0
  for (let i = 0; i < waveformData.length; i += 1) {
    const sample = (Number(waveformData[i] ?? 128) - 128) / 128
    rmsSum += sample * sample
  }
  const rms = waveformData.length ? Math.sqrt(rmsSum / waveformData.length) : 0
  const beat = Math.max(0, Math.min(1, bass - previousBass > 0.08 ? bass * 1.7 : bass * 0.8))

  return { timeSec, frequencyData, waveformData, bass, mid, treble, rms, beat }
}

export function emptyAudioFrame(timeSec = 0): SongNhacAudioFrame {
  return audioFrameFromAnalyser(timeSec, new Uint8Array(128), new Uint8Array(128).fill(128))
}

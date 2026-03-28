/**
 * Chức năng 13 — Bước 4. Beat detection đơn giản cho timeline.
 * Energy envelope (RMS theo block) + rolling average + threshold → timeSec[].
 * Chỉ để tham chiếu vị trí nhịp, không cần chính xác như live FFT.
 */

const BLOCK_MS = 50
const MIN_BPM = 60
const MAX_BPM = 180
const THRESHOLD_RATIO = 1.4
const MIN_INTERVAL_MS = (60 / MAX_BPM) * 1000

export function computeBeats(
  channelData: Float32Array,
  sampleRate: number,
  duration: number
): number[] {
  if (channelData.length === 0 || duration <= 0) return []

  const blockSamples = Math.max(256, Math.floor((sampleRate * BLOCK_MS) / 1000))
  const numBlocks = Math.floor(channelData.length / blockSamples)
  const energy: number[] = []

  for (let i = 0; i < numBlocks; i++) {
    let sum = 0
    const start = i * blockSamples
    for (let j = 0; j < blockSamples; j++) {
      const v = channelData[start + j] ?? 0
      sum += v * v
    }
    energy.push(Math.sqrt(sum / blockSamples))
  }

  const winsize = Math.max(3, Math.floor(numBlocks / 20))
  const beats: number[] = []
  let lastBeatTimeMs = -MIN_INTERVAL_MS * 2

  for (let i = winsize; i < numBlocks - winsize; i++) {
    let sum = 0
    for (let k = -winsize; k <= winsize; k++) {
      sum += energy[i + k] ?? 0
    }
    const avg = sum / (2 * winsize + 1)
    const e = energy[i] ?? 0
    if (avg > 0 && e >= avg * THRESHOLD_RATIO) {
      const timeMs = (i * blockSamples / sampleRate) * 1000
      if (timeMs - lastBeatTimeMs >= MIN_INTERVAL_MS) {
        beats.push(timeMs / 1000)
        lastBeatTimeMs = timeMs
      }
    }
  }

  return beats
}

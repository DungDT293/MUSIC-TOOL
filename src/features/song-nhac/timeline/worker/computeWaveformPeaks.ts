/**
 * Chức năng 13 — Bước 4. Waveform peaks từ channel data.
 * Chia N window, mỗi window max(|sample|), normalize 0..1.
 * Không FFT; chỉ dùng trong Worker.
 */

/**
 * @param channelData mono hoặc channel 0
 * @param duration duration in seconds
 * @param resolution peaks per minute (default 1000)
 */
export function computeWaveformPeaks(
  channelData: Float32Array,
  duration: number,
  resolution: number = 1000
): Float32Array {
  const totalSamples = channelData.length
  if (totalSamples === 0 || duration <= 0) {
    return new Float32Array(0)
  }

  const peaksPerMinute = Math.max(100, resolution)
  const numPeaks = Math.max(2, Math.floor((peaksPerMinute * duration) / 60))
  const samplesPerWindow = totalSamples / numPeaks
  const peaks = new Float32Array(numPeaks)

  for (let i = 0; i < numPeaks; i++) {
    const start = Math.floor(i * samplesPerWindow)
    const end = Math.min(
      Math.floor((i + 1) * samplesPerWindow),
      totalSamples
    )
    let max = 0
    for (let j = start; j < end; j++) {
      const v = Math.abs(channelData[j]!)
      if (v > max) max = v
    }
    peaks[i] = max
  }

  const globalMax = Math.max(...Array.from(peaks))
  if (globalMax > 0) {
    for (let i = 0; i < peaks.length; i++) {
      peaks[i] = peaks[i]! / globalMax
    }
  }

  return peaks
}

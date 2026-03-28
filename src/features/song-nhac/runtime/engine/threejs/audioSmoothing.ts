/**
 * Audio Smoothing & Frequency Mapping for Avee-Player-quality visuals.
 *
 * Two critical algorithms:
 * 1. Asymmetric attack/decay EMA  — fast rise (snappy), slow fall (natural)
 * 2. Logarithmic frequency mapping — bass gets more bars (perceptually correct)
 */

/** Pre-allocated smoothing buffer (survives across frames). */
export class AudioSmoother {
  private smoothed: Float32Array
  private readonly barCount: number
  private readonly attackAlpha: number
  private readonly decayAlpha: number
  /** Log-to-linear bin mapping table (barIndex → fftBin). */
  private binMap: Uint16Array

  constructor(
    barCount: number = 128,
    attackAlpha: number = 0.35,
    decayAlpha: number = 0.08
  ) {
    this.barCount = barCount
    this.attackAlpha = attackAlpha
    this.decayAlpha = decayAlpha
    this.smoothed = new Float32Array(barCount)
    this.binMap = new Uint16Array(barCount)
    // binMap will be built on first update() call when we know fftSize
  }

  /**
   * Build log frequency → linear bin mapping.
   * Maps barCount bars logarithmically across 20Hz–20kHz range.
   */
  private buildBinMap(totalBins: number, sampleRate: number = 44100): void {
    const minFreq = 20
    const maxFreq = Math.min(20000, sampleRate / 2)
    const logMin = Math.log10(minFreq)
    const logMax = Math.log10(maxFreq)

    for (let i = 0; i < this.barCount; i++) {
      const logFreq = logMin + (i / this.barCount) * (logMax - logMin)
      const freq = Math.pow(10, logFreq)
      const bin = Math.round((freq / (sampleRate / 2)) * totalBins)
      this.binMap[i] = Math.min(bin, totalBins - 1)
    }
  }

  /**
   * Process raw FFT data → smoothed bar values (0–1).
   * Returns the internal Float32Array (DO NOT allocate new arrays).
   */
  update(rawFFT: Uint8Array): Float32Array {
    const totalBins = rawFFT.length
    if (totalBins === 0) return this.smoothed

    // Rebuild bin map if FFT size changed
    if (this.binMap[0] === 0 && this.binMap[this.barCount - 1] === 0) {
      this.buildBinMap(totalBins)
    }

    for (let i = 0; i < this.barCount; i++) {
      // Log-mapped bin lookup
      const bin = this.binMap[i]!
      // Average nearby bins for smoother result
      let sum = 0
      let count = 0
      const nextBin = i < this.barCount - 1 ? this.binMap[i + 1]! : bin + 1
      const range = Math.max(1, nextBin - bin)
      for (let j = 0; j < range && bin + j < totalBins; j++) {
        sum += rawFFT[bin + j]!
        count++
      }
      const target = count > 0 ? sum / count / 255 : 0

      // Asymmetric EMA: fast attack, slow decay
      const current = this.smoothed[i]!
      if (target > current) {
        // Attack (fast rise)
        this.smoothed[i] = current + (target - current) * this.attackAlpha
      } else {
        // Decay (slow fall) — this creates the Avee Player "drooping" effect
        this.smoothed[i] = current + (target - current) * this.decayAlpha
      }
    }

    return this.smoothed
  }

  /** Get bar count */
  getBarCount(): number {
    return this.barCount
  }

  /** Reset all smoothed values to zero. */
  reset(): void {
    this.smoothed.fill(0)
  }

  /**
   * Extract band energies from smoothed data.
   * Returns normalized 0–1 values for bass, mid, treble.
   */
  getBandEnergies(): { bass: number; mid: number; treble: number; peak: number } {
    const n = this.barCount
    const bassEnd = Math.floor(n * 0.12)   // ~20-250Hz
    const midEnd = Math.floor(n * 0.45)    // ~250-2kHz
    // treble: rest                         // ~2k-20kHz

    let bassSum = 0, midSum = 0, trebleSum = 0, peak = 0
    for (let i = 0; i < n; i++) {
      const v = this.smoothed[i]!
      if (v > peak) peak = v
      if (i < bassEnd) bassSum += v
      else if (i < midEnd) midSum += v
      else trebleSum += v
    }

    const bassCount = Math.max(1, bassEnd)
    const midCount = Math.max(1, midEnd - bassEnd)
    const trebleCount = Math.max(1, n - midEnd)

    return {
      bass: bassSum / bassCount,
      mid: midSum / midCount,
      treble: trebleSum / trebleCount,
      peak,
    }
  }
}

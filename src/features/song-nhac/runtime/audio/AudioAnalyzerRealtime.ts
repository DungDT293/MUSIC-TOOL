/**
 * Chức năng 13 — AudioAnalyzer (preview-only).
 * AudioContext + AnalyserNode; FFT pull trong RAF, không emit/store.
 */

const DEFAULT_FFT_SIZE = 2048
const DEFAULT_FREQ_BINS = 128

export class AudioAnalyzerRealtime {
  private ctx: AudioContext
  private source: MediaElementAudioSourceNode
  private analyser: AnalyserNode
  private freqBuffer: Uint8Array
  private waveformBuffer: Uint8Array

  constructor(audioEl: HTMLAudioElement) {
    this.ctx = new AudioContext()
    this.source = this.ctx.createMediaElementSource(audioEl)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = DEFAULT_FFT_SIZE
    this.analyser.smoothingTimeConstant = 0.8
    this.source.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)

    const freqBinCount = this.analyser.frequencyBinCount
    this.freqBuffer = new Uint8Array(freqBinCount)
    this.waveformBuffer = new Uint8Array(freqBinCount)
  }

  getFrequencyData(): Uint8Array {
    // Auto-resume context if browser suspended it (autoplay policy)
    if (this.ctx.state === 'suspended') this.ctx.resume()
    this.analyser.getByteFrequencyData(this.freqBuffer)
    return this.freqBuffer
  }

  getWaveformData(): Uint8Array {
    if (this.ctx.state === 'suspended') this.ctx.resume()
    this.analyser.getByteTimeDomainData(this.waveformBuffer)
    return this.waveformBuffer
  }

  resume(): void {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
  }

  destroy(): void {
    try {
      this.source.disconnect()
      this.analyser.disconnect()
      this.ctx.close()
    } catch (_) {
      // ignore
    }
  }
}

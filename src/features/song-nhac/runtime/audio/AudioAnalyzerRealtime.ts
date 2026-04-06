/**
 * Chức năng 13 — AudioAnalyzer (preview-only).
 * AudioContext + AnalyserNode; FFT pull trong RAF, không emit/store.
 */

const DEFAULT_FFT_SIZE = 2048

/** Empty fallback returned after destroy to avoid caller crashes. */
const EMPTY_BUFFER = new Uint8Array(128)

export class AudioAnalyzerRealtime {
  private ctx: AudioContext | null
  private source: MediaElementAudioSourceNode | null
  private analyser: AnalyserNode | null
  private freqBuffer: Uint8Array
  private waveformBuffer: Uint8Array
  private _resuming = false
  private _destroyed = false

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

  /** Public accessor — engines use this instead of `(audio as any).ctx`. */
  getAudioContext(): AudioContext | null {
    return this.ctx
  }

  /** Public accessor — engines use this instead of `(audio as any).source`. */
  getSourceNode(): MediaElementAudioSourceNode | null {
    return this.source
  }

  getFrequencyData(): Uint8Array {
    if (this._destroyed || !this.ctx || !this.analyser) return EMPTY_BUFFER
    // Auto-resume context if browser suspended it (autoplay policy)
    if (this.ctx.state === 'suspended' && !this._resuming) {
      this._resuming = true
      this.ctx.resume().finally(() => { this._resuming = false })
    }
    this.analyser.getByteFrequencyData(this.freqBuffer)
    return this.freqBuffer
  }

  getWaveformData(): Uint8Array {
    if (this._destroyed || !this.ctx || !this.analyser) return EMPTY_BUFFER
    if (this.ctx.state === 'suspended' && !this._resuming) {
      this._resuming = true
      this.ctx.resume().finally(() => { this._resuming = false })
    }
    this.analyser.getByteTimeDomainData(this.waveformBuffer)
    return this.waveformBuffer
  }

  resume(): void {
    if (this._destroyed || !this.ctx) return
    if (this.ctx.state === 'suspended' && !this._resuming) {
      this._resuming = true
      this.ctx.resume().finally(() => { this._resuming = false })
    }
  }

  destroy(): void {
    this._destroyed = true
    try {
      this.source?.disconnect()
      this.analyser?.disconnect()
      this.ctx?.close().catch(() => {})
    } catch (_) {
      // ignore
    }
    this.source = null
    this.analyser = null
    this.ctx = null
  }
}

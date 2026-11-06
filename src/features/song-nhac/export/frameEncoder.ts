export type FrameCodec = 'h264' | 'hevc'

export interface FrameEncoderOptions {
  width: number
  height: number
  fps: number
  /** Target bitrate in bits per second. */
  bitrate: number
  /** Output bitstream flavour; both are Annex-B so FFmpeg can copy them. */
  codec?: FrameCodec
  onChunk: (chunk: Uint8Array) => void
}

const CODEC_CANDIDATES: Record<FrameCodec, string[]> = {
  // High 4.0 first, then Main, then Baseline for old GPUs.
  h264: ['avc1.640028', 'avc1.4d4028', 'avc1.42e01f'],
  // Main profile, level 4.0 / 4.1 — enough for 1080p30 and 1440p30.
  hevc: ['hvc1.1.6.L120.90', 'hvc1.1.6.L123.B0', 'hev1.1.6.L120.90'],
}

/**
 * Thin WebCodecs wrapper that turns canvases into an Annex-B bitstream.
 *
 * Annex-B matters: the chunks are appended to a raw .h264/.265 file and handed to
 * FFmpeg with `-c:v copy`, so muxing never spends a second generation of compression.
 */
export class FrameEncoder {
  private encoder: VideoEncoder | null = null
  private readonly options: FrameEncoderOptions
  private readonly requestedCodec: FrameCodec
  private codec = ''

  constructor(options: FrameEncoderOptions) {
    this.options = options
    this.requestedCodec = options.codec ?? 'h264'
  }

  static isSupported(): boolean {
    return typeof globalThis.VideoEncoder !== 'undefined' && typeof globalThis.VideoFrame !== 'undefined'
  }

  /** Probes one configuration without creating an encoder. */
  static async probe(codec: FrameCodec, width: number, height: number, fps: number, bitrate: number): Promise<boolean> {
    if (!FrameEncoder.isSupported()) return false
    for (const candidate of CODEC_CANDIDATES[codec]) {
      try {
        const support = await VideoEncoder.isConfigSupported({ codec: candidate, width, height, framerate: fps, bitrate })
        if (support.supported) return true
      } catch {
        // try next
      }
    }
    return false
  }

  async init(): Promise<boolean> {
    if (!FrameEncoder.isSupported()) return false
    for (const codec of CODEC_CANDIDATES[this.requestedCodec]) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec,
          width: this.options.width,
          height: this.options.height,
          bitrate: this.options.bitrate,
          framerate: this.options.fps,
        })
        if (support.supported) {
          this.codec = codec
          break
        }
      } catch {
        // try next codec
      }
    }
    if (!this.codec) return false

    this.encoder = new VideoEncoder({
      output: (chunk) => {
        const buffer = new Uint8Array(chunk.byteLength)
        chunk.copyTo(buffer)
        this.options.onChunk(buffer)
      },
      error: (error) => {
        console.error('[FrameEncoder] encoder error:', error)
      },
    })
    const base: VideoEncoderConfig = {
      codec: this.codec,
      width: this.options.width,
      height: this.options.height,
      bitrate: this.options.bitrate,
      framerate: this.options.fps,
      latencyMode: 'quality',
    }
    this.encoder.configure(
      (this.requestedCodec === 'hevc'
        ? { ...base, hevc: { format: 'annexb' } }
        : { ...base, avc: { format: 'annexb' } }) as VideoEncoderConfig,
    )
    return true
  }

  /** Codec actually selected (may differ from the request when a profile is unsupported). */
  get selectedCodec(): string {
    return this.codec
  }

  get queueSize(): number {
    return this.encoder?.encodeQueueSize ?? 0
  }

  get configured(): boolean {
    return this.encoder !== null
  }

  encode(source: HTMLCanvasElement | OffscreenCanvas, frameIndex: number, keyFrame: boolean): void {
    if (!this.encoder) return
    const timestamp = Math.round((frameIndex * 1e6) / this.options.fps)
    const frame = new VideoFrame(source, {
      timestamp,
      duration: Math.round(1e6 / this.options.fps),
    })
    this.encoder.encode(frame, { keyFrame })
    frame.close()
  }

  async flush(): Promise<void> {
    if (!this.encoder) return
    await this.encoder.flush()
  }

  close(): void {
    if (!this.encoder) return
    try {
      this.encoder.close()
    } catch {
      // already closed
    }
    this.encoder = null
  }
}

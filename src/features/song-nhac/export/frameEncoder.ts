export interface FrameEncoderOptions {
  width: number
  height: number
  fps: number
  /** Target bitrate in bits per second. */
  bitrate: number
  onChunk: (chunk: Uint8Array) => void
}

const CODEC_CANDIDATES = ['avc1.640028', 'avc1.4d4028', 'avc1.42e01f']

/**
 * Thin WebCodecs wrapper that turns canvases into an Annex-B H.264 stream.
 *
 * Annex-B matters: the chunks are appended to a .h264 file and handed to FFmpeg
 * with `-c:v copy`, so no second generation of compression is spent on muxing.
 */
export class FrameEncoder {
  private encoder: VideoEncoder | null = null
  private readonly options: FrameEncoderOptions
  private codec = ''

  constructor(options: FrameEncoderOptions) {
    this.options = options
  }

  static isSupported(): boolean {
    return typeof globalThis.VideoEncoder !== 'undefined' && typeof globalThis.VideoFrame !== 'undefined'
  }

  async init(): Promise<boolean> {
    if (!FrameEncoder.isSupported()) return false
    for (const codec of CODEC_CANDIDATES) {
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
    this.encoder.configure({
      codec: this.codec,
      width: this.options.width,
      height: this.options.height,
      bitrate: this.options.bitrate,
      framerate: this.options.fps,
      latencyMode: 'quality',
      avc: { format: 'annexb' },
    })
    return true
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

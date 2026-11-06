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

/**
 * H.264 levels cap resolution: a Level 4.0 stream cannot carry 1440p or 4K, and
 * Chromium rejects the config instead of silently encoding. Pick the level from the
 * pixel count so 1440p/4K do not fail with "unsupported".
 */
function h264Candidates(width: number, height: number): string[] {
  const pixels = width * height
  if (pixels > 2560 * 1440) {
    // 4K: High 5.2, High 5.1, High 5.0 (Turing+ and most software encoders take 5.1).
    return ['avc1.640034', 'avc1.640033', 'avc1.640032']
  }
  if (pixels > 1920 * 1088) {
    // 1440p: High 5.0, then Main 4.2 as a fallback.
    return ['avc1.640032', 'avc1.64002a', 'avc1.4d4028']
  }
  return ['avc1.640028', 'avc1.4d4028', 'avc1.42e01f', 'avc1.42c01f']
}

function hevcCandidates(width: number, height: number): string[] {
  const pixels = width * height
  if (pixels > 2560 * 1440) return ['hvc1.1.6.L150.90', 'hvc1.1.6.L153.B0', 'hev1.1.6.L150.90']
  if (pixels > 1920 * 1088) return ['hvc1.1.6.L123.B0', 'hvc1.1.6.L120.90']
  return ['hvc1.1.6.L120.90', 'hvc1.1.6.L123.B0', 'hev1.1.6.L120.90']
}

function candidatesFor(codec: FrameCodec, width: number, height: number): string[] {
  return codec === 'hevc' ? hevcCandidates(width, height) : h264Candidates(width, height)
}

interface Attempt {
  codec: string
  label: string
  supported: boolean
  reason?: string
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
  private attempts: Attempt[] = []
  private lastError = ''

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
    for (const candidate of candidatesFor(codec, width, height)) {
      try {
        const support = await VideoEncoder.isConfigSupported({ codec: candidate, width, height, framerate: fps, bitrate })
        if (support.supported) return true
      } catch {
        // try next
      }
    }
    return false
  }

  /** Why init() failed, with one line per attempted configuration. */
  get diagnostics(): string {
    if (!this.lastError) return ''
    return `${this.lastError} (${this.attempts.map((item) => `${item.codec}: ${item.supported ? 'ok' : item.reason ?? 'no'}`).join(' | ')})`
  }

  async init(): Promise<boolean> {
    if (!FrameEncoder.isSupported()) {
      this.lastError = 'Trình duyệt không có WebCodecs (VideoEncoder undefined)'
      return false
    }
    const { width, height, fps } = this.options
    // A NaN/0 bitrate makes isConfigSupported throw, so clamp before asking.
    const bitrate = Number.isFinite(this.options.bitrate) && this.options.bitrate > 0 ? Math.round(this.options.bitrate) : 6_000_000

    // Never fall back to the other flavour: the muxer already picked a demuxer from
    // the request, so an H.264 stream in a .265 file would be an unplayable result.
    const order: FrameCodec[] = [this.requestedCodec]
    const variants: Array<{ label: string; extra: Partial<VideoEncoderConfig> }> = [
      { label: 'quality', extra: { latencyMode: 'quality' } },
      { label: 'realtime', extra: { latencyMode: 'realtime' } },
      { label: 'software', extra: { hardwareAcceleration: 'prefer-software' } },
    ]

    for (const flavour of order) {
      for (const candidate of candidatesFor(flavour, width, height)) {
        for (const variant of variants) {
          const config = {
            codec: candidate,
            width,
            height,
            bitrate,
            framerate: fps,
            ...variant.extra,
          } as VideoEncoderConfig
          try {
            const support = await VideoEncoder.isConfigSupported(config)
            if (!support.supported) {
              this.attempts.push({ codec: candidate, label: variant.label, supported: false, reason: 'unsupported' })
              continue
            }
            try {
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
              this.encoder.configure(
                (flavour === 'hevc'
                  ? { ...config, hevc: { format: 'annexb' } }
                  : { ...config, avc: { format: 'annexb' } }) as VideoEncoderConfig,
              )
              this.codec = candidate
              this.attempts.push({ codec: candidate, label: variant.label, supported: true })
              return true
            } catch (error) {
              this.attempts.push({
                codec: candidate,
                label: variant.label,
                supported: false,
                reason: `configure: ${error instanceof Error ? error.message : String(error)}`,
              })
            }
          } catch (error) {
            this.attempts.push({
              codec: candidate,
              label: variant.label,
              supported: false,
              reason: `isConfigSupported: ${error instanceof Error ? error.message : String(error)}`,
            })
          }
        }
      }
    }

    this.lastError = `Không cấu hình được encoder ${this.requestedCodec.toUpperCase()} cho ${width}x${height}@${fps} (${Math.round(bitrate / 1000)} kbps)`
    return false
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

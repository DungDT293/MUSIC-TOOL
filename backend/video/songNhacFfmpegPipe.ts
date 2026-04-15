/**
 * songNhacFfmpegPipe.ts
 * FFmpeg pipe-based renderer for Sóng nhạc export.
 * Receives JPEG frames from the renderer process via IPC,
 * pipes them into FFmpeg stdin, and muxes with audio.
 *
 * v2: NVENC GPU encoding support — pipe input không cần hwaccel decoder,
 *     chỉ dùng GPU encoder (h264_nvenc) → nhanh gấp 3-8x so với libx264.
 *     Auto-detect GPU → fallback libx264 nếu không có NVENC.
 */

import { spawn, type ChildProcess } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import { getGpuInfo, type GpuEncoder } from '../utils/gpuDetection'
import fs from 'fs'
import path from 'path'

export interface SongNhacExportOptions {
  outputPath: string
  width: number
  height: number
  fps: number
  audioPaths: string[]
  totalFrames: number
  // Video encoding
  videoBitrate?: string
  preset?: string
  crf?: number
  // GPU encoding
  useGpu?: boolean  // true = try GPU, false = force CPU
  /**
   * WebCodecs mode: renderer sends pre-encoded H.264 Annex B stream.
   * FFmpeg uses -f h264 -c:v copy (just mux, no re-encode).
   */
  webCodecsMode?: boolean
}

export interface SongNhacFfmpegPipeResult {
  outputPath: string
  code: number | null
  usedEncoder: string
}

/**
 * Build encoder args based on GPU availability.
 * Pipe input (image2pipe) does NOT need -hwaccel (no GPU decoder needed).
 * But we CAN use h264_nvenc as the OUTPUT encoder — GPU does the heavy lifting.
 *
 * Uses quality-based encoding (CRF/CQ) — encoder auto-adjusts bitrate per frame.
 * Static scenes get low bitrate, complex scenes get high → smaller files, same quality.
 */
function buildEncoderArgs(
  gpuEncoder: GpuEncoder,
  useGpu: boolean,
  preset: string,
  crf: number,
  videoBitrate: string,
): { encoderArgs: string[], usedEncoder: string } {
  // GPU path: NVENC — nhanh gấp 3-8x, chất lượng tốt
  if (useGpu && gpuEncoder === 'nvenc') {
    // Map preset names to NVENC preset
    let nvPreset = 'p4' // balanced
    if (preset === 'ultrafast' || preset === 'veryfast') nvPreset = 'p1'
    else if (preset === 'fast') nvPreset = 'p2'
    else if (preset === 'medium') nvPreset = 'p4'
    else if (preset === 'slow') nvPreset = 'p6'

    // CQ (constant quality) mode — no fixed bitrate cap.
    // Let encoder decide bitrate based on content complexity.
    // maxrate as safety ceiling to prevent extreme spikes.
    const maxBitrate = parseInt(videoBitrate) || 8000
    return {
      encoderArgs: [
        '-c:v', 'h264_nvenc',
        '-preset', nvPreset,
        '-rc', 'vbr',
        '-cq', String(Math.max(18, crf)),
        '-maxrate', `${maxBitrate}k`,
        '-bufsize', `${maxBitrate * 2}k`,
        '-gpu', '0',
        '-profile:v', 'high',
        '-pix_fmt', 'yuv420p',
      ],
      usedEncoder: `h264_nvenc (${nvPreset}, CQ ${Math.max(18, crf)})`,
    }
  }

  // GPU path: AMF (AMD)
  if (useGpu && gpuEncoder === 'amf') {
    return {
      encoderArgs: [
        '-c:v', 'h264_amf',
        '-quality', preset === 'ultrafast' || preset === 'veryfast' ? 'speed' : 'balanced',
        '-rc', 'vbr_peak',
        '-b:v', videoBitrate,
        '-maxrate', videoBitrate,
        '-pix_fmt', 'yuv420p',
      ],
      usedEncoder: 'h264_amf',
    }
  }

  // CPU fallback: libx264 — pure CRF mode (no -b:v)
  // CRF = constant quality factor. Encoder auto-picks bitrate.
  // Lower CRF = better quality, bigger file. 17-18 is visually lossless.
  return {
    encoderArgs: [
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', String(crf),
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
    ],
    usedEncoder: `libx264 (${preset}, CRF ${crf})`,
  }
}

/**
 * Start FFmpeg process that accepts frames via stdin pipe.
 * Two modes:
 *   1. JPEG mode (default): image2pipe → NVENC/libx264 encode
 *   2. WebCodecs mode: pre-encoded H.264 Annex B → -c:v copy (just mux)
 */
export async function startFfmpegPipe(options: SongNhacExportOptions): Promise<{
  ffmpegProc: ChildProcess
  waitForExit: () => Promise<SongNhacFfmpegPipeResult>
  usedEncoder: string
}> {
  const paths = getFfmpegPaths()
  const defaultFfmpegPath = (paths as any).ffmpeg ?? (paths as any).ffmpegPath

  const {
    outputPath,
    width,
    height,
    fps,
    audioPaths = [],
    videoBitrate = '8000k',
    preset = 'medium',
    crf = 18,
    useGpu = true,
    webCodecsMode = false,
  } = options

  // Ensure even dimensions — encoder requires width & height divisible by 2
  const safeWidth = width % 2 === 0 ? width : width + 1
  const safeHeight = height % 2 === 0 ? height : height + 1

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  let usedEncoder: string
  let inputArgs: string[]
  let videoOutputArgs: string[]
  let ffmpegPath = defaultFfmpegPath

  if (webCodecsMode) {
    // ── WebCodecs mode: H.264 Annex B stream from renderer ──
    // FFmpeg just muxes into MP4, no re-encoding needed
    usedEncoder = 'WebCodecs H.264 (copy)'
    inputArgs = [
      '-y',
      '-f', 'h264',           // Raw H.264 Annex B bitstream
      '-r', String(fps),
      '-i', 'pipe:0',         // stdin
    ]
    videoOutputArgs = [
      '-c:v', 'copy',         // Stream copy — no re-encode, near zero CPU
    ]
    console.log(`[SongNhacFFmpeg] ★ WebCodecs mode: H.264 stream copy (no re-encode)`)
  } else {
    // ── JPEG mode: image2pipe → NVENC/libx264 encode ──
    // Detect GPU
    let gpuEncoder: GpuEncoder = 'cpu'
    if (useGpu) {
      try {
        const gpuInfo = await getGpuInfo()
        if (gpuInfo.available) {
          gpuEncoder = gpuInfo.encoder
          ffmpegPath = gpuInfo.ffmpegPath || defaultFfmpegPath
          console.log(`[SongNhacFFmpeg] GPU detected: ${gpuInfo.name ?? gpuInfo.encoder}`)
        }
      } catch (err) {
        console.warn('[SongNhacFFmpeg] GPU detection failed, using CPU:', err)
      }
    }

    const built = buildEncoderArgs(gpuEncoder, useGpu, preset, crf, videoBitrate)
    usedEncoder = built.usedEncoder

    inputArgs = [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'bmp',
      '-r', String(fps),
      '-i', 'pipe:0',
    ]
    videoOutputArgs = [
      // Scale to safe (even) dimensions
      '-vf', `scale=${safeWidth}:${safeHeight}`,
      ...built.encoderArgs,
    ]
  }

  console.log(`[SongNhacFFmpeg] Using encoder: ${usedEncoder}`)

  // Add audio inputs
  for (const audioPath of audioPaths) {
    inputArgs.push('-i', audioPath)
  }

  const outputArgs: string[] = [
    // Video output args (mode-dependent: WebCodecs copy or JPEG encode)
    ...videoOutputArgs,
    // Map video stream
    '-map', '0:v',
  ]

  // Audio encoding — only when audio inputs exist
  if (audioPaths.length > 0) {
    outputArgs.push('-c:a', 'aac', '-b:a', '192k')
  } else {
    outputArgs.push('-an')
  }

  // Map audio streams
  for (let i = 0; i < audioPaths.length; i++) {
    outputArgs.push('-map', `${i + 1}:a`)
  }

  // Shortest flag to stop when shortest stream ends
  if (audioPaths.length > 0) {
    outputArgs.push('-shortest')
  }

  outputArgs.push(
    '-movflags', '+faststart',
    outputPath
  )

  const args = [...inputArgs, ...outputArgs]

  console.log('[SongNhacFFmpeg] Starting FFmpeg pipe:', ffmpegPath, args.join(' '))

  const ffmpegProc = spawn(ffmpegPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  // Log stderr (FFmpeg progress)
  let stderrData = ''
  ffmpegProc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stderrData += text
    // Only log progress lines (frame=...)
    if (text.includes('frame=') || text.includes('speed=')) {
      const frameMatch = text.match(/frame=\s*(\d+)/)
      if (frameMatch) {
        console.log(`[SongNhacFFmpeg] Encoding frame ${frameMatch[1]}/${options.totalFrames}`)
      }
    }
  })

  // Error handling — single listener to avoid duplicate
  let exitResult: SongNhacFfmpegPipeResult | null = null
  let exitError: Error | null = null
  let exitResolve: ((r: SongNhacFfmpegPipeResult) => void) | null = null
  let exitReject: ((e: Error) => void) | null = null

  ffmpegProc.once('error', (err) => {
    console.error('[SongNhacFFmpeg] Process error:', err.message)
    exitError = err
    if (exitReject) exitReject(err)
  })

  ffmpegProc.once('close', (code, _signal) => {
    if (code !== 0 && code !== null) {
      console.warn(`[SongNhacFFmpeg] Exited with code ${code}`)
      const lastLines = stderrData.split('\n').slice(-5).join('\n')
      if (lastLines) console.warn('[SongNhacFFmpeg] Last stderr:', lastLines)
    }
    exitResult = { outputPath, code, usedEncoder }
    if (exitResolve) exitResolve(exitResult)
  })

  const waitForExit = (): Promise<SongNhacFfmpegPipeResult> => {
    if (exitResult) return Promise.resolve(exitResult)
    if (exitError) return Promise.reject(exitError)
    return new Promise((resolve, reject) => {
      exitResolve = resolve
      exitReject = reject
    })
  }

  return { ffmpegProc, waitForExit, usedEncoder }
}

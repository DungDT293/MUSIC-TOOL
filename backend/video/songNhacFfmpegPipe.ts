/**
 * songNhacFfmpegPipe.ts
 * FFmpeg pipe-based renderer for Sóng nhạc export.
 * Receives raw RGBA frames from the renderer process via IPC,
 * pipes them into FFmpeg stdin, and muxes with audio.
 */

import { spawn, type ChildProcess } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
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
}

export interface SongNhacFfmpegPipeResult {
  outputPath: string
  code: number | null
}

/**
 * Start FFmpeg process that accepts raw RGBA frames via stdin pipe.
 * No GPU hwaccel for pipe input (not supported).
 */
export function startFfmpegPipe(options: SongNhacExportOptions): {
  ffmpegProc: ChildProcess
  waitForExit: () => Promise<SongNhacFfmpegPipeResult>
} {
  const paths = getFfmpegPaths()
  const ffmpegPath = (paths as any).ffmpeg ?? (paths as any).ffmpegPath

  const {
    outputPath,
    width,
    height,
    fps,
    audioPaths,
    videoBitrate = '8000k',
    preset = 'medium',
    crf = 18,
  } = options

  // Ensure even dimensions — libx264 yuv420p requires width & height divisible by 2
  const safeWidth = width % 2 === 0 ? width : width + 1
  const safeHeight = height % 2 === 0 ? height : height + 1

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // Build FFmpeg args
  // NOTE: Renderer captures canvas as JPEG (ArrayBuffer) and sends via IPC.
  // Use image2pipe/mjpeg decoder — NOT rawvideo/rgba.
  const inputArgs: string[] = [
    '-y',
    // JPEG frames piped from renderer (canvas.toBlob('image/jpeg'))
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-r', String(fps),
    '-i', 'pipe:0', // stdin
  ]

  // Add audio inputs
  for (const audioPath of audioPaths) {
    inputArgs.push('-i', audioPath)
  }

  const outputArgs: string[] = [
    // Scale to safe (even) dimensions — libx264 yuv420p requires width & height divisible by 2
    '-vf', `scale=${safeWidth}:${safeHeight}`,
    // Video encoding (software x264 — pipe input không hỗ trợ hwaccel)
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', String(crf),
    '-b:v', videoBitrate,
    '-pix_fmt', 'yuv420p',
    // Audio
    '-c:a', 'aac',
    '-b:a', '192k',
    // Map streams
    '-map', '0:v',
  ]

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

  ffmpegProc.once('close', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.warn(`[SongNhacFFmpeg] Exited with code ${code}`)
      // Log last stderr for debugging
      const lastLines = stderrData.split('\n').slice(-5).join('\n')
      if (lastLines) console.warn('[SongNhacFFmpeg] Last stderr:', lastLines)
    }
    exitResult = { outputPath, code }
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

  return { ffmpegProc, waitForExit }
}

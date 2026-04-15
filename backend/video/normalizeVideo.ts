import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import { getGpuInfo } from '../utils/gpuDetection'
import { validateInputFiles } from './videoUtils'
import { videoJobManager } from './videoJobManager'
import { buildNormalizeVfFilter } from './utils/normalizeVf'

export interface NormalizeVideoRequest {
  inputFiles: string[]
  outputDir: string
  useGpu?: boolean
  requestId?: string
  targetResolution?: string  // '1920x1080' | etc.
  targetFps?: string          // '24' | '25' | '30000/1001' | '30' | etc.
}

export interface NormalizeVideoResult {
  requestId: string
  outputPaths: string[]
  success: boolean
  error?: string
  processed: number
  failed: number
  usedGpu: boolean
}

interface NormalizeVideoProgressPayload {
  requestId?: string
  currentFile?: string
  currentIndex?: number
  totalFiles?: number
  percent?: number
  message?: string
  error?: string
}

export async function normalizeVideo(
  req: NormalizeVideoRequest,
  onProgress?: (progress: NormalizeVideoProgressPayload) => void
): Promise<NormalizeVideoResult> {
  const requestId = req.requestId || randomUUID()
  const startTime = Date.now()

  const emitProgress = (partial: NormalizeVideoProgressPayload) => {
    if (!onProgress) return
    onProgress({ requestId, ...partial })
  }

  try {
    const inputFiles = Array.from(new Set(req.inputFiles || [])).filter(
      (p) => !!p && fs.existsSync(p)
    )

    if (!inputFiles.length) {
      throw new Error('Không có video hợp lệ để chuẩn hóa')
    }

    const outputDir = req.outputDir
    if (!outputDir) {
      throw new Error('Thiếu outputDir')
    }
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // Validate input files (probe nhanh, bỏ qua file lỗi)
    const { valid, invalid } = await validateInputFiles(inputFiles, 8)

    const totalFiles = inputFiles.length
    let processed = 0
    let failed = 0
    let validFailed = 0
    const outputPaths: string[] = []
    let lastError: string | undefined
    let usedGpu = false

    // Báo các file invalid (nếu có)
    if (invalid.length > 0) {
      const message = `Đã bỏ qua ${invalid.length} video lỗi / hỏng trước khi chuẩn hóa`
      emitProgress({ currentFile: '', currentIndex: 0, totalFiles, percent: 0, message })
      failed += invalid.length
    }

    const validTotal = valid.length
    const { ffmpeg } = getFfmpegPaths()

    // Build -vf filter
    const vfFilter =
      req.targetResolution && req.targetFps
        ? buildNormalizeVfFilter(req.targetResolution, req.targetFps)
        : 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p'

    // Detect GPU encoder availability (try nvenc first)
    const preferGpu = req.useGpu !== false // default true
    const gpuInfo = preferGpu ? await getGpuInfo() : null

    for (let index = 0; index < valid.length; index++) {
      const fileInfo = valid[index]
      const inputPath = fileInfo.path

      if (videoJobManager.isCancelled(requestId)) {
        throw new Error('Đã dừng bởi người dùng')
      }

      const ext = '.mp4' // always output mp4
      const baseName = path.basename(inputPath, path.extname(inputPath))
      const outputPath = path.join(outputDir, `${baseName}_normalized${ext}`)

      emitProgress({
        currentFile: path.basename(inputPath),
        currentIndex: index + 1,
        totalFiles,
        percent: (index / validTotal) * 100,
        message: `Đang chuẩn hóa video ${index + 1}/${validTotal}...`,
      })

      // Try GPU encoding first, fallback to CPU
      const success = await tryEncodeFile(
        ffmpeg,
        inputPath,
        outputPath,
        vfFilter,
        preferGpu,
        gpuInfo,
        requestId,
        (gpu) => {
          if (gpu) usedGpu = true
        }
      )

      if (videoJobManager.isCancelled(requestId)) {
        lastError = 'Đã dừng bởi người dùng'
        failed++
        validFailed++
        emitProgress({
          currentFile: path.basename(inputPath),
          currentIndex: index + 1,
          totalFiles,
          percent: ((index + 1) / validTotal) * 100,
          error: lastError,
        })
        break
      }

      if (success && fs.existsSync(outputPath)) {
        processed++
        outputPaths.push(outputPath)
        emitProgress({
          currentFile: path.basename(inputPath),
          currentIndex: index + 1,
          totalFiles,
          percent: ((index + 1) / validTotal) * 100,
          message: `Đã chuẩn hóa video ${index + 1}/${validTotal}`,
        })
      } else {
        failed++
        validFailed++
        lastError = `Lỗi khi chuẩn hóa: ${path.basename(inputPath)}`
        emitProgress({
          currentFile: path.basename(inputPath),
          currentIndex: index + 1,
          totalFiles,
          percent: ((index + 1) / validTotal) * 100,
          error: lastError,
        })
      }
    }

    const elapsedMs = Date.now() - startTime
    console.log(
      `[normalizeVideo] Completed. processed=${processed}, failed=${failed}, elapsed=${(elapsedMs / 1000).toFixed(1)}s`
    )

    const success = validFailed === 0 && processed > 0
    return {
      requestId,
      outputPaths,
      success,
      error: success ? undefined : lastError || 'Một số video chuẩn hóa thất bại',
      processed,
      failed,
      usedGpu,
    }
  } catch (err: any) {
    const errorMessage = err?.message || String(err)
    console.error('[normalizeVideo] Error:', err)
    emitProgress({
      currentFile: '',
      currentIndex: 0,
      totalFiles: req.inputFiles?.length || 0,
      percent: 0,
      error: errorMessage,
    })
    return {
      requestId,
      outputPaths: [],
      success: false,
      error: errorMessage,
      processed: 0,
      failed: req.inputFiles?.length || 0,
      usedGpu: false,
    }
  }
}

/**
 * Try encoding with GPU first, fallback to CPU if GPU fails.
 * Returns true on success, false on failure.
 */
async function tryEncodeFile(
  ffmpeg: string,
  inputPath: string,
  outputPath: string,
  vfFilter: string,
  preferGpu: boolean,
  gpuInfo: Awaited<ReturnType<typeof getGpuInfo>> | null,
  requestId: string,
  onGpuUsed: (used: boolean) => void
): Promise<boolean> {
  const gpuFfmpegPath =
    preferGpu && gpuInfo?.available && gpuInfo.encoder === 'nvenc'
      ? gpuInfo.ffmpegPath || ffmpeg
      : null

  if (preferGpu && gpuFfmpegPath) {
    // Try GPU (nvenc)
    const gpuOk = await runFfmpegEncode(gpuFfmpegPath, inputPath, outputPath, vfFilter, 'gpu', requestId)
    if (gpuOk) {
      onGpuUsed(true)
      return true
    }
    // Fallback to CPU
    console.log('[normalizeVideo] GPU failed, falling back to CPU for:', path.basename(inputPath))
    if (fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
    }
    // Check cancel trước khi spawn CPU process — tránh spawn vô ích
    if (videoJobManager.isCancelled(requestId)) {
      onGpuUsed(false)
      return false
    }
    const cpuOk = await runFfmpegEncode(ffmpeg, inputPath, outputPath, vfFilter, 'cpu', requestId)
    // Cleanup partial output if CPU encode also failed
    if (!cpuOk && fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
    }
    onGpuUsed(false)
    return cpuOk
  }

  if (preferGpu && gpuInfo?.available && gpuInfo.encoder !== 'nvenc') {
    console.log(
      `[normalizeVideo] GPU encoder ${gpuInfo.encoder.toUpperCase()} is not supported by normalizeVideo fast path. Falling back to CPU for ${path.basename(inputPath)}.`,
    )
  }

  // CPU only
  const ok = await runFfmpegEncode(ffmpeg, inputPath, outputPath, vfFilter, 'cpu', requestId)
  onGpuUsed(false)
  return ok
}

/**
 * Run FFmpeg encode for a single file.
 */
function runFfmpegEncode(
  ffmpeg: string,
  inputPath: string,
  outputPath: string,
  vfFilter: string,
  mode: 'gpu' | 'cpu',
  requestId: string
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let isSettled = false
    const safeResolve = (result: boolean) => {
      if (isSettled) return
      isSettled = true
      resolve(result)
    }

    const encoderArgs =
      mode === 'gpu'
        ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23', '-pix_fmt', 'yuv420p']
        : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p']

    const args = [
      '-y',
      '-fflags', '+genpts+igndts',       // Fix broken DTS/PTS → tránh freeze frame
      '-i', inputPath,
      '-map', '0:v:0',                   // Explicit video stream (tránh pick cover art)
      '-map', '0:a?',                    // Optional audio (tránh fail khi input không có audio)
      '-vf', vfFilter,
      ...encoderArgs,
      '-vsync', 'cfr',                   // Force constant frame rate → tránh VFR stutter
      '-avoid_negative_ts', 'make_zero', // Fix negative timestamps
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',                    // Normalize sample rate
      '-ac', '2',                        // Normalize channels to stereo
      '-movflags', '+faststart',
      outputPath,
    ]

    console.log(`[normalizeVideo] FFmpeg ${mode} encode:`, path.basename(inputPath), '→', path.basename(outputPath))

    const proc = spawn(ffmpeg, args, { windowsHide: true })
    // Drain stdout để tránh pipe buffer đầy → process treo
    proc.stdout?.resume()

    videoJobManager.registerJob(requestId, proc)

    let stderrBuffer = ''

    proc.stderr.on('data', (data) => {
      const chunk = data.toString()
      // Append trước, cap sau — đảm bảo mọi chunk đều bị giới hạn
      stderrBuffer += chunk
      const lines = stderrBuffer.split('\n')
      if (lines.length > 80) {
        stderrBuffer = lines.slice(-80).join('\n')
      }

      if (videoJobManager.isCancelled(requestId)) {
        try {
          if (!proc.killed) {
            proc.kill('SIGTERM')
            setTimeout(() => {
              if (!proc.killed) {
                try { proc.kill('SIGKILL') } catch { /* ignore */ }
              }
            }, 1000)
          }
        } catch { /* ignore */ }
      }
    })

    proc.on('close', (code) => {
      if (videoJobManager.isCancelled(requestId)) {
        safeResolve(false)
        return
      }

      if (code === 0 && fs.existsSync(outputPath)) {
        safeResolve(true)
      } else {
        // GPU failed: log snippet and signal failure for fallback
        if (mode === 'gpu') {
          const snippet = stderrBuffer.slice(-200)
          console.warn(`[normalizeVideo] GPU encode failed (code=${code}):`, snippet)
        } else {
          const snippet = stderrBuffer.slice(-400)
          console.error(`[normalizeVideo] CPU encode failed (code=${code}):`, snippet)
        }
        safeResolve(false)
      }
    })

    proc.on('error', (err) => {
      console.error(`[normalizeVideo] FFmpeg process error (${mode}):`, err)
      safeResolve(false)
    })
  })
}

import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import { getGpuInfo } from '../utils/gpuDetection'
import { validateInputFiles, type ValidatedInputFile } from './videoUtils'
import { videoJobManager } from './videoJobManager'
import { buildConcatSafeOutputArgs, buildNormalizeVfFilter, detectEncoderFromArgs } from './utils/normalizeVf'

export interface NormalizeVideoRequest {
  inputFiles: string[]
  outputDir: string
  useGpu?: boolean
  requestId?: string
  targetResolution?: string  // '1920x1080' | etc.
  targetFps?: string          // '24' | '25' | '30000/1001' | '30' | etc.
  concatSafe?: boolean        // true = output profile optimized for concat copy
  skipExisting?: boolean      // true = resume by reusing existing normalized files
  writeManifest?: boolean     // true = write clip_pool_manifest.json
  trustInputs?: boolean       // true = skip full ffprobe validation before encode
}

export interface NormalizeVideoResult {
  requestId: string
  outputPaths: string[]
  success: boolean
  error?: string
  processed: number
  failed: number
  skipped?: number
  usedGpu: boolean
  manifestPath?: string
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

interface NormalizeManifestFile {
  inputPath: string
  outputPath: string
  fileName: string
  skipped: boolean
  sizeBytes?: number
}

interface NormalizeManifest {
  version: 1
  kind: 'concat-safe-clip-pool'
  createdAt: string
  concatSafe: boolean
  profile: {
    container: 'mp4'
    videoCodec: 'h264'
    pixelFormat: 'yuv420p'
    resolution: string
    fps: string
    videoTrackTimescale: number | null
    audioCodec: 'aac'
    audioSampleRate: number
    audioChannels: number
    gop: string | null
  }
  files: NormalizeManifestFile[]
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
    const concatSafe = req.concatSafe !== false
    const skipExisting = req.skipExisting !== false
    const writeManifest = req.writeManifest !== false
    const targetResolution = req.targetResolution || '1920x1080'
    const targetFps = req.targetFps || '30'
    const profileKey = `${targetResolution}|${targetFps}|concatSafe=${concatSafe}`

    // Large clip pools can skip the up-front ffprobe pass and let FFmpeg reject bad files during encode.
    const { valid, invalid } = req.trustInputs
      ? { valid: inputFiles.map((filePath) => ({ path: filePath } as ValidatedInputFile)), invalid: [] }
      : await validateInputFiles(inputFiles, 8)

    const totalFiles = inputFiles.length
    let processed = 0
    let failed = 0
    let validFailed = 0
    let skipped = 0
    const outputPaths: string[] = []
    const manifestFiles: NormalizeManifestFile[] = []
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
    const baseVfFilter = buildNormalizeVfFilter(targetResolution, targetFps)
    const vfFilter = concatSafe ? `${baseVfFilter},setpts=PTS-STARTPTS` : baseVfFilter

    // Detect GPU encoder availability (try nvenc first)
    const preferGpu = req.useGpu !== false // default true
    const gpuInfo = preferGpu ? await getGpuInfo() : null

    for (let index = 0; index < valid.length; index++) {
      const fileInfo = valid[index]
      const inputPath = fileInfo.path

      if (videoJobManager.isCancelled(requestId)) {
        throw new Error('Đã dừng bởi người dùng')
      }

      const outputPath = buildNormalizedOutputPath(inputPath, outputDir, profileKey)

      emitProgress({
        currentFile: path.basename(inputPath),
        currentIndex: index + 1,
        totalFiles,
        percent: (index / validTotal) * 100,
        message: `Đang chuẩn hóa video ${index + 1}/${validTotal}...`,
      })

      if (skipExisting && isUsableExistingOutput(outputPath)) {
        processed++
        skipped++
        outputPaths.push(outputPath)
        manifestFiles.push(buildManifestFile(inputPath, outputPath, true))
        emitProgress({
          currentFile: path.basename(inputPath),
          currentIndex: index + 1,
          totalFiles,
          percent: ((index + 1) / validTotal) * 100,
          message: `Da bo qua file da chuan hoa ${index + 1}/${validTotal}`,
        })
        continue
      }

      // Try GPU encoding first, fallback to CPU
      const success = await tryEncodeFile(
        ffmpeg,
        inputPath,
        outputPath,
        vfFilter,
        preferGpu,
        gpuInfo,
        requestId,
        {
          concatSafe,
          targetFps,
        },
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
        manifestFiles.push(buildManifestFile(inputPath, outputPath, false))
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
      `[normalizeVideo] Completed. processed=${processed}, skipped=${skipped}, failed=${failed}, elapsed=${(elapsedMs / 1000).toFixed(1)}s`
    )

    let manifestPath: string | undefined
    if (writeManifest && outputPaths.length > 0) {
      manifestPath = path.join(outputDir, 'clip_pool_manifest.json')
      const manifest: NormalizeManifest = {
        version: 1,
        kind: 'concat-safe-clip-pool',
        createdAt: new Date().toISOString(),
        concatSafe,
        profile: {
          container: 'mp4',
          videoCodec: 'h264',
          pixelFormat: 'yuv420p',
          resolution: targetResolution,
          fps: targetFps,
          videoTrackTimescale: concatSafe ? 90000 : null,
          audioCodec: 'aac',
          audioSampleRate: 48000,
          audioChannels: 2,
          gop: concatSafe ? '1s closed/IDR cadence' : null,
        },
        files: manifestFiles,
      }
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
    }

    const success = validFailed === 0 && processed > 0
    return {
      requestId,
      outputPaths,
      success,
      error: success ? undefined : lastError || 'Một số video chuẩn hóa thất bại',
      processed,
      failed,
      skipped,
      usedGpu,
      manifestPath,
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
      skipped: 0,
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
  options: {
    concatSafe: boolean
    targetFps: string
  },
  onGpuUsed: (used: boolean) => void
): Promise<boolean> {
  const gpuFfmpegPath =
    preferGpu && gpuInfo?.available && gpuInfo.encoder === 'nvenc'
      ? gpuInfo.ffmpegPath || ffmpeg
      : null

  if (preferGpu && gpuFfmpegPath) {
    // Try GPU (nvenc)
    const gpuOk = await runFfmpegEncode(gpuFfmpegPath, inputPath, outputPath, vfFilter, 'gpu', requestId, options)
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
    const cpuOk = await runFfmpegEncode(ffmpeg, inputPath, outputPath, vfFilter, 'cpu', requestId, options)
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
  const ok = await runFfmpegEncode(ffmpeg, inputPath, outputPath, vfFilter, 'cpu', requestId, options)
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
  requestId: string,
  options: {
    concatSafe: boolean
    targetFps: string
  }
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
    const encoderName = detectEncoderFromArgs(encoderArgs)
    const concatSafeOutputArgs = options.concatSafe
      ? buildConcatSafeOutputArgs(encoderName, options.targetFps)
      : []

    const args = [
      '-y',
      '-fflags', '+genpts+igndts',       // Fix broken DTS/PTS → tránh freeze frame
      '-i', inputPath,
      '-map', '0:v:0',                   // Explicit video stream (tránh pick cover art)
      '-map', '0:a?',                    // Optional audio (tránh fail khi input không có audio)
      '-vf', vfFilter,
      ...encoderArgs,
      ...concatSafeOutputArgs,
      '-vsync', 'cfr',                   // Force constant frame rate → tránh VFR stutter
      '-avoid_negative_ts', 'make_zero', // Fix negative timestamps
      '-map_metadata', '-1',
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

function buildNormalizedOutputPath(inputPath: string, outputDir: string, profileKey: string): string {
  const baseName = sanitizeOutputBaseName(path.basename(inputPath, path.extname(inputPath)))
  const hash = createHash('sha1')
    .update(`${path.resolve(inputPath).toLowerCase()}\n${profileKey}`)
    .digest('hex')
    .slice(0, 10)
  return path.join(outputDir, `${baseName}_${hash}_normalized.mp4`)
}

function sanitizeOutputBaseName(name: string): string {
  const safe = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
  return (safe || 'video').slice(0, 120)
}

function isUsableExistingOutput(outputPath: string): boolean {
  try {
    const stat = fs.statSync(outputPath)
    return stat.isFile() && stat.size > 64 * 1024
  } catch {
    return false
  }
}

function buildManifestFile(inputPath: string, outputPath: string, skipped: boolean): NormalizeManifestFile {
  let sizeBytes: number | undefined
  try {
    const stat = fs.statSync(outputPath)
    if (stat.isFile()) sizeBytes = stat.size
  } catch {
    sizeBytes = undefined
  }
  return {
    inputPath,
    outputPath,
    fileName: path.basename(outputPath),
    skipped,
    sizeBytes,
  }
}

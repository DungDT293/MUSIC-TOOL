/**
 * Cut single video into segments using FFmpeg segment filter
 * SIMPLE, WORKING VERSION - DO NOT COMPLICATE
 */

import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { getFfmpegPaths } from '../ffmpeg/config'
import { probeFile } from '../ffmpeg/probe'
import { buildSingleCutProgress, type SingleCutProgress } from './videoProgress'
import { videoJobManager } from './videoJobManager'
import { buildConcatSafeOutputArgs, buildNormalizeVfFilter, detectEncoderFromArgs } from './utils/normalizeVf'
import { buildVideoEncoderArgsWithChoice } from '../utils/gpuDetection'

export interface CutSingleSimpleRequest {
  inputPath: string
  outputDir: string
  segmentLengthSec: number
  format?: 'mp4' | 'mkv'
  requestId?: string
  normalizeOutput?: boolean
  useGpuEncoding?: boolean // true = prefer GPU, false = force CPU, undefined = auto (default: CPU for backward compatibility)
  targetResolution?: string // '1920x1080' | '1440x1080' | etc. (chỉ áp dụng khi normalizeOutput = true)
  targetFps?: string        // '24' | '25' | '30000/1001' | '30' | etc.
}

export interface CutSingleSimpleResult {
  requestId: string
  outputFiles: string[]
  segmentCount: number
  elapsedMs: number
  avgSpeed: number
  success: boolean
  error?: string
}

function normalizeSelectedPath(rawPath: string | undefined): string {
  if (typeof rawPath !== 'string') return ''
  const trimmed = rawPath.trim()
  if (!trimmed) return ''

  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed

  return path.normalize(unquoted)
}

function parseTargetFpsValue(rawFps: string | undefined): number | null {
  if (!rawFps) return null
  const trimmed = rawFps.trim()
  if (!trimmed) return null

  const parts = trimmed.split('/')
  if (parts.length === 2) {
    const numerator = Number(parts[0])
    const denominator = Number(parts[1])
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
      return null
    }
    const value = numerator / denominator
    return Number.isFinite(value) && value > 0 ? value : null
  }

  const value = Number(trimmed)
  return Number.isFinite(value) && value > 0 ? value : null
}

function emitProgress(
  onProgress: ((progress: SingleCutProgress) => void) | undefined,
  requestId: string,
  percent: number,
  currentSegment: number,
  totalSegments: number,
  speedX?: number | null,
  timeSec?: number,
  totalDurationSec?: number,
  etaSec?: number | null // Accept etaSec as parameter instead of calculating it
) {
  if (!onProgress) {
    console.log('[cutSingleSimple] emitProgress: onProgress is undefined, skipping')
    return
  }
  
  // Use provided etaSec, or calculate if not provided
  let finalEtaSec: number | null = etaSec ?? null
  if (finalEtaSec === null && timeSec !== undefined && totalDurationSec !== undefined && speedX != null && speedX > 0) {
    const remainingSec = Math.max(0, totalDurationSec - timeSec)
    finalEtaSec = remainingSec / speedX
  }
  
  const progress = buildSingleCutProgress({
    requestId,
    percent,
    currentSegment,
    totalSegments,
    speedX: speedX ?? null,
    timeSec: timeSec ?? undefined,
    totalDurationSec: totalDurationSec ?? undefined,
    etaSec: finalEtaSec,
  })
  
  console.log('[cutSingleSimple] Emitting progress:', {
    requestId,
    percent: progress.percent,
    currentSegment: progress.currentSegment,
    totalSegments: progress.totalSegments,
    timeSec: progress.timeSec,
    totalDurationSec: progress.totalDurationSec,
    speedX: progress.speedX,
    etaSec: progress.etaSec,
  })
  
  onProgress(progress)
}

export async function cutVideoIntoSegmentsSimple(
  params: CutSingleSimpleRequest,
  onProgress?: (progress: SingleCutProgress) => void,
  options?: { signal?: AbortSignal }
): Promise<CutSingleSimpleResult> {
  const QUIET_LOG = true // Low: giảm log noise

  // DEBUG: Log request params immediately
  console.log(`[cutSingleSimple] ===== FUNCTION CALLED =====`)
  console.log(`[cutSingleSimple] Request params:`, JSON.stringify({
    normalizeOutput: params.normalizeOutput,
    useGpuEncoding: params.useGpuEncoding,
  }))

  const {
    inputPath,
    outputDir: rawOutputDir,
    segmentLengthSec,
    format = 'mp4',
    requestId = 'unknown',
    normalizeOutput = false,
    useGpuEncoding,
    targetResolution,
    targetFps,
  } = params

  const outputDir = normalizeSelectedPath(rawOutputDir)

  // Medium: Validate segment length > 0
  if (segmentLengthSec <= 0) {
    const error = 'segmentLengthSec must be > 0'
    console.error(`✗ ${error}`)
    return buildResult(requestId, false, 0, 0, 0, [], error)
  }

  if (!QUIET_LOG) {
    console.log('\n────────────────────────────────────────────────────────')
    console.log('▌ CUT SINGLE VIDEO (SIMPLE)')
    console.log('────────────────────────────────────────────────────────')
  }

  if (!outputDir) {
    const error = 'Output directory is empty or invalid'
    console.error(`✗ ${error}`)
    return buildResult(requestId, false, 0, 0, 0, [], error)
  }

  if (!fs.existsSync(inputPath)) {
    const error = `Input file not found: ${inputPath}`
    console.error(`âœ— ${error}`)
    return buildResult(requestId, false, 0, 0, 0, [], error)
  }

  try {
    await fs.promises.mkdir(outputDir, { recursive: true })
    console.log(`âœ“ Output directory: ${outputDir}`)
  } catch (err: any) {
    const error = `Failed to create output directory: ${err.message}`
    console.error(`âœ— ${error}`)
    return buildResult(requestId, false, 0, 0, 0, [], error)
  }

  // Sanitize basename để tránh ký tự đặc biệt gây lỗi trong regex và file naming
  const rawBasename = path.parse(inputPath).name
  const basename = rawBasename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'video'
  console.log(`âœ" Video name: ${basename}`)

  let duration = 0
  try {
    const probe = await probeFile(inputPath)
    duration = probe.format.duration || 0
    console.log(`âœ“ Duration: ${Math.round(duration / 60)} minutes (${duration.toFixed(1)} seconds)`)
  } catch (err: any) {
    const error = `Failed to probe video: ${err.message}`
    console.error(`âœ— ${error}`)
    return buildResult(requestId, false, 0, 0, 0, [], error)
  }

  if (duration === 0) {
    const error = 'Video has zero duration'
    console.error(`âœ— ${error}`)
    return buildResult(requestId, false, 0, 0, 0, [], error)
  }

  const expectedSegments = Math.ceil(duration / segmentLengthSec)
  console.log(`âœ“ Expected segments: ${expectedSegments} (${segmentLengthSec}s each)`)

  const outputPattern = path.join(outputDir, `${basename}_part_%05d.${format}`)
  console.log(`âœ" Output pattern: ${outputPattern}`)
  console.log(`[cutSingleSimple] DEBUG START: normalizeOutput=${normalizeOutput}, useGpuEncoding=${useGpuEncoding}`)

  const { ffmpeg } = getFfmpegPaths()
  let selectedFfmpegPath = ffmpeg

  // Build encoder args based on user choice (GPU/CPU/Auto)
  let codecArgs: string[]
  let hwaccelArgs: string[] = [] // Hardware acceleration flags (must come before -i)
  if (normalizeOutput) {
    console.log(`[cutSingleSimple] DEBUG START: normalizeOutput=${normalizeOutput}, useGpuEncoding=${useGpuEncoding}`)
    
    // Determine user choice: true = GPU, false = CPU, undefined = auto (default to CPU for backward compatibility)
    const userChoice: 'gpu' | 'cpu' | 'auto' = useGpuEncoding === true ? 'gpu' : useGpuEncoding === false ? 'cpu' : 'auto'
    
    // Get encoder args from GPU detection utility
    const { args: encoderArgs, usedEncoder, gpuInfo } = await buildVideoEncoderArgsWithChoice(
      true, // needsReencode
      userChoice,
      'fast' // quality preset (fast = veryfast for CPU, p1 for GPU)
    )
    
    // Log encoder being used
    console.log(`[cutSingleSimple] GPU Encoding Request: useGpuEncoding=${useGpuEncoding}, userChoice=${userChoice}`)
    if (usedEncoder === 'gpu' && gpuInfo) {
      console.log(`[cutSingleSimple] ✓ Using ${gpuInfo.encoder.toUpperCase()} encoder (${gpuInfo.name || 'GPU'}) for video encoding`)
      console.log(`[cutSingleSimple] GPU Info: available=${gpuInfo.available}, encoder=${gpuInfo.encoder}, reason=${gpuInfo.reason}`)
      selectedFfmpegPath = gpuInfo.ffmpegPath || ffmpeg
    } else {
      console.log(`[cutSingleSimple] ✗ Using CPU encoder (libx264)${gpuInfo && !gpuInfo.available ? ` - ${gpuInfo.reason}` : ''}`)
      console.log(`[cutSingleSimple] GPU Info: available=${gpuInfo?.available ?? false}, encoder=${gpuInfo?.encoder ?? 'unknown'}, reason=${gpuInfo?.reason ?? 'N/A'}`)
    }
    console.log(`[cutSingleSimple] Encoder args:`, encoderArgs)
    
    // Extract hardware acceleration flags (-hwaccel) from encoderArgs - they must come BEFORE -i
    const hwaccelIndex = encoderArgs.indexOf('-hwaccel')
    if (hwaccelIndex >= 0 && hwaccelIndex < encoderArgs.length - 1) {
      hwaccelArgs = encoderArgs.slice(hwaccelIndex, hwaccelIndex + 2) // Extract '-hwaccel' and its value
      encoderArgs.splice(hwaccelIndex, 2) // Remove from encoderArgs
    }
    
    // Build full codec args: encoder args (without hwaccel) + additional video/audio settings
    // Check if using GPU encoder (NVENC/AMF/VideoToolbox) - they don't support -level or -force_key_frames expr
    const isGpuEncoder = encoderArgs.includes('h264_nvenc') || encoderArgs.includes('h264_amf') || encoderArgs.includes('h264_videotoolbox')
    
    const resolvedTargetFps = parseTargetFpsValue(targetFps)
    const gopFrames = resolvedTargetFps
      ? Math.max(1, Math.round(segmentLengthSec * resolvedTargetFps))
      : Math.max(1, Math.round(segmentLengthSec * 30))

    // Build concat-safe args for uniform timebase & GOP structure
    const encoderName = detectEncoderFromArgs(encoderArgs)
    const concatSafeExtras = buildConcatSafeOutputArgs(encoderName, targetFps || '30')
    // Filter out -g and -keyint_min from concatSafeExtras because cutSingleSimple
    // has its own GOP logic based on segmentLengthSec (not 1-second GOP).
    // We keep the structural safety args: -video_track_timescale, -sc_threshold, -x264opts, etc.
    const concatSafeStructural = concatSafeExtras.filter((arg, idx, arr) => {
      if (arg === '-g' || arg === '-keyint_min') return false
      // Skip the value following -g or -keyint_min
      if (idx > 0 && (arr[idx - 1] === '-g' || arr[idx - 1] === '-keyint_min')) return false
      return true
    })

    codecArgs = [
      ...encoderArgs,
      // Additional video settings for segment cutting
      '-profile:v',
      'high',
      // Note: GPU encoders (NVENC/AMF) don't support -level parameter, they auto-detect
      // Only add -level for CPU encoder (libx264)
      ...(isGpuEncoder ? [] : ['-level', '4.1']),
      // Force keyframes at segment boundaries based on the normalized output FPS.
      ...(isGpuEncoder
        ? ['-g', gopFrames.toString()]
        : ['-g', gopFrames.toString(), '-keyint_min', gopFrames.toString(),
           '-force_key_frames', `expr:gte(t,n_forced*${segmentLengthSec})`]
      ),
      // Concat-safe structural args (timebase, closed GOP, sc_threshold, etc.)
      ...concatSafeStructural,
      // Audio codec settings — uniform for concat safety
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-ac',
      '2',
    ]
  } else {
    codecArgs = [
      '-c',
      'copy',
      // Lưu ý: Khi dùng -c copy, FFmpeg chỉ có thể cắt tại keyframes có sẵn
      // Nếu keyframe tiếp theo cách xa hơn segment_time, segment sẽ dài hơn
      // Để đảm bảo chính xác, cần bật "Chuẩn hóa output" (normalizeOutput = true)
    ]
  }

  // Tạo progress file path khi normalizeOutput = true
  const progressFilePath = normalizeOutput
    ? path.join(outputDir, `${basename}_${requestId.substring(0, 8)}_progress.txt`)
    : null

  // Build FFmpeg args - hardware acceleration flags MUST come BEFORE -i input file
  // Thêm -vf filter khi normalizeOutput + targetResolution + targetFps được chỉ định
  const vfFilter = normalizeOutput && targetResolution && targetFps
    ? buildNormalizeVfFilter(targetResolution, targetFps)
    : null

  // Strip hwaccel when vfFilter is active: software filters require CPU frames,
  // mixing GPU hwaccel + CPU filter causes ACCESS_VIOLATION (0xC0000005) crash
  const effectiveHwaccelArgs = vfFilter ? [] : hwaccelArgs

  // Replace -vsync 2 (VFR passthrough) with cfr when re-encoding to fix timestamp
  // discontinuity / black frames at scene transitions
  const effectiveCodecArgs = normalizeOutput
    ? codecArgs.map((arg, idx, arr) => {
        if (arg === '-vsync' && arr[idx + 1] === '2') return '-vsync'
        if (idx > 0 && arr[idx - 1] === '-vsync' && arg === '2') return 'cfr'
        return arg
      })
    : codecArgs

  const ffmpegArgs = [
    '-fflags', '+genpts+igndts', // Regenerate PTS + bỏ qua DTS invalid để tránh black/freeze frame
    ...effectiveHwaccelArgs, // Hardware acceleration flags (if GPU, only when no vfFilter)
    '-i',
    inputPath,
    // Map streams explicitly: video bắt buộc, audio optional (tránh fail khi input không có audio)
    ...(normalizeOutput ? ['-map', '0:v:0', '-map', '0:a?'] : []),
    ...(vfFilter ? ['-vf', vfFilter] : []),
    ...effectiveCodecArgs,
    '-f',
    'segment',
    '-segment_time',
    segmentLengthSec.toString(),
    '-reset_timestamps',
    '1',
    '-avoid_negative_ts',
    'make_zero',
    // Với output đã re-encode và có keyframe cadence cố định, luôn cắt tại keyframe để tránh segment bị xước/dừng hình khi ghép lại.
    '-break_non_keyframes',
    '0',
    // Force FFmpeg to output progress info (stats mode)
    '-stats', // Hiển thị stats (time, bitrate, ...) vào stderr
    // Khi normalizeOutput = true, thêm -loglevel và -progress để đảm bảo output progress
    ...(normalizeOutput
      ? [
          '-loglevel',
          'info',
          '-progress',
          progressFilePath!, // Output progress vào file
        ]
      : []),
    '-movflags', '+faststart', // moov atom đầu file → player có thể seek ngay
    '-y', // Overwrite output files
    outputPattern,
  ]

  console.log(`\nâœ“ FFmpeg command:`)
  console.log(`  ${selectedFfmpegPath} ${ffmpegArgs.join(' ')}\n`)
  // Debug: Check if GPU encoder is being used
  const hasGpuEncoder = ffmpegArgs.some(arg => arg.includes('nvenc') || arg.includes('amf') || arg.includes('videotoolbox'))
  const hasCpuEncoder = ffmpegArgs.some(arg => arg.includes('libx264'))
  console.log(`[cutSingleSimple] FFmpeg encoder check: GPU=${hasGpuEncoder}, CPU=${hasCpuEncoder}`)
  if (normalizeOutput && useGpuEncoding && !hasGpuEncoder) {
    console.warn(`[cutSingleSimple] ⚠️ WARNING: User requested GPU encoding but CPU encoder is being used!`)
  }

  const startTime = Date.now()

  return new Promise<CutSingleSimpleResult>((resolve) => {
    let isSettled = false
    const safeResolve = (result: CutSingleSimpleResult) => {
      if (isSettled) return
      isSettled = true
      resolve(result)
    }

    // Guard: nếu signal đã aborted trước khi spawn → return ngay (tránh spawn process vô ích)
    if (options?.signal?.aborted) {
      safeResolve(buildResult(requestId, false, Date.now() - startTime, 0, 0, [], 'Đã dừng bởi người dùng'))
      return
    }

    const ffmpegProcess = spawn(selectedFfmpegPath, ffmpegArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })

    // Register process vào videoJobManager để có thể cancel
    videoJobManager.registerJob(requestId, ffmpegProcess)

    // Check signal để cancel khi cần
    if (options?.signal) {
      options.signal.addEventListener('abort', () => {
        console.log(`[cutSingleSimple] Job ${requestId} cancelled via AbortSignal`)
        // Cleanup file-count progress tracker
        clearInterval(fileCountInterval)
        // Cleanup progress file watcher
        if (progressFileWatcher) {
          fs.unwatchFile(progressFilePath!)
          progressFileWatcher = null
        }
        if (!ffmpegProcess.killed) {
          ffmpegProcess.kill('SIGTERM')
          setTimeout(() => {
            if (!ffmpegProcess.killed) {
              ffmpegProcess.kill('SIGKILL')
            }
          }, 2000)
        }
        safeResolve(buildResult(requestId, false, Date.now() - startTime, 0, 0, [], 'Đã dừng bởi người dùng'))
      }, { once: true })
    }

    let stderrBuffer = ''
    const progressStartTime = Date.now()
    let lastProgressTime = 0

    // File-count progress tracker: đếm số file output đã tạo để cập nhật currentSegment chính xác
    // Cần thiết vì FFmpeg -f segment -c copy xuất file rất nhanh nhưng stderr time= rất thưa
    // FIX M5: Use correctly-escaped regex — identical to the final listing pattern (line 630).
    // Previously this used double-escaped '\\\\$&' which produced literal backslashes in the
    // regex, causing filenames with regex-special characters (e.g., parentheses, brackets)
    // to fail matching and show 0% progress throughout the entire cut.
    const partPattern = new RegExp(`^${basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_part_\\d+\\.${format.replace('.', '\\.')}$`)
    let lastFileCount = 0
    const fileCountInterval = setInterval(() => {
      try {
        const files = fs.readdirSync(outputDir).filter((f) => partPattern.test(f))
        const currentFileCount = files.length
        if (currentFileCount > lastFileCount) {
          lastFileCount = currentFileCount
          const percent = expectedSegments > 0 ? Math.min(99, (currentFileCount / expectedSegments) * 100) : 0
          const elapsedSec = (Date.now() - progressStartTime) / 1000
          const speedX = elapsedSec > 0 && currentFileCount > 0 ? (currentFileCount * segmentLengthSec) / elapsedSec : null
          const remainingSegments = Math.max(0, expectedSegments - currentFileCount)
          const etaSec = speedX && speedX > 0 ? (remainingSegments * segmentLengthSec) / speedX : null
          emitProgress(onProgress, requestId, percent, currentFileCount, expectedSegments, speedX, currentFileCount * segmentLengthSec, duration, etaSec)
        }
      } catch {
        // ignore readdir errors during cut
      }
    }, 500) // Poll every 500ms

    const parseTimeToSeconds = (timeString: string): number => {
      const parts = timeString.split(':')
      if (parts.length !== 3) return 0
      const [hours, minutes, seconds] = parts
      return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
    }

    // Watch progress file khi normalizeOutput = true
    let progressFileWatcher: fs.StatWatcher | null = null
    if (normalizeOutput && progressFilePath) {
      // Xóa file progress cũ nếu có (unwatch trước để tránh EBUSY trên Windows)
      if (fs.existsSync(progressFilePath)) {
        try { fs.unwatchFile(progressFilePath) } catch {}
        try { fs.unlinkSync(progressFilePath) } catch (e) {
          console.warn('[cutSingleSimple] Could not delete old progress file:', e)
        }
      }
      
      // Watch file progress để đọc progress real-time
      progressFileWatcher = fs.watchFile(progressFilePath, { interval: 500 }, (curr, prev) => {
        if (!fs.existsSync(progressFilePath!)) return
        
        try {
          const content = fs.readFileSync(progressFilePath!, 'utf-8')
          // Parse progress từ file: out_time_ms=1234567890
          const outTimeMatch = content.match(/out_time_ms=(\d+)/)
          if (outTimeMatch) {
            const outTimeMs = Number(outTimeMatch[1])
            const currentTimeSec = outTimeMs / 1000000
            
            if (currentTimeSec > 0 && currentTimeSec <= duration) {
              // Chỉ emit progress mỗi 0.5 giây để tránh spam
              if (currentTimeSec - lastProgressTime >= 0.5) {
                lastProgressTime = currentTimeSec
                
                // Tính progress
                const percent = duration > 0 ? Math.min(100, Math.max(0, (currentTimeSec / duration) * 100)) : 0
                const currentSegment = segmentLengthSec > 0 ? Math.min(expectedSegments, Math.floor(currentTimeSec / segmentLengthSec) + 1) : 1
                
                // Tính speedX và etaSec từ elapsed time
                const elapsedSec = (Date.now() - progressStartTime) / 1000
                const speedX = elapsedSec > 0 && currentTimeSec > 0 ? currentTimeSec / elapsedSec : null
                const remainingSec = Math.max(0, duration - currentTimeSec)
                const etaSec = speedX && speedX > 0 ? remainingSec / speedX : null
                
                // Parse speed từ FFmpeg output nếu có
                const speedMatch = content.match(/speed=\s*([0-9.]+)x/i)
                const ffmpegSpeedX = speedMatch ? Number(speedMatch[1]) : null
                const finalSpeedX = ffmpegSpeedX ?? speedX
                
                console.log(`[cutSingleSimple] Progress from file: time=${currentTimeSec.toFixed(1)}s/${duration.toFixed(1)}s, percent=${percent.toFixed(1)}%, segment=${currentSegment}/${expectedSegments}, speed=${finalSpeedX?.toFixed(1) ?? 'N/A'}x`)
                
                // Emit progress với đầy đủ thông tin
                emitProgress(onProgress, requestId, percent, currentSegment, expectedSegments || currentSegment, finalSpeedX, currentTimeSec, duration, etaSec ?? undefined)
              }
            }
          }
        } catch (err) {
          // Ignore errors khi đọc file
        }
      })
    }

    ffmpegProcess.stderr.on('data', (data) => {
      // Check nếu job đã bị cancel - kill process ngay lập tức
      if (videoJobManager.isCancelled(requestId) || options?.signal?.aborted) {
        console.log(`[cutSingleSimple] Job ${requestId} cancelled, killing FFmpeg process`)
        // Cleanup file-count progress tracker
        clearInterval(fileCountInterval)
        // Cleanup progress file watcher
        if (progressFileWatcher) {
          fs.unwatchFile(progressFilePath!)
          progressFileWatcher = null
        }
        if (!ffmpegProcess.killed) {
          ffmpegProcess.kill('SIGTERM')
          setTimeout(() => {
            if (!ffmpegProcess.killed) {
              ffmpegProcess.kill('SIGKILL')
            }
          }, 1000) // Giảm timeout xuống 1 giây để kill nhanh hơn
        }
        safeResolve(buildResult(requestId, false, Date.now() - startTime, 0, 0, [], 'Đã dừng bởi người dùng'))
        return
      }

      const chunk = data.toString()
      // Append trước, cap sau — đảm bảo mọi chunk đều bị giới hạn
      stderrBuffer += chunk
      const lines = stderrBuffer.split('\n')
      if (lines.length > 80) {
        stderrBuffer = lines.slice(-80).join('\n')
      }
      
      // Debug: Log first few chunks to see what FFmpeg outputs (chỉ khi normalizeOutput = true để debug)
      if (normalizeOutput && stderrBuffer.length < 2000) {
        console.log(`[cutSingleSimple] Stderr chunk (${chunk.length} bytes):`, chunk.substring(0, Math.min(500, chunk.length)))
      }
      
      // Parse time từ stderr: "time=00:01:23.45" (giống backup version)
      // Cũng thử parse từ các format khác: "frame=1234 time=00:01:23.45" hoặc "out_time_ms=123456"
      // NOTE: Khi normalizeOutput=true, progress file watcher đã emit progress → skip stderr parsing
      //       để tránh dual-source gây UI flicker (progress nhảy ngược)
      if (progressFileWatcher) {
        // Chỉ parse speed từ stderr (không emit progress) — progress file watcher handle
        const speedMatch = chunk.match(/speed=\s*([0-9.]+)x/i)
        if (speedMatch) {
          // Speed sẽ được dùng bởi file watcher nếu cần
        }
        return // skip progress emit — file watcher handles it
      }

      let timeStr: string | null = chunk.match(/time=([0-9:.]+)/)?.[1] ?? null
      if (!timeStr) {
        // Thử parse từ out_time_ms (khi dùng -progress)
        const outTimeMatch = chunk.match(/out_time_ms=(\d+)/)
        if (outTimeMatch) {
          const outTimeMs = Number(outTimeMatch[1])
          const outTimeSec = outTimeMs / 1000000
          // Convert to time string format
          const hours = Math.floor(outTimeSec / 3600)
          const minutes = Math.floor((outTimeSec % 3600) / 60)
          const seconds = outTimeSec % 60
          timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`
        }
      }
      
      if (timeStr && duration > 0) {
        // Guard: bỏ qua N/A và các giá trị không bắt đầu bằng số (invalid)
        if (!timeStr || !/^\d/.test(timeStr)) return
        const currentTimeSec = parseTimeToSeconds(timeStr)
        
        if (currentTimeSec > 0 && currentTimeSec <= duration) {
          // Chỉ emit progress mỗi 0.5 giây để tránh spam (giống backup version)
          if (currentTimeSec - lastProgressTime >= 0.5) {
            lastProgressTime = currentTimeSec
            
            // Tính progress
            const percent = duration > 0 ? Math.min(100, Math.max(0, (currentTimeSec / duration) * 100)) : 0
            const currentSegment = segmentLengthSec > 0 ? Math.min(expectedSegments, Math.floor(currentTimeSec / segmentLengthSec) + 1) : 1
            
            // Tính speedX và etaSec từ elapsed time (giống backup version)
            const elapsedSec = (Date.now() - progressStartTime) / 1000
            const speedX = elapsedSec > 0 && currentTimeSec > 0 ? currentTimeSec / elapsedSec : null
            const remainingSec = Math.max(0, duration - currentTimeSec)
            const etaSec = speedX && speedX > 0 ? remainingSec / speedX : null
            
            // Parse speed từ FFmpeg output nếu có (optional, để hiển thị chính xác hơn)
            const speedMatch = chunk.match(/speed=\s*([0-9.]+)x/i)
            const ffmpegSpeedX = speedMatch ? Number(speedMatch[1]) : null
            // Ưu tiên dùng speed từ FFmpeg nếu có, nếu không thì dùng calculated speed
            const finalSpeedX = ffmpegSpeedX ?? speedX
            
            console.log(`[cutSingleSimple] Progress: time=${currentTimeSec.toFixed(1)}s/${duration.toFixed(1)}s, percent=${percent.toFixed(1)}%, segment=${currentSegment}/${expectedSegments}, speed=${finalSpeedX?.toFixed(1) ?? 'N/A'}x, eta=${etaSec?.toFixed(1) ?? 'N/A'}s`)
            
            // Emit progress với đầy đủ thông tin (bao gồm etaSec đã tính)
            emitProgress(onProgress, requestId, percent, currentSegment, expectedSegments || currentSegment, finalSpeedX, currentTimeSec, duration, etaSec)
          }
        }
      }
    })

    ffmpegProcess.on('close', (exitCode) => {
      // Cleanup file-count progress tracker
      clearInterval(fileCountInterval)

      // Cleanup progress file watcher
      if (progressFileWatcher) {
        fs.unwatchFile(progressFilePath!)
        progressFileWatcher = null
      }
      
      // Xóa progress file sau khi xong
      if (progressFilePath && fs.existsSync(progressFilePath)) {
        try {
          fs.unlinkSync(progressFilePath)
        } catch (err) {
          // Ignore errors khi xóa file
        }
      }
      
      const elapsedMs = Date.now() - startTime
      const elapsedSec = elapsedMs / 1000
      const avgSpeed = duration / elapsedSec

      // Nếu job đã bị cancel, không resolve success
      if (videoJobManager.isCancelled(requestId) || options?.signal?.aborted) {
        safeResolve(buildResult(requestId, false, elapsedMs, 0, 0, [], 'Đã dừng bởi người dùng'))
        return
      }

      if (exitCode === 0) {
        // Use async IIFE to handle await for probeFile
        ;(async () => {
          try {
            // Filter chính xác hơn: chỉ lấy file match pattern ${basename}_part_XXX.${format}
            // Tránh lấy nhầm file từ video khác nếu cùng tên
            const partPattern = new RegExp(`^${basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_part_\\d+\\.${format.replace('.', '\\.')}$`)
            const allFiles = fs
              .readdirSync(outputDir)
              .filter((f) => partPattern.test(f))
              .sort((a, b) => {
                // Sort theo số thứ tự trong tên file (part_001, part_002, ...)
                const matchA = a.match(/_part_(\d+)\./)
                const matchB = b.match(/_part_(\d+)\./)
                const numA = matchA ? parseInt(matchA[1], 10) : 0
                const numB = matchB ? parseInt(matchB[1], 10) : 0
                return numA - numB
              })
              .map((f) => path.join(outputDir, f))
            
            // Filter out empty or invalid segments (FFmpeg may create empty last segment if duration doesn't divide evenly)
            const files: string[] = []
            for (const filePath of allFiles) {
              try {
                const stats = fs.statSync(filePath)
                
                // Skip files that are too small (likely empty/invalid segments)
                // Minimum reasonable size: ~50KB for a very short segment (conservative threshold)
                const minSizeBytes = 50 * 1024 // 50KB
                
                if (stats.size < minSizeBytes) {
                  // Double-check by probing the segment duration
                  try {
                    const segmentProbe = await probeFile(filePath)
                    const segmentDuration = segmentProbe.format.duration || 0
                    
                    // If segment has valid duration > 0.1 seconds, keep it (might be a short but valid last segment)
                    if (segmentDuration > 0.1) {
                      console.log(`[cutSingleSimple] Keeping short but valid segment: ${path.basename(filePath)} (duration: ${segmentDuration.toFixed(2)}s, size: ${(stats.size / 1024).toFixed(1)}KB)`)
                      files.push(filePath)
                      continue
                    }
                  } catch (probeErr) {
                    // If probe fails, assume it's invalid
                  }
                  
                  // Segment is too small and has no valid duration - skip it
                  console.log(`[cutSingleSimple] Skipping empty/invalid segment: ${path.basename(filePath)} (size: ${(stats.size / 1024).toFixed(1)}KB)`)
                  // Delete empty segment file
                  try {
                    fs.unlinkSync(filePath)
                  } catch (unlinkErr) {
                    // Ignore unlink errors
                  }
                  continue
                }
                
                files.push(filePath)
              } catch (statErr) {
                // If we can't stat the file, skip it
                console.warn(`[cutSingleSimple] Cannot stat file ${path.basename(filePath)}, skipping:`, statErr)
                continue
              }
            }

          console.log(`\nâœ“ SUCCESS`)
          console.log(`  Segments created: ${files.length}/${expectedSegments}`)
          console.log(`  Time elapsed: ${elapsedSec.toFixed(1)}s`)
          console.log(`  Speed: ${avgSpeed.toFixed(1)}x`)
          if (avgSpeed < 50) {
            console.log('  âš  Speed is below 50x - possible disk I/O bottleneck')
          }
          console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n')

          // Emit final progress with 100% completion (etaSec = 0 when done)
          emitProgress(onProgress, requestId, 100, files.length, files.length, avgSpeed, duration, duration, 0)
          safeResolve(buildResult(requestId, true, elapsedMs, avgSpeed, files.length, files))
        } catch (err: any) {
          const error = `Failed to list output files: ${err.message}`
          console.error(`âœ— ${error}`)
          console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n')
          safeResolve(buildResult(requestId, false, elapsedMs, 0, 0, [], error))
        }
        })()
      } else {
        const error = `FFmpeg exited with code ${exitCode}`
        console.error(`âœ— ${error}`)
        console.error(`[cutSingleSimple] Full FFmpeg stderr (last 2000 chars):\n${stderrBuffer.slice(-2000)}`)
        console.error(`[cutSingleSimple] FFmpeg command that failed:\n  ${ffmpeg} ${ffmpegArgs.join(' ')}`)
        console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n')
        safeResolve(buildResult(requestId, false, elapsedMs, 0, 0, [], error))
      }
    })

    ffmpegProcess.on('error', (err) => {
      // Cleanup progress file watcher
      if (progressFileWatcher) {
        fs.unwatchFile(progressFilePath!)
        progressFileWatcher = null
      }
      // Cleanup file count interval to prevent resource leak
      clearInterval(fileCountInterval)
      const elapsedMs = Date.now() - startTime
      const error = `FFmpeg process error: ${err.message}`
      console.error(`âœ— ${error}`)
      console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n')
      safeResolve(buildResult(requestId, false, elapsedMs, 0, 0, [], error))
    })
  })
}

function buildResult(
  requestId: string,
  success: boolean,
  elapsedMs: number,
  avgSpeed: number,
  segmentCount: number,
  files: string[],
  error?: string
): CutSingleSimpleResult {
  return {
    requestId,
    success,
    elapsedMs,
    avgSpeed,
    segmentCount,
    outputFiles: files,
    error,
  }
}

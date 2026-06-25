// Low: centralize magic numbers
const CANCEL_CHECK_INTERVAL_MS = 500
const SIGKILL_DELAY_MS = 1000
/**
 * Merge Videos Simple - Ghép nhiều video với thuật toán tối ưu tốc độ
 * Chỉ dùng 1 lệnh concat + 0 hoặc 1 lệnh cut (copy-stream, không re-encode)
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID, randomBytes } from 'crypto'
import { spawn } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import { getVideoFileInfo } from './videoInfo'
import { verifyOutputVideo } from './outputVerification'
import { buildMergeProgress, type MergeProgress } from './videoProgress'
import { validateInputFiles, type ValidatedInputFile } from './videoUtils'
import {
  buildRandomPermutations,
  buildPlaylistToFillDuration,
  shuffleOnce,
  type ClipItem,
} from './utils/videoShuffleHelpers'
import { videoJobManager } from './videoJobManager'
import {
  checkMinimumSpace,
  createDiskSpaceErrorMessage,
  formatBytes,
  getDiskSpace,
} from '../utils/diskSpace'
import { buildVideoEncoderArgsWithChoice } from '../utils/gpuDetection'

/**
 * C4: Debug mode flag (from environment variable)
 */
const MERGE_DEBUG = process.env.MERGE_DEBUG === '1'

/**
 * C4: Debug log helper
 */
function debugLog(message: string, ...args: any[]): void {
  if (MERGE_DEBUG) {
    console.log(`[mergeVideosSimple:DEBUG] ${message}`, ...args)
  }
}

export interface MergeVideosSimpleRequest {
  inputFiles: string[]
  outputDir: string
  outputFileName: string
  shuffle?: boolean
  mute?: boolean
  targetDurationSec?: number | null
  mergeCount?: number // Số lần ghép (ví dụ: 5 → ghép 5 lần, xuất 5 video)
  repeatCount?: number // Số lần lặp lại files trong một merge (chỉ dùng khi không có target)
  requestId?: string
  forceReencode?: boolean // Chế độ ổn định (re-encode)
  /** Danh sách path video ưu tiên (thường nằm ở đầu inputFiles). Dùng để không bị loop lại khi targetDuration > tổng input. */
  priorityPaths?: string[]
  useGpuEncoding?: boolean // true = prefer GPU, false = force CPU, undefined = auto (default: CPU for backward compatibility)
  unifyFormat?: boolean      // Chuẩn hóa tỉ lệ khung hình + FPS (tự động bật re-encode)
  targetResolution?: string  // '1920x1080' | '1440x1080' | '2560x1080' | ... | '1080x1080'
  targetFps?: string         // '24' | '25' | '30000/1001' | '30' | '50' | '60000/1001' | '60'
}

export interface MergeVideosSimpleResult {
  requestId: string
  outputPaths: string[] // Mảng các file output (nhiều file khi mergeCount > 1)
  outputPath?: string // Giữ lại để backward compatibility
  totalDurationSec: number
  success: boolean
  error?: string
  avgSpeed?: number
  elapsedMs?: number
}


import { buildNormalizeVfFilter } from './utils/normalizeVf'

function shouldRunDeepVerifyForMerge(forceSafeMode: boolean, inputFiles: string[]): boolean {
  if (forceSafeMode) return true
  return inputFiles.length > 1
}

function shouldPreferStableMergePath(forceSafeMode: boolean, validInputs: ValidatedInputFile[]): boolean {
  if (forceSafeMode) return true
  if (validInputs.length <= 1) return false

  const baseline = validInputs[0]
  return validInputs.some(
    (item) => item.codecName !== baseline.codecName || item.fps !== baseline.fps,
  )
}

/**
 * Build concat list content for FFmpeg
 */
function buildConcatListContent(filePaths: string[]): string {
  // Dùng forward slash cho FFmpeg (cross-platform), không dùng bash-style escape
  return filePaths.map((filePath) => {
    const normalized = filePath.replace(/\\/g, '/')
    // Escape dấu nháy đơn theo cú pháp ffconcat: đóng quote, escape quote, rồi mở lại.
    const escaped = normalized.replace(/'/g, "'\\''")
    return `file '${escaped}'`
  }).join('\n')
}

const DEFAULT_VIDEO_CLIP_SIZE_BYTES = 200 * 1024 * 1024 // 200 MB fallback

function estimateConcatBytes(
  files: string[],
  sizeLookup: Map<string, number | null>
): number {
  let knownTotal = 0
  let knownCount = 0
  for (const file of files) {
    const size = sizeLookup.get(file)
    if (typeof size === 'number' && size > 0) {
      knownTotal += size
      knownCount++
    }
  }
  const avgSize = knownCount > 0 ? knownTotal / knownCount : DEFAULT_VIDEO_CLIP_SIZE_BYTES
  return files.reduce((sum, file) => {
    const size = sizeLookup.get(file)
    return sum + (typeof size === 'number' && size > 0 ? size : avgSize)
  }, 0)
}

async function ensureMergeDiskCapacity(
  outputDir: string,
  estimatedBytes: number,
  currentIndex: number,
  totalJobs: number
): Promise<void> {
  try {
    const diskInfo = await getDiskSpace(outputDir)
    // Buffer: 10% margin hoặc tối thiểu 1GB (giảm từ 4GB để tránh false positive)
    const buffer = Math.max(estimatedBytes * 1.1, 1 * 1024 * 1024 * 1024)
    if (diskInfo.free < buffer) {
      // CHỈ CẢNH BÁO, KHÔNG CHẶN: Log warning nhưng vẫn cho phép ghép video
      const warningMsg = `⚠️ CẢNH BÁO: Ổ ${diskInfo.drive} chỉ còn ${formatBytes(diskInfo.free)} nhưng video ${currentIndex}/${totalJobs} ước tính cần khoảng ${formatBytes(
        estimatedBytes
      )}. Vẫn tiếp tục ghép video...`
      console.warn(`[mergeVideosSimple] ${warningMsg}`)
      // KHÔNG throw error - chỉ log warning để user biết
    } else {
      console.log(
        `[mergeVideosSimple] ✓ Kiểm tra dung lượng: Ổ ${diskInfo.drive} còn ${formatBytes(diskInfo.free)}, đủ cho video ${currentIndex}/${totalJobs} (cần ~${formatBytes(estimatedBytes)})`
      )
    }
  } catch (err) {
    // Nếu không kiểm tra được dung lượng, chỉ log warning, không chặn
    console.warn(
      `[mergeVideosSimple] ⚠️ Không thể kiểm tra dung lượng ổ đĩa cho video ${currentIndex}/${totalJobs}:`,
      err instanceof Error ? err.message : String(err)
    )
    console.warn(`[mergeVideosSimple] Vẫn tiếp tục ghép video...`)
    // KHÔNG throw error - cho phép user tiếp tục
  }
}

/**
 * C3: Run FFmpeg concat (copy-stream) with retry and timeout
 */
async function runConcat(
  concatListPath: string,
  outputPath: string,
  mute: boolean,
  onProgress?: (progress: { percent: number; timeSec?: number; totalDurationSec?: number; speedX?: number | null; etaSec?: number | null }) => void,
  totalDurationSec?: number,
  retryCount: number = 0,
  requestId?: string
): Promise<void> {
  const { ffmpeg: ffmpegPath } = getFfmpegPaths()
  const MAX_RETRIES = 1
  const TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
  
  return new Promise<void>((resolve, reject) => {
    // safeResolve/safeReject guard — tránh double-resolve/reject khi nhiều nguồn (interval, stderr, close, error, timeout) đều fire
    let settled = false
    const safeResolve = () => { if (!settled) { settled = true; resolve() } }
    const safeReject = (err: Error) => { if (!settled) { settled = true; reject(err) } }

    // Check cancel trước khi bắt đầu
    if (requestId && videoJobManager.isCancelled(requestId)) {
      safeReject(new Error('Đã dừng bởi người dùng'))
      return
    }
    
    // C3: Simple args for retry (remove extra flags)
    // Bug #24 fix: -y must come BEFORE outputPath, not after
    const args = retryCount > 0
      ? [
          '-v', 'error',
          '-fflags', '+genpts+igndts+discardcorrupt',
          '-f', 'concat',
          '-safe', '0',
          '-i', concatListPath,
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart',
          ...(mute ? ['-an'] : []),
          '-y',
          outputPath,
        ]
      : [
          '-v', 'error',
          '-stats',
          '-fflags', '+genpts+igndts+discardcorrupt',
          '-f', 'concat',
          '-safe', '0',
          '-i', concatListPath,
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart',
          ...(mute ? ['-an'] : []),
          '-y',
          outputPath,
        ]
    
    const ffmpeg = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    
    // Register process vào videoJobManager để có thể cancel
    if (requestId) {
      videoJobManager.registerJob(requestId, ffmpeg)
    }
    
    // C3: Timeout protection
    const timeoutId = setTimeout(() => {
      clearInterval(cancelCheckInterval) // Fix Critical #1.2: Clear interval on timeout
      try {
        ffmpeg.kill('SIGKILL')
      } catch {}
      safeReject(new Error(`FFmpeg concat timed out after ${TIMEOUT_MS / 1000}s`))
    }, TIMEOUT_MS)

    let stderr = ''
    let lastProgressTime = 0
    let lastSpeedX: number | null = null
    let dropWarned = false
    const progressStartTime = Date.now()

    let cancelledByInterval = false

    // Interval check cancellation (mỗi 500ms) để đảm bảo phản hồi nhanh
    const cancelCheckInterval = setInterval(() => {
      if (requestId && videoJobManager.isCancelled(requestId)) {
        // Bug #26 fix: guard double-kill/double-reject with flag
        if (cancelledByInterval) return
        cancelledByInterval = true
        clearInterval(cancelCheckInterval)
        clearTimeout(timeoutId) // Also clear timeout when cancelling
        console.log(`[runConcat] Job ${requestId} cancelled (interval check), killing FFmpeg process`)
        if (!ffmpeg.killed) {
          ffmpeg.kill('SIGTERM')
          setTimeout(() => {
            if (!ffmpeg.killed && ffmpeg.pid) {
              try {
                ffmpeg.kill('SIGKILL')
              } catch (err) {
                // Ignore errors
              }
            }
          }, SIGKILL_DELAY_MS)
        }
        safeReject(new Error('Đã dừng bởi người dùng'))
      }
    }, CANCEL_CHECK_INTERVAL_MS)

    ffmpeg.stderr?.on('data', (data: Buffer) => {
      // Check nếu job đã bị cancel - kill process ngay lập tức
      // Bug #26 fix: skip if already handled by interval to avoid double-kill/double-reject
      if (cancelledByInterval) return
      if (requestId && videoJobManager.isCancelled(requestId)) {
        cancelledByInterval = true
        clearInterval(cancelCheckInterval)
        clearTimeout(timeoutId) // Also clear timeout when cancelling
        console.log(`[runConcat] Job ${requestId} cancelled, killing FFmpeg process`)
        if (!ffmpeg.killed) {
          ffmpeg.kill('SIGTERM')
          setTimeout(() => {
            if (!ffmpeg.killed && ffmpeg.pid) {
              try {
              ffmpeg.kill('SIGKILL')
              } catch (err) {
                // Ignore errors
              }
            }
          }, 1000)
        }
        safeReject(new Error('Đã dừng bởi người dùng'))
        return
      }

      const chunk = data.toString('utf-8')
      stderr += chunk
      // Cap stderr — chỉ giữ 80 dòng cuối để tránh OOM với video dài
      const lines = stderr.split('\n')
      if (lines.length > 80) {
        stderr = lines.slice(-80).join('\n')
      }
      
      // Parse progress từ time= và speed=
      if (chunk.includes('time=') && onProgress) {
        const timeMatch = chunk.match(/time=([0-9:.]+)/)
        if (timeMatch && timeMatch[1]) {
          const timeStr = timeMatch[1]
          const parts = timeStr.split(':')
          if (parts.length === 3) {
            const hours = parseFloat(parts[0]) || 0
            const minutes = parseFloat(parts[1]) || 0
            const seconds = parseFloat(parts[2]) || 0
            const currentTimeSec = hours * 3600 + minutes * 60 + seconds
            
              // Emit progress mỗi 0.1 giây (giảm từ 0.2s để cập nhật thường xuyên hơn)
            if (currentTimeSec - lastProgressTime >= 0.1) {
              lastProgressTime = currentTimeSec
              
              // Tính percent dựa trên totalDurationSec (bắt buộc phải có khi không có target)
              let percent = 0
              if (totalDurationSec && totalDurationSec > 0) {
                percent = Math.min(100, Math.max(0, (currentTimeSec / totalDurationSec) * 100))
              } else {
                // Nếu không có totalDurationSec, estimate từ elapsed time (fallback)
                const elapsedSec = (Date.now() - progressStartTime) / 1000
                if (elapsedSec > 0 && currentTimeSec > 0) {
                  // Estimate: giả sử tốc độ ổn định (chỉ dùng khi không có totalDurationSec)
                  const estimatedTotal = currentTimeSec * 2 // Rough estimate
                  percent = Math.min(95, (currentTimeSec / estimatedTotal) * 100)
                }
              }
              
              // Parse speed
              const speedMatch = chunk.match(/speed=\s*([0-9.]+)x/i)
              if (speedMatch && speedMatch[1]) {
                const speed = parseFloat(speedMatch[1])
                if (!isNaN(speed) && speed > 0) {
                  lastSpeedX = speed
                }
              }
              
              // Calculate ETA
              let etaSec: number | null = null
              if (lastSpeedX && lastSpeedX > 0 && totalDurationSec) {
                const remainingSec = totalDurationSec - currentTimeSec
                etaSec = remainingSec > 0 ? remainingSec / lastSpeedX : 0
              }
              
              onProgress({
                percent: Math.min(100, Math.max(0, percent)),
                timeSec: currentTimeSec,
                totalDurationSec,
                speedX: lastSpeedX,
                etaSec,
              })
            }
          }
        }
      }
      
      // Parse speed từ chunk riêng
      const speedMatch = chunk.match(/speed=\s*([0-9.]+)x/i)
      if (speedMatch && speedMatch[1]) {
        const speed = parseFloat(speedMatch[1])
        if (!isNaN(speed) && speed > 0) {
          lastSpeedX = speed
        }
      }

      // Log drop-frame / retry warnings
      if (!dropWarned && /drop=\d+/i.test(chunk)) {
        dropWarned = true
        console.warn('[mergeVideosSimple] FFmpeg báo drop-frame trong quá trình concat:\n', chunk)
      }
    })
    
    ffmpeg.on('error', (error) => {
      clearTimeout(timeoutId)
      clearInterval(cancelCheckInterval)
      safeReject(new Error(`FFmpeg concat error: ${error.message}`))
    })
    
    ffmpeg.on('close', async (code) => {
      clearTimeout(timeoutId)
      clearInterval(cancelCheckInterval)

      // Nếu job đã bị cancel, reject
      if (requestId && videoJobManager.isCancelled(requestId)) {
        safeReject(new Error('Đã dừng bởi người dùng'))
        return
      }

      if (code === 0 && fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath)
        if (stats.size === 0) {
          if (retryCount < MAX_RETRIES) {
            console.log(`[mergeVideosSimple] Retry concat (empty file), attempt ${retryCount + 1}/${MAX_RETRIES}`)
            try {
            await runConcat(concatListPath, outputPath, mute, onProgress, totalDurationSec, retryCount + 1, requestId)
              safeResolve()
            } catch (retryError) {
              safeReject(new Error(`FFmpeg concat produced empty file after retry: ${retryError}`))
            }
            return
          }
          safeReject(new Error('FFmpeg concat produced empty file'))
          return
        }
        // Đảm bảo emit progress 100% khi hoàn thành (tránh progress đứng ở ~99%)
        if (onProgress && totalDurationSec) {
          onProgress({
            percent: 100,
            timeSec: totalDurationSec,
            totalDurationSec,
            speedX: lastSpeedX,
            etaSec: 0,
          })
        }
        safeResolve()
      } else {
        // C3: Retry on failure
        if (retryCount < MAX_RETRIES) {
          console.log(`[mergeVideosSimple] Retry concat (code ${code}), attempt ${retryCount + 1}/${MAX_RETRIES}`)
          try {
            await runConcat(concatListPath, outputPath, mute, onProgress, totalDurationSec, retryCount + 1, requestId)
            safeResolve()
          } catch (retryError) {
            safeReject(new Error(`FFmpeg concat failed with code ${code} after retry: ${stderr.slice(0, 500)}`))
          }
          return
        }
        safeReject(new Error(`FFmpeg concat failed with code ${code}: ${stderr.slice(0, 500)}`))
      }
    })
  })
}

/**
 * D3: Run FFmpeg concat + cut in 1 pass (ultra-fast)
 */
async function runConcatWithCut(
  concatListPath: string,
  outputPath: string,
  targetDurationSec: number,
  mute: boolean,
  onProgress?: (progress: { percent: number; timeSec?: number; speedX?: number | null; etaSec?: number | null }) => void,
  retryCount: number = 0,
  requestId?: string
): Promise<void> {
  const { ffmpeg: ffmpegPath } = getFfmpegPaths()
  const MAX_RETRIES = 1
  const TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
  
  return new Promise<void>((resolve, reject) => {
    // safeResolve/safeReject guard — tránh double-resolve/reject khi nhiều nguồn (interval, stderr, close, error, timeout) đều fire
    let settled = false
    const safeResolve = () => { if (!settled) { settled = true; resolve() } }
    const safeReject = (err: Error) => { if (!settled) { settled = true; reject(err) } }

    // D3: Gộp concat + cut thành 1 lệnh
    // Bug #24 fix: -y must come BEFORE outputPath, not after
    const args = retryCount > 0
      ? [
          '-v', 'error',
          '-fflags', '+genpts+igndts+discardcorrupt',
          '-f', 'concat',
          '-safe', '0',
          '-i', concatListPath,
          '-t', String(targetDurationSec),
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart',
          ...(mute ? ['-an'] : []),
          '-y',
          outputPath,
        ]
      : [
          '-v', 'error',
          '-stats',
          '-fflags', '+genpts+igndts+discardcorrupt',
          '-f', 'concat',
          '-safe', '0',
          '-i', concatListPath,
          '-t', String(targetDurationSec),
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart',
          ...(mute ? ['-an'] : []),
          '-y',
          outputPath,
        ]
    
    const ffmpeg = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    
    // Register process vào videoJobManager để có thể cancel
    if (requestId) {
      videoJobManager.registerJob(requestId, ffmpeg)
    }
    
    // D3: Timeout protection
    const timeoutId = setTimeout(() => {
      clearInterval(cancelCheckInterval) // Fix Critical #1.2: Clear interval on timeout
      try {
        ffmpeg.kill('SIGKILL')
      } catch {}
      safeReject(new Error(`FFmpeg concat+cut timed out after ${TIMEOUT_MS / 1000}s`))
    }, TIMEOUT_MS)

    let stderr = ''
    let lastProgressTime = 0
    let lastSpeedX: number | null = null
    let cancelledByInterval = false // Guard để tránh double-reject từ stderr handler

    // Interval check cancellation (mỗi 500ms) để đảm bảo phản hồi nhanh
    const cancelCheckInterval = setInterval(() => {
      if (requestId && videoJobManager.isCancelled(requestId)) {
        cancelledByInterval = true
        clearInterval(cancelCheckInterval)
        clearTimeout(timeoutId) // Also clear timeout when cancelling
        console.log(`[runConcatWithCut] Job ${requestId} cancelled (interval check), killing FFmpeg process`)
        if (!ffmpeg.killed) {
          ffmpeg.kill('SIGTERM')
          setTimeout(() => {
            if (!ffmpeg.killed && ffmpeg.pid) {
              try {
                ffmpeg.kill('SIGKILL')
              } catch (err) {
                // Ignore errors
              }
            }
          }, SIGKILL_DELAY_MS)
        }
        safeReject(new Error('Đã dừng bởi người dùng'))
      }
    }, CANCEL_CHECK_INTERVAL_MS)

    ffmpeg.stderr?.on('data', (data: Buffer) => {
      // Check nếu job đã bị cancel - kill process ngay lập tức
      // Guard: skip nếu interval đã xử lý để tránh double-reject
      if (cancelledByInterval) return
      if (requestId && videoJobManager.isCancelled(requestId)) {
        cancelledByInterval = true
        clearInterval(cancelCheckInterval)
        clearTimeout(timeoutId) // Also clear timeout when cancelling
        console.log(`[runConcatWithCut] Job ${requestId} cancelled, killing FFmpeg process`)
        if (!ffmpeg.killed) {
          ffmpeg.kill('SIGTERM')
          setTimeout(() => {
            if (!ffmpeg.killed && ffmpeg.pid) {
              try {
              ffmpeg.kill('SIGKILL')
              } catch (err) {
                // Ignore errors
              }
            }
          }, 1000)
        }
        safeReject(new Error('Đã dừng bởi người dùng'))
        return
      }

      const chunk = data.toString('utf-8')
      stderr += chunk
      // Cap stderr — chỉ giữ 80 dòng cuối để tránh OOM với video dài
      const lines = stderr.split('\n')
      if (lines.length > 80) {
        stderr = lines.slice(-80).join('\n')
      }
      
      // D3: Progress từ time= - parse chính xác hơn
      if (chunk.includes('time=') && onProgress) {
        const timeMatch = chunk.match(/time=([0-9:.]+)/)
        if (timeMatch && timeMatch[1] && targetDurationSec > 0) {
          const timeStr = timeMatch[1]
          const parts = timeStr.split(':')
          if (parts.length === 3) {
            const hours = parseFloat(parts[0]) || 0
            const minutes = parseFloat(parts[1]) || 0
            const seconds = parseFloat(parts[2]) || 0
            const currentTimeSec = hours * 3600 + minutes * 60 + seconds
            
            // Tính percent chính xác
            const percent = Math.min(100, Math.max(0, (currentTimeSec / targetDurationSec) * 100))
            
            // Parse speed từ chunk này hoặc từ biến lastSpeedX
            const speedMatch = chunk.match(/speed=\s*([0-9.]+)x/i)
            if (speedMatch && speedMatch[1]) {
              const speed = parseFloat(speedMatch[1])
              if (!isNaN(speed) && speed > 0) {
                lastSpeedX = speed
              }
            }
            
            // Emit progress mỗi 0.1 giây (giảm từ 0.2s để cập nhật thường xuyên hơn)
            if (currentTimeSec - lastProgressTime >= 0.1) {
              lastProgressTime = currentTimeSec
              
              // Calculate ETA
              let etaSec: number | null = null
              if (lastSpeedX && lastSpeedX > 0 && targetDurationSec > 0) {
                const remainingSec = targetDurationSec - currentTimeSec
                etaSec = remainingSec > 0 ? remainingSec / lastSpeedX : 0
              }
              
              onProgress({
                percent,
                timeSec: currentTimeSec,
                speedX: lastSpeedX,
                etaSec,
              })
            }
          }
        }
      }
      
      // Parse speed từ chunk riêng (nếu không có time=)
      const speedMatch = chunk.match(/speed=\s*([0-9.]+)x/i)
      if (speedMatch && speedMatch[1]) {
        const speed = parseFloat(speedMatch[1])
        if (!isNaN(speed) && speed > 0) {
          lastSpeedX = speed
        }
      }
    })
    
    ffmpeg.on('error', (error) => {
      clearTimeout(timeoutId)
      clearInterval(cancelCheckInterval)
      safeReject(new Error(`FFmpeg concat+cut error: ${error.message}`))
    })

    ffmpeg.on('close', async (code) => {
      clearTimeout(timeoutId)
      clearInterval(cancelCheckInterval)

      // Nếu job đã bị cancel, reject
      if (requestId && videoJobManager.isCancelled(requestId)) {
        safeReject(new Error('Đã dừng bởi người dùng'))
        return
      }

      if (code === 0 && fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath)
        if (stats.size === 0) {
          if (retryCount < MAX_RETRIES) {
            console.log(`[mergeVideosSimple] Retry concat+cut (empty file), attempt ${retryCount + 1}/${MAX_RETRIES}`)
            try {
              await runConcatWithCut(concatListPath, outputPath, targetDurationSec, mute, onProgress, retryCount + 1, requestId)
              safeResolve()
            } catch (retryError) {
              safeReject(new Error(`FFmpeg concat+cut produced empty file after retry: ${retryError}`))
            }
            return
          }
          safeReject(new Error('FFmpeg concat+cut produced empty file'))
          return
        }
        // Đảm bảo emit progress 100% khi hoàn thành (tránh progress đứng ở ~99%)
        if (onProgress && targetDurationSec) {
          onProgress({
            percent: 100,
            timeSec: targetDurationSec,
            speedX: lastSpeedX,
            etaSec: 0,
          })
        }
        safeResolve()
      } else {
        // D3: Retry on failure
        if (retryCount < MAX_RETRIES) {
          console.log(`[mergeVideosSimple] Retry concat+cut (code ${code}), attempt ${retryCount + 1}/${MAX_RETRIES}`)
          try {
            await runConcatWithCut(concatListPath, outputPath, targetDurationSec, mute, onProgress, retryCount + 1, requestId)
            safeResolve()
          } catch (retryError) {
            safeReject(new Error(`FFmpeg concat+cut failed with code ${code} after retry: ${stderr.slice(0, 500)}`))
          }
          return
        }
        safeReject(new Error(`FFmpeg concat+cut failed with code ${code}: ${stderr.slice(0, 500)}`))
      }
    })
  })
}

/**
 * C3: Run FFmpeg cut (copy-stream) with retry and timeout
 */
async function runCut(
  inputPath: string,
  outputPath: string,
  targetDurationSec: number,
  mute: boolean,
  onProgress?: (progress: { percent: number; timeSec?: number; speedX?: number | null; etaSec?: number | null }) => void,
  retryCount: number = 0,
  requestId?: string
): Promise<void> {
  const { ffmpeg: ffmpegPath } = getFfmpegPaths()
  const MAX_RETRIES = 1
  const TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
  
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const safeReject = (err: Error) => { if (!settled) { settled = true; reject(err) } }
    const safeResolve = () => { if (!settled) { settled = true; resolve() } }

    let stderr = ''
    let lastSpeedX: number | null = null
    const args = retryCount > 0
      ? [
          '-y',
          '-fflags', '+genpts+igndts+discardcorrupt',
          '-v', 'error',
          '-i', inputPath,
          '-t', String(targetDurationSec),
          '-c', 'copy',
          ...(mute ? ['-an'] : []),
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart',
          outputPath,
        ]
      : [
          '-y',
          '-fflags', '+genpts+igndts+discardcorrupt',
          '-v', 'error',
          '-stats',
          '-i', inputPath,
          '-t', String(targetDurationSec),
          '-c', 'copy',
          ...(mute ? ['-an'] : []),
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart',
          outputPath,
        ]
    
    const ffmpeg = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    
    // Register process vào videoJobManager để có thể cancel
    if (requestId) {
      videoJobManager.registerJob(requestId, ffmpeg)
    }
    
    // C3: Timeout protection
    const timeoutId = setTimeout(() => {
      clearInterval(cancelCheckInterval) // Fix Critical #1.2: Clear interval on timeout
      try {
        ffmpeg.kill('SIGKILL')
      } catch {}
      safeReject(new Error(`FFmpeg cut timed out after ${TIMEOUT_MS / 1000}s`))
    }, TIMEOUT_MS)

    let cancelledByInterval = false // Guard double-kill/double-reject

    // Interval check cancellation (mỗi 500ms) để đảm bảo phản hồi nhanh
    const cancelCheckInterval = setInterval(() => {
      if (requestId && videoJobManager.isCancelled(requestId)) {
        if (cancelledByInterval) return
        cancelledByInterval = true
        clearInterval(cancelCheckInterval)
        clearTimeout(timeoutId) // Also clear timeout when cancelling
        console.log(`[runCut] Job ${requestId} cancelled (interval check), killing FFmpeg process`)
        if (!ffmpeg.killed) {
          ffmpeg.kill('SIGTERM')
          setTimeout(() => {
            if (!ffmpeg.killed && ffmpeg.pid) {
              try {
                ffmpeg.kill('SIGKILL')
              } catch (err) {
                // Ignore errors
              }
            }
          }, SIGKILL_DELAY_MS)
        }
        safeReject(new Error('Đã dừng bởi người dùng'))
      }
    }, CANCEL_CHECK_INTERVAL_MS)

    ffmpeg.stderr?.on('data', (data: Buffer) => {
      // Check nếu job đã bị cancel - kill process ngay lập tức
      if (cancelledByInterval) return
      if (requestId && videoJobManager.isCancelled(requestId)) {
        cancelledByInterval = true
        clearInterval(cancelCheckInterval)
        clearTimeout(timeoutId) // Also clear timeout when cancelling
        console.log(`[runCut] Job ${requestId} cancelled, killing FFmpeg process`)
        if (!ffmpeg.killed) {
          ffmpeg.kill('SIGTERM')
          setTimeout(() => {
            if (!ffmpeg.killed && ffmpeg.pid) {
              try {
              ffmpeg.kill('SIGKILL')
              } catch (err) {
                // Ignore errors
              }
            }
          }, 1000)
        }
        safeReject(new Error('Đã dừng bởi người dùng'))
        return
      }

      const chunk = data.toString('utf-8')
      // Append trước, cap sau — đảm bảo mọi chunk đều bị giới hạn
      stderr += chunk
      const lines = stderr.split('\n')
      if (lines.length > 80) {
        stderr = lines.slice(-80).join('\n')
      }
      
      // Parse speed từ chunk
      const speedMatch = chunk.match(/speed=\s*([0-9.]+)x/i)
      if (speedMatch && speedMatch[1]) {
        const speed = parseFloat(speedMatch[1])
        if (!isNaN(speed) && speed > 0) {
          lastSpeedX = speed
        }
      }
      
      // Simple progress: emit 90% when we see progress
      if (chunk.includes('time=') && onProgress) {
        // Parse time=HH:MM:SS.xx từ FFmpeg stderr để tính percent thực tế
        const timeMatch = chunk.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
        let percent = 90 // fallback nếu parse fail
        if (timeMatch && targetDurationSec > 0) {
          const h = Number(timeMatch[1])
          const m = Number(timeMatch[2])
          const s = Number(timeMatch[3])
          const currentSec = h * 3600 + m * 60 + s
          percent = Math.min(99, Math.round((currentSec / targetDurationSec) * 100))
        }
        onProgress({
          percent,
          timeSec: undefined,
          speedX: lastSpeedX,
          etaSec: undefined,
        })
      }
    })
    
    ffmpeg.on('error', (error) => {
      clearTimeout(timeoutId)
      clearInterval(cancelCheckInterval)
      safeReject(new Error(`FFmpeg cut error: ${error.message}`))
    })

    ffmpeg.on('close', async (code) => {
      clearTimeout(timeoutId)
      clearInterval(cancelCheckInterval)

      // Nếu job đã bị cancel, reject
      if (requestId && videoJobManager.isCancelled(requestId)) {
        safeReject(new Error('Đã dừng bởi người dùng'))
        return
      }

      if (code === 0 && fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath)
        if (stats.size === 0) {
          if (retryCount < MAX_RETRIES) {
            console.log(`[mergeVideosSimple] Retry cut (empty file), attempt ${retryCount + 1}/${MAX_RETRIES}`)
            try {
              await runCut(inputPath, outputPath, targetDurationSec, mute, onProgress, retryCount + 1, requestId)
              safeResolve()
            } catch (retryError) {
              safeReject(new Error(`FFmpeg cut produced empty file after retry: ${retryError}`))
            }
            return
          }
          safeReject(new Error('FFmpeg cut produced empty file'))
          return
        }
        // Đảm bảo emit progress 100% khi hoàn thành (tránh progress đứng ở ~99%)
        if (onProgress && targetDurationSec) {
          onProgress({
            percent: 100,
            timeSec: targetDurationSec,
            speedX: lastSpeedX,
            etaSec: 0,
          })
        }
        safeResolve()
      } else {
        // C3: Retry on failure
        if (retryCount < MAX_RETRIES) {
          console.log(`[mergeVideosSimple] Retry cut (code ${code}), attempt ${retryCount + 1}/${MAX_RETRIES}`)
          try {
            await runCut(inputPath, outputPath, targetDurationSec, mute, onProgress, retryCount + 1, requestId)
            safeResolve()
          } catch (retryError) {
            safeReject(new Error(`FFmpeg cut failed with code ${code} after retry: ${stderr.slice(0, 500)}`))
          }
          return
        }
        safeReject(new Error(`FFmpeg cut failed with code ${code}: ${stderr.slice(0, 500)}`))
      }
    })
  })
}

/**
 * Fallback: transcode tất cả inputs về định dạng an toàn (H.264/AAC) rồi concat copy
 */
async function fallbackTranscodeAndConcat(
  inputs: string[],
  outputPath: string,
  mute: boolean,
  targetDurationSec?: number | null,
  onProgress?: (progress: { percent: number; speedX?: number | null; timeSec?: number; etaSec?: number | null }) => void,
  requestId?: string,
  useGpuEncoding?: boolean,
  normalizeVfFilter?: string | null
): Promise<void> {
  // Fix High #2.3: Check disk space before creating temp dir
  const { getDiskSpace, checkMinimumSpace, formatBytes } = await import('../utils/diskSpace')
  try {
    const tmpDirPath = os.tmpdir()
    const diskInfo = await getDiskSpace(tmpDirPath)
    // Estimate: assume each input file needs ~200MB temp space
    const estimatedBytes = inputs.length * 200 * 1024 * 1024
    const spaceCheck = checkMinimumSpace(diskInfo.free, Math.ceil(estimatedBytes / (1024 * 1024 * 1024)))
    if (!spaceCheck.enough) {
      throw new Error(
        `Không đủ dung lượng ổ đĩa để tạo temp files. Cần: ${formatBytes(estimatedBytes)}, Còn: ${formatBytes(diskInfo.free)}`
      )
    }
  } catch (diskErr: any) {
    console.warn('[mergeVideosSimple] Disk space check failed, continuing anyway:', diskErr)
  }
  
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'merge-safe-'))
  const { ffmpeg } = getFfmpegPaths()
  const safeOutputs: string[] = []
  let cleanupOnCancel = false
  let lastKnownSpeedX: number | null = null // Track across files to avoid flicker
  try {
    // Transcode từng file
    for (let i = 0; i < inputs.length; i++) {
      // Check cancel trước khi bắt đầu transcode file tiếp theo
      if (requestId && videoJobManager.isCancelled(requestId)) {
        cleanupOnCancel = true
        throw new Error('Đã dừng bởi người dùng')
      }
      
      const input = inputs[i]
      const safeOut = path.join(tmpDir, `safe_${i + 1}.mp4`)
      await new Promise<void>(async (resolve, reject) => {
        let settled = false
        const safeReject = (err: Error) => { if (!settled) { settled = true; reject(err) } }
        const safeResolve = () => { if (!settled) { settled = true; resolve() } }
        // Build encoder args based on user choice (GPU/CPU/Auto)
        const userChoice: 'gpu' | 'cpu' | 'auto' = useGpuEncoding === true ? 'gpu' : useGpuEncoding === false ? 'cpu' : 'auto'
        const { args: encoderArgs, usedEncoder, gpuInfo } = await buildVideoEncoderArgsWithChoice(
          true, // needsReencode
          userChoice,
          'fast' // quality preset
        )
        const selectedFfmpegPath =
          usedEncoder === 'gpu' && gpuInfo?.ffmpegPath ? gpuInfo.ffmpegPath : ffmpeg
        
        // Log encoder being used (only for first file to avoid spam)
        if (i === 0) {
          if (usedEncoder === 'gpu' && gpuInfo) {
            console.log(`[fallbackTranscodeAndConcat] Using ${gpuInfo.encoder.toUpperCase()} encoder (${gpuInfo.name || 'GPU'}) for fallback transcode`)
          } else {
            console.log(`[fallbackTranscodeAndConcat] Using CPU encoder (libx264)${gpuInfo && !gpuInfo.available ? ` - ${gpuInfo.reason}` : ''}`)
          }
        }
        
        // When a software -vf filter is used, frames MUST be in CPU memory.
        // h264_nvenc + -hwaccel nvdec keeps frames on GPU → software scale/pad/fps crashes
        // with 0xC0000005 (ACCESS_VIOLATION). Fix: strip -hwaccel entirely when vf filter active.
        // Without vf filter, keep -hwaccel before -i for GPU decode acceleration.
        const hwaccelIndex = encoderArgs.indexOf('-hwaccel')
        let hwaccelArgs: string[] = []
        let encoderArgsWithoutHwaccel = encoderArgs
        if (hwaccelIndex >= 0 && hwaccelIndex < encoderArgs.length - 1) {
          if (!normalizeVfFilter) {
            // Only use hwaccel when NO software vf filter (pure copy/encode without filter)
            hwaccelArgs = encoderArgs.slice(hwaccelIndex, hwaccelIndex + 2)
          }
          // Always remove -hwaccel from encoderArgs (it goes before -i separately, or stripped)
          encoderArgsWithoutHwaccel = [...encoderArgs.slice(0, hwaccelIndex), ...encoderArgs.slice(hwaccelIndex + 2)]
        }

        // Replace -vsync 2 (VFR) with -vsync cfr when re-encoding to prevent timestamp discontinuity
        encoderArgsWithoutHwaccel = encoderArgsWithoutHwaccel.map((arg, idx, arr) => {
          if (arg === '-vsync' && arr[idx + 1] === '2') return '-vsync'
          if (idx > 0 && arr[idx - 1] === '-vsync' && arg === '2') return 'cfr'
          return arg
        })

        // When normalizeVfFilter is provided, use it (already includes fps=); otherwise default normalize
        // Phải thêm fps=30 vào default vf filter để đảm bảo CFR — các clip VFR hoặc FPS khác nhau
        // khi concat copy sẽ gây timestamp mismatch → dừng hình tại điểm chuyển cảnh
        const vfFilter = normalizeVfFilter || 'scale=iw:ih,setsar=1,fps=30,format=yuv420p'
        const args = [
          '-hide_banner',
          '-y',
          '-fflags', '+genpts+igndts+discardcorrupt', // Regenerate PTS to fix discontinuous timestamps from source clips
          ...hwaccelArgs, // Hardware acceleration flags (only if no software vf filter)
          '-i', input,
          '-vf', vfFilter,
          ...encoderArgsWithoutHwaccel,
          // -map 0:a? → optional: nếu clip không có audio track thì FFmpeg không crash
          // thay vì để FFmpeg tự tìm audio (gây lỗi "no audio stream found")
          '-map', '0:v:0',
          '-map', '0:a?',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-ar', '48000',
          '-ac', '2',
          ...(mute ? ['-an'] : []),
          '-avoid_negative_ts', 'make_zero', // Fix negative timestamps
          '-movflags', '+faststart',
          safeOut,
        ]
        const proc = spawn(selectedFfmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
        
        // Register process vào videoJobManager để có thể cancel
        if (requestId) {
          const childRequestId = `${requestId}-transcode-${i}`
          videoJobManager.registerJob(childRequestId, proc)
        }
        
        // Check cancel trong stderr handler + parse speed for real-time progress
        let fileSpeedX: number | null = null
        proc.stderr?.on('data', (data: Buffer) => {
          if (requestId && videoJobManager.isCancelled(requestId)) {
            cleanupOnCancel = true // Fix Critical #1.1: Mark for cleanup on cancel
            console.log(`[fallbackTranscodeAndConcat] Job ${requestId} cancelled, killing transcode process ${i}`)
            if (!proc.killed) {
              proc.kill('SIGTERM')
              setTimeout(() => {
                if (!proc.killed) {
                  proc.kill('SIGKILL')
                }
              }, 1000)
            }
            safeReject(new Error('Đã dừng bởi người dùng'))
            return
          }
          // Parse speed= from FFmpeg stderr so UI can show ETA during transcode phase
          const chunk = data.toString('utf-8')
          const speedMatch = chunk.match(/speed=\s*([0-9.]+)x/i)
          if (speedMatch) {
            const speed = parseFloat(speedMatch[1])
            if (!isNaN(speed) && speed > 0) {
              fileSpeedX = speed
              lastKnownSpeedX = speed // persist across files to avoid speed flicker
              if (onProgress) {
                const fileBasePercent = (i / inputs.length) * 40
                onProgress({ percent: Math.min(39, fileBasePercent), speedX: fileSpeedX })
              }
            }
          }
        })

        proc.on('error', (err) => safeReject(err))
        proc.on('close', (code) => {
          // Check cancel trước khi resolve/reject
          if (requestId && videoJobManager.isCancelled(requestId)) {
            cleanupOnCancel = true // Fix Critical #1.1: Mark for cleanup on cancel
            safeReject(new Error('Đã dừng bởi người dùng'))
            return
          }

          if (code === 0 && fs.existsSync(safeOut)) safeResolve()
          else safeReject(new Error(`Transcode failed for ${input} (code ${code})`))
        })
      })
      safeOutputs.push(safeOut)
      if (onProgress) {
        // Emit per-file completion, carry lastKnownSpeedX to avoid speed flicker between files
        onProgress({ percent: Math.min(39, ((i + 1) / inputs.length) * 40), speedX: lastKnownSpeedX })
      }
    }

    // Build concat list
    const concatListPath = path.join(tmpDir, `concat_safe_${Date.now()}.txt`)
    await fsp.writeFile(concatListPath, buildConcatListContent(safeOutputs), { encoding: 'utf8' })

    // Concat (copy) với safe outputs — forward onProgress so UI gets ETA during concat phase
    if (targetDurationSec && targetDurationSec > 0) {
      await runConcatWithCut(concatListPath, outputPath, targetDurationSec, mute, onProgress ? (p) => {
        onProgress({ percent: 40 + (p.percent / 100) * 60, speedX: p.speedX ?? lastKnownSpeedX, timeSec: p.timeSec, etaSec: p.etaSec })
      } : undefined, 0, requestId)
    } else {
      await runConcat(concatListPath, outputPath, mute, onProgress ? (p) => {
        onProgress({ percent: 40 + (p.percent / 100) * 60, speedX: p.speedX ?? lastKnownSpeedX, timeSec: p.timeSec, etaSec: p.etaSec })
      } : undefined, undefined, 0, requestId)
    }
  } finally {
    // Cleanup temp
    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true })
    } catch (err) {
      console.warn('[mergeVideosSimple] Failed to cleanup temp dir:', err)
    }
  }
}

/**
 * Generate output file name
 */
function generateOutputFileName(baseFileName: string, index: number, total: number): string {
  const ext = path.extname(baseFileName) || '.mp4'
  const nameWithoutExt = path.basename(baseFileName, ext)
  
  if (total > 1) {
    return `${nameWithoutExt}_${index}${ext}`
  } else {
    return baseFileName
  }
}

/**
 * Main merge function - Rebuilt for maximum speed
 */
export async function mergeVideosSimple(
  req: MergeVideosSimpleRequest,
  onProgress?: (progress: MergeProgress) => void
): Promise<MergeVideosSimpleResult> {
  const requestId = req.requestId || randomUUID()
  const startTime = Date.now()
  let sentWarningMessage = false
  
  try {
    if (!req.inputFiles || req.inputFiles.length === 0) {
      throw new Error('Không có inputFiles để ghép')
    }
    
    const mergeCount = req.mergeCount && req.mergeCount > 1 ? req.mergeCount : 1
    const forceSafeMode = !!(req.forceReencode || req.unifyFormat)
    const normalizeVfFilter = req.unifyFormat && req.targetResolution && req.targetFps
      ? buildNormalizeVfFilter(req.targetResolution, req.targetFps)
      : null
    console.log(`[mergeVideosSimple] forceSafeMode=${forceSafeMode ? 'ON' : 'OFF'} (forceReencode=${req.forceReencode}, unifyFormat=${req.unifyFormat}, resolution=${req.targetResolution}, fps=${req.targetFps})`)
    
    // Create output directory
    if (!fs.existsSync(req.outputDir)) {
      fs.mkdirSync(req.outputDir, { recursive: true })
    }

    // STEP 1: Kiểm tra dung lượng ổ đĩa cho outputDir — PLAN A: CHỈ CẢNH BÁO, KHÔNG CHẶN
    try {
      console.log('[mergeVideosSimple] Checking disk space...')
      const diskInfo = await getDiskSpace(req.outputDir)
      console.log(
        `[mergeVideosSimple] Disk ${diskInfo.drive}: ${formatBytes(diskInfo.free)} free (${(
          diskInfo.free /
          (1024 * 1024 * 1024)
        ).toFixed(2)} GB)`
      )

      const spaceCheck = checkMinimumSpace(diskInfo.free, 1)
      if (!spaceCheck.enough && !diskInfo.unknown) {
        // CHỈ CẢNH BÁO: getDiskSpace đã đo đúng bằng fs.statfs; nếu thật sự đầy
        // FFmpeg sẽ báo ENOSPC. Không chặn user.
        console.warn(
          `[mergeVideosSimple] ⚠️ Dung lượng ổ ${diskInfo.drive} có thể không đủ ` +
          `(còn ${formatBytes(diskInfo.free)}) — vẫn tiếp tục merge.`
        )
      } else {
        console.log('[mergeVideosSimple] ✓ Disk space OK')
      }
    } catch (diskErr: any) {
      // Nếu không kiểm tra được dung lượng, chỉ log warning, không chặn
      console.warn(
        `[mergeVideosSimple] ⚠️ Không thể kiểm tra dung lượng ổ đĩa:`,
        diskErr instanceof Error ? diskErr.message : String(diskErr)
      )
      console.warn('[mergeVideosSimple] Vẫn tiếp tục ghép video...')
    }
    
    // B5: Progress nhẹ - stage: probe
    if (onProgress) {
      onProgress(buildMergeProgress({
        mode: 'merge',
        requestId,
        stage: 'probe',
        percent: 0,
      }))
    }
    
    // DEBUG: Log input files trước khi validate
    console.log(`[mergeVideosSimple][DEBUG] Input files count: ${req.inputFiles.length}`)
    if (req.inputFiles.length > 0) {
      console.log(`[mergeVideosSimple][DEBUG] First 5 input files:`, req.inputFiles.slice(0, 5))
      console.log(`[mergeVideosSimple][DEBUG] Last 5 input files:`, req.inputFiles.slice(-5))
    }
    
    // D3: validateInputFiles chỉ chạy 1 lần trước job
    const { valid, invalid } = await validateInputFiles(req.inputFiles, 10)
    const preferStableMergePath = shouldPreferStableMergePath(forceSafeMode, valid)
    if (!forceSafeMode && preferStableMergePath) {
      console.log('[mergeVideosSimple] Auto-enable stable merge path because input videos differ in codec/FPS/resolution.')
    }
    
    // DEBUG: Log sau khi validate
    console.log(`[mergeVideosSimple][DEBUG] After validate: valid=${valid.length}, invalid=${invalid.length}`)
    const distinctValidPaths = new Set(valid.map(v => v.path))
    if (distinctValidPaths.size !== valid.length) {
      console.error(`[mergeVideosSimple][ERROR] Duplicate paths in valid array! distinct=${distinctValidPaths.size}, total=${valid.length}`)
    }
    
    if (valid.length === 0) {
      throw new Error('Không có video hợp lệ để ghép (tất cả file đều lỗi hoặc hỏng)')
    }
    
    // B5: Progress nhẹ - message nếu có invalid files
    if (invalid.length > 0 && onProgress && !sentWarningMessage) {
      onProgress(buildMergeProgress({
        mode: 'merge',
        requestId,
        stage: 'probe',
        percent: 2,
        message: `Đã bỏ qua ${invalid.length} video lỗi / hỏng trước khi ghép`,
      }))
      sentWarningMessage = true
    }
    
    // Build input info map
    const inputInfoMap = new Map(valid.map(v => [v.path, v.durationSec]))
    const sizeLookup = new Map<string, number | null>(
      valid.map((v) => [v.path, typeof v.sizeBytes === 'number' ? v.sizeBytes : null])
    )
    const filesWithDuration = valid.map(v => ({
      path: v.path,
      duration: v.durationSec,
      sizeBytes: typeof v.sizeBytes === 'number' ? v.sizeBytes : null,
    }))
    
    const totalInputDuration = filesWithDuration.reduce((sum, f) => sum + f.duration, 0)
    
    console.log(`[mergeVideosSimple] Valid files: ${valid.length}, total duration: ${totalInputDuration.toFixed(2)}s`)
    console.log(`[mergeVideosSimple] Merge count: ${mergeCount}`)
    
    // Map sang ClipItem
    const baseClips: ClipItem[] = filesWithDuration
      .map(f => ({
        path: f.path,
        durationSec: f.duration ?? 0,
        id: f.path,
        sizeBytes: f.sizeBytes ?? undefined,
      }))
      .filter(c => c.durationSec > 0)
    
    // Nhóm video ưu tiên (nếu có) theo path, giữ nguyên thứ tự như trong baseClips
    const priorityPathSet =
      Array.isArray(req.priorityPaths) && req.priorityPaths.length > 0
        ? new Set(req.priorityPaths)
        : null
    const priorityClips: ClipItem[] = priorityPathSet
      ? baseClips.filter((c) => priorityPathSet.has(c.path))
      : []
    const nonPriorityClips: ClipItem[] =
      priorityPathSet && priorityClips.length > 0
        ? baseClips.filter((c) => !priorityPathSet.has(c.path))
        : baseClips

    // DEBUG: Log baseClips
    console.log(`[mergeVideosSimple][DEBUG] baseClips.length = ${baseClips.length}`)
    if (baseClips.length > 0) {
      console.log(`[mergeVideosSimple][DEBUG] First 5 clips:`, baseClips.slice(0, 5).map(c => path.basename(c.path)))
      console.log(`[mergeVideosSimple][DEBUG] Last 5 clips:`, baseClips.slice(-5).map(c => path.basename(c.path)))
    }
    const distinctClips = new Set(baseClips.map(c => c.path))
    console.log(`[mergeVideosSimple][DEBUG] Distinct clips: ${distinctClips.size}`)
    if (distinctClips.size !== baseClips.length) {
      console.error(`[mergeVideosSimple][ERROR] Duplicate clips detected! distinct=${distinctClips.size}, total=${baseClips.length}`)
    }
    
    // UltraFast: Tách rõ nhánh "no target" vs "has target"
    const hasTarget = typeof req.targetDurationSec === 'number' && req.targetDurationSec > 0
    const targetDurationSec = hasTarget ? Number(req.targetDurationSec) : null
    
    // PHASE 2: Tạo permutations cho no-target mode (trước vòng lặp)
    let permutations: ClipItem[][] | null = null
    if (!hasTarget) {
      if (req.shuffle) {
        permutations = buildRandomPermutations(baseClips, mergeCount)
        const generatedPermutations = permutations as ClipItem[][]
        console.log(`[merge][no-target] Created ${generatedPermutations.length} permutations, each with ${baseClips.length} clips`)
        
        // Verify uniqueness để tránh trùng
        const permutationSignatures = new Set<string>()
        generatedPermutations.forEach((perm, idx) => {
          const signature = perm.map((c) => c.path).join('|')
          if (permutationSignatures.has(signature)) {
            throw new Error(`[merge][no-target] Duplicate permutation detected tại vị trí ${idx + 1}.`)
          }
          permutationSignatures.add(signature)
          const preview = perm.slice(0, 5).map((c) => path.basename(c.path))
          console.log(`  Permutation ${idx + 1}/${generatedPermutations.length} first 5 clips: ${preview.join(', ')}`)
        })
        
        console.log('[merge][no-target] ✓ All permutations are unique')
      } else {
        // Không shuffle: tất cả permutations giống nhau (giữ nguyên thứ tự)
        permutations = Array(mergeCount).fill(null).map(() => [...baseClips])
      }
      
      if (!permutations) {
        throw new Error('[merge][no-target] Không tạo được permutations.')
      }
    }
    
    const outputPaths: string[] = []
    let totalElapsedMs = 0
    
      // Loop through merge count
    for (let mergeIndex = 0; mergeIndex < mergeCount; mergeIndex++) {
      // Check cancellation TRƯỚC khi bắt đầu merge tiếp theo
      if (videoJobManager.isCancelled(requestId)) {
        console.log(`[mergeVideosSimple] Job ${requestId} cancelled before merge ${mergeIndex + 1}/${mergeCount}`)
        throw new Error('Đã dừng bởi người dùng')
      }
      
      const currentMergeIndex = mergeIndex + 1
      const mergeStartTime = Date.now()
      
      // Generate output filename
      const outputFileName = mergeCount === 1 
        ? `${req.outputFileName}.mp4`
        : `${req.outputFileName}_${currentMergeIndex}.mp4`
      
      console.log(`[mergeVideosSimple] ===== Merge ${currentMergeIndex}/${mergeCount} =====`)
      console.log(`[merge] Starting job ${currentMergeIndex}/${mergeCount}: ${outputFileName}`)
      
      // Emit START progress cho job này
      if (onProgress) {
        const basePercent = mergeCount > 1 ? (mergeIndex / mergeCount) * 100 : 0
        onProgress(buildMergeProgress({
          mode: 'merge',
          requestId,
          stage: 'build-list',
          percent: basePercent,
          currentJob: mergeCount > 1 ? currentMergeIndex : undefined,
          totalJobs: mergeCount > 1 ? mergeCount : undefined,
          currentFile: mergeCount > 1 ? outputFileName : undefined,
          message: mergeCount > 1 ? `Đang ghép video ${currentMergeIndex}/${mergeCount}...` : undefined,
        }))
      }
      
      // UltraFast: Tách rõ nhánh "no target" - dùng TOÀN BỘ files, không dừng theo duration
      let filesForMerge: string[] = []
      
      if (!hasTarget) {
        // PHASE 2: NHÁNH KHÔNG CÓ TARGET - Mỗi output = 1 permutation đầy đủ
        // KHÔNG loop, KHÔNG nhân bản, KHÔNG padding theo duration
        
        const permutationsForUse = permutations as ClipItem[][]
        if (!permutationsForUse || !permutationsForUse[mergeIndex]) {
          throw new Error(`No permutation found for merge ${mergeIndex}`)
        }
        
        const playlist = permutationsForUse[mergeIndex]
        filesForMerge = playlist.map(c => c.path)
        const playlistPreview = playlist.slice(0, 5).map((c) => path.basename(c.path))
        console.log(`[merge][no-target] Job ${currentMergeIndex} first 5 clips: ${playlistPreview.join(', ')}`)
        
        // Debug: Log để verify shuffle
        if (req.shuffle) {
          const originalFirst5 = baseClips.slice(0, 5).map(c => path.basename(c.path))
          console.log(`[merge][no-target][shuffle] Original first 5: ${originalFirst5.join(', ')}`)
          console.log(`[merge][no-target][shuffle] Shuffled first 5: ${playlistPreview.join(', ')}`)
          
          // Verify: Kiểm tra xem có thực sự shuffle không
          const isSameOrder = playlist.every((clip, idx) => clip.path === baseClips[idx]?.path)
          if (isSameOrder) {
            console.warn(`[merge][no-target][shuffle] WARNING: Playlist order is identical to original! Shuffle may not be working.`)
          }
        }
        
        // Verify: playlist.length PHẢI === baseClips.length
        if (playlist.length !== baseClips.length) {
          const errorMsg = `Video ${currentMergeIndex}: ${playlist.length} clips (expected ${baseClips.length}) - Playlist length mismatch!`
          console.error(`[merge][no-target] ERROR: ${errorMsg}`)
          throw new Error(errorMsg)
        }
        
        // Verify: tất cả paths phải thuộc baseClips
        const validPaths = new Set(baseClips.map(c => c.path))
        const invalidPaths = filesForMerge.filter(p => !validPaths.has(p))
        if (invalidPaths.length > 0) {
          throw new Error(`Merge no-target: có ${invalidPaths.length} clip không hợp lệ trong filesForMerge`)
        }
        
        // Log theo spec
        console.log(`Video ${currentMergeIndex}: ${playlist.length} clips (expected ${baseClips.length})`)
      } else {
        // PHASE 3: NHÁNH CÓ TARGET - Dùng buildPlaylistToFillDuration
        // Mục tiêu: có thể phải lặp lại clip để đủ thời lượng
        // playlist.length CÓ THỂ > baseClips.length (do loop)
        
        // FIX: Đảm bảo shuffle được áp dụng đúng cách
        const shouldShuffle = req.shuffle === true
        console.log(`[merge][has-target] shuffle=${shouldShuffle}, targetDurationSec=${targetDurationSec!.toFixed(2)}s`)
        
        // FIX: Dùng mergeIndex + timestamp + crypto random để đảm bảo mỗi merge job có seed hoàn toàn khác nhau
        // Điều này đảm bảo kể cả khi phải loop clips nhiều lần, các video vẫn không trùng nhau
        // Dùng crypto random thay vì Math.random() để tránh trùng seed giữa các merge jobs
        const randomPart = randomBytes(4).readUInt32BE(0)
        const playlistSeed = Date.now() + mergeIndex * 1000000 + randomPart + mergeIndex * 12345

        // Khi có video ưu tiên:
        // - Chúng luôn xuất hiện một lần ở đầu mỗi video.
        // - Thứ tự trong nhóm ưu tiên sẽ được shuffle riêng cho từng video (nếu shouldShuffle = true).
        // - Phần thời lượng còn thiếu sẽ được loop TỪ NHÓM NON-PRIORITY (nếu có),
        //   chỉ khi không có non-priority mới loop toàn bộ baseClips như cũ.
        const priorityForThisMerge: ClipItem[] =
          priorityClips.length > 1 && shouldShuffle
            ? shuffleOnce(priorityClips)
            : [...priorityClips]

        const priorityDuration = priorityForThisMerge.reduce((sum, c) => sum + c.durationSec, 0)
        const remainingTarget = Math.max(0, targetDurationSec! - priorityDuration)

        let playlist: ClipItem[]
        if (remainingTarget <= 0) {
          // Chỉ cần priority clips là đủ thời lượng
          playlist = [...priorityForThisMerge]
        } else {
          const loopSource =
            nonPriorityClips.length > 0 ? nonPriorityClips : baseClips
          const loopPlaylist = buildPlaylistToFillDuration(
            loopSource,
            remainingTarget,
            shouldShuffle,
            playlistSeed
          )
          playlist = [...priorityForThisMerge, ...loopPlaylist]
        }

        filesForMerge = playlist.map((c) => c.path)
        
        // Debug: Log seed để verify
        if (shouldShuffle) {
          console.log(`[merge][has-target][shuffle] Merge ${currentMergeIndex} seed: ${playlistSeed}`)
        }
        
        // Debug: Log thứ tự files để verify shuffle
        if (shouldShuffle) {
          const first5 = filesForMerge.slice(0, 5).map(p => path.basename(p))
          const originalFirst5 = baseClips.slice(0, 5).map(c => path.basename(c.path))
          console.log(`[merge][has-target][shuffle] Original first 5: ${originalFirst5.join(', ')}`)
          console.log(`[merge][has-target][shuffle] Shuffled first 5: ${first5.join(', ')}`)
        }
        
        // Logging theo spec
        const usedClipSet = new Set(filesForMerge)
        const usedClipCount = usedClipSet.size
        const totalConcatItems = filesForMerge.length
        const finalDurationSec = playlist.reduce((sum, c) => sum + c.durationSec, 0)
        
        console.log(`Playlist: ${totalConcatItems} clips (từ ${baseClips.length} clips gốc)`)
        console.log(`[merge][has-target] Merge ${currentMergeIndex}: target=${targetDurationSec!.toFixed(2)}s, playlist=${totalConcatItems} items, final=${finalDurationSec.toFixed(2)}s, unique=${usedClipCount}`)
        
        // Verify: tất cả paths phải thuộc baseClips (KHÔNG verify length)
        const validPaths = new Set(baseClips.map(c => c.path))
        const invalidPaths = filesForMerge.filter(p => !validPaths.has(p))
        if (invalidPaths.length > 0) {
          throw new Error(`Merge has-target: có ${invalidPaths.length} clip không hợp lệ trong filesForMerge`)
        }
      }
      
      // UltraFast: Log debug
      const distinctCount = new Set(filesForMerge).size
      const totalInputDurationSec = filesWithDuration.reduce((sum, f) => sum + f.duration, 0)
      console.log(`[mergeVideosSimple] Original files: ${filesWithDuration.length}`)
      console.log(`[mergeVideosSimple] Files after processing: ${filesForMerge.length}`)
      console.log(`[mergeVideosSimple] Distinct files in merge: ${distinctCount}`)
      console.log(`[mergeVideosSimple] Total input duration: ${totalInputDurationSec.toFixed(2)}s`)
      if (hasTarget && targetDurationSec) {
        console.log(`[mergeVideosSimple] Target duration: ${targetDurationSec.toFixed(2)}s`)
      } else {
        console.log(`[mergeVideosSimple] No target duration - using ALL ${filesForMerge.length} files`)
      }
      console.log(`[mergeVideosSimple] First 10 files: ${filesForMerge.slice(0, 10).map(f => path.basename(f)).join(', ')}`)
      
      // C4: Debug logging
      debugLog(`Merge ${currentMergeIndex} concat list`, {
        totalFiles: filesForMerge.length,
        distinctCount,
        first10: filesForMerge.slice(0, 10).map(f => path.basename(f)),
        hasTarget,
      })
      
      if (filesForMerge.length === 0) {
        throw new Error('No files to merge')
      }

      const estimatedBytes = estimateConcatBytes(filesForMerge, sizeLookup)
      await ensureMergeDiskCapacity(
        req.outputDir,
        estimatedBytes,
        currentMergeIndex,
        mergeCount
      )
      
      // D3: Progress nhẹ - stage: merge (START)
      if (onProgress) {
        const basePercent = mergeCount > 1 ? (mergeIndex / mergeCount) * 100 : 0
        onProgress(buildMergeProgress({
          mode: 'merge',
          requestId,
          stage: 'merge',
          percent: basePercent,
          currentJob: mergeCount > 1 ? currentMergeIndex : undefined,
          totalJobs: mergeCount > 1 ? mergeCount : undefined,
          currentFile: mergeCount > 1 ? outputFileName : undefined,
          message: mergeCount > 1 ? `Đang ghép video ${currentMergeIndex}/${mergeCount}...` : undefined,
        }))
      }
      
      // D3: Build concat list file — dùng os.tmpdir() + requestId để tránh race condition khi concurrent jobs
      const concatListPath = path.join(os.tmpdir(), `concat_${requestId}_${currentMergeIndex}.txt`)
      const concatContent = buildConcatListContent(filesForMerge)
      await fsp.writeFile(concatListPath, concatContent, { encoding: 'utf8' })
      
      // Verify: log số dòng concat list để debug
      const concatLines = concatContent.split('\n').filter(line => line.trim().length > 0)
      console.log(`[mergeVideosSimple] Concat list: ${concatLines.length} files (filesForMerge: ${filesForMerge.length})`)
      if (concatLines.length !== filesForMerge.length) {
        console.error(`[mergeVideosSimple] ERROR: Concat list line count mismatch! Expected: ${filesForMerge.length}, Got: ${concatLines.length}`)
      }
      
      // Output path: unifyFormat không đổi extension (vẫn .mp4), chỉ đổi resolution/fps
      const finalOutputPath = path.join(req.outputDir, generateOutputFileName(req.outputFileName, currentMergeIndex, mergeCount))
      const runSafeMerge = async (message: string, safeTarget: number | null) => {
        await fallbackTranscodeAndConcat(filesForMerge, finalOutputPath, req.mute || false, safeTarget ?? null, (progress) => {
          if (onProgress) {
            const overallPercent = mergeCount > 1
              ? (mergeIndex / mergeCount) * 100 + (progress.percent / mergeCount)
              : progress.percent
            onProgress(buildMergeProgress({
              mode: 'merge',
              requestId,
              stage: 'merge',
              percent: Math.min(99, overallPercent),
              speedX: progress.speedX ?? null,
              etaSec: progress.etaSec ?? null,
              currentJob: mergeCount > 1 ? currentMergeIndex : undefined,
              totalJobs: mergeCount > 1 ? mergeCount : undefined,
              currentFile: mergeCount > 1 ? outputFileName : undefined,
              message,
            }))
          }
        }, requestId, req.useGpuEncoding, normalizeVfFilter)
      }
      
      // UltraFast: Tách rõ nhánh "no target" vs "has target"
      if (hasTarget && targetDurationSec) {
        // NHÁNH CÓ TARGET: Giữ nguyên logic hiện tại (KHÔNG ĐỤNG)
        // D3: 1 pass concat + cut
        
        // Emit progress START ngay trước khi gọi FFmpeg
        if (onProgress) {
          const basePercent = mergeCount > 1 ? (mergeIndex / mergeCount) * 100 : 0
          onProgress(buildMergeProgress({
            mode: 'merge',
            requestId,
            stage: 'merge',
            percent: basePercent,
            timeSec: 0,
            totalDurationSec: targetDurationSec,
            speedX: null,
            etaSec: null,
            currentJob: mergeCount > 1 ? currentMergeIndex : undefined,
            totalJobs: mergeCount > 1 ? mergeCount : undefined,
            currentFile: mergeCount > 1 ? outputFileName : undefined,
            message: mergeCount > 1 ? `Đang ghép video ${currentMergeIndex}/${mergeCount}...` : undefined,
          }))
        }
        
        console.log(`[merge][has-target] Starting job ${currentMergeIndex}/${mergeCount}: ${outputFileName}`)
        console.log(`[merge][has-target] Target duration: ${targetDurationSec.toFixed(2)}s`)
        
        if (preferStableMergePath) {
          await runSafeMerge('Đang ghép ổn định để tránh xước hình / dừng hình...', targetDurationSec)
        } else {
          try {
            await runConcatWithCut(
              concatListPath,
              finalOutputPath,
              targetDurationSec,
              req.mute || false,
              (progress) => {
                if (onProgress) {
                  // Calculate overall percent: (jobIndex / totalJobs) * 100 + (currentJobPercent / totalJobs)
                  let overallPercent = 0
                  if (mergeCount > 1) {
                    const jobBasePercent = (mergeIndex / mergeCount) * 100
                    const jobProgressPercent = (progress.percent || 0) / mergeCount
                    overallPercent = jobBasePercent + jobProgressPercent
                  } else {
                    overallPercent = progress.percent || 0
                  }
                  
                  onProgress(buildMergeProgress({
                    mode: 'merge',
                    requestId,
                    stage: 'merge',
                    percent: Math.min(100, overallPercent),
                    timeSec: progress.timeSec,
                    totalDurationSec: targetDurationSec,
                    speedX: progress.speedX,
                    etaSec: progress.etaSec,
                    currentJob: mergeCount > 1 ? currentMergeIndex : undefined,
                    totalJobs: mergeCount > 1 ? mergeCount : undefined,
                    currentFile: mergeCount > 1 ? outputFileName : undefined,
                    message: mergeCount > 1 ? `Đang ghép video ${currentMergeIndex}/${mergeCount}...` : undefined,
                  }))
                }
              },
              undefined, // retryCount
              requestId
            )
          } catch (err: any) {
            // Nếu user không chọn chuẩn hóa, không tự động fallback sang re-encode
            // Chỉ throw error để user biết và có thể chọn bật chuẩn hóa nếu cần
            const errorMsg = err?.message || String(err)
            console.error('[mergeVideosSimple] concat+cut failed:', errorMsg)
            throw new Error(`Ghép video thất bại: ${errorMsg}. Nếu gặp lỗi codec/FPS không tương thích, hãy bật "Chuẩn hóa video khi ghép".`)
          }
        }
        
        // Emit progress END sau khi hoàn thành job
        if (onProgress) {
          const endPercent = mergeCount > 1 ? ((mergeIndex + 1) / mergeCount) * 100 : 100
          onProgress(buildMergeProgress({
            mode: 'merge',
            requestId,
            stage: 'merge',
            percent: Math.min(100, endPercent),
            timeSec: targetDurationSec,
            totalDurationSec: targetDurationSec,
            speedX: null,
            etaSec: null,
            currentJob: mergeCount > 1 ? currentMergeIndex : undefined,
            totalJobs: mergeCount > 1 ? mergeCount : undefined,
            currentFile: mergeCount > 1 ? outputFileName : undefined,
            message: mergeCount > 1 ? `Hoàn thành video ${currentMergeIndex}/${mergeCount}` : undefined,
          }))
        }
        
        console.log(`[merge][has-target] Completed job ${currentMergeIndex}/${mergeCount}: ${outputFileName}`)
      } else {
      // D3: Không có target - chỉ concat (không cut)
      // Tính totalDurationSec từ filesForMerge để parse progress chính xác
      const totalDurationForMerge = filesForMerge.reduce((sum, filePath) => {
        const info = filesWithDuration.find(f => f.path === filePath)
        return sum + (info?.duration || 0)
      }, 0)
      
      // Emit progress START ngay trước khi gọi FFmpeg
      if (onProgress) {
        const basePercent = mergeCount > 1 ? (mergeIndex / mergeCount) * 100 : 0
        onProgress(buildMergeProgress({
          mode: 'merge',
          requestId,
          stage: 'merge',
          percent: basePercent,
          timeSec: 0,
          totalDurationSec: totalDurationForMerge,
          speedX: null,
          etaSec: null,
          currentJob: mergeCount > 1 ? currentMergeIndex : undefined,
          totalJobs: mergeCount > 1 ? mergeCount : undefined,
          currentFile: mergeCount > 1 ? outputFileName : undefined,
          message: mergeCount > 1 ? `Đang ghép video ${currentMergeIndex}/${mergeCount}...` : undefined,
        }))
      }
      
      console.log(`[merge][no-target] Starting job ${currentMergeIndex}/${mergeCount}: ${outputFileName}`)
      
      if (preferStableMergePath) {
        await runSafeMerge('Đang ghép ổn định để tránh xước hình / dừng hình...', null)
      } else {
        try {
          await runConcat(
            concatListPath,
            finalOutputPath,
            req.mute || false,
            (progress) => {
              if (onProgress) {
                // Calculate overall percent: (jobIndex / totalJobs) * 100 + (currentJobPercent / totalJobs)
                let overallPercent = 0
                if (mergeCount > 1) {
                  const jobBasePercent = (mergeIndex / mergeCount) * 100
                  const jobProgressPercent = (progress.percent || 0) / mergeCount
                  overallPercent = jobBasePercent + jobProgressPercent
                } else {
                  overallPercent = progress.percent || 0
                }
                
                onProgress(buildMergeProgress({
                  mode: 'merge',
                  requestId,
                  stage: 'merge',
                  percent: Math.min(100, overallPercent),
                  timeSec: progress.timeSec,
                  totalDurationSec: progress.totalDurationSec || totalDurationForMerge,
                  speedX: progress.speedX,
                  etaSec: progress.etaSec,
                  currentJob: mergeCount > 1 ? currentMergeIndex : undefined,
                  totalJobs: mergeCount > 1 ? mergeCount : undefined,
                  currentFile: mergeCount > 1 ? outputFileName : undefined,
                  message: mergeCount > 1 ? `Đang ghép video ${currentMergeIndex}/${mergeCount}...` : undefined,
                }))
              }
            },
            totalDurationForMerge,
            undefined, // retryCount
            requestId
          )
        } catch (err: any) {
          // Nếu user không chọn chuẩn hóa, không tự động fallback sang re-encode
          // Chỉ throw error để user biết và có thể chọn bật chuẩn hóa nếu cần
          const errorMsg = err?.message || String(err)
          console.error('[mergeVideosSimple] concat copy failed:', errorMsg)
          throw new Error(`Ghép video thất bại: ${errorMsg}. Nếu gặp lỗi codec/FPS không tương thích, hãy bật "Chuẩn hóa video khi ghép".`)
        }
      }
      
      // Emit progress END sau khi hoàn thành job
      if (onProgress) {
        const endPercent = mergeCount > 1 ? ((mergeIndex + 1) / mergeCount) * 100 : 100
        onProgress(buildMergeProgress({
          mode: 'merge',
          requestId,
          stage: 'merge',
          percent: Math.min(100, endPercent),
          timeSec: totalDurationForMerge,
          totalDurationSec: totalDurationForMerge,
          speedX: null,
          etaSec: null,
          currentJob: mergeCount > 1 ? currentMergeIndex : undefined,
          totalJobs: mergeCount > 1 ? mergeCount : undefined,
          currentFile: mergeCount > 1 ? outputFileName : undefined,
          message: mergeCount > 1 ? `Hoàn thành video ${currentMergeIndex}/${mergeCount}` : undefined,
        }))
      }
      
      console.log(`[merge][no-target] Completed job ${currentMergeIndex}/${mergeCount}: ${outputFileName}`)
      }
      
      // D3: Cleanup concat list
      try {
        fs.unlinkSync(concatListPath)
      } catch {}
      
      // Check cancellation SAU khi merge xong, TRƯỚC khi verify
      if (videoJobManager.isCancelled(requestId)) {
        console.log(`[mergeVideosSimple] Job ${requestId} cancelled after merge ${currentMergeIndex}/${mergeCount}`)
        throw new Error('Đã dừng bởi người dùng')
      }
      
      // B6: Final verification (size + duration + playback test)
      if (fs.existsSync(finalOutputPath)) {
        const stats = fs.statSync(finalOutputPath)
        if (stats.size === 0) {
          throw new Error(`Output file is empty: ${finalOutputPath}`)
        }
        
        // D3: Optional verify duration (chỉ log, không fail trừ khi quá ngắn)
        if (targetDurationSec && targetDurationSec > 0) {
          try {
            const finalInfo = await getVideoFileInfo(finalOutputPath)
            const finalDurationSec = finalInfo.durationSec || 0
            
            // D3: Chỉ fail nếu duration < target - 10s (thiếu hẳn vài đoạn)
            if (finalDurationSec < targetDurationSec - 10) {
              throw new Error(
                `Output duration (${finalDurationSec.toFixed(2)}s) is too short compared to target (${targetDurationSec.toFixed(2)}s)`
              )
            }
            
            // D3: Log nếu lệch nhưng không fail
            const diff = Math.abs(finalDurationSec - targetDurationSec)
            if (diff > 5) {
              console.log(`[mergeVideosSimple] Duration diff: ${diff.toFixed(2)}s (target: ${targetDurationSec.toFixed(2)}s, actual: ${finalDurationSec.toFixed(2)}s)`)
            }
          } catch (error: any) {
            // D3: Nếu probe fail, chỉ log warning (không fail job)
            if (error?.message?.includes('too short')) {
              throw error // Re-throw nếu quá ngắn
            }
            console.warn(`[mergeVideosSimple] Failed to verify duration (non-critical):`, error)
          }
        }

        // Phase 2: Deep verification với ffprobe + decode
        const shouldRunDeepVerify = shouldRunDeepVerifyForMerge(forceSafeMode, filesForMerge)
        if (shouldRunDeepVerify) {
          // Check cancellation trước khi verify (verify có thể mất thời gian)
          if (videoJobManager.isCancelled(requestId)) {
            console.log(`[mergeVideosSimple] Job ${requestId} cancelled before verification`)
            throw new Error('Đã dừng bởi người dùng')
          }
          
          try {
            if (onProgress) {
              onProgress(
                buildMergeProgress({
                  mode: 'merge',
                  requestId,
                  stage: 'finalizing',
                  percent: Math.min(99, mergeCount > 1 ? ((mergeIndex + 1) / mergeCount) * 100 : 100),
                  currentJob: mergeCount > 1 ? currentMergeIndex : undefined,
                  totalJobs: mergeCount > 1 ? mergeCount : undefined,
                  currentFile: path.basename(finalOutputPath),
                  message: `Đang kiểm tra file xuất ra (ffprobe + decode)...`,
                })
              )
            }

            const verify = await verifyOutputVideo(finalOutputPath, {
              expectedDurationSec: targetDurationSec ?? null,
              toleranceSec: 5,
              onLog: (msg) => console.log(msg),
            })

            if (verify.durationWarning) {
              console.warn(
                `[mergeVideosSimple][verify] Duration diff > 5s (expected=${targetDurationSec ?? 'n/a'}s, actual=${verify.durationSec.toFixed(
                  2
                )}s)`
              )
            }
            if (!verify.decodeOk) {
              console.warn(
                `[mergeVideosSimple][verify] Decode test báo lỗi, file có thể bị lỗi trong một số player.`
              )
            }
          } catch (verifyErr: any) {
            console.warn(
              '[mergeVideosSimple][verify] Không thể chạy bước kiểm tra sâu (không chặn job):',
              verifyErr
            )
          }
        } else {
          console.log('[mergeVideosSimple][verify] Skip deep verification (single-input copy mode).')
        }

        outputPaths.push(finalOutputPath)
        const mergeElapsedMs = Date.now() - mergeStartTime
        totalElapsedMs += mergeElapsedMs
        
        // D3: Chỉ log summary (không log duration nếu không probe)
        console.log(`[mergeVideosSimple] ✓ Merge ${currentMergeIndex}/${mergeCount} completed: ${path.basename(finalOutputPath)}`)
        
        // B5: Progress nhẹ - stage: finalizing
        if (onProgress) {
          const overallPercent = mergeCount > 1 ? ((mergeIndex + 1) / mergeCount) * 100 : 100
          onProgress(buildMergeProgress({
            mode: 'merge',
            requestId,
            stage: 'finalizing',
            percent: overallPercent,
          }))
        }
      }
    }
    
    const elapsedMs = Date.now() - startTime
    const avgSpeed = req.targetDurationSec && req.targetDurationSec > 0 && elapsedMs > 0
      ? (req.targetDurationSec * mergeCount) / (elapsedMs / 1000)
      : 0
    
    // Emit completed event
    if (onProgress) {
      onProgress(buildMergeProgress({
        mode: 'merge',
        requestId,
        stage: 'finalizing',
        percent: 100,
        completed: true,
      }))
    }
    
    return {
      requestId,
      outputPaths,
      outputPath: outputPaths[0],
      totalDurationSec: req.targetDurationSec || 0,
      success: true,
      avgSpeed,
      elapsedMs,
    }
  } catch (error: any) {
    console.error('[mergeVideosSimple] Error:', error)
    
    // Emit error event
    if (onProgress) {
      onProgress(buildMergeProgress({
        mode: 'merge',
        requestId,
        stage: 'finalizing',
        percent: 0,
        completed: true,
        error: error?.message || String(error),
      }))
    }
    
    return {
      requestId,
      outputPaths: [],
      totalDurationSec: 0,
      success: false,
      error: error?.message || String(error),
    }
  }
}

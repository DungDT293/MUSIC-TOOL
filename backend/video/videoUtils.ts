/**
 * Video Utils - Helper functions for video validation and processing
 */

import { getVideoFileInfo, type VideoFileInfo } from './videoInfo'

export interface ValidatedInputFile {
  path: string
  durationSec: number
  width?: number
  height?: number
  codecName?: string
  fps?: number
  sizeBytes?: number
}

export interface InvalidInputFile {
  path: string
  reason: string
}

/**
 * Validate input files by probing them with ffprobe
 * Returns valid files and list of invalid file paths
 */
export async function validateInputFiles(
  paths: string[],
  concurrency: number = 10
): Promise<{ valid: ValidatedInputFile[]; invalid: string[]; invalidDetails: InvalidInputFile[] }> {
  const valid: ValidatedInputFile[] = []
  const invalid: string[] = []
  const invalidDetails: InvalidInputFile[] = []

  const addInvalid = (filePath: string, reason: string) => {
    invalid.push(filePath)
    invalidDetails.push({ path: filePath, reason })
  }

  // FIX PERF-5: Sliding window concurrency — slot trống được lấp ngay lập tức
  // thay vì đợi cả batch hoàn tất rồi mới bắt đầu batch mới
  const processOne = async (filePath: string) => {
    let retryCount = 0
    const maxRetries = 1

    while (retryCount <= maxRetries) {
      try {
        const info = await getVideoFileInfo(filePath)
        const hasUsableDuration = !!(info.durationSec && info.durationSec > 0)
        const hasUsableVideoStream = !!(info.width && info.height && info.codecName)

        if (hasUsableDuration && hasUsableVideoStream) {
          valid.push({
            path: filePath,
            durationSec: info.durationSec,
            width: info.width ?? undefined,
            height: info.height ?? undefined,
            codecName: info.codecName ?? undefined,
            fps: typeof info.fps === 'number' ? info.fps : undefined,
            sizeBytes: typeof info.sizeBytes === 'number' ? info.sizeBytes : undefined,
          })
          return
        } else {
          const reason = !hasUsableDuration
            ? 'Video không có duration hợp lệ.'
            : 'Video không có stream hình ảnh hợp lệ (thiếu width/height/codec).'
          addInvalid(filePath, reason)
          console.warn(
            `[validateInputFiles] Invalid file: ${filePath} — ${reason}`
          )
          return
        }
      } catch (error) {
        retryCount++
        if (retryCount > maxRetries) {
          const reason = `Không probe được video sau ${maxRetries + 1} lần: ${error instanceof Error ? error.message : String(error)}`
          addInvalid(filePath, reason)
          console.warn(`[validateInputFiles] Failed to probe ${filePath} after ${maxRetries + 1} attempt(s):`, error)
          return
        }
        console.log(`[validateInputFiles] Retry ${retryCount}/${maxRetries} for ${filePath}`)
      }
    }
  }

  // Sliding window: luôn duy trì tối đa `concurrency` tasks chạy song song
  const queue = [...paths]
  const running = new Set<Promise<void>>()

  while (queue.length > 0 || running.size > 0) {
    // Lấp đầy slots trống
    while (running.size < concurrency && queue.length > 0) {
      const filePath = queue.shift()!
      const p = processOne(filePath).finally(() => running.delete(p))
      running.add(p)
    }
    // Đợi BẤT KỲ task nào hoàn tất → lập tức quay lại fill slot
    if (running.size > 0) {
      await Promise.race(running)
    }
  }

  // Log summary
  console.log(`[validateInputFiles] Summary: total=${paths.length}, valid=${valid.length}, invalid=${invalid.length}`)
  
  if (invalidDetails.length > 0) {
    const maxLog = 10
    const detailsToLog = invalidDetails.slice(0, maxLog)
    console.log(`[validateInputFiles] Invalid files (showing max ${maxLog}):`)
    detailsToLog.forEach((item, idx) => {
      console.log(`  ${idx + 1}. ${item.path} — ${item.reason}`)
    })
    if (invalidDetails.length > maxLog) {
      console.log(`  ... and ${invalidDetails.length - maxLog} more`)
    }
  }

  return { valid, invalid, invalidDetails }
}


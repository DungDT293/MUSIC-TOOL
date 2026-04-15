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

/**
 * Validate input files by probing them with ffprobe
 * Returns valid files and list of invalid file paths
 */
export async function validateInputFiles(
  paths: string[],
  concurrency: number = 10
): Promise<{ valid: ValidatedInputFile[]; invalid: string[] }> {
  const valid: ValidatedInputFile[] = []
  const invalid: string[] = []

  // CRITICAL FIX: Process TẤT CẢ files với concurrency control
  // Dùng approach đơn giản: process từng batch, đợi batch hoàn thành, rồi process batch tiếp theo
  let currentIndex = 0

  while (currentIndex < paths.length) {
    // Tạo batch tiếp theo (tối đa concurrency files)
    const batch: Promise<void>[] = []
    const batchSize = Math.min(concurrency, paths.length - currentIndex)
    
    for (let i = 0; i < batchSize; i++) {
      const index = currentIndex + i
      const filePath = paths[index]
      
      const promise = (async () => {
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
              return // Success, exit retry loop
            } else {
              invalid.push(filePath)
              console.warn(
                `[validateInputFiles] Invalid file (missing usable duration/video stream): ${filePath}`
              )
              return // Invalid video metadata, no need to retry
            }
          } catch (error) {
            retryCount++
            if (retryCount > maxRetries) {
              // Final attempt failed, skip file
              invalid.push(filePath)
              console.warn(`[validateInputFiles] Failed to probe ${filePath} after ${maxRetries + 1} attempt(s):`, error)
              return
            }
            // Retry once
            console.log(`[validateInputFiles] Retry ${retryCount}/${maxRetries} for ${filePath}`)
          }
        }
      })()
      
      batch.push(promise)
    }
    
    // Đợi batch này hoàn thành — dùng allSettled để 1 file lỗi không cancel cả batch
    await Promise.allSettled(batch)
    
    // Move to next batch
    currentIndex += batchSize
  }

  // Log summary
  console.log(`[validateInputFiles] Summary: total=${paths.length}, valid=${valid.length}, invalid=${invalid.length}`)
  
  if (invalid.length > 0) {
    const maxLog = 10
    const invalidToLog = invalid.slice(0, maxLog)
    console.log(`[validateInputFiles] Invalid files (showing max ${maxLog}):`)
    invalidToLog.forEach((path, idx) => {
      console.log(`  ${idx + 1}. ${path}`)
    })
    if (invalid.length > maxLog) {
      console.log(`  ... and ${invalid.length - maxLog} more`)
    }
  }

  return { valid, invalid }
}


/**
 * VIDEO TURBO ENGINE - Split Many Videos với Parallel Processing
 * Cắt nhiều video cùng lúc với concurrency tự động
 */

import path from 'node:path'
import { randomUUID } from 'crypto'
import { detectDiskType, getDiskInfo, type DiskType } from './detectDiskType'
import { chooseBestConcurrencyBasedOnDisk } from './videoFFmpegRunner'
import { cutVideoIntoSegmentsTurbo, type CutSingleTurboRequest, sanitizeFileName } from './cutSingleTurbo'
import { videoJobManager } from './videoJobManager'

export interface SplitManyTurboRequest {
  inputPaths: string[]
  outputBaseDir: string
  segmentLengthSec: number
  format?: 'mp4' | 'mkv'
  maxConcurrency?: number // Override auto-detect
}

export interface SplitManyTurboResult {
  requestId: string
  totalVideos: number
  successCount: number
  failCount: number
  results: Array<{
    inputPath: string
    outputDir: string
    outputFiles: string[]
    success: boolean
    error?: string
    accelerationMode: 'NONE' | 'SSD' | 'TEMP_SSD' | 'RAM'
    diskType: DiskType
  }>
  overallAccelerationMode: 'NONE' | 'SSD' | 'TEMP_SSD' | 'RAM'
  overallDiskType: DiskType
}

/**
 * Cắt nhiều video với Turbo Engine
 */
export async function splitMultipleVideosTurbo(
  req: SplitManyTurboRequest,
  progressEmitter?: (progress: {
    requestId: string
    jobIndex: number
    totalJobs: number
    currentVideo: string
    timeSec: number
    totalDurationSec: number
    percent: number
    accelerationMode: 'NONE' | 'SSD' | 'TEMP_SSD' | 'RAM'
    diskType: DiskType
    speedX?: number
    eta?: number
  }) => void
): Promise<SplitManyTurboResult> {
  const requestId = randomUUID()

  if (req.inputPaths.length === 0) {
    throw new Error('Không có video nào để cắt')
  }

  // Detect disk type của output base dir
  const outputDiskInfo = await getDiskInfo(req.outputBaseDir)
  const outputDiskType = outputDiskInfo.type

  // Auto-detect concurrency
  let maxConcurrency = req.maxConcurrency
  if (!maxConcurrency) {
    maxConcurrency = await chooseBestConcurrencyBasedOnDisk(outputDiskType, false)
  }

  console.log(`[splitManyTurbo] Starting ${req.inputPaths.length} videos with concurrency ${maxConcurrency}`)

  const results: SplitManyTurboResult['results'] = []
  let successCount = 0
  let failCount = 0

  // Concurrency limiter
  const activeTasks = new Set<Promise<void>>()
  const queue = [...req.inputPaths]
  let completedJobs = 0

  const processNext = async (): Promise<void> => {
    // Check stop requested
    if (videoJobManager.isStopRequested(requestId)) {
      return
    }

    if (queue.length === 0) {
      return
    }

    const inputPath = queue.shift()!
    const jobIndex = req.inputPaths.length - queue.length
    const videoName = path.basename(inputPath, path.extname(inputPath))
    const safeBase = sanitizeFileName(videoName)
    const subFolder = path.join(req.outputBaseDir, safeBase)

    const taskPromise = (async () => {
      try {
        // Gọi cutSingleTurbo cho từng video
        const cutResult = await cutVideoIntoSegmentsTurbo(
          {
            inputPath,
            outputDir: subFolder,
            segmentLengthSec: req.segmentLengthSec,
            format: req.format,
            keepCodec: true,
          },
          (progress) => {
            // Emit progress với jobIndex
            if (progressEmitter) {
              const overallPercent = ((jobIndex - 1) + progress.percent / 100) / req.inputPaths.length * 100
              progressEmitter({
                requestId,
                jobIndex,
                totalJobs: req.inputPaths.length,
                currentVideo: videoName,
                timeSec: progress.timeSec,
                totalDurationSec: progress.totalDurationSec,
                percent: overallPercent,
                accelerationMode: progress.accelerationMode,
                diskType: progress.diskType,
                speedX: progress.speedX,
                eta: progress.eta,
              })
            }
          }
        )

        if (cutResult.success) {
          results.push({
            inputPath,
            outputDir: subFolder,
            outputFiles: cutResult.outputFiles,
            success: true,
            accelerationMode: cutResult.accelerationMode,
            diskType: cutResult.diskType,
          })
          successCount++
        } else {
          results.push({
            inputPath,
            outputDir: subFolder,
            outputFiles: [],
            success: false,
            error: cutResult.error,
            accelerationMode: cutResult.accelerationMode,
            diskType: cutResult.diskType,
          })
          failCount++
        }
      } catch (error: any) {
        console.error(`[splitManyTurbo] Error processing ${inputPath}:`, error)
        results.push({
          inputPath,
          outputDir: subFolder,
          outputFiles: [],
          success: false,
          error: error?.message || String(error),
          accelerationMode: 'NONE',
          diskType: 'UNKNOWN',
        })
        failCount++
      } finally {
        completedJobs++
        activeTasks.delete(taskPromise)

        // Process next nếu còn
        if (queue.length > 0 && activeTasks.size < maxConcurrency && !videoJobManager.isStopRequested(requestId)) {
          processNext()
        }
      }
    })()

    activeTasks.add(taskPromise)

    // Start next task nếu còn slot
    if (activeTasks.size < maxConcurrency && queue.length > 0) {
      processNext()
    }
  }

  // Start initial batch
  const initialBatch = Math.min(maxConcurrency, req.inputPaths.length)
  for (let i = 0; i < initialBatch; i++) {
    processNext()
  }

  // Wait for all tasks
  while (activeTasks.size > 0 || queue.length > 0) {
    if (videoJobManager.isStopRequested(requestId)) {
      // Cancel remaining
      queue.length = 0
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  // Tính overall acceleration mode (mode xuất hiện nhiều nhất)
  const accelerationModes = results
    .filter(r => r.success)
    .map(r => r.accelerationMode)
  const modeCounts = accelerationModes.reduce((acc, mode) => {
    acc[mode] = (acc[mode] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  const overallAccelerationMode = Object.entries(modeCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] as 'NONE' | 'SSD' | 'TEMP_SSD' | 'RAM' || 'NONE'

  return {
    requestId,
    totalVideos: req.inputPaths.length,
    successCount,
    failCount,
    results,
    overallAccelerationMode,
    overallDiskType: outputDiskType,
  }
}


/**
 * VIDEO TURBO ENGINE - Ultra Merge Engine
 * Ghép video với tốc độ tối đa (concat demuxer + copy-stream)
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'crypto'
import { getVideoFileInfo } from './videoInfo'
import { detectDiskType, getDiskInfo, type DiskType } from './detectDiskType'
import { setupTurboIO, finalizeTurboIO, type TurboIOResult } from './turboIO'
import { runTurboFFmpeg } from './videoFFmpegRunner'
import { videoJobManager } from './videoJobManager'
import { shouldUseRAM, readFileIntoRAM, releaseRAMBuffer, type RAMBuffer } from './ramAcceleration'
import { spawn, type ChildProcess } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'

export interface MergeVideosTurboRequest {
  inputFiles: string[]
  outputDir: string
  outputFileName: string
  shuffle?: boolean
  mute?: boolean
  targetDurationSec?: number | null
  groupId?: string // Group ID để cancel-group
}

export interface MergeVideosTurboResult {
  requestId: string
  outputPath: string
  totalDurationSec: number
  success: boolean
  error?: string
  accelerationMode: 'NONE' | 'SSD' | 'TEMP_SSD' | 'RAM'
  diskType: DiskType
}

/**
 * Shuffle array (Fisher-Yates)
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

/**
 * Build clip plan với maxDuration logic
 * - Trim nếu quá dài
 * - Loop nếu quá ngắn
 */
interface ClipPlanItem {
  filePath: string
  startSec?: number
  durationSec?: number
}

async function buildClipPlan(
  inputFiles: string[],
  targetDurationSec: number | null
): Promise<ClipPlanItem[]> {
  if (!targetDurationSec || targetDurationSec <= 0) {
    // Không có giới hạn → dùng tất cả files
    return inputFiles.map(f => ({ filePath: f }))
  }

  const plan: ClipPlanItem[] = []
  let currentDuration = 0

  for (const filePath of inputFiles) {
    try {
      const info = await getVideoFileInfo(filePath)
      const clipDuration = info.durationSec || 0

      if (currentDuration >= targetDurationSec) {
        // Đã đủ duration → dừng
        break
      }

      const remaining = targetDurationSec - currentDuration

      if (clipDuration <= remaining) {
        // Clip ngắn hơn remaining → dùng toàn bộ
        plan.push({ filePath })
        currentDuration += clipDuration
      } else {
        // Clip dài hơn remaining → trim
        plan.push({
          filePath,
          startSec: 0,
          durationSec: remaining,
        })
        currentDuration += remaining
        break
      }
    } catch (error) {
      console.warn(`[buildClipPlan] Failed to probe ${filePath}:`, error)
      // Bỏ qua file lỗi
    }
  }

  // Nếu chưa đủ duration → loop lại từ đầu
  if (currentDuration < targetDurationSec && plan.length > 0) {
    const loopPlan: ClipPlanItem[] = []
    let loopDuration = 0

    while (loopDuration < targetDurationSec - currentDuration) {
      for (const item of plan) {
        if (loopDuration >= targetDurationSec - currentDuration) {
          break
        }

        try {
          const info = await getVideoFileInfo(item.filePath)
          const clipDuration = item.durationSec || info.durationSec || 0
          const remaining = targetDurationSec - currentDuration - loopDuration

          if (clipDuration <= remaining) {
            loopPlan.push({ filePath: item.filePath })
            loopDuration += clipDuration
          } else {
            loopPlan.push({
              filePath: item.filePath,
              startSec: 0,
              durationSec: remaining,
            })
            loopDuration += remaining
            break
          }
        } catch (error) {
          // Bỏ qua
        }
      }
    }

    plan.push(...loopPlan)
  }

  return plan
}

/**
 * Build concat list content từ clip plan
 */
function buildConcatListContent(plan: ClipPlanItem[]): string {
  return plan
    .map((item) => {
      const norm = item.filePath.replace(/'/g, "'\\''")
      if (item.startSec !== undefined || item.durationSec !== undefined) {
        // Dùng concat filter format (không hỗ trợ trim trong demuxer)
        // Sẽ fallback sang filter nếu có trim
        return `file '${norm}'`
      }
      return `file '${norm}'`
    })
    .join('\n')
}

/**
 * Build concat filter command (fallback khi demuxer fail hoặc có trim)
 * Lưu ý: Filter mode phải re-encode, không thể dùng copy
 */
function buildConcatFilterCommand(plan: ClipPlanItem[]): string[] {
  const inputs: string[] = []
  const filters: string[] = []
  let filterIndex = 0

  for (const item of plan) {
    inputs.push('-i', item.filePath)
    
    if (item.startSec !== undefined || item.durationSec !== undefined) {
      // Trim clip (phải decode → encode)
      const start = item.startSec || 0
      const duration = item.durationSec
      if (duration) {
        filters.push(`[${filterIndex}:v]trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS[v${filterIndex}]`)
        filters.push(`[${filterIndex}:a]atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS[a${filterIndex}]`)
      } else {
        filters.push(`[${filterIndex}:v]trim=start=${start},setpts=PTS-STARTPTS[v${filterIndex}]`)
        filters.push(`[${filterIndex}:a]atrim=start=${start},asetpts=PTS-STARTPTS[a${filterIndex}]`)
      }
    } else {
      // Dùng toàn bộ clip (vẫn phải qua filter để concat)
      filters.push(`[${filterIndex}:v]copy[v${filterIndex}]`)
      filters.push(`[${filterIndex}:a]copy[a${filterIndex}]`)
    }
    filterIndex++
  }

  // Concat tất cả
  const concatInputs = Array.from({ length: filterIndex }, (_, i) => `[v${i}][a${i}]`).join('')
  filters.push(`${concatInputs}concat=n=${filterIndex}:v=1:a=1[outv][outa]`)

  return [
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map', '[outv]',
    '-map', '[outa]',
    '-c:v', 'libx264', // Re-encode (không thể copy với filter)
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac', // Re-encode audio
    '-b:a', '192k',
  ]
}

/**
 * Ghép video với Turbo Engine
 */
export async function mergeVideosOnceTurbo(
  req: MergeVideosTurboRequest,
  progressEmitter?: (progress: {
    requestId: string
    timeSec: number
    totalDurationSec: number
    percent: number
    accelerationMode: 'NONE' | 'SSD' | 'TEMP_SSD' | 'RAM'
    diskType: DiskType
    speedX?: number
    eta?: number
  }) => void
): Promise<MergeVideosTurboResult> {
  const requestId = randomUUID()
  let turboIO: TurboIOResult | null = null
  const ramBuffers: RAMBuffer[] = []
  const startTime = Date.now()

  try {
    if (!req.inputFiles || req.inputFiles.length === 0) {
      throw new Error('Không có inputFiles để ghép')
    }

    // 1. Shuffle nếu cần
    let filesToMerge = req.shuffle ? shuffleArray(req.inputFiles) : req.inputFiles

    // 2. Build clip plan với maxDuration logic
    const clipPlan = await buildClipPlan(filesToMerge, req.targetDurationSec || null)

    // 3. Tính tổng thời lượng từ clip plan
    let totalDurationSec = 0
    for (const item of clipPlan) {
      try {
        const info = await getVideoFileInfo(item.filePath)
        const clipDuration = item.durationSec || info.durationSec || 0
        totalDurationSec += clipDuration
      } catch (e) {
        console.warn(`[mergeVideosTurbo] Failed to probe ${item.filePath}:`, e)
      }
    }

    // 4. Detect disk types
    const outputDiskInfo = await getDiskInfo(req.outputDir)
    
    // 5. Setup Turbo I/O
    turboIO = await setupTurboIO({
      inputPath: clipPlan[0]?.filePath || req.inputFiles[0],
      outputDir: req.outputDir,
    })

    const actualOutputDir = turboIO.actualOutputPath
    const outputPath = path.join(actualOutputDir, req.outputFileName)

    // Tạo output directory
    fs.mkdirSync(actualOutputDir, { recursive: true })

    // 6. RAM preload cho các clips nhỏ (< 6GB)
    const ramPreloadedFiles = new Map<string, RAMBuffer>()
    for (const item of clipPlan) {
      if (shouldUseRAM(item.filePath)) {
        try {
          const ramBuffer = await readFileIntoRAM(item.filePath)
          ramPreloadedFiles.set(item.filePath, ramBuffer)
          ramBuffers.push(ramBuffer)
          console.log(`[mergeVideosTurbo] RAM preloaded: ${path.basename(item.filePath)}`)
        } catch (error) {
          console.warn(`[mergeVideosTurbo] RAM preload failed for ${item.filePath}:`, error)
        }
      }
    }

    // 7. Kiểm tra có cần dùng concat filter không (nếu có trim)
    const needsFilter = clipPlan.some(item => item.startSec !== undefined || item.durationSec !== undefined)
    
    let baseArgs: string[]
    let concatListPath: string | null = null

    if (needsFilter) {
      // Dùng concat filter (có trim - phải re-encode)
      baseArgs = [
        '-hide_banner',
        '-y',
        ...buildConcatFilterCommand(clipPlan),
      ]
    } else {
      // Dùng concat demuxer (nhanh hơn)
      const fileList = clipPlan.map(item => item.filePath)
      concatListPath = path.join(actualOutputDir, `concat_${Date.now()}.txt`)
      fs.writeFileSync(concatListPath, buildConcatListContent(clipPlan), { encoding: 'utf8' })
      
      baseArgs = [
        '-hide_banner',
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
        '-c', 'copy',
      ]
    }

    if (req.mute) {
      baseArgs.push('-an')
    }

    baseArgs.push(outputPath)

    // 8. Chạy FFmpeg với turbo (có fallback nếu demuxer fail)
    let useFilter = needsFilter
    let attemptCount = 0
    const maxAttempts = 2

    while (attemptCount < maxAttempts) {
      try {
        // Check stop trước khi chạy
        if (videoJobManager.isStopRequested(requestId)) {
          throw new Error('Job đã bị hủy')
        }

        if (useFilter) {
          // Dùng filter (đã build ở trên)
          await runTurboFFmpeg({
            args: baseArgs,
            outputPath,
            requestId,
            groupId: req.groupId,
            onProgress: (progress) => {
              // Check stop trong quá trình xử lý
              if (videoJobManager.isStopRequested(requestId)) {
                videoJobManager.cancelJob(requestId)
                return
              }
              if (progressEmitter) {
                const elapsedSec = (Date.now() - startTime) / 1000
                const currentTimeSec = progress.timeSec || 0
                const currentTotalSec = progress.totalDurationSec || totalDurationSec
                const percent = progress.percent || (currentTimeSec / currentTotalSec) * 100
                
                // Tính speedX và ETA
                let speedX: number | undefined
                if (elapsedSec > 0 && currentTimeSec > 0) {
                  speedX = Math.min(Math.max(currentTimeSec / elapsedSec, 0.1), 500)
                }
                
                let eta: number | undefined
                if (speedX && speedX > 0) {
                  const remainingSec = Math.max(0, currentTotalSec - currentTimeSec)
                  eta = remainingSec / speedX
                }
                
                const accelerationMode = ramBuffers.length > 0 ? 'RAM' : (turboIO?.accelerationMode || 'NONE')
                progressEmitter({
                  requestId,
                  timeSec: currentTimeSec,
                  totalDurationSec: currentTotalSec,
                  percent: Math.min(100, Math.max(0, percent)),
                  accelerationMode,
                  diskType: outputDiskInfo.type,
                  speedX,
                  eta,
                })
              }
            },
          })
          break // Success
        } else {
          // Thử demuxer trước
          try {
            await runTurboFFmpeg({
              args: baseArgs,
              outputPath,
              requestId,
              groupId: req.groupId,
              onProgress: (progress) => {
                // Check stop trong quá trình xử lý
                if (videoJobManager.isStopRequested(requestId)) {
                  videoJobManager.cancelJob(requestId)
                  return
                }

                if (progressEmitter) {
                  const elapsedSec = (Date.now() - startTime) / 1000
                  const currentTimeSec = progress.timeSec || 0
                  const currentTotalSec = progress.totalDurationSec || totalDurationSec
                  const percent = progress.percent || (currentTimeSec / currentTotalSec) * 100
                  
                  // Tính speedX và ETA
                  let speedX: number | undefined
                  if (elapsedSec > 0 && currentTimeSec > 0) {
                    speedX = Math.min(Math.max(currentTimeSec / elapsedSec, 0.1), 500)
                  }
                  
                  let eta: number | undefined
                  if (speedX && speedX > 0) {
                    const remainingSec = Math.max(0, currentTotalSec - currentTimeSec)
                    eta = remainingSec / speedX
                  }
                  
                  const accelerationMode = ramBuffers.length > 0 ? 'RAM' : (turboIO?.accelerationMode || 'NONE')
                  progressEmitter({
                    requestId,
                    timeSec: currentTimeSec,
                    totalDurationSec: currentTotalSec,
                    percent: Math.min(100, Math.max(0, percent)),
                    accelerationMode,
                    diskType: outputDiskInfo.type,
                    speedX,
                    eta,
                  })
                }
              },
            })
            break // Success
          } catch (demuxerError) {
            console.warn('[mergeVideosTurbo] Concat demuxer failed, falling back to filter:', demuxerError)
            // Fallback sang filter (phải re-encode)
            useFilter = true
            baseArgs = [
              '-hide_banner',
              '-y',
              ...buildConcatFilterCommand(clipPlan),
            ]
            if (req.mute) {
              baseArgs.push('-an')
            }
            baseArgs.push(outputPath)
            attemptCount++
            // Re-check stop before retry
            if (videoJobManager.isStopRequested(requestId)) {
              throw new Error('Job đã bị hủy')
            }
            continue
          }
        }
      } catch (error) {
        attemptCount++
        if (attemptCount >= maxAttempts) {
          throw error
        }
        console.warn(`[mergeVideosTurbo] Attempt ${attemptCount} failed, retrying...`)
      }
    }

    // 9. Cleanup concat list và RAM buffers
    if (concatListPath) {
      try {
        fs.unlinkSync(concatListPath)
      } catch {}
    }
    
    // Release RAM buffers
    for (const ramBuffer of ramBuffers) {
      releaseRAMBuffer(ramBuffer)
    }

    // 10. Copy từ temp SSD sang HDD nếu cần
    if (turboIO.needsCopy && turboIO.tempPath) {
      console.log('[mergeVideosTurbo] Copying from temp SSD to HDD...')
      const finalOutputPath = path.join(req.outputDir, req.outputFileName)
      const copyStartTime = Date.now()
      await finalizeTurboIO(turboIO, req.outputDir, (percent) => {
        if (progressEmitter) {
          const elapsedSec = (Date.now() - copyStartTime) / 1000
          let speedX: number | undefined
          if (elapsedSec > 0 && percent > 0) {
            const estimatedTimeSec = (totalDurationSec * 100) / percent
            speedX = estimatedTimeSec / elapsedSec
          }
          
          progressEmitter({
            requestId,
            timeSec: totalDurationSec,
            totalDurationSec,
            percent: 100,
            accelerationMode: turboIO.accelerationMode,
            diskType: outputDiskInfo.type,
            speedX,
            eta: 0,
          })
        }
      })

      return {
        requestId,
        outputPath: finalOutputPath,
        totalDurationSec,
        success: true,
        accelerationMode: turboIO.accelerationMode,
        diskType: outputDiskInfo.type,
      }
    }

    const finalAccelerationMode = ramBuffers.length > 0 ? 'RAM' : turboIO.accelerationMode
    return {
      requestId,
      outputPath,
      totalDurationSec,
      success: true,
      accelerationMode: finalAccelerationMode,
      diskType: outputDiskInfo.type,
    }
  } catch (error: any) {
    console.error('[mergeVideosTurbo] Error:', error)

    // Cleanup
    for (const ramBuffer of ramBuffers) {
      releaseRAMBuffer(ramBuffer)
    }
    if (turboIO?.tempPath) {
      const { cleanupTempDir } = await import('./turboIO')
      await cleanupTempDir(turboIO.tempPath)
    }

    return {
      requestId,
      outputPath: '',
      totalDurationSec: 0,
      success: false,
      error: error?.message || String(error),
      accelerationMode: 'NONE',
      diskType: 'UNKNOWN',
    }
  }
}

/**
 * Ghép nhiều lần (parallel nếu có thể)
 */
export async function mergeMultipleTimesTurbo(
  requests: MergeVideosTurboRequest[],
  maxConcurrency: number = 2,
  groupRequestId?: string, // Request ID chung cho cả group (để cancel-group)
  progressEmitter?: (progress: {
    requestId: string
    jobIndex: number
    totalJobs: number
    timeSec: number
    totalDurationSec: number
    percent: number
    accelerationMode: 'NONE' | 'SSD' | 'TEMP_SSD' | 'RAM'
    diskType: DiskType
    speedX?: number
    eta?: number
  }) => void
): Promise<MergeVideosTurboResult[]> {
  const results: MergeVideosTurboResult[] = []
  const activeTasks = new Set<Promise<void>>()
  const queue = [...requests]
  let completedJobs = 0
  const groupId = groupRequestId || randomUUID()

  // Register group để có thể cancel-group
  if (groupRequestId) {
    videoJobManager.requestStop(groupId) // Reset stop flag
  }

  const processNext = async (): Promise<void> => {
    // Check stop requested
    if (groupRequestId && videoJobManager.isStopRequested(groupRequestId)) {
      return
    }

    if (queue.length === 0) {
      return
    }

    const req = queue.shift()!
    const jobIndex = requests.length - queue.length

    const taskPromise = (async () => {
      try {
        // Check stop trước khi bắt đầu
        if (groupRequestId && videoJobManager.isStopRequested(groupRequestId)) {
          return
        }

        // Pass groupId vào request
        const reqWithGroup = { ...req, groupId: groupRequestId }
        const result = await mergeVideosOnceTurbo(reqWithGroup, (progress) => {
          // Check stop trong quá trình xử lý
          if (groupRequestId && videoJobManager.isStopRequested(groupRequestId)) {
            // Cancel job này
            videoJobManager.cancelJob(progress.requestId)
            return
          }

          if (progressEmitter) {
            const overallPercent = ((jobIndex - 1) + progress.percent / 100) / requests.length * 100
            progressEmitter({
              requestId: progress.requestId,
              jobIndex,
              totalJobs: requests.length,
              timeSec: progress.timeSec,
              totalDurationSec: progress.totalDurationSec,
              percent: overallPercent,
              accelerationMode: progress.accelerationMode,
              diskType: progress.diskType,
              speedX: progress.speedX,
              eta: progress.eta,
            })
          }
        })

        results.push(result)
      } catch (error: any) {
        // Nếu bị cancel → không log error
        if (groupRequestId && videoJobManager.isStopRequested(groupRequestId)) {
          results.push({
            requestId: randomUUID(),
            outputPath: '',
            totalDurationSec: 0,
            success: false,
            error: 'Đã bị hủy',
            accelerationMode: 'NONE',
            diskType: 'UNKNOWN',
          })
        } else {
          console.error(`[mergeMultipleTimesTurbo] Error in job ${jobIndex}:`, error)
          results.push({
            requestId: randomUUID(),
            outputPath: '',
            totalDurationSec: 0,
            success: false,
            error: error?.message || String(error),
            accelerationMode: 'NONE',
            diskType: 'UNKNOWN',
          })
        }
      } finally {
        completedJobs++
        activeTasks.delete(taskPromise)

        // Process next (nếu không bị stop)
        if (!groupRequestId || !videoJobManager.isStopRequested(groupRequestId)) {
          if (queue.length > 0 && activeTasks.size < maxConcurrency) {
            processNext()
          }
        }
      }
    })()

    activeTasks.add(taskPromise)

    // Start next (nếu không bị stop)
    if (!groupRequestId || !videoJobManager.isStopRequested(groupRequestId)) {
      if (activeTasks.size < maxConcurrency && queue.length > 0) {
        processNext()
      }
    }
  }

  // Start initial batch
  const initialBatch = Math.min(maxConcurrency, requests.length)
  for (let i = 0; i < initialBatch; i++) {
    processNext()
  }

  // Wait for all
  while (activeTasks.size > 0 || queue.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return results
}


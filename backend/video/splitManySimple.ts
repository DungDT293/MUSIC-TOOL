import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'crypto'
import { cutVideoIntoSegmentsSimple, type CutSingleSimpleRequest } from './cutSingleSimple'
import { validateInputFiles } from './videoUtils'
import { videoJobManager } from './videoJobManager'
import { buildMultiCutProgress, type MultiCutProgress } from './videoProgress'

export interface SplitManySimpleRequest {
  inputFiles?: string[]
  inputPaths?: string[]
  outputRootDir: string
  outputBaseDir?: string
  segmentLengthSec: number
  format?: 'mp4' | 'mkv'
  requestId?: string
  normalizeOutput?: boolean
  useGpuEncoding?: boolean // true = prefer GPU, false = force CPU, undefined = auto
  targetResolution?: string // '1920x1080' | etc. (chỉ áp dụng khi normalizeOutput = true)
  targetFps?: string        // '24' | '25' | '30000/1001' | '30' | etc.
}

export interface SplitManySimpleResult {
  requestId: string
  success: boolean
  totalFiles: number
  successCount: number
  failCount: number
  elapsedMs: number
  avgSpeed: number
  results: Array<{
    inputPath: string
    outputDir: string
    segmentCount: number
    success: boolean
    error?: string
  }>
}

type SplitManySimpleProgress = MultiCutProgress

const MAX_PARALLEL_SINGLE_CUT = 1 // Chạy tuần tự từng video một

/**
 * Sanitize tên file
 */
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
}

/**
 * Cắt nhiều video tuần tự dựa trên engine single-cut.
 */
export async function splitManyVideosSimple(
  req: SplitManySimpleRequest,
  onProgress?: (progress: SplitManySimpleProgress) => void,
  options?: { signal?: AbortSignal }
): Promise<SplitManySimpleResult> {
  console.log('[splitManySimple] ===== START =====')
  console.log('[splitManySimple] Request:', {
    inputFiles: req.inputFiles?.length ?? 0,
    inputPaths: req.inputPaths?.length ?? 0,
    outputRootDir: req.outputRootDir,
    segmentLengthSec: req.segmentLengthSec,
    normalizeOutput: req.normalizeOutput,
    requestId: req.requestId,
  })
  
  // Sử dụng requestId từ req nếu có (từ IPC handler), nếu không thì tạo mới
  const requestId = req.requestId || randomUUID()
  const startTime = Date.now()
  
  console.log('[splitManySimple] Using requestId:', requestId)
  
  // Register parent job (dummy process để có thể cancel)
  // Note: Không có actual process, chỉ để track cancelled state
  const dummyProcess = {
    killed: false,
    on: () => {},
    kill: () => {},
  } as any
  videoJobManager.registerJob(requestId, dummyProcess)

  // Normalize input files (remove duplicates, check existence)
  const normalizedInputFiles = Array.from(
    new Set((req.inputFiles && req.inputFiles.length ? req.inputFiles : req.inputPaths) || [])
  ).filter((p) => {
    const exists = !!p && fs.existsSync(p)
    if (!exists) {
      console.warn(`[splitManySimple] Skip missing file: ${p}`)
    }
    return exists
  })

  if (normalizedInputFiles.length === 0) {
    throw new Error('Không có video hợp lệ để cắt')
  }

  // UltraFast: validateInputFiles chỉ chạy 1 lần trước job (concurrency 10)
  const { valid, invalid } = await validateInputFiles(normalizedInputFiles, 10)

  if (valid.length === 0) {
    throw new Error('Không có video hợp lệ để cắt (tất cả file đều lỗi hoặc hỏng)')
  }

  const outputRootDir = req.outputRootDir || req.outputBaseDir
  if (!outputRootDir) {
    throw new Error('Thiếu outputRootDir')
  }
  if (!fs.existsSync(outputRootDir)) {
    fs.mkdirSync(outputRootDir, { recursive: true })
  }

  // Use only valid files for processing
  const filesToProcess = valid.map(v => v.path)
  const totalFiles = normalizedInputFiles.length // Keep original count for reporting
  const results: SplitManySimpleResult['results'] = []
  let successCount = 0
  let failCount = 0
  let totalProcessingSeconds = 0
  let totalVideoDuration = 0
  
  // Track tất cả requestIds của các single-cut jobs để có thể cancel
  const childRequestIds: string[] = []

  // Track progress per file for accurate overallPercent calculation when running in parallel
  const perFileProgress = new Map<string, number>() // path -> percent (0-100)
  const completedFiles = new Set<string>()
  let sentWarningMessage = false // Prevent spam progress.message
  
  // Helper để emit progress với overallPercent chính xác khi chạy tuần tự
  const emitProgress = (partial: Partial<SplitManySimpleProgress>, filePath?: string) => {
    if (!onProgress) {
      console.log('[splitManySimple] emitProgress: onProgress is undefined, skipping')
      return
    }
    
    console.log('[splitManySimple] emitProgress called with:', {
      currentFileIndex: partial.currentFileIndex,
      currentFilePercent: partial.currentFilePercent,
      currentFileSegment: partial.currentFileSegment,
      currentFileTotalSegments: partial.currentFileTotalSegments,
      filePath,
    })
    
    // Update per-file progress if filePath is provided
    if (filePath && typeof partial.currentFilePercent === 'number') {
      perFileProgress.set(filePath, partial.currentFilePercent)
    }
    
    // Calculate overall percent - chạy tuần tự nên tính đơn giản hơn
    let overallPercent = 0
    if (partial.overallPercent !== undefined) {
      overallPercent = partial.overallPercent
    } else {
      // Tính theo công thức: (số file đã xong + phần trăm file hiện tại) / tổng số file
      const currentFileIndex = partial.currentFileIndex ?? 0
      const currentFilePercent = partial.currentFilePercent ?? 0
      // currentFileIndex là 1-based, nên filesDoneBefore = currentFileIndex - 1
      const filesDoneBefore = Math.max(0, currentFileIndex - 1)
      const perFileWeight = 100 / totalFiles
      const donePercent = filesDoneBefore * perFileWeight
      const currentContribution = (Math.max(0, Math.min(100, currentFilePercent)) / 100) * perFileWeight
      overallPercent = Math.min(100, donePercent + currentContribution)
    }
    
    const payload = buildMultiCutProgress({
      mode: 'multi-cut',
      requestId,
      totalFiles,
      currentFileIndex: partial.currentFileIndex ?? 0,
      currentFilePath: partial.currentFilePath,
      currentFilePercent: partial.currentFilePercent,
      currentFileSegment: partial.currentFileSegment,
      currentFileTotalSegments: partial.currentFileTotalSegments,
      currentFileSpeedX: partial.currentFileSpeedX,
      currentFileEtaSec: partial.currentFileEtaSec,
      overallPercent,
      error: partial.error,
      completed: partial.completed,
      message: partial.message,
    })
    
    console.log('[splitManySimple] Calling onProgress with payload:', {
      mode: payload.mode,
      requestId: payload.requestId,
      totalFiles: payload.totalFiles,
      currentFileIndex: payload.currentFileIndex,
      currentFilePercent: payload.currentFilePercent,
      overallPercent: payload.overallPercent,
    })
    
    onProgress(payload)
  }

  // Emit progress message if some files were invalid (only once)
  if (invalid.length > 0 && !sentWarningMessage) {
    const message = `Đã bỏ qua ${invalid.length} video lỗi / hỏng trước khi cắt`
    emitProgress({
      overallPercent: 0,
      totalFiles: normalizedInputFiles.length,
      currentFileIndex: 0,
      message,
    })
    sentWarningMessage = true
  }

  // Add invalid files to results as failed
  for (const invalidPath of invalid) {
    results.push({
      inputPath: invalidPath,
      outputDir: '', // No output dir for invalid files
      segmentCount: 0,
      success: false,
      error: 'invalid_or_corrupted',
    })
    failCount++
    completedFiles.add(invalidPath) // Mark as completed (failed)
  }

  // Process valid files sequentially (one at a time) - chạy tuần tự từng video một
  console.log(`[splitManySimple] Starting to process ${filesToProcess.length} valid files (total: ${totalFiles}, invalid: ${invalid.length})`)
  
  for (let idx = 0; idx < filesToProcess.length; idx++) {
    const inputPath = filesToProcess[idx]
    // currentFileIndex should account for invalid files that were skipped
    const currentFileIndex = invalid.length + idx + 1
    const videoName = path.basename(inputPath)
    const safeBase = sanitizeFileName(path.basename(inputPath, path.extname(inputPath)) || `video_${currentFileIndex}`)
    const outputDir = path.join(outputRootDir, safeBase)
    fs.mkdirSync(outputDir, { recursive: true })

    console.log(`[splitManySimple] ===== Processing file ${currentFileIndex}/${totalFiles}: ${videoName} =====`)
    console.log(`[splitManySimple] Input: ${inputPath}`)
    console.log(`[splitManySimple] Output: ${outputDir}`)

    // Initialize progress for this file
    perFileProgress.set(inputPath, 0)
    emitProgress({ 
      currentFilePercent: 0,
      currentFilePath: inputPath,
      currentFileIndex,
    }, inputPath)

    try {
      const singleReq: CutSingleSimpleRequest = {
        inputPath,
        outputDir,
        segmentLengthSec: req.segmentLengthSec,
        format: req.format,
        normalizeOutput: !!req.normalizeOutput,
        useGpuEncoding: req.useGpuEncoding, // Pass GPU encoding choice to single cut
        targetResolution: req.targetResolution,
        targetFps: req.targetFps,
        requestId: `${requestId}-${currentFileIndex}`, // Dùng parent requestId + index để track child jobs
      }

      console.log(`[splitManySimple] Calling cutVideoIntoSegmentsSimple for file ${currentFileIndex}`)
      
      const cutResult = await cutVideoIntoSegmentsSimple(
        singleReq,
        (singleProgress) => {
          console.log(`[splitManySimple] Received single-cut progress for file ${currentFileIndex}:`, {
            requestId: singleProgress.requestId,
            percent: singleProgress.percent,
            currentSegment: singleProgress.currentSegment,
            totalSegments: singleProgress.totalSegments,
            speedX: singleProgress.speedX,
            timeSec: singleProgress.timeSec,
            totalDurationSec: singleProgress.totalDurationSec,
          })
          
          // Track requestId của single-cut job
          if (singleProgress.requestId && !childRequestIds.includes(singleProgress.requestId)) {
            childRequestIds.push(singleProgress.requestId)
            console.log(`[splitManySimple] Tracked child job: ${singleProgress.requestId}`)
          }
          
          // Check if multi-cut job was cancelled
          if (videoJobManager.isCancelled(requestId) || options?.signal?.aborted) {
            console.log(`[splitManySimple] Job ${requestId} cancelled, stopping child jobs`)
            // Cancel all child jobs
            for (const childId of childRequestIds) {
              videoJobManager.cancelJob(childId)
            }
            return // Stop processing
          }
          
          // Update progress for this file and emit overall progress
          const progressUpdate = {
            currentFilePercent: singleProgress.percent ?? 0,
            currentFileSegment: singleProgress.currentSegment ?? 0,
            currentFileTotalSegments: singleProgress.totalSegments ?? 0,
            currentFileSpeedX: singleProgress.speedX ?? null,
            currentFileEtaSec: singleProgress.etaSec ?? null,
            currentFilePath: inputPath,
            currentFileIndex,
          }
          console.log(`[splitManySimple] Emitting progress for file ${currentFileIndex}:`, progressUpdate)
          emitProgress(progressUpdate, inputPath)
        },
        options // Pass options (signal) để có thể cancel
      )
      
      console.log(`[splitManySimple] File ${currentFileIndex} completed:`, {
        success: cutResult.success,
        segmentCount: cutResult.segmentCount,
        elapsedMs: cutResult.elapsedMs,
        avgSpeed: cutResult.avgSpeed,
        error: cutResult.error,
      })
      
      // Check if multi-cut job was cancelled after single-cut completes
      if (videoJobManager.isCancelled(requestId) || options?.signal?.aborted) {
        // Cancel all remaining child jobs
        for (const childId of childRequestIds) {
          videoJobManager.cancelJob(childId)
        }
        videoJobManager.cancelJob(requestId) // Cleanup parent
        throw new Error('Đã dừng bởi người dùng')
      }

      // Mark file as completed
      completedFiles.add(inputPath)
      perFileProgress.delete(inputPath) // Remove from active progress tracking

      // UltraFast: Không verify số đoạn - chấp nhận kết quả từ cutVideoIntoSegmentsSimple
      if (cutResult.success) {
        successCount++
        totalProcessingSeconds += cutResult.elapsedMs / 1000
        // UltraFast: Ước lượng duration từ segmentCount (chấp nhận lệch)
        totalVideoDuration += cutResult.segmentCount * req.segmentLengthSec
      } else {
        failCount++
      }

      results.push({
        inputPath,
        outputDir,
        segmentCount: cutResult.segmentCount,
        success: cutResult.success,
        error: cutResult.error,
      })

      // Emit final progress for this file
      emitProgress({
        currentFilePercent: 100,
        currentFileSegment: cutResult.segmentCount,
        currentFileTotalSegments: cutResult.segmentCount,
        currentFileSpeedX: cutResult.avgSpeed ?? null,
        currentFileEtaSec: 0,
        currentFilePath: inputPath,
        currentFileIndex,
      }, inputPath)
    } catch (error: any) {
      // Mark file as completed (failed)
      completedFiles.add(inputPath)
      perFileProgress.delete(inputPath)
      
      // Check if cancelled — dùng isCancelled/signal thay vì string matching trên error message
      // (Vietnamese string matching dễ vỡ nếu thay đổi text ở nơi khác)
      if (videoJobManager.isCancelled(requestId) || options?.signal?.aborted) {
        // Cancel all remaining child jobs
        for (const childId of childRequestIds) {
          videoJobManager.cancelJob(childId)
        }
        throw new Error('Đã dừng bởi người dùng')
      }
      
      failCount++
      const errorMessage = error?.message || String(error)
      console.error(`[splitManySimple] Error cutting ${inputPath} (index ${idx}):`, errorMessage)

      results.push({
        inputPath,
        outputDir,
        segmentCount: 0,
        success: false,
        error: errorMessage,
      })

      // Emit error progress
      emitProgress({
        currentFilePercent: 100,
        currentFileSegment: 0,
        currentFileTotalSegments: 0,
        currentFileSpeedX: null,
        currentFileEtaSec: null,
        error: errorMessage,
        currentFilePath: inputPath,
        currentFileIndex,
      }, inputPath)
    }
  }

  // Clear memory after job completes
  perFileProgress.clear()
  completedFiles.clear()

  const elapsedMs = Date.now() - startTime
  const avgSpeed =
    totalProcessingSeconds > 0 && totalVideoDuration > 0
      ? totalVideoDuration / totalProcessingSeconds
      : 0

  const success = failCount === 0
  
  // Cleanup parent job — chỉ xóa khỏi jobs Map, KHÔNG gọi cancelJob()
  // cancelJob() sẽ đánh dấu requestId vào cancelledJobs set → poisoning cancelled state
  // cho các lần check isCancelled() sau đó.
  // Dùng clearCancelled() nếu cần xóa cancelled flag từ trước đó.
  videoJobManager.clearCancelled(requestId)

  // TODO: Ensure all arrays are always defined to prevent "Cannot read properties of undefined (reading 'length')" in UI
  const result: SplitManySimpleResult = {
    requestId,
    success,
    totalFiles,
    successCount,
    failCount,
    elapsedMs,
    avgSpeed,
    results: results ?? [], // Always ensure results is an array
  }

  if (onProgress) {
    const finalPayload = buildMultiCutProgress({
      mode: 'multi-cut',
      requestId,
      totalFiles,
      currentFileIndex: totalFiles,
      currentFilePath: results[results.length - 1]?.inputPath,
      currentFilePercent: 100,
      currentFileSegment: results[results.length - 1]?.segmentCount ?? 0,
      currentFileTotalSegments: results[results.length - 1]?.segmentCount ?? 0,
      currentFileSpeedX: null,
      currentFileEtaSec: 0,
      overallPercent: 100,
      completed: true,
    })
    onProgress(finalPayload)
  }

  return result
}

// Backward-compatible export name
export const splitMultipleVideosSimple = splitManyVideosSimple








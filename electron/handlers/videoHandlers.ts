/**
 * videoHandlers.ts
 * IPC handlers: video:cut, video:split, video:merge, video:mute, video:normalize,
 *               video:probe, video:getFileInfo, video:cancelJob, video:pool-*
 */

import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getVideoFileInfo } from '../../backend/video/videoInfo'
import { cutVideoIntoSegmentsSimple, type CutSingleSimpleRequest } from '../../backend/video/cutSingleSimple'
import { splitManyVideosSimple, type SplitManySimpleRequest } from '../../backend/video/splitManySimple'
import { mergeVideosSimple, type MergeVideosSimpleRequest } from '../../backend/video/mergeVideosSimple'
import { muteVideoAudio, type MuteVideoAudioRequest } from '../../backend/video/muteVideoAudio'
import { normalizeVideo, type NormalizeVideoRequest } from '../../backend/video/normalizeVideo'
import { extractAudioBatch, type ExtractAudioRequest } from '../../backend/video/extractAudio'
import { videoJobManager } from '../../backend/video/videoJobManager'
import { jobQueue } from '../../backend/jobQueue/jobQueue'
import { isValidAbsolutePath } from '../authState'
import { confirmResourcesForVideoJob } from './systemHandlers'

const VIDEO_PROGRESS_CHANNEL = 'video:progress'
const AUDIO_VISUALIZER_PRESETS = new Set(['bars-spectrum', 'line-waveform', 'mirror-waveform', 'neon-waveform'])

let activeMergeRequestId: string | null = null
let activeMergeOwner: string | null = null
let activeMuteRequestId: string | null = null
let activeNormalizeRequestId: string | null = null
let activeExtractAudioRequestId: string | null = null

export function getActiveMergeRequestId() { return activeMergeRequestId }
export function getActiveMuteRequestId() { return activeMuteRequestId }
export function getActiveNormalizeRequestId() { return activeNormalizeRequestId }
export function getActiveExtractAudioRequestId() { return activeExtractAudioRequestId }

function validateAudioVisualizerPreviewOptions(options: any): string | null {
  if (!options || typeof options !== 'object') return 'audioVisualizer is required'
  if (options.enabled !== true) return 'audioVisualizer.enabled must be true'
  if (!AUDIO_VISUALIZER_PRESETS.has(options.preset)) return `audioVisualizer.preset không hợp lệ: ${String(options.preset)}`
  for (const key of ['widthPercent', 'heightPercent', 'marginBottomPx', 'opacity', 'barCount', 'sensitivity']) {
    if (options[key] !== undefined && typeof options[key] !== 'number') return `audioVisualizer.${key} phải là number`
  }
  for (const key of ['primaryColor', 'secondaryColor']) {
    if (options[key] !== undefined && typeof options[key] !== 'string') return `audioVisualizer.${key} phải là string`
  }
  if (options.position !== undefined && !['top', 'center', 'bottom'].includes(options.position)) return `audioVisualizer.position không hợp lệ: ${String(options.position)}`
  return null
}

export function registerVideoHandlers() {
  ipcMain.handle('video:probeFile', async (_event, filePath: string) => {
    try {
      console.log('[IPC] video:probeFile', filePath)
      if (!isValidAbsolutePath(filePath)) throw new Error('Invalid file path')
      return await getVideoFileInfo(filePath)
    } catch (err) {
      console.error('[IPC] video:probeFile error', err)
      throw err
    }
  })

  ipcMain.handle('video:getFileInfo', async (_event, filePath: string) => {
    try {
      if (!isValidAbsolutePath(filePath)) return { durationSec: 0, filePath }
      const timeoutMs = 8000
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout: videoGetFileInfo took longer than 8s')), timeoutMs)
      })
      const result = await Promise.race([getVideoFileInfo(filePath), timeoutPromise])
      return result
    } catch (err: any) {
      console.error('[IPC] video:getFileInfo error', err)
      if (err?.message?.includes('Timeout')) {
        console.warn('[IPC] video:getFileInfo timeout, returning default')
        return { durationSec: 0, filePath }
      }
      throw err
    }
  })

  ipcMain.handle('video:cutSingleSimple', async (event, req: CutSingleSimpleRequest) => {
    const sender = event.sender
    if (!isValidAbsolutePath(req.inputPath)) {
      return {
        requestId: req.requestId || randomUUID(),
        outputFiles: [],
        segmentCount: 0,
        elapsedMs: 0,
        avgSpeed: 0,
        success: false,
        error: 'Đường dẫn video đầu vào không hợp lệ.',
      }
    }
    if (!isValidAbsolutePath(req.outputDir)) {
      return {
        requestId: req.requestId || randomUUID(),
        outputFiles: [],
        segmentCount: 0,
        elapsedMs: 0,
        avgSpeed: 0,
        success: false,
        error: 'Đường dẫn thư mục xuất không hợp lệ.',
      }
    }
    const jobHandle = jobQueue.enqueue({
      type: 'video:cut-single',
      payload: { inputPath: req.inputPath, segmentLengthSec: req.segmentLengthSec },
      onCancel: (jobId) => videoJobManager.cancelJob(jobId),
      task: async (ctx) => {
        const result = await cutVideoIntoSegmentsSimple(
          { ...req, requestId: ctx.jobId },
          (progress) => {
            const percent = progress.percent ?? 0
            ctx.updateProgress(percent, `Cutting video (${percent.toFixed(1)}%)`)
            if (!sender.isDestroyed()) {
              sender.send(VIDEO_PROGRESS_CHANNEL, { ...progress, requestId: ctx.jobId, mode: 'single-cut' as const })
            }
          },
          { signal: ctx.signal }
        )
        if (result.success) {
          if (!sender.isDestroyed()) {
            sender.send(VIDEO_PROGRESS_CHANNEL, {
              requestId: ctx.jobId,
              mode: 'single-cut',
              completed: true,
              outputFiles: result.outputFiles,
              segmentCount: result.segmentCount,
              avgSpeed: result.avgSpeed,
              elapsedMs: result.elapsedMs,
            })
          }
        } else if (!sender.isDestroyed()) {
          sender.send(VIDEO_PROGRESS_CHANNEL, { requestId: ctx.jobId, mode: 'single-cut', error: result.error })
        }
        return result
      },
    })
    try { return await jobHandle.result }
    catch (err) { console.error('[IPC] video:cutSingleSimple error', err); throw err }
  })

  ipcMain.handle('video:splitManySimple', async (event, req: SplitManySimpleRequest) => {
    const sender = event.sender
    const jobHandle = jobQueue.enqueue({
      type: 'video:split-many',
      payload: { files: req.inputFiles?.length ?? req.inputPaths?.length ?? 0 },
      onCancel: (jobId) => {
        console.log(`[IPC] Cancelling split-many job ${jobId}`)
        videoJobManager.cancelJob(jobId)
        const allJobIds = videoJobManager.getAllJobIds()
        for (const childId of allJobIds) {
          if (childId.startsWith(`${jobId}-`)) {
            console.log(`[IPC] Cancelling child job ${childId}`)
            videoJobManager.cancelJob(childId)
          }
        }
      },
      task: async (ctx) => {
        console.log('[IPC] video:splitManySimple - Starting task with requestId:', ctx.jobId)
        const result = await splitManyVideosSimple(
          { ...req, requestId: ctx.jobId },
          (progress) => {
            const percent = progress.overallPercent ?? progress.percent ?? 0
            ctx.updateProgress(percent, `Splitting videos (${percent.toFixed(1)}%)`)
            if (!sender.isDestroyed()) {
              sender.send(VIDEO_PROGRESS_CHANNEL, { ...progress, requestId: ctx.jobId, mode: 'multi-cut' as const })
            }
          },
          { signal: ctx.signal }
        )
        console.log('[IPC] video:splitManySimple - Task completed:', {
          success: result.success,
          totalFiles: result.totalFiles,
          successCount: result.successCount,
          failCount: result.failCount,
        })
        return result
      },
    })
    try { return await jobHandle.result }
    catch (err) { console.error('[IPC] video:splitManySimple error', err); throw err }
  })

  ipcMain.handle('video:mergeSimple', async (event, req: MergeVideosSimpleRequest) => {
    const sender = event.sender
    const requestId = req.requestId || randomUUID()
    const owner = randomUUID()
    const rejected = (error: string) => ({ requestId, outputPaths: [], totalDurationSec: 0, success: false, error })
    if (activeMergeOwner) {
      return rejected('Đã có một job ghép video đang chạy. Vui lòng đợi job hiện tại hoàn thành hoặc hủy trước khi chạy job mới.')
    }
    activeMergeOwner = owner
    try {
      const proceed = await confirmResourcesForVideoJob('merge', req.outputDir)
      if (!proceed) return rejected('Job đã bị hủy sau cảnh báo tài nguyên.')

      activeMergeRequestId = requestId
      return await mergeVideosSimple(
        { ...req, requestId },
        (progress) => {
          if (!sender.isDestroyed()) {
            sender.send(VIDEO_PROGRESS_CHANNEL, { ...progress, requestId, mode: 'merge' as const })
          }
        }
      )
    } catch (err) {
      console.error('[IPC] video:mergeSimple error', err)
      throw err
    } finally {
      if (activeMergeOwner === owner) {
        activeMergeOwner = null
        activeMergeRequestId = null
      }
    }
  })

  ipcMain.handle('video:muteAudio', async (event, req: MuteVideoAudioRequest) => {
    const sender = event.sender
    const requestId = req.requestId || randomUUID()
    try {
      if (activeMuteRequestId && activeMuteRequestId !== requestId) {
        return {
          requestId,
          outputPaths: [],
          success: false,
          error: 'Đã có một job tắt âm thanh đang chạy. Vui lòng đợi job hiện tại hoàn thành hoặc hủy trước khi chạy job mới.',
          processed: 0,
          failed: 0,
        }
      }

      const proceed = await confirmResourcesForVideoJob('mute', req.outputDir)
      if (!proceed) {
        return {
          requestId,
          outputPaths: [],
          success: false,
          error: 'Job đã bị hủy sau cảnh báo tài nguyên.',
          processed: 0,
          failed: 0,
        }
      }

      activeMuteRequestId = requestId
      try {
        return await muteVideoAudio(
          { ...req, requestId },
          (progress) => {
            if (!sender.isDestroyed()) {
              sender.send(VIDEO_PROGRESS_CHANNEL, { ...progress, requestId, mode: 'mute-audio' })
            }
          }
        )
      } finally {
        activeMuteRequestId = null
      }
    } catch (err: any) {
      console.error('[IPC] video:muteAudio error', err)
      return {
        requestId,
        outputPaths: [],
        success: false,
        error: err?.message || 'Lỗi không xác định khi tắt âm thanh video',
        processed: 0,
        failed: 0,
      }
    }
  })

  ipcMain.handle('video:getActiveMuteJobId', async () => activeMuteRequestId)

  ipcMain.handle('video:normalize', async (event, req: NormalizeVideoRequest) => {
    const sender = event.sender
    const requestId = req.requestId || randomUUID()
    try {
      if (activeNormalizeRequestId && activeNormalizeRequestId !== requestId) {
        return {
          requestId,
          outputPaths: [],
          success: false,
          error: 'Đã có một job chuẩn hóa video đang chạy. Vui lòng đợi job hiện tại hoàn thành hoặc hủy trước khi chạy job mới.',
          processed: 0,
          failed: 0,
          usedGpu: false,
        }
      }

      const proceed = await confirmResourcesForVideoJob('normalize', req.outputDir)
      if (!proceed) {
        return {
          requestId,
          outputPaths: [],
          success: false,
          error: 'Job đã bị hủy sau cảnh báo tài nguyên.',
          processed: 0,
          failed: 0,
          usedGpu: false,
        }
      }

      activeNormalizeRequestId = requestId
      try {
        return await normalizeVideo(
          { ...req, requestId },
          (progress) => {
            if (!sender.isDestroyed()) {
              sender.send(VIDEO_PROGRESS_CHANNEL, { ...progress, requestId, mode: 'normalize' })
            }
          }
        )
      } finally {
        activeNormalizeRequestId = null
      }
    } catch (err: any) {
      console.error('[IPC] video:normalize error', err)
      return {
        requestId,
        outputPaths: [],
        success: false,
        error: err?.message || 'Lỗi không xác định khi chuẩn hóa video',
        processed: 0,
        failed: 0,
        usedGpu: false,
      }
    }
  })

  ipcMain.handle('video:getActiveNormalizeJobId', async () => {
    if (activeNormalizeRequestId && videoJobManager.hasJob(activeNormalizeRequestId)) {
      return activeNormalizeRequestId
    }
    return null
  })

  ipcMain.handle('video:extractAudioBatch', async (event, req: ExtractAudioRequest) => {
    const sender = event.sender
    const requestId = req?.requestId || randomUUID()
    const failed = (error: string) => ({ requestId, outputPaths: [], failures: [], success: false, error, processed: 0, failed: 0 })
    if (activeExtractAudioRequestId) {
      return failed('Đã có một job tách âm thanh đang chạy.')
    }
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) return failed('requestId không hợp lệ.')
    if (videoJobManager.hasJob(requestId)) return failed('requestId đang được sử dụng.')
    if (!req || !Array.isArray(req.inputFiles) || req.inputFiles.length === 0 || req.inputFiles.length > 500) {
      return failed('Danh sách video không hợp lệ.')
    }
    if (!req.inputFiles.every((filePath) => typeof filePath === 'string' && isValidAbsolutePath(filePath))) {
      return failed('Đường dẫn video không hợp lệ.')
    }
    if (req.mp4Only && !req.inputFiles.every((filePath) => path.extname(filePath).toLowerCase() === '.mp4')) {
      return failed('Chức năng này chỉ nhận file MP4.')
    }
    if (!isValidAbsolutePath(req.outputDir)) return failed('Đường dẫn thư mục xuất không hợp lệ.')
    if (req.audioFormat !== 'mp3' && req.audioFormat !== 'wav') return failed('Định dạng âm thanh không hợp lệ.')

    activeExtractAudioRequestId = requestId
    const onSenderDestroyed = () => videoJobManager.cancelJob(requestId)
    sender.once('destroyed', onSenderDestroyed)
    try {
      return await extractAudioBatch(
        { ...req, requestId },
        (progress) => {
          if (!sender.isDestroyed()) sender.send(VIDEO_PROGRESS_CHANNEL, { ...progress, requestId, mode: 'extract-audio' })
        },
      )
    } catch (err: any) {
      return failed(err?.message || 'Tách âm thanh thất bại.')
    } finally {
      sender.removeListener('destroyed', onSenderDestroyed)
      if (activeExtractAudioRequestId === requestId) activeExtractAudioRequestId = null
    }
  })

  ipcMain.handle('video:getActiveExtractAudioJobId', async () => activeExtractAudioRequestId)

  ipcMain.handle('video:cancelJob',
 async (_event, requestId: string) => {
    try { videoJobManager.cancelJob(requestId); return { success: true } }
    catch (err) { console.error('[IPC] video:cancelJob error', err); return { success: false, error: String(err) } }
  })

  ipcMain.handle('video:getAllJobIds', async () => {
    try { return videoJobManager.getAllJobIds() }
    catch (err) { console.error('[IPC] video:getAllJobIds error', err); return [] }
  })

  ipcMain.handle('video:getActiveMergeJobId', async () => {
    try {
      if (activeMergeRequestId && videoJobManager.hasJob(activeMergeRequestId)) return activeMergeRequestId
      return null
    } catch (err) {
      console.error('[IPC] video:getActiveMergeJobId error', err)
      return null
    }
  })

  ipcMain.handle('video:hasJob', async (_event, requestId: string) => {
    try { return videoJobManager.hasJob(requestId) }
    catch (err) { console.error('[IPC] video:hasJob error', err); return false }
  })

  ipcMain.handle('video:pool-mark-used', async (_event, filePaths: string[]) => {
    try {
      if (!Array.isArray(filePaths)) throw new Error('filePaths must be an array')
      const validPaths = filePaths.filter((fp): fp is string => typeof fp === 'string' && isValidAbsolutePath(fp))
      const { markFilePathsUsed } = await import('../../backend/autopilot/videoPool')
      const dateCode = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const result = await markFilePathsUsed(validPaths, dateCode)
      return { ok: true, marked: result.clipIds.length }
    } catch (err: any) {
      console.error('[IPC] video:pool-mark-used error', err)
      return { ok: false, error: err?.message }
    }
  })

  ipcMain.handle('video:pool-pick-lru', async (_event, folderPath: string, count: number) => {
    if (!isValidAbsolutePath(folderPath)) {
      return { ok: false, error: 'Invalid folder path', filePaths: [] }
    }
    if (!Number.isSafeInteger(count) || count < 0) {
      return { ok: false, error: 'Count must be a non-negative integer', filePaths: [] }
    }
    try {
      const { pickClipsLRU } = await import('../../backend/autopilot/videoPool')
      const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v'])
      const files = fs.readdirSync(folderPath)
        .filter((f) => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
        .map((f) => path.join(folderPath, f))
      const result = await pickClipsLRU(files, count)
      return { ok: true, filePaths: result.filePaths, reusedCount: result.reusedCount, totalAvailable: result.totalAvailable }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Pool pick failed', filePaths: [] }
    }
  })

  // ── Bars Spectrum Preview ───────────────────────────────────────────────
  ipcMain.handle('video:barsSpectrumPreview', async (_event, opts: {
    bgPath: string
    bgKind: 'image' | 'video'
    audioPath: string
    audioVisualizer: {
      enabled: boolean
      preset: 'bars-spectrum' | 'line-waveform' | 'mirror-waveform' | 'neon-waveform'
      position?: 'top' | 'center' | 'bottom'
      widthPercent?: number
      heightPercent?: number
      marginBottomPx?: number
      primaryColor?: string
      secondaryColor?: string
      opacity?: number
      barCount?: number
      sensitivity?: number
    }
  }) => {
    try {
      if (!isValidAbsolutePath(opts.bgPath) || !isValidAbsolutePath(opts.audioPath)) {
        return { ok: false, error: 'Invalid file path' }
      }
      const visualizerError = validateAudioVisualizerPreviewOptions(opts.audioVisualizer)
      if (visualizerError) {
        return { ok: false, error: `Tùy chọn sóng nhạc không hợp lệ: ${visualizerError}` }
      }
      const { generateBarsSpectrumPreview } = await import('../../backend/video/finalExport')
      const previewPath = await generateBarsSpectrumPreview(opts)
      return { ok: true, previewPath }
    } catch (err: any) {
      console.error('[IPC] video:barsSpectrumPreview error', err)
      return { ok: false, error: err?.message || 'Preview failed' }
    }
  })

  // ── Chroma Key Preview ──────────────────────────────────────────────────
  ipcMain.handle('video:chromaKeyPreview', async (_event, opts: {
    bgVideoPath: string
    overlayVideoPath: string
    bgType: 'green' | 'black'
    keyColor: string
    similarity: number
    blend: number
    position: 'center' | 'bottom'
    scale: number
  }) => {
    try {
      if (!isValidAbsolutePath(opts.bgVideoPath) || !isValidAbsolutePath(opts.overlayVideoPath)) {
        return { ok: false, error: 'Invalid file path' }
      }
      const { generateChromaKeyPreview } = await import('../../backend/video/finalExport')
      const previewPath = await generateChromaKeyPreview(opts)
      return { ok: true, previewPath }
    } catch (err: any) {
      console.error('[IPC] video:chromaKeyPreview error', err)
      return { ok: false, error: err?.message || 'Preview failed' }
    }
  })
}

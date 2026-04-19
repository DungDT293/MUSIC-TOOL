/**
 * videoHandlers.ts
 * IPC handlers: video:cut, video:split, video:merge, video:mute, video:normalize,
 *               video:probe, video:getFileInfo, video:cancelJob, video:pool-*
 */

import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getVideoFileInfo } from '../../backend/video/videoInfo'
import { cutVideoIntoSegmentsSimple, type CutSingleSimpleRequest } from '../../backend/video/cutSingleSimple'
import { splitManyVideosSimple, type SplitManySimpleRequest } from '../../backend/video/splitManySimple'
import { mergeVideosSimple, type MergeVideosSimpleRequest } from '../../backend/video/mergeVideosSimple'
import { muteVideoAudio, type MuteVideoAudioRequest } from '../../backend/video/muteVideoAudio'
import { normalizeVideo, type NormalizeVideoRequest } from '../../backend/video/normalizeVideo'
import { videoJobManager } from '../../backend/video/videoJobManager'
import { jobQueue } from '../../backend/jobQueue/jobQueue'
import { isValidAbsolutePath } from '../authState'
import { confirmResourcesForVideoJob } from './systemHandlers'

const VIDEO_PROGRESS_CHANNEL = 'video:progress'

let activeMergeRequestId: string | null = null
let activeMuteRequestId: string | null = null
let activeNormalizeRequestId: string | null = null

export function getActiveMergeRequestId() { return activeMergeRequestId }
export function getActiveMuteRequestId() { return activeMuteRequestId }
export function getActiveNormalizeRequestId() { return activeNormalizeRequestId }

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
    try {
      if (activeMergeRequestId && activeMergeRequestId !== requestId) {
        return {
          requestId,
          outputPaths: [],
          totalDurationSec: 0,
          success: false,
          error: 'Đã có một job ghép video đang chạy. Vui lòng đợi job hiện tại hoàn thành hoặc hủy trước khi chạy job mới.',
        }
      }

      const proceed = await confirmResourcesForVideoJob('merge', req.outputDir)
      if (!proceed) {
        return {
          requestId,
          outputPaths: [],
          totalDurationSec: 0,
          success: false,
          error: 'Job đã bị hủy sau cảnh báo tài nguyên.',
        }
      }

      activeMergeRequestId = requestId
      try {
        return await mergeVideosSimple(
          { ...req, requestId },
          (progress) => {
            if (!sender.isDestroyed()) {
              sender.send(VIDEO_PROGRESS_CHANNEL, { ...progress, requestId, mode: 'merge' as const })
            }
          }
        )
      } finally {
        activeMergeRequestId = null
      }
    } catch (err) {
      console.error('[IPC] video:mergeSimple error', err)
      throw err
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

  ipcMain.handle('video:cancelJob', async (_event, requestId: string) => {
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
      const { generateClipId, markClipsUsed } = await import('../../backend/autopilot/videoPool')
      const clipIds: string[] = []
      for (const fp of filePaths) {
        if (!isValidAbsolutePath(fp)) continue
        try {
          const size = fs.statSync(fp).size
          const id = generateClipId(path.basename(fp), size)
          clipIds.push(id)
        } catch {}
      }
      const dateCode = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const fingerprint = createHash('sha256').update(clipIds.join(',')).digest('hex').slice(0, 16)
      markClipsUsed(clipIds, dateCode, fingerprint)
      return { ok: true, marked: clipIds.length }
    } catch (err: any) {
      console.error('[IPC] video:pool-mark-used error', err)
      return { ok: false, error: err?.message }
    }
  })

  ipcMain.handle('video:pool-pick-lru', async (_event, folderPath: string, count: number) => {
    if (!isValidAbsolutePath(folderPath)) {
      return { ok: false, error: 'Invalid folder path', filePaths: [] }
    }
    try {
      const { pickClipsLRU } = await import('../../backend/autopilot/videoPool')
      const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v'])
      const files = fs.readdirSync(folderPath)
        .filter((f) => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
        .map((f) => path.join(folderPath, f))
      const result = await pickClipsLRU(files, count)
      return {
        ok: true,
        filePaths: result.filePaths,
        reusedCount: result.reusedCount,
        totalAvailable: result.totalAvailable,
      }
    } catch (err: any) {
      console.error('[IPC] video:pool-pick-lru error', err)
      return { ok: false, error: err?.message, filePaths: [] }
    }
  })
}

/**
 * videoHandlers.ts
 * IPC handlers: video:cut, video:split, video:merge, video:mute, video:normalize,
 *               video:probe, video:getFileInfo, video:cancelJob, video:pool-*
 */

import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
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
  // Video probe
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

  // Get video file info with timeout
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

  // Cut single video
  ipcMain.handle('video:cutSingleSimple', async (event, req: CutSingleSimpleRequest) => {
    const sender = event.sender
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
            sender.send(VIDEO_PROGRESS_CHANNEL, { ...progress, requestId: ctx.jobId, mode: 'single-cut' as const })
          },
          { signal: ctx.signal }
        )
        if (result.success) {
          sender.send(VIDEO_PROGRESS_CHANNEL, {
            requestId: ctx.jobId, mode: 'single-cut', completed: true,
            outputFiles: result.outputFiles, segmentCount: result.segmentCount,
            avgSpeed: result.avgSpeed, elapsedMs: result.elapsedMs,
          })
        } else {
          sender.send(VIDEO_PROGRESS_CHANNEL, { requestId: ctx.jobId, mode: 'single-cut', error: result.error })
        }
        return result
      },
    })
    try { return await jobHandle.result }
    catch (err) { console.error('[IPC] video:cutSingleSimple error', err); throw err }
  })

  // Split many videos
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
            sender.send(VIDEO_PROGRESS_CHANNEL, { ...progress, requestId: ctx.jobId, mode: 'multi-cut' as const })
          },
          { signal: ctx.signal }
        )
        console.log('[IPC] video:splitManySimple - Task completed:', {
          success: result.success, totalFiles: result.totalFiles,
          successCount: result.successCount, failCount: result.failCount,
        })
        return result
      },
    })
    try { return await jobHandle.result }
    catch (err) { console.error('[IPC] video:splitManySimple error', err); throw err }
  })

  // Merge videos
  ipcMain.handle('video:mergeSimple', async (event, req: MergeVideosSimpleRequest) => {
    const sender = event.sender
    try {
      const proceed = await confirmResourcesForVideoJob('merge', req.outputDir)
      if (!proceed) {
        return { requestId: '', outputPaths: [], totalDurationSec: 0, success: false, error: 'Job đã bị hủy sau cảnh báo tài nguyên.' }
      }

      const requestId = req.requestId || randomUUID()
      activeMergeRequestId = requestId
      try {
        const result = await mergeVideosSimple(
          { ...req, requestId },
          (progress) => { sender.send(VIDEO_PROGRESS_CHANNEL, progress) }
        )
        return result
      } finally {
        if (!videoJobManager.hasJob(requestId)) {
          activeMergeRequestId = null
        } else {
          let ticks = 0
          const checkInterval = setInterval(() => {
            ticks++
            if (!videoJobManager.hasJob(requestId) || ticks > 600) {
              clearInterval(checkInterval)
              activeMergeRequestId = null
            }
          }, 500)
        }
      }
    } catch (err) {
      console.error('[IPC] video:mergeSimple error', err)
      throw err
    }
  })

  // Mute audio
  ipcMain.handle('video:muteAudio', async (event, req: MuteVideoAudioRequest) => {
    const sender = event.sender
    try {
      const proceed = await confirmResourcesForVideoJob('mute', req.outputDir)
      if (!proceed) {
        return { requestId: '', outputPaths: [], success: false, error: 'Job đã bị hủy sau cảnh báo tài nguyên.', processed: 0, failed: 0 }
      }

      const requestId = req.requestId || randomUUID()
      activeMuteRequestId = requestId
      try {
        const result = await muteVideoAudio(
          { ...req, requestId },
          (progress) => { sender.send(VIDEO_PROGRESS_CHANNEL, { ...progress, requestId, mode: 'mute-audio' }) }
        )
        return result
      } finally {
        if (!videoJobManager.hasJob(requestId)) {
          activeMuteRequestId = null
        } else {
          let ticks = 0
          const checkInterval = setInterval(() => {
            ticks++
            if (!videoJobManager.hasJob(requestId) || ticks > 600) {
              clearInterval(checkInterval)
              activeMuteRequestId = null
            }
          }, 500)
        }
      }
    } catch (err: any) {
      console.error('[IPC] video:muteAudio error', err)
      return {
        requestId: req.requestId || randomUUID(), outputPaths: [], success: false,
        error: err?.message || 'Lỗi không xác định khi tắt âm thanh video', processed: 0, failed: 0,
      }
    }
  })

  ipcMain.handle('video:getActiveMuteJobId', async () => activeMuteRequestId)

  // Normalize video
  ipcMain.handle('video:normalize', async (event, req: NormalizeVideoRequest) => {
    const sender = event.sender
    try {
      const proceed = await confirmResourcesForVideoJob('normalize', req.outputDir)
      if (!proceed) {
        return { requestId: '', outputPaths: [], success: false, error: 'Job đã bị hủy sau cảnh báo tài nguyên.', processed: 0, failed: 0, usedGpu: false }
      }

      const requestId = req.requestId || randomUUID()
      activeNormalizeRequestId = requestId
      try {
        const result = await normalizeVideo(
          { ...req, requestId },
          (progress) => {
            if (!sender.isDestroyed()) {
              sender.send(VIDEO_PROGRESS_CHANNEL, { ...progress, requestId, mode: 'normalize' })
            }
          }
        )
        return result
      } finally {
        if (!videoJobManager.hasJob(requestId)) {
          activeNormalizeRequestId = null
        } else {
          let ticks = 0
          const checkInterval = setInterval(() => {
            ticks++
            if (!videoJobManager.hasJob(requestId) || ticks > 600) {
              clearInterval(checkInterval)
              activeNormalizeRequestId = null
            }
          }, 500)
        }
      }
    } catch (err: any) {
      console.error('[IPC] video:normalize error', err)
      return {
        requestId: req.requestId || randomUUID(), outputPaths: [], success: false,
        error: err?.message || 'Lỗi không xác định khi chuẩn hóa video', processed: 0, failed: 0, usedGpu: false,
      }
    }
  })

  ipcMain.handle('video:getActiveNormalizeJobId', async () => {
    if (activeNormalizeRequestId && videoJobManager.hasJob(activeNormalizeRequestId)) {
      return activeNormalizeRequestId
    }
    return null
  })

  // Cancel / query jobs
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
    } catch (err) { console.error('[IPC] video:getActiveMergeJobId error', err); return null }
  })

  ipcMain.handle('video:hasJob', async (_event, requestId: string) => {
    try { return videoJobManager.hasJob(requestId) }
    catch (err) { console.error('[IPC] video:hasJob error', err); return false }
  })

  // Video Pool integration for manual Merge tab
  ipcMain.handle('video:pool-mark-used', async (_event, filePaths: string[]) => {
    try {
      const { generateClipId, markClipsUsed } = await import('../../backend/autopilot/videoPool')
      const fs = await import('fs')
      const path = await import('path')
      const clipIds: string[] = []
      for (const fp of filePaths) {
        try {
          const size = fs.statSync(fp).size
          const id = generateClipId(path.basename(fp), size)
          clipIds.push(id)
        } catch {}
      }
      const dateCode = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const crypto = await import('crypto')
      const fingerprint = crypto.createHash('sha256').update(clipIds.join(',')).digest('hex').slice(0, 16)
      markClipsUsed(clipIds, dateCode, fingerprint)
      return { ok: true, marked: clipIds.length }
    } catch (err: any) {
      console.error('[IPC] video:pool-mark-used error', err)
      return { ok: false, error: err?.message }
    }
  })

  ipcMain.handle('video:pool-pick-lru', async (_event, folderPath: string, count: number) => {
    try {
      const { pickClipsLRU } = await import('../../backend/autopilot/videoPool')
      const fs = await import('fs')
      const path = await import('path')
      const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v'])
      const files = fs.readdirSync(folderPath)
        .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
        .map(f => path.join(folderPath, f))
      const result = pickClipsLRU(files, count)
      return { ok: true, filePaths: result.filePaths, reusedCount: result.reusedCount, totalAvailable: result.totalAvailable }
    } catch (err: any) {
      console.error('[IPC] video:pool-pick-lru error', err)
      return { ok: false, error: err?.message, filePaths: [] }
    }
  })
}

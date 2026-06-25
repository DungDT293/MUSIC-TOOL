/**
 * videoFinalExportHandlers.ts
 * IPC handlers: video:final-export:*
 */

import { ipcMain, BrowserWindow, type WebContents } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'crypto'
import { exportFinalVideo, scanAudioSource, scanVideoSource, scanImageSource } from '../../backend/video/finalExport'
import { videoJobManager } from '../../backend/video/videoJobManager'
import { jobQueue } from '../../backend/jobQueue/jobQueue'
import {
  VIDEO_FINAL_EXPORT_DONE,
  VIDEO_FINAL_EXPORT_ERROR,
  VIDEO_FINAL_EXPORT_PROGRESS,
  VIDEO_FINAL_EXPORT_REQUEST,
  type FinalExportRequestPayload,
  type FinalExportProgressPayload,
  type FinalExportDonePayload,
  type FinalExportErrorPayload,
} from '../../shared/videoFinalExportChannels'
import { getOrInitAuthState, isValidAbsolutePath } from '../authState'
import { confirmResourcesForVideoJob } from './systemHandlers'
import { getLicenseServerBase } from '../../backend/licenseServerConfig'
import { FinalExportRequestPayloadSchema } from '../../shared/ipcSchemas'

const finalExportJobHandles = new Map<string, { cancel: () => Promise<void> }>()

function sendIfAlive(webContents: WebContents, channel: string, payload: unknown): boolean {
  if (webContents.isDestroyed()) return false
  webContents.send(channel, payload)
  return true
}

async function trackVideoExport(
  status: 'success' | 'failed',
  errorMessage?: string,
  videoFile?: string,
  durationSec?: number
) {
  try {
    const authState = await getOrInitAuthState()
    if (!authState.username || !authState.machineId) {
      console.log('[Video Export Tracking] Skipping - user not authenticated')
      return
    }

    let fileSize: number | null = null
    let exportFormat: string | null = null
    if (videoFile) {
      try {
        const stats = await fsp.stat(videoFile)
        fileSize = stats.size
        const ext = path.extname(videoFile).toLowerCase()
        exportFormat = ext ? ext.substring(1) : null
      } catch (err) {
        console.warn('[Video Export Tracking] Failed to get file stats:', err)
      }
    }

    const trackingPayload = {
      username: authState.username,
      machine_id: authState.machineId,
      status,
      error_message: errorMessage || null,
      video_duration: durationSec ? Math.round(durationSec) : null,
      file_size: fileSize,
      export_format: exportFormat,
    }

    const LICENSE_SERVER = getLicenseServerBase()
    const response = await fetch(`${LICENSE_SERVER}/api/video/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trackingPayload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.warn('[Video Export Tracking] Failed to track export:', response.status, errorText)
    } else {
      console.log('[Video Export Tracking] Successfully tracked video export:', status)
    }
  } catch (error: any) {
    console.warn('[Video Export Tracking] Error:', error.message)
  }
}

export function registerVideoFinalExportHandlers(getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle('video:final-export:scan-audio', async (_event, payload) => {
    if (payload?.path && !isValidAbsolutePath(payload.path)) {
      throw new Error('Invalid audio source path')
    }
    try { return await scanAudioSource(payload) }
    catch (err: any) { throw new Error(err?.message || 'Scan audio source failed') }
  })

  ipcMain.handle('video:final-export:scan-video', async (_event, payload) => {
    if (payload?.path && !isValidAbsolutePath(payload.path)) {
      throw new Error('Invalid video source path')
    }
    try { return await scanVideoSource(payload) }
    catch (err: any) { throw new Error(err?.message || 'Scan video source failed') }
  })

  ipcMain.handle('video:final-export:scan-image', async (_event, payload) => {
    if (payload?.path && !isValidAbsolutePath(payload.path)) {
      throw new Error('Invalid image source path')
    }
    try { return await scanImageSource(payload) }
    catch (err: any) { throw new Error(err?.message || 'Scan image source failed') }
  })

  ipcMain.on(VIDEO_FINAL_EXPORT_REQUEST, (_event, rawPayload: FinalExportRequestPayload) => {
    void (async () => {
      const parseResult = FinalExportRequestPayloadSchema.safeParse(rawPayload)
      const payload = (parseResult.success ? parseResult.data : rawPayload) as FinalExportRequestPayload
      const requestId = payload.requestId || randomUUID()
      try {
        if (!parseResult.success) {
          const detail = parseResult.error.issues.map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`).join('; ')
          const mainWindow = getMainWindow()
          if (mainWindow && !mainWindow.isDestroyed()) {
            sendIfAlive(mainWindow.webContents, VIDEO_FINAL_EXPORT_ERROR, {
              requestId,
              error: `Payload xuất video không hợp lệ: ${detail}`,
              message: `Payload xuất video không hợp lệ: ${detail}`,
            } satisfies FinalExportErrorPayload)
          }
          return
        }
        const mainWindow = getMainWindow()
        if (!mainWindow || mainWindow.isDestroyed()) {
          console.error('[IPC] Main window not available for final export')
          return
        }

        if (!payload.outputFolder || !isValidAbsolutePath(payload.outputFolder)) {
          sendIfAlive(mainWindow.webContents, VIDEO_FINAL_EXPORT_ERROR, {
            requestId,
            error: 'Đường dẫn thư mục xuất video không hợp lệ.',
            message: 'Đường dẫn thư mục xuất video không hợp lệ.',
          } satisfies FinalExportErrorPayload)
          return
        }

        const sender = mainWindow.webContents
        const existingJobs = jobQueue.getJobs()
        const runningFinalExport = existingJobs.find(
          (job) => job.type === 'video:final-export' && (job.status === 'running' || job.status === 'pending')
        )
        if (runningFinalExport) {
          console.warn(`[IPC] Rejecting final export request: job ${runningFinalExport.id} is already running`)
          sendIfAlive(sender, VIDEO_FINAL_EXPORT_ERROR, {
            requestId,
            error: 'Đã có một quy trình xuất video đang chạy. Vui lòng đợi hoàn thành hoặc hủy trước khi bắt đầu quy trình mới.',
            message: 'Đã có một quy trình xuất video đang chạy. Vui lòng đợi hoàn thành hoặc hủy trước khi bắt đầu quy trình mới.',
          } satisfies FinalExportErrorPayload)
          return
        }

        const proceed = await confirmResourcesForVideoJob('final-export', payload.outputFolder)
        if (!proceed) {
          sendIfAlive(sender, VIDEO_FINAL_EXPORT_ERROR, {
            requestId,
            error: 'Người dùng đã hủy xuất video sau cảnh báo tài nguyên.',
            message: 'Người dùng đã hủy xuất video sau cảnh báo tài nguyên.',
          } satisfies FinalExportErrorPayload)
          return
        }

        const emitter = {
          progress: (progressPayload: FinalExportProgressPayload) => {
            sendIfAlive(sender, VIDEO_FINAL_EXPORT_PROGRESS, progressPayload)
          },
          done: async (donePayload: FinalExportDonePayload) => {
            finalExportJobHandles.delete(requestId)
            sendIfAlive(sender, VIDEO_FINAL_EXPORT_DONE, donePayload)
            if (donePayload.outputs && donePayload.outputs.length > 0) {
              for (const output of donePayload.outputs) {
                await trackVideoExport('success', undefined, output.videoFile, output.durationSec)
              }
            }
          },
          error: async (errorPayload: FinalExportErrorPayload) => {
            finalExportJobHandles.delete(requestId)
            sendIfAlive(sender, VIDEO_FINAL_EXPORT_ERROR, errorPayload)
            await trackVideoExport('failed', errorPayload.message || errorPayload.error)
          },
        }

        const jobHandle = jobQueue.enqueue({
          type: 'video:final-export',
          payload: {
            requestId,
            audioCount: payload.audioSource?.type === 'folder' ? 0 : (payload.audioSource?.paths?.length ?? 0),
            videoCount: payload.videoSource?.type === 'folder' ? 0 : (payload.videoSource?.paths?.length ?? 0),
          },
          // FIX M14: Kill the FFmpeg process when the job is cancelled from UI.
          // Without this, jobQueue.cancel() only aborts the AbortController but the
          // FFmpeg child process spawned by exportFinalVideo() continues running in
          // the background, consuming CPU/disk until it finishes on its own.
          onCancel: () => {
            videoJobManager.cancelJob(requestId)
          },
          task: async (ctx) => {
            try {
              await exportFinalVideo({ ...payload, requestId: requestId || ctx.jobId }, emitter)
              return { success: true }
            } catch (error: any) {
              console.error('[IPC] Final export error:', error)
              await emitter.error({
                requestId: requestId || ctx.jobId,
                error: error?.message || 'Xuất video thất bại.',
                message: error?.message,
              })
              return { success: false, error: error?.message }
            }
          },
        })

        finalExportJobHandles.set(requestId, jobHandle)
        jobHandle.result.catch((err) => {
          console.error('[IPC] Final export job failed:', err)
          finalExportJobHandles.delete(requestId)
        })
      } catch (err: any) {
        console.error('[IPC] VIDEO_FINAL_EXPORT_REQUEST unhandled error:', err)
        const mainWindow = getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          sendIfAlive(mainWindow.webContents, VIDEO_FINAL_EXPORT_ERROR, {
            requestId,
            error: err?.message || 'Lỗi không xác định khi khởi tạo xuất video.',
            message: err?.message,
          } satisfies FinalExportErrorPayload)
        }
      }
    })()
  })

  ipcMain.handle('video:final-export:cancel', async (_event, requestId: string) => {
    try {
      const jobHandle = finalExportJobHandles.get(requestId)
      if (jobHandle) {
        await jobHandle.cancel()
        finalExportJobHandles.delete(requestId)
      }
      videoJobManager.cancelJob(requestId)
      return { success: true }
    } catch (err: any) {
      console.error('[IPC] Cancel final export error:', err)
      return { success: false, error: String(err) }
    }
  })
}

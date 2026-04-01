/**
 * videoFinalExportHandlers.ts
 * IPC handlers: video:final-export:*
 */

import { ipcMain, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'crypto'
import { exportFinalVideo, scanAudioSource, scanVideoSource } from '../../backend/video/finalExport'
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
import { getOrInitAuthState } from '../authState'
import { confirmResourcesForVideoJob } from './systemHandlers'

// Map: requestId → jobHandle (để cancel)
const finalExportJobHandles = new Map<string, { cancel: () => Promise<void> }>()

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
    if (videoFile && fs.existsSync(videoFile)) {
      try {
        const stats = fs.statSync(videoFile)
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

    const LICENSE_SERVER = process.env.LICENSE_SERVER_BASE || 'https://license-server.dungdong333.workers.dev'
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
  // Scan helpers
  ipcMain.handle('video:final-export:scan-audio', async (_event, payload) => {
    try { return await scanAudioSource(payload) }
    catch (err: any) { throw new Error(err?.message || 'Scan audio source failed') }
  })

  ipcMain.handle('video:final-export:scan-video', async (_event, payload) => {
    try { return await scanVideoSource(payload) }
    catch (err: any) { throw new Error(err?.message || 'Scan video source failed') }
  })

  // Final export request (ipcMain.on — renderer dùng ipcRenderer.send)
  ipcMain.on(VIDEO_FINAL_EXPORT_REQUEST, (_event, payload: FinalExportRequestPayload) => {
    void (async () => {
      try {
        const mainWindow = getMainWindow()
        if (!mainWindow || mainWindow.isDestroyed()) {
          console.error('[IPC] Main window not available for final export')
          return
        }

        const sender = mainWindow.webContents
        const requestId = payload.requestId || randomUUID()

        // Kiểm tra job đang chạy
        const existingJobs = jobQueue.getJobs()
        const runningFinalExport = existingJobs.find(
          (job) => job.type === 'video:final-export' && (job.status === 'running' || job.status === 'pending')
        )
        if (runningFinalExport) {
          console.warn(`[IPC] Rejecting final export request: job ${runningFinalExport.id} is already running`)
          sender.send(VIDEO_FINAL_EXPORT_ERROR, {
            requestId,
            error: 'Đã có một quy trình xuất video đang chạy. Vui lòng đợi hoàn thành hoặc hủy trước khi bắt đầu quy trình mới.',
            message: 'Đã có một quy trình xuất video đang chạy. Vui lòng đợi hoàn thành hoặc hủy trước khi bắt đầu quy trình mới.',
          } satisfies FinalExportErrorPayload)
          return
        }

        const proceed = await confirmResourcesForVideoJob('final-export', payload.outputFolder)
        if (!proceed) {
          sender.send(VIDEO_FINAL_EXPORT_ERROR, {
            requestId,
            error: 'Người dùng đã hủy xuất video sau cảnh báo tài nguyên.',
            message: 'Người dùng đã hủy xuất video sau cảnh báo tài nguyên.',
          } satisfies FinalExportErrorPayload)
          return
        }

        const emitter = {
          progress: (progressPayload: FinalExportProgressPayload) => {
            sender.send(VIDEO_FINAL_EXPORT_PROGRESS, progressPayload)
          },
          done: async (donePayload: FinalExportDonePayload) => {
            finalExportJobHandles.delete(requestId)
            sender.send(VIDEO_FINAL_EXPORT_DONE, donePayload)
            if (donePayload.outputs && donePayload.outputs.length > 0) {
              for (const output of donePayload.outputs) {
                await trackVideoExport('success', undefined, output.videoFile, output.durationSec)
              }
            }
          },
          error: async (errorPayload: FinalExportErrorPayload) => {
            finalExportJobHandles.delete(requestId)
            sender.send(VIDEO_FINAL_EXPORT_ERROR, errorPayload)
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
          task: async (ctx) => {
            try {
              await exportFinalVideo({ ...payload, requestId: requestId || ctx.jobId }, emitter)
              return { success: true }
            } catch (error: any) {
              console.error('[IPC] Final export error:', error)
              emitter.error({
                requestId: requestId || ctx.jobId,
                error: error?.message || 'Xuất video thất bại.',
                message: error?.message,
              })
              throw error
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
          mainWindow.webContents.send(VIDEO_FINAL_EXPORT_ERROR, {
            requestId: (payload as any)?.requestId || '',
            error: err?.message || 'Lỗi không xác định khi khởi tạo xuất video.',
            message: err?.message,
          } satisfies FinalExportErrorPayload)
        }
      }
    })()
  })

  // Cancel final export
  ipcMain.handle('video:final-export:cancel', async (_event, requestId: string) => {
    try {
      const jobHandle = finalExportJobHandles.get(requestId)
      if (jobHandle) {
        await jobHandle.cancel()
        finalExportJobHandles.delete(requestId)
      }
      videoJobManager.cancelAll()
      videoJobManager.cancelJob(requestId)
      return { success: true }
    } catch (err: any) {
      console.error('[IPC] Cancel final export error:', err)
      return { success: false, error: String(err) }
    }
  })
}

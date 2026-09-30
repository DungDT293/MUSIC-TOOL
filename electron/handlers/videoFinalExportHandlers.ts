/**
 * videoFinalExportHandlers.ts
 * IPC handlers: video:final-export:*
 */

import { ipcMain, BrowserWindow, type WebContents } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { exportFinalVideo, scanAudioSource, scanVideoSource, scanImageSource } from '../../backend/video/finalExport'
import { videoJobManager } from '../../backend/video/videoJobManager'
import { jobQueue } from '../../backend/jobQueue/jobQueue'
import {
  VIDEO_FINAL_EXPORT_DONE,
  VIDEO_FINAL_EXPORT_ERROR,
  VIDEO_FINAL_EXPORT_PROGRESS,
  VIDEO_FINAL_EXPORT_REQUEST,
  VIDEO_FINAL_EXPORT_SCAN_AUDIO,
  VIDEO_FINAL_EXPORT_SCAN_VIDEO,
  VIDEO_FINAL_EXPORT_SCAN_IMAGE,
  VIDEO_FINAL_EXPORT_CANCEL,
  type FinalExportRequestPayload,
  type FinalExportProgressPayload,
  type FinalExportDonePayload,
  type FinalExportErrorPayload,
} from '../../shared/videoFinalExportChannels'
import { getOrInitAuthState, isAllowedAuthState, isValidAbsolutePath } from '../authState'
import { confirmResourcesForVideoJob } from './systemHandlers'
import { getLicenseServerBase } from '../../backend/licenseServerConfig'
import {
  FinalExportRequestPayloadSchema,
  FinalExportScanAudioSchema,
  FinalExportScanImageSchema,
  FinalExportScanVideoSchema,
} from '../../shared/ipcSchemas'

const finalExportJobHandles = new Map<string, { cancel: () => Promise<void> }>()
let activeFinalExportOwner: string | null = null

function sendIfAlive(webContents: WebContents, channel: string, payload: unknown): boolean {
  if (webContents.isDestroyed()) return false
  webContents.send(channel, payload)
  return true
}

function assertValidSourcePaths(source: { path?: string; paths?: string[] } | undefined, label: string): void {
  if (!source) return
  const paths = [source.path, ...(source.paths ?? [])].filter((p): p is string => !!p)
  const invalid = paths.find((p) => !isValidAbsolutePath(p))
  if (invalid) throw new Error(`Invalid ${label} path: ${invalid}`)
}

async function requireAllowedAuth(): Promise<void> {
  const state = await getOrInitAuthState()
  if (!isAllowedAuthState(state)) {
    throw new Error('Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại trước khi sử dụng chức năng này.')
  }
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
  ipcMain.handle(VIDEO_FINAL_EXPORT_SCAN_AUDIO, async (_event, rawPayload) => {
    await requireAllowedAuth()
    const parsed = FinalExportScanAudioSchema.parse(rawPayload)
    assertValidSourcePaths(parsed.audioSource, 'audio source')
    try { return await scanAudioSource(parsed) }
    catch (err: any) { throw new Error(err?.message || 'Scan audio source failed') }
  })


  ipcMain.handle(VIDEO_FINAL_EXPORT_SCAN_VIDEO, async (_event, rawPayload) => {
    await requireAllowedAuth()
    const parsed = FinalExportScanVideoSchema.parse(rawPayload)
    assertValidSourcePaths(parsed.videoSource, 'video source')
    try { return await scanVideoSource(parsed) }
    catch (err: any) { throw new Error(err?.message || 'Scan video source failed') }
  })

  ipcMain.handle(VIDEO_FINAL_EXPORT_SCAN_IMAGE, async (_event, rawPayload) => {
    await requireAllowedAuth()
    const parsed = FinalExportScanImageSchema.parse(rawPayload)
    assertValidSourcePaths(parsed.imageSource, 'image source')
    try { return await scanImageSource(parsed) }
    catch (err: any) { throw new Error(err?.message || 'Scan image source failed') }
  })

  ipcMain.on(VIDEO_FINAL_EXPORT_REQUEST, (event, rawPayload: FinalExportRequestPayload) => {
    void (async () => {
      const parseResult = FinalExportRequestPayloadSchema.safeParse(rawPayload)
      const requestId = typeof rawPayload?.requestId === 'string' ? rawPayload.requestId.trim() : ''
      try {
        if (!parseResult.success) {
          const detail = parseResult.error.issues.map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`).join('; ')
          const recipient = event.sender.isDestroyed() ? getMainWindow()?.webContents : event.sender
          if (recipient && !recipient.isDestroyed()) {
            sendIfAlive(recipient, VIDEO_FINAL_EXPORT_ERROR, {
              requestId,
              error: `Payload xuất video không hợp lệ: ${detail}`,
              message: `Payload xuất video không hợp lệ: ${detail}`,
            } satisfies FinalExportErrorPayload)
          }
          return
        }
        const payload = parseResult.data as FinalExportRequestPayload
        try {
          await requireAllowedAuth()
        } catch (authError: any) {
          const recipient = event.sender.isDestroyed() ? getMainWindow()?.webContents : event.sender
          if (recipient && !recipient.isDestroyed()) {
            const message = authError?.message || 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại trước khi xuất video.'
            sendIfAlive(recipient, VIDEO_FINAL_EXPORT_ERROR, {
              requestId,
              error: message,
              message,
            } satisfies FinalExportErrorPayload)
          }
          return
        }
        if (activeFinalExportOwner) {
          const mainWindow = getMainWindow()
          if (mainWindow && !mainWindow.isDestroyed()) {
            sendIfAlive(mainWindow.webContents, VIDEO_FINAL_EXPORT_ERROR, {
              requestId,
              error: 'Đã có một quy trình xuất video đang chạy. Vui lòng đợi hoàn thành hoặc hủy trước khi bắt đầu quy trình mới.',
              message: 'Đã có một quy trình xuất video đang chạy. Vui lòng đợi hoàn thành hoặc hủy trước khi bắt đầu quy trình mới.',
            } satisfies FinalExportErrorPayload)
          }
          return
        }
        activeFinalExportOwner = requestId
        const mainWindow = getMainWindow()
        if (!mainWindow || mainWindow.isDestroyed()) {
          console.error('[IPC] Main window not available for final export')
          activeFinalExportOwner = null
          return
        }

        if (!payload.outputFolder || !isValidAbsolutePath(payload.outputFolder)) {
          sendIfAlive(mainWindow.webContents, VIDEO_FINAL_EXPORT_ERROR, {
            requestId,
            error: 'Đường dẫn thư mục xuất video không hợp lệ.',
            message: 'Đường dẫn thư mục xuất video không hợp lệ.',
          } satisfies FinalExportErrorPayload)
          activeFinalExportOwner = null
          return
        }

        try {
          assertValidSourcePaths(payload.audioSource, 'audio source')
          assertValidSourcePaths(payload.videoSource, 'video source')
          assertValidSourcePaths(payload.imageSource, 'image source')
          assertValidSourcePaths(payload.priorityVideoSource, 'priority video source')
          if (payload.chromaKeyOverlay?.videoPath && !isValidAbsolutePath(payload.chromaKeyOverlay.videoPath)) {
            throw new Error('Invalid chroma key video path')
          }
          const invalidEndingPath = payload.endingAudio?.paths?.find((p) => !isValidAbsolutePath(p))
          if (invalidEndingPath) throw new Error(`Invalid ending audio path: ${invalidEndingPath}`)
        } catch (pathErr: any) {
          sendIfAlive(mainWindow.webContents, VIDEO_FINAL_EXPORT_ERROR, {
            requestId,
            error: pathErr?.message || 'Đường dẫn nguồn không hợp lệ.',
            message: pathErr?.message || 'Đường dẫn nguồn không hợp lệ.',
          } satisfies FinalExportErrorPayload)
          activeFinalExportOwner = null
          return
        }

        const sender = event.sender.isDestroyed() ? mainWindow.webContents : event.sender
        let queuedJobHandle: { cancel: () => Promise<void> } | null = null
        const cancelIfOwnerDestroyed = () => {
          if (queuedJobHandle) {
            void queuedJobHandle.cancel()
          } else if (activeFinalExportOwner === requestId) {
            activeFinalExportOwner = null
            videoJobManager.cancelJob(requestId)
          }
        }
        sender.once('destroyed', cancelIfOwnerDestroyed)
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
          activeFinalExportOwner = null
          sender.removeListener('destroyed', cancelIfOwnerDestroyed)
          return
        }

        const proceed = await confirmResourcesForVideoJob('final-export', payload.outputFolder)
        try {
          await requireAllowedAuth()
        } catch (authError: any) {
          if (activeFinalExportOwner === requestId) activeFinalExportOwner = null
          sender.removeListener('destroyed', cancelIfOwnerDestroyed)
          sendIfAlive(sender, VIDEO_FINAL_EXPORT_ERROR, {
            requestId,
            error: authError?.message || 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại trước khi xuất video.',
            message: authError?.message || 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại trước khi xuất video.',
          } satisfies FinalExportErrorPayload)
          return
        }
        if (activeFinalExportOwner !== requestId || sender.isDestroyed()) {
          if (activeFinalExportOwner === requestId) activeFinalExportOwner = null
          sender.removeListener('destroyed', cancelIfOwnerDestroyed)
          return
        }
        if (!proceed) {
          sendIfAlive(sender, VIDEO_FINAL_EXPORT_ERROR, {
            requestId,
            error: 'Người dùng đã hủy xuất video sau cảnh báo tài nguyên.',
            message: 'Người dùng đã hủy xuất video sau cảnh báo tài nguyên.',
          } satisfies FinalExportErrorPayload)
          activeFinalExportOwner = null
          sender.removeListener('destroyed', cancelIfOwnerDestroyed)
          return
        }

        const emitter = {
          progress: (progressPayload: FinalExportProgressPayload) => {
            sendIfAlive(sender, VIDEO_FINAL_EXPORT_PROGRESS, progressPayload)
          },
          done: async (donePayload: FinalExportDonePayload) => {
            sendIfAlive(sender, VIDEO_FINAL_EXPORT_DONE, donePayload)
            if (donePayload.outputs && donePayload.outputs.length > 0) {
              for (const output of donePayload.outputs) {
                await trackVideoExport('success', undefined, output.videoFile, output.durationSec)
              }
            }
          },
          error: async (errorPayload: FinalExportErrorPayload) => {
            sendIfAlive(sender, VIDEO_FINAL_EXPORT_ERROR, errorPayload)
            await trackVideoExport('failed', errorPayload.message || errorPayload.error)
          },
        }

        if (activeFinalExportOwner !== requestId) return

        const jobHandle = jobQueue.enqueue({
          type: 'video:final-export',
          payload: {
            requestId,
            audioCount: payload.audioSource?.type === 'folder' ? 0 : (payload.audioSource?.paths?.length ?? 0),
            videoCount: payload.videoSource?.type === 'folder' ? 0 : (payload.videoSource?.paths?.length ?? 0),
          },
          onCancel: () => videoJobManager.cancelJob(requestId),
          task: async (ctx) => {
            if (ctx.signal.aborted) throw new Error('Job cancelled before starting')
            return exportFinalVideo({ ...payload, requestId }, emitter)
          },
        })

        queuedJobHandle = jobHandle
        finalExportJobHandles.set(requestId, jobHandle)
        jobHandle.result.then(
          () => {
            if (activeFinalExportOwner === requestId) activeFinalExportOwner = null
            finalExportJobHandles.delete(requestId)
            sender.removeListener('destroyed', cancelIfOwnerDestroyed)
          },
          (error: any) => {
            console.error('[IPC] Final export job failed:', error)
            if (activeFinalExportOwner === requestId) activeFinalExportOwner = null
            finalExportJobHandles.delete(requestId)
            sender.removeListener('destroyed', cancelIfOwnerDestroyed)
          },
        )
        // Listener was attached before resource confirmation; no duplicate listener here.
      } catch (err: any) {
        console.error('[IPC] VIDEO_FINAL_EXPORT_REQUEST unhandled error:', err)
        if (activeFinalExportOwner === requestId) activeFinalExportOwner = null
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

  ipcMain.handle(VIDEO_FINAL_EXPORT_CANCEL, async (_event, requestId: string) => {
    if (typeof requestId !== 'string' || requestId.trim().length === 0) {
      return { success: false, error: 'Final export requestId không hợp lệ.' }
    }
    try {
      const jobHandle = finalExportJobHandles.get(requestId)
      if (jobHandle) {
        await jobHandle.cancel()
        finalExportJobHandles.delete(requestId)
      }
      videoJobManager.cancelJob(requestId)
      if (activeFinalExportOwner === requestId) activeFinalExportOwner = null
      return { success: true }
    } catch (err: any) {
      console.error('[IPC] Cancel final export error:', err)
      return { success: false, error: String(err) }
    }
  })
}

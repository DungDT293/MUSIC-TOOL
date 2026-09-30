import { ipcMain, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { isValidAbsolutePath } from '../authState'
import { createSongNhacFfmpegPipe } from '../../backend/video/songNhacFfmpegPipe'
import {
  SONG_NHAC_EXPORT_CANCEL,
  SONG_NHAC_EXPORT_PROGRESS,
  SONG_NHAC_EXPORT_START,
  type SongNhacExportProgress,
  type SongNhacExportRequest,
  type SongNhacExportResult,
} from '../../shared/songNhacChannels'

const activeExports = new Map<string, { cancel: () => void }>()

function validateRequest(raw: unknown): SongNhacExportRequest {
  if (!raw || typeof raw !== 'object') throw new Error('Song Nhạc payload không hợp lệ.')
  const request = raw as Partial<SongNhacExportRequest>
  if (typeof request.requestId !== 'string' || request.requestId.trim().length === 0) throw new Error('requestId không hợp lệ.')
  if (!isValidAbsolutePath(request.audioPath) || !fs.existsSync(request.audioPath)) throw new Error('Audio path không hợp lệ hoặc không tồn tại.')
  if (!isValidAbsolutePath(request.outputPath)) throw new Error('Output path không hợp lệ.')
  if (path.extname(request.outputPath).toLowerCase() !== '.mp4') throw new Error('Output phải có đuôi .mp4.')
  if (!['neon-tunnel', 'orbit-spectrum', 'pulse-grid'].includes(request.style || '')) throw new Error('Style Song Nhạc không hợp lệ.')
  if (!Number.isInteger(request.width) || request.width < 320 || request.width > 3840) throw new Error('Width Song Nhạc không hợp lệ.')
  if (!Number.isInteger(request.height) || request.height < 180 || request.height > 2160) throw new Error('Height Song Nhạc không hợp lệ.')
  if (!Number.isInteger(request.fps) || request.fps < 12 || request.fps > 60) throw new Error('FPS Song Nhạc không hợp lệ.')
  return { ...request, requestId: request.requestId.trim() } as SongNhacExportRequest
}

export function registerSongNhacHandlers(_getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(SONG_NHAC_EXPORT_START, async (event, rawRequest): Promise<SongNhacExportResult> => {
    let requestId = ''
    try {
      const request = validateRequest(rawRequest)
      requestId = request.requestId
      if (activeExports.size > 0) throw new Error('Đã có Song Nhạc export đang chạy.')
      if (fs.existsSync(request.outputPath)) throw new Error('Output đã tồn tại. Chọn file khác để tránh ghi đè.')

      const sender = event.sender
      const pipe = createSongNhacFfmpegPipe(request)
      activeExports.set(requestId, pipe)
      const sendProgress = (progress: SongNhacExportProgress) => {
        if (!sender.isDestroyed()) sender.send(SONG_NHAC_EXPORT_PROGRESS, progress)
      }
      await pipe.run(sendProgress)
      return { success: true, requestId, outputPath: request.outputPath }
    } catch (error) {
      return { success: false, requestId, error: error instanceof Error ? error.message : String(error) }
    } finally {
      if (requestId) activeExports.delete(requestId)
    }
  })

  ipcMain.handle(SONG_NHAC_EXPORT_CANCEL, async (_event, rawRequestId: unknown) => {
    const requestId = typeof rawRequestId === 'string' ? rawRequestId.trim() : ''
    if (!requestId) return { success: false, error: 'requestId không hợp lệ.' }
    const active = activeExports.get(requestId)
    if (!active) return { success: false, error: 'Không tìm thấy Song Nhạc export đang chạy.' }
    active.cancel()
    return { success: true }
  })

}

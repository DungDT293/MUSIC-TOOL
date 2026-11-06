import { ipcMain, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { isValidAbsolutePath } from '../authState'
import { getFfmpegPaths } from '../../backend/ffmpeg/config'
import { createSongNhacFfmpegPipe } from '../../backend/video/songNhacFfmpegPipe'
import {
  SONG_NHAC_EXPORT_CANCEL,
  SONG_NHAC_EXPORT_PROGRESS,
  SONG_NHAC_EXPORT_START,
  SONG_NHAC_FRAMES_BEGIN,
  SONG_NHAC_FRAMES_CANCEL,
  SONG_NHAC_FRAMES_CHUNK,
  SONG_NHAC_FRAMES_END,
  SONG_NHAC_FRAMES_FLUSH,
  type SongNhacExportProgress,
  type SongNhacExportRequest,
  type SongNhacExportResult,
  type SongNhacFramesRequest,
  type SongNhacFramesResult,
} from '../../shared/songNhacChannels'

const activeExports = new Map<string, { cancel: () => void }>()

interface FrameSession {
  request: SongNhacFramesRequest
  stream: fs.WriteStream
  tempPath: string
  receivedBytes: number
  cancelled: boolean
}

const frameSessions = new Map<string, FrameSession>()

function validateRequest(raw: unknown): SongNhacExportRequest {
  if (!raw || typeof raw !== 'object') throw new Error('Song Nhạc payload không hợp lệ.')
  const request = raw as Partial<SongNhacExportRequest>
  if (typeof request.requestId !== 'string' || request.requestId.trim().length === 0) throw new Error('requestId không hợp lệ.')
  if (!isValidAbsolutePath(request.audioPath) || !fs.existsSync(request.audioPath)) throw new Error('Audio path không hợp lệ hoặc không tồn tại.')
  if (!isValidAbsolutePath(request.outputPath)) throw new Error('Output path không hợp lệ.')
  if (path.extname(request.outputPath).toLowerCase() !== '.mp4') throw new Error('Output phải có đuôi .mp4.')
  if (!['avee-circle', 'neon-tunnel', 'orbit-spectrum', 'pulse-grid'].includes(request.style || '')) throw new Error('Style Song Nhạc không hợp lệ.')
  const width = Number(request.width)
  const height = Number(request.height)
  const fps = Number(request.fps)
  if (!Number.isInteger(width) || width < 320 || width > 3840) throw new Error('Width Song Nhạc không hợp lệ.')
  if (!Number.isInteger(height) || height < 180 || height > 2160) throw new Error('Height Song Nhạc không hợp lệ.')
  if (!Number.isInteger(fps) || fps < 12 || fps > 60) throw new Error('FPS Song Nhạc không hợp lệ.')
  return { ...request, requestId: request.requestId.trim(), width, height, fps } as SongNhacExportRequest
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

  registerFrameHandlers()
}

// ── Frame-accurate export ──────────────────────────────────────────────────────
// The renderer renders and encodes every frame (WebCodecs H.264, Annex-B) and
// streams the chunks here. Main only appends bytes and muxes with the audio, so
// the exported file is exactly the preview timeline.

function validateFramesRequest(raw: unknown): SongNhacFramesRequest {
  if (!raw || typeof raw !== 'object') throw new Error('Payload Song Nhạc không hợp lệ.')
  const request = raw as Partial<SongNhacFramesRequest>
  if (typeof request.requestId !== 'string' || !request.requestId.trim()) throw new Error('requestId không hợp lệ.')
  if (!isValidAbsolutePath(request.audioPath) || !fs.existsSync(request.audioPath)) throw new Error('Audio path không hợp lệ hoặc không tồn tại.')
  if (!isValidAbsolutePath(request.outputPath)) throw new Error('Output path không hợp lệ.')
  if (path.extname(request.outputPath).toLowerCase() !== '.mp4') throw new Error('Output phải có đuôi .mp4.')
  const width = Number(request.width)
  const height = Number(request.height)
  const fps = Number(request.fps)
  const totalFrames = Number(request.totalFrames)
  if (!Number.isInteger(width) || width < 320 || width > 3840) throw new Error('Width không hợp lệ.')
  if (!Number.isInteger(height) || height < 180 || height > 2160) throw new Error('Height không hợp lệ.')
  if (!Number.isInteger(fps) || fps < 12 || fps > 60) throw new Error('FPS không hợp lệ.')
  if (!Number.isInteger(totalFrames) || totalFrames < 1) throw new Error('totalFrames không hợp lệ.')
  const startSec = request.startSec === undefined ? undefined : Number(request.startSec)
  const durationSec = request.durationSec === undefined ? undefined : Number(request.durationSec)
  if (startSec !== undefined && (!Number.isFinite(startSec) || startSec < 0)) throw new Error('startSec không hợp lệ.')
  if (durationSec !== undefined && (!Number.isFinite(durationSec) || durationSec <= 0)) throw new Error('durationSec không hợp lệ.')
  return { ...request, requestId: request.requestId.trim(), width, height, fps, totalFrames, startSec, durationSec } as SongNhacFramesRequest
}

function muxFrames(session: FrameSession): Promise<void> {
  const { request, tempPath } = session
  const { ffmpeg } = getFfmpegPaths()
  const trim = request.startSec && request.startSec > 0 ? ['-ss', String(request.startSec)] : []
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'h264', '-framerate', String(request.fps), '-i', tempPath,
    ...trim,
    '-i', request.audioPath,
    ...(request.durationSec && request.durationSec > 0 ? ['-t', String(request.durationSec)] : []),
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy',
    // Tag the colour space explicitly: WebCodecs writes yuv420p but no colr box, and
    // players then guess (usually bt709, but not always).
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart',
    request.outputPath,
  ]
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (session.cancelled) return reject(new Error('Đã hủy xuất video.'))
      if (code === 0) return resolve()
      reject(new Error(stderr.trim().slice(-800) || `FFmpeg mux lỗi (code ${code}).`))
    })
  })
}

/** Fails loudly when the muxed file has no audio track: a silent export is worse than an error. */
async function assertMuxedAudio(outputPath: string): Promise<void> {
  const { ffprobe } = getFfmpegPaths()
  const streams = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      ffprobe,
      ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', outputPath],
      { windowsHide: true },
    )
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8')
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(out.trim())
      else reject(new Error(err.trim().slice(-400) || `FFprobe lỗi (code ${code}).`))
    })
  })
  if (!streams) {
    throw new Error('Video xuất ra không có âm thanh. Hãy thử lại; nếu vẫn lỗi, kiểm tra file audio nguồn.')
  }
}

function cleanupSession(requestId: string): void {
  const session = frameSessions.get(requestId)
  if (!session) return
  frameSessions.delete(requestId)
  try {
    session.stream.close()
  } catch {
    // already closed
  }
  fs.promises.unlink(session.tempPath).catch(() => {})
}

function registerFrameHandlers(): void {
  ipcMain.handle(SONG_NHAC_FRAMES_BEGIN, async (_event, raw: unknown): Promise<SongNhacFramesResult> => {
    let requestId = ''
    try {
      const request = validateFramesRequest(raw)
      requestId = request.requestId
      if (frameSessions.size > 0) throw new Error('Đã có Sóng nhạc export đang chạy.')
      if (fs.existsSync(request.outputPath)) throw new Error('Output đã tồn tại. Chọn file khác để tránh ghi đè.')

      const tempPath = `${request.outputPath}.part-${Date.now()}.h264`
      await fs.promises.mkdir(path.dirname(tempPath), { recursive: true })
      const stream = fs.createWriteStream(tempPath, { flags: 'w' })
      await new Promise<void>((resolve, reject) => {
        stream.once('open', () => resolve())
        stream.once('error', reject)
      })
      frameSessions.set(requestId, { request, stream, tempPath, receivedBytes: 0, cancelled: false })
      return { success: true, requestId }
    } catch (error) {
      return { success: false, requestId, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.on(SONG_NHAC_FRAMES_CHUNK, (_event, requestId: unknown, chunk: unknown) => {
    const session = typeof requestId === 'string' ? frameSessions.get(requestId) : undefined
    if (!session || session.cancelled) return
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer)
    if (!buffer.length) return
    session.receivedBytes += buffer.length
    session.stream.write(buffer)
  })

  ipcMain.handle(SONG_NHAC_FRAMES_FLUSH, async (_event, requestId: unknown) => {
    const session = typeof requestId === 'string' ? frameSessions.get(requestId) : undefined
    if (!session) return { success: false }
    // Resolves once the write buffer has drained — this is the backpressure gate the
    // renderer awaits every few dozen chunks.
    if (session.stream.writableNeedDrain) {
      await new Promise<void>((resolve) => session.stream.once('drain', () => resolve()))
    }
    return { success: true, receivedBytes: session.receivedBytes }
  })

  ipcMain.handle(SONG_NHAC_FRAMES_END, async (_event, requestId: unknown): Promise<SongNhacFramesResult> => {
    const id = typeof requestId === 'string' ? requestId : ''
    const session = frameSessions.get(id)
    if (!session) return { success: false, requestId: id, error: 'Không tìm thấy phiên xuất video.' }
    try {
      await new Promise<void>((resolve) => session.stream.end(resolve))
      if (session.receivedBytes === 0) throw new Error('Không nhận được frame nào từ renderer.')
      await muxFrames(session)
      await assertMuxedAudio(session.request.outputPath)
      return { success: true, requestId: id, outputPath: session.request.outputPath }
    } catch (error) {
      return { success: false, requestId: id, error: error instanceof Error ? error.message : String(error) }
    } finally {
      cleanupSession(id)
    }
  })

  ipcMain.handle(SONG_NHAC_FRAMES_CANCEL, async (_event, requestId: unknown) => {
    const id = typeof requestId === 'string' ? requestId : ''
    const session = frameSessions.get(id)
    if (!session) return { success: false }
    session.cancelled = true
    cleanupSession(id)
    return { success: true }
  })
}

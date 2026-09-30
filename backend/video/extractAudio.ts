import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import { probeFile } from '../ffmpeg/probe'
import { videoJobManager } from './videoJobManager'

export type ExtractAudioFormat = 'mp3' | 'wav'

export interface ExtractAudioRequest {
  inputFiles: string[]
  outputDir: string
  audioFormat: ExtractAudioFormat
  mp4Only?: boolean
  requestId?: string
}

export interface ExtractAudioProgress {
  requestId: string
  currentFile?: string
  currentIndex?: number
  totalFiles?: number
  percent?: number
  message?: string
  completed?: boolean
  error?: string
}

export interface ExtractAudioFailure {
  inputPath: string
  fileName: string
  error: string
}

export interface ExtractAudioResult {
  requestId: string
  outputPaths: string[]
  failures: ExtractAudioFailure[]
  success: boolean
  error?: string
  processed: number
  failed: number
}

function finalPathFor(inputPath: string, outputDir: string, format: ExtractAudioFormat, reserved: Set<string>): string {
  const base = path.basename(inputPath, path.extname(inputPath))
  let index = 0
  while (true) {
    const suffix = index === 0 ? '' : `_${index + 1}`
    const candidate = path.join(outputDir, `${base}_audio${suffix}.${format}`)
    if (!reserved.has(candidate.toLowerCase()) && !fs.existsSync(candidate)) {
      reserved.add(candidate.toLowerCase())
      return candidate
    }
    index++
  }
}

async function publishTempFile(
  tempPath: string,
  inputPath: string,
  outputDir: string,
  format: ExtractAudioFormat,
  reserved: Set<string>,
): Promise<string> {
  while (true) {
    const outputPath = finalPathFor(inputPath, outputDir, format, reserved)
    try {
      await fsp.link(tempPath, outputPath)
      return outputPath
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error
    }
  }
}

function isCancelled(requestId: string, signal?: AbortSignal): boolean {
  return !!signal?.aborted || videoJobManager.isCancelled(requestId)
}

async function runExtractionProcess(
  ffmpegPath: string,
  args: string[],
  requestId: string,
  signal: AbortSignal | undefined,
  onProgress: (timeSec: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }) as ChildProcess
    let settled = false
    let stderr = ''
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      error ? reject(error) : resolve()
    }
    const onAbort = () => {
      try { child.kill(process.platform === 'win32' ? 'SIGKILL' : 'SIGTERM') } catch {}
    }

    videoJobManager.registerJob(requestId, child)
    if (isCancelled(requestId, signal)) {
      try { child.kill('SIGKILL') } catch {}
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderr = (stderr + text).slice(-2000)
      const match = text.match(/time=\s*([0-9:.]+)/)
      if (match) {
        const [hours, minutes, seconds] = match[1].split(':').map(Number)
        onProgress(hours * 3600 + minutes * 60 + seconds)
      }
    })
    child.once('error', (error) => finish(error))
    child.once('close', (code) => {
      if (isCancelled(requestId, signal)) return finish(new Error('Đã dừng bởi người dùng'))
      if (code !== 0) return finish(new Error(stderr || `FFmpeg exited with code ${code}`))
      finish()
    })
  })
}

export async function extractAudioBatch(
  req: ExtractAudioRequest,
  onProgress?: (progress: ExtractAudioProgress) => void,
  options?: { signal?: AbortSignal },
): Promise<ExtractAudioResult> {
  const requestId = req.requestId || randomUUID()
  const inputFiles = Array.from(new Set(req.inputFiles || []))
  const outputPaths: string[] = []
  const failures: ExtractAudioFailure[] = []
  const reserved = new Set<string>()
  let processed = 0
  let failed = 0
  let lastError: string | undefined
  let lastPercent = 0

  const emit = (payload: Omit<ExtractAudioProgress, 'requestId'>) => {
    const percent = payload.percent === undefined
      ? undefined
      : Math.max(lastPercent, Math.min(100, payload.percent))
    if (percent !== undefined) lastPercent = percent
    onProgress?.({ requestId, ...payload, ...(percent === undefined ? {} : { percent }) })
  }

  try {
    if (!inputFiles.length) throw new Error('Không có video để tách âm thanh')
    if (!req.outputDir) throw new Error('Thiếu thư mục xuất')
    if (req.mp4Only && !inputFiles.every((filePath) => path.extname(filePath).toLowerCase() === '.mp4')) {
      throw new Error('Chức năng này chỉ nhận file MP4.')
    }

    if (isCancelled(requestId, options?.signal)) throw new Error('Đã dừng bởi người dùng')
    await fsp.mkdir(req.outputDir, { recursive: true })
    const { ffmpeg } = getFfmpegPaths()

    for (let index = 0; index < inputFiles.length; index++) {
      if (isCancelled(requestId, options?.signal)) throw new Error('Đã dừng bởi người dùng')
      const inputPath = inputFiles[index]
      const fileName = path.basename(inputPath)
      const overallProgress = (filePercent: number) => ((index + Math.min(100, Math.max(0, filePercent)) / 100) / inputFiles.length) * 100
      emit({ currentFile: fileName, currentIndex: index + 1, totalFiles: inputFiles.length, percent: overallProgress(0), message: `Đang tách âm thanh ${index + 1}/${inputFiles.length}...` })
      if (isCancelled(requestId, options?.signal)) throw new Error('Đã dừng bởi người dùng')

      let tempPath: string | undefined
      try {
        const info = await probeFile(inputPath, options?.signal, requestId)
        if (req.mp4Only && !info.video) throw new Error('File MP4 không có luồng video.')
        if (!info.audio) throw new Error('Video không có luồng âm thanh')
        tempPath = path.join(req.outputDir, `.${randomUUID()}.tmp.${req.audioFormat}`)
        const codecArgs = req.audioFormat === 'mp3'
          ? ['-c:a', 'libmp3lame', '-b:a', '320k']
          : ['-c:a', 'pcm_s16le']
        await runExtractionProcess(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', inputPath, '-map', '0:a:0', '-vn', ...codecArgs, tempPath], requestId, options?.signal, (timeSec) => {
          const filePercent = info.format.duration > 0 ? Math.min(99, (timeSec / info.format.duration) * 100) : 0
          emit({ currentFile: fileName, currentIndex: index + 1, totalFiles: inputFiles.length, percent: overallProgress(filePercent), message: `Đang tách âm thanh ${index + 1}/${inputFiles.length}...` })
        })
        if (isCancelled(requestId, options?.signal)) throw new Error('Đã dừng bởi người dùng')
        const stat = await fsp.stat(tempPath)
        if (!stat.isFile() || stat.size <= 0) throw new Error('FFmpeg tạo file rỗng')
        if (isCancelled(requestId, options?.signal)) throw new Error('Đã dừng bởi người dùng')
        const outputPath = await publishTempFile(tempPath, inputPath, req.outputDir, req.audioFormat, reserved)
        if (isCancelled(requestId, options?.signal)) {
          await fsp.rm(outputPath, { force: true }).catch(() => {})
          throw new Error('Đã dừng bởi người dùng')
        }
        await fsp.rm(tempPath, { force: true })
        tempPath = undefined
        outputPaths.push(outputPath)
        processed++
        emit({ currentFile: fileName, currentIndex: index + 1, totalFiles: inputFiles.length, percent: ((index + 1) / inputFiles.length) * 100, message: `Đã tách xong ${index + 1}/${inputFiles.length}` })
      } catch (error: any) {
        if (isCancelled(requestId, options?.signal)) throw new Error('Đã dừng bởi người dùng')
        failed++
        lastError = error?.message || String(error)
        failures.push({ inputPath, fileName, error: lastError })
        emit({ currentFile: fileName, currentIndex: index + 1, totalFiles: inputFiles.length, percent: ((index + 1) / inputFiles.length) * 100, message: `Lỗi file: ${fileName}` })
      } finally {
        if (tempPath) await fsp.rm(tempPath, { force: true }).catch(() => {})
      }
    }

    const success = processed > 0 && failed === 0
    emit({ completed: true, percent: 100, message: success ? `Đã tách âm thanh ${processed} video.` : `Đã xử lý ${processed}/${inputFiles.length} video.` })
    videoJobManager.clearCancelled(requestId)
    return { requestId, outputPaths, failures, success, error: success ? undefined : lastError || 'Một số video tách âm thanh thất bại', processed, failed }
  } catch (error: any) {
    const message = error?.message || String(error)
    emit({ error: message, percent: lastPercent })
    return { requestId, outputPaths, failures, success: false, error: message, processed, failed: failed || inputFiles.length - processed }
  } finally {
    videoJobManager.clearCancelled(requestId)
  }
}

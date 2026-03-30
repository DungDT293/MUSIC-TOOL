import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import { validateInputFiles } from './videoUtils'
import { videoJobManager } from './videoJobManager'

export interface MuteVideoAudioRequest {
  inputFiles: string[]
  outputDir: string
  requestId?: string
}

export interface MuteVideoAudioResult {
  requestId: string
  outputPaths: string[]
  success: boolean
  error?: string
  processed: number
  failed: number
}

interface MuteVideoAudioProgressPayload {
  requestId?: string
  currentFile?: string
  currentIndex?: number
  totalFiles?: number
  percent?: number
  message?: string
  error?: string
}

export async function muteVideoAudio(
  req: MuteVideoAudioRequest,
  onProgress?: (progress: MuteVideoAudioProgressPayload) => void
): Promise<MuteVideoAudioResult> {
  const requestId = req.requestId || randomUUID()
  const startTime = Date.now()

  const emitProgress = (partial: MuteVideoAudioProgressPayload) => {
    if (!onProgress) return
    onProgress({
      requestId,
      ...partial,
    })
  }

  try {
    const inputFiles = Array.from(new Set(req.inputFiles || [])).filter((p) => !!p && fs.existsSync(p))

    if (!inputFiles.length) {
      throw new Error('Không có video hợp lệ để tắt âm thanh')
    }

    const outputDir = req.outputDir
    if (!outputDir) {
      throw new Error('Thiếu outputDir')
    }
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // Validate input files (probe nhanh, bỏ qua file lỗi)
    const { valid, invalid } = await validateInputFiles(inputFiles, 8)

    const totalFiles = inputFiles.length
    let processed = 0
    let failed = 0
    let validFailed = 0  // chỉ đếm valid files bị lỗi FFmpeg (không tính invalid)
    const outputPaths: string[] = []
    let lastError: string | undefined

    // Báo các file invalid (nếu có)
    if (invalid.length > 0) {
      const message = `Đã bỏ qua ${invalid.length} video lỗi / hỏng trước khi tắt âm thanh`
      emitProgress({
        currentFile: '',
        currentIndex: 0,
        totalFiles,
        percent: 0,
        message,
      })
      failed += invalid.length
    }

    const validTotal = valid.length  // dùng valid.length cho % progress

    const { ffmpeg } = getFfmpegPaths()

    for (let index = 0; index < valid.length; index++) {
      const fileInfo = valid[index]
      const inputPath = fileInfo.path

      if (videoJobManager.isCancelled(requestId)) {
        throw new Error('Đã dừng bởi người dùng')
      }

      const ext = path.extname(inputPath) || '.mp4'
      const baseName = path.basename(inputPath, ext)
      const outputPath = path.join(outputDir, `${baseName}_mute${ext}`)

      emitProgress({
        currentFile: path.basename(inputPath),
        currentIndex: index + 1,
        totalFiles,
        percent: (index / validTotal) * 100,
        message: `Đang tắt âm thanh video ${index + 1}/${validTotal}...`,
      })

      // Chạy FFmpeg để copy video stream và bỏ audio (-an)
      await new Promise<void>((resolve) => {
        const args = ['-y', '-i', inputPath, '-c', 'copy', '-an', outputPath]

        const proc = spawn(ffmpeg, args, {
          windowsHide: true,
        })

        // Đăng ký job để có thể cancel
        videoJobManager.registerJob(requestId, proc)

        let stderrBuffer = ''

        proc.stderr.on('data', (data) => {
          stderrBuffer += data.toString()

          // Nếu user cancel trong khi đang chạy, kill process
          if (videoJobManager.isCancelled(requestId)) {
            try {
              if (!proc.killed) {
                proc.kill('SIGTERM')
                setTimeout(() => {
                  if (!proc.killed) {
                    try {
                      proc.kill('SIGKILL')
                    } catch {
                      // ignore
                    }
                  }
                }, 1000)
              }
            } catch {
              // ignore
            }
          }
        })

        proc.on('close', (code) => {
          if (videoJobManager.isCancelled(requestId)) {
            lastError = 'Đã dừng bởi người dùng'
            failed++
            validFailed++
            emitProgress({
              currentFile: path.basename(inputPath),
              currentIndex: index + 1,
              totalFiles,
              percent: (index + 1) / validTotal * 100,
              error: lastError,
            })
            resolve()
            return
          }

          if (code === 0 && fs.existsSync(outputPath)) {
            processed++
            outputPaths.push(outputPath)
            emitProgress({
              currentFile: path.basename(inputPath),
              currentIndex: index + 1,
              totalFiles,
              percent: ((index + 1) / validTotal) * 100,
              message: `Đã tắt âm thanh video ${index + 1}/${validTotal}`,
            })
          } else {
            failed++
            validFailed++
            const stderrSnippet = stderrBuffer.slice(-400)
            lastError = `FFmpeg exited with code ${code}. ${stderrSnippet}`
            console.error('[muteVideoAudio] FFmpeg error for file:', inputPath, '\n', stderrSnippet)
            emitProgress({
              currentFile: path.basename(inputPath),
              currentIndex: index + 1,
              totalFiles,
              percent: ((index + 1) / validTotal) * 100,
              error: lastError,
            })
          }
          resolve()
        })

        proc.on('error', (err) => {
          failed++
          validFailed++
          lastError = `FFmpeg process error: ${err.message}`
          console.error('[muteVideoAudio] FFmpeg process error for file:', inputPath, err)
          emitProgress({
            currentFile: path.basename(inputPath),
            currentIndex: index + 1,
            totalFiles,
            percent: ((index + 1) / validTotal) * 100,
            error: lastError,
          })
          resolve()
        })
      })
    }

    const elapsedMs = Date.now() - startTime
    console.log(
      `[muteVideoAudio] Completed. processed=${processed}, failed=${failed}, elapsed=${(elapsedMs / 1000).toFixed(1)}s`
    )

    // success = true nếu tất cả valid files đều xuất thành công (bỏ qua invalid files)
    const success = validFailed === 0 && processed > 0
    return {
      requestId,
      outputPaths,
      success,
      error: success ? undefined : lastError || 'Một số video tắt âm thanh thất bại',
      processed,
      failed,
    }
  } catch (err: any) {
    const errorMessage = err?.message || String(err)
    console.error('[muteVideoAudio] Error:', err)

    emitProgress({
      currentFile: '',
      currentIndex: 0,
      totalFiles: req.inputFiles?.length || 0,
      percent: 0,
      error: errorMessage,
    })

    return {
      requestId,
      outputPaths: [],
      success: false,
      error: errorMessage,
      processed: 0,
      failed: req.inputFiles?.length || 0,
    }
  }
}















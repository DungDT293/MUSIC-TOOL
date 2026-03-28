/**
 * Normalize Audio Bitrate
 * Chuẩn hóa bitrate của các file audio về cùng một giá trị
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import { probeFile } from '../ffmpeg/probe'

export interface NormalizeAudioRequest {
  files?: string[] // Danh sách file cụ thể
  folder?: string // Hoặc folder để normalize tất cả file trong đó
  targetBitrate: number // Bitrate mục tiêu (kbps), ví dụ: 192, 256, 320
  outputFormat?: 'mp3' | 'aac' | 'keep' // Format output, 'keep' = giữ nguyên format gốc
  backupOriginal?: boolean // Có backup file gốc không
  outputFolder?: string // Thư mục xuất (nếu không có thì lưu cùng thư mục với file gốc)
}

export interface NormalizeAudioProgress {
  currentFile: string
  currentIndex: number
  totalFiles: number
  percent: number
  status: 'processing' | 'completed' | 'error' | 'cancelled'
  error?: string
  etaSeconds?: number
}

export interface NormalizeAudioResult {
  success: boolean
  processed: number
  failed: number
  errors: Array<{ file: string; error: string }>
  outputFiles: string[]
}

const SUPPORTED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.opus']

let cancelRequested = false
let currentFfmpegProcess: any = null

export function cancelNormalizeAudio() {
  cancelRequested = true
  if (currentFfmpegProcess) {
    try {
      currentFfmpegProcess.kill('SIGTERM')
    } catch (err) {
      console.warn('[normalizeAudio] Failed to kill FFmpeg process:', err)
    }
    currentFfmpegProcess = null
  }
}

function resetCancelFlag() {
  cancelRequested = false
  currentFfmpegProcess = null
}

function isSupportedAudioFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return SUPPORTED_AUDIO_EXTENSIONS.includes(ext)
}

function getAllAudioFilesInFolder(folderPath: string): string[] {
  const files: string[] = []

  function walkDir(currentDir: string) {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        try {
          if (entry.isDirectory()) {
            walkDir(fullPath)
          } else if (entry.isFile() && isSupportedAudioFile(fullPath)) {
            files.push(fullPath)
          }
        } catch (err) {
          console.warn(`[normalizeAudio] Failed to process ${fullPath}:`, err)
        }
      }
    } catch (err) {
      console.warn(`[normalizeAudio] Failed to read directory ${currentDir}:`, err)
    }
  }

  walkDir(folderPath)
  return files
}

/**
 * Xác định format output dựa trên file gốc
 */
function determineOutputFormat(
  inputFile: string,
  requestedFormat: 'mp3' | 'aac' | 'keep' | undefined
): { format: string; codec: string; extension: string } {
  const inputExt = path.extname(inputFile).toLowerCase()

  if (requestedFormat === 'keep') {
    // Giữ nguyên format gốc
    if (inputExt === '.mp3') {
      return { format: 'mp3', codec: 'libmp3lame', extension: '.mp3' }
    } else if (inputExt === '.m4a' || inputExt === '.aac') {
      return { format: 'aac', codec: 'aac', extension: '.m4a' }
    } else if (inputExt === '.wav') {
      return { format: 'wav', codec: 'pcm_s16le', extension: '.wav' }
    } else if (inputExt === '.flac') {
      return { format: 'flac', codec: 'flac', extension: '.flac' }
    }
    // Default fallback
    return { format: 'mp3', codec: 'libmp3lame', extension: '.mp3' }
  }

  // Format được chỉ định
  if (requestedFormat === 'mp3') {
    return { format: 'mp3', codec: 'libmp3lame', extension: '.mp3' }
  } else if (requestedFormat === 'aac') {
    return { format: 'aac', codec: 'aac', extension: '.m4a' }
  }

  // Default: mp3
  return { format: 'mp3', codec: 'libmp3lame', extension: '.mp3' }
}

/**
 * Normalize một file audio
 */
async function normalizeSingleFile(
  inputFile: string,
  targetBitrate: number,
  outputFormat: 'mp3' | 'aac' | 'keep' | undefined,
  backupOriginal: boolean,
  outputFolder?: string
): Promise<{ success: boolean; outputFile?: string; error?: string }> {
  try {
    // Kiểm tra file tồn tại
    if (!fs.existsSync(inputFile)) {
      return { success: false, error: 'File không tồn tại' }
    }

    // Probe file để lấy thông tin
    let probeResult
    try {
      probeResult = await probeFile(inputFile)
    } catch (err: any) {
      return { success: false, error: `Không thể đọc file: ${err.message}` }
    }

    // Kiểm tra có audio stream không
    const streams = Array.isArray((probeResult as any).streams) ? (probeResult as any).streams : []
    const hasAudioStream = streams.some((s) => s?.codec_type === 'audio')
    const hasAudioField = !!(probeResult as any).audio
    if (!hasAudioStream && !hasAudioField) {
      return { success: false, error: 'File không có audio stream' }
    }

    // Xác định output format và codec
    const { format, codec, extension } = determineOutputFormat(inputFile, outputFormat)

    // Xác định thư mục output
    const inputDir = path.dirname(inputFile)
    const outputDir = outputFolder || inputDir

    // Tạo thư mục output nếu chưa tồn tại
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // Tạo output path
    const inputName = path.basename(inputFile, path.extname(inputFile))
    const outputFile = path.join(outputDir, `${inputName}_normalized${extension}`)

    // Backup file gốc nếu cần (luôn backup vào thư mục gốc)
    if (backupOriginal) {
      const backupFile = path.join(inputDir, `${inputName}_original${path.extname(inputFile)}`)
      if (!fs.existsSync(backupFile)) {
        fs.copyFileSync(inputFile, backupFile)
      }
    }

    // Chạy FFmpeg để normalize
    const { ffmpeg } = getFfmpegPaths()

    const args: string[] = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputFile,
      '-vn', // Không có video
      '-ar',
      '48000', // Sample rate chuẩn 48kHz cho YouTube
      '-ac',
      '2', // Stereo
    ]

    // Thêm codec và bitrate
    if (format === 'mp3') {
      args.push('-acodec', 'libmp3lame', '-b:a', `${targetBitrate}k`)
    } else if (format === 'aac') {
      args.push('-acodec', 'aac', '-b:a', `${targetBitrate}k`)
    } else if (format === 'wav') {
      args.push('-acodec', 'pcm_s16le')
    } else if (format === 'flac') {
      args.push('-acodec', 'flac', '-compression_level', '5')
    }

    args.push('-y', outputFile)

    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg, args, { windowsHide: true })
      currentFfmpegProcess = child

      let stderr = ''
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString()
      })

      child.on('error', (err) => {
        currentFfmpegProcess = null
        if (cancelRequested) {
          reject(new Error('Đã dừng bởi người dùng'))
        } else {
          reject(new Error(`FFmpeg error: ${err.message}`))
        }
      })

      child.on('close', (code) => {
        currentFfmpegProcess = null
        if (cancelRequested) {
          reject(new Error('Đã dừng bởi người dùng'))
        } else if (code === 0) {
          resolve()
        } else {
          reject(new Error(`FFmpeg exited with code ${code}. ${stderr}`))
        }
      })

      // Kiểm tra cancel trong quá trình chạy
      if (cancelRequested) {
        try {
          child.kill('SIGTERM')
        } catch (err) {
          // Ignore
        }
        currentFfmpegProcess = null
        reject(new Error('Đã dừng bởi người dùng'))
      }
    })

    // Kiểm tra output file đã tạo
    if (!fs.existsSync(outputFile)) {
      return { success: false, error: 'File output không được tạo' }
    }

    return { success: true, outputFile }
  } catch (error: any) {
    return { success: false, error: error.message || String(error) }
  }
}

/**
 * ⚠️ TÊN HÀM GÂY HIỂU LẦM: Đây là bitrate conversion, KHÔNG phải loudness normalization.
 * Để normalize loudness theo EBU R128 (YouTube standard), cần thêm: -af loudnorm=I=-14:TP=-1.5:LRA=11
 * Tên hàm giữ nguyên vì IPC channel 'music:normalizeAudio' đã được expose ra frontend.
 * TODO: Thêm loudnorm filter trong phiên bản tiếp theo.
 */
export async function normalizeAudio(
  request: NormalizeAudioRequest,
  onProgress?: (progress: NormalizeAudioProgress) => void
): Promise<NormalizeAudioResult> {
  resetCancelFlag()
  // Thu thập danh sách file cần normalize
  let filesToProcess: string[] = []

  if (request.files && request.files.length > 0) {
    // Dùng danh sách file được chỉ định
    filesToProcess = request.files.filter((f) => isSupportedAudioFile(f))
  } else if (request.folder) {
    // Quét folder
    if (!fs.existsSync(request.folder)) {
      throw new Error('Folder không tồn tại')
    }
    filesToProcess = getAllAudioFilesInFolder(request.folder)
  } else {
    throw new Error('Phải chỉ định files hoặc folder')
  }

  if (filesToProcess.length === 0) {
    return {
      success: true,
      processed: 0,
      failed: 0,
      errors: [],
      outputFiles: [],
    }
  }

  const result: NormalizeAudioResult = {
    success: true,
    processed: 0,
    failed: 0,
    errors: [],
    outputFiles: [],
  }

  const totalFiles = filesToProcess.length
  const startTime = Date.now()
  const fileProcessingTimes: number[] = [] // Lưu thời gian xử lý mỗi file

  // Xử lý từng file
  for (let i = 0; i < filesToProcess.length; i++) {
    const file = filesToProcess[i]
    const fileStartTime = Date.now()

    if (cancelRequested) {
      result.success = false
      result.errors.push({ file: '[cancelled]', error: 'Đã dừng bởi người dùng' })
      if (onProgress) {
        onProgress({
          currentFile: path.basename(file),
          currentIndex: i,
          totalFiles,
          percent: Math.round((i / totalFiles) * 100),
          status: 'cancelled',
          error: 'Đã dừng bởi người dùng',
          etaSeconds: 0,
        })
      }
      break
    }

    // Emit progress trước khi xử lý file
    if (onProgress) {
      const elapsedSec = (Date.now() - startTime) / 1000
      const processedCount = i
      const remainingFiles = totalFiles - processedCount
      
      // Tính ETA dựa trên thời gian trung bình mỗi file
      let etaSeconds: number | undefined = undefined
      if (processedCount > 0 && fileProcessingTimes.length > 0) {
        const avgTimePerFile = fileProcessingTimes.reduce((a, b) => a + b, 0) / fileProcessingTimes.length
        etaSeconds = Math.max(0, Math.round(avgTimePerFile * remainingFiles))
      } else if (processedCount > 0 && elapsedSec > 0) {
        // Fallback: tính dựa trên tốc độ hiện tại
        const avgTimePerFile = elapsedSec / processedCount
        etaSeconds = Math.max(0, Math.round(avgTimePerFile * remainingFiles))
      }
      
      const percent = Math.round((processedCount / totalFiles) * 100)
      onProgress({
        currentFile: path.basename(file),
        currentIndex: processedCount,
        totalFiles,
        percent,
        status: 'processing',
        etaSeconds,
      })
    }

    // Normalize file
    const normalizeResult = await normalizeSingleFile(
      file,
      request.targetBitrate,
      request.outputFormat,
      request.backupOriginal ?? false,
      request.outputFolder
    )

    // Lưu thời gian xử lý file này
    const fileProcessingTime = (Date.now() - fileStartTime) / 1000
    fileProcessingTimes.push(fileProcessingTime)

    // Kiểm tra cancel sau khi xử lý file
    if (cancelRequested) {
      result.success = false
      result.errors.push({ file: '[cancelled]', error: 'Đã dừng bởi người dùng' })
      if (onProgress) {
        onProgress({
          currentFile: '',
          currentIndex: i + 1,
          totalFiles,
          percent: Math.round(((i + 1) / totalFiles) * 100),
          status: 'cancelled',
          error: 'Đã dừng bởi người dùng',
          etaSeconds: 0,
        })
      }
      break
    }

    if (normalizeResult.success && normalizeResult.outputFile) {
      result.processed++
      result.outputFiles.push(normalizeResult.outputFile)
    } else {
      result.failed++
      result.errors.push({
        file,
        error: normalizeResult.error || 'Unknown error',
      })
    }

    // Emit progress sau khi xử lý file
    if (onProgress) {
      const elapsedSec = (Date.now() - startTime) / 1000
      const processedCount = i + 1
      const remainingFiles = totalFiles - processedCount
      
      // Tính ETA dựa trên thời gian trung bình mỗi file
      let etaSeconds: number | undefined = undefined
      if (fileProcessingTimes.length > 0) {
        const avgTimePerFile = fileProcessingTimes.reduce((a, b) => a + b, 0) / fileProcessingTimes.length
        etaSeconds = remainingFiles > 0 ? Math.max(0, Math.round(avgTimePerFile * remainingFiles)) : 0
      }
      
      const percent = Math.round((processedCount / totalFiles) * 100)
      onProgress({
        currentFile: processedCount < totalFiles ? path.basename(filesToProcess[processedCount] || '') : '',
        currentIndex: processedCount,
        totalFiles,
        percent,
        status: 'processing',
        etaSeconds,
      })
    }
  }

  // Emit final progress
  if (onProgress) {
    onProgress({
      currentFile: '',
      currentIndex: totalFiles,
      totalFiles,
      percent: 100,
      status: cancelRequested ? 'cancelled' : result.failed === 0 ? 'completed' : 'error',
      etaSeconds: 0,
    })
  }

  result.success = !cancelRequested && result.failed === 0
  return result
}

























































































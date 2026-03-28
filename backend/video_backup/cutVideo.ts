import fs from 'node:fs'
import path from 'node:path'
import { runFfmpeg, type FfmpegProgress } from '../ffmpeg/wrapper'

export interface CutVideoRequest {
  inputVideoPath: string
  outputDir: string
  outputFileName: string // đã có prefix + sanitize; không cần extension
  startTimeSec: number
  durationSec: number
}

export interface CutVideoResult {
  success: boolean
  outputPath?: string
  error?: string
}

/**
 * Chuẩn hóa tên file: bỏ ký tự đặc biệt, thay bằng _
 */
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
}

/**
 * Format thời gian cho FFmpeg (HH:MM:SS hoặc seconds)
 */
function formatTimeForFfmpeg(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/**
 * Cắt một đoạn video từ video gốc
 */
export async function cutVideoSegment(
  req: CutVideoRequest,
  progressEmitter?: (progress: {
    currentSec: number
    totalSec: number
    percent: number
  }) => void
): Promise<CutVideoResult> {
  try {
    // 1. Validate input
    if (!fs.existsSync(req.inputVideoPath)) {
      return {
        success: false,
        error: `File video gốc không tồn tại: ${req.inputVideoPath}`,
      }
    }

    if (!fs.existsSync(req.outputDir)) {
      return {
        success: false,
        error: `Thư mục xuất không tồn tại: ${req.outputDir}`,
      }
    }

    if (req.durationSec <= 0) {
      return {
        success: false,
        error: 'Thời lượng phải > 0',
      }
    }

    // 2. Tạo đường dẫn output
    const safeName = sanitizeFileName(req.outputFileName)
    const outputPath = path.join(req.outputDir, safeName + '.mp4')

    // 3. Build FFmpeg args
    // Ưu tiên dùng -c copy để siêu nhanh, giữ nguyên codec
    const startTime = formatTimeForFfmpeg(req.startTimeSec)
    const duration = formatTimeForFfmpeg(req.durationSec)

    const args = [
      '-hide_banner',
      '-y', // overwrite output file
      '-ss',
      startTime, // start time
      '-i',
      req.inputVideoPath, // input video
      '-t',
      duration, // duration
      '-c',
      'copy', // copy codec (fastest)
      '-avoid_negative_ts',
      'make_zero',
      outputPath,
    ]

    // 4. Chạy FFmpeg
    console.log('[CutVideo] Running FFmpeg with args:', args)
    const result = await runFfmpeg({
      args,
      timeoutMs: 3600000, // 1 hour timeout
      onStderrChunk: (chunk) => {
        // Log progress (FFmpeg thường log vào stderr)
        process.stdout.write(chunk)
      },
      onProgress: (p: FfmpegProgress) => {
        if (progressEmitter && req.durationSec > 0) {
          const percent = Math.max(0, Math.min(100, (p.timeSec / req.durationSec) * 100))
          progressEmitter({
            currentSec: p.timeSec,
            totalSec: req.durationSec,
            percent,
          })
        }
      },
    })

    // 5. Kiểm tra kết quả
    if (result.code === 0 && fs.existsSync(outputPath)) {
      return {
        success: true,
        outputPath,
      }
    } else {
      // Nếu copy codec fail, thử re-encode
      console.warn('[CutVideo] Copy codec failed, trying re-encode...')
      const reencodeArgs = [
        '-hide_banner',
        '-y',
        '-ss',
        startTime,
        '-i',
        req.inputVideoPath,
        '-t',
        duration,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '18',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        outputPath,
      ]

      const reencodeResult = await runFfmpeg({
        args: reencodeArgs,
        timeoutMs: 3600000,
        onStderrChunk: (chunk) => {
          process.stdout.write(chunk)
        },
        onProgress: (p: FfmpegProgress) => {
          if (progressEmitter && req.durationSec > 0) {
            const percent = Math.max(0, Math.min(100, (p.timeSec / req.durationSec) * 100))
            progressEmitter({
              currentSec: p.timeSec,
              totalSec: req.durationSec,
              percent,
            })
          }
        },
      })

      if (reencodeResult.code === 0 && fs.existsSync(outputPath)) {
        return {
          success: true,
          outputPath,
        }
      } else {
        return {
          success: false,
          error: reencodeResult.stderr || 'FFmpeg cut video failed',
        }
      }
    }
  } catch (err: any) {
    console.error('[CutVideo] cutVideoSegment error:', err)
    return {
      success: false,
      error: err?.message || 'Lỗi không xác định khi cắt video.',
    }
  }
}



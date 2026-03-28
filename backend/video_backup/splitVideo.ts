/**
 * Ultra Fast Split Video - Optimized for maximum speed
 * Thay thế hoàn toàn logic cũ
 */

import { spawn, type ChildProcess } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getFfmpegPaths } from '../ffmpeg/config'

export interface VideoSplitOptions {
  inputPath: string
  outputDir: string
  segmentLengthSec: number
  format?: 'mp4' | 'mkv'
  keepCodec?: boolean // Ignored - always copy
  /** Multicut cần siêu nhanh: cho phép tắt hoàn toàn fallback re-encode */
  allowReencode?: boolean // Ignored - always copy only
}

/**
 * Ultra Fast Split Video - Copy only, no re-encode, no metadata check
 * Giữ signature tương thích với IPC handler
 */
export async function splitVideoIntoSegments(
  options: VideoSplitOptions,
  progressEmitter?: (progress: {
    timeSec: number
    totalDurationSec: number
    percent: number
  }) => void
): Promise<{ outputFiles: string[]; totalDurationSec: number }> {
  const { inputPath, outputDir, segmentLengthSec } = options
  const format = options.format ?? 'mp4'
  const ext = format === 'mp4' ? '.mp4' : '.mkv'

  // Tạo output directory
  try {
    fs.mkdirSync(outputDir, { recursive: true })
  } catch (err) {
    // Ignore if exists
  }

  const outputPattern = path.join(outputDir, '%d' + ext)

  // ============================================
  // ULTRA FAST: Copy only, no validation
  // ============================================
  const paths = getFfmpegPaths()
  const args = [
    '-hide_banner',
    '-i',
    inputPath,
    '-f',
    'segment',
    '-segment_time',
    String(segmentLengthSec),
    '-reset_timestamps',
    '1',
    '-c',
    'copy', // ALWAYS copy
    '-map',
    '0',
    '-avoid_negative_ts',
    'make_zero',
    outputPattern,
    '-y',
    '-loglevel', 'error', // Minimal logging
  ]

  // Xử lý Windows long path
  let ffmpegPath = paths.ffmpeg
  if (process.platform === 'win32' && ffmpegPath.match(/^[A-Z]:\\.*$/) && ffmpegPath.length > 240) {
    if (!ffmpegPath.startsWith('\\\\?\\')) {
      ffmpegPath = '\\\\?\\' + ffmpegPath
    }
  }

  return new Promise((resolve, reject) => {
    const ffmpeg: ChildProcess = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'], // Chỉ pipe stderr để catch errors
    })

    let stderrData = ''

    // Minimal stderr capture (chỉ để catch errors)
    ffmpeg.stderr?.on('data', (data) => {
      stderrData += data.toString()

      // Parse progress nếu có progressEmitter (minimal, không chính xác 100%)
      if (progressEmitter) {
        const timeMatch = data.toString().match(/time=([0-9:.]+)/)
        if (timeMatch && timeMatch[1]) {
          const timeStr = timeMatch[1]
          const parts = timeStr.split(':')
          if (parts.length === 3) {
            const hours = parseFloat(parts[0]) || 0
            const minutes = parseFloat(parts[1]) || 0
            const seconds = parseFloat(parts[2]) || 0
            const timeSec = hours * 3600 + minutes * 60 + seconds

            // Estimate total duration (không probe, dùng heuristic)
            // Nếu không có totalDurationSec, dùng segmentLengthSec * số segments ước tính
            const estimatedTotal = segmentLengthSec * 10 // Rough estimate
            const percent = Math.min(100, Math.max(0, (timeSec / estimatedTotal) * 100))

            progressEmitter({
              timeSec,
              totalDurationSec: estimatedTotal,
              percent,
            })
          }
        }
      }
    })

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        try {
          // Đọc files đã tạo
          const files = fs
            .readdirSync(outputDir)
            .filter((f) => f.endsWith(ext))
            .sort((a, b) => {
              const numA = parseInt(a.match(/\d+/)?.[0] || '0')
              const numB = parseInt(b.match(/\d+/)?.[0] || '0')
              return numA - numB
            })

          // Rename: 0.mp4 → 1.mp4, 1.mp4 → 2.mp4, etc.
          const renamedFiles: string[] = []
          for (let i = 0; i < files.length; i++) {
            const oldPath = path.join(outputDir, files[i])
            const newName = `${i + 1}${ext}`
            const newPath = path.join(outputDir, newName)

            try {
              fs.renameSync(oldPath, newPath)
              renamedFiles.push(newPath)
            } catch (err) {
              // Skip if rename fails
              renamedFiles.push(oldPath)
            }
          }

          // Estimate total duration (không probe, dùng heuristic)
          const estimatedTotal = renamedFiles.length * segmentLengthSec

          // Send final progress
          if (progressEmitter) {
            progressEmitter({
              timeSec: estimatedTotal,
              totalDurationSec: estimatedTotal,
              percent: 100,
            })
          }

          resolve({
            outputFiles: renamedFiles,
            totalDurationSec: estimatedTotal,
          })
        } catch (error: any) {
          reject(new Error(`Failed to read output: ${error?.message || String(error)}`))
        }
      } else {
        // Fail nhưng không retry - skip luôn
        reject(new Error(`FFmpeg failed (code ${code}): ${stderrData.slice(0, 200)}`))
      }
    })

    ffmpeg.on('error', (error) => {
      reject(new Error(`FFmpeg spawn error: ${error.message}`))
    })
  })
}

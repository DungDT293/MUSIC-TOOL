/**
 * VIDEO TURBO ENGINE - FFmpeg Runner với Turbo Flags
 * Tối ưu FFmpeg args để đạt hiệu năng tối đa
 */

import { spawn, type ChildProcess } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import os from 'node:os'
import { videoJobManager } from './videoJobManager'

export interface TurboFFmpegOptions {
  args: string[]
  inputPath?: string
  outputPath?: string
  useRAM?: boolean // Input từ RAM buffer
  requestId?: string // Request ID để register job
  groupId?: string // Group ID để cancel-group
  onProgress?: (progress: { timeSec: number; totalDurationSec?: number; percent?: number }) => void
  onStderrChunk?: (chunk: string) => void
}

export interface TurboFFmpegResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Tính số threads tối ưu dựa trên CPU cores
 */
function getOptimalThreads(): number {
  const cpuCores = os.cpus().length
  // Dùng 75% số cores để tránh overload
  return Math.max(1, Math.floor(cpuCores * 0.75))
}

/**
 * Build turbo FFmpeg args với flags tối ưu
 */
export function buildTurboFFmpegArgs(baseArgs: string[]): string[] {
  const threads = getOptimalThreads()
  
  // Turbo flags để tối đa hiệu năng
  const turboFlags = [
    '-threads', String(threads), // Sử dụng đa luồng
    '-thread_queue_size', '4096', // Tăng buffer queue
    '-fflags', '+genpts', // Generate PTS tự động
    '-rw_timeout', '20000000', // Timeout 20s cho read/write
  ]

  // Tìm vị trí chèn flags (sau -hide_banner hoặc đầu args)
  const hideBannerIndex = baseArgs.indexOf('-hide_banner')
  let insertIndex = hideBannerIndex >= 0 ? hideBannerIndex + 1 : 0

  // Không chèn vào giữa -i và input path
  if (baseArgs[insertIndex] === '-i') {
    insertIndex += 2
  }

  // Chèn turbo flags
  const args = [...baseArgs]
  args.splice(insertIndex, 0, ...turboFlags)

  return args
}

/**
 * Parse time từ FFmpeg stderr: "time=HH:MM:SS.xx"
 */
function parseTimeFromStderr(stderrLine: string): number | null {
  const match = stderrLine.match(/time=([0-9:.]+)/)
  if (!match || !match[1]) {
    return null
  }

  const timeStr = match[1]
  const parts = timeStr.split(':')
  
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0
    const minutes = parseFloat(parts[1]) || 0
    const seconds = parseFloat(parts[2]) || 0
    return hours * 3600 + minutes * 60 + seconds
  }

  return null
}

/**
 * Chạy FFmpeg với turbo optimization
 */
export async function runTurboFFmpeg(options: TurboFFmpegOptions): Promise<TurboFFmpegResult> {
  const { args, inputPath, outputPath, useRAM, requestId, groupId, onProgress, onStderrChunk } = options

  // Build turbo args
  const turboArgs = buildTurboFFmpegArgs(args)

  // Xử lý Windows long path
  const paths = getFfmpegPaths()
  let ffmpegPath = paths.ffmpeg
  if (process.platform === 'win32' && ffmpegPath.match(/^[A-Z]:\\.*$/) && ffmpegPath.length > 240) {
    if (!ffmpegPath.startsWith('\\\\?\\')) {
      ffmpegPath = '\\\\?\\' + ffmpegPath
    }
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    // Setup stdio
    const stdio: ('pipe' | 'ignore')[] = useRAM 
      ? ['pipe', 'pipe', 'pipe'] // stdin cho RAM input
      : ['ignore', 'pipe', 'pipe']

    const ffmpeg: ChildProcess = spawn(ffmpegPath, turboArgs, {
      stdio,
    })

    // Register job nếu có requestId
    if (requestId) {
      videoJobManager.registerJob(ffmpeg, 'merge', inputPath, outputPath, undefined, groupId)
    }

    // Parse progress từ stderr
    let lastTimeSec = 0
    let totalDurationSec: number | undefined

    ffmpeg.stderr?.on('data', (data: Buffer) => {
      stderrChunks.push(data)
      const chunkStr = data.toString('utf-8')

      if (onStderrChunk) {
        onStderrChunk(chunkStr)
      }

      // Parse progress
      if (onProgress) {
        const timeSec = parseTimeFromStderr(chunkStr)
        if (timeSec !== null) {
          lastTimeSec = timeSec
          
          // Parse duration nếu có
          const durationMatch = chunkStr.match(/Duration:\s*([0-9:.]+)/)
          if (durationMatch && !totalDurationSec) {
            const durationStr = durationMatch[1]
            const durationParts = durationStr.split(':')
            if (durationParts.length === 3) {
              const hours = parseFloat(durationParts[0]) || 0
              const minutes = parseFloat(durationParts[1]) || 0
              const seconds = parseFloat(durationParts[2]) || 0
              totalDurationSec = hours * 3600 + minutes * 60 + seconds
            }
          }

          // Emit progress
          const percent = totalDurationSec && totalDurationSec > 0
            ? Math.min(100, Math.max(0, (timeSec / totalDurationSec) * 100))
            : undefined

          onProgress({
            timeSec,
            totalDurationSec,
            percent,
          })
        }
      }
    })

    ffmpeg.stdout?.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    ffmpeg.on('error', (error) => {
      reject(new Error(`FFmpeg spawn error: ${error.message}`))
    })

    ffmpeg.on('close', (code) => {
      const stdout = Buffer.concat(chunks).toString('utf-8')
      const stderr = Buffer.concat(stderrChunks).toString('utf-8')

      // Emit final progress nếu chưa 100%
      if (onProgress && code === 0 && lastTimeSec > 0) {
        onProgress({
          timeSec: totalDurationSec || lastTimeSec,
          totalDurationSec: totalDurationSec || lastTimeSec,
          percent: 100,
        })
      }

      if (code !== 0) {
        reject(new Error(`FFmpeg exited with code ${code}. stderr: ${stderr.slice(-500)}`))
      } else {
        resolve({
          code: 0,
          stdout,
          stderr,
        })
      }
    })
  })
}

/**
 * Tính toán concurrency tối ưu dựa trên loại ổ đĩa
 */
export async function chooseBestConcurrencyBasedOnDisk(
  diskType: 'SSD' | 'HDD' | 'UNKNOWN',
  isNVMe: boolean = false
): Promise<number> {
  if (diskType === 'HDD') {
    return 1 // HDD: chỉ 1 job (I/O bound nghiêm trọng)
  }

  if (isNVMe) {
    return 6 // NVMe: 6-8 jobs (I/O rất nhanh)
  }

  if (diskType === 'SSD') {
    return 4 // SATA SSD: 3-4 jobs
  }

  return 2 // Unknown: conservative
}


/**
 * VIDEO TURBO ENGINE - RAM Acceleration
 * Load video < 6GB vào RAM để xử lý cực nhanh
 */

import fs from 'node:fs'
import os from 'node:os'
import { spawn, type ChildProcess } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import path from 'node:path'
import { buildTurboFFmpegArgs } from './videoFFmpegRunner'

const MAX_RAM_FILE_SIZE = 6 * 1024 * 1024 * 1024 // 6GB
const MIN_FREE_RAM_RATIO = 0.2 // Cần ít nhất 20% RAM trống
const MIN_FREE_RAM_ABSOLUTE = 2 * 1024 * 1024 * 1024 // Tối thiểu 2GB RAM trống

export interface RAMBuffer {
  buffer: Buffer
  size: number
  filePath: string
}

/**
 * Lấy free RAM hiện tại (bytes)
 */
function getFreeRAM(): number {
  return os.freemem()
}

/**
 * Lấy total RAM (bytes)
 */
function getTotalRAM(): number {
  return os.totalmem()
}

/**
 * Kiểm tra file có nên load vào RAM không
 * Kiểm tra cả file size và free RAM
 */
export function shouldUseRAM(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath)
    const fileSize = stats.size
    
    // Kiểm tra file size
    if (fileSize >= MAX_RAM_FILE_SIZE) {
      return false
    }
    
    // Kiểm tra free RAM
    const freeRAM = getFreeRAM()
    const totalRAM = getTotalRAM()
    const freeRAMRatio = freeRAM / totalRAM
    
    // Cần đủ RAM: file size + buffer + 20% free
    const requiredRAM = fileSize * 1.5 // File + buffer overhead
    const minFreeRAM = Math.max(
      totalRAM * MIN_FREE_RAM_RATIO,
      MIN_FREE_RAM_ABSOLUTE
    )
    
    if (freeRAM < requiredRAM + minFreeRAM) {
      console.log(
        `[ramAcceleration] Not enough free RAM. Required: ${(requiredRAM / 1024 / 1024 / 1024).toFixed(2)}GB, ` +
        `Available: ${(freeRAM / 1024 / 1024 / 1024).toFixed(2)}GB`
      )
      return false
    }
    
    if (freeRAMRatio < MIN_FREE_RAM_RATIO) {
      console.log(
        `[ramAcceleration] Free RAM ratio too low: ${(freeRAMRatio * 100).toFixed(1)}%`
      )
      return false
    }
    
    return true
  } catch (error) {
    console.warn('[ramAcceleration] shouldUseRAM error:', error)
    return false
  }
}

/**
 * Load file vào RAM buffer
 * Kiểm tra free RAM trước khi load, throw error nếu không đủ
 */
export async function readFileIntoRAM(filePath: string): Promise<RAMBuffer> {
  console.log('[ramAcceleration] Loading file into RAM:', filePath)
  
  const stats = fs.statSync(filePath)
  const fileSize = stats.size
  
  // Kiểm tra file size
  if (fileSize > MAX_RAM_FILE_SIZE) {
    throw new Error(
      `File quá lớn (${(fileSize / 1024 / 1024 / 1024).toFixed(2)}GB) để load vào RAM. Giới hạn: 6GB`
    )
  }

  // Kiểm tra free RAM trước khi load
  const freeRAM = getFreeRAM()
  const totalRAM = getTotalRAM()
  const requiredRAM = fileSize * 1.5 // File + buffer overhead
  const minFreeRAM = Math.max(
    totalRAM * MIN_FREE_RAM_RATIO,
    MIN_FREE_RAM_ABSOLUTE
  )
  
  if (freeRAM < requiredRAM + minFreeRAM) {
    throw new Error(
      `Không đủ RAM trống. Cần: ${((requiredRAM + minFreeRAM) / 1024 / 1024 / 1024).toFixed(2)}GB, ` +
      `Có sẵn: ${(freeRAM / 1024 / 1024 / 1024).toFixed(2)}GB`
    )
  }

  try {
    // Load file vào RAM (async để không block)
    const buffer = await fs.promises.readFile(filePath)
    
    console.log(
      `[ramAcceleration] Loaded ${(buffer.length / 1024 / 1024).toFixed(2)}MB into RAM. ` +
      `Free RAM: ${(getFreeRAM() / 1024 / 1024 / 1024).toFixed(2)}GB`
    )
    
    return {
      buffer,
      size: buffer.length,
      filePath,
    }
  } catch (error) {
    console.error('[ramAcceleration] Failed to read file into RAM:', error)
    throw new Error(`Không thể load file vào RAM: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Chạy FFmpeg với input từ RAM buffer (pipe stdin)
 * Apply turbo flags để tối đa hiệu năng
 */
export async function runFFmpegFromRAM(
  ramBuffer: RAMBuffer,
  ffmpegArgs: string[],
  onProgress?: (timeSec: number) => void
): Promise<{ code: number; stderr: string }> {
  const paths = getFfmpegPaths()
  let ffmpegPath = paths.ffmpeg

  // Windows long path
  if (process.platform === 'win32' && ffmpegPath.match(/^[A-Z]:\\.*$/) && ffmpegPath.length > 240) {
    if (!ffmpegPath.startsWith('\\\\?\\')) {
      ffmpegPath = '\\\\?\\' + ffmpegPath
    }
  }

  return new Promise((resolve, reject) => {
    // Build args: thay -i input.mp4 bằng -i pipe:0
    let args = ffmpegArgs.map(arg => {
      if (arg === ramBuffer.filePath) {
        return 'pipe:0' // FFmpeg đọc từ stdin
      }
      return arg
    })

    // Nếu không có -i trong args, thêm -i pipe:0
    if (!args.includes('-i')) {
      const inputIndex = args.findIndex(a => a === ramBuffer.filePath)
      if (inputIndex >= 0) {
        args[inputIndex] = '-i'
        args.splice(inputIndex + 1, 0, 'pipe:0')
      } else {
        // Tìm vị trí hợp lý để chèn -i (thường sau -hide_banner)
        const hideBannerIndex = args.indexOf('-hide_banner')
        if (hideBannerIndex >= 0) {
          args.splice(hideBannerIndex + 1, 0, '-i', 'pipe:0')
        } else {
          args.unshift('-i', 'pipe:0')
        }
      }
    }

    // Apply turbo flags (threads, thread_queue_size, etc.)
    args = buildTurboFFmpegArgs(args)

    const ffmpeg: ChildProcess = spawn(ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
    })

    let stderrData = ''
    let stdinClosed = false

    // Pipe RAM buffer vào stdin
    try {
      if (ffmpeg.stdin) {
        ffmpeg.stdin.write(ramBuffer.buffer, (error) => {
          if (error) {
            console.error('[ramAcceleration] Failed to write to stdin:', error)
            if (!stdinClosed) {
              ffmpeg.stdin?.destroy()
              stdinClosed = true
            }
            reject(error)
          } else {
            if (!stdinClosed) {
              ffmpeg.stdin?.end()
              stdinClosed = true
            }
          }
        })
      } else {
        reject(new Error('FFmpeg stdin is not available'))
        return
      }
    } catch (error) {
      console.error('[ramAcceleration] Error writing to stdin:', error)
      if (!stdinClosed && ffmpeg.stdin) {
        ffmpeg.stdin.destroy()
        stdinClosed = true
      }
      reject(error)
      return
    }

    // Parse progress từ stderr
    ffmpeg.stderr?.on('data', (data: Buffer) => {
      stderrData += data.toString()
      
      if (onProgress) {
        const match = data.toString().match(/time=([0-9:.]+)/)
        if (match && match[1]) {
          const timeStr = match[1]
          const parts = timeStr.split(':')
          if (parts.length === 3) {
            const hours = parseFloat(parts[0]) || 0
            const minutes = parseFloat(parts[1]) || 0
            const seconds = parseFloat(parts[2]) || 0
            const timeSec = hours * 3600 + minutes * 60 + seconds
            onProgress(timeSec)
          }
        }
      }
    })

    ffmpeg.on('close', (code) => {
      // Cleanup stdin nếu chưa đóng
      if (!stdinClosed && ffmpeg.stdin) {
        try {
          ffmpeg.stdin.destroy()
        } catch {}
        stdinClosed = true
      }
      
      if (code === 0) {
        resolve({ code: 0, stderr: stderrData })
      } else {
        reject(new Error(`FFmpeg failed (code ${code}): ${stderrData.slice(-500)}`))
      }
    })

    ffmpeg.on('error', (error) => {
      // Cleanup stdin nếu có lỗi
      if (!stdinClosed && ffmpeg.stdin) {
        try {
          ffmpeg.stdin.destroy()
        } catch {}
        stdinClosed = true
      }
      reject(new Error(`FFmpeg spawn error: ${error.message}`))
    })
  })
}

/**
 * Giải phóng RAM buffer
 * Clear reference để GC có thể thu hồi memory
 */
export function releaseRAMBuffer(ramBuffer: RAMBuffer): void {
  if (!ramBuffer) {
    return
  }
  
  const sizeMB = ramBuffer.size ? (ramBuffer.size / 1024 / 1024).toFixed(2) : '0'
  
  // Clear buffer reference để GC có thể thu hồi
  // @ts-ignore - Force clear reference
  ramBuffer.buffer = null
  // @ts-ignore
  ramBuffer.size = 0
  // @ts-ignore
  ramBuffer.filePath = ''
  
  console.log(`[ramAcceleration] RAM buffer released (${sizeMB}MB). Free RAM: ${(getFreeRAM() / 1024 / 1024 / 1024).toFixed(2)}GB`)
  
  // Force GC nếu có thể (chỉ trong development, không nên dùng trong production)
  if (global.gc && typeof global.gc === 'function') {
    try {
      global.gc()
    } catch {}
  }
}


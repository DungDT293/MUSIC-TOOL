/**
 * FFmpeg Config - Lấy đường dẫn đến ffmpeg và ffprobe
 */

import path from 'node:path'
import fs from 'node:fs'

export interface FfmpegPaths {
  ffmpeg: string
  ffprobe: string
}

/**
 * Lấy đường dẫn đến ffmpeg và ffprobe
 * - Ưu tiên: environment variables FFMPEG_PATH và FFPROBE_PATH
 * - DEV mode: tìm trong <project root>/bin/
 * - PROD mode: tìm trong <resourcesPath>/bin/
 */
export function getFfmpegPaths(): FfmpegPaths {
  const isWindows = process.platform === 'win32'
  const exeExt = isWindows ? '.exe' : ''

  // Ưu tiên: environment variables
  if (process.env.FFMPEG_PATH && process.env.FFPROBE_PATH) {
    return {
      ffmpeg: process.env.FFMPEG_PATH,
      ffprobe: process.env.FFPROBE_PATH,
    }
  }

  // Tìm trong thư mục bin
  let ffmpegPath: string
  let ffprobePath: string

  // Kiểm tra xem app có được packaged không
  // Sử dụng app.isPackaged nếu có (từ Electron), fallback về check resourcesPath
  let isPackaged = false
  try {
    // Thử import app từ electron (chỉ có trong main process)
    const { app } = require('electron')
    isPackaged = app.isPackaged
  } catch {
    // Nếu không import được (không phải main process hoặc chưa load electron), dùng fallback
    // Trong DEV, process.resourcesPath có thể undefined hoặc trỏ vào node_modules/electron/dist/resources
    // Nên cần check thêm: nếu resourcesPath chứa 'node_modules/electron', đó là DEV mode
    const resourcesPath = (process as any).resourcesPath
    if (resourcesPath && typeof resourcesPath === 'string') {
      // Nếu resourcesPath chứa 'node_modules/electron', đó là DEV mode (Electron dev binaries)
      // Nếu resourcesPath chứa 'app.asar' hoặc không chứa 'node_modules', đó là PROD mode
      const isNodeModulesPath = resourcesPath.includes('node_modules') && resourcesPath.includes('electron')
      const isAsarPath = resourcesPath.includes('app.asar')
      
      if (isNodeModulesPath && !isAsarPath) {
        isPackaged = false // DEV mode: trỏ vào node_modules/electron/dist/resources
      } else if (isAsarPath || (!isNodeModulesPath && resourcesPath.length > 0)) {
        isPackaged = true // PROD mode: trỏ vào app.asar/resources hoặc resources thực sự
      } else {
        isPackaged = false // Mặc định: DEV mode
      }
    } else {
      isPackaged = false // Không có resourcesPath = DEV mode
    }
  }
  
  if (isPackaged) {
    // Production mode: tìm trong resources/bin (extraResources)
    const resourcesPath = (process as any).resourcesPath
    if (!resourcesPath) {
      throw new Error('[FFmpeg Config] Production mode but resourcesPath is undefined')
    }
    const packagedBinDir = path.join(resourcesPath, 'bin')
    ffmpegPath = path.join(packagedBinDir, `ffmpeg${exeExt}`)
    ffprobePath = path.join(packagedBinDir, `ffprobe${exeExt}`)
  } else {
    // Dev mode: tìm trong bin folder ở root project
    // Dùng process.cwd() để lấy root project (nơi chạy npm run dev)
    const projectRoot = process.cwd()
    const binDir = path.join(projectRoot, 'bin')
    ffmpegPath = path.join(binDir, `ffmpeg${exeExt}`)
    ffprobePath = path.join(binDir, `ffprobe${exeExt}`)
  }

  // Log để debug (chỉ trong DEV mode hoặc khi có NODE_ENV=development)
  const isDev = !isPackaged || process.env.NODE_ENV === 'development'
  if (isDev) {
    console.log('[FFMPEG CONFIG] isPackaged =', isPackaged)
    console.log('[FFMPEG CONFIG] ffmpegPath =', ffmpegPath)
    console.log('[FFMPEG CONFIG] ffprobePath =', ffprobePath)
    console.log('[FFMPEG CONFIG] ffmpeg exists:', fs.existsSync(ffmpegPath))
    console.log('[FFMPEG CONFIG] ffprobe exists:', fs.existsSync(ffprobePath))
  }

  // Warning nếu không tìm thấy (nhưng vẫn trả về path để FFmpeg tự báo lỗi)
  if (!fs.existsSync(ffmpegPath)) {
    console.warn(`[FFmpeg] Warning: ffmpeg not found at: ${ffmpegPath}`)
  }
  if (!fs.existsSync(ffprobePath)) {
    console.warn(`[FFmpeg] Warning: ffprobe not found at: ${ffprobePath}`)
  }

  return {
    ffmpeg: ffmpegPath,
    ffprobe: ffprobePath,
  }
}


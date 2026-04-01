/**
 * songNhacHandlers.ts
 * IPC handlers: song-nhac:*, autopilot:*
 */

import { ipcMain, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { isValidAbsolutePath } from '../authState'
import {
  startAutopilot,
  getAutopilotProgress,
  onAutopilotProgress,
  cancelAutopilot,
  onAutopilotLog,
  type AutopilotConfig as AutopilotBackendConfig,
  type AutopilotProgress,
} from '../../backend/autopilot/autopilotRunner'

// Map để track active FFmpeg processes cho Song Nhạc export
export const activeSongNhacExports = new Map<string, import('child_process').ChildProcess>()

export function registerSongNhacHandlers(getMainWindow: () => BrowserWindow | null) {
  // ===== Autopilot =====

  onAutopilotProgress((progress: AutopilotProgress) => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('autopilot:status', progress)
    }
  })

  onAutopilotLog((log) => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('autopilot:log', log)
    }
  })

  ipcMain.handle('autopilot:getStatus', async () => getAutopilotProgress())

  ipcMain.handle('autopilot:start', async (_event, config: AutopilotBackendConfig) => {
    try {
      if (getAutopilotProgress().status === 'running') {
        return { ok: false, error: 'Autopilot đang chạy. Hãy dừng job hiện tại trước khi chạy job mới.' }
      }
      startAutopilot(config).catch((error: any) => {
        console.error('[Autopilot] Pipeline error (background):', error)
      })
      return { ok: true }
    } catch (error: any) {
      console.error('[Autopilot] Failed to start:', error)
      return { ok: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('autopilot:cancel', async () => {
    cancelAutopilot()
    return { ok: true }
  })

  // Scan video folders for autopilot
  ipcMain.handle('autopilot:scan-video-folders', async (_event, rootVideo: string) => {
    if (!rootVideo || typeof rootVideo !== 'string') return { totalFiles: 0, folders: [] }

    const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.ts', '.m2ts', '.m4v'])
    const folders = rootVideo.split('\n').map(f => f.trim()).filter(f => f.length > 0)
    const result: { totalFiles: number; folders: Array<{ folder: string; count: number }> } = {
      totalFiles: 0,
      folders: [],
    }

    const walkAsync = async (dir: string): Promise<number> => {
      let count = 0
      try {
        const entries = await fsp.readdir(dir, { withFileTypes: true })
        await Promise.all(entries.map(async (entry) => {
          const fullPath = path.join(dir, entry.name)
          try {
            if (entry.isDirectory()) count += await walkAsync(fullPath)
            else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase()
              if (VIDEO_EXTENSIONS.has(ext)) count++
            }
          } catch {}
        }))
      } catch {}
      return count
    }

    for (const folder of folders) {
      try {
        await fsp.access(folder)
      } catch {
        result.folders.push({ folder, count: 0 })
        continue
      }
      const count = await walkAsync(folder)
      result.folders.push({ folder, count })
      result.totalFiles += count
    }
    return result
  })

  // Video Pool IPC
  ipcMain.handle('autopilot:video-pool-stats', async () => {
    const { getPoolStats } = await import('../../backend/autopilot/videoPool')
    return getPoolStats()
  })

  ipcMain.handle('autopilot:video-pool-clear', async () => {
    const { clearPool } = await import('../../backend/autopilot/videoPool')
    clearPool()
    return { ok: true }
  })

  // Security monitoring
  ipcMain.handle('security:reportAntiDebug', async (_event, details: { method: string; detected: boolean }) => {
    const { reportAntiDebugTriggered } = await import('../../backend/security/securityMonitoring')
    await reportAntiDebugTriggered(details)
    return { ok: true }
  })

  // ===== Song Nhạc Export =====

  ipcMain.handle('song-nhac:export-video', async (_event, options: any) => {
    const jobId: string = options?.jobId ?? `sn-${Date.now()}`
    let frameHandler: ((_ev: any, _jobIdArg: string, frameData: Buffer) => void) | null = null
    let endHandler: (() => void) | null = null
    try {
      const { startFfmpegPipe } = await import('../../backend/video/songNhacFfmpegPipe')
      const { ffmpegProc, waitForExit } = startFfmpegPipe(options)
      activeSongNhacExports.set(jobId, ffmpegProc)

      frameHandler = (_ev: any, _jobIdArg: string, frameData: Buffer) => {
        if (ffmpegProc.stdin && !ffmpegProc.stdin.destroyed) {
          ffmpegProc.stdin.write(frameData)
        }
      }
      ipcMain.on('song-nhac:frame', frameHandler)

      const END_TIMEOUT_MS = 5 * 60 * 1000
      const endPromise = new Promise<void>((resolve, reject) => {
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null
        endHandler = () => {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          if (ffmpegProc.stdin && !ffmpegProc.stdin.destroyed) ffmpegProc.stdin.end()
          resolve()
        }
        ipcMain.once('song-nhac:end', endHandler)
        timeoutHandle = setTimeout(() => {
          if (endHandler) ipcMain.removeListener('song-nhac:end', endHandler)
          if (ffmpegProc.stdin && !ffmpegProc.stdin.destroyed) ffmpegProc.stdin.end()
          reject(new Error('song-nhac:export-video timed out waiting for end signal'))
        }, END_TIMEOUT_MS)
      })

      await endPromise
      const result = await waitForExit()
      return { ok: true, outputPath: result.outputPath, code: result.code }
    } catch (error: any) {
      console.error('[SongNhac] Export error:', error)
      return { ok: false, error: error?.message || String(error) }
    } finally {
      if (frameHandler) ipcMain.removeListener('song-nhac:frame', frameHandler)
      if (endHandler) ipcMain.removeListener('song-nhac:end', endHandler)
      activeSongNhacExports.delete(jobId)
    }
  })

  ipcMain.handle('song-nhac:get-audio-duration', async (_event, filePath: string) => {
    try {
      if (!isValidAbsolutePath(filePath)) return { ok: false, error: 'Invalid file path' }
      const { runFfprobe } = await import('../../backend/ffmpeg/wrapper')
      const output = await runFfprobe([
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
      ])
      const duration = parseFloat(output.trim())
      return { ok: true, duration: isNaN(duration) ? 0 : duration }
    } catch (error: any) {
      return { ok: false, error: error?.message }
    }
  })

  ipcMain.handle('song-nhac:read-audio-file', async (_event, filePath: string) => {
    try {
      if (!isValidAbsolutePath(filePath)) return { ok: false, error: 'Invalid file path' }
      const buffer = fs.readFileSync(filePath)
      return { ok: true, buffer }
    } catch (error: any) {
      return { ok: false, error: error?.message }
    }
  })

  ipcMain.handle('song-nhac:decode-audio-timeline', async (_event, filePath: string) => {
    try {
      if (!isValidAbsolutePath(filePath)) return { ok: false, error: 'Invalid file path' }
      const { runFfprobe } = await import('../../backend/ffmpeg/wrapper')
      const output = await runFfprobe([
        '-v', 'error', '-show_entries', 'format=duration,bit_rate:stream=sample_rate,channels',
        '-of', 'json', filePath,
      ])
      const info = JSON.parse(output)
      return { ok: true, info }
    } catch (error: any) {
      return { ok: false, error: error?.message }
    }
  })

  ipcMain.handle('song-nhac:list-audio-in-folder', async (_event, folderPath: string) => {
    try {
      if (!isValidAbsolutePath(folderPath)) return []
      const audioExts = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma']
      return fs.readdirSync(folderPath)
        .filter(f => audioExts.includes(path.extname(f).toLowerCase()))
        .map(f => ({ name: f, path: path.join(folderPath, f) }))
    } catch (error: any) {
      console.error('[SongNhac] listAudioInFolder error:', error)
      return []
    }
  })

  ipcMain.handle('song-nhac:cancel-export', async (_event, jobId?: string) => {
    if (jobId && activeSongNhacExports.has(jobId)) {
      const proc = activeSongNhacExports.get(jobId)!
      try { if (!proc.killed) proc.kill('SIGTERM') } catch (_) {}
      activeSongNhacExports.delete(jobId)
    } else if (activeSongNhacExports.size > 0) {
      for (const [id, proc] of activeSongNhacExports) {
        try { if (!proc.killed) proc.kill('SIGTERM') } catch (_) {}
        activeSongNhacExports.delete(id)
        break
      }
    }
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('song-nhac:export-cancel')
    }
    return { ok: true }
  })
}

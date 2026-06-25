/**
 * autopilotHandlers.ts
 * IPC handlers: autopilot:*
 */

import { BrowserWindow, ipcMain } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { isValidAbsolutePath } from '../authState'
import { AutopilotConfigSchema } from '../../shared/ipcSchemas'
import {
  cancelAutopilot,
  forceResetAutopilot,
  getAutopilotLogVerbosity,
  getAutopilotProgress,
  getRecentAutopilotLogs,
  onAutopilotLog,
  onAutopilotProgress,
  setAutopilotLogVerbosity,
  startAutopilot,
  type AutopilotConfig as AutopilotBackendConfig,
  type AutopilotLogVerbosity,
  type AutopilotProgress,
} from '../../backend/autopilot/autopilotRunner'
import { runAutopilotHealthCheck } from '../../backend/autopilot/healthCheck'

let autopilotStartInFlight = false

function broadcastToAllWindows(channel: string, payload: unknown) {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

export function registerAutopilotHandlers(_getMainWindow: () => BrowserWindow | null) {
  onAutopilotProgress((progress: AutopilotProgress) => {
    broadcastToAllWindows('autopilot:status', progress)
  })

  onAutopilotLog((log) => {
    broadcastToAllWindows('autopilot:log', log)
  })

  ipcMain.handle('autopilot:getStatus', async () => getAutopilotProgress())
  ipcMain.handle('autopilot:getRecentLogs', async (_event, limit?: number) => getRecentAutopilotLogs(limit))
  ipcMain.handle('autopilot:getLogVerbosity', async () => getAutopilotLogVerbosity())
  ipcMain.handle('autopilot:setLogVerbosity', async (_event, verbosity: AutopilotLogVerbosity) => {
    return { ok: true, verbosity: setAutopilotLogVerbosity(verbosity) }
  })

  ipcMain.handle('autopilot:start', async (_event, config: AutopilotBackendConfig) => {
    const parsed = AutopilotConfigSchema.safeParse(config)
    if (!parsed.success) {
      const errorMessages = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
      console.error('[Autopilot] Config validation failed:', errorMessages)
      return { ok: false, error: `Config không hợp lệ: ${errorMessages}` }
    }

    if (autopilotStartInFlight) {
      return { ok: false, error: 'Autopilot đang khởi động. Hãy chờ health-check hiện tại hoàn tất.' }
    }

    const statusBeforeStart = getAutopilotProgress().status
    if (statusBeforeStart === 'running' || statusBeforeStart === 'paused' || statusBeforeStart === 'cancelling') {
      return { ok: false, error: 'Autopilot đang chạy hoặc đang dừng. Hãy chờ job hiện tại kết thúc trước khi chạy job mới.' }
    }

    autopilotStartInFlight = true
    try {
      const healthCheck = await runAutopilotHealthCheck(config)
      if (!healthCheck.ok) {
        return { ok: false, error: healthCheck.error || 'Autopilot health-check failed.' }
      }

      const effectiveConfig: AutopilotBackendConfig = {
        ...config,
        runtimeOverrides: {
          ...config.runtimeOverrides,
          finalExportUseGpuEncoding: healthCheck.recommendedUseGpuEncoding,
          requireGpuForVideoEncode: config.runtimeOverrides?.requireGpuForVideoEncode,
          healthCheckNotice: healthCheck.notice,
          healthCheckNoticeLevel: healthCheck.noticeLevel,
          resolvedGpuProfile: healthCheck.resolvedGpuProfile,
          resolvedGpuFfmpegPath: healthCheck.resolvedGpuFfmpegPath,
          resolvedGpuEncoder: healthCheck.resolvedGpuEncoder,
          gpuFallbackReason: healthCheck.gpuFallbackReason,
          gpuNormalizeMode: healthCheck.gpuNormalizeMode,
          gpuNormalizeReason: healthCheck.gpuNormalizeReason,
        },
      }

      startAutopilot(effectiveConfig).catch((error: any) => {
        console.error('[Autopilot] Pipeline error (background):', error)
      })

      await new Promise<void>(resolve => setTimeout(resolve, 200))
      return { ok: true }
    } catch (error: any) {
      console.error('[Autopilot] Failed to start:', error)
      return { ok: false, error: error?.message || String(error) }
    } finally {
      autopilotStartInFlight = false
    }
  })

  ipcMain.handle('autopilot:cancel', async () => {
    cancelAutopilot()
    return { ok: true }
  })

  ipcMain.handle('autopilot:forceReset', async () => {
    const result = forceResetAutopilot()
    if (result.reset) {
      console.log(`[Autopilot] Force-reset executed. Previous status: ${result.previousStatus}`)
    }
    return { ok: result.reset, previousStatus: result.previousStatus }
  })

  ipcMain.handle('autopilot:scan-video-folders', async (_event, rootVideo: string) => {
    if (!rootVideo || typeof rootVideo !== 'string') return { totalFiles: 0, folders: [] }

    const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.ts', '.m2ts', '.m4v'])
    const folders = rootVideo.split('\n').map(f => f.trim()).filter(f => f.length > 0)
    const SCAN_CONCURRENCY = 8

    const validFolders = folders.filter(f => isValidAbsolutePath(f))
    if (validFolders.length === 0) return { totalFiles: 0, folders: [] }

    const result: { totalFiles: number; folders: Array<{ folder: string; count: number }> } = {
      totalFiles: 0,
      folders: [],
    }

    const walkAsync = async (rootDir: string): Promise<number> => {
      let count = 0
      const queue: string[] = [rootDir]
      let activeWorkers = 0

      const worker = async () => {
        while (true) {
          if (queue.length === 0) {
            if (activeWorkers === 0) return
            await new Promise(resolve => setTimeout(resolve, 1))
            continue
          }

          const dir = queue.shift()
          if (!dir) continue

          activeWorkers++
          try {
            const entries = await fsp.readdir(dir, { withFileTypes: true })
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name)
              try {
                if (entry.isDirectory()) {
                  queue.push(fullPath)
                } else if (entry.isFile()) {
                  const ext = path.extname(entry.name).toLowerCase()
                  if (VIDEO_EXTENSIONS.has(ext)) count++
                }
              } catch {
                // Ignore inaccessible nested entries.
              }
            }
          } catch {
            // Ignore inaccessible directories in quick scan.
          } finally {
            activeWorkers--
          }
        }
      }

      await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, () => worker()))
      return count
    }

    for (const folder of validFolders) {
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

  ipcMain.handle('autopilot:video-pool-stats', async () => {
    const { getPoolStats } = await import('../../backend/autopilot/videoPool')
    return getPoolStats()
  })

  ipcMain.handle('autopilot:video-pool-clear', async () => {
    const { clearPool } = await import('../../backend/autopilot/videoPool')
    clearPool()
    return { ok: true }
  })
}

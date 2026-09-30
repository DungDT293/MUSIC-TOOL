/**
 * autopilotHandlers.ts
 * IPC handlers: autopilot:*
 */

import { BrowserWindow, ipcMain } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { normalizeVideo } from '../../backend/video/normalizeVideo'
import { getVideoFileInfo } from '../../backend/video/videoInfo'
import { getOrInitAuthState, isAllowedAuthState, isValidAbsolutePath } from '../authState'
import { AutopilotConfigSchema } from '../../shared/ipcSchemas'
import {
  cancelAutopilot,
  forceResetAutopilot,
  splitFolderLines,
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
import { setHasActiveExport } from '../main'

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
    const authState = await getOrInitAuthState()
    if (!isAllowedAuthState(authState)) {
      return { ok: false, error: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại trước khi chạy Autopilot.' }
    }

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

      setHasActiveExport(true)
      startAutopilot(effectiveConfig)
        .catch((error: any) => {
          console.error('[Autopilot] Pipeline error (background):', error)
        })
        .finally(() => setHasActiveExport(false))

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
    const folders = splitFolderLines(rootVideo)
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

  ipcMain.handle('autopilot:repairInvalidVideos', async (_event, request: {
    paths: string[]
    rootDir: string
    mode: 'delete' | 'replace'
    confirmed: boolean
  }) => {
    const authState = await getOrInitAuthState()
    if (!isAllowedAuthState(authState)) {
      return { success: false, repaired: [], failed: [], error: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại trước khi sửa video.' }
    }
    if (!request || !request.confirmed || !Array.isArray(request.paths) || request.paths.length === 0) {
      return { success: false, repaired: [], failed: [], error: 'Phải rà soát và xác nhận danh sách video lỗi trước khi sửa.' }
    }
    if (!isValidAbsolutePath(request.rootDir)) {
      return { success: false, repaired: [], failed: [], error: `Thư mục gốc không hợp lệ: ${request.rootDir || '(trống)'}` }
    }

    const root = path.normalize(request.rootDir).replace(/[\\/]+$/, '').toLowerCase()
    const paths = Array.from(new Set(request.paths.filter(isValidAbsolutePath)))
    const invalidScope = paths.filter((filePath) => {
      const normalized = path.normalize(filePath).toLowerCase()
      return normalized === root || !normalized.startsWith(`${root}${path.sep}`)
    })
    if (invalidScope.length > 0 || paths.length !== request.paths.length) {
      return {
        success: false,
        repaired: [],
        failed: invalidScope.map((filePath) => ({ path: filePath, error: 'File nằm ngoài thư mục gốc cho phép.' })),
        error: 'Danh sách có file ngoài thư mục gốc hoặc đường dẫn không hợp lệ; không thực hiện sửa.',
      }
    }

    if (request.mode === 'delete') {
      const deleted: string[] = []
      const failed: Array<{ path: string; error: string }> = []
      for (const filePath of paths) {
        try {
          await fsp.unlink(filePath)
          deleted.push(filePath)
        } catch (error: any) {
          failed.push({ path: filePath, error: error?.message || String(error) })
        }
      }
      return {
        success: failed.length === 0,
        repaired: deleted,
        failed,
        error: failed.length > 0 ? `Đã xóa ${deleted.length}/${paths.length}; còn lỗi ${failed.length} file.` : undefined,
      }
    }

    const outputDir = path.join(request.rootDir, '_autopilot_repair_temp')
    await fsp.mkdir(outputDir, { recursive: true })
    const repaired: string[] = []
    const failed: Array<{ path: string; error: string }> = []
    for (const filePath of paths) {
      const tempResult = await normalizeVideo({
        inputFiles: [filePath],
        outputDir,
        useGpu: false,
        targetResolution: '1920x1080',
        targetFps: '30',
        concatSafe: true,
        skipExisting: false,
        writeManifest: false,
        trustInputs: true,
        requestId: `autopilot-repair-${Date.now()}`,
      })
      const repairedPath = tempResult.outputPaths[0]
      if (!tempResult.success || !repairedPath) {
        failed.push({ path: filePath, error: tempResult.error || 'FFmpeg không tạo được file chuẩn hóa.' })
        continue
      }
      try {
        const info = await getVideoFileInfo(repairedPath)
        if (!(info.durationSec && info.width && info.height && info.codecName)) {
          throw new Error('File chuẩn hóa không có duration/stream video hợp lệ.')
        }
        const backupPath = `${filePath}.autopilot-backup`
        await fsp.rename(filePath, backupPath)
        try {
          await fsp.rename(repairedPath, filePath)
          await fsp.unlink(backupPath)
          repaired.push(filePath)
        } catch (replaceError) {
          await fsp.rename(backupPath, filePath).catch(() => {})
          throw replaceError
        }
      } catch (error: any) {
        failed.push({ path: filePath, error: error?.message || String(error) })
      }
    }
    return {
      success: failed.length === 0,
      repaired,
      failed,
      error: failed.length > 0 ? `Đã chuẩn hóa/thay ${repaired.length}/${paths.length}; còn lỗi ${failed.length} file.` : undefined,
    }
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

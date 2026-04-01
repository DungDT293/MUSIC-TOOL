/**
 * systemHandlers.ts
 * IPC handlers: system:*, dialog:*, jobQueue:*, ffmpeg:probe
 */

import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getSystemInfo } from '../../backend/system/sysinfo'
import { getRealtimeStats } from '../../backend/system/realtime'
import { getDiskInfo, type DiskInfoSummary } from '../../backend/system/diskInfo'
import { getDiskSpace, checkMinimumSpace, formatBytes } from '../../backend/utils/diskSpace'
import { jobQueue } from '../../backend/jobQueue/jobQueue'
import { getVideoFileInfo, type VideoFileInfo } from '../../backend/video/videoInfo'
import { isValidAbsolutePath } from '../authState'

// Lazy import probeFile
let probeFile: any = null

// Disk info cache (chia sẻ với main.ts qua getter/setter)
let cachedDiskInfo: DiskInfoSummary | null = null

export function getCachedDiskInfo() { return cachedDiskInfo }
export function setCachedDiskInfo(info: DiskInfoSummary | null) { cachedDiskInfo = info }

export async function refreshDiskInfoAndBroadcast(): Promise<DiskInfoSummary> {
  try {
    const info = await getDiskInfo()
    cachedDiskInfo = info
    broadcastDiskInfo(info)
    return info
  } catch (error) {
    console.error('[system] Failed to get disk info:', error)
    const fallback: DiskInfoSummary = {
      drives: [],
      byType: { ssd: null, hdd: null },
      updatedAt: Date.now(),
    }
    cachedDiskInfo = fallback
    broadcastDiskInfo(fallback)
    return fallback
  }
}

function broadcastDiskInfo(info: DiskInfoSummary) {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('system:disk-info', info)
    }
  }
}

// ─── Disk / resource check helper ─────────────────────────────────────────
export async function confirmResourcesForVideoJob(
  kind: 'merge' | 'final-export' | 'mute' | 'normalize' | string,
  targetDir: string
): Promise<boolean> {
  try {
    const diskSpace = await getDiskSpace(targetDir)
    const minRequired: Record<string, number> = {
      'merge': 2 * 1024 * 1024 * 1024,
      'final-export': 4 * 1024 * 1024 * 1024,
      'mute': 512 * 1024 * 1024,
    }
    const required = minRequired[kind] ?? 1 * 1024 * 1024 * 1024
    const hasEnough = checkMinimumSpace(diskSpace, required)
    if (!hasEnough) {
      console.warn(
        `[confirmResources] Not enough disk space for ${kind}: ` +
        `available=${formatBytes(diskSpace.free)}, required=${formatBytes(required)}`
      )
    }
    return hasEnough
  } catch (err) {
    console.warn('[confirmResources] Could not check disk space:', err)
    return true // Fail open
  }
}

// ─── Register handlers ─────────────────────────────────────────────────────
export function registerSystemHandlers(mainWindow: Electron.BrowserWindow | null) {
  // Job queue listeners
  jobQueue.on('update', (job) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('jobQueue:update', job)
    }
  })

  // Job queue handlers
  ipcMain.handle('jobQueue:list', async () => jobQueue.getJobs())
  ipcMain.handle('jobQueue:get', async (_event, jobId: string) => jobQueue.getJob(jobId) ?? null)
  ipcMain.handle('jobQueue:cancel', async (_event, jobId: string) => {
    await jobQueue.cancelJob(jobId)
    return { success: true }
  })

  // FFprobe IPC
  ipcMain.handle('ffmpeg:probe', async (_event, filePath: string) => {
    if (!probeFile) {
      const probeModule = await import('../../backend/ffmpeg/probe')
      probeFile = probeModule.probeFile
    }
    return await probeFile(filePath)
  })

  // System info
  ipcMain.handle('system:info', async () => getSystemInfo())
  ipcMain.handle('system:realtime', async () => getRealtimeStats())
  ipcMain.handle('system:getDiskInfo', async () => {
    if (cachedDiskInfo) return cachedDiskInfo
    return refreshDiskInfoAndBroadcast()
  })
  ipcMain.handle('system:refreshDiskInfo', async () => refreshDiskInfoAndBroadcast())

  // Create directory
  ipcMain.handle('system:createDirectory', async (_event, dirPath: string) => {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true })
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  // Read file as base64
  ipcMain.handle('system:readFileAsBase64', async (_event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: 'File not found' }
      const buffer = fs.readFileSync(filePath)
      const ext = path.extname(filePath).toLowerCase().slice(1)
      const mimeMap: Record<string, string> = {
        mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
        aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
        opus: 'audio/opus', wma: 'audio/x-ms-wma',
      }
      const mime = mimeMap[ext] ?? 'audio/mpeg'
      return { ok: true, base64: buffer.toString('base64'), mime }
    } catch (err: any) {
      return { ok: false, error: String(err) }
    }
  })

  // Open path
  ipcMain.handle('system:openPath', async (_event, pathToOpen: string) => {
    try {
      await shell.openPath(pathToOpen)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Dialog handlers
  ipcMain.handle('dialog:openFile', async (_event, options: any) => {
    const result = await dialog.showOpenDialog({
      title: options?.title,
      filters: options?.filters,
      properties: ['openFile'],
    })
    return { canceled: result.canceled, filePaths: result.filePaths }
  })

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectVideoFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectVideoFilesMulti', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths
  })

  ipcMain.handle('dialog:selectImageFile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Chọn file ảnh',
        filters: [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    } catch (error) {
      console.error('[IPC] Error selecting image file:', error)
      return null
    }
  })

  ipcMain.handle('dialog:selectAudioFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'flac', 'aac'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectAudioFilesMulti', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'flac', 'aac'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths
  })

  ipcMain.handle('dialog:selectManyVideos', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths
  })

  // Video file listing helpers
  const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.avi', '.wmv', '.webm'])

  ipcMain.handle('video:listVideosInFolder', async (_event, folderPath: string) => {
    try {
      if (!isValidAbsolutePath(folderPath)) return []
      const entries = fs.readdirSync(folderPath, { withFileTypes: true })
      const files: Array<{ path: string; fileName: string; sizeBytes: number }> = []
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const ext = path.extname(entry.name).toLowerCase()
        if (!VIDEO_EXTS.has(ext)) continue
        const full = path.join(folderPath, entry.name)
        let sizeBytes = 0
        try { sizeBytes = fs.statSync(full).size } catch {}
        files.push({ path: full, fileName: entry.name, sizeBytes })
      }
      return files
    } catch (err) {
      console.error('[IPC] video:listVideosInFolder error', err)
      return []
    }
  })

  ipcMain.handle('video:listVideosInFolderSimple', async (_event, folderPath: string) => {
    try {
      if (!isValidAbsolutePath(folderPath)) return []
      const entries = fs.readdirSync(folderPath, { withFileTypes: true })
      const files: Array<{ path: string; fileName: string; sizeBytes: number }> = []
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const ext = path.extname(entry.name).toLowerCase()
        if (!VIDEO_EXTS.has(ext)) continue
        const full = path.join(folderPath, entry.name)
        let sizeBytes = 0
        try { sizeBytes = fs.statSync(full).size } catch {}
        files.push({ path: full, fileName: entry.name, sizeBytes })
      }
      return files
    } catch (err) {
      console.error('[IPC] video:listVideosInFolderSimple error', err)
      return []
    }
  })

  ipcMain.handle('video:ultraFastScanFolder', async (_event, folderPath: string) => {
    try {
      if (!isValidAbsolutePath(folderPath)) return []
      const files: Array<{ path: string; fileName: string; sizeBytes: number; mtimeMs: number }> = []

      const scanDir = (dir: string) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              scanDir(fullPath)
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase()
              if (VIDEO_EXTS.has(ext)) {
                try {
                  const stats = fs.statSync(fullPath)
                  files.push({ path: fullPath, fileName: entry.name, sizeBytes: stats.size, mtimeMs: stats.mtimeMs })
                } catch {}
              }
            }
          }
        } catch {}
      }

      scanDir(folderPath)
      return files
    } catch (err) {
      console.error('[IPC] video:ultraFastScanFolder error', err)
      return []
    }
  })

  ipcMain.handle('video:batchLazyProbe', async (_event, paths: string[], concurrency: number = 5) => {
    try {
      const validPaths = Array.isArray(paths) ? paths.filter(isValidAbsolutePath) : []
      const results: Record<string, VideoFileInfo | null> = {}
      const queue = [...validPaths]
      const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
        while (queue.length > 0) {
          const p = queue.shift()
          if (!p) break
          try {
            results[p] = await getVideoFileInfo(p)
          } catch (err) {
            console.warn('[batchLazyProbe] Failed to probe', p, err)
            results[p] = null
          }
        }
      })
      await Promise.all(workers)
      return results
    } catch (err) {
      console.error('[IPC] video:batchLazyProbe error', err)
      return {}
    }
  })

  // ─── Video Audit & Delete ─────────────────────────────────────────────────
  ipcMain.handle('video:auditFolder', async (_event, filePaths: string[]) => {
    try {
      const paths = Array.isArray(filePaths) ? filePaths.filter(isValidAbsolutePath) : []
      const valid: Array<VideoFileInfo & { path: string }> = []
      const invalid: string[] = []

      // Concurrent probe với limit = 8
      const queue = [...paths]
      const workers = Array.from({ length: Math.min(8, queue.length || 1) }, async () => {
        while (queue.length > 0) {
          const p = queue.shift()
          if (!p) break
          try {
            const info = await getVideoFileInfo(p)
            if (info.durationSec && info.durationSec > 0) {
              valid.push({ ...info, path: p })
            } else {
              invalid.push(p)
            }
          } catch {
            invalid.push(p)
          }
        }
      })
      await Promise.all(workers)

      return { valid, invalid }
    } catch (err) {
      console.error('[IPC] video:auditFolder error', err)
      return { valid: [], invalid: [] }
    }
  })

  ipcMain.handle('video:deleteFiles', async (_event, filePaths: string[], rootDir: string) => {
    let deleted = 0
    const errors: Array<{ path: string; message: string }> = []

    const safeRoot = rootDir && isValidAbsolutePath(rootDir) ? path.resolve(rootDir) : null
    const pathsToDelete = Array.isArray(filePaths) ? filePaths : []

    for (const fp of pathsToDelete) {
      // Validate mỗi path riêng biệt (không dùng optional chaining để bỏ qua)
      if (!isValidAbsolutePath(fp)) {
        errors.push({ path: fp, message: 'Đường dẫn không hợp lệ' })
        continue
      }

      // Nếu rootDir được cung cấp, đảm bảo file nằm trong rootDir
      if (safeRoot) {
        const resolved = path.resolve(fp)
        if (!resolved.startsWith(safeRoot + path.sep) && resolved !== safeRoot) {
          errors.push({ path: fp, message: 'File nằm ngoài thư mục cho phép' })
          continue
        }
      }

      try {
        await fs.promises.unlink(fp)
        deleted++
      } catch (err: any) {
        errors.push({ path: fp, message: err?.message || String(err) })
      }
    }

    return { deleted, errors }
  })
}

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
  // PLAN A: CHỈ CẢNH BÁO, KHÔNG CHẶN. Luôn trả về true để user vẫn xuất được.
  // Disk đo bằng fs.statfs (chính xác) — nếu thật sự thiếu thì FFmpeg sẽ báo ENOSPC,
  // còn cảnh báo sai (WMIC lỗi → os.freemem) đã được fix ở getDiskSpace.
  try {
    const diskSpace = await getDiskSpace(targetDir)
    if (diskSpace.unknown) return true // không đo được → fail-open, không cảnh báo nhiễu
    const minRequiredGiB: Record<string, number> = {
      'merge': 2,
      'final-export': 4,
      'mute': 0.5,
      'normalize': 1,
    }
    const requiredGiB = minRequiredGiB[kind] ?? 1
    const spaceCheck = checkMinimumSpace(diskSpace.free, requiredGiB)
    if (!spaceCheck.enough) {
      console.warn(
        `[confirmResources] ⚠️ Dung lượng ổ ${diskSpace.drive} có thể không đủ cho ${kind}: ` +
        `còn ${formatBytes(spaceCheck.freeBytes)}, khuyến nghị ${formatBytes(spaceCheck.requiredBytes)}. ` +
        `Vẫn tiếp tục (chỉ cảnh báo).`
      )
    }
  } catch (err) {
    console.warn('[confirmResources] Could not check disk space (vẫn tiếp tục):', err)
  }
  return true
}

// ─── Register handlers ─────────────────────────────────────────────────────
export function registerSystemHandlers(getMainWindow: () => Electron.BrowserWindow | null) {
  // Job queue listeners — dùng getter để luôn lấy window mới nhất (FIX: H1)
  jobQueue.on('update', (job) => {
    const mw = getMainWindow()
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send('jobQueue:update', job)
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
    if (!isValidAbsolutePath(filePath)) {
      return { error: 'Invalid file path' }
    }
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

  // Security monitoring
  ipcMain.handle('security:reportAntiDebug', async (_event, details: { method: string; detected: boolean }) => {
    const { reportAntiDebugTriggered } = await import('../../backend/security/securityMonitoring')
    await reportAntiDebugTriggered(details)
    return { ok: true }
  })

  // Create directory
  ipcMain.handle('system:createDirectory', async (_event, dirPath: string) => {
    if (!isValidAbsolutePath(dirPath)) {
      return { success: false, error: 'Invalid directory path' }
    }
    try {
      await fs.promises.mkdir(dirPath, { recursive: true })
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  // Read file as base64
  ipcMain.handle('system:readFileAsBase64', async (_event, filePath: string) => {
    if (!isValidAbsolutePath(filePath)) {
      return { ok: false, error: 'Invalid file path' }
    }
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

  // Open path — restrict to directories only for safety
  ipcMain.handle('system:openPath', async (_event, pathToOpen: string) => {
    if (!isValidAbsolutePath(pathToOpen)) {
      return { success: false, error: 'Invalid path' }
    }
    try {
      // Only allow opening directories, not arbitrary executables
      const stat = await fs.promises.stat(pathToOpen).catch(() => null)
      if (stat && !stat.isDirectory()) {
        // For files, show in folder instead of opening directly
        shell.showItemInFolder(pathToOpen)
        return { success: true }
      }
      await shell.openPath(pathToOpen)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Dialog handlers
  ipcMain.handle('dialog:openFile', async (_event, options: any) => {
    const validProps = ['openFile', 'multiSelections', 'openDirectory'] as const
    const properties = Array.isArray(options?.properties)
      ? options.properties.filter((p: string) => validProps.includes(p as any))
      : ['openFile']
    const result = await dialog.showOpenDialog({
      title: options?.title,
      filters: options?.filters,
      properties: properties.length > 0 ? properties : ['openFile'],
    })
    return { canceled: result.canceled, filePaths: result.filePaths }
  })

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Save video file dialog — used by Export to let user choose output path
  ipcMain.handle('dialog:saveVideoFile', async (_event, defaultFileName?: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Lưu video xuất',
      defaultPath: defaultFileName,
      filters: [
        { name: 'MP4 Video', extensions: ['mp4'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    return { canceled: result.canceled, filePath: result.filePath ?? null }
  })

  // Project file dialog for the Song Nhac editor (.json).
  ipcMain.handle('dialog:saveProjectFile', async (_event, defaultFileName?: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Lưu project Sóng nhạc',
      defaultPath: defaultFileName || 'song-nhac.json',
      filters: [
        { name: 'Song Nhac Project', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    return { canceled: result.canceled, filePath: result.filePath ?? null }
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

  ipcMain.handle('dialog:selectImageFilesMulti', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Chọn nhiều file ảnh',
        filters: [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile', 'multiSelections'],
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths
    } catch (error) {
      console.error('[IPC] Error selecting image files:', error)
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

  // listVideosInFolder: redirect tới cùng handler với listVideosInFolderSimple (logic giống hệt, quét cả thư mục con)
  const listVideoHandler = async (_event: Electron.IpcMainInvokeEvent, folderPath: string) => {
    try {
      if (!isValidAbsolutePath(folderPath)) return []
      const files: Array<{ path: string; fileName: string; sizeBytes: number }> = []
      const scanDir = (dir: string) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              scanDir(full)
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase()
              if (!VIDEO_EXTS.has(ext)) continue
              let sizeBytes = 0
              try { sizeBytes = fs.statSync(full).size } catch {}
              files.push({ path: full, fileName: entry.name, sizeBytes })
            }
          }
        } catch {}
      }
      scanDir(folderPath)
      return files
    } catch (err) {
      console.error('[IPC] video:listVideosInFolder error', err)
      return []
    }
  }
  ipcMain.handle('video:listVideosInFolder', listVideoHandler)
  ipcMain.handle('video:listVideosInFolderSimple', listVideoHandler)

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
      // Security: cap concurrency to prevent renderer from spawning excessive child processes
      const safeConcurrency = Math.min(Math.max(1, concurrency), 8)
      const validPaths = Array.isArray(paths) ? paths.filter(isValidAbsolutePath) : []
      // Cap total paths to prevent DoS
      const cappedPaths = validPaths.slice(0, 500)
      const results: Record<string, VideoFileInfo | null> = {}
      const queue = [...cappedPaths]
      const workers = Array.from({ length: Math.min(safeConcurrency, queue.length || 1) }, async () => {
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

  // ─── Video & Audio Audit & Delete ──────────────────────────────────────────
  const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma', '.aiff', '.alac'])

  ipcMain.handle('media:listMediaFilesInFolder', async (_event, folderPath: string, mode?: 'all' | 'video' | 'audio') => {
    try {
      if (!isValidAbsolutePath(folderPath)) return []
      const files: Array<{ path: string; fileName: string; sizeBytes: number; kind: 'video' | 'audio' }> = []
      const scanMode = mode || 'all'

      const scanDir = (dir: string) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              scanDir(full)
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase()
              const isVideo = VIDEO_EXTS.has(ext)
              const isAudio = AUDIO_EXTS.has(ext)

              if (scanMode === 'video' && !isVideo) continue
              if (scanMode === 'audio' && !isAudio) continue
              if (scanMode === 'all' && !isVideo && !isAudio) continue

              let sizeBytes = 0
              try { sizeBytes = fs.statSync(full).size } catch {}
              files.push({
                path: full,
                fileName: entry.name,
                sizeBytes,
                kind: isVideo ? 'video' : 'audio',
              })
            }
          }
        } catch (dirErr) {
          console.warn(`[IPC] media:listMediaFilesInFolder skip unreadable dir: ${dir}`, dirErr)
        }
      }

      scanDir(folderPath)
      return files
    } catch (err) {
      console.error('[IPC] media:listMediaFilesInFolder error', err)
      return []
    }
  })

  ipcMain.handle('video:auditFolder', async (_event, filePaths: string[]) => {
    try {
      const paths = Array.isArray(filePaths) ? filePaths.filter(isValidAbsolutePath) : []
      const valid: Array<any> = []
      const invalid: string[] = []
      const invalidDetails: Array<{ path: string; reason: string; kind?: 'video' | 'audio' }> = []

      // Concurrent probe với sliding window / worker limit = 16
      let nextIndex = 0
      const workerCount = Math.min(16, paths.length || 1)
      const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < paths.length) {
          const currentIndex = nextIndex++
          if (currentIndex >= paths.length) break
          const p = paths[currentIndex]
          if (!p) continue
          const ext = path.extname(p).toLowerCase()
          const isAudio = AUDIO_EXTS.has(ext)
          const isVideo = VIDEO_EXTS.has(ext)

          try {
            let statSize = 0
            try {
              statSize = fs.statSync(p).size
            } catch {
              invalid.push(p)
              invalidDetails.push({ path: p, reason: 'File không tồn tại hoặc không thể đọc', kind: isAudio ? 'audio' : 'video' })
              continue
            }

            if (statSize === 0) {
              invalid.push(p)
              invalidDetails.push({ path: p, reason: 'File rỗng (0 byte - không có dữ liệu)', kind: isAudio ? 'audio' : 'video' })
              continue
            }

            if (isAudio) {
              // Rà soát file audio
              try {
                const probeRes = await probeFile(p)
                const hasUsableDuration = !!(probeRes.format?.duration && probeRes.format.duration > 0)
                const hasAudioStream = !!(probeRes.audio && probeRes.audio.codec)

                if (hasUsableDuration && hasAudioStream) {
                  valid.push({
                    path: p,
                    durationSec: probeRes.format.duration,
                    codecName: probeRes.audio?.codec,
                    formatName: probeRes.format?.format_name,
                    sizeBytes: statSize,
                    kind: 'audio',
                  })
                } else {
                  const reason = !hasUsableDuration
                    ? 'Audio không có duration hợp lệ.'
                    : 'Audio không có stream âm thanh hợp lệ (thiếu codec).'
                  invalid.push(p)
                  invalidDetails.push({ path: p, reason, kind: 'audio' })
                }
              } catch (audioErr: any) {
                invalid.push(p)
                invalidDetails.push({
                  path: p,
                  reason: `Không probe được audio (lỗi cấu trúc hoặc hỏng file): ${audioErr?.message || audioErr}`,
                  kind: 'audio',
                })
              }
            } else {
              // Rà soát file video (mặc định)
              try {
                const info = await getVideoFileInfo(p)
                const hasUsableDuration = !!(info.durationSec && info.durationSec > 0)
                const hasUsableVideoStream = !!(info.width && info.height && info.codecName)
                if (hasUsableDuration && hasUsableVideoStream) {
                  valid.push({ ...info, path: p, kind: 'video' })
                } else {
                  const reason = !hasUsableDuration
                    ? 'Video không có duration hợp lệ.'
                    : 'Video không có stream hình ảnh hợp lệ (thiếu width/height/codec).'
                  invalid.push(p)
                  invalidDetails.push({ path: p, reason, kind: 'video' })
                }
              } catch (videoErr: any) {
                invalid.push(p)
                invalidDetails.push({
                  path: p,
                  reason: `Không probe được video (lỗi cấu trúc hoặc hỏng container): ${videoErr?.message || videoErr}`,
                  kind: 'video',
                })
              }
            }
          } catch (error) {
            invalid.push(p)
            invalidDetails.push({
              path: p,
              reason: `Không thể kiểm tra file: ${error instanceof Error ? error.message : String(error)}`,
              kind: isAudio ? 'audio' : 'video',
            })
          }
        }
      })
      await Promise.all(workers)

      return { valid, invalid, invalidDetails }
    } catch (err) {
      console.error('[IPC] video:auditFolder error', err)
      return { valid: [], invalid: [], invalidDetails: [] }
    }
  })

  ipcMain.handle('video:deleteFiles', async (_event, filePaths: string[], rootDir: string) => {
    let deleted = 0
    const errors: Array<{ path: string; message: string }> = []

    const safeRoot = rootDir && isValidAbsolutePath(rootDir) ? path.normalize(rootDir) : null
    const pathsToDelete = Array.isArray(filePaths) ? filePaths : []

    for (const fp of pathsToDelete) {
      if (!isValidAbsolutePath(fp)) {
        errors.push({ path: fp, message: 'Đường dẫn không hợp lệ' })
        continue
      }

      // Nếu rootDir được cung cấp, đảm bảo file nằm trong rootDir (hỗ trợ case-insensitive trên Windows)
      if (safeRoot) {
        const normalized = path.normalize(fp)
        const isInside = process.platform === 'win32'
          ? (normalized.toLowerCase().startsWith((safeRoot + path.sep).toLowerCase()) || normalized.toLowerCase() === safeRoot.toLowerCase())
          : (normalized.startsWith(safeRoot + path.sep) || normalized === safeRoot)

        if (!isInside) {
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

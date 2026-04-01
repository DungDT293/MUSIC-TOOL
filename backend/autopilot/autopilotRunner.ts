import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildPlaylists, clearPlaylists, savePlaylists, type BuildPlaylistsOptions, type PlaylistDefinition } from '../music/playlistEngine'
import { exportPlaylistToFile, type ExportPlaylistRequest } from '../music/exportAudio'
import { scanMusicFolders, type ScanMusicResult } from '../music/scanMusic'
import { type FinalExportJobRequest, type FinalExportEmitter, planFinalExport, executeFinalExport } from '../video/finalExport'
import { videoJobManager } from '../video/videoJobManager'
import { getDiskSpace, formatBytes } from '../utils/diskSpace'
import { syncPoolWithFiles, pickUniqueSequence, markClipsUsed, getPoolStats } from './videoPool'

export type DayPresetId = 'tomorrowland' | 'partymix' | 'custom'


export interface DayPlanDetailOverrides {
  priorityTracksPerPlaylist?: number
  videoPickPercent?: number
  enableCrossfade?: boolean
  crossfadeSeconds?: number
  titleVariant?: 'pipe' | 'fire'
  topDj?: string
  allowDjRepeatAcrossVideos?: boolean
  generateTracklist?: boolean
  /** Bật re-encode + kiểm tra sâu khi ghép video (an toàn hơn nhưng chậm hơn) */
  normalizeVideoInput?: boolean
  /** Chuẩn hóa tỉ lệ khung hình + FPS khi ghép video (thêm dải đen nếu cần) */
  unifyVideoFormat?: boolean
  /** Tỉ lệ khung hình / độ phân giải mục tiêu khi unifyVideoFormat = true */
  targetResolution?: string
  /** FPS mục tiêu khi unifyVideoFormat = true */
  targetFps?: string
  /** Bật chế độ nhập tiêu đề thủ công */
  useCustomTitles?: boolean
  /** Danh sách tiêu đề tùy chỉnh (mỗi phần tử = 1 file) */
  customTitles?: string[]
  /** Cách chọn bài ưu tiên: 'auto' (mặc định) hoặc 'manual' (user tự chọn giống tab 2) */
  prioritySelectionMode?: 'auto' | 'manual'
  /** Danh sách track id ưu tiên (chọn tay) dùng khi prioritySelectionMode === 'manual' */
  priorityPinnedTrackIds?: string[]
}

export interface DayPlanConfig {
  id: string
  dateCode: string // '0212'
  playlistCount: number
  minutesPerPlaylist: number
  presetId: DayPresetId
  overrides?: DayPlanDetailOverrides
}

export interface AutopilotFoldersConfig {
  rootAudio: string
  rootVideo: string
  rootFinal: string
  autoCreateDailySubfolder: boolean
  priorityMusicFolder?: string
  randomMusicFolder?: string
  /** Thư mục video ưu tiên (tùy chọn) – các clip trong thư mục này sẽ được ưu tiên xuất hiện đầu video khi Final Export */
  priorityVideoFolder?: string
  /** Số clip video tối thiểu cần chọn (mặc định 1000) */
  minVideoClipsTarget?: number
}

export interface AutopilotConfig {
  dayPlans: DayPlanConfig[]
  folders: AutopilotFoldersConfig
}

export type AutopilotStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'completed_with_errors'
  | 'error'
  | 'cancelling'

export interface AutopilotProgress {
  status: AutopilotStatus
  currentDayIndex: number | null
  currentStep: 1 | 2 | 3 | 4 | 5 | null
  stepPercent: number
  message?: string
  error?: string
  videoSelectedCount?: number
  videoTargetMin?: number
}

export type AutopilotProgressListener = (progress: AutopilotProgress) => void

let currentProgress: AutopilotProgress = {
  status: 'idle',
  currentDayIndex: null,
  currentStep: null,
  stepPercent: 0,
  message: '',
}

let isCancelling = false
let progressListener: AutopilotProgressListener | null = null
let logListener: ((log: { timestamp: string; level: 'info' | 'warn' | 'error'; message: string }) => void) | null = null
let activeAbortControllers: AbortController[] = []
const LOG_BUFFER_LIMIT = 500
let recentLogs: { timestamp: string; level: 'info' | 'warn' | 'error'; message: string }[] = []
const SCAN_TIMEOUT_MS = 10 * 60 * 1000 // 10 phút
const VIDEO_PICK_TIMEOUT_MS = 10 * 60 * 1000 // 10 phút
const MAX_PLAYLIST_COUNT_DEFAULT = 200 // cảnh báo
const MAX_PLAYLIST_COUNT = 500 // giới hạn cứng
const MAX_LOG_FILES = 5
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024 // 5MB
// Lazy-init LOG_DIR để tránh require electron trước khi app ready
function getLogDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron')
    return path.join(app.getPath('userData'), 'logs')
  } catch {
    // Fallback khi chạy ngoài Electron (unit test, CLI)
    return path.join(process.cwd(), 'logs')
  }
}
const LOG_DIR = getLogDir()
const LOG_FILE_PREFIX = 'autopilot'
const VIDEO_CHECK_MAX_DEPTH = 8
const VIDEO_CHECK_ENTRY_LIMIT = 10_000

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.avi', '.wmv', '.webm'])

export function getAutopilotProgress(): AutopilotProgress {
  return currentProgress
}

export function onAutopilotProgress(listener: AutopilotProgressListener) {
  progressListener = listener
}

export function offAutopilotProgress() {
  progressListener = null
}

function emit(progress: Partial<AutopilotProgress>) {
  const next: AutopilotProgress = { ...currentProgress, ...progress }
  if (typeof progress.stepPercent === 'number') {
    // Allow stepPercent to reset when the step index changes (new step starts from 0)
    const stepChanged =
      typeof progress.currentStep === 'number' &&
      progress.currentStep !== currentProgress.currentStep
    if (stepChanged) {
      next.stepPercent = progress.stepPercent
    } else {
      next.stepPercent = Math.max(currentProgress.stepPercent || 0, progress.stepPercent)
    }
  }
  currentProgress = next
  if (progressListener) progressListener(currentProgress)
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

let ensureLogDirDone = false

function ensureLogDir() {
  if (ensureLogDirDone) return
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    ensureLogDirDone = true
  } catch (err) {
    console.warn('[Autopilot] Không tạo được thư mục log:', err)
  }
}

async function rotateLogsIfNeeded(basePath: string) {
  try {
    const stat = await fsp.stat(basePath)
    if (stat.size < MAX_LOG_SIZE_BYTES) return
  } catch {
    return
  }

  // Xoay file: .log.(n-1) -> .log.n, rồi .log -> .log.1
  for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
    const src = i === 1 ? basePath : `${basePath}.${i - 1}`
    const dst = `${basePath}.${i}`
    try {
      await fsp.unlink(dst).catch(() => {})
      await fsp.rename(src, dst).catch(() => {})
    } catch (err) {
      console.warn('[Autopilot] rotateLogsIfNeeded rename error:', err)
    }
  }
}

function appendLogToFile(entry: { timestamp: string; level: 'info' | 'warn' | 'error'; message: string }) {
  ensureLogDir()
  const basePath = path.join(LOG_DIR, `${LOG_FILE_PREFIX}.log`)
  const line = `${entry.timestamp} [${entry.level.toUpperCase()}] ${entry.message}\n`
  // Dùng async I/O để không block main process / IPC event loop
  rotateLogsIfNeeded(basePath)
    .then(() => fsp.appendFile(basePath, line, 'utf-8'))
    .catch(err => console.warn('[Autopilot] Ghi log file thất bại:', err))
}

function emitLog(level: 'info' | 'warn' | 'error', message: string) {
  const timestamp = new Date().toLocaleTimeString('vi-VN', { hour12: false })
  const logEntry = { timestamp, level, message }
  recentLogs.push(logEntry)
  if (recentLogs.length > LOG_BUFFER_LIMIT) {
    recentLogs = recentLogs.slice(-LOG_BUFFER_LIMIT)
  }
  if (logListener) {
    logListener(logEntry)
  }
  appendLogToFile(logEntry)
  // Cũng log vào console
  if (level === 'error') {
    console.error(`[Autopilot] ${message}`)
  } else if (level === 'warn') {
    console.warn(`[Autopilot] ${message}`)
  } else {
    console.log(`[Autopilot] ${message}`)
  }
}

export function onAutopilotLog(listener: (log: { timestamp: string; level: 'info' | 'warn' | 'error'; message: string }) => void) {
  logListener = listener
}

export function offAutopilotLog() {
  logListener = null
}

export function cancelAutopilot() {
  if (currentProgress.status === 'running' || currentProgress.status === 'paused') {
    isCancelling = true
    emit({ status: 'cancelling', message: 'Đang dừng Autopilot, huỷ các job FFmpeg hiện tại...' })
    try {
      // Kill toàn bộ FFmpeg jobs đang chạy (export audio, final export, v.v.)
      videoJobManager.cancelAll()
    } catch (error) {
      console.warn('[Autopilot] cancelAutopilot: lỗi khi huỷ video jobs:', error)
    }

    // Abort các AbortController nội bộ (ví dụ export audio)
    for (const ctrl of activeAbortControllers) {
      try {
        ctrl.abort()
      } catch (err) {
        console.warn('[Autopilot] cancelAutopilot: lỗi khi abort controller:', err)
      }
    }
    activeAbortControllers = []
  }
}

function normalizeNumber(value: number | string | null | undefined, fallback: number): number {
  if (typeof value === 'number' && !Number.isNaN(value) && value > 0) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (!Number.isNaN(n) && n > 0) return n
  }
  return fallback
}

async function ensureDir(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true })
}

/**
 * Validate dateCode format: phải là 4 ký tự số (ddMM)
 */
function validateDateCode(dateCode: string): boolean {
  if (!dateCode || typeof dateCode !== 'string') return false
  if (dateCode.length !== 4) return false
  if (!/^\d{4}$/.test(dateCode)) return false
  
  const day = parseInt(dateCode.substring(0, 2), 10)
  const month = parseInt(dateCode.substring(2, 4), 10)
  
  if (isNaN(day) || isNaN(month)) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  
  // Kiểm tra số ngày hợp lệ trong tháng
  const currentYear = new Date().getFullYear()
  const date = new Date(currentYear, month - 1, day)
  if (date.getDate() !== day || date.getMonth() !== month - 1) return false
  
  return true
}

/**
 * Validate thư mục: kiểm tra tồn tại và có quyền truy cập
 */
async function validateFolder(folderPath: string, folderName: string): Promise<void> {
  if (!folderPath || typeof folderPath !== 'string' || folderPath.trim().length === 0) {
    throw new Error(`Thư mục "${folderName}" chưa được chọn.`)
  }

  try {
    const stat = await fsp.stat(folderPath)
    if (!stat.isDirectory()) {
      throw new Error(`Đường dẫn "${folderPath}" không phải là thư mục.`)
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Thư mục "${folderName}" không tồn tại: ${folderPath}`)
    } else if (error.code === 'EACCES') {
      throw new Error(`Không có quyền truy cập thư mục "${folderName}": ${folderPath}`)
    } else {
      throw new Error(`Lỗi khi kiểm tra thư mục "${folderName}": ${error.message}`)
    }
  }
}

/**
 * Validate multi-line folder path (rootVideo có thể có nhiều thư mục, mỗi dòng một thư mục)
 * Chỉ cần ít nhất 1 thư mục tồn tại là hợp lệ
 */
async function validateMultiFolder(folderPathMultiline: string, folderName: string): Promise<void> {
  if (!folderPathMultiline || typeof folderPathMultiline !== 'string' || folderPathMultiline.trim().length === 0) {
    throw new Error(`Thư mục "${folderName}" chưa được chọn.`)
  }

  const lines = folderPathMultiline
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)

  if (lines.length === 0) {
    throw new Error(`Thư mục "${folderName}" chưa được chọn.`)
  }

  const errors: string[] = []
  for (const line of lines) {
    try {
      const stat = await fsp.stat(line)
      if (!stat.isDirectory()) {
        errors.push(`"${line}" không phải thư mục`)
      }
      // Nếu ít nhất 1 thư mục OK → tiếp tục (không fail toàn bộ)
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        errors.push(`"${line}" không tồn tại`)
      } else if (err.code === 'EACCES') {
        errors.push(`"${line}" không có quyền truy cập`)
      } else {
        errors.push(`"${line}" lỗi: ${err.message}`)
      }
    }
  }

  // Nếu TẤT CẢ đều lỗi → fail
  if (errors.length === lines.length) {
    throw new Error(`Thư mục "${folderName}" không tồn tại:\n${folderPathMultiline}`)
  }

  // Nếu một số lỗi → chỉ warn, không fail
  if (errors.length > 0) {
    console.warn(`[Autopilot] ${folderName}: ${errors.length}/${lines.length} thư mục không truy cập được:`, errors)
  }
}

async function ensureAudioDiskSpaceEstimate(
  dirPath: string,
  playlistCount: number,
  minutesPerPlaylist: number,
  label: string,
): Promise<void> {
  try {
    const info = await getDiskSpace(dirPath)
    // Ước lượng: ~4MB/phút ở 256kbps + 15% margin
    const estimatedBytes = playlistCount * Math.max(1, minutesPerPlaylist) * 4 * 1024 * 1024
    const required = Math.round(estimatedBytes * 1.15)
    if (info.free < required) {
      throw new Error(
        `Ổ ${info.drive} còn ${formatBytes(info.free)} nhưng ${label} cần khoảng ${formatBytes(required)} (ước lượng +15%). Hãy dọn dung lượng trước khi chạy.`,
      )
    }
  } catch (err: any) {
    throw new Error(err?.message || `Không kiểm tra được dung lượng ổ đĩa cho ${label}`)
  }
}

async function ensureVideoDiskSpaceEstimate(
  dirPath: string,
  videoPaths: string[],
  outputCount: number,
  label: string,
): Promise<void> {
  try {
    const info = await getDiskSpace(dirPath)

    // Lấy mẫu kích thước video (tối đa 200 file) để ước lượng
    let totalSize = 0
    let sampleCount = 0
    for (let i = 0; i < videoPaths.length && sampleCount < 200; i++) {
      const p = videoPaths[i]
      try {
        const stat = fs.statSync(p)
        if (stat.isFile()) {
          totalSize += stat.size
          sampleCount++
        }
      } catch {
        // ignore file errors in sampling
      }
    }

    const avgSize = sampleCount > 0 ? totalSize / sampleCount : 200 * 1024 * 1024 // fallback 200MB
    const estimatedBytes = Math.round(avgSize * outputCount)
    const required = Math.round(estimatedBytes * 1.15)
    const minimumBuffer = 4 * 1024 * 1024 * 1024 // 4GB sàn
    const need = Math.max(required, minimumBuffer)

    if (info.free < need) {
      throw new Error(
        `Ổ ${info.drive} còn ${formatBytes(info.free)} nhưng ${label} cần khoảng ${formatBytes(need)} (ước lượng +15%, sàn 4GB). Hãy dọn dung lượng trước khi chạy.`,
      )
    }
  } catch (err: any) {
    throw new Error(err?.message || `Không kiểm tra được dung lượng ổ đĩa cho ${label}`)
  }
}

function throwIfCancelling() {
  if (isCancelling) {
    throw new Error('Autopilot đã được yêu cầu dừng.')
  }
}

function isFatalExportError(err: any): boolean {
  const msg = (err?.message || err?.error || `${err}` || '').toLowerCase()
  const fatalKeywords = [
    'disk',
    'space',
    'dung lượng',
    'không kiểm tra được dung lượng',
    'không tồn tại',
    'không có quyền',
    'playlist không tồn tại',
    'playlist không có bài',
    'thư mục xuất không tồn tại',
  ]
  return fatalKeywords.some((k) => msg.includes(k))
}

async function hasAnyVideoFile(folderPath: string, maxDepth = VIDEO_CHECK_MAX_DEPTH): Promise<boolean> {
  const stack: Array<{ dir: string; depth: number }> = [{ dir: folderPath, depth: 0 }]
  let visitedEntries = 0
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        visitedEntries++
        if (visitedEntries > VIDEO_CHECK_ENTRY_LIMIT) {
          console.warn('[Autopilot] Dừng kiểm tra video sớm vì vượt giới hạn entry.')
          return false
        }
        const full = path.join(dir, entry.name)
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (VIDEO_EXTS.has(ext)) return true
        } else if (entry.isDirectory() && depth < maxDepth) {
          stack.push({ dir: full, depth: depth + 1 })
        }
      }
    } catch (err) {
      console.warn('[Autopilot] Không đọc được thư mục video để kiểm tra file:', dir, err)
    }
  }
  return false
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string, onTimeout?: () => void): Promise<T> {
  if (timeoutMs <= 0) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        if (onTimeout) onTimeout()
      } catch {
        // ignore
      }
      reject(new Error(`${label} bị timeout sau ${Math.round(timeoutMs / 1000)} giây.`))
    }, timeoutMs)

    promise
      .then((val) => {
        clearTimeout(timer)
        resolve(val)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

function getDayFolder(base: string, dateCode: string, autoDaily: boolean): string {
  const trimmed = base.replace(/[\\/]+$/, '')
  return autoDaily ? path.join(trimmed, dateCode) : trimmed
}

function splitFolderLines(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(/[\r\n;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function pickFirstFolder(value: string | null | undefined): string | null {
  const list = splitFolderLines(value)
  return list.length > 0 ? list[0] : null
}

/**
 * In-place shuffle array để tiết kiệm memory (không copy array)
 * Sử dụng Fisher-Yates shuffle algorithm
 */
function shuffleArrayInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
}

/**
 * Quét video files đệ quy với progress callback
 */
async function collectVideoFilesRecursive(
  dir: string,
  onProgress?: (currentCount: number, currentDir: string) => void
): Promise<string[]> {
  const results: string[] = []
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    // Quét song song các subfolder để tăng tốc độ
    const subdirPromises: Promise<string[]>[] = []
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        subdirPromises.push(collectVideoFilesRecursive(full, onProgress))
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (VIDEO_EXTS.has(ext)) {
          results.push(full)
          // Emit progress mỗi khi tìm thấy file
          if (onProgress) {
            onProgress(results.length, dir)
          }
        }
      }
    }
    // Đợi tất cả subfolder quét xong
    if (subdirPromises.length > 0) {
      const subdirResults = await Promise.all(subdirPromises)
      for (const subdirFiles of subdirResults) {
        results.push(...subdirFiles)
        // Emit progress sau khi merge subfolder results
        if (onProgress && subdirFiles.length > 0) {
          onProgress(results.length, dir)
        }
      }
    }
  } catch (error) {
    console.warn('[Autopilot] Lỗi khi quét thư mục video:', dir, error)
  }
  return results
}

interface VideoBucketSummary {
  folder: string
  totalFiles: number
  selectedFiles: number
}

async function listSubFolders(folder: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(folder, { withFileTypes: true })
    const subdirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(folder, entry.name))
    return subdirs
  } catch (error) {
    console.warn('[Autopilot] Không đọc được thư mục con:', folder, error)
    return []
  }
}

async function prepareVideoBuckets(
  baseFoldersRaw: string,
  autoDaily: boolean,
  dateCode: string,
): Promise<string[]> {
  const baseFolders = splitFolderLines(baseFoldersRaw)
  const buckets: string[] = []

  for (const base of baseFolders) {
    const normalizedBase = autoDaily ? path.join(base.replace(/[\\/]+$/, ''), dateCode) : base
    try {
      const stat = await fsp.stat(normalizedBase)
      if (!stat.isDirectory()) {
        console.warn('[Autopilot] Bỏ qua vì không phải thư mục video:', normalizedBase)
        continue
      }
    } catch (error) {
      console.warn('[Autopilot] Không tìm thấy thư mục video:', normalizedBase, error)
      continue
    }

    const subdirs = await listSubFolders(normalizedBase)
    if (subdirs.length > 0) {
      buckets.push(...subdirs)
    } else {
      buckets.push(normalizedBase)
    }
  }

  return buckets
}

async function pickVideosFromFolders(
  baseFoldersRaw: string,
  dateCode: string,
  autoDaily: boolean,
  percent: number,
  minTotal: number,
): Promise<{ paths: string[]; summary: VideoBucketSummary[] }> {
  const buckets = await prepareVideoBuckets(baseFoldersRaw, autoDaily, dateCode)
  if (buckets.length === 0) {
    return { paths: [], summary: [] }
  }

  const summaries: VideoBucketSummary[] = []
  const p = Math.max(1, Math.min(100, Math.round(percent || 70)))

  emitLog('info', `[Bước 4] Bắt đầu quét ${buckets.length} thư mục video...`)
  
  // BƯỚC 1: Quét TẤT CẢ folder, thu thập TẤT CẢ video (không dừng sớm)
  const allFilesByFolder: Array<{ folder: string; files: string[] }> = []
  let totalScanned = 0
  
  for (let i = 0; i < buckets.length; i++) {
    if (isCancelling) break
    
    const folder = buckets[i]
    emitLog('info', `[Bước 4] Đang quét thư mục ${i + 1}/${buckets.length}: ${folder}`)
    
    // Quét với progress callback
    let folderFileCount = 0
    const allFiles = await collectVideoFilesRecursive(folder, (currentCount, currentDir) => {
      folderFileCount = currentCount
      totalScanned = allFilesByFolder.reduce((sum, item) => sum + item.files.length, 0) + currentCount
      // Emit progress mỗi 100 file để tránh spam log
      if (currentCount % 100 === 0 || currentCount === 1) {
        emitLog('info', `[Bước 4]   → Đã quét ${currentCount} video từ "${path.basename(currentDir)}"...`)
      }
    })
    
    emitLog('info', `[Bước 4] ✓ Thư mục ${i + 1}/${buckets.length}: Tìm thấy ${allFiles.length} video`)
    
    allFilesByFolder.push({ folder, files: allFiles })
    summaries.push({
      folder,
      totalFiles: allFiles.length,
      selectedFiles: 0, // Sẽ tính sau
    })
    
    totalScanned += allFiles.length
  }

  // BƯỚC 2: Gộp tất cả video lại
  const allFiles: string[] = []
  for (const item of allFilesByFolder) {
    allFiles.push(...item.files)
  }

  emitLog('info', `[Bước 4] Tổng cộng quét được ${allFiles.length} video từ ${buckets.length} thư mục`)

  if (allFiles.length === 0) {
    console.warn('[Autopilot] Không tìm thấy video nào trong tất cả thư mục')
    return { paths: [], summary: summaries }
  }

  // BƯỚC 3: Shuffle IN-PLACE để tiết kiệm memory và lấy X% từ tổng số
  emitLog('info', `[Bước 4] Đang shuffle ${allFiles.length} video...`)
  shuffleArrayInPlace(allFiles) // In-place shuffle, không copy array
  
  const percentCount = Math.max(1, Math.round((allFiles.length * p) / 100))
  const targetCount = Math.max(minTotal, percentCount) // Lấy ít nhất minTotal, hoặc X% nếu lớn hơn
  const selected = allFiles.slice(0, Math.min(targetCount, allFiles.length))

  emitLog('info', `[Bước 4] Đã chọn ${selected.length} video (${p}% = ${percentCount}, minTotal = ${minTotal}, tổng = ${allFiles.length})`)

  // Cập nhật selectedFiles cho mỗi folder (tính theo tỷ lệ)
  for (let i = 0; i < summaries.length; i++) {
    const item = allFilesByFolder[i]
    if (item.files.length > 0) {
      // Tính tỷ lệ video được chọn từ folder này
      const ratio = item.files.length / allFiles.length
      summaries[i].selectedFiles = Math.max(1, Math.round(selected.length * ratio))
    }
  }

  if (selected.length < minTotal) {
    console.warn(
      `[Autopilot] Tổng video đã chọn ${selected.length} < minTotal ${minTotal}. Có thể không đủ 1000 clip, nhưng vẫn tiếp tục ghép.`,
    )
  }

  return { paths: selected, summary: summaries }
}

function buildBaseOutputNameFromPreset(presetId: DayPresetId): string {
  switch (presetId) {
    case 'tomorrowland':
      return 'Tomorrowland_2025'
    case 'partymix':
      return 'Party_Mix_2025'
    default:
      return 'AutoMix_2025'
  }
}

/**
 * Sinh danh sách tên file output (không extension) theo quy tắc cơ bản:
 * - [index] + baseName
 * - Ví dụ: "1 Tomorrowland 2025 | Tiësto, Hardwell, W&W" (ở đây backend chỉ sinh phần text, dấu |/🔥 sẽ do UI quyết định sau)
 * 
 * Hiện tại backend sẽ tạo tiêu đề theo rule:
 *  - "1 Tomorrowland 2025 | Tiësto, Hardwell, W&W, Bassjackers, Blasterjaxx"
 *  - hoặc "1 Tomorrowland 2025 🔥 Tiësto, Hardwell, W&W, Bassjackers, Blasterjaxx"
 */
// Danh sách DJ mặc định để random (đã tổng hợp & loại bỏ trùng lặp, không bao gồm Tiësto vì là topDj mặc định)
const DEFAULT_DJS: string[] = [
  // Mainstream / Bigroom / EDM
  'David Guetta',
  'Calvin Harris',
  'Armin van Buuren',
  'Martin Garrix',
  'Skrillex',
  'Diplo',
  'Deadmau5',
  'Steve Aoki',
  'DJ Snake',
  'Afrojack',
  'Hardwell',
  'Kygo',
  'Alesso',
  'Zedd',
  'Alan Walker',
  'Eric Prydz',
  'Carl Cox',
  'Paul van Dyk',
  'Fatboy Slim',
  'Swedish House Mafia',
  'The Chainsmokers',
  'Daft Punk',
  'Above & Beyond',
  'Marshmello',
  'Avicii',
  'Nicky Romero',
  'Don Diablo',
  'Oliver Heldens',
  'R3HAB',
  'Fedde Le Grand',
  'Sander van Doorn',
  'Laidback Luke',
  'Quintino',
  'Dannic',
  'Brooks',
  'Julian Jordan',
  'KSHMR',
  'Dillon Francis',
  'A-Trak',
  'Boys Noize',
  'Duke Dumont',
  'MK',
  'Robin Schulz',
  'Felix Jaehn',
  'Lost Frequencies',
  'Sam Feldt',
  'Sigala',
  'Jax Jones',
  'Joel Corry',
  'Riton',
  'Claptone',
  'Purple Disco Machine',
  'Fisher',
  'Chris Lake',
  'John Summit',
  'Dom Dolla',
  'Vintage Culture',
  'Alok',
  'Benny Benassi',
  'Bob Sinclar',
  'Gigi D’Agostino',
  'Paul Oakenfold',
  'Roger Sanchez',
  'Sasha',
  'John Digweed',
  'Pete Tong',
  'Laurent Garnier',
  'David Morales',
  'Todd Terry',
  'Louie Vega',
  'Dennis Ferrer',
  'Hot Since 82',
  'Sonny Fodera',
  'Michael Bibi',
  'Patrick Topping',
  'Jamie Jones',
  'Seth Troxler',
  'Marco Carola',
  'Loco Dice',
  'Paco Osuna',
  'Joseph Capriati',

  // Techno / Tech House / Underground
  'Adam Beyer',
  'Richie Hawtin',
  'Maceo Plex',
  'Solomun',
  'Boris Brejcha',
  'Paul Kalkbrenner',
  'Sven Väth',
  'Chris Liebing',
  'Ben Klock',
  'Marcel Dettmann',
  'Jeff Mills',
  'Derrick May',
  'Kevin Saunderson',
  'Juan Atkins',
  'Green Velvet',
  'Black Coffee',
  'CamelPhat',
  'Gorgon City',
  'Meduza',
  'Keinemusik',
  'Markus Schulz',
  'Ferry Corsten',
  'Gareth Emery',
  'Andrew Rayel',
  'Ben Nicky',
  'Craig Connelly',
  'Giuseppe Ottaviani',
  'Paul Thomas',
  'John O’Callaghan',
  'Sean Tyas',
  'Bryan Kearney',

  // Psy / Goa / Trance & Progressive
  'Neelix',
  'Vini Vici',
  'Astrix',
  'Berg',
  'Infected Mushroom',
  'Shpongle',
  'Bicep',
  'Moderat',
  'Jon Hopkins',
  'Four Tet',
  'Bonobo',
  'Floating Points',
  'Caribou',
  'Disclosure',
  'The Blessed Madonna',
  'Kerri Chandler',
  'Franky Rizardo',
  'Joris Voorn',
  'Reinier Zonneveld',
  'Stephan Bodzin',
  'Oliver Koletzki',
  'NTO',
  'Pan-Pot',
  'Len Faki',
  'Dax J',
  'Adam X',
  'Rødhåd',
  'Tale Of Us',
  'Martinez Brothers',
  'Satin Jackets',
  'Lane 8',
  'Yotto',
  'Ben Böhmer',
  'Nora En Pure',
  'Rüfüs Du Sol',
  'Odesza',
  'Flume',
  'Porter Robinson',
  'Madeon',
  'San Holo',
  'Illenium',
  'Seven Lions',

  // Bass / Dubstep / DnB
  'Excision',
  'Zomboy',
  'Knife Party',
  'Noisia',
  'Pendulum',
  'Andy C',
  'Chase & Status',
  'Sub Focus',
  'Netsky',
  'Camo & Krooked',
  'Black Sun Empire',
  'Spor',
  'Rusko',
  'Borgore',
  'Getter',
  'Virtual Riot',
  'Barely Alive',
  'Ghastly',
  'TroyBoi',
  'RL Grime',
  'Baauer',
  'DJ Shadow',
]

function generateSimpleTitles(
  count: number,
  baseKeyword: string,
  dateCode: string | undefined,
  overrides?: DayPlanDetailOverrides,
  presetId?: DayPresetId,
): string[] {
  // Nếu bật chế độ tiêu đề thủ công và có danh sách tiêu đề tùy chỉnh
  if (overrides?.useCustomTitles && Array.isArray(overrides.customTitles) && overrides.customTitles.length > 0) {
    const customTitles = overrides.customTitles.map((t) => t.trim()).filter(Boolean)
    
    console.log(`[generateSimpleTitles] useCustomTitles=true, customTitles count=${customTitles.length}, needed=${count}`)
    if (customTitles.length > 0) {
      console.log(`[generateSimpleTitles] customTitles[0]=${customTitles[0]}`)
    }
    
    // Nếu số lượng tiêu đề tùy chỉnh >= số lượng cần, dùng trực tiếp
    if (customTitles.length >= count) {
      console.log(`[generateSimpleTitles] Using ${count} custom titles directly`)
      return customTitles.slice(0, count)
    }
    
    // Nếu thiếu, dùng tiêu đề tùy chỉnh cho các file đầu, phần còn lại dùng logic tự động
    const result: string[] = [...customTitles]
    const remaining = count - customTitles.length
    
    // Tạo tiêu đề tự động cho phần còn lại
    const safeBase = baseKeyword.trim() || 'AutoMix 2025'
    const topDj = (overrides?.topDj || 'Tiësto').trim()
    const variant: 'pipe' | 'fire' = overrides?.titleVariant || 'pipe'
    const allowRepeatAcross = overrides?.allowDjRepeatAcrossVideos ?? true
    const separator = variant === 'fire' ? '🔥' : '|'
    const usedDjsGlobal = new Set<string>()
    
    for (let i = 0; i < remaining; i++) {
      const orderNumber = customTitles.length + i + 1
      const needed = 4 // DJ2–DJ5
      let picked: string[] = []

      if (allowRepeatAcross) {
        const shuffled = [...DEFAULT_DJS].sort(() => Math.random() - 0.5)
        picked = shuffled.slice(0, needed)
      } else {
        const unused = DEFAULT_DJS.filter((dj) => !usedDjsGlobal.has(dj))
        const shuffledUnused = [...unused].sort(() => Math.random() - 0.5)
        picked.push(...shuffledUnused.slice(0, Math.min(needed, shuffledUnused.length)))

        if (picked.length < needed) {
          const remainingPool = DEFAULT_DJS.filter((dj) => !picked.includes(dj))
          const shuffledRemaining = [...remainingPool].sort(() => Math.random() - 0.5)
          picked.push(...shuffledRemaining.slice(0, needed - picked.length))
        }
      }

      if (!allowRepeatAcross) {
        for (const dj of picked) {
          usedDjsGlobal.add(dj)
        }
      }

      const djList = [topDj, ...picked].join(', ')
      const prefix = `${orderNumber} ${safeBase}`
      const title = `${prefix} ${separator} ${djList}`
      result.push(title)
    }
    
    return result
  }

  // Preset Custom + không dùng custom titles → đặt tên đơn giản "video 1, video 2, ..."
  if (presetId === 'custom' && !overrides?.useCustomTitles) {
    return Array.from({ length: count }, (_, i) => `video ${i + 1}`)
  }

  // Logic tạo tiêu đề tự động như cũ (khi không dùng custom titles)
  const safeBase = baseKeyword.trim() || 'AutoMix 2025'
  const topDj = (overrides?.topDj || 'Tiësto').trim()
  const variant: 'pipe' | 'fire' = overrides?.titleVariant || 'pipe'
  const allowRepeatAcross = overrides?.allowDjRepeatAcrossVideos ?? true
  const separator = variant === 'fire' ? '🔥' : '|'
  const titles: string[] = []
  const usedDjsGlobal = new Set<string>()

  for (let i = 0; i < count; i++) {
    const orderNumber = i + 1

    const needed = 4 // DJ2–DJ5
    let picked: string[] = []

    if (allowRepeatAcross) {
      // Cho phép trùng giữa các video → chỉ cần random 4 DJ bất kỳ, không trùng trong cùng title
      const shuffled = [...DEFAULT_DJS].sort(() => Math.random() - 0.5)
      picked = shuffled.slice(0, needed)
    } else {
      // Ưu tiên dùng các DJ CHƯA dùng ở video trước
      const unused = DEFAULT_DJS.filter((dj) => !usedDjsGlobal.has(dj))
      const shuffledUnused = [...unused].sort(() => Math.random() - 0.5)
      picked.push(...shuffledUnused.slice(0, Math.min(needed, shuffledUnused.length)))

      // Nếu không đủ 4 DJ (hết pool) → lấy thêm từ toàn bộ list, tránh trùng trong cùng title
      if (picked.length < needed) {
        const remainingPool = DEFAULT_DJS.filter((dj) => !picked.includes(dj))
        const shuffledRemaining = [...remainingPool].sort(() => Math.random() - 0.5)
        picked.push(...shuffledRemaining.slice(0, needed - picked.length))
      }
    }

    // Cập nhật global used nếu không cho phép trùng giữa các video
    if (!allowRepeatAcross) {
      for (const dj of picked) {
        usedDjsGlobal.add(dj)
      }
    }

    const djList = [topDj, ...picked].join(', ')
    const prefix = `${orderNumber} ${safeBase}`
    const title = `${prefix} ${separator} ${djList}`

    titles.push(title)
  }
  return titles
}

// Helper function để chạy export video
async function runExportVideoWithOptions(
  jobRequest: FinalExportJobRequest,
  dateCode: string,
  playlists: PlaylistDefinition[],
): Promise<void> {
  const requestId = jobRequest.requestId || randomUUID()
  
  // Plan first
  const plan = await planFinalExport(
    jobRequest.audioSource,
    jobRequest.videoSource,
    jobRequest.outputFolder,
    jobRequest.outputFilename,
    jobRequest.outputNames,
    jobRequest.priorityVideoSource
  )
  
  // Create emitter
  const emitter: FinalExportEmitter = {
    progress: (payload) => {
      const p = payload.percent ?? 0
      const currentIndex = payload.currentIndex ?? 0
      const totalOutputs = payload.totalOutputs ?? playlists.length
      emit({
        currentStep: 4,
        stepPercent: 60 + Math.round((p / 100) * 35),
        message:
          payload.status ??
          `Ngày ${dateCode}: Đang xuất video hoàn chỉnh (${p.toFixed ? p.toFixed(1) : p}% )...`,
      })
      if (payload.currentOutputFilename && currentIndex > 0) {
        emitLog('info', `[Bước 4] Đang xuất video ${currentIndex}/${totalOutputs}: ${payload.currentOutputFilename} (${p.toFixed(1)}%)`)
      }
    },
    done: () => {
      emit({
        currentStep: 5,
        stepPercent: 100,
        message: `Ngày ${dateCode}: Hoàn tất xuất video hoàn chỉnh.`,
      })
      emitLog('info', `[Bước 5] ✓ Ngày ${dateCode}: Hoàn tất xuất ${playlists.length} video hoàn chỉnh!`)
    },
    error: (err) => {
      emit({
        status: 'error',
        currentStep: 4,
        stepPercent: 0,
        message: `Ngày ${dateCode}: Lỗi khi xuất video hoàn chỉnh.`,
        error: err.message || err.error || 'Xuất video thất bại.',
      })
      emitLog('error', `[Bước 4] ✗ Lỗi khi xuất video: ${err.message || err.error || 'Xuất video thất bại.'}`)
    },
  }
  
  // Emit initial progress
  emitter.progress({
    requestId,
    stage: 'prepare-audio',
    percent: 0,
    timeSec: 0,
    totalDurationSec: 0,
    audioFileCount: plan.totalJobs,
    videoFileCount: plan.videoClips.length,
    totalOutputs: plan.totalJobs,
    status:
      plan.totalJobs > 1
        ? `Đang chuẩn bị ${plan.totalJobs} track audio...`
        : 'Đang chuẩn bị audio...',
  })
  
  // Execute final export
  await executeFinalExport(
    plan,
    requestId,
    emitter,
    jobRequest.shuffle || false,
    !!jobRequest.forceReencode,
    !!jobRequest.normalizeAudio,
    !!jobRequest.tracklistAuto,
    undefined, // subtitle removed
    undefined, // options removed
    jobRequest.useGpuEncoding || 'auto', // GPU encoding choice (default: 'auto')
    !!jobRequest.deleteSourceFiles, // Xóa file audio/video sau khi xuất xong
    !!jobRequest.unifyFormat,       // Chuẩn hóa tỉ lệ khung hình + FPS
    jobRequest.targetResolution,
    jobRequest.targetFps
  )
}

async function runAutopilotForDay(
  plan: DayPlanConfig,
  index: number,
  config: AutopilotConfig,
  scan: ScanMusicResult,
): Promise<void> {
  const { folders } = config

  // Pool tracking — set during video selection, used after export
  let _poolClipIds: string[] = []
  let _poolFingerprint = ''

  const dateCode = plan.dateCode || (() => {
    const now = new Date()
    const d = `${now.getDate()}`.padStart(2, '0')
    const m = `${now.getMonth() + 1}`.padStart(2, '0')
    return `${d}${m}`
  })()

  // Validate dateCode format
  if (!validateDateCode(dateCode)) {
    throw new Error(
      `DateCode "${dateCode}" không hợp lệ. DateCode phải có format ddMM (4 ký tự số, ví dụ: 0412 cho ngày 04 tháng 12).`
    )
  }

  const audioDir = getDayFolder(folders.rootAudio, dateCode, folders.autoCreateDailySubfolder)
  // Video: cho phép nhiều thư mục, mỗi thư mục sẽ được nối với dateCode (nếu bật autoDaily)
  const finalDir = getDayFolder(folders.rootFinal, dateCode, folders.autoCreateDailySubfolder)

  emit({
    currentDayIndex: index,
    currentStep: 1,
    stepPercent: 5,
    status: 'running',
    message: `Ngày ${dateCode}: Đang chuẩn bị thư mục output...`,
    videoSelectedCount: undefined,
    videoTargetMin: undefined,
  })
  emitLog('info', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  emitLog('info', `📅 Bắt đầu xử lý ngày: ${dateCode}`)
  emitLog('info', `[Bước 1] Ngày ${dateCode}: Đang chuẩn bị thư mục output...`)

  await ensureDir(audioDir)
  await ensureDir(finalDir)
  emitLog('info', `[Bước 1] ✓ Đã tạo thư mục Audio: ${audioDir}`)
  emitLog('info', `[Bước 1] ✓ Đã tạo thư mục Video: ${finalDir}`)

  throwIfCancelling()

  // Step 1: Use freshly scanned tracks (được quét trực tiếp trước khi chạy mỗi job)
  if (!scan?.tracks || scan.tracks.length === 0) {
    throw new Error('Không tìm thấy bài nhạc nào sau khi quét các thư mục ưu tiên / random.')
  }

  emit({
    currentStep: 1,
    stepPercent: 25,
    message: `Ngày ${dateCode}: Đang sử dụng ${scan.tracks.length} bài nhạc đã quét trực tiếp...`,
  })
  emitLog('info', `[Bước 1] Đã quét được ${scan.tracks.length} bài nhạc từ thư mục ưu tiên/random`)

  throwIfCancelling()

  // Step 2: Build playlists
  // Khai báo playlistCount và minutesPerPlaylist TRƯỚC KHI sử dụng
  const playlistCount = normalizeNumber(plan.playlistCount as any, 10)
  const minutesPerPlaylist = normalizeNumber(plan.minutesPerPlaylist as any, 30)
  
  emit({
    currentStep: 2,
    stepPercent: 30,
    message: `Ngày ${dateCode}: Đang tạo playlist...`,
  })
  emitLog('info', `[Bước 2] Ngày ${dateCode}: Đang tạo ${playlistCount} playlist, mỗi playlist ${minutesPerPlaylist} phút...`)

  if (playlistCount > MAX_PLAYLIST_COUNT_DEFAULT) {
    emitLog('warn', `[Bước 2] playlistCount=${playlistCount} vượt ngưỡng khuyến nghị ${MAX_PLAYLIST_COUNT_DEFAULT}. Vui lòng cân nhắc giảm số playlist hoặc tách ngày.`)
  }

  const overrides = plan.overrides || {}
  const prioritySelectionMode = overrides.prioritySelectionMode || 'auto'
  const pinnedFromOverrides =
    prioritySelectionMode === 'manual' && Array.isArray(overrides.priorityPinnedTrackIds)
      ? overrides.priorityPinnedTrackIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : []

  // Tính crossfade trước buildOptions để có thể inflate target duration khi build playlist
  const smoothTransitions = !!overrides.enableCrossfade
  const crossfadeSec = smoothTransitions
    ? (() => {
        const raw = normalizeNumber(
          overrides.crossfadeSeconds as any,
          4, // default 4s nếu bật nhưng không nhập
        )
        return Math.min(Math.max(raw, 1), 10)
      })()
    : undefined

  const buildOptions: BuildPlaylistsOptions = {
    tracks: scan.tracks,
    pinnedTrackIds: pinnedFromOverrides,
    playlistCount,
    targetDurationMinutes: minutesPerPlaylist,
    priorityRatioMin: 0.65,
    priorityRatioMax: 0.8,
    crossfadeDurationSec: crossfadeSec, // inflate target để bù overlap crossfade
  }

  clearPlaylists()
  const buildResult = buildPlaylists(buildOptions)
  const playlists = buildResult.playlists
  if (buildResult.warnings && buildResult.warnings.length > 0) {
    for (const w of buildResult.warnings) {
      emitLog('warn', `[Bước 2] ${w.message}`)
    }
  }
  savePlaylists(playlists)
  emitLog('info', `[Bước 2] Đã tạo thành công ${playlists.length} playlist`)

  await ensureAudioDiskSpaceEstimate(audioDir, playlists.length, minutesPerPlaylist, 'Xuất audio playlist (Autopilot)')

  throwIfCancelling()

  // Step 3: Export audio playlists
  emit({
    currentStep: 2,
    stepPercent: 40,
    message: `Ngày ${dateCode}: Đang xuất ${playlists.length} playlist thành file audio...`,
  })
  emitLog('info', `[Bước 2] Ngày ${dateCode}: Bắt đầu xuất ${playlists.length} playlist thành file audio...`)
  if (smoothTransitions) {
    emitLog('info', `[Bước 2] Crossfade: BẬT (${crossfadeSec}s)`)
  } else {
    emitLog('info', `[Bước 2] Crossfade: TẮT (concat copy-stream)`)
  }

  const maxAudioExportAttempts = 2
  for (let i = 0; i < playlists.length; i++) {
    throwIfCancelling()

    const pl = playlists[i]
    const fileNameBase = `${dateCode}_P${(i + 1).toString().padStart(2, '0')}`
    const exportRequestId = `autopilot-export-${dateCode}-${i}`
    const req: ExportPlaylistRequest = {
      playlistId: pl.id,
      outputDir: audioDir,
      fileName: fileNameBase,
      // Xuất AAC chuẩn: 48kHz, 384kbps để khớp khuyến nghị YouTube
      format: 'aac',
      bitrateKbps: 384,
      smoothTransitions,
      // Chỉ truyền crossfadeDurationSec khi smoothTransitions = true, giống với xuất nhạc thông thường
      crossfadeDurationSec: smoothTransitions ? crossfadeSec : undefined,
    }
    
    // Pass requestId để có thể cancel
    ;(req as any).requestId = exportRequestId

    emitLog('info', `[Bước 2] Đang xuất playlist ${i + 1}/${playlists.length}: ${fileNameBase}.m4a`)
    
    // Retry nhẹ khi export audio thất bại (không phải do cancel)
    let attempt = 0
    let lastError: any = null
    while (attempt < maxAudioExportAttempts) {
      attempt++
      const controller = new AbortController()
      activeAbortControllers.push(controller)
      try {
        // Thêm progress emitter để log real-time
        await exportPlaylistToFile(
          { ...req, signal: controller.signal } as ExportPlaylistRequest,
          (progress) => {
            const percent = progress.percent?.toFixed(1) ?? '0.0'
            const timeStr = formatDuration(progress.currentSec ?? 0)
            const totalTimeStr = formatDuration(progress.totalSec ?? 0)
            emitLog('info', `[Bước 2]   → Playlist ${i + 1}/${playlists.length}: ${percent}% (${timeStr}/${totalTimeStr})`)
          },
        )
        emitLog('info', `[Bước 2] ✓ Đã xuất xong playlist ${i + 1}/${playlists.length}: ${fileNameBase}.m4a`)
        break
      } catch (err: any) {
        lastError = err
        if (isCancelling || controller.signal.aborted) {
          throw err
        }
        if (isFatalExportError(err)) {
          throw err
        }
        emitLog('warn', `[Bước 2] Lỗi export playlist ${i + 1} (attempt ${attempt}/${maxAudioExportAttempts}): ${err?.message || err}`)
        if (attempt >= maxAudioExportAttempts) {
          throw err
        }
      } finally {
        // cleanup controller reference
        activeAbortControllers = activeAbortControllers.filter((c) => c !== controller)
      }
    }
    
    // Kiểm tra cancel sau mỗi export
    throwIfCancelling()

    const percent = 40 + Math.round(((i + 1) / playlists.length) * 20)
    emit({
      currentStep: 2,
      stepPercent: Math.min(60, percent),
      message: `Ngày ${dateCode}: Đã xuất ${i + 1}/${playlists.length} playlist audio...`,
    })
  }

  if (isCancelling) return

  // Step 4: Final export videos (1-1 mapping audio-files vs video-files)
  // Khai báo videoPickPercent TRƯỚC KHI sử dụng
  const videoPickPercent = normalizeNumber(
    overrides.videoPickPercent as any,
    70,
  )
  
  emit({
    currentStep: 3,
    stepPercent: 60,
    message: `Ngày ${dateCode}: Đang ghép video với audio (Final Export)...`,
  })
  emitLog('info', `[Bước 4] Ngày ${dateCode}: Đang chọn video từ thư mục (${videoPickPercent}% mỗi thư mục)...`)

  // Chuẩn bị danh sách video clips:
  // - Cho phép nhiều thư mục video đã cắt (mỗi dòng trong ô cấu hình)
  // - Mỗi thư mục chỉ lấy khoảng X% video (videoPickPercent) để tránh lấy hết

  const MIN_VIDEO_TOTAL = Math.max(100, folders.minVideoClipsTarget ?? 1000)
  const { paths: selectedVideoPaths, summary: videoSelectionSummary } = await withTimeout(
    pickVideosFromFolders(
      folders.rootVideo,
      dateCode,
      false, // Video: không tự động thêm subfolder theo ngày, dùng nguyên các thư mục user chọn
      videoPickPercent,
      MIN_VIDEO_TOTAL,
    ),
    VIDEO_PICK_TIMEOUT_MS,
    `Quét/Chọn video (Autopilot ngày ${dateCode})`,
    () => {
      emitLog('error', `[Autopilot] Timeout khi quét/chọn video cho ngày ${dateCode}, huỷ job.`)
      isCancelling = true
      videoJobManager.cancelAll()
    },
  )

  // Check cancellation sau khi chọn video
  if (isCancelling) return

  if (selectedVideoPaths.length === 0) {
    throw new Error(
      'Không tìm thấy video hợp lệ trong các thư mục video đã cắt. Hãy kiểm tra lại cấu hình thư mục và ngày (ddMM).',
    )
  }

  if (selectedVideoPaths.length < playlists.length) {
    throw new Error(
      `Số video được chọn (${selectedVideoPaths.length}) ít hơn số playlist/audio (${playlists.length}). Hãy tăng tỉ lệ chọn hoặc bổ sung thêm video.`,
    )
  }

  await ensureVideoDiskSpaceEstimate(finalDir, selectedVideoPaths, playlists.length, 'Xuất video hoàn chỉnh (Autopilot)')

  // ── Video Pool: sync + unique sequence ──────────────────────────────────────
  emitLog('info', `[Bước 4] Đang sync ${selectedVideoPaths.length} clip vào Video Pool...`)
  try {
    const { added, updated } = syncPoolWithFiles(selectedVideoPaths, (cur, total) => {
      if (cur % 500 === 0) emitLog('info', `[VideoPool] Đang sync ${cur}/${total}...`)
    })
    if (added > 0 || updated > 0) {
      emitLog('info', `[VideoPool] Sync xong: +${added} clip mới, ${updated} clip cập nhật path`)
    }

    // Chọn sequence UNIQUE (LRU + shuffle đến khi fingerprint mới)
    const poolResult = pickUniqueSequence(selectedVideoPaths, selectedVideoPaths.length, dateCode, 30)
    emitLog('info',
      `[VideoPool] Sequence: ${poolResult.isUnique ? '✅ Unique' : '⚠️ Có thể trùng'} | ` +
      `Thử: ${poolResult.attemptCount} lần | ` +
      `Tái dùng: ${poolResult.reusedCount}/${poolResult.totalAvailable} clip | ` +
      `Fingerprint: ${poolResult.fingerprint}`
    )

    // Ghi đè selectedVideoPaths bằng sequence unique từ pool
    // (poolResult.filePaths là cùng clips nhưng thứ tự LRU-shuffled unique)
    selectedVideoPaths.length = 0
    selectedVideoPaths.push(...poolResult.filePaths)

    // Ghi lại pool info vào local vars để markClipsUsed sau khi export xong
    _poolClipIds = poolResult.clipIds
    _poolFingerprint = poolResult.fingerprint

    const stats = getPoolStats()
    emitLog('info',
      `[VideoPool] Stats: ${stats.totalClips} clip trong pool | ` +
      `Chưa dùng: ${stats.neverUsed} | Dùng 24h qua: ${stats.usedInLast24h} | ` +
      `Tổng sessions: ${stats.totalSessions}`
    )
  } catch (poolErr: any) {
    emitLog('warn', `[VideoPool] Lỗi pool (fallback về random): ${poolErr?.message}`)
    // Fallback: shuffle random như cũ, không crash
    for (let i = selectedVideoPaths.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[selectedVideoPaths[i], selectedVideoPaths[j]] = [selectedVideoPaths[j], selectedVideoPaths[i]]
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  emit({
    currentStep: 4,
    stepPercent: 70,
    message: `Ngày ${dateCode}: Đã chọn ${selectedVideoPaths.length} clip video (mục tiêu ${MIN_VIDEO_TOTAL}).`,
    videoSelectedCount: selectedVideoPaths.length,
    videoTargetMin: MIN_VIDEO_TOTAL,
  })
  emitLog('info', `[Bước 4] Đã chọn ${selectedVideoPaths.length} clip video (mục tiêu: ${MIN_VIDEO_TOTAL})`)
  for (const s of videoSelectionSummary) {
    emitLog('info', `[Bước 4]   - ${s.folder}: ${s.selectedFiles}/${s.totalFiles} video`)
  }

  // Tạo danh sách audio paths theo đúng thứ tự playlists để đảm bảo mapping đúng
  // Thay vì dùng folder (sẽ sort theo tên), dùng files với paths đã được sắp xếp đúng
  const audioPaths: string[] = []
  for (let i = 0; i < playlists.length; i++) {
    const fileNameBase = `${dateCode}_P${(i + 1).toString().padStart(2, '0')}`
    const audioPath = path.join(audioDir, `${fileNameBase}.m4a`)
    // Kiểm tra file tồn tại trước khi thêm vào danh sách
    if (fs.existsSync(audioPath)) {
      audioPaths.push(audioPath)
    } else {
      console.warn(`[Autopilot] Audio file không tồn tại: ${audioPath}`)
    }
  }

  // Validation: Kiểm tra số lượng audio files có khớp với số playlists không
  if (audioPaths.length !== playlists.length) {
    throw new Error(
      `Số lượng audio files (${audioPaths.length}) không khớp với số playlists (${playlists.length}). Có thể một số playlist chưa được xuất thành công.`
    )
  }

  if (audioPaths.length === 0) {
    throw new Error(
      'Không tìm thấy file audio nào trong thư mục xuất. Hãy kiểm tra lại quá trình xuất audio.'
    )
  }

  emitLog('info', `[Bước 4] Đã tìm thấy ${audioPaths.length} file audio theo đúng thứ tự playlists`)

  const baseOutputName = buildBaseOutputNameFromPreset(plan.presetId)
  
  // Debug: Log overrides để kiểm tra customTitles
  if (overrides?.useCustomTitles) {
    emitLog('info', `[Bước 4] Debug: useCustomTitles=true, customTitles count=${overrides.customTitles?.length || 0}`)
    if (overrides.customTitles && overrides.customTitles.length > 0) {
      emitLog('info', `[Bước 4] Debug: customTitles[0]=${overrides.customTitles[0]}`)
    }
  } else {
    emitLog('info', `[Bước 4] Debug: useCustomTitles=${overrides?.useCustomTitles || false}`)
  }
  
  const outputNames = generateSimpleTitles(playlists.length, baseOutputName, dateCode, overrides, plan.presetId)
  
  // Debug: Log outputNames để kiểm tra kết quả
  if (outputNames.length > 0) {
    emitLog('info', `[Bước 4] Debug: outputNames[0]=${outputNames[0]}`)
  }

  const requestId = randomUUID()

  const jobRequest: FinalExportJobRequest = {
    requestId,
    // Dùng 'files' thay vì 'folder' để đảm bảo thứ tự audio files đúng với playlists
    audioSource: {
      type: 'files',
      path: audioPaths[0],
      paths: audioPaths,
    },
    videoSource: {
      type: 'files',
      path: selectedVideoPaths[0],
      paths: selectedVideoPaths,
    },
    outputFolder: finalDir,
    outputFilename: `${baseOutputName}.mp4`,
    outputNames,
    // Pool đã chọn sequence LRU-unique → KHÔNG shuffle lại để giữ đúng thứ tự
    shuffle: false,
    // Mặc định copy-stream video; nếu user chọn "Chuẩn hoá video đầu vào" thì re-encode + deep verify
    forceReencode: !!overrides.normalizeVideoInput,
    // Chuẩn hóa tỉ lệ khung hình + FPS (letterbox/pillarbox)
    unifyFormat: !!overrides.unifyVideoFormat,
    targetResolution: overrides.unifyVideoFormat ? (overrides.targetResolution || '1920x1080') : undefined,
    targetFps: overrides.unifyVideoFormat ? (overrides.targetFps || '30') : undefined,
    normalizeAudio: false,
    tracklistAuto: !!overrides.generateTracklist,
    priorityVideoSource:
      config.folders.priorityVideoFolder && config.folders.priorityVideoFolder.trim().length > 0
        ? (() => {
            const p = pickFirstFolder(config.folders.priorityVideoFolder)
            return p ? { type: 'folder' as const, path: p } : undefined
          })()
        : undefined,
  }

  emitLog('info', `[Bước 4] Ngày ${dateCode}: Bắt đầu xuất ${playlists.length} video hoàn chỉnh...`)
  if (overrides.normalizeVideoInput) {
    emitLog('info', `[Bước 4] Re-encode video: BẬT (chậm hơn nhưng an toàn hơn)`)
  } else {
    emitLog('info', `[Bước 4] Re-encode video: TẮT (copy-stream, nhanh)`)
  }
  if (overrides.unifyVideoFormat) {
    emitLog('info', `[Bước 4] Chuẩn hóa tỉ lệ khung hình: BẬT — ${overrides.targetResolution || '1920x1080'} @ ${overrides.targetFps || '30'} fps`)
  }
  if (overrides.generateTracklist) {
    emitLog('info', `[Bước 4] Tự động tạo tracklist: BẬT`)
  }

  await runExportVideoWithOptions(jobRequest, dateCode, playlists)

  // ── Đánh dấu clips đã dùng trong Video Pool (sau khi export xong) ────────────
  if (_poolClipIds.length > 0 && _poolFingerprint) {
    try {
      markClipsUsed(_poolClipIds, dateCode, _poolFingerprint)
      emitLog('info', `[VideoPool] ✅ Đã ghi ${_poolClipIds.length} clip vào pool history (session: ${_poolFingerprint})`)
    } catch (poolErr: any) {
      emitLog('warn', `[VideoPool] Không thể ghi pool history: ${poolErr?.message}`)
    }
  }
}

export async function startAutopilot(config: AutopilotConfig): Promise<void> {
  if (currentProgress.status === 'running') {
    throw new Error('Autopilot đang chạy. Hãy dừng job hiện tại trước khi chạy job mới.')
  }

  // Set status synchronously ngay sau guard để tránh race condition
  // nếu có 2 call đồng thời (cả 2 pass guard trước khi emit chạy)
  currentProgress.status = 'running'

  activeAbortControllers = []
  isCancelling = false
  emit({
    status: 'running',
    currentDayIndex: null,
    currentStep: 1,
    stepPercent: 0,
    message: 'Bắt đầu chạy Autopilot...',
    error: undefined,
    videoSelectedCount: undefined,
    videoTargetMin: undefined,
  })
  emitLog('info', '🚀 Bắt đầu Autopilot...')

  try {
    if (!config.dayPlans || config.dayPlans.length === 0) {
      throw new Error('Chưa có kế hoạch ngày nào trong Autopilot.')
    }

    const validPlans = config.dayPlans.filter(
      (p) =>
        normalizeNumber(p.playlistCount as any, 0) > 0 &&
        normalizeNumber(p.minutesPerPlaylist as any, 0) > 0,
    )

    if (validPlans.length === 0) {
      throw new Error('Tất cả kế hoạch ngày đều có số playlist hoặc thời lượng không hợp lệ.')
    }
    const totalDays = validPlans.length

    const priorityFolder = pickFirstFolder(config.folders.priorityMusicFolder)
    const randomFolder = pickFirstFolder(config.folders.randomMusicFolder)
    if (!priorityFolder && !randomFolder) {
      throw new Error('Hãy chọn ít nhất một thư mục nhạc ưu tiên hoặc nhạc random cho Autopilot.')
    }

    // Validate thư mục nhạc
    if (priorityFolder) {
      await validateFolder(priorityFolder, 'Thư mục nhạc ưu tiên')
    }
    if (randomFolder) {
      await validateFolder(randomFolder, 'Thư mục nhạc random')
    }

    // Validate thư mục output — auto-create nếu chưa tồn tại (không block first-run)
    await fsp.mkdir(config.folders.rootAudio, { recursive: true }).catch(() => {})
    await validateFolder(config.folders.rootAudio, 'Thư mục xuất Audio')
    await validateMultiFolder(config.folders.rootVideo, 'Thư mục gốc Video đã cắt')
    await fsp.mkdir(config.folders.rootFinal, { recursive: true }).catch(() => {})
    await validateFolder(config.folders.rootFinal, 'Thư mục xuất Video hoàn chỉnh')

    // Validate dateCode cho tất cả day plans
    const dateCodeSeen = new Set<string>()
    for (let i = 0; i < validPlans.length; i++) {
      const plan = validPlans[i]
      const planDateCode = plan.dateCode || (() => {
        const now = new Date()
        const d = `${now.getDate()}`.padStart(2, '0')
        const m = `${now.getMonth() + 1}`.padStart(2, '0')
        return `${d}${m}`
      })()
      
      if (!validateDateCode(planDateCode)) {
        throw new Error(
          `Day plan ${i + 1}: DateCode "${planDateCode}" không hợp lệ. DateCode phải có format ddMM (4 ký tự số, ví dụ: 0412 cho ngày 04 tháng 12).`
        )
      }

      const playlistCount = normalizeNumber(plan.playlistCount as any, 0)
      if (playlistCount > MAX_PLAYLIST_COUNT) {
        throw new Error(
          `Day plan ${i + 1}: playlistCount=${playlistCount} vượt giới hạn tối đa ${MAX_PLAYLIST_COUNT}. Giảm số playlist hoặc tách ngày.`,
        )
      }

      if (dateCodeSeen.has(planDateCode)) {
        throw new Error(`Có 2 kế hoạch dùng cùng dateCode "${planDateCode}". Hãy chỉnh lại để tránh ghi đè output.`)
      }
      dateCodeSeen.add(planDateCode)
    }

    emit({
      currentStep: 1,
      stepPercent: 5,
      message: 'Đang quét thư mục nhạc ưu tiên / random...',
    })

    const scanResult = await withTimeout(
      scanMusicFolders({
        priorityFolder,
        randomFolder,
      }),
      SCAN_TIMEOUT_MS,
      'Quét thư mục nhạc (Autopilot)',
      () => {
        emitLog('error', '[Autopilot] Timeout khi quét thư mục nhạc, huỷ job.')
        isCancelling = true
        videoJobManager.cancelAll()
      },
    )

    emit({
      currentStep: 1,
      stepPercent: 15,
      message: `Đã quét ${scanResult.summary.totalCount} bài nhạc (ưu tiên ${scanResult.summary.priorityCount}, random ${scanResult.summary.randomCount}).`,
    })

    const failedDays: string[] = []

    // Process all days sequentially
    for (let i = 0; i < validPlans.length; i++) {
      if (isCancelling) break
      const plan = validPlans[i]
      const totalDays = validPlans.length
      emit({
        currentDayIndex: i,
        currentStep: 1,
        stepPercent: currentProgress.stepPercent,
        message: `Bắt đầu ngày ${plan.dateCode} (${i + 1}/${totalDays})...`,
      })
      emitLog('info', `📅 Bắt đầu ngày ${plan.dateCode} (${i + 1}/${totalDays})`)
      try {
        await runAutopilotForDay(plan, i, { ...config, dayPlans: validPlans }, scanResult)
        const overallPercent = Math.round(((i + 1) / totalDays) * 100)
        emit({
          currentDayIndex: i,
          currentStep: 5,
          stepPercent: Math.max(currentProgress.stepPercent ?? 0, overallPercent),
          message: `Hoàn tất ngày ${plan.dateCode} (${i + 1}/${totalDays}). Tiến độ tổng: ${overallPercent}%.`,
        })
        emitLog('info', `✓ Hoàn tất ngày ${plan.dateCode} (${i + 1}/${totalDays}). Tiến độ tổng: ${overallPercent}%.`)
      } catch (err: any) {
        failedDays.push(plan.dateCode || `plan-${i + 1}`)
        emitLog('error', `[Autopilot] Lỗi ở ngày ${plan.dateCode || i + 1}: ${err?.message || err}`)
        if (isCancelling) break
      }
    }

    if (isCancelling) {
      emit({
        status: 'idle',
        currentStep: null,
        stepPercent: 0,
        message: 'Đã dừng Autopilot theo yêu cầu người dùng.',
      })
    } else if (failedDays.length > 0) {
      emit({
        status: 'completed_with_errors',
        currentStep: currentProgress.currentStep,
        stepPercent: currentProgress.stepPercent,
        message: `Autopilot hoàn tất nhưng có ${failedDays.length} ngày lỗi: ${failedDays.join(', ')}`,
        error: `Ngày lỗi: ${failedDays.join(', ')}`,
      })
    } else {
      // Không có lỗi và không bị cancel → hoàn tất
      emit({
        status: 'completed',
        currentStep: 5,
        stepPercent: 100,
        message: 'Autopilot đã hoàn tất tất cả ngày trong kế hoạch.',
      })
    }
  } catch (error: any) {
    emit({
      status: 'error',
      currentStep: currentProgress.currentStep,
      error: error?.message || 'Lỗi không xác định trong Autopilot.',
      message: error?.message || 'Lỗi khi chạy Autopilot.',
    })
    throw error
  } finally {
    const finalStatus = currentProgress.status as AutopilotStatus
    isCancelling = false
    activeAbortControllers = []
    // Reset status to idle so autopilot can be started again
    if (finalStatus === 'running' || finalStatus === 'cancelling') {
      currentProgress.status = 'idle'
    }
    // Không null hoá listener khi error/cancel — listener được register 1 lần từ main.ts
    // Nếu null hoá, batch tiếp theo sẽ không gửi được event nào về UI → freeze hoàn toàn
  }
}


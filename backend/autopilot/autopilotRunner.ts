import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildPlaylists, clearPlaylists, savePlaylists, type BuildPlaylistsOptions, type PlaylistDefinition } from '../music/playlistEngine'
import { exportPlaylistToFile, type ExportPlaylistRequest } from '../music/exportAudio'
import { scanAudioFilesAsTracks, scanMusicFolders, type ScanMusicResult } from '../music/scanMusic'
import { type FinalExportJobRequest, type FinalExportEmitter, planFinalExport, executeFinalExport } from '../video/finalExport'
import { videoJobManager } from '../video/videoJobManager'
import { getDiskSpace, formatBytes, isEnospcError } from '../utils/diskSpace'
import { syncPoolWithFiles, pickUniqueSequence, markClipsUsed, getPoolStats } from './videoPool'
import type { FinalExportDonePayload } from '../../shared/videoFinalExportChannels'

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
  /** Nhạc nối thêm cuối mỗi playlist audio. */
  endingAudioPaths?: string[]
  /** Số clip video tối thiểu cần chọn (mặc định 1000) */
  minVideoClipsTarget?: number
}

export interface AutopilotRuntimeOverrides {
  finalExportUseGpuEncoding?: 'gpu' | 'cpu' | 'auto'
  requireGpuForVideoEncode?: boolean
  healthCheckNotice?: string
  healthCheckNoticeLevel?: 'info' | 'warn'
  resolvedGpuProfile?: 'modern' | 'legacy'
  resolvedGpuFfmpegPath?: string
  resolvedGpuEncoder?: 'nvenc' | 'amf' | 'videotoolbox'
  gpuFallbackReason?: string
  gpuNormalizeMode?: 'gpu_heavy' | 'software'
  gpuNormalizeReason?: string
}

export interface AutopilotConfig {
  dayPlans: DayPlanConfig[]
  folders: AutopilotFoldersConfig
  runtimeOverrides?: AutopilotRuntimeOverrides
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

export type AutopilotLogVerbosity = 'normal' | 'verbose'

export interface AutopilotLogEntry {
  seq: number
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  verbosity: AutopilotLogVerbosity
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
let logListener: ((log: AutopilotLogEntry) => void) | null = null
let activeAbortControllers: AbortController[] = []
let lastBroadcastProgress: AutopilotProgress | null = null
let lastBroadcastAt = 0
let pendingBroadcastProgress: AutopilotProgress | null = null
let progressBroadcastTimer: ReturnType<typeof setTimeout> | null = null
let pendingLogFileLines: string[] = []
let logFileFlushTimer: ReturnType<typeof setTimeout> | null = null
let logFileFlushChain: Promise<void> = Promise.resolve()
const LOG_BUFFER_LIMIT = 500
let recentLogs: AutopilotLogEntry[] = []
let nextLogSequence = 1

// FIX H-04: Heartbeat timestamp — updated on every emit() call.
// If `status === 'running'` but heartbeat is stale (> STALE_LOCK_TIMEOUT_MS),
// the lock is considered stuck and will be auto-reset by `startAutopilot()`.
let lastHeartbeatAt = 0
let activeRunToken: string | null = null
const STALE_LOCK_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes without any progress update = stuck

const SCAN_TIMEOUT_MS = 10 * 60 * 1000 // 10 phút
const VIDEO_PICK_TIMEOUT_MS = 10 * 60 * 1000 // 10 phút
const AUDIO_EXPORT_TIMEOUT_MS = 30 * 60 * 1000 // 30 phút per playlist (audio export có thể lâu với crossfade)
const MAX_PLAYLIST_COUNT_DEFAULT = 200 // cảnh báo
const MAX_PLAYLIST_COUNT = 500 // giới hạn cứng
const MAX_LOG_FILES = 5
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024 // 5MB

function cancelAutopilotVideoJobs() {
  for (const requestId of videoJobManager.getAllJobIds()) {
    if (requestId.startsWith('autopilot-')) {
      videoJobManager.cancelJob(requestId)
    }
  }
}
const MAX_SUMMARY_LOG_ITEMS = 20
const AUDIO_PROGRESS_LOG_STEP_PCT = 10
const AUDIO_PROGRESS_LOG_INTERVAL_MS = 10_000
const AUDIO_PROGRESS_STALL_WARN_MS = 60_000
const AUDIO_PROGRESS_STALL_CHECK_INTERVAL_MS = 15_000
const FINAL_EXPORT_PROGRESS_NORMAL_LOG_STEP_PCT = 10
const FINAL_EXPORT_PROGRESS_NORMAL_LOG_INTERVAL_MS = 20_000
const FINAL_EXPORT_PROGRESS_VERBOSE_LOG_STEP_PCT = 5
const FINAL_EXPORT_PROGRESS_VERBOSE_LOG_INTERVAL_MS = 5_000
const VIDEO_SCAN_PROGRESS_LOG_EVERY = 250
const PROGRESS_NOTIFY_INTERVAL_MS = 350
const PROGRESS_NOTIFY_STEP_DELTA = 2
const PROGRESS_NOTIFY_VIDEO_DELTA = 25
const LOG_FILE_FLUSH_INTERVAL_MS = 250
const LOG_FILE_FLUSH_BATCH_SIZE = 25
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
const LOG_FILE_PREFIX = 'autopilot'
const VIDEO_CHECK_MAX_DEPTH = 8
const VIDEO_CHECK_ENTRY_LIMIT = 10_000

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.avi', '.wmv', '.webm'])
const TERMINAL_AUTOPILOT_STATUSES = new Set<AutopilotStatus>(['idle', 'completed', 'completed_with_errors', 'error'])
let currentLogVerbosity: AutopilotLogVerbosity = 'normal'

export function getAutopilotProgress(): AutopilotProgress {
  return currentProgress
}

export function onAutopilotProgress(listener: AutopilotProgressListener) {
  progressListener = listener
}

export function offAutopilotProgress() {
  progressListener = null
  pendingBroadcastProgress = null
  if (progressBroadcastTimer) {
    clearTimeout(progressBroadcastTimer)
    progressBroadcastTimer = null
  }
}

function shouldBroadcastProgressImmediately(progress: AutopilotProgress): boolean {
  if (!lastBroadcastProgress) return true
  if (progress.status !== lastBroadcastProgress.status) return true
  if (progress.currentDayIndex !== lastBroadcastProgress.currentDayIndex) return true
  if (progress.currentStep !== lastBroadcastProgress.currentStep) return true
  if (progress.error !== lastBroadcastProgress.error) return true
  if (TERMINAL_AUTOPILOT_STATUSES.has(progress.status)) return true
  return false
}

function broadcastProgressNow(progress: AutopilotProgress) {
  const snapshot: AutopilotProgress = { ...progress }
  pendingBroadcastProgress = null
  if (progressBroadcastTimer) {
    clearTimeout(progressBroadcastTimer)
    progressBroadcastTimer = null
  }
  lastBroadcastProgress = snapshot
  lastBroadcastAt = Date.now()
  if (progressListener) {
    progressListener(snapshot)
  }
}

function scheduleProgressBroadcast(progress: AutopilotProgress) {
  if (!progressListener) return

  const now = Date.now()
  const last = lastBroadcastProgress
  const stepDelta = Math.abs((progress.stepPercent ?? 0) - (last?.stepPercent ?? 0))
  const videoDelta = Math.abs((progress.videoSelectedCount ?? 0) - (last?.videoSelectedCount ?? 0))
  const timeElapsed = now - lastBroadcastAt

  if (
    shouldBroadcastProgressImmediately(progress) ||
    timeElapsed >= PROGRESS_NOTIFY_INTERVAL_MS ||
    stepDelta >= PROGRESS_NOTIFY_STEP_DELTA ||
    videoDelta >= PROGRESS_NOTIFY_VIDEO_DELTA
  ) {
    broadcastProgressNow(progress)
    return
  }

  pendingBroadcastProgress = progress
  if (!progressBroadcastTimer) {
    const delay = Math.max(0, PROGRESS_NOTIFY_INTERVAL_MS - timeElapsed)
    progressBroadcastTimer = setTimeout(() => {
      progressBroadcastTimer = null
      if (!pendingBroadcastProgress) return
      const nextProgress = pendingBroadcastProgress
      const nextStepDelta = Math.abs((nextProgress.stepPercent ?? 0) - (lastBroadcastProgress?.stepPercent ?? 0))
      const nextVideoDelta = Math.abs((nextProgress.videoSelectedCount ?? 0) - (lastBroadcastProgress?.videoSelectedCount ?? 0))
      const nextMessageChanged = nextProgress.message !== lastBroadcastProgress?.message
      if (
        nextMessageChanged ||
        nextStepDelta > 0 ||
        nextVideoDelta > 0 ||
        nextProgress.status !== lastBroadcastProgress?.status
      ) {
        broadcastProgressNow(nextProgress)
      } else {
        pendingBroadcastProgress = null
      }
    }, delay)
  }
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
  // FIX H-04: Update heartbeat on every progress emit so staleness can be detected
  lastHeartbeatAt = Date.now()
  scheduleProgressBroadcast(currentProgress)
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

let ensuredLogDirPath: string | null = null

function ensureLogDir(): string {
  const logDir = getLogDir()
  if (ensuredLogDirPath === logDir) return logDir
  try {
    fs.mkdirSync(logDir, { recursive: true })
    ensuredLogDirPath = logDir
  } catch (err) {
    console.warn('[Autopilot] Không tạo được thư mục log:', err)
  }
  return logDir
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

function scheduleLogFileFlush(delayMs: number) {
  if (logFileFlushTimer) {
    if (delayMs > 0) return
    clearTimeout(logFileFlushTimer)
  }
  logFileFlushTimer = setTimeout(() => {
    logFileFlushTimer = null
    flushBufferedLogsToFile().catch(err => console.warn('[Autopilot] Ghi log file thất bại:', err))
  }, delayMs)
}

async function flushBufferedLogsToFile(): Promise<void> {
  if (pendingLogFileLines.length === 0) return
  const basePath = path.join(ensureLogDir(), `${LOG_FILE_PREFIX}.log`)
  const payload = pendingLogFileLines.join('')
  pendingLogFileLines = []

  // PERF: Reset chain sau mỗi cycle để tránh promise chain grow vô hạn (memory leak)
  logFileFlushChain = logFileFlushChain
    .then(async () => {
      await rotateLogsIfNeeded(basePath)
      await fsp.appendFile(basePath, payload, 'utf-8')
    })
    .catch(err => {
      console.warn('[Autopilot] Ghi log file thất bại:', err)
    })
    .finally(() => {
      // Reset chain — giải phóng references đến các closures cũ
      logFileFlushChain = Promise.resolve()
    })

  await logFileFlushChain
}

function appendLogToFile(entry: { timestamp: string; level: 'info' | 'warn' | 'error'; message: string }) {
  const line = `${entry.timestamp} [${entry.level.toUpperCase()}] ${entry.message}\n`
  pendingLogFileLines.push(line)
  const shouldFlushImmediately =
    entry.level === 'error' || pendingLogFileLines.length >= LOG_FILE_FLUSH_BATCH_SIZE
  scheduleLogFileFlush(shouldFlushImmediately ? 0 : LOG_FILE_FLUSH_INTERVAL_MS)
}

function shouldEmitLogForVerbosity(verbosity: AutopilotLogVerbosity): boolean {
  return currentLogVerbosity === 'verbose' || verbosity === 'normal'
}

type EmitLogOptions = {
  skipListener?: boolean
  skipFile?: boolean
  skipConsole?: boolean
}

function describeAutopilotError(err: any): string {
  const parts = [err?.message || err?.error || String(err) || 'Lỗi không xác định']
  if (err?.code) parts.push(`code=${err.code}`)
  if (err?.errno) parts.push(`errno=${err.errno}`)
  if (err?.syscall) parts.push(`syscall=${err.syscall}`)
  if (err?.path) parts.push(`path=${err.path}`)
  if (err?.exitCode !== undefined) parts.push(`exitCode=${err.exitCode}`)
  if (err?.cause?.message) parts.push(`cause=${err.cause.message}`)
  return parts.filter(Boolean).join(' | ')
}

function buildAutopilotFixHint(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('enospc') || lower.includes('dung lượng') || lower.includes('no space left') || lower.includes('disk full')) {
    return 'Cách xử lý: giải phóng dung lượng ổ đĩa hoặc chọn thư mục output sang ổ còn trống nhiều hơn.'
  }
  if (lower.includes('eacces') || lower.includes('eperm') || lower.includes('không có quyền') || lower.includes('permission denied') || lower.includes('access is denied')) {
    return 'Cách xử lý: kiểm tra quyền ghi/đọc thư mục, đóng file đang mở, bỏ read-only hoặc chạy app với quyền phù hợp.'
  }
  if (lower.includes('enoent') || lower.includes('không tồn tại') || lower.includes('not found') || lower.includes('no such file')) {
    return 'Cách xử lý: kiểm tra lại đường dẫn thư mục/file đầu vào; nếu dùng thư mục theo ngày, chắc chắn thư mục ngày đó đã tồn tại.'
  }
  if (lower.includes('timeout')) {
    return 'Cách xử lý: giảm số playlist/clip, kiểm tra ổ đĩa/FFmpeg có bị treo, hoặc thử chạy lại với tập dữ liệu nhỏ hơn.'
  }
  if (lower.includes('ffmpeg')) {
    return 'Cách xử lý: kiểm tra file media bị lỗi/codec lạ, thử bật chuẩn hóa video hoặc loại file đang gây lỗi rồi chạy lại.'
  }
  if (lower.includes('không tìm thấy bài nhạc')) {
    return 'Cách xử lý: chọn đúng thư mục nhạc ưu tiên/random và đảm bảo bên trong có file audio hỗ trợ.'
  }
  if (lower.includes('không tìm thấy video') || lower.includes('không đủ video')) {
    return 'Cách xử lý: chọn đúng thư mục video đã cắt, tăng số clip video hoặc giảm mục tiêu số clip tối thiểu.'
  }
  return 'Cách xử lý: xem dòng lỗi ngay trước đó để biết bước hỏng, kiểm tra lại input/output của bước đó rồi chạy lại.'
}

function emitDetailedErrorLog(prefix: string, err: any) {
  const detail = describeAutopilotError(err)
  emitLog('error', `${prefix}: ${detail}\n${buildAutopilotFixHint(detail)}`)
}

function emitLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  verbosity: AutopilotLogVerbosity = 'normal',
  options: EmitLogOptions = {},
) {
  const shouldEmitLive = shouldEmitLogForVerbosity(verbosity)
  const timestamp = new Date().toLocaleTimeString('vi-VN', { hour12: false })
  const logEntry: AutopilotLogEntry = {
    seq: nextLogSequence++,
    timestamp,
    level,
    message,
    verbosity,
  }
  recentLogs.push(logEntry)
  if (recentLogs.length > LOG_BUFFER_LIMIT) {
    recentLogs = recentLogs.slice(-LOG_BUFFER_LIMIT)
  }
  if (shouldEmitLive && logListener && !options.skipListener) {
    logListener(logEntry)
  }
  if (!options.skipFile) {
    appendLogToFile(logEntry)
  }
  if (options.skipConsole) return
  // Cũng log vào console
  if (level === 'error') {
    console.error(`[Autopilot] ${message}`)
  } else if (level === 'warn') {
    console.warn(`[Autopilot] ${message}`)
  } else if (shouldEmitLive) {
    console.log(`[Autopilot] ${message}`)
  }
}

function emitVerboseLog(level: 'info' | 'warn' | 'error', message: string) {
  emitLog(level, message, 'verbose')
}

/**
 * Gộp nhiều dòng log thành 1 entry duy nhất (giảm IPC spam).
 * Mỗi phần tử trong `lines` sẽ nối bằng `\n`.
 */
function emitLogBlock(
  level: 'info' | 'warn' | 'error',
  lines: string[],
  verbosity: AutopilotLogVerbosity = 'normal',
) {
  if (lines.length === 0) return
  emitLog(level, lines.join('\n'), verbosity)
}

export function onAutopilotLog(listener: (log: AutopilotLogEntry) => void) {
  logListener = listener
}

export function offAutopilotLog() {
  logListener = null
}

export function getAutopilotLogVerbosity(): AutopilotLogVerbosity {
  return currentLogVerbosity
}

export function setAutopilotLogVerbosity(verbosity: AutopilotLogVerbosity | string | null | undefined): AutopilotLogVerbosity {
  currentLogVerbosity = verbosity === 'verbose' ? 'verbose' : 'normal'
  return currentLogVerbosity
}

export function getRecentAutopilotLogs(limit = LOG_BUFFER_LIMIT): AutopilotLogEntry[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : LOG_BUFFER_LIMIT
  if (safeLimit === 0) return []
  return recentLogs.slice(-safeLimit)
}

export const __autopilotTestUtils = {
  resetRecentLogs() {
    recentLogs = []
    nextLogSequence = 1
    currentLogVerbosity = 'normal'
    pendingLogFileLines = []
    if (logFileFlushTimer) {
      clearTimeout(logFileFlushTimer)
      logFileFlushTimer = null
    }
    activeRunToken = null
    lastHeartbeatAt = 0
    isCancelling = false
    activeAbortControllers = []
    currentProgress = {
      status: 'idle',
      currentDayIndex: null,
      currentStep: null,
      stepPercent: 0,
      message: undefined,
      error: undefined,
      videoSelectedCount: undefined,
      videoTargetMin: undefined,
    }
  },
  seedRecentLogs(entries: AutopilotLogEntry[]) {
    recentLogs = entries.slice(-LOG_BUFFER_LIMIT)
    nextLogSequence =
      recentLogs.reduce((maxSeq, entry) => Math.max(maxSeq, entry.seq), 0) + 1
  },
  setLogVerbosity(verbosity: AutopilotLogVerbosity) {
    currentLogVerbosity = verbosity
  },
  emitLogForTest(
    level: 'info' | 'warn' | 'error',
    message: string,
    verbosity: AutopilotLogVerbosity = 'normal',
  ) {
    emitLog(level, message, verbosity, {
      skipListener: true,
      skipFile: true,
      skipConsole: true,
    })
  },
}

export function cancelAutopilot() {
  if (currentProgress.status === 'running' || currentProgress.status === 'paused') {
    isCancelling = true
    emit({ status: 'cancelling', message: 'Đang dừng Autopilot, huỷ các job FFmpeg hiện tại...' })
    try {
      // Kill toàn bộ FFmpeg jobs đang chạy (export audio, final export, v.v.)
      cancelAutopilotVideoJobs()
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

/**
 * FIX H-04: Force-reset the autopilot status lock.
 *
 * Use this as a last-resort escape hatch when the autopilot is stuck in
 * 'running'/'cancelling' and auto-detection hasn't kicked in yet.
 * Exposed as an IPC handler so the UI can offer a "Force Reset" button.
 *
 * This does NOT gracefully stop FFmpeg processes — it only resets the
 * module-level singleton state so a new run can start.
 */
export function forceResetAutopilot(): { reset: boolean; previousStatus: string } {
  const previousStatus = currentProgress.status
  if (previousStatus === 'idle' || previousStatus === 'completed' || previousStatus === 'error' || previousStatus === 'completed_with_errors') {
    return { reset: false, previousStatus }
  }

  console.warn(`[Autopilot] Force reset requested. Previous status: ${previousStatus}`)

  // Kill any active video jobs
  try { cancelAutopilotVideoJobs() } catch {}

  // Abort any active controllers
  for (const ctrl of activeAbortControllers) {
    try { ctrl.abort() } catch {}
  }
  activeAbortControllers = []

  isCancelling = false
  activeRunToken = null
  currentProgress = {
    status: 'idle',
    currentDayIndex: null,
    currentStep: null,
    stepPercent: 0,
    message: 'Đã force reset Autopilot.',
  }
  lastHeartbeatAt = 0
  scheduleProgressBroadcast(currentProgress)

  return { reset: true, previousStatus }
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
export function validateDateCode(dateCode: string): boolean {
  if (!dateCode || typeof dateCode !== 'string') return false
  if (dateCode.length !== 4) return false
  if (!/^\d{4}$/.test(dateCode)) return false
  
  const day = parseInt(dateCode.substring(0, 2), 10)
  const month = parseInt(dateCode.substring(2, 4), 10)
  
  if (isNaN(day) || isNaN(month)) return false
  if (month < 1 || month > 12) return false
  if (day < 1) return false
  
  // Kiểm tra số ngày hợp lệ trong tháng
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= daysInMonth[month - 1]
}

export async function startAutopilot(
  config: AutopilotConfig,
  preparedConfig?: PreparedAutopilotStartContext,
): Promise<void> {
  if (
    currentProgress.status === 'running' ||
    currentProgress.status === 'paused' ||
    currentProgress.status === 'cancelling'
  ) {
    const staleDuration = Date.now() - lastHeartbeatAt
    // Recover from stale lock when heartbeat is older than STALE_LOCK_TIMEOUT_MS.
    // Do NOT gate on `!activeRunToken` — when a previous run crashes after setting
    // activeRunToken but before the finally clears it, the token stays non-null forever
    // and the recovery branch would never trigger. The recovery itself nulls the token.
    if (lastHeartbeatAt > 0 && staleDuration > STALE_LOCK_TIMEOUT_MS) {
      console.warn(
        `[Autopilot] Detected stale status='${currentProgress.status}' after ${Math.round(staleDuration / 1000)}s (token=${activeRunToken ? 'present-but-stale' : 'absent'}). Resetting to idle.`,
      )
      currentProgress.status = 'idle'
      isCancelling = false
      activeAbortControllers = []
      activeRunToken = null
    } else {
      throw new Error('Autopilot đang chạy. Hãy dừng job hiện tại trước khi chạy job mới.')
    }
  }

  const runToken = randomUUID()
  activeRunToken = runToken
  currentProgress.status = 'running'
  lastHeartbeatAt = Date.now()
  recentLogs = []
  nextLogSequence = 1
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
  if (config.runtimeOverrides?.healthCheckNotice) {
    emitLog(
      config.runtimeOverrides.healthCheckNoticeLevel ?? 'info',
      config.runtimeOverrides.healthCheckNotice,
    )
  }

  try {
    const prepared = preparedConfig ?? await validateAutopilotStartConfig(config)
    const { validPlans, priorityFolder, randomFolder } = prepared
    const normalizedPlans = validPlans.map((plan) => ({
      ...plan,
      dateCode: resolveAutopilotDateCode(plan.dateCode),
    }))
    const totalDays = normalizedPlans.length

    emit({
      currentStep: 1,
      stepPercent: 5,
      message: 'Đang quét thư mục nhạc ưu tiên / random...',
    })

    const scanController = new AbortController()
    activeAbortControllers.push(scanController)
    let lastScanProgressAt = 0
    let lastScanLogAt = 0
    let lastScanDiscovered = -1
    let lastScanProbeBucket = -1
    let scanResult: ScanMusicResult

    try {
      scanResult = await withTimeout(
        scanMusicFolders(
          {
            priorityFolder,
            randomFolder,
            forceRescan: true,
            persist: false,
          },
          {
            signal: scanController.signal,
            onProgress: (progress) => {
              const nowMs = Date.now()

              if (progress.phase === 'discover') {
                const discovered = progress.filesDiscovered ?? 0
                if (discovered !== lastScanDiscovered || nowMs - lastScanProgressAt >= 4000) {
                  lastScanDiscovered = discovered
                  lastScanProgressAt = nowMs
                  emit({
                    currentStep: 1,
                    stepPercent: 5,
                    message: `Đang quét nhạc ${progress.folderType}... đã thấy ${discovered} file.`,
                  })
                }

                if (nowMs - lastScanLogAt >= 15000) {
                  lastScanLogAt = nowMs
                  emitVerboseLog(
                    'info',
                    `[Bước 1] Scan ${progress.folderType}: ${progress.directoriesScanned ?? 0} thư mục, ${discovered} file.`,
                  )
                }
                return
              }

              const processed = progress.filesProcessed ?? 0
              const totalFiles = Math.max(progress.totalFiles ?? 0, 1)
              const probeBucket = Math.min(9, Math.floor((processed / totalFiles) * 10))
              if (probeBucket !== lastScanProbeBucket || nowMs - lastScanProgressAt >= 3000) {
                lastScanProbeBucket = probeBucket
                lastScanProgressAt = nowMs
                emit({
                  currentStep: 1,
                  stepPercent: Math.min(14, 5 + probeBucket),
                  message: `Đang đọc metadata nhạc ${progress.folderType}: ${processed}/${totalFiles} file.`,
                })
              }
            },
          },
        ),
        SCAN_TIMEOUT_MS,
        'Quét thư mục nhạc (Autopilot)',
        () => {
          emitLog('error', '[Autopilot] Timeout khi quét thư mục nhạc, huỷ job.')
          isCancelling = true
          cancelAutopilotVideoJobs()
          scanController.abort()
        },
      )
    } finally {
      activeAbortControllers = activeAbortControllers.filter((controller) => controller !== scanController)
    }

    emit({
      currentStep: 1,
      stepPercent: 15,
      message: `Đã quét ${scanResult.summary.totalCount} bài nhạc (ưu tiên ${scanResult.summary.priorityCount}, random ${scanResult.summary.randomCount}).`,
    })

    const failedDays: { dateCode: string; error: string }[] = []
    const succeededDays: string[] = []
    const startTime = Date.now()

    for (let i = 0; i < normalizedPlans.length; i++) {
      if (isCancelling) break

      const plan = normalizedPlans[i]
      const dayStartTime = Date.now()

      emit({
        currentDayIndex: i,
        currentStep: 1,
        stepPercent: currentProgress.stepPercent,
        message: `Bắt đầu ngày ${plan.dateCode} (${i + 1}/${totalDays})...`,
      })
      emitLog('info', `📅 Bắt đầu ngày ${plan.dateCode} (${i + 1}/${totalDays})`)

      try {
        await runAutopilotForDay(plan, i, { ...config, dayPlans: normalizedPlans }, scanResult)
        const dayElapsed = Math.round((Date.now() - dayStartTime) / 1000)
        const dayElapsedStr = formatDuration(dayElapsed)
        succeededDays.push(plan.dateCode)
        const overallPercent = Math.round(((i + 1) / totalDays) * 100)

        emit({
          currentDayIndex: i,
          currentStep: 5,
          stepPercent: Math.max(currentProgress.stepPercent ?? 0, overallPercent),
          message: `Hoàn tất ngày ${plan.dateCode} (${i + 1}/${totalDays}). Tiến độ tổng: ${overallPercent}%.`,
        })
        emitLog(
          'info',
          `✓ Hoàn tất ngày ${plan.dateCode} (${i + 1}/${totalDays}) — thời gian: ${dayElapsedStr}. Tiến độ tổng: ${overallPercent}%.`,
        )
      } catch (err: any) {
        const dayElapsed = Math.round((Date.now() - dayStartTime) / 1000)
        const dayElapsedStr = formatDuration(dayElapsed)
        const errorMsg = describeAutopilotError(err)
        failedDays.push({ dateCode: plan.dateCode, error: errorMsg })
        emitDetailedErrorLog(`[Autopilot] ❌ Lỗi ở ngày ${plan.dateCode} (sau ${dayElapsedStr})`, err)
        if (isCancelling) break
      }
    }

    const totalElapsed = Math.round((Date.now() - startTime) / 1000)
    const totalElapsedStr = formatDuration(totalElapsed)
    const failedDateCodes = failedDays.map((day) => day.dateCode)

    const summaryLines: string[] = [
      '',
      '╔══════════════════════════════════════════════════════════╗',
      '║           📊 BÁO CÁO TỔNG KẾT AUTOPILOT                ║',
      '╠══════════════════════════════════════════════════════════╣',
      `║  ✅ ${succeededDays.length}/${normalizedPlans.length} ngày thành công${succeededDays.length > 0 ? ` (${succeededDays.join(', ')})` : ''}`,
    ]
    if (failedDays.length > 0) {
      summaryLines.push(`║  ❌ ${failedDays.length} ngày thất bại (${failedDateCodes.join(', ')})`)
    }
    summaryLines.push(`║  ⏱️  Tổng thời gian: ${totalElapsedStr}`)
    if (isCancelling) {
      summaryLines.push('║  ⚠️  Đã bị huỷ bởi người dùng')
    }
    summaryLines.push('╚══════════════════════════════════════════════════════════╝')

    if (failedDays.length > 0) {
      summaryLines.push('')
      summaryLines.push('📋 CHI TIẾT LỖI:')
      for (const failedDay of failedDays) {
        summaryLines.push(`  • Ngày ${failedDay.dateCode}: ${failedDay.error.slice(0, 200)}`)
      }
      summaryLines.push('💡 Cách xử lý: đọc dòng "Cách xử lý" ngay dưới lỗi của từng ngày; thường cần kiểm tra thư mục input/output, quyền truy cập, dung lượng ổ đĩa hoặc file media lỗi.')
    }
    emitLogBlock('info', summaryLines)

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
        message: `Autopilot hoàn tất — ${succeededDays.length}/${normalizedPlans.length} ngày thành công, ${failedDays.length} ngày lỗi (${failedDateCodes.join(', ')}). Tổng: ${totalElapsedStr}.`,
        error: `Ngày lỗi: ${failedDateCodes.join(', ')}`,
      })
    } else {
      emit({
        status: 'completed',
        currentStep: 5,
        stepPercent: 100,
        message: `Autopilot đã hoàn tất tất cả ${normalizedPlans.length} ngày trong kế hoạch. Tổng: ${totalElapsedStr}.`,
      })
    }
  } catch (error: any) {
    if (error?.code === 'ABORT_ERR') {
      emit({
        status: 'idle',
        currentStep: null,
        stepPercent: 0,
        message: 'Đã dừng Autopilot theo yêu cầu người dùng.',
      })
      return
    }

    const detailedError = describeAutopilotError(error)
    emitDetailedErrorLog('[Autopilot] ❌ Lỗi tổng', error)
    emit({
      status: 'error',
      currentStep: currentProgress.currentStep,
      error: detailedError || 'Lỗi không xác định trong Autopilot.',
      message: detailedError || 'Lỗi khi chạy Autopilot.',
    })
    throw error
  } finally {
    const finalStatus = currentProgress.status as AutopilotStatus
    isCancelling = false
    activeAbortControllers = []
    if (logFileFlushTimer) {
      clearTimeout(logFileFlushTimer)
      logFileFlushTimer = null
    }
    await flushBufferedLogsToFile()
    if (activeRunToken === runToken) {
      activeRunToken = null
    }
    if (finalStatus === 'running' || finalStatus === 'cancelling') {
      currentProgress.status = 'idle'
    }
  }
}

export interface PreparedAutopilotStartContext {
  validPlans: DayPlanConfig[]
  priorityFolder: string | null
  randomFolder: string | null
}

const AUTOPILOT_RX_PIPE = /\|/g
const AUTOPILOT_RX_INVALID_CHARS = /[<>:"/\\?*\x00-\x1F]/g
const AUTOPILOT_RX_MULTI_SPACE = /\s+/g
const AUTOPILOT_RX_MULTI_UNDERSCORE_MID = /([^ ])_+([^ ])/g
const AUTOPILOT_RX_MULTI_UNDERSCORE_END = /([^ ])_+$/g
const AUTOPILOT_RX_MULTI_UNDERSCORE_START = /^_+([^ ])/g
const AUTOPILOT_RX_TRIM_UNDERSCORE_SPACE = /^[\s_]+|[\s_]+$/g

function resolveAutopilotDateCode(dateCode?: string | null): string {
  if (dateCode && dateCode.trim().length > 0) {
    return dateCode.trim()
  }

  const now = new Date()
  const day = `${now.getDate()}`.padStart(2, '0')
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  return `${day}${month}`
}

function sanitizeAutopilotOutputName(name: string): string {
  let result = name.replace(AUTOPILOT_RX_PIPE, ' _ ')
  result = result.replace(AUTOPILOT_RX_INVALID_CHARS, '_')
  result = result.replace(AUTOPILOT_RX_MULTI_SPACE, ' ')
  result = result.replace(AUTOPILOT_RX_MULTI_UNDERSCORE_MID, '$1_$2')
  result = result.replace(AUTOPILOT_RX_MULTI_UNDERSCORE_END, '$1_')
  result = result.replace(AUTOPILOT_RX_MULTI_UNDERSCORE_START, '_$1')
  result = result.replace(AUTOPILOT_RX_TRIM_UNDERSCORE_SPACE, '')
  return result.trim()
}

function buildProjectedAutopilotOutputPaths(
  plan: DayPlanConfig,
  folders: AutopilotFoldersConfig,
): string[] {
  const dateCode = resolveAutopilotDateCode(plan.dateCode)
  const finalDir = getDayFolder(folders.rootFinal, dateCode, folders.autoCreateDailySubfolder)
  const playlistCount = normalizeNumber(plan.playlistCount as any, 0)
  const baseOutputName = buildBaseOutputNameFromPreset(plan.presetId)
  const outputNames = generateSimpleTitles(
    playlistCount,
    baseOutputName,
    dateCode,
    plan.overrides,
    plan.presetId,
  )

  return outputNames.map((name) => {
    const sanitized = sanitizeAutopilotOutputName(name) || 'output'
    const fileName = sanitized.endsWith('.mp4') ? sanitized : `${sanitized}.mp4`
    return path.join(finalDir, fileName)
  })
}

function assertNoAutopilotOutputCollisions(
  plans: DayPlanConfig[],
  folders: AutopilotFoldersConfig,
): void {
  if (folders.autoCreateDailySubfolder || plans.length <= 1) return

  const seen = new Map<string, { dateCode: string; outputPath: string }>()
  const collisions: Array<{ first: string; second: string; outputPath: string }> = []

  for (const plan of plans) {
    const dateCode = resolveAutopilotDateCode(plan.dateCode)
    const outputPaths = buildProjectedAutopilotOutputPaths(plan, folders)
    for (const outputPath of outputPaths) {
      const key = outputPath.toLowerCase()
      const previous = seen.get(key)
      if (previous) {
        collisions.push({
          first: previous.dateCode,
          second: dateCode,
          outputPath,
        })
        continue
      }
      seen.set(key, { dateCode, outputPath })
    }
  }

  if (collisions.length === 0) return

  const sample = collisions
    .slice(0, 3)
    .map((collision) => `${collision.outputPath} (${collision.first} <> ${collision.second})`)
    .join(' | ')

  throw new Error(
    `Phat hien trung ten file output giua cac ngay khi tat autoCreateDailySubfolder: ${sample}. ` +
      'Hay bat tao subfolder theo ngay hoac doi ten output/custom title de tranh ghi de.',
  )
}

export async function validateAutopilotStartConfig(
  config: AutopilotConfig,
): Promise<PreparedAutopilotStartContext> {
  if (!config.dayPlans || config.dayPlans.length === 0) {
    throw new Error('Chua co ke hoach ngay nao trong Autopilot.')
  }

  const validPlans = config.dayPlans.filter(
    (plan) =>
      normalizeNumber(plan.playlistCount as any, 0) > 0 &&
      normalizeNumber(plan.minutesPerPlaylist as any, 0) > 0,
  )

  if (validPlans.length === 0) {
    throw new Error('Tat ca ke hoach ngay deu co so playlist hoac thoi luong khong hop le.')
  }

  const priorityFolder = pickFirstFolder(config.folders.priorityMusicFolder)
  const randomFolder = pickFirstFolder(config.folders.randomMusicFolder)
  if (!priorityFolder && !randomFolder) {
    throw new Error('Hay chon it nhat mot thu muc nhac uu tien hoac nhac random cho Autopilot.')
  }

  if (priorityFolder) {
    await validateFolder(priorityFolder, 'Thu muc nhac uu tien')
  }
  if (randomFolder) {
    await validateFolder(randomFolder, 'Thu muc nhac random')
  }

  await fsp.mkdir(config.folders.rootAudio, { recursive: true }).catch(() => {})
  await validateFolder(config.folders.rootAudio, 'Thu muc xuat Audio')
  await validateMultiFolder(config.folders.rootVideo, 'Thu muc goc Video da cat')
  await fsp.mkdir(config.folders.rootFinal, { recursive: true }).catch(() => {})
  await validateFolder(config.folders.rootFinal, 'Thu muc xuat Video hoan chinh')

  const dateCodeSeen = new Set<string>()
  for (let index = 0; index < validPlans.length; index++) {
    const plan = validPlans[index]
    const planDateCode = resolveAutopilotDateCode(plan.dateCode)

    if (!validateDateCode(planDateCode)) {
      throw new Error(
        `Day plan ${index + 1}: DateCode "${planDateCode}" khong hop le. DateCode phai co format ddMM (4 ky tu so, vi du: 0412 cho ngay 04 thang 12).`,
      )
    }

    const playlistCount = normalizeNumber(plan.playlistCount as any, 0)
    if (playlistCount > MAX_PLAYLIST_COUNT) {
      throw new Error(
        `Day plan ${index + 1}: playlistCount=${playlistCount} vuot gioi han toi da ${MAX_PLAYLIST_COUNT}. Giam so playlist hoac tach ngay.`,
      )
    }

    if (dateCodeSeen.has(planDateCode)) {
      throw new Error(`Co 2 ke hoach dung cung dateCode "${planDateCode}". Hay chinh lai de tranh ghi de output.`)
    }
    dateCodeSeen.add(planDateCode)
  }

  assertNoAutopilotOutputCollisions(validPlans, config.folders)

  return {
    validPlans,
    priorityFolder,
    randomFolder,
  }
}

function createStallHeartbeat(
  stallWarnMs: number,
  checkIntervalMs: number,
  onStall: (stalledForMs: number) => void,
) {
  let lastActivityAt = Date.now()
  let lastReportedBucket = 0

  const timer = setInterval(() => {
    const stalledForMs = Date.now() - lastActivityAt
    if (stalledForMs < stallWarnMs) return
    const bucket = Math.floor(stalledForMs / stallWarnMs)
    if (bucket <= lastReportedBucket) return
    lastReportedBucket = bucket
    onStall(stalledForMs)
  }, checkIntervalMs)

  if (typeof timer.unref === 'function') {
    timer.unref()
  }

  return {
    markActivity() {
      lastActivityAt = Date.now()
      lastReportedBucket = 0
    },
    stop() {
      clearInterval(timer)
    },
  }
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
  // ── Priority 1: Structural Node.js error codes (locale-independent) ──
  // These are always reliable regardless of Windows language settings.
  const errCode = (err?.code || '').toUpperCase()
  const FATAL_NODE_CODES = new Set([
    'ENOSPC',   // No space left on device
    'EACCES',   // Permission denied
    'EPERM',    // Operation not permitted
    'ENOENT',   // No such file or directory (missing output dir)
    'EROFS',    // Read-only file system
    'EMFILE',   // Too many open files (system-level, not retryable)
    'ENFILE',   // File table overflow (system-level)
  ])
  if (errCode && FATAL_NODE_CODES.has(errCode)) return true

  // ── Priority 2: Structured ENOSPC classifier (checks errno, code, nested fields) ──
  if (isEnospcError(err)) return true

  // ── Priority 3: FFmpeg exit codes that indicate non-transient failures ──
  // FFmpeg returns specific exit codes on certain fatal conditions.
  // Exit code 1 is generic (could be transient), but higher codes often aren't.
  const exitCode = err?.exitCode ?? err?.status
  if (typeof exitCode === 'number') {
    // Exit code 69 = EX_UNAVAILABLE (resource not available, e.g. disk full)
    // Exit code 73 = EX_CANTCREAT (can't create output file)
    // Exit code 74 = EX_IOERR (I/O error)
    if ([69, 73, 74].includes(exitCode)) return true
  }

  // ── Priority 4: String matching fallback (catches app-level Vietnamese messages) ──
  // Only used for messages generated by our own code (not FFmpeg stderr),
  // so locale is controlled.
  const msg = (err?.message || err?.error || `${err}` || '').toLowerCase()
  const fatalKeywords = [
    // App-generated messages (controlled locale — Vietnamese)
    'dung lượng',
    'không kiểm tra được dung lượng',
    'không tồn tại',
    'không có quyền',
    'playlist không tồn tại',
    'playlist không có bài',
    'thư mục xuất không tồn tại',
    // English fallback patterns (for FFmpeg stderr on English systems)
    'no space left',
    'not enough space',
    'disk full',
    'permission denied',
    'access is denied',
    'read-only file system',
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
  onProgress?: (currentCount: number, currentDir: string) => void,
  maxDepth: number = 10,
  currentDepth: number = 0
): Promise<string[]> {
  const results: string[] = []
  if (currentDepth >= maxDepth) {
    console.warn(`[Autopilot] Đã đạt giới hạn độ sâu quét (${maxDepth}), bỏ qua: ${dir}`)
    return results
  }
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    // Quét song song các subfolder để tăng tốc độ
    const subdirPromises: Promise<string[]>[] = []
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      // Bỏ qua symlinks để tránh vòng lặp vô hạn
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        subdirPromises.push(collectVideoFilesRecursive(full, onProgress, maxDepth, currentDepth + 1))
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

  emitVerboseLog('info', `[Bước 3] Bắt đầu quét ${buckets.length} thư mục video...`)
  
  // BƯỚC 1: Quét TẤT CẢ folder, thu thập TẤT CẢ video (không dừng sớm)
  const allFilesByFolder: Array<{ folder: string; files: string[] }> = []
  // FIX BUG-4: totalScanned chỉ dùng trong callback để tính real-time progress,
  // KHÔNG cộng thêm sau vòng lặp (tránh double-count)
  let totalScanned = 0

  for (let i = 0; i < buckets.length; i++) {
    if (isCancelling) break

    const folder = buckets[i]
    emitVerboseLog('info', `[Bước 3] Đang quét thư mục ${i + 1}/${buckets.length}: ${folder}`)

    // Emit progress (UI heartbeat) — cho user biết app vẫn đang chạy
    emit({
      currentStep: 3,
      stepPercent: 60 + Math.round(((i + 1) / buckets.length) * 10),
      message: `Đang quét video... (${i + 1}/${buckets.length} thư mục)`,
    })

    // Quét với progress callback
    let folderFileCount = 0
    const previouslyScanned = allFilesByFolder.reduce((sum, item) => sum + item.files.length, 0)
    const allFiles = await collectVideoFilesRecursive(folder, (currentCount, currentDir) => {
      folderFileCount = currentCount
      totalScanned = previouslyScanned + currentCount
      // Emit progress theo nhịp thưa hơn để tránh spam IPC/log khi scan thư mục lớn
      if (currentCount % VIDEO_SCAN_PROGRESS_LOG_EVERY === 0 || currentCount === 1) {
        emitVerboseLog('info', `[Bước 3]   → Đã quét ${currentCount} video từ "${path.basename(currentDir)}"...`)
      }
    })

    emitVerboseLog('info', `[Bước 3] ✓ Thư mục ${i + 1}/${buckets.length}: Tìm thấy ${allFiles.length} video`)

    allFilesByFolder.push({ folder, files: allFiles })
    summaries.push({
      folder,
      totalFiles: allFiles.length,
      selectedFiles: 0, // Sẽ tính sau
    })

    // FIX BUG-4: Cập nhật totalScanned chính xác sau khi folder scan xong
    totalScanned = previouslyScanned + allFiles.length
  }

  // BƯỚC 2: Gộp tất cả video lại
  const allFiles: string[] = []
  for (const item of allFilesByFolder) {
    allFiles.push(...item.files)
  }

  emitVerboseLog('info', `[Bước 3] Tổng cộng quét được ${allFiles.length} video từ ${buckets.length} thư mục`)

  if (allFiles.length === 0) {
    console.warn('[Autopilot] Không tìm thấy video nào trong tất cả thư mục')
    return { paths: [], summary: summaries }
  }

  // BƯỚC 3: Shuffle IN-PLACE để tiết kiệm memory và lấy X% từ tổng số
  emitVerboseLog('info', `[Bước 3] Đang shuffle ${allFiles.length} video...`)
  shuffleArrayInPlace(allFiles) // In-place shuffle, không copy array
  
  const percentCount = Math.max(1, Math.round((allFiles.length * p) / 100))
  const targetCount = Math.max(minTotal, percentCount) // Lấy ít nhất minTotal, hoặc X% nếu lớn hơn
  const selected = allFiles.slice(0, Math.min(targetCount, allFiles.length))

  emitLog('info', `[Bước 3] Đã chọn ${selected.length}/${allFiles.length} video (${p}%, min ${minTotal}) từ ${buckets.length} thư mục`)

  // FIX BUG-5: Đếm thực tế số video được chọn từ mỗi folder thay vì ước lượng bằng ratio.
  // Sau shuffle + slice, cần đếm xem selected[] chứa bao nhiêu file từ mỗi folder.
  const selectedSet = new Set(selected)
  for (let i = 0; i < summaries.length; i++) {
    const item = allFilesByFolder[i]
    let count = 0
    for (const f of item.files) {
      if (selectedSet.has(f)) count++
    }
    summaries[i].selectedFiles = count
  }

  if (selected.length < minTotal) {
    console.warn(
      `[Autopilot] Tổng video đã chọn ${selected.length} < minTotal ${minTotal}. Có thể không đủ 1000 clip, nhưng vẫn tiếp tục ghép.`,
    )
  }

  return { paths: selected, summary: summaries }
}

function buildBaseOutputNameFromPreset(presetId: DayPresetId): string {
  const year = new Date().getFullYear()
  switch (presetId) {
    case 'tomorrowland':
      return `Tomorrowland_${year}`
    case 'partymix':
      return `Party_Mix_${year}`
    default:
      return `AutoMix_${year}`
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
    const safeBase = baseKeyword.trim() || `AutoMix ${new Date().getFullYear()}`
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
        const shuffled = [...DEFAULT_DJS]; shuffleArrayInPlace(shuffled)
        picked = shuffled.slice(0, needed)
      } else {
        const unused = DEFAULT_DJS.filter((dj) => !usedDjsGlobal.has(dj))
        const shuffledUnused = [...unused]; shuffleArrayInPlace(shuffledUnused)
        picked.push(...shuffledUnused.slice(0, Math.min(needed, shuffledUnused.length)))

        if (picked.length < needed) {
          const remainingPool = DEFAULT_DJS.filter((dj) => !picked.includes(dj))
          const shuffledRemaining = [...remainingPool]; shuffleArrayInPlace(shuffledRemaining)
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
  const safeBase = baseKeyword.trim() || `AutoMix ${new Date().getFullYear()}`
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
      const shuffled = [...DEFAULT_DJS]; shuffleArrayInPlace(shuffled)
      picked = shuffled.slice(0, needed)
    } else {
      // Ưu tiên dùng các DJ CHƯA dùng ở video trước
      const unused = DEFAULT_DJS.filter((dj) => !usedDjsGlobal.has(dj))
      const shuffledUnused = [...unused]; shuffleArrayInPlace(shuffledUnused)
      picked.push(...shuffledUnused.slice(0, Math.min(needed, shuffledUnused.length)))

      // Nếu không đủ 4 DJ (hết pool) → lấy thêm từ toàn bộ list, tránh trùng trong cùng title
      if (picked.length < needed) {
        const remainingPool = DEFAULT_DJS.filter((dj) => !picked.includes(dj))
        const shuffledRemaining = [...remainingPool]; shuffleArrayInPlace(shuffledRemaining)
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
  preferredPreTranscodeMode: 'gpu_heavy' | 'software' = 'software',
): Promise<void> {
  const requestId = jobRequest.requestId || randomUUID()
  let donePayload: FinalExportDonePayload | null = null
  let lastNormalProgressLogAt = 0
  let lastNormalProgressBucket = -1
  let lastNormalProgressJobIndex = -1
  let lastVerboseProgressLogAt = 0
  let lastVerboseProgressBucket = -1
  let lastVerboseProgressJobIndex = -1
  
  // Plan first
  const plan = await planFinalExport(
    jobRequest.audioSource,
    jobRequest.videoSource,
    jobRequest.outputFolder,
    jobRequest.outputFilename,
    jobRequest.outputNames,
    jobRequest.priorityVideoSource,
    jobRequest.imageSource,
    jobRequest.endingAudio
  )
  
  // Create emitter
  const emitter: FinalExportEmitter = {
    progress: (payload) => {
      const p = payload.percent ?? 0
      const currentIndex = payload.currentIndex ?? 0
      const totalOutputs = payload.totalOutputs ?? playlists.length
      const now = Date.now()
      const normalProgressBucket = Math.floor(p / FINAL_EXPORT_PROGRESS_NORMAL_LOG_STEP_PCT)
      const verboseProgressBucket = Math.floor(p / FINAL_EXPORT_PROGRESS_VERBOSE_LOG_STEP_PCT)
      const shouldLogNormalProgress =
        !!payload.currentOutputFilename &&
        currentIndex > 0 &&
        (
          currentIndex !== lastNormalProgressJobIndex ||
          normalProgressBucket > lastNormalProgressBucket ||
          p >= 100 ||
          now - lastNormalProgressLogAt >= FINAL_EXPORT_PROGRESS_NORMAL_LOG_INTERVAL_MS
        )
      const shouldLogVerboseProgress =
        !!payload.currentOutputFilename &&
        currentIndex > 0 &&
        (
          currentIndex !== lastVerboseProgressJobIndex ||
          verboseProgressBucket > lastVerboseProgressBucket ||
          p >= 100 ||
          now - lastVerboseProgressLogAt >= FINAL_EXPORT_PROGRESS_VERBOSE_LOG_INTERVAL_MS
        )
      emit({
        currentStep: 4,
        stepPercent: 60 + Math.round((p / 100) * 35),
        message:
          payload.status ??
          `Ngày ${dateCode}: Đang xuất video hoàn chỉnh (${p.toFixed ? p.toFixed(1) : p}% )...`,
      })
      const etaText =
        typeof payload.etaSec === 'number' && Number.isFinite(payload.etaSec)
          ? `, ETA ~${Math.max(0, Math.round(payload.etaSec))}s`
          : ''
      if (shouldLogNormalProgress) {
        emitLog(
          'info',
          `[Bước 4] Đang xuất video ${currentIndex}/${totalOutputs}: ${payload.currentOutputFilename} (${p.toFixed(1)}%${etaText})`,
        )
        lastNormalProgressLogAt = now
        lastNormalProgressBucket = normalProgressBucket
        lastNormalProgressJobIndex = currentIndex
      }
      if (shouldLogVerboseProgress) {
        emitVerboseLog(
          'info',
          `[Bước 4] [Verbose] Đang xuất video ${currentIndex}/${totalOutputs}: ${payload.currentOutputFilename} (${p.toFixed(1)}%${etaText})`,
        )
        lastVerboseProgressLogAt = now
        lastVerboseProgressBucket = verboseProgressBucket
        lastVerboseProgressJobIndex = currentIndex
      }
    },
    done: (payload) => {
      donePayload = payload
      const failedCount = payload.failedJobs?.length ?? 0
      const successCount = payload.outputs?.length ?? 0
      const totalCount = successCount + failedCount

      if (failedCount > 0 && successCount > 0) {
        // Partial success
        emit({
          currentStep: 5,
          stepPercent: 100,
          message: `Ngày ${dateCode}: Hoàn tất — ${successCount}/${totalCount} video thành công, ${failedCount} thất bại.`,
        })
        emitLog('warn', `[Bước 5] ⚠️ Ngày ${dateCode}: ${successCount}/${totalCount} video thành công, ${failedCount} thất bại.`)
        for (const f of payload.failedJobs!.slice(0, MAX_SUMMARY_LOG_ITEMS)) {
          emitLog('error', `[Bước 5]   ✗ Job ${f.jobIndex + 1} (${f.fileName}): ${f.error}`)
        }
      } else {
        emit({
          currentStep: 5,
          stepPercent: 100,
          message: `Ngày ${dateCode}: Hoàn tất xuất video hoàn chỉnh.`,
        })
      }

      // Summary report — gộp thành 1 log block duy nhất
      const reportLines: string[] = [
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `📊 BÁO CÁO NGÀY ${dateCode} — ✅ ${successCount}${failedCount > 0 ? ` / ❌ ${failedCount}` : ''} video`,
      ]
      if (failedCount > 0) {
        for (const f of payload.failedJobs!.slice(0, MAX_SUMMARY_LOG_ITEMS)) {
          reportLines.push(`   ✗ Job ${f.jobIndex + 1} — ${f.fileName}: ${f.error.slice(0, 150)}`)
        }
        if (failedCount > MAX_SUMMARY_LOG_ITEMS) {
          reportLines.push(`   ... và ${failedCount - MAX_SUMMARY_LOG_ITEMS} job lỗi khác`)
        }
      }
      if (successCount > 0) {
        for (const out of payload.outputs.slice(0, MAX_SUMMARY_LOG_ITEMS)) {
          const fileName = out.videoFile.split(/[\\/]/).pop() || out.videoFile
          const durMin = (out.durationSec / 60).toFixed(1)
          reportLines.push(`   ✓ ${fileName} (${durMin} phút)`)
        }
        if (successCount > MAX_SUMMARY_LOG_ITEMS) {
          reportLines.push(`   ... và ${successCount - MAX_SUMMARY_LOG_ITEMS} video khác`)
        }
      }
      reportLines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      emitLogBlock('info', reportLines)
    },
    error: (err) => {
      // FIX BUG-1: KHÔNG set status='error' ở đây — nếu pipeline multi-day,
      // callback error của 1 ngày sẽ ghi đè status toàn cục, gây UI desync
      // khi pipeline tiếp tục chạy ngày tiếp theo. Chỉ log lỗi + giữ status='running'.
      // Terminal error sẽ do try/catch chính của startAutopilot xử lý.
      const errMsg = describeAutopilotError(err)
      emit({
        currentStep: 4,
        stepPercent: 0,
        message: `Ngày ${dateCode}: Lỗi khi xuất video — ${errMsg}`,
      })
      emitDetailedErrorLog(`[Bước 4] ✗ Lỗi khi xuất video ngày ${dateCode}`, err)
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
    jobRequest.useGpuEncoding || 'auto', // GPU encoding choice (default: 'auto')
    !!jobRequest.deleteSourceFiles, // Xóa file audio/video sau khi xuất xong
    !!jobRequest.unifyFormat,       // Chuẩn hóa tỉ lệ khung hình + FPS
    jobRequest.targetResolution,
    jobRequest.targetFps,
    preferredPreTranscodeMode,
    jobRequest.chromaKeyOverlay,
    jobRequest.imageSource,
    jobRequest.perImageDurationSec,
    jobRequest.imageAspectMode,
    jobRequest.imageTransition,
    jobRequest.imageKenBurns,
    undefined,
    jobRequest.audioVisualizer,
  )

  if (!donePayload) {
    throw new Error(`Final export không trả về kết quả hoàn tất cho ngày ${dateCode}.`)
  }

  const finalDonePayload = donePayload as unknown as FinalExportDonePayload
  const outputCount = finalDonePayload.outputs.length
  const failedJobs = finalDonePayload.failedJobs ?? []

  if (outputCount === 0) {
    throw new Error(`Final export không tạo được video nào cho ngày ${dateCode}.`)
  }

  const missingOrEmptyOutputs: string[] = []
  for (const output of finalDonePayload.outputs) {
    try {
      const stat = await fsp.stat(output.videoFile)
      if (!stat.isFile() || stat.size <= 0) {
        missingOrEmptyOutputs.push(path.basename(output.videoFile))
      }
    } catch {
      missingOrEmptyOutputs.push(path.basename(output.videoFile))
    }
  }

  if (missingOrEmptyOutputs.length > 0) {
    const sample = missingOrEmptyOutputs.slice(0, MAX_SUMMARY_LOG_ITEMS).join(', ')
    const extra =
      missingOrEmptyOutputs.length > MAX_SUMMARY_LOG_ITEMS
        ? ` và ${missingOrEmptyOutputs.length - MAX_SUMMARY_LOG_ITEMS} file khác`
        : ''
    throw new Error(`Final export báo thành công nhưng file video bị thiếu hoặc rỗng: ${sample}${extra}.`)
  }

  if (failedJobs.length > 0 || outputCount !== playlists.length) {
    const failureSample = failedJobs
      .slice(0, MAX_SUMMARY_LOG_ITEMS)
      .map((job: { fileName: string; error: string }) => `${job.fileName}: ${job.error}`)
      .join(' | ')
    const failureSuffix =
      failedJobs.length > MAX_SUMMARY_LOG_ITEMS
        ? ` | ... và ${failedJobs.length - MAX_SUMMARY_LOG_ITEMS} job lỗi khác`
        : ''
    const details = failureSample ? ` ${failureSample}${failureSuffix}` : ''
    throw new Error(
      `Final export chỉ tạo được ${outputCount}/${playlists.length} video cho ngày ${dateCode}.${details}`
    )
  }
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

  const dateCode = resolveAutopilotDateCode(plan.dateCode)

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
  emitLogBlock('info', [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📅 Bắt đầu xử lý ngày: ${dateCode}`,
    `[Bước 1] Đang chuẩn bị thư mục output...`,
  ])

  await ensureDir(audioDir)
  await ensureDir(finalDir)
  emitLog('info', `[Bước 1] ✓ Đã tạo thư mục Audio + Video`)
  emitLog('info', `[Bước 1] Thư mục Audio: ${audioDir}`)
  emitLog('info', `[Bước 1] Thư mục Video hoàn chỉnh: ${finalDir}`)

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

  const endingAudioPaths = Array.isArray(folders.endingAudioPaths)
    ? Array.from(new Set(folders.endingAudioPaths.filter(Boolean)))
    : []
  const endingTracks = endingAudioPaths.length > 0
    ? await scanAudioFilesAsTracks(endingAudioPaths, 'random')
    : []
  const endingDurationSec = endingTracks.reduce((sum, track) => sum + track.duration, 0)
  if (endingTracks.length > 0) {
    emitLog('info', `[Bước 2] Nhạc cuối: ${endingTracks.length} file (${formatDuration(Math.round(endingDurationSec))}) sẽ nối sau mỗi playlist.`)
  }

  const buildOptions: BuildPlaylistsOptions = {
    tracks: scan.tracks,
    pinnedTrackIds: pinnedFromOverrides,
    endingTracks,
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
  const crossfadeLabel = smoothTransitions ? `Crossfade: BẬT (${crossfadeSec}s)` : 'Crossfade: TẮT'
  emitLog('info', `[Bước 2] Ngày ${dateCode}: Xuất ${playlists.length} playlist → audio... (${crossfadeLabel})`)

  const maxAudioExportAttempts = 2
  for (let i = 0; i < playlists.length; i++) {
    throwIfCancelling()

    const pl = playlists[i]
    const fileNameBase = `${dateCode}_P${(i + 1).toString().padStart(2, '0')}`
    const exportRequestId = `autopilot-export-${dateCode}-${index}-${i}-${activeRunToken?.slice(0, 8) ?? randomUUID().slice(0, 8)}`
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
    req.requestId = exportRequestId

    emitVerboseLog('info', `[Bước 2] Đang xuất playlist ${i + 1}/${playlists.length}: ${fileNameBase}.m4a`)
    
    // Retry nhẹ khi export audio thất bại (không phải do cancel)
    let attempt = 0
    let lastAudioProgressLogAt = 0
    let lastAudioProgressBucket = -1
    while (attempt < maxAudioExportAttempts) {
      attempt++
      const controller = new AbortController()
      const audioHeartbeat = createStallHeartbeat(
        AUDIO_PROGRESS_STALL_WARN_MS,
        AUDIO_PROGRESS_STALL_CHECK_INTERVAL_MS,
        (stalledForMs) => {
          const stalledText = formatDuration(Math.max(1, Math.round(stalledForMs / 1000)))
          emit({
            currentStep: 2,
            stepPercent: currentProgress.stepPercent,
            message: `Ngày ${dateCode}: FFmpeg audio đang im lặng ở playlist ${i + 1}/${playlists.length} (${stalledText}), vẫn tiếp tục chờ...`,
          })
          emitLog(
            'warn',
            `[Bước 2] Playlist ${i + 1}/${playlists.length} chưa có progress FFmpeg trong ${stalledText}. Vẫn đang chờ cho tới timeout.`,
          )
        },
      )
      activeAbortControllers.push(controller)
      try {
        audioHeartbeat.markActivity()
        // Thêm progress emitter để log real-time
        // Wrap with timeout to prevent indefinite hang from stuck FFmpeg
        await withTimeout(
          exportPlaylistToFile(
            { ...req, signal: controller.signal } as ExportPlaylistRequest,
            (progress) => {
              const percent = progress.percent?.toFixed(1) ?? '0.0'
              const timeStr = formatDuration(progress.currentSec ?? 0)
              const totalTimeStr = formatDuration(progress.totalSec ?? 0)
              const numericPercent = progress.percent ?? 0
              const progressBucket = Math.floor(numericPercent / AUDIO_PROGRESS_LOG_STEP_PCT)
              const now = Date.now()
              audioHeartbeat.markActivity()
              const shouldLogAudioProgress =
                progressBucket > lastAudioProgressBucket ||
                numericPercent >= 100 ||
                now - lastAudioProgressLogAt >= AUDIO_PROGRESS_LOG_INTERVAL_MS
              if (shouldLogAudioProgress) {
                emitVerboseLog('info', `[Bước 2]   → Playlist ${i + 1}/${playlists.length}: ${percent}% (${timeStr}/${totalTimeStr})`)
                lastAudioProgressLogAt = now
                lastAudioProgressBucket = progressBucket
              }
            },
          ),
          AUDIO_EXPORT_TIMEOUT_MS,
          `Export audio playlist ${i + 1}/${playlists.length}`,
          () => { controller.abort() },
        )
        emitLog('info', `[Bước 2] ✓ Đã xuất xong playlist ${i + 1}/${playlists.length}: ${fileNameBase}.m4a`)
        // Verify the exported audio file actually exists
        const expectedAudioPath = path.join(audioDir, `${fileNameBase}.m4a`)
        if (!fs.existsSync(expectedAudioPath)) {
          // Also check .aac extension
          const altPath = path.join(audioDir, `${fileNameBase}.aac`)
          if (!fs.existsSync(altPath)) {
            throw new Error(`Export audio playlist ${i + 1} reported success but output file not found: ${expectedAudioPath}`)
          }
        }
        break
      } catch (err: any) {
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
        audioHeartbeat.stop()
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
    message: `Ngày ${dateCode}: Đang chọn clip video cho final export...`,
  })
  emitLog('info', `[Bước 3] Ngày ${dateCode}: Đang chọn video từ thư mục (${videoPickPercent}% mỗi thư mục)...`)

  // Chuẩn bị danh sách video clips:
  // - Cho phép nhiều thư mục video đã cắt (mỗi dòng trong ô cấu hình)
  // - Mỗi thư mục chỉ lấy khoảng X% video (videoPickPercent) để tránh lấy hết

  const MIN_VIDEO_TOTAL = Math.max(100, folders.minVideoClipsTarget ?? 1000)
  // FIX BUG-3: Dùng let để reassign thay vì mutate in-place (tránh stack overflow
  // với spread operator khi mảng lớn + rõ ràng hơn về intent)
  let { paths: selectedVideoPaths, summary: videoSelectionSummary } = await withTimeout(
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
      cancelAutopilotVideoJobs()
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
  emitVerboseLog('info', `[Bước 3] Đang sync ${selectedVideoPaths.length} clip vào Video Pool...`)
  try {
    const { added, updated, pruned } = await syncPoolWithFiles(selectedVideoPaths, (cur, total) => {
      if (cur % 500 === 0) emitVerboseLog('info', `[VideoPool] Đang sync ${cur}/${total}...`)
    })
    if (added > 0 || updated > 0 || pruned > 0) {
      emitVerboseLog('info', `[VideoPool] Sync xong: +${added} clip mới, ${updated} clip cập nhật path, ${pruned} clip cũ đã xóa`)
    }

    // Chọn sequence UNIQUE (LRU + shuffle đến khi fingerprint mới)
    const poolResult = await pickUniqueSequence(selectedVideoPaths, selectedVideoPaths.length, dateCode, 30)
    emitVerboseLog('info',
      `[VideoPool] Sequence: ${poolResult.isUnique ? '✅ Unique' : '⚠️ Có thể trùng'} | ` +
      `Thử: ${poolResult.attemptCount} lần | ` +
      `Tái dùng: ${poolResult.reusedCount}/${poolResult.totalAvailable} clip | ` +
      `Fingerprint: ${poolResult.fingerprint}`
    )

    // FIX BUG-3: Reassign thay vì mutate in-place
    // (poolResult.filePaths là cùng clips nhưng thứ tự LRU-shuffled unique)
    selectedVideoPaths = poolResult.filePaths

    // Ghi lại pool info vào local vars để markClipsUsed sau khi export xong
    _poolClipIds = poolResult.clipIds
    _poolFingerprint = poolResult.fingerprint

    const stats = getPoolStats()
    emitVerboseLog('info',
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
    currentStep: 3,
    stepPercent: 100,
    message: `Ngày ${dateCode}: Đã chọn ${selectedVideoPaths.length} clip video (mục tiêu ${MIN_VIDEO_TOTAL}).`,
    videoSelectedCount: selectedVideoPaths.length,
    videoTargetMin: MIN_VIDEO_TOTAL,
  })
  emitLog('info', `[Bước 3] Đã chọn ${selectedVideoPaths.length} clip video (mục tiêu: ${MIN_VIDEO_TOTAL})`)
  for (const s of videoSelectionSummary) {
    emitVerboseLog('info', `[Bước 3]   - ${s.folder}: ${s.selectedFiles}/${s.totalFiles} video`)
  }

  // Tạo danh sách audio paths theo đúng thứ tự playlists để đảm bảo mapping đúng
  // Thay vì dùng folder (sẽ sort theo tên), dùng files với paths đã được sắp xếp đúng
  // FIX BUG-6: Check cả .m4a và .aac — verify step (line 1869) đã check cả 2
  // nhưng collect step chỉ check .m4a, nên .aac outputs bị drop gây length mismatch.
  const audioPaths: string[] = []
  for (let i = 0; i < playlists.length; i++) {
    const fileNameBase = `${dateCode}_P${(i + 1).toString().padStart(2, '0')}`
    const m4aPath = path.join(audioDir, `${fileNameBase}.m4a`)
    const aacPath = path.join(audioDir, `${fileNameBase}.aac`)
    if (fs.existsSync(m4aPath)) {
      audioPaths.push(m4aPath)
    } else if (fs.existsSync(aacPath)) {
      audioPaths.push(aacPath)
    } else {
      console.warn(`[Autopilot] Audio file không tồn tại: ${m4aPath} (cả .aac cũng không có)`)
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

  emitVerboseLog('info', `[Bước 3] Đã tìm thấy ${audioPaths.length} file audio theo đúng thứ tự playlists`)

  const baseOutputName = buildBaseOutputNameFromPreset(plan.presetId)
  
  // Debug: Log overrides để kiểm tra customTitles
  if (overrides?.useCustomTitles) {
    emitVerboseLog('info', `[Bước 3] Debug: useCustomTitles=true, customTitles count=${overrides.customTitles?.length || 0}`)
    if (overrides.customTitles && overrides.customTitles.length > 0) {
      emitVerboseLog('info', `[Bước 3] Debug: customTitles[0]=${overrides.customTitles[0]}`)
    }
  } else {
    emitVerboseLog('info', `[Bước 3] Debug: useCustomTitles=${overrides?.useCustomTitles || false}`)
  }
  
  const outputNames = generateSimpleTitles(playlists.length, baseOutputName, dateCode, overrides, plan.presetId)
  
  // Debug: Log outputNames để kiểm tra kết quả
  if (outputNames.length > 0) {
    emitVerboseLog('info', `[Bước 3] Debug: outputNames[0]=${outputNames[0]}`)
  }

  const requestId = `autopilot-final-${dateCode}-${Date.now()}`

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
      strictPairing: false, // Pool mode: video pool lớn hơn audio là bình thường
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
    useGpuEncoding: config.runtimeOverrides?.finalExportUseGpuEncoding ?? 'auto',
    priorityVideoSource:
      config.folders.priorityVideoFolder && config.folders.priorityVideoFolder.trim().length > 0
        ? (() => {
            const p = pickFirstFolder(config.folders.priorityVideoFolder)
            return p ? { type: 'folder' as const, path: p } : undefined
          })()
        : undefined,
  }

  {
    const step4Lines: string[] = [`[Bước 4] Ngày ${dateCode}: Xuất ${playlists.length} video hoàn chỉnh...`]
    step4Lines.push(`  Output folder: ${finalDir}`)
    step4Lines.push(`  Request ID: ${requestId}`)
    step4Lines.push(`  Planned outputs: ${outputNames.length}`)
    if (outputNames.length > 0) {
      step4Lines.push(`  First output name: ${outputNames[0]}`)
    }
    if (overrides.normalizeVideoInput) {
      step4Lines.push(`  Re-encode: BẬT (an toàn hơn)`)
    }
    if (overrides.unifyVideoFormat) {
      step4Lines.push(`  Chuẩn hóa: ${overrides.targetResolution || '1920x1080'} @ ${overrides.targetFps || '30'} fps`)
    }
    if (config.runtimeOverrides?.requireGpuForVideoEncode && (overrides.normalizeVideoInput || overrides.unifyVideoFormat)) {
      step4Lines.push(`  GPU policy: Bắt buộc (fail-fast, không fallback CPU)`)
    }
    if (jobRequest.useGpuEncoding === 'cpu') {
      step4Lines.push(
        config.runtimeOverrides?.gpuFallbackReason
          ? `  Encoder: CPU (fallback sau health-check)`
          : `  Encoder: CPU`,
      )
      if (config.runtimeOverrides?.gpuFallbackReason) {
        step4Lines.push(`  Lý do fallback: ${config.runtimeOverrides.gpuFallbackReason}`)
      }
    } else if (jobRequest.useGpuEncoding === 'gpu') {
      const gpuDetails = [
        'GPU',
        config.runtimeOverrides?.resolvedGpuEncoder?.toUpperCase(),
        config.runtimeOverrides?.resolvedGpuProfile,
      ].filter(Boolean)
      step4Lines.push(`  Encoder: ${gpuDetails.join(' / ')}`)
      if (config.runtimeOverrides?.resolvedGpuFfmpegPath) {
        step4Lines.push(`  GPU FFmpeg: ${config.runtimeOverrides.resolvedGpuFfmpegPath}`)
      }
      if (config.runtimeOverrides?.gpuNormalizeMode) {
        step4Lines.push(
          `  Normalize path: ${config.runtimeOverrides.gpuNormalizeMode === 'gpu_heavy' ? 'GPU-heavy hybrid CUDA' : 'Software fallback'}`,
        )
      }
      if (config.runtimeOverrides?.gpuNormalizeReason) {
        step4Lines.push(`  Normalize note: ${config.runtimeOverrides.gpuNormalizeReason}`)
      }
    }
    if (jobRequest.endingAudio?.paths.length) {
      step4Lines.push(`  Nhạc cuối: ${jobRequest.endingAudio.paths.length} file`)
    }
    if (overrides.generateTracklist) {
      step4Lines.push(`  Tracklist: BẬT`)
    }
    emitLogBlock('info', step4Lines)
  }

  await runExportVideoWithOptions(
    jobRequest,
    dateCode,
    playlists,
    config.runtimeOverrides?.gpuNormalizeMode || 'software',
  )

  // ── Đánh dấu clips đã dùng trong Video Pool (sau khi export xong) ────────────
  if (_poolClipIds.length > 0 && _poolFingerprint) {
    try {
      markClipsUsed(_poolClipIds, dateCode, _poolFingerprint)
      emitVerboseLog('info', `[VideoPool] ✅ Đã ghi ${_poolClipIds.length} clip vào pool history (session: ${_poolFingerprint})`)
    } catch (poolErr: any) {
      emitLog('warn', `[VideoPool] Không thể ghi pool history: ${poolErr?.message}`)
    }
  }
}

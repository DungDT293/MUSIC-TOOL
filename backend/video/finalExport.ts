import { spawn } from 'child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { getFfmpegPaths } from '../ffmpeg/config'
import { probeFile } from '../ffmpeg/probe'
import { validateInputFiles, type ValidatedInputFile } from './videoUtils'
import { videoJobManager } from './videoJobManager'
import { verifyOutputVideo } from './outputVerification'
import { runPlaybackTest } from './playbackTest'
import { getDiskSpace, formatBytes, assertMinDiskSpace } from '../utils/diskSpace'
import { buildVideoEncoderArgsWithChoice, getGpuInfo } from '../utils/gpuDetection'
import { buildConcatSafeOutputArgs, buildNormalizeCudaHybridVfFilter, buildNormalizeVfFilter, detectEncoderFromArgs, extractFpsFromVfFilter } from './utils/normalizeVf'
import {
  buildPlaylistToFillDuration,
  shuffleOnce,
  type ClipItem,
} from './utils/videoShuffleHelpers'
import { getRecentHistory, type ExportHistoryEntry } from '../music/exportHistory'
import type {
  FinalExportDonePayload,
  FinalExportErrorPayload,
  FinalExportProgressPayload,
  FinalExportRequestPayload,
  FinalExportScanResult,
} from '../../shared/videoFinalExportChannels'

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg'])
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.avi', '.wmv', '.webm'])

interface AudioFileInfo {
  path: string
  durationSec: number
  codecName: string | null
}

interface PreparedVideoClips {
  clips: ValidatedInputFile[]
}

export interface FinalExportEmitter {
  progress: (payload: FinalExportProgressPayload) => void
  done: (payload: FinalExportDonePayload) => void
  error: (payload: FinalExportErrorPayload) => void
}

// PHASE 4: Planning interfaces
export interface AudioSourceItem {
  path: string
  durationSec: number
  /** Codec đã probe sẵn ở plan phase — tránh probe lại trong processJob */
  codecName?: string | null
}

export interface VideoClipItem {
  path: string
  durationSec: number
  sizeBytes?: number | null
  width?: number | null
  height?: number | null
}

export interface ExportJob {
  jobIndex: number
  audio: AudioSourceItem
  outputPath: string
  outputFileName: string
  customOutputName?: string // Tên tùy chỉnh từ outputNames array
  tracklistText?: string // Tracklist text nếu có
  mappedVideo?: VideoClipItem // Tab 6 files mode: audio[i] ghép đúng video[i]
}

export interface ExportPlan {
  jobs: ExportJob[]
  totalJobs: number
  totalAudioDurationSec: number
  totalVideoDurationSec: number
  /** Toàn bộ pool video (không phân loại ưu tiên) */
  videoClips: VideoClipItem[]
  /** Clip video ưu tiên (tùy chọn) – sẽ luôn xuất hiện đầu video trước khi loop các clip còn lại */
  priorityVideoClips?: VideoClipItem[]
}

function escapePathForFfmpegList(filePath: string): string {
  // Normalize backslash Windows → forward slash trước (FFmpeg concat demuxer yêu cầu)
  const normalized = filePath.replace(/\\/g, '/')
  // Escape special chars: single quote, backslash, # (comment char in concat files), semicolon
  return normalized
    .replace(/'/g, "'\\''")
    .replace(/#/g, "'\\#'")
}

// FIX PERF-12: Pre-compiled regex — tránh compile lại mỗi lần gọi sanitizeFilename
const RX_PIPE = /\|/g
const RX_INVALID_CHARS = /[<>:"/\\?*\x00-\x1F]/g
const RX_MULTI_SPACE = /\s+/g
const RX_MULTI_UNDERSCORE_MID = /([^ ])_+([^ ])/g
const RX_MULTI_UNDERSCORE_END = /([^ ])_+$/g
const RX_MULTI_UNDERSCORE_START = /^_+([^ ])/g
const RX_TRIM_UNDERSCORE_SPACE = /^[\s_]+|[\s_]+$/g

function sanitizeFilename(name: string): string {
  let result = name.replace(RX_PIPE, ' _ ')
  result = result.replace(RX_INVALID_CHARS, '_')
  result = result.replace(RX_MULTI_SPACE, ' ')
  result = result.replace(RX_MULTI_UNDERSCORE_MID, '$1_$2')
  result = result.replace(RX_MULTI_UNDERSCORE_END, '$1_')
  result = result.replace(RX_MULTI_UNDERSCORE_START, '_$1')
  result = result.replace(RX_TRIM_UNDERSCORE_SPACE, '')
  return result.trim()
}

function buildTracklistPath(outputPath: string): string {
  const dir = path.dirname(outputPath)
  const base = path.basename(outputPath, path.extname(outputPath))
  return path.join(dir, `${base}_tracklist.txt`)
}

function formatTimeForTracklist(seconds: number): string {
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/**
 * Tìm tracklist từ export history dựa trên audio path
 * Trả về tracklist text (mm:ss + tên bài) hoặc undefined nếu không tìm thấy
 */
function generateTracklistFromHistory(audioPath: string): string | undefined {
  try {
    const history = getRecentHistory()
    
    // Tìm entry có outputPath khớp với audioPath
    const matchingEntry = history.find(entry => {
      // So sánh đường dẫn (normalize để tránh vấn đề case sensitivity và path separator)
      const entryPath = path.resolve(entry.outputPath).toLowerCase()
      const audioPathResolved = path.resolve(audioPath).toLowerCase()
      return entryPath === audioPathResolved
    })
    
    if (!matchingEntry || !matchingEntry.tracks || matchingEntry.tracks.length === 0) {
      console.log(`[FinalExport] Không tìm thấy tracklist cho audio: ${audioPath}`)
      return undefined
    }
    
    // Format tracklist: mm:ss + tên bài (không có đuôi file)
    const lines = matchingEntry.tracks.map(track => {
      const timeStr = formatTimeForTracklist(track.startSec)
      // Loại bỏ đuôi file từ tên bài hát
      let name = track.name || path.basename(track.path, path.extname(track.path))
      // Nếu name có extension, loại bỏ nó
      if (name && path.extname(name)) {
        name = path.basename(name, path.extname(name))
      }
      return `${timeStr} ${name}`
    })
    
    const tracklistText = lines.join('\n')
    console.log(`[FinalExport] Tìm thấy tracklist cho audio: ${audioPath} (${matchingEntry.tracks.length} tracks)`)
    return tracklistText
  } catch (error) {
    console.warn(`[FinalExport] Lỗi khi tìm tracklist cho audio: ${audioPath}`, error)
    return undefined
  }
}

/**
 * FIX PERF-11: Phiên bản nhận history đã cache sẵn — tránh đọc disk N lần
 */
function generateTracklistFromCachedHistory(history: ExportHistoryEntry[], audioPath: string): string | undefined {
  try {
    const matchingEntry = history.find(entry => {
      const entryPath = path.resolve(entry.outputPath).toLowerCase()
      const audioPathResolved = path.resolve(audioPath).toLowerCase()
      return entryPath === audioPathResolved
    })

    if (!matchingEntry || !matchingEntry.tracks || matchingEntry.tracks.length === 0) {
      console.log(`[FinalExport] Không tìm thấy tracklist cho audio: ${audioPath}`)
      return undefined
    }

    const lines = matchingEntry.tracks.map(track => {
      const timeStr = formatTimeForTracklist(track.startSec)
      let name = track.name || path.basename(track.path, path.extname(track.path))
      if (name && path.extname(name)) {
        name = path.basename(name, path.extname(name))
      }
      return `${timeStr} ${name}`
    })

    const tracklistText = lines.join('\n')
    console.log(`[FinalExport] Tìm thấy tracklist cho audio: ${audioPath} (${matchingEntry.tracks.length} tracks)`)
    return tracklistText
  } catch (error) {
    console.warn(`[FinalExport] Lỗi khi tìm tracklist cho audio: ${audioPath}`, error)
    return undefined
  }
}

function buildOutputNameFromAudio(audioPath: string, targetExt: string): string {
  const base = path.basename(audioPath, path.extname(audioPath))
  const sanitized = sanitizeFilename(base) || 'audio'
  const normalizedExt = targetExt?.startsWith('.') ? targetExt : `.${targetExt || 'mp4'}`
  return `${sanitized}${normalizedExt}`
}

function parseTimeFromChunk(chunk: string): number | null {
  const match = chunk.match(/time=([0-9:.]+)/)
  if (!match) return null
  const [hours, minutes, seconds] = match[1].split(':')
  const h = parseFloat(hours ?? '0')
  const m = parseFloat(minutes ?? '0')
  const s = parseFloat(seconds ?? '0')
  if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(s)) return null
  return h * 3600 + m * 60 + s
}

function parseSpeedFromChunk(chunk: string): number | null {
  const match = chunk.match(/speed=\s*([0-9.]+)x/)
  if (!match) return null
  const speed = parseFloat(match[1])
  return Number.isNaN(speed) ? null : speed
}

function getFinalExportScratchRoot(): string {
  try {
    const userDataPath = app.getPath('userData')
    if (userDataPath) {
      return path.join(userDataPath, 'temp', 'final-export')
    }
  } catch {
    // Electron app may be unavailable in non-runtime contexts. Fall back below.
  }

  const localAppData =
    process.env.LOCALAPPDATA ||
    process.env.APPDATA ||
    path.join(os.homedir(), 'AppData', 'Local')

  return path.join(localAppData, '93-media-tool-mix-nhac', 'temp', 'final-export')
}

/**
 * FIX H-03: Same-drive scratch directory architecture.
 *
 * Problem: Previously, temp files always went to `userData/temp/final-export/` (C: drive).
 * This caused two issues:
 *   1. C: drive could run out of space while the target drive (D:, E:, etc.) had plenty.
 *   2. The final `fs.rename()` from temp to output required a cross-drive copy (O(n) bytes),
 *      which was slow for large video files (1-5 GB).
 *
 * Solution: Create the scratch dir INSIDE the output destination directory.
 *   - e.g. outputFolder = "D:/Exports/" → scratch = "D:/Exports/.93media-temp-<uuid>/"
 *   - `fs.rename()` from scratch to same-drive output is O(1) — just a metadata pointer update.
 *   - If the target dir is read-only or the write fails, fall back to `userData/temp`.
 *
 * @param baseName   Prefix for mkdtemp (e.g. "final-export-abc123-")
 * @param outputDir  The user's chosen export destination folder (optional — falls back to userData)
 */
async function ensureTempDir(baseName: string, outputDir?: string): Promise<string> {
  // Strategy 1: Same-drive scratch inside outputDir (preferred — enables O(1) rename)
  if (outputDir) {
    try {
      const sameDriveRoot = path.join(outputDir, '.93media-temp')
      await fsp.mkdir(sameDriveRoot, { recursive: true })
      const dir = await fsp.mkdtemp(path.join(sameDriveRoot, baseName))

      // Verify we can actually write here (some dirs are read-only or network shares with limited perms)
      const testFile = path.join(dir, '.write-test')
      await fsp.writeFile(testFile, 'ok')
      await fsp.unlink(testFile)

      console.log(`[FinalExport] Scratch dir: same-drive (${dir})`)
      return dir
    } catch (err) {
      console.warn(`[FinalExport] Cannot create same-drive scratch in ${outputDir}, falling back to userData:`, err)
      // Fall through to Strategy 2
    }
  }

  // Strategy 2: Fallback — userData/temp (always writable, but may be cross-drive)
  const scratchRoot = getFinalExportScratchRoot()
  await fsp.mkdir(scratchRoot, { recursive: true })
  const dir = await fsp.mkdtemp(path.join(scratchRoot, baseName))
  console.log(`[FinalExport] Scratch dir: userData fallback (${dir})`)
  return dir
}

async function ensurePathKind(p: string, kind: 'file' | 'dir'): Promise<void> {
  try {
    const stat = await fsp.stat(p)
    if (kind === 'file' && !stat.isFile()) {
      throw new Error(`Đường dẫn không phải file: ${p}`)
    }
    if (kind === 'dir' && !stat.isDirectory()) {
      throw new Error(`Đường dẫn không phải thư mục: ${p}`)
    }
  } catch (error) {
    const message =
      kind === 'file'
        ? `Không tìm thấy file: ${p}`
        : `Không tìm thấy thư mục: ${p}`
    throw new Error(message)
  }
}

async function loadAudioFiles(source: FinalExportRequestPayload['audioSource']): Promise<AudioFileInfo[]> {
  const audioFiles: AudioFileInfo[] = []

  const collectFromPaths = async (paths: string[]) => {
    for (const filePath of paths) {
      await ensurePathKind(filePath, 'file')
      try {
        const info = await probeFile(filePath)
        const duration = info?.format?.duration ?? 0
        const codecName = info?.audio?.codec ?? null
        if (!duration || duration <= 0) {
          console.warn('[FinalExport] Bỏ qua audio duration <= 0:', filePath)
          continue
        }
        audioFiles.push({ path: filePath, durationSec: duration, codecName })
      } catch (error) {
        console.warn('[FinalExport] Bỏ qua audio lỗi:', filePath, error)
      }
    }
  }

  if (source.type === 'file') {
    await collectFromPaths([source.path])
  } else if (source.type === 'files') {
    const list = source.paths && source.paths.length > 0 ? source.paths : [source.path]
    await collectFromPaths(Array.from(new Set(list)))
  } else if (source.type === 'folder') {
    await ensurePathKind(source.path, 'dir')
    const entries = await fsp.readdir(source.path, { withFileTypes: true })
    const paths: string[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!AUDIO_EXTS.has(ext)) continue
      paths.push(path.join(source.path, entry.name))
    }
    await collectFromPaths(Array.from(new Set(paths)))
  } else {
    throw new Error('Loại nguồn audio không được hỗ trợ.')
  }

  if (audioFiles.length === 0) {
    throw new Error('Không tìm thấy file audio hợp lệ.')
  }

  audioFiles.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
  return audioFiles
}

async function loadVideoClips(source: FinalExportRequestPayload['videoSource']): Promise<PreparedVideoClips> {
  let videoPaths: string[] = []

  if (source.type === 'file') {
    videoPaths = [source.path]
  } else if (source.type === 'files') {
    const list = source.paths && source.paths.length > 0 ? source.paths : [source.path]
    videoPaths = Array.from(new Set(list))
  } else if (source.type === 'folder') {
    await ensurePathKind(source.path, 'dir')
    const entries = await fsp.readdir(source.path, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!VIDEO_EXTS.has(ext)) continue
      videoPaths.push(path.join(source.path, entry.name))
    }
    videoPaths = Array.from(new Set(videoPaths))
  } else {
    throw new Error('Loại nguồn video không được hỗ trợ.')
  }

  if (videoPaths.length === 0) {
    throw new Error('Không tìm thấy clip video hợp lệ.')
  }

  const { valid } = await validateInputFiles(videoPaths, 8)
  if (valid.length === 0) {
    throw new Error('Không clip video nào có duration hợp lệ.')
  }

  valid.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
  return { clips: valid }
}

// PHASE 4: Planning helper functions

/**
 * Scan audio source và trả về AudioSourceItem[]
 * Support: file, folder, hoặc array paths
 */
async function scanAudioSourceForPlan(
  audioSource: FinalExportRequestPayload['audioSource']
): Promise<AudioSourceItem[]> {
  const audioFiles = await loadAudioFiles(audioSource)
  return audioFiles.map(f => ({
    path: f.path,
    durationSec: f.durationSec,
    codecName: f.codecName,  // FIX PERF-1: Propagate codec đã probe — tránh probe lại
  }))
}

/**
 * Scan video source và trả về VideoClipItem[]
 * Support: file, folder, hoặc array paths
 */
async function scanVideoSourceForPlan(
  videoSource: FinalExportRequestPayload['videoSource']
): Promise<VideoClipItem[]> {
  const videoClips = await loadVideoClips(videoSource)
  return videoClips.clips.map(c => ({
    path: c.path,
    durationSec: c.durationSec,
    sizeBytes: typeof c.sizeBytes === 'number' ? c.sizeBytes : null,
    width: typeof c.width === 'number' ? c.width : null,
    height: typeof c.height === 'number' ? c.height : null,
  }))
}

/**
 * Helper: Get output filename
 * - Nếu 1 audio → dùng baseName
 * - Nếu nhiều audio → basename(audio.path) + '.mp4'
 */
function getOutputFileName(
  audio: AudioSourceItem,
  index: number,
  totalAudio: number,
  baseName: string,
  customName?: string
): string {
  // Nếu có custom name từ outputNames array
  if (customName) {
    const sanitized = sanitizeFilename(customName)
    return sanitized.endsWith('.mp4') ? sanitized : `${sanitized}.mp4`
  }
  
  if (totalAudio === 1) {
    // Single audio: dùng baseName, đảm bảo có extension .mp4
    const sanitized = sanitizeFilename(baseName) || 'output'
    return sanitized.endsWith('.mp4') ? sanitized : `${sanitized}.mp4`
  } else {
    // Multiple audio: dùng basename(audio.path) + '.mp4'
    const base = path.basename(audio.path, path.extname(audio.path))
    const sanitized = sanitizeFilename(base) || 'audio'
    return `${sanitized}.mp4`
  }
}

/**
 * PHASE 4: Plan final export - tạo ExportPlan từ audio/video sources
 * 
 * - Probe audio/video chỉ 1 lần ở đây
 * - KHÔNG chạy FFmpeg trong planner
 * - Mỗi audio = 1 job riêng
 */
export async function planFinalExport(
  audioSource: FinalExportRequestPayload['audioSource'],
  videoSource: FinalExportRequestPayload['videoSource'],
  outputFolder: string,
  baseOutputFilename: string,
  outputNames?: string[],
  priorityVideoSource?: FinalExportRequestPayload['priorityVideoSource']
): Promise<ExportPlan> {
  // Medium: Validate output folder writable
  try {
    await fsp.mkdir(outputFolder, { recursive: true })
    await fsp.access(outputFolder, fs.constants.W_OK)
  } catch (err: any) {
    throw new Error(`Không ghi được vào thư mục output: ${outputFolder}. Lỗi: ${err?.message || err}`)
  }

  // 1. Scan audio (probe 1 lần)
  const audioItems: AudioSourceItem[] = await scanAudioSourceForPlan(audioSource)
  
  if (audioItems.length === 0) {
    throw new Error('Không có file audio hợp lệ.')
  }
  
  // 2. Scan video (probe 1 lần)
  const videoClips: VideoClipItem[] = await scanVideoSourceForPlan(videoSource)
  let priorityVideoClips: VideoClipItem[] | undefined
  if (priorityVideoSource) {
    try {
      priorityVideoClips = await scanVideoSourceForPlan(priorityVideoSource)
      console.log(`[FinalExport] Đã quét ${priorityVideoClips.length} priority video clips từ:`, priorityVideoSource)
      if (priorityVideoClips.length > 0) {
        console.log(`[FinalExport] Priority clips đầu tiên:`, priorityVideoClips.slice(0, 3).map(c => path.basename(c.path)))
      }
    } catch (error) {
      console.warn('[FinalExport] Không quét được thư mục video ưu tiên, sẽ bỏ qua priority clips:', error)
      priorityVideoClips = undefined
    }
  } else {
    console.log('[FinalExport] Không có priority video source được cung cấp')
  }
  
  if (videoClips.length === 0) {
    throw new Error('Không có clip video hợp lệ.')
  }

  // Tab 6 strict mapping: khi user chọn danh sách video files, phải ghép audio[i] -> video[i].
  // Chỉ áp dụng cho files mode CÓ strictPairing (mặc định true cho Tab 6 manual).
  // Autopilot pool mode gửi strictPairing: false → skip guard, dùng random/LRU pick.
  const strictFilesVideoPairing =
    videoSource.type === 'files' && videoSource.strictPairing !== false

  if (
    strictFilesVideoPairing &&
    videoClips.length !== audioItems.length
  ) {
    throw new Error(
      `Tab 6 yêu cầu ghép 1-1: audio[i] -> video[i]. Hiện có ${audioItems.length} audio và ${videoClips.length} video. Hãy làm cho số lượng bằng nhau.`
    )
  }
  
  // 3. Create jobs: mỗi audio = 1 job
  const jobs: ExportJob[] = audioItems.map((audio, index) => {
    const customName = outputNames && outputNames[index] ? outputNames[index] : undefined
    const outputFileName = getOutputFileName(audio, index, audioItems.length, baseOutputFilename, customName)
    return {
      jobIndex: index,
      audio,
      outputPath: path.join(outputFolder, outputFileName),
      outputFileName,
      customOutputName: customName,
      mappedVideo: strictFilesVideoPairing ? videoClips[index] : undefined,
    }
  })

  // FIX: Dedup output filenames — khi nhiều audio cùng tên (từ thư mục khác nhau),
  // outputPath trùng sẽ khiến job sau ghi đè lên job trước (FFmpeg -y).
  // Thêm suffix _2, _3... cho các file trùng.
  const usedOutputPaths = new Set<string>()
  for (const job of jobs) {
    let finalPath = job.outputPath
    let counter = 2
    while (usedOutputPaths.has(finalPath.toLowerCase())) {
      const ext = path.extname(job.outputFileName)
      const base = path.basename(job.outputFileName, ext)
      const newName = `${base}_${counter}${ext}`
      finalPath = path.join(outputFolder, newName)
      job.outputFileName = newName
      counter++
    }
    job.outputPath = finalPath
    usedOutputPaths.add(finalPath.toLowerCase())
  }

  // 4. Calculate totals
  const totalAudioDurationSec = audioItems.reduce((sum, a) => sum + a.durationSec, 0)
  const totalVideoDurationSec = videoClips.reduce((sum, v) => sum + v.durationSec, 0)
  
  return {
    jobs,
    totalJobs: jobs.length,
    totalAudioDurationSec,
    totalVideoDurationSec,
    videoClips,
    priorityVideoClips,
  }
}

/**
 * PHASE 5: Probe audio codec để quyết định có cần encode không
 */
async function probeAudioCodec(audioPath: string): Promise<string | null> {
  try {
    const info = await probeFile(audioPath)
    return info?.audio?.codec ?? null
  } catch (error) {
    console.warn('[FinalExport] Failed to probe audio codec:', audioPath, error)
    return null
  }
}

/**
 * PHASE 5: Execute final export - chạy từng job trong ExportPlan
 *
 * - Tab 6 files mode: mỗi job dùng đúng video[i] của job đó, tự loop nếu video ngắn hơn audio
 * - Folder/pool mode (Autopilot semantics) giữ nguyên
 * - Audio codec check: AAC/MP3 → copy, WAV/PCM → encode aac
 * - Progress: percentJob + percentTotal
 * - KHÔNG concat audio lại
 */
export async function executeFinalExport(
  plan: ExportPlan,
  requestId: string,
  emitter: FinalExportEmitter,
  shuffle: boolean = false,
  forceReencode: boolean = false,
  normalizeAudio: boolean = false,
  tracklistAuto: boolean = false,
  _subtitle?: unknown, // removed, kept for backward compat call sites
  _options?: unknown,  // removed, kept for backward compat call sites
  useGpuEncoding?: 'gpu' | 'cpu' | 'auto',
  deleteSourceFiles: boolean = false,
  unifyFormat: boolean = false,
  targetResolution?: string,
  targetFps?: string,
  preferredPreTranscodeMode: PreTranscodeMode = 'software',
): Promise<void> {
  // FIX H-03: Same-drive scratch — derive output directory from the first job's outputPath
  const outputDir = plan.jobs.length > 0 ? path.dirname(plan.jobs[0].outputPath) : undefined
  const tempDir = await ensureTempDir(`final-export-${requestId}-`, outputDir)

  // Build vf filter for resolution/FPS normalization if requested
  const normalizeVfFilter = unifyFormat && targetResolution && targetFps
    ? buildNormalizeVfFilter(targetResolution, targetFps)
    : null
  const gpuHybridNormalizeVfFilter = unifyFormat && targetResolution && targetFps
    ? buildNormalizeCudaHybridVfFilter(targetResolution, targetFps)
    : null
  const gpuInfo =
    preferredPreTranscodeMode === 'gpu_heavy' && useGpuEncoding !== 'cpu'
      ? await getGpuInfo()
      : null

  try {
    const tracklistWarnings: string[] = []

    // Generate tracklist cho từng job nếu tracklistAuto = true
    if (tracklistAuto) {
      // FIX PERF-11: Gọi getRecentHistory() 1 lần, dùng lại cho tất cả jobs
      const history = getRecentHistory()
      const unmatchedTracklistJobs: ExportJob[] = []
      for (const job of plan.jobs) {
        const tracklistText = generateTracklistFromCachedHistory(history, job.audio.path)
        if (tracklistText) {
          job.tracklistText = tracklistText
          console.log(`[FinalExport] Generated tracklist for job ${job.jobIndex + 1}: ${job.outputFileName}`)
        } else {
          unmatchedTracklistJobs.push(job)
        }
      }

      if (history.length === 0) {
        tracklistWarnings.push(
          'Tracklist tự động đang bật nhưng chưa có lịch sử export audio từ Tab 4, nên không có tracklist nào được tạo.'
        )
      } else if (unmatchedTracklistJobs.length > 0) {
        const preview = unmatchedTracklistJobs
          .slice(0, 3)
          .map((job) => path.basename(job.audio.path))
          .join(', ')
        const suffix =
          unmatchedTracklistJobs.length > 3 ? ` và ${unmatchedTracklistJobs.length - 3} file khác` : ''
        tracklistWarnings.push(
          `Tracklist tự động chỉ hoạt động khi audio nguồn khớp file đã xuất ở Tab 4. ` +
            `${unmatchedTracklistJobs.length}/${plan.jobs.length} audio không khớp history (${preview}${suffix}).`
        )
      }
    }
    
    // Map videoClips sang ClipItem
    const baseClips: ClipItem[] = plan.videoClips.map((v) => ({
      path: v.path,
      durationSec: v.durationSec,
      id: v.path,
      sizeBytes: v.sizeBytes ?? undefined,
      width: v.width ?? undefined,
      height: v.height ?? undefined,
    }))
    const priorityClips: ClipItem[] = (plan.priorityVideoClips ?? []).map((v) => ({
      path: v.path,
      durationSec: v.durationSec,
      id: v.path,
      sizeBytes: v.sizeBytes ?? undefined,
      width: v.width ?? undefined,
      height: v.height ?? undefined,
    }))
    const priorityPathSet =
      priorityClips.length > 0 ? new Set(priorityClips.map((c) => c.path)) : null
    const nonPriorityClips: ClipItem[] =
      priorityPathSet && priorityPathSet.size > 0
        ? baseClips.filter((c) => !priorityPathSet.has(c.path))
        : baseClips
    
    // DEBUG: Log priority clips info
    console.log(`[FinalExport] Priority clips: ${priorityClips.length} clips`)
    if (priorityClips.length > 0) {
      console.log(`[FinalExport] Priority clip paths:`, priorityClips.map(c => path.basename(c.path)))
    }
    console.log(`[FinalExport] Base clips: ${baseClips.length}, Non-priority clips: ${nonPriorityClips.length}`)
    
    const canMapOneToOne = !shuffle && baseClips.length >= plan.jobs.length
    if (canMapOneToOne) {
      console.log('[FinalExport] Enough videos for 1:1 mapping without shuffle.')
    }

    const quarantinedClipPaths = new Set<string>()
    const usedVideoSourcePathsBySucceededJob = new Map<number, string[]>()

    // Run jobs sequentially to keep progress stable and deterministic
    const processJob = async (job: ExportJob): Promise<void> => {
      // Kiểm tra cancel trước khi bắt đầu job
      if (videoJobManager.isCancelled(requestId)) {
        throw new Error('Đã dừng bởi người dùng')
      }
      
      // Dùng job.jobIndex (index cố định) thay vì thứ tự chạy để đảm bảo mapping 1-1 đúng
      const jobIndex = job.jobIndex
      const currentJobIndex = jobIndex + 1
      
      console.log(`[Job ${currentJobIndex}/${plan.totalJobs}] ${job.outputFileName}`)
      
      // Emit progress: prepare-video stage
      emitter.progress({
        requestId,
        stage: 'prepare-video',
        percent: (jobIndex / plan.totalJobs) * 100,
        timeSec: 0,
        totalDurationSec: job.audio.durationSec,
        currentIndex: currentJobIndex,
        totalOutputs: plan.totalJobs,
        currentAudioPath: job.audio.path,
        currentOutputFilename: job.outputFileName,
        status: `Đang chuẩn bị video ${currentJobIndex}/${plan.totalJobs}`,
      })
      
      // 1. Build video playlist cho job này
      const targetDurationSec = job.audio.durationSec
      const jobBaseClips = filterOutQuarantinedClips(baseClips, quarantinedClipPaths)
      const jobPriorityClips = filterOutQuarantinedClips(priorityClips, quarantinedClipPaths)
      const jobPriorityPathSet = jobPriorityClips.length > 0 ? new Set(jobPriorityClips.map((clip) => clip.path)) : null
      const jobNonPriorityClips =
        jobPriorityPathSet && jobPriorityPathSet.size > 0
          ? jobBaseClips.filter((clip) => !jobPriorityPathSet.has(clip.path))
          : jobBaseClips
      const mappedClip: ClipItem | null = job.mappedVideo
        ? {
            path: job.mappedVideo.path,
            durationSec: job.mappedVideo.durationSec,
            id: job.mappedVideo.path,
            sizeBytes: job.mappedVideo.sizeBytes ?? undefined,
            width: job.mappedVideo.width ?? undefined,
            height: job.mappedVideo.height ?? undefined,
          }
        : null
      const strictFilesPairingForJob = !!mappedClip
      const canMapOneToOneForJob = canMapOneToOne && jobBaseClips.length >= plan.jobs.length

      if (jobBaseClips.length === 0) {
        console.warn('[Job ' + currentJobIndex + '] No usable source clips remain after quarantine; export will fall back to placeholder video if needed.')
      }

      if (quarantinedClipPaths.size > 0) {
        console.warn(
          `[Job ${currentJobIndex}] Excluding ${quarantinedClipPaths.size} quarantined clip(s) from selection. Remaining pool=${jobBaseClips.length}`
        )
      }

      let videoPlaylist: ClipItem[]

      if (strictFilesPairingForJob && mappedClip) {
        if (jobPriorityClips.length > 0) {
          console.warn(
            `[Job ${currentJobIndex}] Strict audio[i] -> video[i] pairing active; ignoring priority video clips to avoid mixing sources.`
          )
        }
        videoPlaylist = buildPlaylistToFillDuration([mappedClip], targetDurationSec, false)
        console.log(
          `[Job ${currentJobIndex}/${plan.totalJobs}] Strict 1:1 pairing with clip: ${path.basename(mappedClip.path)}`
        )
      } else if (jobPriorityClips.length > 0) {
        // Có video ưu tiên: luôn cho xuất hiện đầu video mỗi job (bất kể canMapOneToOne)
        // Priority clips được xử lý GIỐNG HỆT như logic ghép video bình thường (buildPlaylistToFillDuration)
        // NHƯNG priority clips LUÔN ở đầu video
        
        // Tạo seed cho priority playlist (để shuffle nhất quán)
        const prioritySeed = Date.now() + job.jobIndex * 1000000 + Math.random() * 1000
        
        // Priority clips: Dùng buildPlaylistToFillDuration GIỐNG HỆT logic ghép bình thường
        const priorityPlaylist = buildPlaylistToFillDuration(jobPriorityClips, targetDurationSec, shuffle, prioritySeed)
        const priorityDuration = priorityPlaylist.reduce((sum, c) => sum + c.durationSec, 0)
        const remainingTarget = Math.max(0, targetDurationSec - priorityDuration)

        let loopPlaylist: ClipItem[] = []
        if (remainingTarget > 0) {
          // Nếu map 1-1 và có đủ video, dùng video tương ứng trước, sau đó mới loop
          // QUAN TRỌNG: Chỉ dùng non-priority clips để tránh duplicate priority clips
          if (canMapOneToOneForJob && jobNonPriorityClips.length > 0) {
            // Tìm video tương ứng từ nonPriorityClips (không phải từ baseClips để tránh priority video)
            const nonPriorityIndex = Math.min(job.jobIndex, jobNonPriorityClips.length - 1)
            const mappedClip = jobNonPriorityClips[nonPriorityIndex]
            if (mappedClip && mappedClip.durationSec <= remainingTarget) {
              // Dùng video tương ứng nếu duration phù hợp
              loopPlaylist = [mappedClip]
              const stillRemaining = remainingTarget - mappedClip.durationSec
              if (stillRemaining > 0 && jobNonPriorityClips.length > 1) {
                // Dùng các clip non-priority còn lại (trừ mappedClip đã dùng)
                const remainingNonPriority = jobNonPriorityClips.filter(c => c.path !== mappedClip.path)
                const loopSeed = Date.now() + job.jobIndex * 2000000 + Math.random() * 1000
                const additional = buildPlaylistToFillDuration(remainingNonPriority, stillRemaining, shuffle, loopSeed)
                loopPlaylist.push(...additional)
              }
            } else {
              // Video tương ứng quá dài hoặc không phù hợp → loop từ nonPriorityClips
              const loopSeed = Date.now() + job.jobIndex * 2000000 + Math.random() * 1000
              loopPlaylist = buildPlaylistToFillDuration(jobNonPriorityClips, remainingTarget, shuffle, loopSeed)
            }
          } else {
            // Không map 1-1 hoặc không có nonPriorityClips → loop từ nonPriorityClips (hoặc baseClips nếu không có priority)
            const loopSource = jobNonPriorityClips.length > 0 ? jobNonPriorityClips : jobBaseClips
            const loopSeed = Date.now() + job.jobIndex * 2000000 + Math.random() * 1000
            loopPlaylist = buildPlaylistToFillDuration(loopSource, remainingTarget, shuffle, loopSeed)
          }
        }

        // QUAN TRỌNG: Priority clips LUÔN ở đầu, sau đó mới đến loopPlaylist
        videoPlaylist = [...priorityPlaylist, ...loopPlaylist]
        
        // DEBUG: Log video playlist order
        console.log(`[Job ${currentJobIndex}] Video playlist order (${videoPlaylist.length} clips):`)
        console.log(`  - Priority clips (${priorityPlaylist.length}):`, priorityPlaylist.slice(0, 5).map(c => path.basename(c.path)) + (priorityPlaylist.length > 5 ? '...' : ''))
        if (loopPlaylist.length > 0) {
          console.log(`  - Loop clips (${loopPlaylist.length}):`, loopPlaylist.slice(0, 5).map(c => path.basename(c.path)) + (loopPlaylist.length > 5 ? '...' : ''))
        }
      } else {
        // Không có priority clips → giữ logic cũ
        if (canMapOneToOneForJob) {
          // Map 1-1: clip tương ứng đi TRƯỚC, sau đó fill phần còn lại bằng các clip khác
          const mappedClip = jobBaseClips[Math.min(job.jobIndex, jobBaseClips.length - 1)]
          if (mappedClip) {
            console.log(
              `[Job ${currentJobIndex}/${plan.totalJobs}] Map 1-1 với clip: ${path.basename(mappedClip.path)}`
            )
            const mappedDuration = mappedClip.durationSec
            const remainingTarget = Math.max(0, targetDurationSec - mappedDuration)
            videoPlaylist = [mappedClip]
            if (remainingTarget > 0) {
              // Dùng tất cả các clip còn lại (trừ mappedClip) để fill phần còn lại
              const restClips = jobBaseClips.filter(c => c.path !== mappedClip.path)
              const loopSource = restClips.length > 0 ? restClips : jobBaseClips
              const loopSeed = Date.now() + job.jobIndex * 2000000 + Math.random() * 1000
              const fillClips = buildPlaylistToFillDuration(loopSource, remainingTarget, true, loopSeed)
              videoPlaylist.push(...fillClips)
            }
          } else {
            videoPlaylist = buildPlaylistToFillDuration(jobBaseClips, targetDurationSec, shuffle)
          }
        } else {
          videoPlaylist = buildPlaylistToFillDuration(jobBaseClips, targetDurationSec, shuffle)
        }
      }
      
      if (!strictFilesPairingForJob) {
        const reserveDurationSec = Math.min(Math.max(targetDurationSec * 0.2, 180), 900)
        const reservePrimarySource =
          jobPriorityClips.length > 0
            ? (jobNonPriorityClips.length > 0 ? jobNonPriorityClips : jobBaseClips)
            : jobBaseClips
        const primaryUsedPaths = new Set(videoPlaylist.map((clip) => clip.path))
        const reserveSource = reservePrimarySource.filter((clip) => !primaryUsedPaths.has(clip.path))
        const reserveFallbackSource = reserveSource.length > 0 ? reserveSource : reservePrimarySource
        if (reserveFallbackSource.length > 0 && reserveDurationSec > 0) {
          const reserveSeed = Date.now() + job.jobIndex * 3000000 + Math.random() * 1000
          const reservePlaylist = buildPlaylistToFillDuration(reserveFallbackSource, reserveDurationSec, true, reserveSeed)
          if (reservePlaylist.length > 0) {
            const reserveActualDurationSec = reservePlaylist.reduce((sum, clip) => sum + clip.durationSec, 0)
            videoPlaylist = [...videoPlaylist, ...reservePlaylist]
            console.log(
              `[Job ${currentJobIndex}] Added ${reservePlaylist.length} reserve clip(s) (${reserveActualDurationSec.toFixed(1)}s) for bad-clip recovery`
            )
          }
        }
      }
      console.log(
        `[Job ${currentJobIndex}] Video playlist: ${videoPlaylist.length} clips (pool=${jobBaseClips.length}, priority=${jobPriorityClips.length})`
      )
      
      const jobScratchDir = path.join(tempDir, `job_${String(job.jobIndex + 1).padStart(2, '0')}`)
      await fsp.mkdir(jobScratchDir, { recursive: true })

      // 2. Create concat list file
      const videoListFile = path.join(jobScratchDir, 'video_concat.txt')
      // Thêm 'duration' cho mỗi clip → FFmpeg concat demuxer tính PTS tích lũy chính xác
      // Không có 'duration' → FFmpeg dùng PTS gốc từ bitstream → timestamp jump → freeze frame
      // 'inpoint 0' → force concat demuxer seek đến keyframe đầu mỗi clip
      //   → tránh bắt đầu bằng P-frame (gây freeze cho đến keyframe tiếp theo)
      const listContent = videoPlaylist
        .map(c => `file '${escapePathForFfmpegList(c.path)}'\ninpoint 0\nduration ${c.durationSec.toFixed(6)}`)
        .join('\n')
      await fsp.writeFile(videoListFile, listContent, 'utf-8')
      
      // DEBUG: Log concat list file content (first few lines) để verify thứ tự
      if (priorityClips.length > 0 && currentJobIndex === 1) {
        const lines = listContent.split('\n')
        console.log(`[Job ${currentJobIndex}] Concat list file (first 5 lines):`)
        lines.slice(0, 5).forEach((line, idx) => {
          const match = line.match(/file '(.+?)'/)
          if (match) {
            console.log(`  ${idx + 1}. ${path.basename(match[1])}`)
          }
        })
      }
      
      // 3. Dùng codec đã probe sẵn từ plan phase (FIX PERF-1: tránh spawn ffprobe per job)
      const audioCodec = job.audio.codecName ?? await probeAudioCodec(job.audio.path)
      const codecLower = audioCodec?.toLowerCase() ?? null
      const needAudioEncode = !codecLower || (codecLower !== 'aac' && codecLower !== 'mp3')
      
      console.log(`[Job ${currentJobIndex}] Audio codec: ${audioCodec || 'unknown'}, needEncode: ${needAudioEncode}`)
      
      const estimatedOutputBytes = estimatePlaylistBytes(videoPlaylist)
      await ensureFinalExportDiskCapacity(
        job.outputPath,
        estimatedOutputBytes,
        `video ${currentJobIndex}/${plan.totalJobs}`
      )

      // 4. Run FFmpeg với progress tracking
      const reusableTranscodedClipCache = new Map<string, string>()
      const effectiveNormalizeVfFilter = resolveEffectiveNormalizeVfFilter({
        explicitNormalizeVfFilter: normalizeVfFilter,
        clips: videoPlaylist,
        forceReencode,
        jobLabel: `${currentJobIndex}/${plan.totalJobs}`,
      })
      const effectiveGpuHybridNormalizeVfFilter = resolveEffectiveGpuHybridNormalizeVfFilter({
        explicitNormalizeVfFilter: normalizeVfFilter,
        explicitGpuHybridVfFilter: gpuHybridNormalizeVfFilter,
        clips: videoPlaylist,
        forceReencode,
      })
      const resolvedPreTranscodeMode: PreTranscodeMode =
        effectiveNormalizeVfFilter &&
        preferredPreTranscodeMode === 'gpu_heavy' &&
        useGpuEncoding !== 'cpu' &&
        gpuInfo?.available &&
        gpuInfo.encoder === 'nvenc' &&
        gpuInfo.normalizeCudaAvailable &&
        !!effectiveGpuHybridNormalizeVfFilter
          ? 'gpu_heavy'
          : 'software'

      await runFinalCommand({
        requestId,
        totalDurationSec: job.audio.durationSec,
        videoListPath: videoListFile,
        tempWorkspaceDir: jobScratchDir,
        audioPath: job.audio.path,
        outputPath: job.outputPath,
        audioCodec,
        forceReencode,
        normalizeAudio,
        useGpuEncoding,
        normalizeVfFilter: effectiveNormalizeVfFilter,
        gpuHybridNormalizeVfFilter: effectiveGpuHybridNormalizeVfFilter,
        preTranscodeMode: effectiveNormalizeVfFilter ? resolvedPreTranscodeMode : 'software',
        failedVideoSourcePaths: quarantinedClipPaths,
        reusableTranscodedClipCache,
        emitProgress: (progressPayload) => {
          const percentJob = progressPayload.percent || 0
          const percentTotal = (job.jobIndex / plan.totalJobs) * 100 + (percentJob / plan.totalJobs)
          emitter.progress({
            ...progressPayload,
            requestId,
            stage: 'export',
            percent: percentTotal,
            currentIndex: currentJobIndex,
            totalOutputs: plan.totalJobs,
            currentAudioPath: job.audio.path,
            currentOutputFilename: job.outputFileName,
            status: `Đang xuất video ${currentJobIndex}/${plan.totalJobs}: ${job.outputFileName}`,
          })
        },
      })

      let outputStat: fs.Stats
      try {
        outputStat = await fsp.stat(job.outputPath)
      } catch {
        throw new Error(`FFmpeg completed but output file was not created: ${job.outputFileName}`)
      }
      if (!outputStat.isFile() || outputStat.size <= 0) {
        throw new Error(`FFmpeg produced an empty output file: ${job.outputFileName}`)
      }

      // 5. Verify output (metadata + decode smoke/deep verify) + optional playback test
      const shouldRunDeepVerify = forceReencode || needAudioEncode || normalizeAudio || !!normalizeVfFilter
      emitter.progress({
        requestId,
        stage: 'finishing',
        percent: ((job.jobIndex + 0.5) / plan.totalJobs) * 100,
        timeSec: job.audio.durationSec,
        totalDurationSec: job.audio.durationSec,
        currentIndex: currentJobIndex,
        totalOutputs: plan.totalJobs,
        currentAudioPath: job.audio.path,
        currentOutputFilename: job.outputFileName,
        status: shouldRunDeepVerify
          ? `Đang kiểm tra file xuất ra ${currentJobIndex}/${plan.totalJobs} (ffprobe + decode)...`
          : `Đang smoke-check file xuất ra ${currentJobIndex}/${plan.totalJobs} (copy-stream)...`,
      })

      const verify = await verifyOutputVideo(job.outputPath, {
        expectedDurationSec: job.audio.durationSec,
        toleranceSec: 5,
        decodeWindowSec: getVerifyDecodeWindowSec(shouldRunDeepVerify),
        onLog: (msg) => console.log('[FinalExport][verify]', msg),
      })

      if (!verify.hasVideoStream) {
        throw new Error(`Output missing video stream cho ${job.outputFileName}`)
      }

      if (!verify.hasAudioStream) {
        throw new Error(`Output missing audio stream cho ${job.outputFileName}`)
      }

      if (verify.durationWarning) {
        throw new Error(
          `Output duration mismatch cho ${job.outputFileName}: expected=${job.audio.durationSec.toFixed(2)}s, actual=${verify.durationSec.toFixed(2)}s`
        )
      }

      if (!verify.decodeOk) {
        throw new Error(`Output decode verification failed cho ${job.outputFileName}`)
      }

      if (forceReencode) {
        const playback = await runPlaybackTest(job.outputPath)
        if (playback.success) {
          console.log(
            `[FinalExport][playback] ${job.outputFileName} phát thử OK với ${playback.player} (exitCode=${playback.exitCode})`
          )
        } else {
          console.warn(
            `[FinalExport][playback] Phát thử thất bại cho ${job.outputFileName} (player=${
              playback.player ?? 'none'
            }, exitCode=${playback.exitCode})`
          )
          emitter.progress({
            requestId,
            stage: 'finishing',
            percent: ((job.jobIndex + 0.75) / plan.totalJobs) * 100,
            timeSec: job.audio.durationSec,
            totalDurationSec: job.audio.durationSec,
            currentIndex: currentJobIndex,
            totalOutputs: plan.totalJobs,
            currentAudioPath: job.audio.path,
            currentOutputFilename: job.outputFileName,
            status: `⚠️ Playback test thất bại cho ${job.outputFileName} (mpv/VLC), hãy kiểm tra lại file.`,
          })
        }
      }

      // 6. Ghi tracklist file nếu có
      let tracklistPath: string | undefined = undefined
      if (job.tracklistText && job.tracklistText.trim().length > 0) {
        try {
          tracklistPath = buildTracklistPath(job.outputPath)
          await fsp.writeFile(tracklistPath, job.tracklistText.trimEnd() + '\n', 'utf-8')
          console.log(`[Job ${currentJobIndex}/${plan.totalJobs}] ✓ Tracklist saved: ${tracklistPath}`)
        } catch (error) {
          console.warn(`[FinalExport] Failed to write tracklist file: ${tracklistPath}`, error)
        }
      }

      // Cleanup concat list file
      try {
        await fsp.unlink(videoListFile)
      } catch (error) {
        console.warn(`[FinalExport] Failed to cleanup concat list: ${videoListFile}`, error)
      }
      
      // CRITICAL: Do NOT cleanup tempVideoPath here - it should be cleaned up by runFinalCommand after Step 2
      // Only cleanup if runFinalCommand didn't run (error before calling it)
      // This prevents race condition where we cleanup before Step 2 finishes
      // Note: runFinalCommand will cleanup tempVideoPath after Step 2 completes
      
      usedVideoSourcePathsBySucceededJob.set(job.jobIndex, Array.from(new Set(videoPlaylist.map((clip) => clip.path))))
      console.log(`[Job ${currentJobIndex}/${plan.totalJobs}] ✓ Completed: ${job.outputFileName}`)
    }

    // Chạy tuần tự từng job một (không chạy song song)
    // Wrap mỗi job trong try/catch để 1 job lỗi không chặn các job còn lại
    const failedJobs: { jobIndex: number; fileName: string; error: string }[] = []
    const succeededJobs: ExportJob[] = []

    for (const job of plan.jobs) {
      try {
        await processJob(job)
        succeededJobs.push(job)
      } catch (err: any) {
        const errorMsg = err?.message || String(err)
        failedJobs.push({
          jobIndex: job.jobIndex,
          fileName: job.outputFileName,
          error: errorMsg,
        })
        console.error(
          `[FinalExport] ❌ Job ${job.jobIndex + 1}/${plan.totalJobs} thất bại (${job.outputFileName}): ${errorMsg}`
        )
        // Emit progress để UI biết job này lỗi, nhưng không dừng pipeline
        emitter.progress({
          requestId,
          stage: 'finishing',
          percent: ((job.jobIndex + 1) / plan.totalJobs) * 100,
          timeSec: 0,
          totalDurationSec: job.audio.durationSec,
          currentIndex: job.jobIndex + 1,
          totalOutputs: plan.totalJobs,
          currentAudioPath: job.audio.path,
          currentOutputFilename: job.outputFileName,
          status: `❌ Job ${job.jobIndex + 1}/${plan.totalJobs} thất bại: ${errorMsg.slice(0, 120)}. Tiếp tục các job còn lại...`,
        })
      }
    }

    // Nếu TẤT CẢ job lỗi → throw để caller xử lý như error hoàn toàn
    if (succeededJobs.length === 0 && failedJobs.length > 0) {
      const summary = failedJobs.map(f => `Job ${f.jobIndex + 1} (${f.fileName}): ${f.error}`).join('; ')
      throw new Error(`Tất cả ${failedJobs.length} job đều thất bại: ${summary}`)
    }

    // Emit done event — chỉ gồm các job thành công
    const tracklistPaths: Record<number, string | undefined> = {}
    for (const job of succeededJobs) {
      if (job.tracklistText) {
        tracklistPaths[job.jobIndex] = buildTracklistPath(job.outputPath)
      }
    }

    if (failedJobs.length > 0) {
      const failSummary = failedJobs.map(f => `${f.fileName}: ${f.error.slice(0, 80)}`).join(', ')
      console.warn(
        `[FinalExport] ⚠️ ${failedJobs.length}/${plan.totalJobs} job thất bại, ${succeededJobs.length} thành công. Chi tiết: ${failSummary}`
      )
    }

    emitter.done({
      requestId,
      outputs: succeededJobs.map(j => ({
        audioFile: j.audio.path,
        videoFile: j.outputPath,
        durationSec: j.audio.durationSec,
        tracklistFile: tracklistPaths[j.jobIndex],
      })),
      failedJobs: failedJobs.length > 0 ? failedJobs : undefined,
      warnings: tracklistWarnings.length > 0 ? tracklistWarnings : undefined,
    })
    
    // Xóa file audio và video nguồn nếu được yêu cầu
    if (deleteSourceFiles) {
      console.log('[FinalExport] Xóa file audio và video nguồn sau khi xuất xong...')
      const deletedFiles: string[] = []
      const failedFiles: string[] = []

      // FIX PERF-10: Dùng async unlink thay vì sync — tránh block event loop
      // Xóa audio files
      const audioDeletePromises = succeededJobs.map(async (job) => {
        try {
          await fsp.access(job.audio.path)
          await fsp.unlink(job.audio.path)
          deletedFiles.push(job.audio.path)
          console.log(`[FinalExport] Đã xóa audio: ${path.basename(job.audio.path)}`)
        } catch (err: any) {
          if (err?.code !== 'ENOENT') {
            console.error(`[FinalExport] Không thể xóa audio ${job.audio.path}:`, err)
            failedFiles.push(job.audio.path)
          }
        }
      })
      await Promise.allSettled(audioDeletePromises)

      // Collect unique video paths — LOẠI TRỪ priority video (UI hứa không xóa)
      const videoPathsToDelete = new Set<string>()
      const priorityPathSet = new Set<string>(
        (plan.priorityVideoClips ?? []).map(c => c.path)
      )
      for (const job of succeededJobs) {
        const usedPaths = usedVideoSourcePathsBySucceededJob.get(job.jobIndex) ?? []
        for (const videoPath of usedPaths) {
          // Không xóa priority video files
          if (!priorityPathSet.has(videoPath)) {
            videoPathsToDelete.add(videoPath)
          }
        }
      }
      if (priorityPathSet.size > 0) {
        console.log(`[FinalExport] Bỏ qua ${priorityPathSet.size} priority video (không xóa)`)
      }

      // Xóa video files song song
      const videoDeletePromises = Array.from(videoPathsToDelete).map(async (videoPath) => {
        try {
          await fsp.access(videoPath)
          await fsp.unlink(videoPath)
          deletedFiles.push(videoPath)
          console.log(`[FinalExport] Đã xóa video: ${path.basename(videoPath)}`)
        } catch (err: any) {
          if (err?.code !== 'ENOENT') {
            console.error(`[FinalExport] Không thể xóa video ${videoPath}:`, err)
            failedFiles.push(videoPath)
          }
        }
      })
      await Promise.allSettled(videoDeletePromises)

      if (deletedFiles.length > 0) {
        console.log(`[FinalExport] Đã xóa ${deletedFiles.length} file nguồn`)
      }
      if (failedFiles.length > 0) {
        console.warn(`[FinalExport] Không thể xóa ${failedFiles.length} file:`, failedFiles)
      }
    }
  } catch (error: any) {
    // NOTE: Không gọi emitter.error() ở đây — hàm gọi (exportFinalVideo) sẽ catch
    // và emit error. Gọi ở cả 2 chỗ gây duplicate error event trên UI.
    throw error
  } finally {
    // Cleanup temp dir
    await cleanupTempDir(tempDir)
  }
}

const DEFAULT_PLAYLIST_CLIP_SIZE_BYTES = 200 * 1024 * 1024 // 200 MB fallback

function estimatePlaylistBytes(playlist: ClipItem[]): number {
  let knownTotal = 0
  let knownCount = 0
  for (const clip of playlist) {
    if (typeof clip.sizeBytes === 'number' && clip.sizeBytes > 0) {
      knownTotal += clip.sizeBytes
      knownCount++
    }
  }
  const avgSize = knownCount > 0 ? knownTotal / knownCount : DEFAULT_PLAYLIST_CLIP_SIZE_BYTES
  return playlist.reduce((sum, clip) => {
    const size = clip.sizeBytes
    return sum + (typeof size === 'number' && size > 0 ? size : avgSize)
  }, 0)
}

function getVerifyDecodeWindowSec(shouldRunDeepVerify: boolean): number {
  return shouldRunDeepVerify ? 60 : 12
}

function isProbeDurationCloseEnough(actualDurationSec: number, expectedDurationSec: number): boolean {
  if (!actualDurationSec || !expectedDurationSec) return false
  const toleranceSec = Math.max(5, Math.min(15, expectedDurationSec * 0.01))
  return Math.abs(actualDurationSec - expectedDurationSec) <= toleranceSec
}

const DEFAULT_AUTO_NORMALIZE_RESOLUTION = '1920x1080'
const DEFAULT_AUTO_NORMALIZE_FPS = '30'

function getClipResolutionKey(clip: Pick<ClipItem, 'width' | 'height'>): string | null {
  const width = typeof clip.width === 'number' ? clip.width : 0
  const height = typeof clip.height === 'number' ? clip.height : 0
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return `${width}x${height}`
}

function hasUnsafeFrameDimensions(clip: Pick<ClipItem, 'width' | 'height'>): boolean {
  const width = typeof clip.width === 'number' ? clip.width : 0
  const height = typeof clip.height === 'number' ? clip.height : 0
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return true
  }
  return width % 2 !== 0 || height % 2 !== 0
}

function collectDistinctClipResolutions(clips: ClipItem[]): string[] {
  const resolutions = new Set<string>()
  for (const clip of clips) {
    const key = getClipResolutionKey(clip)
    if (key) {
      resolutions.add(key)
    }
  }
  return Array.from(resolutions)
}

function chooseAutoNormalizeResolution(clips: ClipItem[]): string {
  const counts = new Map<string, { count: number; area: number }>()

  for (const clip of clips) {
    const key = getClipResolutionKey(clip)
    if (!key) continue

    const width = clip.width as number
    const height = clip.height as number
    const current = counts.get(key)
    if (current) {
      current.count += 1
      continue
    }
    counts.set(key, { count: 1, area: width * height })
  }

  if (counts.size === 0) {
    return DEFAULT_AUTO_NORMALIZE_RESOLUTION
  }

  const ranked = Array.from(counts.entries()).sort((a, b) => {
    if (b[1].count !== a[1].count) {
      return b[1].count - a[1].count
    }
    if (b[1].area !== a[1].area) {
      return b[1].area - a[1].area
    }
    return a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' })
  })

  return ranked[0]?.[0] ?? DEFAULT_AUTO_NORMALIZE_RESOLUTION
}

function getEffectiveNormalizeTarget(clips: ClipItem[]): { targetResolution: string; targetFps: string } {
  return {
    targetResolution: chooseAutoNormalizeResolution(clips),
    targetFps: DEFAULT_AUTO_NORMALIZE_FPS,
  }
}

function collectForceReencodeTwoPassReasons(clips: ClipItem[]): string[] {
  if (clips.length === 0) return []

  const reasons: string[] = []
  const distinctResolutions = collectDistinctClipResolutions(clips)
  const hasMixedResolutions = distinctResolutions.length > 1
  const hasUnsafeDimensions = clips.some((clip) => hasUnsafeFrameDimensions(clip))
  const seenPaths = new Set<string>()
  let hasLoopedClip = false

  for (const clip of clips) {
    if (seenPaths.has(clip.path)) {
      hasLoopedClip = true
      break
    }
    seenPaths.add(clip.path)
  }

  const hasVeryShortClip = clips.some(
    (clip) => Number.isFinite(clip.durationSec) && clip.durationSec > 0 && clip.durationSec <= 5
  )

  if (hasMixedResolutions) reasons.push('mixed-resolution inputs')
  if (hasUnsafeDimensions) reasons.push('unsafe frame dimensions')
  if (hasLoopedClip) reasons.push('looped source clips')
  if (hasVeryShortClip) reasons.push('very short clips (<= 5s)')

  return reasons
}

function resolveEffectiveNormalizeVfFilter(opts: {
  explicitNormalizeVfFilter: string | null
  clips: ClipItem[]
  forceReencode: boolean
  jobLabel: string
}): string | null {
  const { explicitNormalizeVfFilter, clips, forceReencode, jobLabel } = opts
  if (explicitNormalizeVfFilter) {
    return explicitNormalizeVfFilter
  }
  if (!forceReencode || clips.length === 0) {
    return null
  }

  const twoPassReasons = collectForceReencodeTwoPassReasons(clips)
  const { targetResolution, targetFps } = getEffectiveNormalizeTarget(clips)
  const sampleResolutions = collectDistinctClipResolutions(clips)
  const sampleResolutionText =
    sampleResolutions.length > 0 ? sampleResolutions.slice(0, 4).join(', ') : 'unknown'

  if (twoPassReasons.length > 0) {
    console.warn(
      `[FinalExport] Auto-enabled 2-pass normalize for job ${jobLabel}: ` +
        `${twoPassReasons.join(', ')} (${sampleResolutionText}). ` +
        `Target=${targetResolution} @ ${targetFps}fps`
    )
    return buildNormalizeVfFilter(targetResolution, targetFps)
  }

  // Khi forceReencode=true nhưng input đồng nhất, không loop clip ngắn và frame size an toàn,
  // single-step vẫn đủ nhanh/ổn định, không cần ép 2-pass.
  console.log(
    `[FinalExport] Uniform safe input for job ${jobLabel} (${sampleResolutionText}), ` +
      `no normalize vf filter needed — skipping 2-pass`
  )
  return null
}

function resolveEffectiveGpuHybridNormalizeVfFilter(opts: {
  explicitNormalizeVfFilter: string | null
  explicitGpuHybridVfFilter: string | null
  clips: ClipItem[]
  forceReencode: boolean
}): string | null {
  const { explicitNormalizeVfFilter, explicitGpuHybridVfFilter, clips, forceReencode } = opts
  if (explicitNormalizeVfFilter) {
    return explicitGpuHybridVfFilter
  }
  if (!forceReencode || clips.length === 0) {
    return null
  }

  // Mirror resolveEffectiveNormalizeVfFilter: looped/very-short playlists also need 2-pass.
  if (collectForceReencodeTwoPassReasons(clips).length === 0) {
    return null
  }

  const { targetResolution, targetFps } = getEffectiveNormalizeTarget(clips)
  return buildNormalizeCudaHybridVfFilter(targetResolution, targetFps)
}

async function ensureFinalExportDiskCapacity(
  outputPath: string,
  estimatedBytes: number,
  jobLabel: string
): Promise<void> {
  try {
    const diskInfo = await getDiskSpace(outputPath)
    // Buffer: 10% margin hoặc tối thiểu 1GB (giảm từ 4GB để tránh false positive)
    const buffer = Math.max(estimatedBytes * 1.1, 1 * 1024 * 1024 * 1024)
    
    if (diskInfo.free < buffer) {
      // CHỈ CẢNH BÁO, KHÔNG CHẶN: Log warning nhưng vẫn cho phép xuất video
      const warningMsg = `⚠️ CẢNH BÁO: Ổ ${diskInfo.drive} chỉ còn ${formatBytes(diskInfo.free)} nhưng ${jobLabel} cần khoảng ${formatBytes(
        estimatedBytes
      )}. Vẫn tiếp tục xuất video...`
      console.warn(`[FinalExport] ${warningMsg}`)
      // KHÔNG throw error - chỉ log warning để user biết
      // User có thể tự quyết định có muốn tiếp tục hay không
    } else {
      console.log(
        `[FinalExport] ✓ Kiểm tra dung lượng: Ổ ${diskInfo.drive} còn ${formatBytes(diskInfo.free)}, đủ cho ${jobLabel} (cần ~${formatBytes(estimatedBytes)})`
      )
    }
  } catch (err) {
    // Nếu không kiểm tra được dung lượng, chỉ log warning, không chặn
    console.warn(
      `[FinalExport] ⚠️ Không thể kiểm tra dung lượng ổ đĩa cho ${jobLabel}:`,
      err instanceof Error ? err.message : String(err)
    )
    console.warn(`[FinalExport] Vẫn tiếp tục xuất video...`)
    // KHÔNG throw error - cho phép user tiếp tục
  }
}

function getFfmpegExecutable(explicitPath?: string): string {
  const ffmpeg = explicitPath || getFfmpegPaths().ffmpeg
  if (process.platform === 'win32' && ffmpeg.match(/^[A-Z]:\\.*$/) && ffmpeg.length > 240) {
    return ffmpeg.startsWith('\\\\?\\') ? ffmpeg : `\\\\?\\${ffmpeg}`
  }
  return ffmpeg
}

// ═══════════════════════════════════════════════════════════════
// 2-PASS PRE-TRANSCODE: Giải quyết triệt để vấn đề "dừng hình" (frame freeze)
// ═══════════════════════════════════════════════════════════════
//
// VẤN ĐỀ GỐC:
//   Khi concat demuxer ghép hàng trăm clip video bằng 1 lệnh FFmpeg duy nhất
//   (concat → re-encode), mỗi khi chuyển clip:
//     • Decoder phải reinit vì stream parameters thay đổi (SPS/PPS, resolution, pixel format)
//     • Filter chain bị flush → frame cuối bị repeat → DỪNG HÌNH (freeze frame)
//   Đây là giới hạn kiến trúc của FFmpeg concat demuxer, KHÔNG thể fix bằng flags.
//
// GIẢI PHÁP:
//   Pass 1: Transcode TỪNG clip riêng lẻ → cùng format (resolution, FPS, codec, pixel format)
//   Pass 2: Concat COPY các clip đã chuẩn hóa + mux với audio → output final
//   → Clip đã uniform → concat copy KHÔNG cần reinit decoder → KHÔNG freeze
//
// ═══════════════════════════════════════════════════════════════

type PreTranscodeMode = 'software' | 'gpu_heavy'

interface PreTranscodeClipsOptions {
  /** Danh s?ch clip video g?c (path + duration) */
  clips: Array<{ path: string; durationSec: number }>
  /** Th? m?c temp ?? l?u clip ?? transcode */
  tempDir: string
  /** VF filter chu?n h?a (resolution + FPS + pad + format) */
  vfFilter: string
  /** Hybrid CUDA filter cho NVENC path (nếu có) */
  gpuHybridVfFilter?: string | null
  /** Chế độ pre-transcode đã resolve */
  preTranscodeMode?: PreTranscodeMode
  /** GPU encoding choice */
  useGpuEncoding?: 'gpu' | 'cpu' | 'auto'
  /** Request ID ?? cancel */
  requestId: string
  /** Callback emit progress (percent 0-70 cho pass 1) */
  onProgress?: (percent: number, speedX?: number | null) => void
  /** T?ng duration video t?i thi?u c?n t?o ra */
  minimumDurationSec: number
  /** Nh?ng clip ?? fail tr??c ?? trong c?ng export, kh?ng ???c th? l?i */
  failedSourcePaths?: Set<string>
  /** Cache clip ?? pre-transcode th?nh c?ng ?? reuse gi?a c?c l?n l?p/job */
  transcodedCache?: Map<string, string>
  /** FIX BUG 3: Out-parameter — nếu truyền, preTranscodeClips sẽ push durationSec song song với transcodedPaths */
  outDurations?: number[]
}
function sanitizePreTranscodeEncoderArgs(rawEncoderArgs: string[]): string[] {
  const sanitizedArgs: string[] = []
  for (let i = 0; i < rawEncoderArgs.length; i++) {
    if (rawEncoderArgs[i] === '-hwaccel') {
      i++
      continue
    }
    if (rawEncoderArgs[i] === '-vsync' && rawEncoderArgs[i + 1] === '2') {
      sanitizedArgs.push('-vsync', 'cfr')
      i++
      continue
    }
    sanitizedArgs.push(rawEncoderArgs[i])
  }
  return sanitizedArgs
}

function buildGpuHeavyPreTranscodeArgs(rawEncoderArgs: string[]): string[] {
  const normalizedArgs: string[] = []
  for (let i = 0; i < rawEncoderArgs.length; i++) {
    if (rawEncoderArgs[i] === '-hwaccel') {
      i++
      continue
    }
    if (rawEncoderArgs[i] === '-vsync' && rawEncoderArgs[i + 1] === '2') {
      normalizedArgs.push('-vsync', 'cfr')
      i++
      continue
    }
    normalizedArgs.push(rawEncoderArgs[i])
  }
  return normalizedArgs
}

function cleanupPreTranscodeOutput(outputFile: string): void {
  try {
    if (fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile)
    }
  } catch {
    // ignore cleanup failures for stale temp outputs
  }
}

function getSafePlaceholderDuration(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 1
  return Math.max(durationSec, 0.25)
}

function hasUsablePreTranscodedOutput(outputPath: string | undefined): outputPath is string {
  if (!outputPath) return false
  try {
    const stats = fs.statSync(outputPath)
    return stats.isFile() && stats.size > 0
  } catch {
    return false
  }
}

function findMissingPreTranscodedOutputs(paths: string[]): string[] {
  return paths.filter((outputPath) => !hasUsablePreTranscodedOutput(outputPath))
}

function isPass2InputMissingFailure(message: string): boolean {
  if (!message) return false
  return /Impossible to open .*pre_\d+\.mp4|Error opening input file .*concat_pass2\.txt|No such file or directory/i.test(message)
}

function isPass2MuxMemoryFailure(message: string): boolean {
  if (!message) return false
  return /Cannot allocate memory|Error muxing a packet|Error submitting a packet to the muxer|Task finished with error code: -12|Cannot allocate memory/i.test(message)
}

function filterOutQuarantinedClips(clips: ClipItem[], quarantinedPaths: Set<string>): ClipItem[] {
  if (!quarantinedPaths.size) return clips
  return clips.filter((clip) => !quarantinedPaths.has(clip.path))
}


/**
 * Pass 1: Pre-transcode từng clip video riêng lẻ thành format chuẩn hóa.
 *
 * Mỗi clip được encode ĐỘC LẬP:
 * - Decode clip gốc (dù SPS/PPS, resolution khác nhau → không ảnh hưởng clip khác)
 * - Apply vf filter (scale, pad, fps, format) → output cùng chính xác resolution + FPS + pixel format
 * - Encode bằng GPU (NVENC) hoặc CPU (libx264)
 * - Output: H.264 Baseline, yuv420p, CFR, keyframe ở frame 0
 *
 * Kết quả: tất cả clip output có stream parameters GIỐNG HỆT NHAU
 * → concat copy ở Pass 2 KHÔNG cần reinit decoder → KHÔNG freeze frame.
 *
 * @returns Danh sách path đến clip đã transcode (theo đúng thứ tự input)
 */
async function preTranscodeClips(opts: PreTranscodeClipsOptions): Promise<string[]> {
  const {
    clips,
    tempDir,
    vfFilter,
    gpuHybridVfFilter,
    preTranscodeMode = 'software',
    useGpuEncoding,
    requestId,
    onProgress,
    minimumDurationSec,
    failedSourcePaths,
    transcodedCache,
    outDurations,
  } = opts
  const defaultFfmpegPath = getFfmpegExecutable()
  const transcodedPaths: string[] = []
  const quarantinedSourcePaths = failedSourcePaths ?? new Set<string>()
  const reusableTranscodedClipCache = transcodedCache ?? new Map<string, string>()
  let lastSpeedX: number | null = null
  let usableDurationSec = 0
  let skippedClipCount = 0
  let skippedKnownBadCount = 0
  let reusedClipCount = 0
  let placeholderClipCount = 0

  const encoderChoice = useGpuEncoding || 'auto'
  const hasNetworkSource = clips.some((clip) => clip.path.startsWith('\\'))
  const effectiveEncoderChoice =
    encoderChoice === 'auto' && hasNetworkSource ? 'cpu' : encoderChoice

  if (effectiveEncoderChoice !== encoderChoice) {
    console.log(
      '[PreTranscode] Network source detected; forcing CPU encoder for reliability instead of auto GPU.'
    )
  }

  const primaryEncoder = await buildVideoEncoderArgsWithChoice(true, effectiveEncoderChoice, 'fast')
  const gpuHeavyRequested = preTranscodeMode === 'gpu_heavy' && primaryEncoder.usedEncoder === 'gpu'
  const primaryArgs = gpuHeavyRequested
    ? buildGpuHeavyPreTranscodeArgs(primaryEncoder.args)
    : sanitizePreTranscodeEncoderArgs(primaryEncoder.args)
  const cpuFallback = primaryEncoder.usedEncoder === 'gpu'
    ? await buildVideoEncoderArgsWithChoice(true, 'cpu', 'fast')
    : null
  const cpuFallbackArgs = cpuFallback
    ? sanitizePreTranscodeEncoderArgs(cpuFallback.args)
    : sanitizePreTranscodeEncoderArgs(primaryEncoder.args)
  const gpuFfmpegPath =
    primaryEncoder.usedEncoder === 'gpu' && primaryEncoder.gpuInfo?.ffmpegPath
      ? getFfmpegExecutable(primaryEncoder.gpuInfo.ffmpegPath)
      : defaultFfmpegPath
  let gpuDisabledForRemainingClips = false

  if (primaryEncoder.usedEncoder === 'gpu' && primaryEncoder.gpuInfo) {
    console.log(
      `[PreTranscode] Using ${(primaryEncoder.gpuInfo as any).encoder?.toUpperCase()} encoder (${(primaryEncoder.gpuInfo as any).name || 'GPU'})`
    )
    console.log(
      `[PreTranscode] Mode: ${gpuHeavyRequested ? 'gpu_heavy hybrid CUDA normalize' : 'software normalize (GPU encode only)'}`
    )
  } else {
    console.log('[PreTranscode] Using CPU encoder (libx264)')
    console.log('[PreTranscode] Mode: software normalize (CPU only)')
  }

  console.log(`[PreTranscode] Starting pre-transcode of ${clips.length} candidate clips to uniform format...`)
  console.log(`[PreTranscode] vf filter: ${vfFilter}`)
  if (gpuHeavyRequested && gpuHybridVfFilter) {
    console.log(`[PreTranscode] hybrid CUDA filter: ${gpuHybridVfFilter}`)
  }

  // ── Concat-safe args: force uniform timebase, closed GOP & keyframe cadence ──
  // These ensure all pre-transcoded clips have identical stream parameters
  // so that Pass 2 concat-copy never hits PTS/DTS discontinuities.
  const targetFpsStr = extractFpsFromVfFilter(vfFilter)
  const primaryEncoderName = detectEncoderFromArgs(primaryArgs)
  const cpuEncoderName = detectEncoderFromArgs(cpuFallbackArgs)
  const concatSafeArgsPrimary = buildConcatSafeOutputArgs(primaryEncoderName, targetFpsStr)
  const concatSafeArgsCpu = buildConcatSafeOutputArgs(cpuEncoderName, targetFpsStr)
  console.log(`[PreTranscode] Concat-safe args (primary ${primaryEncoderName}):`, concatSafeArgsPrimary)
  if (primaryEncoderName !== cpuEncoderName) {
    console.log(`[PreTranscode] Concat-safe args (cpu fallback ${cpuEncoderName}):`, concatSafeArgsCpu)
  }

  const isCancelRequested = (childRequestId?: string): boolean => {
    return videoJobManager.isCancelled(requestId) || (!!childRequestId && videoJobManager.isCancelled(childRequestId))
  }

  const runAttempt = async (
    clip: { path: string; durationSec: number },
    index: number,
    mode: 'gpu' | 'cpu' | 'placeholder',
    ffmpegPath: string,
    encoderArgs: string[],
    outputFile: string,
    source: { kind: 'file'; path: string } | { kind: 'lavfi'; spec: string; durationSec: number }
  ): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      let settled = false
      let stderrTail = ''
      const safeResolve = () => { if (!settled) { settled = true; resolve() } }
      const safeReject = (err: Error) => { if (!settled) { settled = true; reject(err) } }

      const selectedVfFilter =
        mode === 'gpu' && gpuHeavyRequested && gpuHybridVfFilter ? gpuHybridVfFilter : vfFilter
      // Pick concat-safe args matching the encoder being used in this attempt
      const concatSafeArgs = mode === 'gpu' ? concatSafeArgsPrimary : concatSafeArgsCpu
      const args =
        source.kind === 'file'
          ? [
              '-hide_banner',
              '-y',
              '-fflags', '+genpts+igndts+discardcorrupt',
              '-i', source.path,
              '-vf', selectedVfFilter,
              ...encoderArgs,
              ...concatSafeArgs,
              '-map', '0:v:0',
              '-an',
              '-avoid_negative_ts', 'make_zero',
              '-movflags', '+faststart',
              outputFile,
            ]
          : [
              '-hide_banner',
              '-y',
              '-f', 'lavfi',
              '-i', source.spec,
              '-t', source.durationSec.toFixed(3),
              '-vf', selectedVfFilter,
              ...encoderArgs,
              ...concatSafeArgs,
              '-map', '0:v:0',
              '-an',
              '-avoid_negative_ts', 'make_zero',
              '-movflags', '+faststart',
              outputFile,
            ]

      const proc = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      const childRequestId = `${requestId}-pretranscode-${index}-${mode}`
      videoJobManager.registerJob(childRequestId, proc)

      const clipTimeoutMs = 10 * 60 * 1000
      const clipTimer = setTimeout(() => {
        if (!proc.killed) {
          console.warn(
            `[PreTranscode] Clip ${index + 1}/${clips.length} (${mode}) timed out after ${clipTimeoutMs / 1000}s, killing...`
          )
          proc.kill('SIGTERM')
          setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 2000)
          const detail = stderrTail.trim() ? `\nstderr:\n${stderrTail.trim()}` : ''
          safeReject(
            new Error(
              `[PreTranscode] Clip ${index + 1}/${clips.length} timed out after ${clipTimeoutMs / 60000} phút: ${path.basename(clip.path)}${detail}`
            )
          )
        }
      }, clipTimeoutMs)

      // FIX PERF-7: Throttle progress emit — 500ms thay vì mỗi stderr chunk
      let lastPreTranscodeProgressMs = 0
      proc.stderr?.on('data', (data: Buffer) => {
        if (isCancelRequested(childRequestId)) {
          if (!videoJobManager.isCancelled(requestId)) {
            videoJobManager.cancelJob(requestId)
          }
          if (!proc.killed) {
            proc.kill('SIGTERM')
            setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 1000)
          }
          safeReject(new Error('Đã dừng bởi người dùng'))
          return
        }

        const text = data.toString('utf-8')
        stderrTail += text
        if (stderrTail.length > 12000) {
          stderrTail = stderrTail.slice(-12000)
        }

        const speedMatch = text.match(/speed=\s*([0-9.]+)x/i)
        if (speedMatch) {
          const speed = parseFloat(speedMatch[1])
          if (!isNaN(speed) && speed > 0) {
            lastSpeedX = speed
          }
        }

        // FIX PERF-7: Throttle 500ms — giảm IPC overhead từ ~30/s xuống ~2/s
        const nowMs = Date.now()
        if (onProgress && minimumDurationSec > 0 && nowMs - lastPreTranscodeProgressMs > 500) {
          lastPreTranscodeProgressMs = nowMs
          const percent = Math.min(70, (usableDurationSec / minimumDurationSec) * 70)
          onProgress(percent, lastSpeedX)
        }
      })

      proc.on('error', (err) => {
        clearTimeout(clipTimer)
        const detail = stderrTail.trim() ? `\nstderr:\n${stderrTail.trim()}` : ''
        safeReject(
          new Error(
            `[PreTranscode] Spawn error (${mode}) for ${path.basename(clip.path)}: ${err.message}${detail}`
          )
        )
      })

      proc.on('close', (code) => {
        clearTimeout(clipTimer)
        if (isCancelRequested(childRequestId)) {
          if (!videoJobManager.isCancelled(requestId)) {
            videoJobManager.cancelJob(requestId)
          }
          safeReject(new Error('Đã dừng bởi người dùng'))
          return
        }

        let outputOk = false
        try {
          const stats = fs.statSync(outputFile)
          outputOk = code === 0 && stats.isFile() && stats.size > 0
        } catch {
          outputOk = false
        }

        if (outputOk) {
          safeResolve()
          return
        }

        const detail = stderrTail.trim() ? `\nstderr:\n${stderrTail.trim()}` : ''
        safeReject(
          new Error(
            `[PreTranscode] Failed clip ${index + 1}/${clips.length}: ${path.basename(clip.path)} (code ${code}, mode=${mode})${detail}`
          )
        )
      })
    })

  for (let i = 0; i < clips.length; i++) {
    if (usableDurationSec >= minimumDurationSec && transcodedPaths.length > 0) {
      break
    }
    if (videoJobManager.isCancelled(requestId)) {
      throw new Error('Đã dừng bởi người dùng')
    }

    const clip = clips[i]

    if (quarantinedSourcePaths.has(clip.path)) {
      skippedKnownBadCount++
      continue
    }

    const cachedOutput = reusableTranscodedClipCache.get(clip.path)
    if (hasUsablePreTranscodedOutput(cachedOutput)) {
      transcodedPaths.push(cachedOutput)
      outDurations?.push(clip.durationSec)
      usableDurationSec += Math.max(clip.durationSec, 0)
      reusedClipCount++
      if (onProgress && minimumDurationSec > 0) {
        const percent = Math.min(70, (usableDurationSec / minimumDurationSec) * 70)
        onProgress(percent, lastSpeedX)
      }
      continue
    }
    if (cachedOutput) {
      reusableTranscodedClipCache.delete(clip.path)
    }

    const outputFile = path.join(tempDir, `pre_${String(i).padStart(5, '0')}.mp4`)
    const primaryMode: 'gpu' | 'cpu' =
      primaryEncoder.usedEncoder === 'gpu' && !gpuDisabledForRemainingClips ? 'gpu' : 'cpu'
    const primaryAttemptArgs = primaryMode === 'gpu' ? primaryArgs : cpuFallbackArgs

    try {
      cleanupPreTranscodeOutput(outputFile)
      await runAttempt(
        clip,
        i,
        primaryMode,
        primaryMode === 'gpu' ? gpuFfmpegPath : defaultFfmpegPath,
        primaryAttemptArgs,
        outputFile,
        { kind: 'file', path: clip.path },
      )
      transcodedPaths.push(outputFile)
      outDurations?.push(clip.durationSec)
      reusableTranscodedClipCache.set(clip.path, outputFile)
      usableDurationSec += Math.max(clip.durationSec, 0)
    } catch (primaryErr: any) {
      if (videoJobManager.isCancelled(requestId)) {
        throw primaryErr
      }

      const primaryMessage = primaryErr?.message || String(primaryErr)
      let recovered = false

      if (primaryMode === 'gpu') {
        console.warn(
          `[PreTranscode] GPU ${gpuHeavyRequested ? 'hybrid normalize ' : ''}failed for clip ${i + 1}/${clips.length} (${path.basename(clip.path)}). Retrying on CPU software normalize.\n${primaryMessage}`
        )
        cleanupPreTranscodeOutput(outputFile)
        try {
          await runAttempt(clip, i, 'cpu', defaultFfmpegPath, cpuFallbackArgs, outputFile, { kind: 'file', path: clip.path })
          transcodedPaths.push(outputFile)
          outDurations?.push(clip.durationSec)
          reusableTranscodedClipCache.set(clip.path, outputFile)
          usableDurationSec += Math.max(clip.durationSec, 0)
          gpuDisabledForRemainingClips = true
          recovered = true
          console.warn(
            `[PreTranscode] CPU retry succeeded for ${path.basename(clip.path)}. GPU disabled for remaining clips in this export.`
          )
        } catch (cpuErr: any) {
          const cpuMessage = cpuErr?.message || String(cpuErr)
          console.warn(
            `[PreTranscode] Skipping broken clip ${path.basename(clip.path)} after GPU and CPU failure.\n${primaryMessage}\n${cpuMessage}`
          )
          cleanupPreTranscodeOutput(outputFile)
          gpuDisabledForRemainingClips = true
          quarantinedSourcePaths.add(clip.path)
          reusableTranscodedClipCache.delete(clip.path)
          skippedClipCount++
          recovered = true
        }
      }

      if (!recovered) {
        console.warn(
          `[PreTranscode] Skipping broken clip ${path.basename(clip.path)} after CPU failure.\n${primaryMessage}`
        )
        cleanupPreTranscodeOutput(outputFile)
        quarantinedSourcePaths.add(clip.path)
        reusableTranscodedClipCache.delete(clip.path)
        skippedClipCount++
      }
    }

    if ((i + 1) % 50 === 0 || i === clips.length - 1) {
      console.log(
        `[PreTranscode] Completed ${i + 1}/${clips.length} candidate clips, usableDuration=${usableDurationSec.toFixed(2)}s`
      )
    }

    if (onProgress && minimumDurationSec > 0) {
      const percent = Math.min(70, (usableDurationSec / minimumDurationSec) * 70)
      onProgress(percent, lastSpeedX)
    }
  }

  if (usableDurationSec < minimumDurationSec) {
    const missingDurationSec = minimumDurationSec - usableDurationSec
    const fillerIndex = transcodedPaths.length
    const fillerOutput = path.join(tempDir, `pre_filler_${String(fillerIndex).padStart(5, '0')}.mp4`)
    cleanupPreTranscodeOutput(fillerOutput)
    await runAttempt(
      { path: '__placeholder__', durationSec: missingDurationSec },
      clips.length,
      'placeholder',
      defaultFfmpegPath,
      cpuFallbackArgs,
      fillerOutput,
      {
        kind: 'lavfi',
        spec: 'color=c=black:s=32x32:r=30',
        durationSec: getSafePlaceholderDuration(missingDurationSec),
      }
    )
    transcodedPaths.push(fillerOutput)
    outDurations?.push(missingDurationSec)
    usableDurationSec += missingDurationSec
    placeholderClipCount++
    console.warn(
      `[PreTranscode] Reserve clips not enough. Injected ${missingDurationSec.toFixed(2)}s placeholder video to keep export running.`
    )
  }

  if (reusedClipCount > 0) {
    console.log(
      `[PreTranscode] Reused ${reusedClipCount} pre-transcoded clip occurrence(s) from cache instead of transcoding again.`
    )
  }
  if (skippedKnownBadCount > 0) {
    console.warn(
      `[PreTranscode] Ignored ${skippedKnownBadCount} clip occurrence(s) because the source path had already failed earlier in this export.`
    )
  }
  if (skippedClipCount > 0) {
    console.warn(
      `[PreTranscode] Skipped ${skippedClipCount} broken clip(s) and continued with reserve clips.`
    )
  }
  if (placeholderClipCount > 0) {
    console.warn(
      `[PreTranscode] Added ${placeholderClipCount} placeholder clip(s) because source clips were insufficient after recovery.`
    )
  }

  console.log(
    `[PreTranscode] Ready ${transcodedPaths.length} clip(s) with usableDuration=${usableDurationSec.toFixed(2)}s for target=${minimumDurationSec.toFixed(2)}s`
  )
  return transcodedPaths
}

/**
 * Parse danh sách clip (path + duration) từ concat list file.
 * Format concat list: "file 'path'\ninpoint 0\nduration X.XXXXXX"
 */
function parseClipsFromConcatList(listContent: string): Array<{ path: string; durationSec: number }> {
  const clips: Array<{ path: string; durationSec: number }> = []
  const lines = listContent.split('\n').map(l => l.trim()).filter(Boolean)

  let currentPath: string | null = null
  let currentDuration = 0

  for (const line of lines) {
    const fileMatch = line.match(/^file\s+'(.+?)'\s*$/)
    if (fileMatch) {
      // Nếu đang có clip trước đó, push nó
      if (currentPath !== null) {
        clips.push({ path: currentPath, durationSec: currentDuration })
      }
      // Unescape path: FFmpeg concat list dùng \' cho single quote
      // và forward slash (đã normalize từ Windows backslash)
      let filePath = fileMatch[1].replace(/\\'/g, "'")
      // On Windows, convert forward slashes back to backslashes for fs access
      if (process.platform === 'win32') {
        filePath = filePath.replace(/\//g, '\\')
      }
      currentPath = filePath
      currentDuration = 0
      continue
    }

    const durationMatch = line.match(/^duration\s+([0-9.]+)\s*$/)
    if (durationMatch && currentPath !== null) {
      currentDuration = parseFloat(durationMatch[1]) || 0
    }
    // 'inpoint 0' và các directive khác → bỏ qua
  }

  // Push clip cuối cùng
  if (currentPath !== null) {
    clips.push({ path: currentPath, durationSec: currentDuration })
  }

  return clips
}

interface RunFinalCommandOptions {
  requestId: string
  totalDurationSec: number
  videoListPath: string
  tempWorkspaceDir: string
  audioPath: string
  outputPath: string
  audioCodec: string | null
  forceReencode?: boolean
  normalizeAudio?: boolean
  emitProgress: (payload: FinalExportProgressPayload) => void
  useGpuEncoding?: 'gpu' | 'cpu' | 'auto' // GPU encoding choice
  normalizeVfFilter?: string | null // vf filter for resolution/FPS normalization
  gpuHybridNormalizeVfFilter?: string | null
  preTranscodeMode?: PreTranscodeMode
  failedVideoSourcePaths?: Set<string>
  reusableTranscodedClipCache?: Map<string, string>
}

async function runFinalCommand(opts: RunFinalCommandOptions): Promise<void> {
  const {
    requestId,
    totalDurationSec,
    videoListPath,
    tempWorkspaceDir,
    audioPath,
    outputPath,
    audioCodec,
    forceReencode = false,
    normalizeAudio = false,
    emitProgress,
    useGpuEncoding,
    normalizeVfFilter,
    gpuHybridNormalizeVfFilter,
    preTranscodeMode,
    failedVideoSourcePaths,
    reusableTranscodedClipCache,
  } = opts
  const defaultFfmpegPath = getFfmpegExecutable()

  await fsp.mkdir(path.dirname(outputPath), { recursive: true })

  const codec = audioCodec?.toLowerCase() ?? null
  const needAudioEncode = !codec || (codec !== 'aac' && codec !== 'mp3')
  // FIX COPY-STREAM BUG 1+2: Decouple video re-encode decision from audio encode decision.
  // Before: needsReencode = forceReencode || needAudioEncode || normalizeAudio || !!normalizeVfFilter
  //   → This forced VIDEO re-encode whenever AUDIO needed encoding (e.g., FLAC audio → AAC).
  //   → Massive performance waste: full libx264/NVENC re-encode of video just for audio conversion.
  // After: needVideoReencode only considers video-specific conditions (forceReencode, vf filter).
  //   Audio encoding is handled independently via shouldEncodeAudio.
  const needVideoReencode = forceReencode || !!normalizeVfFilter

  // ═══════════════════════════════════════════════════════════════
  // STRATEGY:
  //   Khi có normalizeVfFilter (re-encode + scale/fps filter):
  //     → Dùng 2-PASS APPROACH để tránh frame freeze triệt để
  //     Pass 1: Pre-transcode từng clip riêng lẻ → uniform format
  //     Pass 2: Concat COPY + mux audio → final output
  //
  //   Khi KHÔNG có vf filter (copy-stream hoặc re-encode đơn giản):
  //     → Dùng single-step approach (cũ)
  // ═══════════════════════════════════════════════════════════════
  if (normalizeVfFilter) {
    console.log('[FinalExport] *** 2-PASS MODE *** vf filter active → pre-transcode từng clip để tránh frame freeze')
    await runFinalCommand_TwoPass({
      ...opts,
      gpuHybridNormalizeVfFilter,
      preTranscodeMode,
    })
    return
  }

  // ─── SINGLE-STEP APPROACH (copy-stream hoặc re-encode đơn giản không có vf filter) ───
  const encoderChoice = useGpuEncoding || 'auto'
  const { args: rawVideoCodecArgs, usedEncoder, gpuInfo } = needVideoReencode
    ? await buildVideoEncoderArgsWithChoice(true, encoderChoice, 'fast')
    : { args: ['-c:v', 'copy'], usedEncoder: 'cpu' as const, gpuInfo: null }
  const ffmpegPath =
    needVideoReencode && usedEncoder === 'gpu' && gpuInfo?.ffmpegPath
      ? getFfmpegExecutable(gpuInfo.ffmpegPath)
      : defaultFfmpegPath

  let videoCodecArgs = rawVideoCodecArgs
  if (needVideoReencode) {
    // FIX PERF-4: Strip -hwaccel (concat demuxer không hỗ trợ nvdec/d3d11va decode)
    // + Replace -vsync 2 → cfr
    const sanitized: string[] = []
    for (let i = 0; i < rawVideoCodecArgs.length; i++) {
      if (rawVideoCodecArgs[i] === '-hwaccel') {
        i++ // skip value (nvdec, d3d11va, etc.)
        continue
      }
      if (rawVideoCodecArgs[i] === '-vsync' && rawVideoCodecArgs[i + 1] === '2') {
        sanitized.push('-vsync', 'cfr')
        i++
        continue
      }
      sanitized.push(rawVideoCodecArgs[i])
    }
    videoCodecArgs = sanitized
    console.log('[FinalExport] re-encode mode (no vf filter) → using -vsync cfr, stripped hwaccel for concat')
  } else {
    videoCodecArgs = ['-c:v', 'copy', '-fps_mode', 'passthrough']
    console.log('[FinalExport] copy-stream mode → -fps_mode passthrough + concat duration metadata')
  }

  if (needVideoReencode) {
    if (usedEncoder === 'gpu' && gpuInfo) {
      console.log(`[FinalExport] Using ${(gpuInfo as any).encoder?.toUpperCase()} encoder`)
    } else {
      console.log(`[FinalExport] Using CPU encoder (libx264)`)
    }
  }

  // Single-step FFmpeg command
  await runFinalCommand_SingleStep({
    ffmpegPath,
    requestId,
    totalDurationSec,
    videoListPath,
    tempWorkspaceDir,
    audioPath,
    outputPath,
    videoCodecArgs,
    needVideoReencode,
    forceReencode,
    needAudioEncode,
    normalizeAudio,
    normalizeVfFilter: null, // single-step không dùng vf filter (đã xử lý ở trên)
    emitProgress,
  })
}

// ═══════════════════════════════════════════════════════════════
// 2-PASS IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════
async function runFinalCommand_TwoPass(opts: RunFinalCommandOptions): Promise<void> {
  const {
    requestId,
    totalDurationSec,
    videoListPath,
    tempWorkspaceDir,
    audioPath,
    outputPath,
    audioCodec,
    forceReencode = false,
    normalizeAudio = false,
    emitProgress,
    useGpuEncoding,
    normalizeVfFilter,
    gpuHybridNormalizeVfFilter,
    preTranscodeMode = 'software',
    failedVideoSourcePaths,
    reusableTranscodedClipCache,
  } = opts
  const ffmpegPath = getFfmpegExecutable()

  // Đọc concat list để lấy danh sách clip
  const listContent = await fsp.readFile(videoListPath, 'utf-8')
  const clips = parseClipsFromConcatList(listContent)

  if (clips.length === 0) {
    console.warn('[FinalExport 2-Pass] No source clips in concat list. Falling back to placeholder-only video if needed.')
  }

  console.log(`[FinalExport 2-Pass] Parsed ${clips.length} clips from concat list`)

  const tempDir = path.join(tempWorkspaceDir, 'two-pass')
  await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  await fsp.mkdir(tempDir, { recursive: true })
  console.log(`[FinalExport 2-Pass] Scratch dir: ${tempDir}`)

  try {
    // ──── PASS 1: Pre-transcode từng clip riêng lẻ ────
    console.log(`[FinalExport 2-Pass] === PASS 1: Pre-transcoding ${clips.length} clips ===`)
    console.log(
      `[FinalExport 2-Pass] Pass 1 normalize mode: ${preTranscodeMode === 'gpu_heavy' ? 'GPU-heavy hybrid CUDA' : 'software'}${gpuHybridNormalizeVfFilter ? '' : ' (no GPU hybrid filter available)'}`,
    )
    emitProgress({
      requestId,
      stage: 'export',
      percent: 0,
      timeSec: 0,
      totalDurationSec,
      status: `Pass 1/2: Đang chuẩn hóa ${clips.length} video clips...`,
    })

    // FIX BUG 3: Collect durations alongside transcodedPaths for Pass 2 concat metadata
    let transcodedDurations: number[] = []

    const runPass1 = async (transcodedCache: Map<string, string>, durations: number[]) =>
      preTranscodeClips({
        clips,
        tempDir,
        vfFilter: normalizeVfFilter!,
        gpuHybridVfFilter: gpuHybridNormalizeVfFilter,
        preTranscodeMode,
        useGpuEncoding: useGpuEncoding || 'auto',
        requestId,
        minimumDurationSec: totalDurationSec,
        failedSourcePaths: failedVideoSourcePaths,
        transcodedCache,
        outDurations: durations,
        onProgress: (percent, speedX) => {
          emitProgress({
            requestId,
            stage: 'export',
            percent: Math.min(69, percent),
            timeSec: (percent / 100) * totalDurationSec,
            totalDurationSec,
            speedX: speedX ?? undefined,
            status: `Pass 1/2: Đang chuẩn hóa video clips (${Math.round(percent)}%)...`,
          })
        },
      })

    let transcodedPaths = await runPass1(reusableTranscodedClipCache ?? new Map<string, string>(), transcodedDurations)
    let missingPass2Inputs = findMissingPreTranscodedOutputs(transcodedPaths)

    if (missingPass2Inputs.length > 0) {
      const sample = missingPass2Inputs.slice(0, 5).map((filePath) => path.basename(filePath)).join(', ')
      console.warn(
        `[FinalExport 2-Pass] Detected ${missingPass2Inputs.length} missing pre-transcoded clip(s) before Pass 2 (${sample}). Rebuilding Pass 1 once...`
      )
      for (const outputFile of Array.from(new Set(transcodedPaths))) {
        cleanupPreTranscodeOutput(outputFile)
      }
      transcodedDurations = []
      transcodedPaths = await runPass1(new Map<string, string>(), transcodedDurations)
      missingPass2Inputs = findMissingPreTranscodedOutputs(transcodedPaths)
      if (missingPass2Inputs.length > 0) {
        const retrySample = missingPass2Inputs.slice(0, 5).join(', ')
        throw new Error(
          `[FinalExport 2-Pass] Pass 1 still missing ${missingPass2Inputs.length} clip temp file(s) before Pass 2: ${retrySample}`
        )
      }
    }

    // Check cancel
    if (videoJobManager.isCancelled(requestId)) {
      throw new Error('Đã dừng bởi người dùng')
    }

    // ──── PASS 2: Concat COPY + mux audio ────
    console.log(`[FinalExport 2-Pass] === PASS 2: Concat copy ${transcodedPaths.length} pre-transcoded clips + mux audio ===`)
    emitProgress({
      requestId,
      stage: 'export',
      percent: 70,
      timeSec: 0,
      totalDurationSec,
      status: `Pass 2/2: Đang ghép video + audio...`,
    })

    // FIX BUG 3: Build concat list với inpoint 0 + duration metadata cho PTS accuracy
    const pass2ListPath = path.join(tempDir, 'concat_pass2.txt')
    const pass2ListContent = transcodedPaths
      .map((p, idx) => {
        const dur = transcodedDurations[idx]
        const durLine = dur != null && dur > 0 ? `\ninpoint 0\nduration ${dur.toFixed(6)}` : ''
        return `file '${escapePathForFfmpegList(p)}'${durLine}`
      })
      .join('\n')
    await fsp.writeFile(pass2ListPath, pass2ListContent, 'utf-8')

    // Audio args
    const codec = audioCodec?.toLowerCase() ?? null
    const needAudioEncode = !codec || (codec !== 'aac' && codec !== 'mp3')
    const shouldEncodeAudio = forceReencode || needAudioEncode || normalizeAudio
    const audioCodecArgs = shouldEncodeAudio
      ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2']
      : ['-c:a', 'copy']
    const audioFilterArgs = normalizeAudio
      ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']
      : []

    const runPass2 = async (
      currentTranscodedPaths: string[],
      mode: 'default' | 'memory_safe' = 'default',
    ): Promise<void> => {
      // FIX BUG 3: Include inpoint/duration metadata in Pass 2 concat list
      const currentPass2ListContent = currentTranscodedPaths
        .map((filePath, idx) => {
          const dur = transcodedDurations[idx]
          const durLine = dur != null && dur > 0 ? `\ninpoint 0\nduration ${dur.toFixed(6)}` : ''
          return `file '${escapePathForFfmpegList(filePath)}'${durLine}`
        })
        .join('\n')
      await fsp.writeFile(pass2ListPath, currentPass2ListContent, 'utf-8')

      const pass2Args = [
        '-hide_banner', '-loglevel', 'error', '-stats',
        '-fflags', '+genpts',
        '-f', 'concat', '-safe', '0',
        '-i', pass2ListPath,
        '-i', audioPath,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        ...audioFilterArgs,
        ...audioCodecArgs,
        '-max_muxing_queue_size', mode === 'memory_safe' ? '512' : '2048',
        ...(mode === 'memory_safe' ? ['-flush_packets', '1'] : []),
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        '-t', totalDurationSec.toFixed(3),
        '-y',
        outputPath,
      ]

      await new Promise<void>((resolve, reject) => {
        let settled = false
        const safeResolve = () => { if (!settled) { settled = true; resolve() } }
        const safeReject = (err: Error) => { if (!settled) { settled = true; reject(err) } }

        const child = spawn(ffmpegPath, pass2Args, { windowsHide: true })
        videoJobManager.registerJob(requestId, child)
        child.stdout?.resume()

        let lastEmit = 0
        let stderrLines: string[] = []

        child.stderr?.on('data', (chunk: Buffer) => {
          if (videoJobManager.isCancelled(requestId)) {
            if (!child.killed) {
              child.kill('SIGTERM')
              setTimeout(() => { if (!child.killed) child.kill('SIGKILL') }, 2000)
            }
            return
          }

          const text = chunk.toString('utf-8')
          // FIX PERF-6: Tránh Array.splice O(n) — dùng reassign slice thay vì shift in-place
          const newLines = text.split(/\r?\n/).filter(Boolean)
          if (newLines.length > 0) {
            stderrLines.push(...newLines)
            if (stderrLines.length > 80) stderrLines = stderrLines.slice(-80)
          }

          const timeSec = parseTimeFromChunk(text)
          const speedX = parseSpeedFromChunk(text)
          if (timeSec !== null && totalDurationSec > 0) {
            const pass2Percent = Math.min(100, (timeSec / totalDurationSec) * 100)
            const totalPercent = Math.min(99.4, 70 + (pass2Percent / 100) * 30)
            const now = Date.now()
            if (now - lastEmit > 500) {
              lastEmit = now
              const etaSec = speedX && speedX > 0 ? Math.max(0, (totalDurationSec - timeSec) / Math.max(speedX, 0.1)) : undefined
              emitProgress({
                requestId,
                stage: 'export',
                percent: totalPercent,
                timeSec,
                totalDurationSec,
                speedX: speedX ?? undefined,
                etaSec,
                status: `Pass 2/2: Đang ghép video + audio...`,
              })
            }
          }
        })

        child.on('error', (err) => safeReject(new Error(`FFmpeg Pass 2 spawn error: ${err.message}`)))

        child.on('close', async (code) => {
          if (videoJobManager.isCancelled(requestId)) {
            safeReject(new Error('Đã dừng bởi người dùng'))
            return
          }

          if (code === 0) {
            emitProgress({
              requestId,
              stage: 'finishing',
              percent: 100,
              timeSec: totalDurationSec,
              totalDurationSec,
              speedX: undefined,
              etaSec: 0,
            })
            safeResolve()
            return
          }

          try {
            const stats = await fsp.stat(outputPath)
            if (stats.size > 0) {
              const stderrText = stderrLines.join('\n')
              const isBufferQueueWarning = /buffers queued|Error marking filters as finished/i.test(stderrText)
              if (isBufferQueueWarning) {
                console.warn(`[FinalExport 2-Pass] Pass 2 exited with code ${code} but file exists (${formatBytes(stats.size)}). Verifying...`)
                try {
                  const probeResult = await probeFile(outputPath)
                  const probeDuration = probeResult?.format?.duration ?? 0
                  if (isProbeDurationCloseEnough(probeDuration, totalDurationSec)) {
                    console.warn(`[FinalExport 2-Pass] Probe OK: duration=${probeDuration.toFixed(1)}s. Accepting.`)
                    emitProgress({ requestId, stage: 'finishing', percent: 100, timeSec: totalDurationSec, totalDurationSec, speedX: undefined, etaSec: 0 })
                    safeResolve()
                    return
                  }
                } catch (probeErr) {
                  console.error(`[FinalExport 2-Pass] Probe failed:`, probeErr)
                }
              }
            }
          } catch {
            // file not found
          }

          const tail = stderrLines.slice(-10).join('\n')
          const error = new Error(`FFmpeg Pass 2 (concat copy) failed với mã ${code}. stderr:\n${tail}`)
          ;(error as Error & { missingPass2Inputs?: boolean; muxMemoryFailure?: boolean }).missingPass2Inputs = isPass2InputMissingFailure(tail)
          ;(error as Error & { missingPass2Inputs?: boolean; muxMemoryFailure?: boolean }).muxMemoryFailure = isPass2MuxMemoryFailure(tail)
          safeReject(error)
        })
      })
    }

    let retriedMissingPass2Inputs = false
    let retriedPass2MemorySafe = false
    while (true) {
      try {
        await runPass2(transcodedPaths, retriedPass2MemorySafe ? 'memory_safe' : 'default')
        break
      } catch (error: any) {
        if (!retriedMissingPass2Inputs && error?.missingPass2Inputs) {
          retriedMissingPass2Inputs = true
          console.warn('[FinalExport 2-Pass] Pass 2 lost one or more temp inputs during runtime. Rebuilding Pass 1 and retrying Pass 2 once...')
          // FIX M-04: Clean up partial/corrupt output file before retrying.
          // Pass 2 may have written a partial output before failing.
          try { await fsp.rm(outputPath, { force: true }) } catch {}
          for (const outputFile of Array.from(new Set(transcodedPaths))) {
            cleanupPreTranscodeOutput(outputFile)
          }
          transcodedDurations = []
          transcodedPaths = await runPass1(new Map<string, string>(), transcodedDurations)
          const retryMissingInputs = findMissingPreTranscodedOutputs(transcodedPaths)
          if (retryMissingInputs.length > 0) {
            throw new Error(
              `[FinalExport 2-Pass] Retry aborted because ${retryMissingInputs.length} clip temp file(s) are still missing before Pass 2.`
            )
          }
          continue
        }
        if (!retriedPass2MemorySafe && error?.muxMemoryFailure) {
          retriedPass2MemorySafe = true
          console.warn('[FinalExport 2-Pass] Pass 2 hit mux memory pressure. Retrying once with reduced mux queue size...')
          emitProgress({
            requestId,
            stage: 'export',
            percent: 70,
            timeSec: 0,
            totalDurationSec,
            status: 'Pass 2/2: Đang thử lại với chế độ tiết kiệm bộ nhớ...',
          })
          try {
            await fsp.rm(outputPath, { force: true })
          } catch {
            // ignore stale partial output cleanup errors
          }
          continue
        }
        throw error
      }
    }

    console.log(`[FinalExport 2-Pass] ✓ Export complete: ${outputPath}`)
  } finally {
    // Cleanup temp dir
    try {
      await fsp.rm(tempDir, { recursive: true, force: true })
      console.log(`[FinalExport 2-Pass] Cleaned up temp dir`)
    } catch (cleanupErr) {
      console.warn(`[FinalExport 2-Pass] Failed to cleanup temp dir:`, cleanupErr)
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLE-STEP IMPLEMENTATION (giữ lại cho copy-stream / re-encode đơn giản)
// ═══════════════════════════════════════════════════════════════
interface RunFinalCommandSingleStepOptions {
  ffmpegPath: string
  requestId: string
  totalDurationSec: number
  videoListPath: string
  tempWorkspaceDir: string
  audioPath: string
  outputPath: string
  videoCodecArgs: string[]
  needVideoReencode: boolean
  forceReencode: boolean
  needAudioEncode: boolean
  normalizeAudio: boolean
  normalizeVfFilter: string | null
  emitProgress: (payload: FinalExportProgressPayload) => void
}

async function runFinalCommand_SingleStep(opts: RunFinalCommandSingleStepOptions): Promise<void> {
  const {
    ffmpegPath,
    requestId,
    totalDurationSec,
    videoListPath,
    tempWorkspaceDir: _tempWorkspaceDir,
    audioPath,
    outputPath,
    videoCodecArgs,
    needVideoReencode,
    forceReencode,
    needAudioEncode,
    normalizeAudio,
    normalizeVfFilter,
    emitProgress,
  } = opts

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const safeResolve = () => { if (!settled) { settled = true; resolve() } }
    const safeReject = (err: Error) => { if (!settled) { settled = true; reject(err) } }

    const shouldEncodeAudio = forceReencode || needAudioEncode || normalizeAudio
    const audioCodecArgs = shouldEncodeAudio
      ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2']
      : ['-c:a', 'copy']
    const audioFilterArgs = normalizeAudio
      ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']
      : []

    const args: string[] = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-stats',
      '-fflags', '+genpts+igndts+discardcorrupt',
      ...(needVideoReencode ? ['-reinit_filter', '0'] : []),
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      videoListPath,
      '-i',
      audioPath,
      '-map', '0:v:0',
    ]

    args.push(
      '-map', '1:a:0',
      ...videoCodecArgs,
      ...(normalizeVfFilter ? ['-vf', normalizeVfFilter] : []),
      ...audioFilterArgs,
      ...audioCodecArgs,
      '-max_muxing_queue_size', '2048',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags', '+faststart',
      '-t',
      totalDurationSec.toFixed(3),
      '-y',
      outputPath,
    )

    const child = spawn(ffmpegPath, args, { windowsHide: true })
    videoJobManager.registerJob(requestId, child)
    child.stdout?.resume()

    // Per-job wall-clock timeout: 2 hours max (videos can be long)
    const JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000
    const jobTimer = setTimeout(() => {
      if (!child.killed) {
        console.warn(`[FinalExport] Job ${requestId} timed out after ${JOB_TIMEOUT_MS / 60000} minutes, killing...`)
        child.kill('SIGTERM')
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL') }, 3000)
        safeReject(new Error(`FFmpeg export timed out after ${JOB_TIMEOUT_MS / 60000} phút`))
      }
    }, JOB_TIMEOUT_MS)

    let lastEmit = 0
    let lastTimeSec: number | null = null
    let stderrLines: string[] = []

    let dropWarned = false

    child.stderr?.on('data', (chunk: Buffer) => {
      if (videoJobManager.isCancelled(requestId)) {
        if (!child.killed) {
          child.kill('SIGTERM')
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL')
            }
          }, 2000)
        }
        return
      }

      const text = chunk.toString('utf-8')
      // FIX PERF-6: Tránh Array.splice O(n) — dùng reassign slice
      const newLines = text.split(/\r?\n/).filter(Boolean)
      if (newLines.length > 0) {
        stderrLines.push(...newLines)
        if (stderrLines.length > 80) stderrLines = stderrLines.slice(-80)
      }
      const timeSec = parseTimeFromChunk(text)
      const speedX = parseSpeedFromChunk(text)
      if (timeSec !== null && totalDurationSec > 0) {
        const percent = Math.min(99.4, (timeSec / totalDurationSec) * 100)
        const now = Date.now()
        if (now - lastEmit > 100) {
          lastEmit = now
          const etaSec =
            speedX && speedX > 0 ? Math.max(0, (totalDurationSec - timeSec) / Math.max(speedX, 0.1)) : undefined
          emitProgress({
            requestId,
            stage: 'export',
            percent,
            timeSec,
            totalDurationSec,
            speedX: speedX ?? undefined,
            etaSec,
          })
        }
        lastTimeSec = timeSec
      }

      if (!dropWarned && /drop=\d+/i.test(text)) {
        dropWarned = true
        console.warn('[FinalExport] FFmpeg báo drop-frame trong quá trình export:\n', text)
        emitProgress({
          requestId,
          stage: 'export',
          percent: 100,
          timeSec: timeSec ?? undefined,
          totalDurationSec,
          speedX: speedX ?? undefined,
          etaSec: 0,
          status: '⚠️ FFmpeg báo drop-frame, hãy kiểm tra lại video sau khi xuất.',
        })
      }
    })

    child.on('error', async (error) => {
      clearTimeout(jobTimer)
      safeReject(new Error(`FFmpeg spawn error: ${error.message}`))
    })

    child.on('close', async (code) => {
      clearTimeout(jobTimer)
      if (videoJobManager.isCancelled(requestId)) {
        safeReject(new Error('Đã dừng bởi người dùng'))
        return
      }

      if (code === 0) {
        const finalTimeSec = lastTimeSec !== null && lastTimeSec >= totalDurationSec ? totalDurationSec : totalDurationSec
        emitProgress({
          requestId,
          stage: 'finishing',
          percent: 100,
          timeSec: finalTimeSec,
          totalDurationSec,
          speedX: undefined,
          etaSec: 0,
        })
        safeResolve()
      } else {
        try {
          const stats = await fsp.stat(outputPath)
          if (stats.size > 0) {
            const stderrText = stderrLines.join('\n')
            const isBufferQueueWarning = /buffers queued|Error marking filters as finished/i.test(stderrText)

            if (isBufferQueueWarning) {
              console.warn(
                `[FinalExport] FFmpeg exited with code ${code}, file tồn tại (${formatBytes(stats.size)}). ` +
                `Đang probe verify output trước khi accept...`
              )
              try {
                const probeResult = await probeFile(outputPath)
                const probeDuration = probeResult?.format?.duration ?? 0
                if (isProbeDurationCloseEnough(probeDuration, totalDurationSec)) {
                  console.warn(
                    `[FinalExport] Probe OK: duration=${probeDuration.toFixed(1)}s (expected ~${totalDurationSec.toFixed(1)}s). Accepting output.`
                  )
                  const finalTimeSec = lastTimeSec !== null && lastTimeSec >= totalDurationSec ? totalDurationSec : totalDurationSec
                  emitProgress({
                    requestId,
                    stage: 'finishing',
                    percent: 100,
                    timeSec: finalTimeSec,
                    totalDurationSec,
                    speedX: undefined,
                    etaSec: 0,
                  })
                  safeResolve()
                  return
                } else {
                  console.error(
                    `[FinalExport] Probe FAILED: duration=${probeDuration.toFixed(1)}s (expected ~${totalDurationSec.toFixed(1)}s). Rejecting corrupt output.`
                  )
                }
              } catch (probeError) {
                console.error(`[FinalExport] Probe failed for output, rejecting:`, probeError)
              }
            }
          }
        } catch (checkError) {
          // File không tồn tại hoặc không thể đọc được, tiếp tục reject
        }

        const tail = stderrLines.slice(-10).join('\n')
        safeReject(new Error(`FFmpeg final export failed với mã ${code}. stderr:\n${tail}`))
      }
    })
  })
}

async function cleanupTempDir(dir: string | null): Promise<void> {
  if (!dir) return
  try {
    await fsp.rm(dir, { recursive: true, force: true })

    // FIX H-03: Clean up parent .93media-temp directory if it's now empty.
    // When using same-drive scratch, the structure is:
    //   outputDir/.93media-temp/final-export-<uuid>/
    // After removing the uuid dir, the .93media-temp parent may be empty → clean it up.
    const parent = path.dirname(dir)
    if (path.basename(parent) === '.93media-temp') {
      try {
        const remaining = await fsp.readdir(parent)
        if (remaining.length === 0) {
          await fsp.rmdir(parent)
          console.log('[FinalExport] Cleaned up empty .93media-temp parent directory')
        }
      } catch {
        // Parent dir cleanup is best-effort — ignore errors
      }
    }
  } catch (error) {
    console.warn('[FinalExport] Không thể xoá thư mục tạm:', error)
  }
}

export type FinalExportJobRequest = FinalExportRequestPayload

export async function scanAudioSource(payload: {
  requestId: string
  audioSource: FinalExportRequestPayload['audioSource']
}): Promise<FinalExportScanResult> {
  const files = await loadAudioFiles(payload.audioSource)
  const totalDurationSec = files.reduce((sum, f) => sum + f.durationSec, 0)
  return {
    requestId: payload.requestId,
    kind: 'audio',
    fileCount: files.length,
    totalDurationSec,
    items: files.map((f) => ({
      path: f.path,
      durationSec: f.durationSec,
      codecName: f.codecName,
    })),
  }
}

export async function scanVideoSource(payload: {
  requestId: string
  videoSource: FinalExportRequestPayload['videoSource']
}): Promise<FinalExportScanResult> {
  const clips = await loadVideoClips(payload.videoSource)
  const totalDurationSec = clips.clips.reduce((sum, c) => sum + c.durationSec, 0)
  return {
    requestId: payload.requestId,
    kind: 'video',
    fileCount: clips.clips.length,
    totalDurationSec,
    items: clips.clips.map((clip) => ({
      path: clip.path,
      durationSec: clip.durationSec,
    })),
  }
}

export async function exportFinalVideo(
  request: FinalExportJobRequest,
  emitter: FinalExportEmitter
): Promise<void> {
  const requestId = request.requestId || randomUUID()

  try {
    // PHASE 4-5: Dùng planner + executor pattern
    // Step 1: Plan - scan audio/video và tạo ExportPlan
    const plan = await planFinalExport(
      request.audioSource,
      request.videoSource,
      request.outputFolder,
      request.outputFilename,
      request.outputNames,
      request.priorityVideoSource
    )

    // FIX C-02: Disk space pre-check BEFORE spawning FFmpeg (manual export path).
    // Autopilot has its own checks (ensureAudioDiskSpaceEstimate / ensureVideoDiskSpaceEstimate),
    // but manual export via FinalExportTab was missing this entirely.
    // Estimate: total video clip bytes + 500MB overhead for temp files + re-encoding.
    const estimatedClipBytes = plan.videoClips.reduce(
      (sum, v) => sum + (v.sizeBytes ?? 200 * 1024 * 1024), 0
    )
    const estimatedOutputBytes = estimatedClipBytes + plan.totalJobs * 500 * 1024 * 1024
    await assertMinDiskSpace(
      estimatedOutputBytes,
      request.outputFolder,
      `Xuất ${plan.totalJobs} video (Final Export)`
    )

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

    // Step 2: Execute - chạy từng job
    await executeFinalExport(
      plan,
      requestId,
      emitter,
      request.shuffle || false,
      !!request.forceReencode,
      !!request.normalizeAudio,
      !!request.tracklistAuto,
      undefined, // subtitle removed
      undefined, // options removed
      request.useGpuEncoding || 'auto',
      !!request.deleteSourceFiles,
      !!request.unifyFormat,
      request.targetResolution,
      request.targetFps,
      'software'
    )
  } catch (error: any) {
    console.error('[FinalExport] Lỗi export video hoàn chỉnh:', error)
    emitter.error({
      requestId,
      error: error?.message || 'Xuất video thất bại.',
      message: error?.message,
    })
    // NOTE: Không throw lại — emitter.error() đã báo lỗi cho UI.
    // Nếu throw thì caller (IPC handler) sẽ catch và gửi thêm 1 error event → duplicate trên UI.
  }
}

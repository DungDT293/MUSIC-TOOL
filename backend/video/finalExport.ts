import { spawn } from 'child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getFfmpegPaths } from '../ffmpeg/config'
import { probeFile } from '../ffmpeg/probe'
import { transcribeAudio } from '../audio/whisperTranscribe'
import { generateSubtitleFile, parseWhisperResult } from '../audio/subtitleGenerator'
import { validateInputFiles, type ValidatedInputFile } from './videoUtils'
import { getVideoFileInfo } from './videoInfo'
import { videoJobManager } from './videoJobManager'
import { verifyOutputVideo } from './outputVerification'
import { runPlaybackTest } from './playbackTest'
import { getDiskSpace, formatBytes } from '../utils/diskSpace'
import { buildVideoEncoderArgs, buildVideoEncoderArgsWithChoice, getGpuInfo } from '../utils/gpuDetection'
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

interface PreparedAudioFile {
  preparedPath: string
  audioCodec: string | null
}

interface PreparedVideoClips {
  clips: ValidatedInputFile[]
}

interface BuiltVideoPlaylist {
  clips: ValidatedInputFile[]
  totalDurationSec: number
  usedFiles: number
}

interface FinalExportEmitter {
  progress: (payload: FinalExportProgressPayload) => void
  done: (payload: FinalExportDonePayload) => void
  error: (payload: FinalExportErrorPayload) => void
}

// PHASE 4: Planning interfaces
export interface AudioSourceItem {
  path: string
  durationSec: number
}

export interface VideoClipItem {
  path: string
  durationSec: number
  sizeBytes?: number | null
}

export interface ExportJob {
  jobIndex: number
  audio: AudioSourceItem
  outputPath: string
  outputFileName: string
  customOutputName?: string // Tên tùy chỉnh từ outputNames array
  tracklistText?: string // Tracklist text nếu có
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
  return filePath.replace(/'/g, `'\\''`)
}

function sanitizeFilename(name: string): string {
  // Loại bỏ các ký tự không hợp lệ trong tên file Windows
  // Đặc biệt: chỉ thay "|" thành " _ " (có khoảng trắng xung quanh để format đẹp)
  // Format mong muốn: "1 Tomorrowland 2025 _ Tiësto, ..."
  
  // Bước 1: Thay "|" thành " _ " (có khoảng trắng xung quanh)
  let result = name.replace(/\|/g, ' _ ')
  
  // Bước 2: Thay các ký tự không hợp lệ khác bằng "_" (trừ dấu cách)
  result = result.replace(/[<>:"/\\?*\x00-\x1F]/g, '_')
  
  // Bước 3: Gộp nhiều khoảng trắng liên tiếp thành 1 khoảng trắng
  result = result.replace(/\s+/g, ' ')
  
  // Bước 4: Gộp nhiều "_" liên tiếp thành 1 "_"
  // Nhưng cần cẩn thận để không làm mất " _ " đã tạo từ "|"
  // Cách đơn giản: chỉ gộp các "_" không có khoảng trắng xung quanh
  result = result.replace(/([^ ])_+([^ ])/g, '$1_$2') // Gộp _ giữa 2 ký tự không phải khoảng trắng
  result = result.replace(/([^ ])_+$/g, '$1_') // Gộp _ ở cuối
  result = result.replace(/^_+([^ ])/g, '_$1') // Gộp _ ở đầu
  
  // Bước 5: Loại bỏ _ và khoảng trắng ở đầu và cuối
  result = result.replace(/^[\s_]+|[\s_]+$/g, '')
  
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

async function ensureTempDir(baseName: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), baseName))
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

async function prepareAudioForOutput(
  audioFile: AudioFileInfo,
  pairTempDir: string,
  targetExt: string
): Promise<PreparedAudioFile> {
  const normalizedExt = targetExt.toLowerCase()
  const codec = audioFile.codecName?.toLowerCase() ?? null
  const needsAac =
    (normalizedExt === '.mp4' || normalizedExt === '.m4v' || normalizedExt === '.mov') &&
    codec !== 'aac'

  if (!needsAac) {
    return {
      preparedPath: audioFile.path,
      audioCodec: audioFile.codecName,
    }
  }

  await fsp.mkdir(pairTempDir, { recursive: true })
  const safeName = sanitizeFilename(path.basename(audioFile.path, path.extname(audioFile.path)))
  const tempPath = path.join(pairTempDir, `${safeName || 'audio'}-${randomUUID()}.m4a`)
  const { ffmpeg } = getFfmpegPaths()

    await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      audioFile.path,
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ac',
      '2',
      '-y',
      tempPath,
    ])

    child.on('error', reject)
    // Bug #16 fix: drain stdout/stderr to prevent pipe buffer full → process hang
    child.stdout?.resume()
    child.stderr?.resume()
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg lỗi khi chuẩn hoá audio ${audioFile.path} (code ${code}).`))
    })
  })

  return {
    preparedPath: tempPath,
    audioCodec: 'aac',
  }
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

  // Medium: Validate audio/video count match khi dùng nguồn file
  if (
    audioSource.type === 'files' &&
    videoSource.type === 'files' &&
    videoClips.length < audioItems.length
  ) {
    throw new Error(
      `Số video (${videoClips.length}) ít hơn số audio (${audioItems.length}). Hãy bổ sung video hoặc bật shuffle để reuse.`
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
    }
  })

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
 * - Mỗi job dùng TOÀN BỘ videoClips pool (không chia subset)
 * - Audio codec check: AAC/MP3 → copy, WAV/PCM → encode aac
 * - Progress: percentJob + percentTotal
 * - KHÔNG concat audio lại
 */
export interface ExecuteFinalExportOptions {
  onlyStep1?: boolean // Chỉ chạy Step 1 (concat video), không chạy Whisper và Step 2
  onlyStep2?: boolean // Chỉ chạy Step 2 (burn subtitle), bỏ qua Step 1 và Whisper (cần tempVideoPath và subtitleFile)
  onlyWhisper?: boolean // Chỉ chạy Whisper và tạo subtitle file, bỏ qua Step 1 và Step 2 (cần tempVideoPath từ Phase 1)
  tempVideoPaths?: Map<number, string> // Map jobIndex -> tempVideoPath (dùng khi onlyStep2=true hoặc onlyWhisper=true)
  subtitleFiles?: Map<number, string> // Map jobIndex -> subtitleFile (dùng khi onlyStep2=true)
}

export async function executeFinalExport(
  plan: ExportPlan,
  requestId: string,
  emitter: FinalExportEmitter,
  shuffle: boolean = false,
  forceReencode: boolean = false,
  normalizeAudio: boolean = false,
  tracklistAuto: boolean = false,
  subtitle?: FinalExportRequestPayload['subtitle'],
  options?: ExecuteFinalExportOptions,
  useGpuEncoding?: 'gpu' | 'cpu' | 'auto', // GPU encoding choice (default: 'auto' for backward compatibility)
  deleteSourceFiles: boolean = false // Xóa file audio/video sau khi xuất xong
): Promise<{ tempVideoPaths: Map<number, string>, subtitleFiles: Map<number, string> } | void> {
  console.log('[FinalExport] executeFinalExport called with subtitle:', subtitle ? JSON.stringify({
    enabled: subtitle.enabled,
    useWhisper: subtitle.useWhisper,
    autoLyrics: subtitle.autoLyrics,
    subtitleStyle: subtitle.subtitleStyle,
    hasText: !!subtitle.text,
  }) : 'undefined')
  
  // Extract options
  const onlyStep1 = options?.onlyStep1 ?? false
  const onlyStep2 = options?.onlyStep2 ?? false
  const onlyWhisper = options?.onlyWhisper ?? false
  const tempVideoPathsMap = options?.tempVideoPaths ?? new Map<number, string>()
  const subtitleFilesMap = options?.subtitleFiles ?? new Map<number, string>()
  
  console.log('[FinalExport] ==========================================')
  console.log('[FinalExport] Options:', { onlyStep1, onlyStep2, onlyWhisper, hasTempVideoPaths: tempVideoPathsMap.size > 0, hasSubtitleFiles: subtitleFilesMap.size > 0 })
  console.log('[FinalExport] ==========================================')
  
  const tempDir = await ensureTempDir(`final-export-${requestId}-`)
  
  try {
    // Generate tracklist cho từng job nếu tracklistAuto = true
    if (tracklistAuto) {
      for (const job of plan.jobs) {
        const tracklistText = generateTracklistFromHistory(job.audio.path)
        if (tracklistText) {
          job.tracklistText = tracklistText
          console.log(`[FinalExport] Generated tracklist for job ${job.jobIndex + 1}: ${job.outputFileName}`)
        }
      }
    }
    
    // Map videoClips sang ClipItem
    const baseClips: ClipItem[] = plan.videoClips.map((v) => ({
      path: v.path,
      durationSec: v.durationSec,
      id: v.path,
      sizeBytes: v.sizeBytes ?? undefined,
    }))
    const priorityClips: ClipItem[] = (plan.priorityVideoClips ?? []).map((v) => ({
      path: v.path,
      durationSec: v.durationSec,
      id: v.path,
      sizeBytes: v.sizeBytes ?? undefined,
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
      console.log('[FinalExport] Số lượng video >= audio, sẽ map 1-1 theo thứ tự (không shuffle).')
    }

    // Chạy tuần tự từng job một để tránh bug progress và đảm bảo hoàn thành đúng
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
      let videoPlaylist: ClipItem[]

      if (priorityClips.length > 0) {
        // Có video ưu tiên: luôn cho xuất hiện đầu video mỗi job (bất kể canMapOneToOne)
        // Priority clips được xử lý GIỐNG HỆT như logic ghép video bình thường (buildPlaylistToFillDuration)
        // NHƯNG priority clips LUÔN ở đầu video
        
        // Tạo seed cho priority playlist (để shuffle nhất quán)
        const prioritySeed = Date.now() + job.jobIndex * 1000000 + Math.random() * 1000
        
        // Priority clips: Dùng buildPlaylistToFillDuration GIỐNG HỆT logic ghép bình thường
        const priorityPlaylist = buildPlaylistToFillDuration(priorityClips, targetDurationSec, shuffle, prioritySeed)
        const priorityDuration = priorityPlaylist.reduce((sum, c) => sum + c.durationSec, 0)
        const remainingTarget = Math.max(0, targetDurationSec - priorityDuration)

        let loopPlaylist: ClipItem[] = []
        if (remainingTarget > 0) {
          // Nếu map 1-1 và có đủ video, dùng video tương ứng trước, sau đó mới loop
          // QUAN TRỌNG: Chỉ dùng non-priority clips để tránh duplicate priority clips
          if (canMapOneToOne && nonPriorityClips.length > 0) {
            // Tìm video tương ứng từ nonPriorityClips (không phải từ baseClips để tránh priority video)
            const nonPriorityIndex = Math.min(job.jobIndex, nonPriorityClips.length - 1)
            const mappedClip = nonPriorityClips[nonPriorityIndex]
            if (mappedClip && mappedClip.durationSec <= remainingTarget) {
              // Dùng video tương ứng nếu duration phù hợp
              loopPlaylist = [mappedClip]
              const stillRemaining = remainingTarget - mappedClip.durationSec
              if (stillRemaining > 0 && nonPriorityClips.length > 1) {
                // Dùng các clip non-priority còn lại (trừ mappedClip đã dùng)
                const remainingNonPriority = nonPriorityClips.filter(c => c.path !== mappedClip.path)
                const loopSeed = Date.now() + job.jobIndex * 2000000 + Math.random() * 1000
                const additional = buildPlaylistToFillDuration(remainingNonPriority, stillRemaining, shuffle, loopSeed)
                loopPlaylist.push(...additional)
              }
            } else {
              // Video tương ứng quá dài hoặc không phù hợp → loop từ nonPriorityClips
              const loopSeed = Date.now() + job.jobIndex * 2000000 + Math.random() * 1000
              loopPlaylist = buildPlaylistToFillDuration(nonPriorityClips, remainingTarget, shuffle, loopSeed)
            }
          } else {
            // Không map 1-1 hoặc không có nonPriorityClips → loop từ nonPriorityClips (hoặc baseClips nếu không có priority)
            const loopSource = nonPriorityClips.length > 0 ? nonPriorityClips : baseClips
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
        let sourceClipsForJob = baseClips
        let shouldShuffle = shuffle
        if (canMapOneToOne) {
          // Dùng job.jobIndex để đảm bảo mapping 1-1 đúng, không phụ thuộc thứ tự chạy
          const mappedClip = baseClips[Math.min(job.jobIndex, baseClips.length - 1)]
          if (mappedClip) {
            sourceClipsForJob = [mappedClip]
            shouldShuffle = false
            console.log(
              `[Job ${currentJobIndex}/${plan.totalJobs}] Map 1-1 với clip: ${path.basename(mappedClip.path)}`
            )
          }
        }
        videoPlaylist = buildPlaylistToFillDuration(sourceClipsForJob, targetDurationSec, shouldShuffle)
      }
      
      console.log(
        `[Job ${currentJobIndex}] Video playlist: ${videoPlaylist.length} clips (từ ${baseClips.length} clips gốc, priority=${priorityClips.length})`
      )
      
      // 2. Create concat list file
      // Dùng job.jobIndex để đảm bảo temp file name unique và consistent
      const videoListFile = path.join(tempDir, `video_${job.jobIndex}.txt`)
      const listContent = videoPlaylist
        .map(c => `file '${escapePathForFfmpegList(c.path)}'`)
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
      
      // 3. Probe audio codec
      const audioCodec = await probeAudioCodec(job.audio.path)
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
      // Prepare subtitle text with metadata replacement ({title}, {artist}, {filename}) và auto lyrics/Whisper
      let subtitleToUse = subtitle
      let tempVideoPath: string | null = null
      
      // CRITICAL: If onlyWhisper=true, skip Step 1 (use tempVideoPath from Phase 1)
      if (onlyWhisper) {
        tempVideoPath = tempVideoPathsMap.get(job.jobIndex) || null
        if (!tempVideoPath || !fs.existsSync(tempVideoPath)) {
          throw new Error(`Phase 2: Missing tempVideoPath for job ${currentJobIndex}`)
        }
        console.log(`[FinalExport] Phase 2: Using tempVideoPath from Phase 1 for job ${currentJobIndex}: ${tempVideoPath}`)
      }
      
      // CRITICAL: If onlyStep2=true, use tempVideoPath and subtitleFile from options
      if (onlyStep2) {
        tempVideoPath = tempVideoPathsMap.get(job.jobIndex) || null
        const subtitleFile = subtitleFilesMap.get(job.jobIndex)
        if (subtitleFile && subtitle) {
          subtitleToUse = { ...subtitle, text: '', subtitleFile }
          console.log(`[FinalExport] Phase 3: Using tempVideoPath and subtitleFile for job ${currentJobIndex}`)
        } else {
          throw new Error(`Phase 3: Missing tempVideoPath or subtitleFile for job ${currentJobIndex}`)
        }
      }
      
      // CRITICAL: If subtitle enabled and forceReencode=false, run Step 1 (concat video) BEFORE Whisper
      // This allows video to be concatenated while Whisper is running, avoiding the "stuck at 0%" issue
      // BUT: If onlyStep1=true, skip Whisper and Step 2
      // If onlyStep2=true, skip Step 1 and Whisper
      // If onlyWhisper=true, skip Step 1 (already done) and Step 2
      const willUseTwoStep = subtitle?.enabled && !forceReencode && !onlyStep2 && !onlyWhisper && !onlyStep1
      
      // CRITICAL: If onlyStep1=true, we ONLY run Step 1 (concat), skip everything else
      console.log(`[FinalExport] DEBUG: Checking onlyStep1=${onlyStep1} for job ${currentJobIndex}`)
      if (onlyStep1) {
        // Step 1: Concat video + audio (copy-stream, no subtitle) - ONLY THIS STEP
        console.log(`[FinalExport] ✅ Phase 1 ONLY: Concat video for job ${currentJobIndex}/${plan.totalJobs}`)
        // Use requestId + jobIndex in temp filename to avoid conflicts between days/jobs
        const tempFileName = `${path.basename(job.outputPath, '.mp4')}-${requestId.substring(0, 8)}-${job.jobIndex}.temp.mp4`
        tempVideoPath = path.join(path.dirname(job.outputPath), tempFileName)
        
        emitter.progress({
          requestId,
          stage: 'export',
          percent: (jobIndex / plan.totalJobs) * 100,
          timeSec: 0,
          totalDurationSec: job.audio.durationSec,
          currentIndex: currentJobIndex,
          totalOutputs: plan.totalJobs,
          currentAudioPath: job.audio.path,
          currentOutputFilename: job.outputFileName,
          status: `[Phase 1] Đang ghép video (copy-stream)... (${currentJobIndex}/${plan.totalJobs})`,
        })
        
        // Run Step 1: Concat video (copy-stream, no subtitle)
        await new Promise<void>((resolve, reject) => {
          const shouldNormalizeAudio = normalizeAudio
          const shouldEncodeAudio = forceReencode || needAudioEncode || shouldNormalizeAudio
          const audioCodecArgs: string[] = shouldEncodeAudio
            ? ['-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2']
            : ['-c:a', 'copy']
          const audioFilterArgs: string[] = shouldNormalizeAudio
            ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']
            : []
          
          const ffmpegPath = getFfmpegExecutable()
          const args: string[] = [
            '-hide_banner',
            '-loglevel', 'error',
            '-stats',
            '-f', 'concat',
            '-safe', '0',
            '-i', videoListFile,
            '-i', job.audio.path,
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-c:v', 'copy', // Copy video stream (fast, no decode errors)
            ...audioFilterArgs,
            ...audioCodecArgs,
            '-avoid_negative_ts', 'make_zero',
            '-t', job.audio.durationSec.toFixed(3),
            '-y', tempVideoPath!,
          ]
          
          const child = spawn(ffmpegPath, args, { windowsHide: true })
          videoJobManager.registerJob(requestId, child)
          
          let lastEmit = 0
          const stderrLines: string[] = []
          
          child.stderr?.on('data', (chunk: Buffer) => {
            if (videoJobManager.isCancelled(requestId)) {
              if (!child.killed) {
                child.kill('SIGTERM')
                setTimeout(() => {
                  if (!child.killed) child.kill('SIGKILL')
                }, 2000)
              }
              return
            }
            
            const text = chunk.toString('utf-8')
            stderrLines.push(...text.split(/\r?\n/).filter(Boolean))
            if (stderrLines.length > 80) {
              stderrLines.splice(0, stderrLines.length - 80)
            }
            const timeSec = parseTimeFromChunk(text)
            if (timeSec !== null && job.audio.durationSec > 0) {
              const percent = Math.min(100, (timeSec / job.audio.durationSec) * 100) // Phase 1 = 0-100% of this phase
              const now = Date.now()
              if (now - lastEmit > 100) {
                lastEmit = now
                emitter.progress({
                  requestId,
                  stage: 'export',
                  percent: (jobIndex / plan.totalJobs) * 100 + percent / plan.totalJobs,
                  timeSec,
                  totalDurationSec: job.audio.durationSec,
                  currentIndex: currentJobIndex,
                  totalOutputs: plan.totalJobs,
                  currentAudioPath: job.audio.path,
                  currentOutputFilename: job.outputFileName,
                  status: `[Phase 1] Đang ghép video... (${currentJobIndex}/${plan.totalJobs})`,
                })
              }
            }
          })
          
          child.on('error', (error) => {
            reject(new Error(`FFmpeg Phase 1 (concat) error: ${error.message}`))
          })
          
          child.on('close', async (code) => {
            if (code === 0) {
              console.log('[FinalExport] ✅ Phase 1 completed: Video concatenated')
              
              // Store tempVideoPath for Phase 3
              if (tempVideoPath) {
                resultTempVideoPaths.set(job.jobIndex, tempVideoPath)
                console.log(`[FinalExport] Phase 1: Stored tempVideoPath for job ${currentJobIndex}: ${tempVideoPath}`)
              }
              
              resolve()
            } else {
              const tail = stderrLines.slice(-10).join('\n')
              reject(new Error(`FFmpeg Phase 1 (concat) failed với mã ${code}. stderr:\n${tail}`))
            }
          })
        })
        
        // CRITICAL: Skip Whisper and Step 2 completely when onlyStep1=true
        console.log(`[FinalExport] ✅ Phase 1: Completed for job ${currentJobIndex}, skipping Whisper and Step 2`)
        console.log(`[FinalExport] ✅ Phase 1: About to continue to next job`)
        // Store tempVideoPath before continuing
        if (tempVideoPath) {
          resultTempVideoPaths.set(job.jobIndex, tempVideoPath)
          console.log(`[FinalExport] Phase 1: Stored tempVideoPath for job ${currentJobIndex}: ${tempVideoPath}`)
        }
        return // Return from processJob - DO NOT run Whisper or Step 2
      }
      
      if (willUseTwoStep && !onlyStep2 && !onlyWhisper) {
        // Step 1: Concat video + audio (copy-stream, no subtitle) - BEFORE Whisper
        console.log(`[FinalExport] 🔄 Step 1/2 (PRE-WHISPER): Concat video for job ${currentJobIndex}/${plan.totalJobs}`)
        // Use requestId + jobIndex in temp filename to avoid conflicts between days/jobs
        const tempFileName = `${path.basename(job.outputPath, '.mp4')}-${requestId.substring(0, 8)}-${job.jobIndex}.temp.mp4`
        tempVideoPath = path.join(path.dirname(job.outputPath), tempFileName)
        
        emitter.progress({
          requestId,
          stage: 'export',
          percent: (jobIndex / plan.totalJobs) * 100,
          timeSec: 0,
          totalDurationSec: job.audio.durationSec,
          currentIndex: currentJobIndex,
          totalOutputs: plan.totalJobs,
          currentAudioPath: job.audio.path,
          currentOutputFilename: job.outputFileName,
          status: `[Bước 1/2] Đang ghép video (copy-stream, nhanh)... (${currentJobIndex}/${plan.totalJobs})`,
        })
        
        // Run Step 1: Concat video (copy-stream, no subtitle)
        await new Promise<void>((resolve, reject) => {
          const shouldNormalizeAudio = normalizeAudio
          const shouldEncodeAudio = forceReencode || needAudioEncode || shouldNormalizeAudio
          const audioCodecArgs: string[] = shouldEncodeAudio
            ? ['-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2']
            : ['-c:a', 'copy']
          const audioFilterArgs: string[] = shouldNormalizeAudio
            ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']
            : []
          
          const ffmpegPath = getFfmpegExecutable()
          const args: string[] = [
            '-hide_banner',
            '-loglevel', 'error',
            '-stats',
            '-f', 'concat',
            '-safe', '0',
            '-i', videoListFile,
            '-i', job.audio.path,
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-c:v', 'copy', // Copy video stream (fast, no decode errors)
            ...audioFilterArgs,
            ...audioCodecArgs,
            '-avoid_negative_ts', 'make_zero',
            '-t', job.audio.durationSec.toFixed(3),
            '-y', tempVideoPath!,
          ]
          
          const child = spawn(ffmpegPath, args, { windowsHide: true })
          videoJobManager.registerJob(requestId, child)
          
          let lastEmit = 0
          const stderrLines: string[] = []
          
          child.stderr?.on('data', (chunk: Buffer) => {
            if (videoJobManager.isCancelled(requestId)) {
              if (!child.killed) {
                child.kill('SIGTERM')
                setTimeout(() => {
                  if (!child.killed) child.kill('SIGKILL')
                }, 2000)
              }
              return
            }
            
            const text = chunk.toString('utf-8')
            stderrLines.push(...text.split(/\r?\n/).filter(Boolean))
            if (stderrLines.length > 80) {
              stderrLines.splice(0, stderrLines.length - 80)
            }
            const timeSec = parseTimeFromChunk(text)
            if (timeSec !== null && job.audio.durationSec > 0) {
              const percent = Math.min(25, (timeSec / job.audio.durationSec) * 25) // Step 1 = 0-25% of total job
              const now = Date.now()
              if (now - lastEmit > 100) {
                lastEmit = now
                emitter.progress({
                  requestId,
                  stage: 'export',
                  percent: (jobIndex / plan.totalJobs) * 100 + percent / plan.totalJobs,
                  timeSec,
                  totalDurationSec: job.audio.durationSec,
                  currentIndex: currentJobIndex,
                  totalOutputs: plan.totalJobs,
                  currentAudioPath: job.audio.path,
                  currentOutputFilename: job.outputFileName,
                  status: `[Bước 1/2] Đang ghép video... (${currentJobIndex}/${plan.totalJobs})`,
                })
              }
            }
          })
          
          child.on('error', (error) => {
            reject(new Error(`FFmpeg step 1 (concat) error: ${error.message}`))
          })
          
          child.on('close', async (code) => {
            if (code === 0) {
              console.log('[FinalExport] ✅ Step 1 completed: Video concatenated (pre-Whisper)')
              
              // Store tempVideoPath for Phase 3
              if (onlyStep1 && tempVideoPath) {
                resultTempVideoPaths.set(job.jobIndex, tempVideoPath)
                console.log(`[FinalExport] Phase 1: Stored tempVideoPath for job ${currentJobIndex}: ${tempVideoPath}`)
              }
              
              resolve()
            } else {
              const tail = stderrLines.slice(-10).join('\n')
              reject(new Error(`FFmpeg step 1 (concat) failed với mã ${code}. stderr:\n${tail}`))
            }
          })
        })
        
        // Store tempVideoPath for Phase 3
        if (onlyStep1 && tempVideoPath) {
          resultTempVideoPaths.set(job.jobIndex, tempVideoPath)
          console.log(`[FinalExport] Phase 1: Stored tempVideoPath for job ${currentJobIndex}: ${tempVideoPath}`)
        }
      }
      
      // CRITICAL: Skip Whisper and Step 2 if onlyStep1=true (already handled above, but double-check)
      if (onlyStep1) {
        console.log(`[FinalExport] Phase 1: Already completed Step 1, skipping Whisper and Step 2 for job ${currentJobIndex}`)
        return // Skip rest of processJob - DO NOT run Whisper or Step 2
      }
      
      // CRITICAL: Only run Whisper if NOT onlyStep1 and NOT onlyStep2
      if (subtitle?.enabled && !onlyStep2 && !onlyWhisper && !onlyStep1) {
          let subtitleText = subtitle.text || ''
          
          // Try to read metadata from audio file
          let title = ''
          let artist = ''
          let album = ''
          let lyrics = ''
          
          try {
            const audioMetadata = await probeFile(job.audio.path)
            const tags = audioMetadata.format.tags || {}
            
            title = tags.title || ''
            artist = tags.artist || tags.album_artist || ''
            album = tags.album || ''
            lyrics = tags.lyrics || '' // Lyrics from ID3 tags (USLT, LYRICS)
          } catch (error) {
            console.warn(`[FinalExport] Failed to read metadata from ${job.audio.path}:`, error)
          }
        
        // Check if we need timestamps for advanced subtitle styles
        // IMPORTANT: Even for 'simple' style, we need timestamps to show subtitles changing over time
        // Only skip timestamps if user explicitly wants static text (which we don't support for timed subtitles)
        const needsTimestamps = subtitle.subtitleStyle === 'karaoke' || 
                               subtitle.subtitleStyle === 'word-by-word' || 
                               subtitle.subtitleStyle === 'dynamic' ||
                               subtitle.subtitleStyle === 'simple' // Simple style also needs timestamps for timed display
        
        // IMPORTANT: Always use Whisper to get timestamps for subtitle file
        // Even if lyrics exist in metadata, we need Whisper to create timed subtitle file
        // Only skip Whisper if user explicitly doesn't want it AND we don't need timestamps (rare case)
        const shouldUseWhisper = subtitle.useWhisper || needsTimestamps || !lyrics
        
        if (shouldUseWhisper) {
          // If useWhisper is enabled and no lyrics in metadata, try Whisper transcription
          console.log(`[FinalExport] 🎤 Starting Whisper transcription for job ${currentJobIndex}/${plan.totalJobs}`)
          emitter.progress({
            requestId,
            stage: 'export',
            percent: (jobIndex / plan.totalJobs) * 100,
            timeSec: 0,
            totalDurationSec: job.audio.durationSec,
            currentIndex: currentJobIndex,
            totalOutputs: plan.totalJobs,
            currentAudioPath: job.audio.path,
            currentOutputFilename: job.outputFileName,
            status: `[Whisper] Đang nhận diện lời bài hát bằng GPU (Faster-Whisper)... (${currentJobIndex}/${plan.totalJobs})`,
          })
          try {

            const whisperLanguage = subtitle.whisperLanguage || 'auto' // Default to auto-detect
            
            // ALWAYS get full result with timestamps for subtitle generation
            // Even for 'simple' style, we need timestamps to show subtitles changing over time
            // Without timestamps, subtitle will be static text (not what we want)
            console.log(`[FinalExport] 🎤 Calling transcribeAudio...`)
            const whisperResult = await transcribeAudio(
              job.audio.path, 
              whisperLanguage, 
              (progress) => {
                emitter.progress({
                  requestId,
                  stage: 'export',
                  percent: (jobIndex / plan.totalJobs) * 100,
                  timeSec: 0,
                  totalDurationSec: job.audio.durationSec,
                  currentIndex: currentJobIndex,
                  totalOutputs: plan.totalJobs,
                  currentAudioPath: job.audio.path,
                  currentOutputFilename: job.outputFileName,
                  status: `[Whisper] ${progress.message} (${currentJobIndex}/${plan.totalJobs})`,
                })
              },
              true // ALWAYS request full result with timestamps for subtitle generation
            )

            // Always try to create subtitle file from Whisper result (we always request timestamps now)
            console.log(`[FinalExport] 🔍 Whisper result type: ${typeof whisperResult}`)
            console.log(`[FinalExport] 🔍 Whisper result is object: ${typeof whisperResult === 'object' && whisperResult !== null}`)
            
            if (typeof whisperResult === 'object' && whisperResult !== null) {
              // Log Whisper result structure for debugging
              console.log(`[FinalExport] 📊 Whisper result keys:`, Object.keys(whisperResult))
              console.log(`[FinalExport] 📊 Whisper result has chunks:`, !!whisperResult.chunks)
              console.log(`[FinalExport] 📊 Whisper result has text:`, !!whisperResult.text)
              console.log(`[FinalExport] 📊 Whisper result text preview:`, whisperResult.text?.substring(0, 100) || 'N/A')
              
              if (whisperResult.chunks && Array.isArray(whisperResult.chunks)) {
                console.log(`[FinalExport] 📊 Whisper chunks count:`, whisperResult.chunks.length)
                if (whisperResult.chunks.length > 0) {
                  const firstChunk = whisperResult.chunks[0]
                  console.log(`[FinalExport] 📊 First chunk structure:`, {
                    hasText: !!firstChunk.text,
                    hasTimestamp: !!firstChunk.timestamp,
                    hasWords: !!firstChunk.words,
                    wordsCount: firstChunk.words?.length || 0,
                    text: firstChunk.text?.substring(0, 50) || 'N/A',
                  })
                  
                  // Log word-level timestamps if available
                  if (firstChunk.words && Array.isArray(firstChunk.words) && firstChunk.words.length > 0) {
                    const firstWord = firstChunk.words[0]
                    console.log(`[FinalExport] 📊 First word structure:`, {
                      word: firstWord.word || firstWord.text || 'N/A',
                      hasTimestamp: !!firstWord.timestamp,
                      hasStart: typeof firstWord.start === 'number',
                      hasEnd: typeof firstWord.end === 'number',
                      start: firstWord.start || firstWord.timestamp?.[0] || 'N/A',
                      end: firstWord.end || firstWord.timestamp?.[1] || 'N/A',
                    })
                  } else {
                    console.warn(`[FinalExport] ⚠️ First chunk has NO word-level timestamps - karaoke effects may not work properly`)
                  }
                }
              } else {
                console.warn(`[FinalExport] ⚠️ Whisper result has NO chunks - cannot create timed subtitle file`)
              }
              
              // Generate subtitle file (.srt or .ass) from Whisper result
              try {
                const subtitleFormat = subtitle.subtitleFormat || 'ass'
                // Use requestId in temp dir to isolate subtitle files per day/job
                const tempDir = path.join(os.tmpdir(), 'ffmpeg-subtitles', requestId)
                await fsp.mkdir(tempDir, { recursive: true })
                const subtitleFile = path.join(tempDir, `subtitle-${job.jobIndex}-${randomUUID()}.${subtitleFormat}`)
                
                console.log(`[FinalExport] Generating ${subtitleFormat.toUpperCase()} subtitle file: ${subtitleFile}`)
                
                await generateSubtitleFile(whisperResult, subtitleFile, subtitleFormat, {
                  fontSize: subtitle.fontSize || 48,
                  fontColor: subtitle.fontColor?.replace('#', '') || 'FFFFFF',
                  highlightColor: subtitle.highlightColor?.replace('#', '') || 'FFFF00',
                  position: subtitle.position || 'bottom',
                  style: subtitle.subtitleStyle || 'karaoke', // Use subtitle style from options
                })

                // Verify file was created
                if (!fs.existsSync(subtitleFile)) {
                  throw new Error(`Subtitle file was not created at: ${subtitleFile}`)
                }

                const fileSize = fs.statSync(subtitleFile).size
                if (fileSize === 0) {
                  throw new Error(`Subtitle file is empty: ${subtitleFile}`)
                }

                // Store subtitle file path in subtitle object
                // Set text to empty since we're using file-based subtitle
                subtitleToUse = { 
                  ...subtitle, 
                  text: '', // Empty text when using subtitle file
                  subtitleFile, // Path to generated subtitle file
                }
                
                // Store subtitleFile for Phase 3
                resultSubtitleFiles.set(job.jobIndex, subtitleFile)
                console.log(`[FinalExport] Phase 2: Stored subtitleFile for job ${currentJobIndex}: ${subtitleFile}`)
                
                console.log(`[FinalExport] ✅ Generated ${subtitleFormat.toUpperCase()} subtitle file: ${subtitleFile}`)
                console.log(`[FinalExport] ✅ Subtitle file size: ${fileSize} bytes`)
                
                // Log first few lines of subtitle file for debugging
                try {
                  const fileContent = await fsp.readFile(subtitleFile, 'utf-8')
                  const lines = fileContent.split('\n').slice(0, 15)
                  console.log(`[FinalExport] Subtitle file preview (first 15 lines):\n${lines.join('\n')}`)
                } catch (e) {
                  console.warn('[FinalExport] Could not read subtitle file for preview:', e)
                }
              } catch (subtitleError) {
                console.error(`[FinalExport] ❌ Failed to generate subtitle file:`, subtitleError)
                console.error(`[FinalExport] Error details:`, subtitleError instanceof Error ? subtitleError.stack : subtitleError)
                
                // If we need timestamps, we cannot fallback to static text
                // Throw error to prevent using static text subtitle
                if (needsTimestamps || subtitle.useWhisper) {
                  const errorMsg = subtitleError instanceof Error ? subtitleError.message : String(subtitleError)
                  throw new Error(`Failed to generate subtitle file: ${errorMsg}. Cannot create timed subtitle.`)
                }
                
                // Only fallback to simple text if we don't need timestamps (rare case)
                console.warn(`[FinalExport] ⚠️ Falling back to static text (not timed)`)
                subtitleText = whisperResult?.text || ''
                subtitleToUse = { ...subtitle, text: subtitleText }
                console.log(`[FinalExport] Fallback to simple text subtitle: ${subtitleText.substring(0, 50)}...`)
              }
            } else {
              // Even for simple style, we need timestamps to show subtitles changing over time
              // If Whisper didn't return timestamps, try to create a subtitle file anyway
              const whisperText = typeof whisperResult === 'string' ? whisperResult : whisperResult?.text || ''
              
              // If we have an object result but no chunks, try to parse it differently
              if (typeof whisperResult === 'object' && whisperResult !== null && !whisperResult.chunks) {
                // Try to create subtitle file from the result anyway
                try {
                  const subtitleFormat = subtitle.subtitleFormat || 'ass'
                  // Use requestId in temp dir to isolate subtitle files per day/job
                  const tempDir = path.join(os.tmpdir(), 'ffmpeg-subtitles', requestId)
                  await fsp.mkdir(tempDir, { recursive: true })
                  const subtitleFile = path.join(tempDir, `subtitle-${job.jobIndex}-${randomUUID()}.${subtitleFormat}`)
                  
                  // Try to parse the result - maybe it has a different structure
                  const { parseWhisperResult } = await import('../audio/subtitleGenerator')
                  const segments = parseWhisperResult(whisperResult)
                  
                  if (segments.length > 0) {
                    const { generateSubtitleFile } = await import('../audio/subtitleGenerator')
                    await generateSubtitleFile(whisperResult, subtitleFile, subtitleFormat, {
                      fontSize: subtitle.fontSize || 48,
                      fontColor: subtitle.fontColor?.replace('#', '') || 'FFFFFF',
                      highlightColor: subtitle.highlightColor?.replace('#', '') || 'FFFF00',
                      position: subtitle.position || 'bottom',
                      style: subtitle.subtitleStyle || 'simple',
                    })
                    
                    if (fs.existsSync(subtitleFile)) {
                      subtitleToUse = { 
                        ...subtitle, 
                        text: '', 
                        subtitleFile,
                      }
                      // Store subtitleFile for Phase 3
                      resultSubtitleFiles.set(job.jobIndex, subtitleFile)
                      console.log(`[FinalExport] Phase 2: Stored subtitleFile for job ${currentJobIndex}: ${subtitleFile}`)
                      console.log(`[FinalExport] Created subtitle file from Whisper result: ${subtitleFile}`)
                    } else {
                      throw new Error('Subtitle file was not created')
                    }
                  } else {
                    throw new Error('No segments parsed from Whisper result')
                  }
                } catch (parseError) {
                  console.error(`[FinalExport] ❌ Failed to create subtitle file from Whisper result:`, parseError)
                  // If we need timestamps, we cannot fallback to static text
                  if (needsTimestamps || subtitle.useWhisper) {
                    const errorMsg = parseError instanceof Error ? parseError.message : String(parseError)
                    throw new Error(`Failed to parse Whisper result and create subtitle file: ${errorMsg}. Cannot create timed subtitle.`)
                  }
                  // Only fallback if we don't need timestamps
                  console.warn(`[FinalExport] ⚠️ Falling back to static text (not timed)`)
                  subtitleText = whisperText
                  subtitleToUse = { ...subtitle, text: subtitleText }
                  console.log(`[FinalExport] Fallback to simple text subtitle: ${subtitleText.substring(0, 50)}...`)
                }
              } else {
                // No object result - just text (this should not happen when returnFullResult=true)
                console.error(`[FinalExport] ❌ ERROR: Whisper returned text instead of object result!`)
                console.error(`[FinalExport] This should not happen when returnFullResult=true`)
                console.error(`[FinalExport] Whisper result type: ${typeof whisperResult}`)
                console.error(`[FinalExport] Whisper result (first 200 chars):`, typeof whisperResult === 'string' ? whisperResult.substring(0, 200) : JSON.stringify(whisperResult).substring(0, 200))
                
                // Try to throw error instead of fallback to static text
                throw new Error('Whisper did not return object result with timestamps - cannot create timed subtitle file. Expected object with chunks, got: ' + typeof whisperResult)
              }
            }

            // Log subtitleToUse for debugging
            if (subtitleToUse) {
              console.log(`[FinalExport] 📝 subtitleToUse after Whisper:`, {
                enabled: subtitleToUse.enabled,
                text: subtitleToUse.text?.substring(0, 50) || '(empty)',
                subtitleFile: (subtitleToUse as any).subtitleFile || '(none)',
                subtitleStyle: subtitleToUse.subtitleStyle,
                subtitleFormat: subtitleToUse.subtitleFormat,
              })
            }
            
            // Verify subtitle file exists if it was set
            if (subtitleToUse && (subtitleToUse as any).subtitleFile) {
              const filePath = (subtitleToUse as any).subtitleFile
              const exists = fs.existsSync(filePath)
              console.log(`[FinalExport] 🔍 Verifying subtitle file: ${filePath}`)
              console.log(`[FinalExport] ${exists ? '✅' : '❌'} Subtitle file exists: ${exists}`)
              if (exists) {
                const stats = fs.statSync(filePath)
                console.log(`[FinalExport] 📊 Subtitle file size: ${stats.size} bytes`)
              }
            }
            
            console.log(`[FinalExport] ✅ Whisper processing completed for job ${currentJobIndex}/${plan.totalJobs}`)
          } catch (error) {
            console.error(`[FinalExport] ❌ Whisper transcription failed for ${job.audio.path}:`, error)
            console.error(`[FinalExport] Error details:`, error instanceof Error ? error.stack : error)
            
            // CRITICAL: Cleanup tempVideoPath if Whisper fails (Step 1 already done but Step 2 won't run)
            if (tempVideoPath && fs.existsSync(tempVideoPath)) {
              try {
                await fsp.unlink(tempVideoPath)
                console.log(`[FinalExport] ✅ Cleaned up temp video file after Whisper error: ${tempVideoPath}`)
              } catch (cleanupError) {
                console.warn(`[FinalExport] ⚠️ Failed to cleanup temp video file after Whisper error:`, cleanupError)
              }
            }
            
            // If Whisper fails and we need timestamps, we cannot create timed subtitle
            // Throw error instead of fallback to static text
            if (needsTimestamps || subtitle.useWhisper) {
              const errorMsg = error instanceof Error ? error.message : String(error)
              throw new Error(`Whisper transcription failed: ${errorMsg}. Cannot create timed subtitle file.`)
            }
            
            // Only fallback to title if we don't need timestamps (rare case) AND no subtitle file exists
            console.warn(`[FinalExport] ⚠️ Falling back to static text (not timed)`)
            if (!subtitleText.trim() && !(subtitleToUse as any)?.subtitleFile) {
              subtitleText = title || path.basename(job.audio.path, path.extname(job.audio.path))
            }
            // Only set text if no subtitle file exists
            if (!(subtitleToUse as any)?.subtitleFile) {
              subtitleToUse = { ...subtitle, text: subtitleText }
            }
          }
        } else {
          // CRITICAL: Skip text-based subtitle processing if subtitle file exists
          if ((subtitleToUse as any)?.subtitleFile) {
            console.log(`[FinalExport] ✅ Subtitle file exists, skipping text-based subtitle processing`)
          } else if (subtitle?.enabled) {
            // If subtitle text is empty, auto-use title from metadata
            if (!subtitleText.trim()) {
              if (title) {
                subtitleText = title
                // Optionally add artist if available
                if (artist && artist !== title) {
                  subtitleText = `${artist} - ${title}`
                }
              } else {
                // Fallback to filename if no metadata
                subtitleText = path.basename(job.audio.path, path.extname(job.audio.path))
              }
            } else {
              // Replace placeholders in user-provided text
              subtitleText = subtitleText.replace(/{title}/g, title)
              subtitleText = subtitleText.replace(/{artist}/g, artist)
              subtitleText = subtitleText.replace(/{album}/g, album)
              subtitleText = subtitleText.replace(/{lyrics}/g, lyrics) // Also support {lyrics} placeholder
              
              // Fallback: replace {filename} with actual filename
              if (subtitleText.includes('{filename}')) {
                const audioFileName = path.basename(job.audio.path, path.extname(job.audio.path))
                subtitleText = subtitleText.replace(/{filename}/g, audioFileName)
              }
              
              // If result is empty or only placeholders, use title or filename
              if (!subtitleText.trim() || subtitleText.trim().match(/^\{[^}]+\}$/)) {
                subtitleText = title || path.basename(job.audio.path, path.extname(job.audio.path))
              }
            }
          }
        }
        
        // CRITICAL: Only do final fallback if no subtitle file exists
        if (!(subtitleToUse as any)?.subtitleFile) {
          // If still empty after all processing, use filename as final fallback
          if (!subtitleText.trim()) {
            subtitleText = path.basename(job.audio.path, path.extname(job.audio.path))
          }
          
          subtitleToUse = { ...subtitle, text: subtitleText }
        } else {
          console.log(`[FinalExport] ✅ Subtitle file exists, skipping final text fallback`)
        }
      }

      // Skip runFinalCommand if onlyStep1 (Step 1 already done, temp file created)
      // This should not happen because we return early in processJob if onlyStep1
      if (onlyStep1) {
        console.log(`[FinalExport] Phase 1: Skipping runFinalCommand for job ${currentJobIndex} (Step 1 already done)`)
        return // Exit processJob early
      }
      
      console.log(`[FinalExport] ✅ Subtitle processing completed for job ${currentJobIndex}/${plan.totalJobs}`)
      console.log(`[FinalExport] 📋 About to call runFinalCommand for job ${currentJobIndex}/${plan.totalJobs}`)
      console.log(`[FinalExport] 📋 subtitleToUse:`, {
        enabled: subtitleToUse?.enabled,
        hasSubtitleFile: !!(subtitleToUse as any)?.subtitleFile,
        subtitleFile: (subtitleToUse as any)?.subtitleFile || '(none)',
      })
      console.log(`[FinalExport] 📋 tempVideoPath:`, tempVideoPath || '(none)')
      console.log(`[FinalExport] 📋 tempVideoPath exists:`, tempVideoPath ? fs.existsSync(tempVideoPath) : false)
      console.log(`[FinalExport] 📋 RequestId: ${requestId} (unique per day/job)`)
      console.log(`[FinalExport] 📋 willUseTwoStep was: ${willUseTwoStep}, tempVideoPath set: ${!!tempVideoPath}`)

      await runFinalCommand({
        requestId,
        totalDurationSec: job.audio.durationSec,
        videoListPath: videoListFile,
        audioPath: job.audio.path,
        outputPath: job.outputPath,
        audioCodec,
        forceReencode,
        normalizeAudio,
        subtitle: subtitleToUse,
        tempVideoPath: tempVideoPath || undefined, // Pass temp video path if Step 1 already done
        useGpuEncoding, // Pass GPU encoding choice
        emitProgress: (progressPayload) => {
          // Calculate percentJob và percentTotal
          // Vì chạy tuần tự, job đang chạy là job.jobIndex (0-based)
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

      // 5. Verify output (ffprobe + decode) + optional playback test + cleanup concat list file
      const shouldRunDeepVerify = forceReencode || needAudioEncode || normalizeAudio
      if (shouldRunDeepVerify) {
        try {
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
            status: `Đang kiểm tra file xuất ra ${currentJobIndex}/${plan.totalJobs} (ffprobe + decode)...`,
          })

          const verify = await verifyOutputVideo(job.outputPath, {
            expectedDurationSec: job.audio.durationSec,
            toleranceSec: 5,
            onLog: (msg) => console.log('[FinalExport][verify]', msg),
          })

          if (verify.durationWarning) {
            console.warn(
              `[FinalExport][verify] Duration diff > 5s cho ${job.outputFileName} (expected=${job.audio.durationSec.toFixed(
                2
              )}s, actual=${verify.durationSec.toFixed(2)}s)`
            )
          }

          if (!verify.decodeOk) {
            console.warn(
              `[FinalExport][verify] Decode test báo lỗi cho ${job.outputFileName}, file có thể lỗi trên một số player.`
            )
          }

          // Playback test chỉ khi bật re-encode (ổn định)
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
        } catch (verifyErr: any) {
          console.warn(
            `[FinalExport][verify] Không thể chạy bước kiểm tra sâu cho ${job.outputFileName} (không chặn job):`,
            verifyErr
          )
        }
      } else {
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
          status: `Bỏ qua kiểm tra sâu cho video ${currentJobIndex}/${plan.totalJobs} (copy-stream).`,
        })
        console.log(
          `[FinalExport] Skip deep verification for ${job.outputFileName} (copy-stream mode, codec=${audioCodec || 'unknown'})`
        )
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
      
      console.log(`[Job ${currentJobIndex}/${plan.totalJobs}] ✓ Completed: ${job.outputFileName}`)
    }

    // Chạy tuần tự từng job một (không chạy song song)
    for (const job of plan.jobs) {
      await processJob(job)
    }
    
    // 7. Return tempVideoPaths and subtitleFiles if onlyStep1, onlyStep2, or onlyWhisper
    if (onlyStep1 || onlyStep2 || onlyWhisper) {
      return { tempVideoPaths: resultTempVideoPaths, subtitleFiles: resultSubtitleFiles }
    }
    
    // 7. Emit done event
    const tracklistPaths: Record<number, string | undefined> = {}
    for (const job of plan.jobs) {
      if (job.tracklistText) {
        tracklistPaths[job.jobIndex] = buildTracklistPath(job.outputPath)
      }
    }
    
    emitter.done({
      requestId,
      outputs: plan.jobs.map(j => ({
        audioFile: j.audio.path,
        videoFile: j.outputPath,
        durationSec: j.audio.durationSec,
        tracklistFile: tracklistPaths[j.jobIndex],
      })),
    })
    
    // Xóa file audio và video nguồn nếu được yêu cầu
    if (deleteSourceFiles) {
      console.log('[FinalExport] Xóa file audio và video nguồn sau khi xuất xong...')
      const deletedFiles: string[] = []
      const failedFiles: string[] = []
      
      // Xóa các file audio
      for (const job of plan.jobs) {
        try {
          if (fs.existsSync(job.audio.path)) {
            fs.unlinkSync(job.audio.path)
            deletedFiles.push(job.audio.path)
            console.log(`[FinalExport] Đã xóa audio: ${path.basename(job.audio.path)}`)
          }
        } catch (err: any) {
          console.error(`[FinalExport] Không thể xóa audio ${job.audio.path}:`, err)
          failedFiles.push(job.audio.path)
        }
      }
      
      // Xóa các file video từ plan.videoClips (không xóa priority clips vì chúng có thể được dùng lại)
      const videoPathsToDelete = new Set<string>()
      for (const clip of plan.videoClips) {
        if (fs.existsSync(clip.path)) {
          videoPathsToDelete.add(clip.path)
        }
      }
      
      for (const videoPath of videoPathsToDelete) {
        try {
          if (fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath)
            deletedFiles.push(videoPath)
            console.log(`[FinalExport] Đã xóa video: ${path.basename(videoPath)}`)
          }
        } catch (err: any) {
          console.error(`[FinalExport] Không thể xóa video ${videoPath}:`, err)
          failedFiles.push(videoPath)
        }
      }
      
      if (deletedFiles.length > 0) {
        console.log(`[FinalExport] Đã xóa ${deletedFiles.length} file nguồn`)
      }
      if (failedFiles.length > 0) {
        console.warn(`[FinalExport] Không thể xóa ${failedFiles.length} file:`, failedFiles)
      }
    }
  } catch (error: any) {
    emitter.error({
      requestId,
      error: error?.message || 'Unknown error',
      message: error?.message,
    })
    throw error
  } finally {
    // Cleanup temp dir
    await cleanupTempDir(tempDir)
    
    // Also cleanup subtitle temp dir for this requestId (isolated per day/job)
    try {
      const subtitleTempDir = path.join(os.tmpdir(), 'ffmpeg-subtitles', requestId)
      if (fs.existsSync(subtitleTempDir)) {
        await fsp.rm(subtitleTempDir, { recursive: true, force: true })
        console.log(`[FinalExport] ✅ Cleaned up subtitle temp dir: ${subtitleTempDir}`)
      }
    } catch (e) {
      console.warn(`[FinalExport] ⚠️ Failed to cleanup subtitle temp dir:`, e)
    }
  }
}

function buildVideoPlaylist(
  clips: ValidatedInputFile[],
  totalDurationSec: number,
  shuffle: boolean = false,
  seed?: string
): BuiltVideoPlaylist {
  if (clips.length === 0) {
    throw new Error('Không có clip video để ghép.')
  }
  
  // Map sang ClipItem
  const clipItems: ClipItem[] = clips.map(c => ({
    path: c.path,
    durationSec: c.durationSec,
    id: c.path,
  }))
  
  // PHASE 4: Dùng buildPlaylistToFillDuration
  const playlist = buildPlaylistToFillDuration(clipItems, totalDurationSec, shuffle)
  
  // Convert back to ValidatedInputFile[]
  const picked: ValidatedInputFile[] = playlist.map(c => {
    const original = clips.find(clip => clip.path === c.path)
    if (!original) {
      throw new Error(`Clip not found: ${c.path}`)
    }
    return original
  })
  
  const totalDurationSecActual = playlist.reduce((sum, c) => sum + c.durationSec, 0)
  const usedUniqueClips = new Set(playlist.map(c => c.path)).size
  
  console.log(`[finalExport] Built playlist: target=${totalDurationSec.toFixed(2)}s, actual=${totalDurationSecActual.toFixed(2)}s, items=${playlist.length}, unique=${usedUniqueClips}/${clips.length}`)
  
  return {
    clips: picked,
    totalDurationSec: totalDurationSecActual,
    usedFiles: picked.length,
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

async function writeVideoConcatList(files: ValidatedInputFile[], filePath: string): Promise<void> {
  const content = files.map((clip) => `file '${escapePathForFfmpegList(clip.path)}'`).join('\n')
  await fsp.writeFile(filePath, content, 'utf-8')
}

function getFfmpegExecutable(): string {
  const { ffmpeg } = getFfmpegPaths()
  if (process.platform === 'win32' && ffmpeg.match(/^[A-Z]:\\.*$/) && ffmpeg.length > 240) {
    return ffmpeg.startsWith('\\\\?\\') ? ffmpeg : `\\\\?\\${ffmpeg}`
  }
  return ffmpeg
}

interface RunFinalCommandOptions {
  requestId: string
  totalDurationSec: number
  videoListPath: string
  audioPath: string
  outputPath: string
  audioCodec: string | null
  forceReencode?: boolean
  normalizeAudio?: boolean
  subtitle?: FinalExportRequestPayload['subtitle']
  emitProgress: (payload: FinalExportProgressPayload) => void
  tempVideoPath?: string // If provided, Step 1 already done, only run Step 2
  useGpuEncoding?: 'gpu' | 'cpu' | 'auto' // GPU encoding choice
}

/**
 * Helper: Burn subtitle into a video file (Step 2 of 2-step process)
 */
async function burnSubtitleIntoVideo(
  inputVideoPath: string,
  outputPath: string,
  subtitle: NonNullable<RunFinalCommandOptions['subtitle']>,
  videoFilter: string,
  requestId: string,
  totalDurationSec: number,
  emitProgress: RunFinalCommandOptions['emitProgress'],
  useGpuEncoding?: 'gpu' | 'cpu' | 'auto'
): Promise<void> {
  const ffmpegPath = getFfmpegExecutable()
  const encoderChoice = useGpuEncoding || 'auto'
  const { args: gpuCodecArgs, usedEncoder, gpuInfo } = await buildVideoEncoderArgsWithChoice(true, encoderChoice, 'fast')
  
  if (usedEncoder === 'gpu' && gpuInfo) {
    console.log(`[FinalExport] Step 2: Using ${gpuInfo.encoder.toUpperCase()} encoder (${gpuInfo.name || 'GPU'}) for subtitle burn`)
  } else {
    console.log(`[FinalExport] Step 2: Using CPU encoder (libx264)${gpuInfo && !gpuInfo.available ? ` - ${gpuInfo.reason}` : ''} for subtitle burn`)
  }
  
  return new Promise<void>((resolve, reject) => {
    const args: string[] = [
      '-hide_banner',
      '-loglevel', 'error',
      '-stats',
      '-i', inputVideoPath,
    ]
    
    // Add subtitle filter
    if (videoFilter.includes('subtitles=')) {
      args.push('-vf', videoFilter)
      args.push('-map', '0:v:0')
    } else if (videoFilter.includes('drawtext=')) {
      const filterComplex = `[0:v]${videoFilter}[v]`
      args.push('-filter_complex', filterComplex)
      args.push('-map', '[v]')
    } else {
      reject(new Error('Invalid subtitle filter'))
      return
    }
    
    args.push(
      '-map', '0:a:0', // Copy audio
      ...gpuCodecArgs, // Re-encode video with GPU
      '-c:a', 'copy', // Copy audio (already processed in step 1)
      '-avoid_negative_ts', 'make_zero',
      '-y', outputPath,
    )
    
    console.log('[FinalExport] Step 2: Running FFmpeg to burn subtitle...')
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    videoJobManager.registerJob(requestId, child)
    
    let lastEmit = 0
    const stderrLines: string[] = []
    
    child.stderr?.on('data', (chunk: Buffer) => {
      if (videoJobManager.isCancelled(requestId)) {
        if (!child.killed) {
          child.kill('SIGTERM')
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL')
          }, 2000)
        }
        return
      }
      
      const text = chunk.toString('utf-8')
      stderrLines.push(...text.split(/\r?\n/).filter(Boolean))
      if (stderrLines.length > 80) {
        stderrLines.splice(0, stderrLines.length - 80)
      }
      const timeSec = parseTimeFromChunk(text)
      if (timeSec !== null && totalDurationSec > 0) {
        const percent = 50 + Math.min(50, (timeSec / totalDurationSec) * 50) // Step 2 = 50-100%
        const now = Date.now()
        if (now - lastEmit > 100) {
          lastEmit = now
          emitProgress({
            requestId,
            stage: 'export',
            percent,
            timeSec,
            totalDurationSec,
            status: 'Đang ghi đè subtitle (bước 2/2)...',
          })
        }
      }
    })
    
    child.on('error', (error) => {
      reject(new Error(`FFmpeg step 2 (burn subtitle) error: ${error.message}`))
    })
    
    child.on('close', async (code) => {
      // CRITICAL: Always cleanup temp file, even on error
      try {
        if (fs.existsSync(inputVideoPath)) {
          await fsp.unlink(inputVideoPath)
          console.log('[FinalExport] ✅ Cleaned up temp video file after Step 2')
        }
      } catch (e) {
        console.warn('[FinalExport] ⚠️ Failed to cleanup temp video file after Step 2:', e)
      }
      
      if (code === 0) {
        console.log('[FinalExport] ✅ Step 2 completed: Subtitle burned')
        resolve()
      } else {
        const tail = stderrLines.slice(-10).join('\n')
        reject(new Error(`FFmpeg step 2 (burn subtitle) failed với mã ${code}. stderr:\n${tail}`))
      }
    })
  })
}

async function runFinalCommand(opts: RunFinalCommandOptions): Promise<void> {
  const {
    requestId,
    totalDurationSec,
    videoListPath,
    audioPath,
    outputPath,
    audioCodec,
    forceReencode = false,
    normalizeAudio = false,
    subtitle,
    emitProgress,
    tempVideoPath,
    useGpuEncoding,
  } =
    opts
  const ffmpegPath = getFfmpegExecutable()

  console.log('[FinalExport] 🔵 runFinalCommand called:', {
    hasSubtitle: !!subtitle,
    subtitleEnabled: subtitle?.enabled,
    hasSubtitleFile: !!(subtitle as any)?.subtitleFile,
    subtitleFile: (subtitle as any)?.subtitleFile,
    subtitleFileExists: (subtitle as any)?.subtitleFile ? fs.existsSync((subtitle as any).subtitleFile) : false,
    forceReencode,
    tempVideoPath,
    tempVideoPathExists: tempVideoPath ? fs.existsSync(tempVideoPath) : false,
    step1AlreadyDone: tempVideoPath && fs.existsSync(tempVideoPath),
    outputPath,
    audioPath,
  })

  await fsp.mkdir(path.dirname(outputPath), { recursive: true })

  // Pre-build video encoder args (needs to be async, so do it before Promise constructor)
  const codec = audioCodec?.toLowerCase() ?? null
  // PHASE 5: Audio codec check: AAC/MP3 → copy, WAV/PCM → encode aac
  const needAudioEncode = !codec || (codec !== 'aac' && codec !== 'mp3')

  // Check if we need to add subtitle (requires re-encoding)
  // Can be from text (drawtext) or subtitle file (.srt/.ass)
  const hasSubtitleText = subtitle?.enabled && subtitle.text && subtitle.text.trim()
  const hasSubtitleFile = subtitle?.enabled && (subtitle as any).subtitleFile && fs.existsSync((subtitle as any).subtitleFile)
  const needsSubtitle = hasSubtitleText || hasSubtitleFile
  
  console.log('[FinalExport] Subtitle check:', {
    hasSubtitleText,
    hasSubtitleFile,
    needsSubtitle,
    subtitleText: subtitle?.text?.substring(0, 50) || '(empty)',
    subtitleFilePath: (subtitle as any)?.subtitleFile || '(none)',
  })
  
  // Debug logging
  if (subtitle?.enabled) {
    console.log('[FinalExport] Subtitle enabled:', subtitle.enabled)
    console.log('[FinalExport] Subtitle text:', subtitle.text)
    console.log('[FinalExport] Subtitle file:', (subtitle as any).subtitleFile)
    console.log('[FinalExport] Subtitle file exists:', hasSubtitleFile)
    console.log('[FinalExport] Subtitle style:', subtitle.subtitleStyle)
  }
  // NEW APPROACH: Split into 2 steps when subtitle is enabled
  // Step 1: Concat video (copy-stream, fast, no decode errors)
  // Step 2: Burn subtitle (re-encode with GPU)
  // This avoids decode errors from corrupt video inputs
  const needsReencode = forceReencode || needsSubtitle
  // CRITICAL: Use same logic as processJob (willUseTwoStep) to avoid conflict
  // If tempVideoPath is provided, Step 1 already done in processJob
  const useTwoStepProcess = needsSubtitle && !forceReencode
  
  if (useTwoStepProcess) {
    console.log('[FinalExport] 📋 Using 2-step process: Concat video first, then burn subtitle')
  } else if (needsSubtitle && forceReencode) {
    console.log('[FinalExport] ⚠️ Subtitle enabled with forceReencode=true. Using single-step process.')
  }

  // Use GPU encoder based on user choice (or auto-detect if not specified)
  // This will auto-detect NVENC (NVIDIA), AMF (AMD), VideoToolbox (macOS), or fallback to CPU
  const encoderChoice = useGpuEncoding || 'auto' // Default to 'auto' for backward compatibility
  const { args: videoCodecArgs, usedEncoder, gpuInfo } = needsReencode
    ? await buildVideoEncoderArgsWithChoice(true, encoderChoice, 'fast') // 'fast' quality for subtitle rendering
    : { args: ['-c:v', 'copy'], usedEncoder: 'cpu' as const }
  
  // Log GPU usage for debugging
  if (needsReencode) {
    if (usedEncoder === 'gpu' && gpuInfo) {
      console.log(`[FinalExport] Using ${gpuInfo.encoder.toUpperCase()} encoder (${gpuInfo.name || 'GPU'}) for video encoding`)
    } else {
      console.log(`[FinalExport] Using CPU encoder (libx264)${gpuInfo && !gpuInfo.available ? ` - ${gpuInfo.reason}` : ''}`)
    }
  }

  // Build video filter with subtitle if needed (BEFORE Promise constructor to allow async/await)
  // Support both drawtext (simple) and subtitles filter (file-based with effects)
  let videoFilter = ''
  let subtitleFile: string | null = null
  let subtitleTextFile: string | null = null // For drawtext textfile
  
  // Process subtitle text file if needed (async operation)
  if (needsSubtitle && subtitle?.text && subtitle.text.trim() && !(subtitle as any)?.subtitleFile) {
    const textToEscape = subtitle.text.trim()
    const position = subtitle.position || 'bottom'
    const fontSize = subtitle.fontSize || 48
    const fontColor = subtitle.fontColor || 'white'
    const bgColor = subtitle.backgroundColor || 'black'
    const bgOpacity = subtitle.backgroundOpacity ?? 0.7
    
    // Calculate position
    let y = subtitle.y
    if (y === undefined) {
      switch (position) {
        case 'top':
          y = 10
          break
        case 'center':
          y = 50
          break
        case 'bottom':
        default:
          y = 90
          break
      }
    }
    
    const xPos = subtitle.x === undefined || subtitle.x === 50
      ? '(w-text_w)/2'  // Center
      : `(w-text_w)*${subtitle.x}/100`  // Percentage from left
    const yPos = `(h-text_h)*${y}/100`
    
    console.log(`[FinalExport] Subtitle text length: ${textToEscape.length} chars, using textfile for safety`)
    
    // Create temporary text file
    // Use requestId in temp dir to isolate subtitle files per day/job
    const tempDir = path.join(os.tmpdir(), 'ffmpeg-subtitles', requestId)
    await fsp.mkdir(tempDir, { recursive: true })
    subtitleTextFile = path.join(tempDir, `subtitle-text-${randomUUID()}.txt`)
    
    // Write text to file (no escaping needed for file content)
    await fsp.writeFile(subtitleTextFile, textToEscape, 'utf-8')
    
    // Escape file path for FFmpeg
    let escapedTextFile = path.resolve(subtitleTextFile).replace(/\\/g, '/')
    escapedTextFile = escapedTextFile
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/:/g, '\\:')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
    
    // Build filter using textfile parameter
    // IMPORTANT: Don't add [v] label here - it will be added in filter_complex
    videoFilter = `drawtext=textfile='${escapedTextFile}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${xPos}:y=${yPos}:box=1:boxcolor=${bgColor}@${bgOpacity}:boxborderw=10`
    
    console.log('[FinalExport] ✅ Using textfile for subtitle text:', subtitleTextFile)
    console.log('[FinalExport] ✅ videoFilter built (last 50 chars):', videoFilter.substring(Math.max(0, videoFilter.length - 50)))
  }

  // Process subtitle file (.srt/.ass) if needed (MUST be before 2-step check)
  const subtitleFilePath = (subtitle as any)?.subtitleFile
  if (subtitleFilePath && fs.existsSync(subtitleFilePath)) {
    subtitleFile = subtitleFilePath
    
    console.log('[FinalExport] ✅ Found subtitle file:', subtitleFile)
    
    // Validate subtitle file (subtitleFile is guaranteed to be string here)
    if (subtitleFile) {
      const fileSize = fs.statSync(subtitleFile).size
      if (fileSize === 0) {
        throw new Error(`Subtitle file is empty: ${subtitleFile}`)
      }
      
      // Read first few lines to verify format
      const fileContent = fs.readFileSync(subtitleFile, 'utf-8')
      const subtitleFormat = subtitle?.subtitleFormat || 'ass'
      
      // Validate format
      if (subtitleFormat === 'ass') {
        if (!fileContent.includes('[Script Info]') && !fileContent.includes('[V4+ Styles]')) {
          console.warn(`[FinalExport] ⚠️ Subtitle file may not be valid ASS format (missing [Script Info] or [V4+ Styles])`)
        } else {
          console.log(`[FinalExport] ✅ Subtitle file is valid ASS format`)
        }
      } else if (subtitleFormat === 'srt') {
        if (!fileContent.match(/^\d+\s*$/m) && !fileContent.includes('-->')) {
          console.warn(`[FinalExport] ⚠️ Subtitle file may not be valid SRT format (missing sequence numbers or timestamps)`)
        } else {
          console.log(`[FinalExport] ✅ Subtitle file is valid SRT format`)
        }
      }
      
      // Escape file path for FFmpeg
      let escapedSubtitleFile = path.resolve(subtitleFile).replace(/\\/g, '/')
      escapedSubtitleFile = escapedSubtitleFile
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/:/g, '\\:')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
      
      // Use FFmpeg subtitles filter for .srt/.ass files (supports karaoke effects)
      videoFilter = `subtitles='${escapedSubtitleFile}'`
    }
    
    console.log('[FinalExport] ✅ Using subtitle file with karaoke effects')
    console.log('[FinalExport] ✅ FFmpeg filter:', videoFilter.substring(0, 150) + '...')
  } else if (needsSubtitle && !videoFilter) {
    console.warn('[FinalExport] Subtitle enabled but no text or file, skipping subtitle filter')
  }

  // NEW: 2-step process when subtitle is enabled (to avoid decode errors)
  // CRITICAL: Recalculate useTwoStepProcess AFTER building videoFilter
  // Because videoFilter is built from subtitle file which is created by Whisper
  const useTwoStepProcessRecalc = needsSubtitle && !forceReencode
  
  console.log('[FinalExport] 🔍 Debug 2-step check:', {
    useTwoStepProcess: useTwoStepProcessRecalc,
    needsSubtitle,
    forceReencode,
    hasVideoFilter: !!videoFilter,
    videoFilterLength: videoFilter?.length || 0,
    hasSubtitle: !!subtitle,
    subtitleEnabled: subtitle?.enabled,
    videoFilterPreview: videoFilter ? videoFilter.substring(0, 100) : '(empty)',
  })
  
  // CRITICAL: Check if we should use 2-step process
  // Condition: subtitle enabled, has videoFilter, and NOT forceReencode
  // BUT: If tempVideoPath is provided, Step 1 already done in processJob, so we MUST use 2-step
  const shouldUseTwoStep = (useTwoStepProcessRecalc && videoFilter && videoFilter.trim().length > 0) || 
                           (tempVideoPath && fs.existsSync(tempVideoPath))
  
  console.log('[FinalExport] 🔍 2-step decision:', {
    shouldUseTwoStep,
    useTwoStepProcessRecalc,
    needsSubtitle,
    forceReencode,
    hasVideoFilter: !!videoFilter && videoFilter.trim().length > 0,
    hasTempVideoPath: !!tempVideoPath,
    tempVideoPathExists: tempVideoPath ? fs.existsSync(tempVideoPath) : false,
  })
  
  // Check if Step 1 already done (tempVideoPath provided and exists)
  // CRITICAL: If tempVideoPath exists, Step 1 was done in processJob, MUST NOT run again
  const step1AlreadyDone = tempVideoPath && fs.existsSync(tempVideoPath)
  
  console.log('[FinalExport] 🔍 Step 1 check:', {
    tempVideoPath,
    tempVideoPathExists: tempVideoPath ? fs.existsSync(tempVideoPath) : false,
    step1AlreadyDone,
    shouldUseTwoStep,
    willRunStep1: shouldUseTwoStep && !step1AlreadyDone,
    willRunStep2: shouldUseTwoStep && step1AlreadyDone,
  })
  
  if (shouldUseTwoStep && !step1AlreadyDone) {
    console.log('[FinalExport] 🔄 Step 1/2: Concat video (copy-stream, fast)')
    
    // Emit progress to show we're starting 2-step process
    if (emitProgress) {
      emitProgress({
        requestId,
        stage: 'export',
        percent: 0,
        timeSec: 0,
        totalDurationSec,
        status: '[Bước 1/2] Đang ghép video (copy-stream, nhanh)...',
      })
    }
    
    // Step 1: Concat video + audio (copy-stream, no subtitle)
    // CRITICAL: If tempVideoPath was provided, use it (from processJob)
    // Otherwise, create new temp file (should not happen if logic is correct)
    const tempOutputPath = tempVideoPath && fs.existsSync(tempVideoPath) 
      ? tempVideoPath 
      : (() => {
          // Use requestId + jobIndex in temp filename to avoid conflicts (fallback case)
          const tempFileName = `${path.basename(outputPath, '.mp4')}-${requestId.substring(0, 8)}.temp.mp4`
          return path.join(path.dirname(outputPath), tempFileName)
        })()
    
    // If using tempVideoPath from processJob, log it
    if (tempVideoPath && tempOutputPath === tempVideoPath) {
      console.log('[FinalExport] ✅ Using tempVideoPath from processJob (Step 1 already done)')
    } else {
      console.log('[FinalExport] ⚠️ Creating new temp file (Step 1 not done in processJob - unexpected)')
    }
    
    await new Promise<void>((resolve, reject) => {
      const shouldNormalizeAudio = normalizeAudio
      const shouldEncodeAudio = forceReencode || needAudioEncode || shouldNormalizeAudio
      const audioCodecArgs = shouldEncodeAudio
        ? ['-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2']
        : ['-c:a', 'copy']
      const audioFilterArgs = shouldNormalizeAudio
        ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']
        : []
      
      const args: string[] = [
        '-hide_banner',
        '-loglevel', 'error',
        '-stats',
        '-f', 'concat',
        '-safe', '0',
        '-i', videoListPath,
        '-i', audioPath,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy', // Copy video stream (fast, no decode errors)
        ...audioFilterArgs,
        ...audioCodecArgs,
        '-avoid_negative_ts', 'make_zero',
        '-t', totalDurationSec.toFixed(3),
        '-y', tempOutputPath,
      ]
      
      const child = spawn(ffmpegPath, args, { windowsHide: true })
      videoJobManager.registerJob(requestId, child)
      
      let lastEmit = 0
      const stderrLines: string[] = []
      
      child.stderr?.on('data', (chunk: Buffer) => {
        if (videoJobManager.isCancelled(requestId)) {
          if (!child.killed) {
            child.kill('SIGTERM')
            setTimeout(() => {
              if (!child.killed) child.kill('SIGKILL')
            }, 2000)
          }
          return
        }
        
        const text = chunk.toString('utf-8')
        stderrLines.push(...text.split(/\r?\n/).filter(Boolean))
        if (stderrLines.length > 80) {
          stderrLines.splice(0, stderrLines.length - 80)
        }
        const timeSec = parseTimeFromChunk(text)
        if (timeSec !== null && totalDurationSec > 0) {
          const percent = Math.min(50, (timeSec / totalDurationSec) * 50) // Step 1 = 0-50%
          const now = Date.now()
          if (now - lastEmit > 100) {
            lastEmit = now
            emitProgress({
              requestId,
              stage: 'export',
              percent,
              timeSec,
              totalDurationSec,
              status: 'Đang ghép video (bước 1/2)...',
            })
          }
        }
      })
      
      child.on('error', (error) => {
        reject(new Error(`FFmpeg step 1 (concat) error: ${error.message}`))
      })
      
      child.on('close', async (code) => {
        if (code === 0) {
          console.log('[FinalExport] ✅ Step 1 completed: Video concatenated')
          resolve()
        } else {
          const tail = stderrLines.slice(-10).join('\n')
          reject(new Error(`FFmpeg step 1 (concat) failed với mã ${code}. stderr:\n${tail}`))
        }
      })
    })
    
    // Step 2: Burn subtitle into temp file (re-encode with GPU)
    console.log('[FinalExport] 🔄 Step 2/2: Burn subtitle (re-encode with GPU)')
    
    // Emit progress to show we're starting step 2
    if (emitProgress) {
      emitProgress({
        requestId,
        stage: 'export',
        percent: 50,
        timeSec: 0,
        totalDurationSec,
        status: '[Bước 2/2] Đang burn subtitle vào video (GPU encoding)...',
      })
    }
    
    await burnSubtitleIntoVideo(
      tempOutputPath,
      outputPath,
      subtitle,
      videoFilter,
      requestId,
      totalDurationSec,
      emitProgress,
      useGpuEncoding
    )
    
    // Clean up temp file if we created it
    if (fs.existsSync(tempOutputPath)) {
      try {
        await fsp.unlink(tempOutputPath)
        console.log('[FinalExport] ✅ Cleaned up temp video file')
      } catch (e) {
        console.warn('[FinalExport] ⚠️ Failed to clean up temp video file:', e)
      }
    }
    
    return // Exit early, don't run single-step process
  } else if (shouldUseTwoStep && step1AlreadyDone) {
    // Step 1 already done, only run Step 2
    console.log('[FinalExport] 🔄 Step 2/2: Burn subtitle (re-encode with GPU) - Step 1 already done')
    console.log('[FinalExport] 🔍 Step 2 validation:', {
      tempVideoPath,
      tempVideoPathExists: tempVideoPath ? fs.existsSync(tempVideoPath) : false,
      hasSubtitle: !!subtitle,
      hasVideoFilter: !!videoFilter,
      videoFilterLength: videoFilter?.length || 0,
    })
    
    // Validate inputs before proceeding
    if (!tempVideoPath || !fs.existsSync(tempVideoPath)) {
      throw new Error(`Step 1 temp video file not found: ${tempVideoPath}`)
    }
    if (!subtitle) {
      throw new Error('Subtitle config is missing for Step 2')
    }
    if (!videoFilter || videoFilter.trim().length === 0) {
      throw new Error('Video filter is missing for Step 2')
    }
    
    if (emitProgress) {
      emitProgress({
        requestId,
        stage: 'export',
        percent: 50,
        timeSec: 0,
        totalDurationSec,
        status: '[Bước 2/2] Đang burn subtitle vào video (GPU encoding)...',
      })
    }
    
    await burnSubtitleIntoVideo(
      tempVideoPath,
      outputPath,
      subtitle,
      videoFilter,
      requestId,
      totalDurationSec,
      emitProgress,
      useGpuEncoding
    )
    
    // Clean up temp file
    if (fs.existsSync(tempVideoPath!)) {
      try {
        await fsp.unlink(tempVideoPath!)
        console.log('[FinalExport] ✅ Cleaned up temp video file')
      } catch (e) {
        console.warn('[FinalExport] ⚠️ Failed to clean up temp video file:', e)
      }
    }
    
    return // Exit early, don't run single-step process
  }

  // Original single-step process (when no subtitle or forceReencode=true)
  await new Promise<void>((resolve, reject) => {

    const shouldNormalizeAudio = normalizeAudio
    const shouldEncodeAudio = forceReencode || needAudioEncode || shouldNormalizeAudio
    const audioCodecArgs = shouldEncodeAudio
      ? ['-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2']
      : ['-c:a', 'copy']
    const audioFilterArgs = shouldNormalizeAudio
      ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']
      : []
    
    // videoFilter was already built above (before Promise constructor)
    if (needsSubtitle && videoFilter) {
      console.log('[FinalExport] Using pre-built videoFilter:', videoFilter.includes('subtitles=') ? 'subtitles file' : 'drawtext')
    } else if (needsSubtitle && !videoFilter) {
      console.warn('[FinalExport] Subtitle enabled but filter not created, skipping subtitle')
    }
    
    // REMOVED: Subtitle file processing moved outside Promise constructor (before 2-step check)
    // This ensures videoFilter is ready before checking useTwoStepProcess
    
    // CRITICAL VALIDATION: videoFilter must NOT contain [v] (if it exists)
    if (videoFilter && videoFilter.includes('[v]')) {
      console.error('[FinalExport] ❌ CRITICAL ERROR: videoFilter contains [v] label!')
      console.error('[FinalExport] videoFilter:', videoFilter)
      throw new Error('videoFilter must not contain [v] label - it will be added in filter_complex')
    }

    const args: string[] = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-stats',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      videoListPath,
      '-i',
      audioPath,
    ]

    // Add video filter if subtitle is enabled and filter is valid
    if (needsSubtitle && videoFilter && videoFilter.trim().length > 0) {
      // Validate filter string before using
      if (!videoFilter.includes('drawtext=') && !videoFilter.includes('subtitles=')) {
        console.error('[FinalExport] Invalid video filter, missing drawtext or subtitles:', videoFilter)
        throw new Error('Invalid subtitle filter configuration')
      }
      
      // Debug: Log videoFilter before processing
      console.log('[FinalExport] 🔍 videoFilter before processing (first 200 chars):', videoFilter.substring(0, 200))
      console.log('[FinalExport] 🔍 videoFilter before processing (last 50 chars):', videoFilter.substring(Math.max(0, videoFilter.length - 50)))
      console.log('[FinalExport] 🔍 videoFilter ends with [v]:', videoFilter.trim().endsWith('[v]'))
      
      // For subtitles filter, apply directly to video stream using -vf
      // For drawtext, use filter_complex with output label
      if (videoFilter.includes('subtitles=')) {
        // subtitles filter applies directly, no need for [v] label
        args.push('-vf', videoFilter)
        args.push('-map', '0:v:0')
      } else if (videoFilter.includes('drawtext=')) {
        // drawtext needs filter_complex
        // IMPORTANT: videoFilter should NOT contain [v] - we add it here
        // Make sure videoFilter doesn't already have [v] at the end
        // CRITICAL: videoFilter should NOT contain [v] - validate and clean if needed
        let cleanFilter = videoFilter.trim()
        
        // Remove [v] from anywhere in the string (should not exist, but safety check)
        const originalFilter = cleanFilter
        cleanFilter = cleanFilter.replace(/\[v\]/g, '').trim()
        
        if (originalFilter !== cleanFilter) {
          console.error('[FinalExport] ❌ CRITICAL: Found [v] in videoFilter!')
          console.error('[FinalExport] Original (last 100 chars):', originalFilter.substring(Math.max(0, originalFilter.length - 100)))
          console.error('[FinalExport] Cleaned (last 100 chars):', cleanFilter.substring(Math.max(0, cleanFilter.length - 100)))
        }
        
        // Final validation: cleanFilter must NOT contain [v]
        if (cleanFilter.includes('[v]')) {
          console.error('[FinalExport] ❌ CRITICAL ERROR: cleanFilter still contains [v] after cleanup!')
          throw new Error('CRITICAL: cleanFilter contains [v] - this will cause FFmpeg error!')
        }
        
        // Build filter_complex: [0:v]drawtext=...[v]
        // Format: [0:v]drawtext=textfile='...':fontsize=48:...:boxborderw=10[v]
        const filterComplex = `[0:v]${cleanFilter}[v]`
        
        console.log('[FinalExport] ✅ Drawtext filter_complex (first 300 chars):', filterComplex.substring(0, 300))
        console.log('[FinalExport] ✅ Drawtext filter_complex (last 50 chars):', filterComplex.substring(Math.max(0, filterComplex.length - 50)))
        console.log('[FinalExport] ✅ Validation:', {
          startsWith: filterComplex.startsWith('[0:v]'),
          endsWith: filterComplex.endsWith('[v]'),
          cleanFilterContainsV: cleanFilter.includes('[v]'),
          cleanFilterEndsWith: cleanFilter.substring(Math.max(0, cleanFilter.length - 10)),
        })
        
        args.push('-filter_complex', filterComplex)
        args.push('-map', '[v]')
      } else {
        console.error('[FinalExport] Unknown video filter type:', videoFilter.substring(0, 100))
        throw new Error('Invalid video filter type')
      }
      console.log('[FinalExport] Using subtitle filter, re-encoding video')
    } else {
      args.push('-map', '0:v:0')
      if (needsSubtitle && !videoFilter) {
        console.warn('[FinalExport] Subtitle enabled but filter not created, using video copy')
      }
    }

    args.push(
      '-map', '1:a:0',
      ...videoCodecArgs,
      ...audioFilterArgs,
      ...audioCodecArgs,
      '-avoid_negative_ts',
      'make_zero',
      '-t',
      totalDurationSec.toFixed(3),
      '-y',
      outputPath,
    )

    const child = spawn(ffmpegPath, args, { windowsHide: true })
    videoJobManager.registerJob(requestId, child)

    let lastEmit = 0
    let lastTimeSec: number | null = null
    const stderrLines: string[] = []

    let dropWarned = false

    child.stderr?.on('data', (chunk: Buffer) => {
      // Kiểm tra cancel trong quá trình xử lý
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
      stderrLines.push(...text.split(/\r?\n/).filter(Boolean))
      if (stderrLines.length > 80) {
        stderrLines.splice(0, stderrLines.length - 80)
      }
      const timeSec = parseTimeFromChunk(text)
      const speedX = parseSpeedFromChunk(text)
      if (timeSec !== null && totalDurationSec > 0) {
        const percent = Math.min(100, (timeSec / totalDurationSec) * 100)
        const now = Date.now()
        // Giảm debounce từ 200ms xuống 100ms để cập nhật thường xuyên hơn
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
        // Lưu lại timeSec cuối cùng để dùng khi close
        lastTimeSec = timeSec
      }

      // Log drop-frame / retry warnings if FFmpeg báo
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
      // Cleanup subtitle file on error
      if (subtitleFile && fs.existsSync(subtitleFile)) {
        try {
          await fsp.unlink(subtitleFile).catch(() => {})
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      }
      reject(new Error(`FFmpeg spawn error: ${error.message}`))
    })

    child.on('close', async (code) => {
      // Cleanup subtitle file if exists
      if (subtitleFile && fs.existsSync(subtitleFile)) {
        try {
          await fsp.unlink(subtitleFile).catch(() => {})
        } catch (error) {
          // Ignore cleanup errors
        }
      }

      if (code === 0) {
        // Đảm bảo emit progress 100% khi hoàn thành (tránh progress đứng ở ~99%)
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
        resolve()
      } else {
        // Kiểm tra xem file output có tồn tại và hợp lệ không
        // Nếu có, coi như thành công (FFmpeg có thể exit code != 0 nhưng vẫn tạo file đúng)
        try {
          const stats = await fsp.stat(outputPath)
          if (stats.size > 0) {
            // File tồn tại và có size > 0, kiểm tra xem có phải warning không
            const stderrText = stderrLines.join('\n')
            const isBufferQueueWarning = /buffers queued|Error marking filters as finished/i.test(stderrText)
            
            if (isBufferQueueWarning) {
              // Đây là warning thường gặp, không phải lỗi thực sự
              console.warn(
                `[FinalExport] FFmpeg exited with code ${code} nhưng file output tồn tại và hợp lệ (${formatBytes(stats.size)}). ` +
                `Đây là warning về buffer queue (không ảnh hưởng chất lượng video).`
              )
              // Coi như thành công
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
              resolve()
              return
            }
          }
        } catch (checkError) {
          // File không tồn tại hoặc không thể đọc được, tiếp tục reject
        }
        
        // Nếu file không tồn tại hoặc rỗng, mới reject
        const tail = stderrLines.slice(-10).join('\n')
        reject(new Error(`FFmpeg final export failed với mã ${code}. stderr:\n${tail}`))
      }
    })
  })
}

async function cleanupTempDir(dir: string | null): Promise<void> {
  if (!dir) return
  try {
    await fsp.rm(dir, { recursive: true, force: true })
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
      request.subtitle,
      undefined, // No options by default
      request.useGpuEncoding || 'auto', // GPU encoding choice (default: 'auto')
      !!request.deleteSourceFiles // Xóa file audio/video sau khi xuất xong
    )
  } catch (error: any) {
    console.error('[FinalExport] Lỗi export video hoàn chỉnh:', error)
    emitter.error({
      requestId,
      error: error?.message || 'Xuất video thất bại.',
      message: error?.message,
    })
    throw error
  }
}


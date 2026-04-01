import { spawn } from 'child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getFfmpegPaths } from '../ffmpeg/config'
import { probeFile } from '../ffmpeg/probe'
import { validateInputFiles, type ValidatedInputFile } from './videoUtils'
import { getVideoFileInfo } from './videoInfo'
import { videoJobManager } from './videoJobManager'
import { verifyOutputVideo } from './outputVerification'
import { runPlaybackTest } from './playbackTest'
import { getDiskSpace, formatBytes } from '../utils/diskSpace'
import { buildVideoEncoderArgsWithChoice } from '../utils/gpuDetection'
import { buildNormalizeVfFilter } from './utils/normalizeVf'
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

export interface FinalExportEmitter {
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
  // Normalize backslash Windows → forward slash trước (FFmpeg concat demuxer yêu cầu)
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.replace(/'/g, "\\'")
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
  targetFps?: string
): Promise<void> {
  const tempDir = await ensureTempDir(`final-export-${requestId}-`)

  // Build vf filter for resolution/FPS normalization if requested
  const normalizeVfFilter = unifyFormat && targetResolution && targetFps
    ? buildNormalizeVfFilter(targetResolution, targetFps)
    : null

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
        if (canMapOneToOne) {
          // Map 1-1: clip tương ứng đi TRƯỚC, sau đó fill phần còn lại bằng các clip khác
          const mappedClip = baseClips[Math.min(job.jobIndex, baseClips.length - 1)]
          if (mappedClip) {
            console.log(
              `[Job ${currentJobIndex}/${plan.totalJobs}] Map 1-1 với clip: ${path.basename(mappedClip.path)}`
            )
            const mappedDuration = mappedClip.durationSec
            const remainingTarget = Math.max(0, targetDurationSec - mappedDuration)
            videoPlaylist = [mappedClip]
            if (remainingTarget > 0) {
              // Dùng tất cả các clip còn lại (trừ mappedClip) để fill phần còn lại
              const restClips = baseClips.filter(c => c.path !== mappedClip.path)
              const loopSource = restClips.length > 0 ? restClips : baseClips
              const loopSeed = Date.now() + job.jobIndex * 2000000 + Math.random() * 1000
              const fillClips = buildPlaylistToFillDuration(loopSource, remainingTarget, true, loopSeed)
              videoPlaylist.push(...fillClips)
            }
          } else {
            videoPlaylist = buildPlaylistToFillDuration(baseClips, targetDurationSec, shuffle)
          }
        } else {
          videoPlaylist = buildPlaylistToFillDuration(baseClips, targetDurationSec, shuffle)
        }
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
      await runFinalCommand({
        requestId,
        totalDurationSec: job.audio.durationSec,
        videoListPath: videoListFile,
        audioPath: job.audio.path,
        outputPath: job.outputPath,
        audioCodec,
        forceReencode,
        normalizeAudio,
        useGpuEncoding,
        normalizeVfFilter,
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

      // 5. Verify output (ffprobe + decode) + optional playback test + cleanup concat list file
      const shouldRunDeepVerify = forceReencode || needAudioEncode || normalizeAudio || !!normalizeVfFilter
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

    // Emit done event
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
  emitProgress: (payload: FinalExportProgressPayload) => void
  useGpuEncoding?: 'gpu' | 'cpu' | 'auto' // GPU encoding choice
  normalizeVfFilter?: string | null // vf filter for resolution/FPS normalization
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
    emitProgress,
    useGpuEncoding,
    normalizeVfFilter,
  } = opts
  const ffmpegPath = getFfmpegExecutable()

  await fsp.mkdir(path.dirname(outputPath), { recursive: true })

  const codec = audioCodec?.toLowerCase() ?? null
  const needAudioEncode = !codec || (codec !== 'aac' && codec !== 'mp3')

  // vf filter implies re-encode (can't copy-stream with filter)
  const needsReencode = forceReencode || needAudioEncode || normalizeAudio || !!normalizeVfFilter
  const encoderChoice = useGpuEncoding || 'auto'
  const { args: rawVideoCodecArgs, usedEncoder, gpuInfo } = needsReencode
    ? await buildVideoEncoderArgsWithChoice(true, encoderChoice, 'fast')
    : { args: ['-c:v', 'copy'], usedEncoder: 'cpu' as const, gpuInfo: null }

  // Sanitize codec args for smooth output:
  // 1. When software -vf filter is used, frames MUST be in CPU memory → strip -hwaccel
  //    (h264_nvenc + -hwaccel nvdec keeps frames on GPU → software scale/pad/fps silently skipped)
  // 2. Always replace -vsync 2 (VFR passthrough) with -vsync cfr when re-encoding so that
  //    concat clips with different FPS produce stable timestamps (prevents black frames / tearing
  //    at every scene transition).
  let videoCodecArgs = rawVideoCodecArgs
  if (needsReencode) {
    const sanitized: string[] = []
    for (let i = 0; i < rawVideoCodecArgs.length; i++) {
      // Strip -hwaccel + value when software vf filter is active
      if (normalizeVfFilter && rawVideoCodecArgs[i] === '-hwaccel') {
        i++ // skip -hwaccel AND its value (e.g. 'nvdec', 'd3d11va', 'cuda')
        continue
      }
      // Always replace VFR passthrough with CFR for stable timestamps
      if (rawVideoCodecArgs[i] === '-vsync' && rawVideoCodecArgs[i + 1] === '2') {
        sanitized.push('-vsync', 'cfr')
        i++
        continue
      }
      sanitized.push(rawVideoCodecArgs[i])
    }
    videoCodecArgs = sanitized
    if (normalizeVfFilter) {
      console.log('[FinalExport] vf filter active → stripped -hwaccel, using -vsync cfr')
    } else {
      console.log('[FinalExport] re-encode mode → using -vsync cfr for stable timestamps')
    }
  }

  if (needsReencode) {
    if (usedEncoder === 'gpu' && gpuInfo) {
      console.log(`[FinalExport] Using ${(gpuInfo as any).encoder?.toUpperCase()} encoder for video encoding`)
    } else {
      console.log(`[FinalExport] Using CPU encoder (libx264)`)
    }
  }

  // Single-step export
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
      '-loglevel',
      'error',
      '-stats',
      // Regenerate PTS from DTS when concat clips have discontinuous/invalid timestamps.
      // +igndts: bỏ qua DTS không hợp lệ (clip reset PTS về 0) để tránh freeze frame tại điểm chuyển clip.
      '-fflags', '+genpts+igndts',
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
      // vf filter for resolution/FPS normalization (letterbox/pillarbox)
      ...(normalizeVfFilter ? ['-vf', normalizeVfFilter] : []),
      ...audioFilterArgs,
      ...audioCodecArgs,
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
    // Drain stdout để tránh pipe buffer đầy → FFmpeg bị block/treo với file dài
    child.stdout?.resume()

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
      reject(new Error(`FFmpeg spawn error: ${error.message}`))
    })

    child.on('close', async (code) => {
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
      undefined, // subtitle removed
      undefined, // options removed
      request.useGpuEncoding || 'auto',
      !!request.deleteSourceFiles,
      !!request.unifyFormat,
      request.targetResolution,
      request.targetFps
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


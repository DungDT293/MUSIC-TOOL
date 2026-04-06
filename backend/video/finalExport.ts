import { spawn } from 'child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getFfmpegPaths } from '../ffmpeg/config'
import { probeFile } from '../ffmpeg/probe'
import { validateInputFiles, type ValidatedInputFile } from './videoUtils'
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
    })
    
    // Xóa file audio và video nguồn nếu được yêu cầu
    if (deleteSourceFiles) {
      console.log('[FinalExport] Xóa file audio và video nguồn sau khi xuất xong...')
      const deletedFiles: string[] = []
      const failedFiles: string[] = []
      
      // Xóa các file audio (chỉ từ job thành công — job lỗi giữ lại để debug/retry)
      for (const job of succeededJobs) {
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

function getFfmpegExecutable(): string {
  const { ffmpeg } = getFfmpegPaths()
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

interface PreTranscodeClipsOptions {
  /** Danh sách clip video gốc (path + duration) */
  clips: Array<{ path: string; durationSec: number }>
  /** Thư mục temp để lưu clip đã transcode */
  tempDir: string
  /** VF filter chuẩn hóa (resolution + FPS + pad + format) */
  vfFilter: string
  /** GPU encoding choice */
  useGpuEncoding?: 'gpu' | 'cpu' | 'auto'
  /** Request ID để cancel */
  requestId: string
  /** Callback emit progress (percent 0-70 cho pass 1) */
  onProgress?: (percent: number, speedX?: number | null) => void
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
  const { clips, tempDir, vfFilter, useGpuEncoding, requestId, onProgress } = opts
  const ffmpegPath = getFfmpegExecutable()
  const transcodedPaths: string[] = []
  let lastSpeedX: number | null = null

  // Build encoder args một lần (tất cả clip dùng cùng encoder)
  const encoderChoice = useGpuEncoding || 'auto'
  const { args: rawEncoderArgs, usedEncoder, gpuInfo } = await buildVideoEncoderArgsWithChoice(
    true, // needsReencode
    encoderChoice,
    'fast'
  )

  if (usedEncoder === 'gpu' && gpuInfo) {
    console.log(`[PreTranscode] Using ${(gpuInfo as any).encoder?.toUpperCase()} encoder (${(gpuInfo as any).name || 'GPU'})`)
  } else {
    console.log(`[PreTranscode] Using CPU encoder (libx264)`)
  }

  // Sanitize encoder args:
  // 1. Strip -hwaccel khi có software vf filter (frames phải ở CPU memory)
  // 2. Replace -vsync 2 (VFR) → -vsync cfr cho stable timestamps
  const sanitizedArgs: string[] = []
  for (let i = 0; i < rawEncoderArgs.length; i++) {
    if (rawEncoderArgs[i] === '-hwaccel') {
      i++ // skip -hwaccel + value
      continue
    }
    if (rawEncoderArgs[i] === '-vsync' && rawEncoderArgs[i + 1] === '2') {
      sanitizedArgs.push('-vsync', 'cfr')
      i++
      continue
    }
    sanitizedArgs.push(rawEncoderArgs[i])
  }

  console.log(`[PreTranscode] Starting pre-transcode of ${clips.length} clips to uniform format...`)
  console.log(`[PreTranscode] vf filter: ${vfFilter}`)

  for (let i = 0; i < clips.length; i++) {
    // Check cancel
    if (videoJobManager.isCancelled(requestId)) {
      throw new Error('Đã dừng bởi người dùng')
    }

    const clip = clips[i]
    const outputFile = path.join(tempDir, `pre_${String(i).padStart(5, '0')}.mp4`)

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const safeResolve = () => { if (!settled) { settled = true; resolve() } }
      const safeReject = (err: Error) => { if (!settled) { settled = true; reject(err) } }

      const args = [
        '-hide_banner',
        '-y',
        '-fflags', '+genpts+igndts+discardcorrupt',
        '-i', clip.path,
        '-vf', vfFilter,
        ...sanitizedArgs,
        '-map', '0:v:0',
        // Không cần audio — audio sẽ được mux từ file audio riêng ở Pass 2
        '-an',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        outputFile,
      ]

      const proc = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })

      // Register để cancel
      const childRequestId = `${requestId}-pretranscode-${i}`
      videoJobManager.registerJob(childRequestId, proc)

      // Per-clip wall-clock timeout: 10 minutes max per clip
      const CLIP_TIMEOUT_MS = 10 * 60 * 1000
      const clipTimer = setTimeout(() => {
        if (!proc.killed) {
          console.warn(`[PreTranscode] Clip ${i + 1}/${clips.length} timed out after ${CLIP_TIMEOUT_MS / 1000}s, killing...`)
          proc.kill('SIGTERM')
          setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 2000)
          safeReject(new Error(`[PreTranscode] Clip ${i + 1}/${clips.length} timed out after ${CLIP_TIMEOUT_MS / 60000} phút: ${path.basename(clip.path)}`))
        }
      }, CLIP_TIMEOUT_MS)

      proc.stderr?.on('data', (data: Buffer) => {
        if (videoJobManager.isCancelled(requestId)) {
          if (!proc.killed) {
            proc.kill('SIGTERM')
            setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 1000)
          }
          safeReject(new Error('Đã dừng bởi người dùng'))
          return
        }

        const text = data.toString('utf-8')
        const speedMatch = text.match(/speed=\s*([0-9.]+)x/i)
        if (speedMatch) {
          const speed = parseFloat(speedMatch[1])
          if (!isNaN(speed) && speed > 0) {
            lastSpeedX = speed
          }
        }

        // Emit progress: pass 1 chiếm 0-70% tổng tiến trình
        if (onProgress) {
          const clipProgress = (i / clips.length) * 70
          onProgress(clipProgress, lastSpeedX)
        }
      })

      proc.on('error', (err) => { clearTimeout(clipTimer); safeReject(err) })
      proc.on('close', (code) => {
        clearTimeout(clipTimer)
        if (videoJobManager.isCancelled(requestId)) {
          safeReject(new Error('Đã dừng bởi người dùng'))
          return
        }
        if (code === 0 && fs.existsSync(outputFile)) {
          safeResolve()
        } else {
          safeReject(new Error(`[PreTranscode] Failed clip ${i + 1}/${clips.length}: ${path.basename(clip.path)} (code ${code})`))
        }
      })
    })

    transcodedPaths.push(outputFile)

    // Log progress mỗi 50 clip hoặc clip cuối
    if ((i + 1) % 50 === 0 || i === clips.length - 1) {
      console.log(`[PreTranscode] Completed ${i + 1}/${clips.length} clips`)
    }

    if (onProgress) {
      onProgress(((i + 1) / clips.length) * 70, lastSpeedX)
    }
  }

  console.log(`[PreTranscode] ✓ All ${clips.length} clips pre-transcoded to uniform format`)
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
  const needsReencode = forceReencode || needAudioEncode || normalizeAudio || !!normalizeVfFilter

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
    await runFinalCommand_TwoPass(opts)
    return
  }

  // ─── SINGLE-STEP APPROACH (copy-stream hoặc re-encode đơn giản không có vf filter) ───
  const encoderChoice = useGpuEncoding || 'auto'
  const { args: rawVideoCodecArgs, usedEncoder, gpuInfo } = needsReencode
    ? await buildVideoEncoderArgsWithChoice(true, encoderChoice, 'fast')
    : { args: ['-c:v', 'copy'], usedEncoder: 'cpu' as const, gpuInfo: null }

  let videoCodecArgs = rawVideoCodecArgs
  if (needsReencode) {
    // Replace -vsync 2 → cfr
    const sanitized: string[] = []
    for (let i = 0; i < rawVideoCodecArgs.length; i++) {
      if (rawVideoCodecArgs[i] === '-vsync' && rawVideoCodecArgs[i + 1] === '2') {
        sanitized.push('-vsync', 'cfr')
        i++
        continue
      }
      sanitized.push(rawVideoCodecArgs[i])
    }
    videoCodecArgs = sanitized
    console.log('[FinalExport] re-encode mode (no vf filter) → using -vsync cfr')
  } else {
    videoCodecArgs = ['-c:v', 'copy', '-fps_mode', 'passthrough']
    console.log('[FinalExport] copy-stream mode → -fps_mode passthrough + concat duration metadata')
  }

  if (needsReencode) {
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
    audioPath,
    outputPath,
    videoCodecArgs,
    needsReencode,
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

  // Đọc concat list để lấy danh sách clip
  const listContent = await fsp.readFile(videoListPath, 'utf-8')
  const clips = parseClipsFromConcatList(listContent)

  if (clips.length === 0) {
    throw new Error('[FinalExport 2-Pass] Concat list rỗng, không có clip nào để transcode')
  }

  console.log(`[FinalExport 2-Pass] Parsed ${clips.length} clips from concat list`)

  // Tạo temp dir cho pre-transcoded clips
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'finalexport-pretranscode-'))
  console.log(`[FinalExport 2-Pass] Temp dir: ${tempDir}`)

  try {
    // ──── PASS 1: Pre-transcode từng clip riêng lẻ ────
    console.log(`[FinalExport 2-Pass] === PASS 1: Pre-transcoding ${clips.length} clips ===`)
    emitProgress({
      requestId,
      stage: 'export',
      percent: 0,
      timeSec: 0,
      totalDurationSec,
      status: `Pass 1/2: Đang chuẩn hóa ${clips.length} video clips...`,
    })

    const transcodedPaths = await preTranscodeClips({
      clips,
      tempDir,
      vfFilter: normalizeVfFilter!,
      useGpuEncoding: useGpuEncoding || 'auto',
      requestId,
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

    // Build concat list cho các clip đã transcode (KHÔNG cần inpoint/duration vì uniform format)
    const pass2ListPath = path.join(tempDir, 'concat_pass2.txt')
    const pass2ListContent = transcodedPaths
      .map(p => `file '${escapePathForFfmpegList(p)}'`)
      .join('\n')
    await fsp.writeFile(pass2ListPath, pass2ListContent, 'utf-8')

    // Audio args
    const codec = audioCodec?.toLowerCase() ?? null
    const needAudioEncode = !codec || (codec !== 'aac' && codec !== 'mp3')
    const shouldEncodeAudio = forceReencode || needAudioEncode || normalizeAudio
    const audioCodecArgs = shouldEncodeAudio
      ? ['-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2']
      : ['-c:a', 'copy']
    const audioFilterArgs = normalizeAudio
      ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']
      : []

    // Pass 2 FFmpeg: concat copy (video đã uniform) + mux audio
    const pass2Args = [
      '-hide_banner', '-loglevel', 'error', '-stats',
      '-fflags', '+genpts',
      '-f', 'concat', '-safe', '0',
      '-i', pass2ListPath,
      '-i', audioPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      // COPY video vì đã pre-transcode uniform (cùng resolution, FPS, codec, pixel format)
      // → concat copy KHÔNG reinit decoder → KHÔNG freeze frame
      '-c:v', 'copy',
      ...audioFilterArgs,
      ...audioCodecArgs,
      '-max_muxing_queue_size', '2048',
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
      let lastTimeSec: number | null = null
      const stderrLines: string[] = []

      child.stderr?.on('data', (chunk: Buffer) => {
        if (videoJobManager.isCancelled(requestId)) {
          if (!child.killed) {
            child.kill('SIGTERM')
            setTimeout(() => { if (!child.killed) child.kill('SIGKILL') }, 2000)
          }
          return
        }

        const text = chunk.toString('utf-8')
        stderrLines.push(...text.split(/\r?\n/).filter(Boolean))
        if (stderrLines.length > 80) stderrLines.splice(0, stderrLines.length - 80)

        const timeSec = parseTimeFromChunk(text)
        const speedX = parseSpeedFromChunk(text)
        if (timeSec !== null && totalDurationSec > 0) {
          // Pass 2 chiếm 70-100% tiến trình tổng
          const pass2Percent = Math.min(100, (timeSec / totalDurationSec) * 100)
          const totalPercent = 70 + (pass2Percent / 100) * 30
          const now = Date.now()
          if (now - lastEmit > 100) {
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
          lastTimeSec = timeSec
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
        } else {
          // Kiểm tra output file
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
                  if (probeDuration > 0 && probeDuration >= totalDurationSec * 0.5) {
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
          } catch { /* file not found */ }

          const tail = stderrLines.slice(-10).join('\n')
          safeReject(new Error(`FFmpeg Pass 2 (concat copy) failed với mã ${code}. stderr:\n${tail}`))
        }
      })
    })

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
  audioPath: string
  outputPath: string
  videoCodecArgs: string[]
  needsReencode: boolean
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
    audioPath,
    outputPath,
    videoCodecArgs,
    needsReencode,
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
      ? ['-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2']
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
      ...(needsReencode ? ['-reinit_filter', '0'] : []),
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
    const stderrLines: string[] = []

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
      stderrLines.push(...text.split(/\r?\n/).filter(Boolean))
      if (stderrLines.length > 80) {
        stderrLines.splice(0, stderrLines.length - 80)
      }
      const timeSec = parseTimeFromChunk(text)
      const speedX = parseSpeedFromChunk(text)
      if (timeSec !== null && totalDurationSec > 0) {
        const percent = Math.min(100, (timeSec / totalDurationSec) * 100)
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
                if (probeDuration > 0 && probeDuration >= totalDurationSec * 0.5) {
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
    // NOTE: Không throw lại — emitter.error() đã báo lỗi cho UI.
    // Nếu throw thì caller (IPC handler) sẽ catch và gửi thêm 1 error event → duplicate trên UI.
  }
}


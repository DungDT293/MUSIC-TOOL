import { spawn } from 'child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID, randomBytes } from 'node:crypto'
import { app } from 'electron'
import { getFfmpegPaths } from '../ffmpeg/config'
import { probeFile } from '../ffmpeg/probe'
import { validateInputFiles, type InvalidInputFile, type ValidatedInputFile } from './videoUtils'
import { videoJobManager } from './videoJobManager'
import { verifyOutputVideo } from './outputVerification'
import { runPlaybackTest } from './playbackTest'
import { getDiskSpace, formatBytes, assertMinDiskSpace } from '../utils/diskSpace'
import { buildVideoEncoderArgsWithChoice, getGpuInfo } from '../utils/gpuDetection'
import { buildConcatSafeOutputArgs, buildNormalizeCudaHybridVfFilter, buildNormalizeVfFilter, detectEncoderFromArgs, extractFpsFromVfFilter } from './utils/normalizeVf'
import { renderSlideshowClips, type SlideshowRenderOptions } from './slideshowRenderer'
import {
  buildPlaylistToFillDuration,
  shuffleOnce,
  type ClipItem,
} from './utils/videoShuffleHelpers'
import { planVideoBatch, type PlannedVideoJob } from './utils/videoPlaylistPlan'
import { getRecentHistory, type ExportHistoryEntry } from '../music/exportHistory'
import type {
  FinalExportAudioFailure,
  FinalExportDonePayload,
  FinalExportErrorPayload,
  FinalExportProgressPayload,
  FinalExportRequestPayload,
  FinalExportScanResult,
  ChromaKeyOverlay,
  FinalExportVisualizerOptions,
} from '../../shared/videoFinalExportChannels'

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg'])
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.avi', '.wmv', '.webm'])
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'])

interface AudioFileInfo {
  path: string
  durationSec: number
  codecName: string | null
}

interface AudioScanResult {
  files: AudioFileInfo[]
  failures: FinalExportAudioFailure[]
  requestedCount: number
}

function getAudioRecoveryHint(detail: string): string {
  const lower = detail.toLowerCase()
  if (/enoent|no such file|không tìm thấy|không tồn tại/.test(lower)) {
    return 'Cách xử lý: kiểm tra file audio còn tồn tại, kết nối lại ổ mạng nếu cần, rồi quét lại playlist và chạy lại.'
  }
  if (/eacces|eperm|permission denied|access is denied|read-only/.test(lower)) {
    return 'Cách xử lý: đóng ứng dụng đang khóa file, cấp quyền đọc thư mục audio rồi chạy lại.'
  }
  if (/duration|no audio|invalid data|corrupt|decode|probe|ffprobe/.test(lower)) {
    return 'Cách xử lý: mở file audio để kiểm tra; nếu hỏng hoặc thiếu stream audio, xuất lại playlist/đổi file nguồn rồi chạy lại.'
  }
  return 'Cách xử lý: kiểm tra đường dẫn, định dạng và quyền đọc file audio; xuất lại playlist rồi chạy lại final export.'
}

function describeAudioFailure(pathValue: string, stage: FinalExportAudioFailure['stage'], error: unknown, extra = ''): FinalExportAudioFailure {
  const detail = `${describeErrorForLog(error)}${extra ? ` | ${extra}` : ''}`.slice(-1800)
  return {
    path: pathValue,
    stage,
    detail,
    repairHint: getAudioRecoveryHint(detail),
  }
}

interface PreparedVideoClips {
  clips: ValidatedInputFile[]
  invalidDetails?: InvalidInputFile[]
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
  endingAudios?: AudioSourceItem[]
  effectiveAudio?: AudioSourceItem
  outputPath: string
  outputFileName: string
  customOutputName?: string // Tên tùy chỉnh từ outputNames array
  tracklistText?: string // Tracklist text nếu có
  mappedVideo?: VideoClipItem // Tab 6 files mode: audio[i] ghép đúng video[i]
  plannedVideoJob?: PlannedVideoJob
}

export interface ExportPlan {
  jobs: ExportJob[]
  totalJobs: number
  requestedAudioCount: number
  acceptedAudioCount: number
  audioFailures: FinalExportAudioFailure[]
  invalidVideoFiles?: InvalidInputFile[]
  totalAudioDurationSec: number
  totalVideoDurationSec: number
  endingAudioItems?: AudioSourceItem[]
  /** Toàn bộ pool video (không phân loại ưu tiên) */
  videoClips: VideoClipItem[]
  /** Clip video ưu tiên (tùy chọn) – sẽ luôn xuất hiện đầu video trước khi loop các clip còn lại */
  priorityVideoClips?: VideoClipItem[]
  uniqueRequired?: boolean
  /** Physical clip identities reserved by this strict plan. */
  uniqueVideoClipIds?: string[]
}

// ─── Chroma Key Overlay: build FFmpeg filter_complex ───────────────────────────
/**
 * Tạo filter_complex string cho chroma key overlay.
 * Dùng chromakey (YUV) cho phông xanh, colorkey (RGB) cho phông đen.
 *
 * @param overlay - Cấu hình chroma key từ UI
 * @param concatInputIndex - Index của concat input (mặc định 0)
 * @param overlayInputIndex - Index của overlay video input (mặc định 1)
 * @returns filter_complex string
 */
function buildChromaKeyFilterComplex(
  overlay: ChromaKeyOverlay,
  concatInputIndex = 0,
  overlayInputIndex = 1,
): string {
  const filterName = overlay.bgType === 'black' ? 'colorkey' : 'chromakey'
  const hexColor = '0x' + overlay.keyColor.replace('#', '')
  const similarity = Math.max(0.01, Math.min(1.0, overlay.similarity))
  const blend = Math.max(0.0, Math.min(1.0, overlay.blend))

  // Scale overlay nếu cần
  const scaleFilter = overlay.scale !== 1.0
    ? `,scale=iw*${overlay.scale.toFixed(2)}:ih*${overlay.scale.toFixed(2)}:flags=lanczos`
    : ''

  // Position: center hoặc bottom
  const posX = '(W-w)/2'
  const posY = overlay.position === 'bottom' ? '(H-h)' : '(H-h)/2'

  return [
    `[${overlayInputIndex}:v]${filterName}=color=${hexColor}:similarity=${similarity.toFixed(2)}:blend=${blend.toFixed(2)}${scaleFilter}[chromafg]`,
    `[${concatInputIndex}:v][chromafg]overlay=x=${posX}:y=${posY}:shortest=1:eof_action=pass[vout]`,
  ].join(';')
}

function isAudioVisualizerActive(options?: FinalExportVisualizerOptions): boolean {
  return !!(options?.enabled && options.preset)
}

function describeErrorForLog(err: any): string {
  const parts = [err?.message || err?.error || String(err) || 'Lỗi không xác định']
  if (err?.code) parts.push(`code=${err.code}`)
  if (err?.errno) parts.push(`errno=${err.errno}`)
  if (err?.syscall) parts.push(`syscall=${err.syscall}`)
  if (err?.path) parts.push(`path=${err.path}`)
  if (err?.exitCode !== undefined) parts.push(`exitCode=${err.exitCode}`)
  if (err?.cause?.message) parts.push(`cause=${err.cause.message}`)
  return parts.filter(Boolean).join(' | ')
}

function getVideoRecoveryHint(detail: string): string {
  const lower = detail.toLowerCase()
  if (/no such file|enoent|không tìm thấy|không tồn tại/.test(lower)) {
    return 'Cách xử lý: kiểm tra lại đường dẫn/ổ mạng của file nêu trên, kết nối lại ổ nếu cần, rồi quét và chạy lại.'
  }
  if (/eacces|eperm|permission denied|access is denied|read-only/.test(lower)) {
    return 'Cách xử lý: kiểm tra quyền đọc video và quyền ghi thư mục output; đóng ứng dụng đang khóa file rồi chạy lại.'
  }
  if (/enospc|no space|disk full|dung lượng/.test(lower)) {
    return 'Cách xử lý: giải phóng dung lượng ổ chứa thư mục tạm/output, rồi chạy lại job lỗi.'
  }
  if (/corrupt|invalid data|truncated|missing picture|decode|pretranscode|không có stream hình ảnh/.test(lower)) {
    return 'Cách xử lý: mở các video nguồn nêu trên để kiểm tra; thay/xóa file hỏng hoặc Chuẩn hóa video sang MP4/H.264 trong thư mục riêng, quét lại rồi chạy lại.'
  }
  return 'Cách xử lý: kiểm tra các file nguồn và output nêu trên, xem chi tiết kỹ thuật FFmpeg, rồi chạy lại sau khi sửa file/đường dẫn lỗi.'
}

async function diagnoseVideoSourceFiles(
  sourcePaths: readonly string[],
  requestId: string,
): Promise<Array<{ path: string; stage: string; detail: string }>> {
  const uniquePaths = Array.from(new Set(sourcePaths)).filter(Boolean)
  const diagnosisPaths = uniquePaths.slice(0, 64)
  const failures: Array<{ path: string; stage: string; detail: string }> = []
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < diagnosisPaths.length) {
      const index = nextIndex++
      const sourcePath = diagnosisPaths[index]
      if (!sourcePath || videoJobManager.isCancelled(requestId)) return
      await new Promise<void>((resolve) => {
        let settled = false
        let stderr = ''
        const finish = () => {
          if (settled) return
          settled = true
          resolve()
        }
        let child: ReturnType<typeof spawn>
        try {
          child = spawn(
            getFfmpegExecutable(),
            ['-hide_banner', '-loglevel', 'error', '-t', '3', '-i', sourcePath, '-map', '0:v:0', '-f', 'null', '-'],
            { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
          )
        } catch (error) {
          failures.push({
            path: sourcePath,
            stage: 'kiểm tra decode video nguồn',
            detail: error instanceof Error ? error.message : String(error),
          })
          finish()
          return
        }
        const timer = setTimeout(() => {
          try { child.kill('SIGTERM') } catch {}
          failures.push({
            path: sourcePath,
            stage: 'kiểm tra decode video nguồn',
            detail: 'Timeout khi decode thử 3 giây đầu.',
          })
          finish()
        }, 30_000)
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr = `${stderr}${chunk.toString('utf-8')}`.slice(-1200)
        })
        child.on('error', (error) => {
          clearTimeout(timer)
          failures.push({
            path: sourcePath,
            stage: 'kiểm tra decode video nguồn',
            detail: `${error.message}${stderr ? ` | stderr: ${stderr}` : ''}`,
          })
          finish()
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code !== 0) {
            failures.push({
              path: sourcePath,
              stage: 'kiểm tra decode video nguồn',
              detail: `FFmpeg exit code ${code}${stderr ? ` | stderr: ${stderr}` : ''}`,
            })
          }
          finish()
        })
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, Math.max(1, diagnosisPaths.length)) }, () => worker()))
  if (uniquePaths.length > diagnosisPaths.length) {
    failures.push({
      path: `(đã giới hạn chẩn đoán ${diagnosisPaths.length}/${uniquePaths.length} clip)`,
      stage: 'kiểm tra decode video nguồn',
      detail: 'Xem danh sách video nguồn của job để kiểm tra các clip còn lại.',
    })
  }
  return failures
}

function describeVideoJobFailure(opts: {
  error: unknown
  stage: string
  job: ExportJob
  sourcePaths: readonly string[]
}): string {
  const detail = describeErrorForLog(opts.error)
  const sourceLines = opts.sourcePaths.length > 0
    ? opts.sourcePaths.slice(0, 12).map((sourcePath) => `• ${sourcePath}`).join('\n')
    : '• Chưa xác định được clip nguồn trước khi lỗi.'
  const suffix = opts.sourcePaths.length > 12 ? `\n... và ${opts.sourcePaths.length - 12} clip khác.` : ''
  return [
    `Giai đoạn lỗi: ${opts.stage}.`,
    `Audio job: ${opts.job.audio.path}`,
    `Video output: ${opts.job.outputPath}`,
    `Video nguồn cần kiểm tra:\n${sourceLines}${suffix}`,
    `Chi tiết kỹ thuật: ${detail.slice(-1500)}`,
    getVideoRecoveryHint(detail),
  ].join('\n')
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function colorToFfmpegHex(value: string | undefined, fallback: string): string {
  const normalized = (value || fallback).trim()
  const hex = /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.slice(1) : fallback.replace('#', '')
  return `0x${hex}`
}

function buildBarsSpectrumExpressions(options?: FinalExportVisualizerOptions) {
  const widthRatio = clampNumber(options?.widthPercent, 10, 100, 88) / 100
  const heightRatio = clampNumber(options?.heightPercent, 5, 60, 18) / 100
  const margin = Math.round(clampNumber(options?.marginBottomPx, 0, 400, 48))
  const opacity = clampNumber(options?.opacity, 0.1, 1, 0.88)
  const barCount = Math.round(clampNumber(options?.barCount, 32, 1024, 384))
  const sourceWidth = Math.round(clampNumber(barCount * 12, 1920, 4096, 4096))
  const sensitivity = clampNumber(options?.sensitivity, 1, 12, 5)
  const primaryColor = colorToFfmpegHex(options?.primaryColor, '#00d1ff')
  const secondaryColor = colorToFfmpegHex(options?.secondaryColor, '#7c3aed')
  const yExpr = options?.position === 'top'
    ? String(margin)
    : options?.position === 'center'
    ? '(H-h)/2'
    : `H-h-${margin}`

  return {
    barCount,
    sourceWidth,
    sourceHeight: 360,
    widthExpr: `main_w*${widthRatio.toFixed(3)}`,
    heightExpr: `main_h*${heightRatio.toFixed(3)}`,
    opacity: opacity.toFixed(2),
    glowOpacity: (opacity * 0.55).toFixed(2),
    sensitivity: sensitivity.toFixed(2),
    primaryColor,
    secondaryColor,
    colors: `${primaryColor}|${secondaryColor}`,
    yExpr,
  }
}

function buildAudioVisualizerRawFilter(
  inputLabel: string,
  outputLabel: string,
  options?: FinalExportVisualizerOptions,
): string[] {
  const visualizer = buildBarsSpectrumExpressions(options)
  const preset = options?.preset || 'bars-spectrum'

  if (preset === 'bars-spectrum') {
    return [
      `${inputLabel}volume=${visualizer.sensitivity},showfreqs=s=${visualizer.sourceWidth}x${visualizer.sourceHeight}:mode=bar:ascale=log:fscale=log:colors=${visualizer.colors},format=rgba,colorkey=0x000000:0.10:0.05,colorchannelmixer=aa=${visualizer.opacity}[${outputLabel}]`,
    ]
  }

  if (preset === 'neon-waveform') {
    const baseLabel = `${outputLabel}_wavebase`
    const glowLabel = `${outputLabel}_waveglow`
    const sharpLabel = `${outputLabel}_wavesharp`
    const glowOutLabel = `${outputLabel}_waveglow2`
    const sharpOutLabel = `${outputLabel}_wavesharp2`
    return [
      `${inputLabel}volume=${visualizer.sensitivity},showwaves=s=${visualizer.sourceWidth}x${visualizer.sourceHeight}:mode=line:scale=sqrt:colors=${visualizer.primaryColor},format=rgba,colorkey=0x000000:0.08:0.04[${baseLabel}]`,
      `[${baseLabel}]split=2[${glowLabel}][${sharpLabel}]`,
      `[${glowLabel}]gblur=sigma=8,colorchannelmixer=aa=${visualizer.glowOpacity}[${glowOutLabel}]`,
      `[${sharpLabel}]colorchannelmixer=aa=${visualizer.opacity}[${sharpOutLabel}]`,
      `[${glowOutLabel}][${sharpOutLabel}]overlay=shortest=1:eof_action=pass[${outputLabel}]`,
    ]
  }

  const mode = preset === 'mirror-waveform' ? 'cline' : 'line'
  return [
    `${inputLabel}volume=${visualizer.sensitivity},showwaves=s=${visualizer.sourceWidth}x${visualizer.sourceHeight}:mode=${mode}:scale=sqrt:colors=${visualizer.primaryColor},format=rgba,colorkey=0x000000:0.08:0.04,colorchannelmixer=aa=${visualizer.opacity}[${outputLabel}]`,
  ]
}

function buildFinalOverlayFilterComplex(opts: {
  hasChromaKey: boolean
  chromaKeyOverlay?: ChromaKeyOverlay
  audioVisualizer?: FinalExportVisualizerOptions
  audioInputIndex: number
  normalizeAudio: boolean
}): { filterComplex: string; mapsAudioFromFilter: boolean } {
  const { hasChromaKey, chromaKeyOverlay, audioVisualizer, audioInputIndex, normalizeAudio } = opts
  const parts: string[] = []
  let currentVideoLabel = '[0:v]'

  if (hasChromaKey && chromaKeyOverlay) {
    const overlay = chromaKeyOverlay
    const filterName = overlay.bgType === 'black' ? 'colorkey' : 'chromakey'
    const hexColor = '0x' + overlay.keyColor.replace('#', '')
    const similarity = Math.max(0.01, Math.min(1.0, overlay.similarity)).toFixed(2)
    const blend = Math.max(0.0, Math.min(1.0, overlay.blend)).toFixed(2)
    const scaleFilter = overlay.scale !== 1.0
      ? `,scale=iw*${overlay.scale.toFixed(2)}:ih*${overlay.scale.toFixed(2)}:flags=lanczos`
      : ''
    const posX = '(W-w)/2'
    const posY = overlay.position === 'bottom' ? '(H-h)' : '(H-h)/2'

    parts.push(`[1:v]${filterName}=color=${hexColor}:similarity=${similarity}:blend=${blend}${scaleFilter}[chromafg]`)
    parts.push(`${currentVideoLabel}[chromafg]overlay=x=${posX}:y=${posY}:shortest=0:eof_action=pass[vchroma]`)
    currentVideoLabel = '[vchroma]'
  }

  if (isAudioVisualizerActive(audioVisualizer)) {
    const visualizer = buildBarsSpectrumExpressions(audioVisualizer)
    parts.push(`[${audioInputIndex}:a]asplit=2[aoutsrc][aviz]`)
    parts.push(`${currentVideoLabel}null[ref]`)
    parts.push(...buildAudioVisualizerRawFilter('[aviz]', 'vizraw', audioVisualizer))
    parts.push(`[vizraw][ref]scale2ref=w=${visualizer.widthExpr}:h=${visualizer.heightExpr}[viz][refout]`)
    parts.push(`[refout][viz]overlay=x=(W-w)/2:y=${visualizer.yExpr}:shortest=0:eof_action=pass[vout]`)
    parts.push(normalizeAudio ? '[aoutsrc]loudnorm=I=-16:TP=-1.5:LRA=11[aout]' : '[aoutsrc]anull[aout]')
    return { filterComplex: parts.join(';'), mapsAudioFromFilter: true }
  }

  if (hasChromaKey) {
    parts.push(`${currentVideoLabel}null[vout]`)
  }

  return { filterComplex: parts.join(';'), mapsAudioFromFilter: false }
}

/**
 * Generate a single-frame preview of chroma key overlay.
 * Uses FFmpeg to composite overlay video (frame at ~1s) onto background video (frame at ~1s).
 * Returns path to temp PNG file.
 */
export async function generateBarsSpectrumPreview(opts: {
  bgPath: string
  bgKind: 'image' | 'video'
  audioPath: string
  audioVisualizer: FinalExportVisualizerOptions
}): Promise<string> {
  const { ffmpeg } = getFfmpegPaths()
  const tmpDir = path.join(app.getPath('temp'), '93media-bars-spectrum-preview')
  await fsp.mkdir(tmpDir, { recursive: true })
  const outPath = path.join(tmpDir, `visualizer_preview_${Date.now()}.mp4`)
  const visualizer = buildBarsSpectrumExpressions(opts.audioVisualizer)
  const bgInputArgs = opts.bgKind === 'image'
    ? ['-loop', '1', '-i', opts.bgPath]
    : ['-ss', '1', '-i', opts.bgPath]
  const filterComplex = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar=1[base]`,
    ...buildAudioVisualizerRawFilter('[1:a]', 'vizraw', opts.audioVisualizer),
    `[vizraw][base]scale2ref=w=${visualizer.widthExpr}:h=${visualizer.heightExpr}[viz][ref]`,
    `[ref][viz]overlay=x=(W-w)/2:y=${visualizer.yExpr}:shortest=0:eof_action=pass[vout]`,
  ].join(';')

  const args = [
    ...bgInputArgs,
    '-ss', '1',
    '-i', opts.audioPath,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-t', '10',
    '-movflags', '+faststart',
    '-y',
    outPath,
  ]

  return new Promise<string>((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { windowsHide: true })
    const timeout = setTimeout(() => { try { proc.kill() } catch {} }, 60000)
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0 && fs.existsSync(outPath)) {
        resolve(outPath)
      } else {
        fsp.unlink(outPath).catch(() => {})
        reject(new Error(`FFmpeg visualizer preview failed (code=${code}): ${stderr.slice(-500)}`))
      }
    })
    proc.on('error', (err) => {
      clearTimeout(timeout)
      fsp.unlink(outPath).catch(() => {})
      reject(err)
    })
  })
}

export async function generateChromaKeyPreview(opts: {
  bgVideoPath: string
  overlayVideoPath: string
  bgType: 'green' | 'black'
  keyColor: string
  similarity: number
  blend: number
  position: 'center' | 'bottom'
  scale: number
}): Promise<string> {
  const { ffmpeg } = getFfmpegPaths()
  const tmpDir = path.join(app.getPath('temp'), '93media-chromakey-preview')
  await fsp.mkdir(tmpDir, { recursive: true })
  const outPath = path.join(tmpDir, `preview_${Date.now()}.png`)

  const overlay: ChromaKeyOverlay = {
    enabled: true,
    videoPath: opts.overlayVideoPath,
    bgType: opts.bgType,
    keyColor: opts.keyColor,
    similarity: opts.similarity,
    blend: opts.blend,
    position: opts.position,
    scale: opts.scale,
  }

  const filterComplex = buildChromaKeyFilterComplex(overlay, 0, 1)

  const args = [
    '-ss', '1',
    '-i', opts.bgVideoPath,
    '-ss', '1',
    '-i', opts.overlayVideoPath,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-frames:v', '1',
    '-update', '1',
    '-y',
    outPath,
  ]

  return new Promise<string>((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { windowsHide: true })
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        resolve(outPath)
      } else {
        reject(new Error(`FFmpeg preview failed (code=${code}): ${stderr.slice(-500)}`))
      }
    })
    proc.on('error', (err) => reject(err))
    // Timeout 15s
    setTimeout(() => { try { proc.kill() } catch {} }, 15000)
  })
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

async function loadAudioFiles(source: FinalExportRequestPayload['audioSource']): Promise<AudioScanResult> {
  const audioFiles: AudioFileInfo[] = []
  const failures: FinalExportAudioFailure[] = []

  const collectFromPaths = async (paths: string[]) => {
    for (const filePath of paths) {
      try {
        await ensurePathKind(filePath, 'file')
      } catch (error) {
        const failure = describeAudioFailure(filePath, 'validate-path', error)
        failures.push(failure)
        console.error(`[FinalExport][Audio rejected][validate-path] ${filePath}\n${failure.detail}\n${failure.repairHint}`)
        continue
      }
      try {
        const info = await probeFile(filePath)
        const duration = info?.format?.duration ?? 0
        const codecName = info?.audio?.codec ?? null
        if (!duration || duration <= 0) {
          const failure = describeAudioFailure(filePath, 'duration', new Error('Audio duration <= 0'), `observedDurationSec=${duration}`)
          failure.durationSec = duration
          failure.codecName = codecName
          failures.push(failure)
          console.error(`[FinalExport][Audio rejected][duration] ${filePath}\n${failure.detail}\n${failure.repairHint}`)
          continue
        }
        audioFiles.push({ path: filePath, durationSec: duration, codecName })
      } catch (error) {
        const failure = describeAudioFailure(filePath, 'probe', error)
        failures.push(failure)
        console.error(`[FinalExport][Audio rejected][probe] ${filePath}\n${failure.detail}\n${failure.repairHint}`)
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
    const paths: string[] = []
    const scanAudioRecursively = async (dir: string) => {
      try {
        const entries = await fsp.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            await scanAudioRecursively(fullPath)
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase()
            if (AUDIO_EXTS.has(ext)) {
              paths.push(fullPath)
            }
          }
        }
      } catch (err) {
        console.warn(`[FinalExport] Bỏ qua thư mục con audio không đọc được: ${dir}`, err)
      }
    }
    await scanAudioRecursively(source.path)
    await collectFromPaths(Array.from(new Set(paths)))
  } else {
    throw new Error('Loại nguồn audio không được hỗ trợ.')
  }

  if (audioFiles.length === 0) {
    const detail = failures.length > 0
      ? failures.slice(0, 12).map((failure) => `• ${failure.path} | ${failure.stage} | ${failure.detail}\n  ${failure.repairHint}`).join('\n')
      : 'Không có file audio hợp lệ.'
    throw new Error(`Không tìm thấy file audio hợp lệ.\n${detail}`)
  }

  if (source.type === 'folder') {
    audioFiles.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
  }
  return { files: audioFiles, failures, requestedCount: audioFiles.length + failures.length }
}

function formatInvalidVideoDetails(details: InvalidInputFile[]): string {
  const sample = details.slice(0, 12).map((item, index) => `${index + 1}. ${item.path}\n   Lỗi: ${item.reason}`).join('\n')
  const suffix = details.length > 12 ? `\n... và ${details.length - 12} video khác.` : ''
  return [
    'Nguyên nhân: Một hoặc nhiều video nguồn không đọc được hoặc không có stream hình ảnh hợp lệ.',
    `Video lỗi:\n${sample}${suffix}`,
    'Cách xử lý: mở từng đường dẫn trên bằng trình phát video; thay/xóa file hỏng, hoặc chuẩn hóa video sang MP4/H.264 trước khi chạy lại. Nếu đường dẫn nằm trên ổ mạng, kết nối lại ổ rồi quét lại.',
  ].join('\n')
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
    const scanFolderRecursively = async (dir: string) => {
      try {
        const entries = await fsp.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            await scanFolderRecursively(fullPath)
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase()
            if (VIDEO_EXTS.has(ext)) {
              videoPaths.push(fullPath)
            }
          }
        }
      } catch (err) {
        console.warn(`[FinalExport] Bỏ qua thư mục con không đọc được: ${dir}`, err)
      }
    }
    await scanFolderRecursively(source.path)
    videoPaths = Array.from(new Set(videoPaths))
  } else {
    throw new Error('Loại nguồn video không được hỗ trợ.')
  }

  if (videoPaths.length === 0) {
    throw new Error('Không tìm thấy clip video hợp lệ.')
  }

  const { valid, invalidDetails } = await validateInputFiles(videoPaths, 8)
  if (invalidDetails.length > 0) {
    console.warn(
      `[FinalExport] Phát hiện ${invalidDetails.length} video lỗi/hỏng; tự động bỏ qua và bù đắp bằng các video hợp lệ:\n` +
      invalidDetails.slice(0, 10).map((item, idx) => `  ${idx + 1}. ${item.path} — ${item.reason}`).join('\n') +
      (invalidDetails.length > 10 ? `\n  ... và ${invalidDetails.length - 10} video khác.` : '')
    )
  }
  if (valid.length === 0) {
    throw new Error(
      invalidDetails.length > 0
        ? formatInvalidVideoDetails(invalidDetails)
        : 'Không tìm thấy clip video hợp lệ. Cách xử lý: kiểm tra thư mục video, quyền đọc và định dạng file rồi quét lại.',
    )
  }

  if (source.type === 'files') {
    // Probes finish concurrently; restore caller order so Autopilot pool order reaches concat.
    const byPath = new Map(valid.map((clip) => [clip.path, clip]))
    return {
      clips: videoPaths.map((filePath) => byPath.get(filePath)).filter((clip): clip is ValidatedInputFile => !!clip),
      invalidDetails,
    }
  }
  valid.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
  return { clips: valid, invalidDetails }
}

async function loadImageFiles(source: FinalExportRequestPayload['imageSource']): Promise<{ path: string; width: number | null; height: number | null }[]> {
  if (!source) return []
  let imagePaths: string[] = []

  if (source.type === 'file') {
    imagePaths = [source.path]
  } else if (source.type === 'files') {
    const list = source.paths && source.paths.length > 0 ? source.paths : [source.path]
    imagePaths = Array.from(new Set(list))
  } else if (source.type === 'folder') {
    await ensurePathKind(source.path, 'dir')
    const entries = await fsp.readdir(source.path, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!IMAGE_EXTS.has(ext)) continue
      imagePaths.push(path.join(source.path, entry.name))
    }
    imagePaths = Array.from(new Set(imagePaths))
  } else {
    throw new Error('Loại nguồn ảnh không được hỗ trợ.')
  }

  // Probe dimensions via ffprobe (image streams)
  const results: { path: string; width: number | null; height: number | null }[] = []
  for (const p of imagePaths) {
    try {
      const info = await probeFile(p)
      const stream = info?.streams?.find((s: any) => s.codec_type === 'video' || s.codec_type === 'image')
      results.push({
        path: p,
        width: stream?.width ?? null,
        height: stream?.height ?? null,
      })
    } catch (e) {
      console.warn('[FinalExport] Bỏ qua ảnh lỗi probe:', p, e)
    }
  }
  return results
}

// PHASE 4: Planning helper functions

/**
 * Scan audio source và trả về AudioSourceItem[]
 * Support: file, folder, hoặc array paths
 */
async function scanAudioSourceForPlan(
  audioSource: FinalExportRequestPayload['audioSource']
): Promise<AudioScanResult & { items: AudioSourceItem[] }> {
  const result = await loadAudioFiles(audioSource)
  return {
    ...result,
    items: result.files.map(f => ({
      path: f.path,
      durationSec: f.durationSec,
      codecName: f.codecName,  // FIX PERF-1: Propagate codec đã probe — tránh probe lại
    })),
  }
}

/**
 * Scan image source và trả về ImageSourceItem[] (dimensions + synthetic duration)
 * Support: file, folder, hoặc array paths
 */
export interface ImageSourceItem {
  path: string
  width: number | null
  height: number | null
  durationSec: number // synthetic, computed by caller (default per-image seconds)
}

async function scanImageSourceForPlan(
  imageSource: FinalExportRequestPayload['imageSource']
): Promise<ImageSourceItem[]> {
  if (!imageSource) return []
  const files = await loadImageFiles(imageSource)
  // durationSec will be filled later by caller using per-image duration setting
  return files.map(f => ({
    path: f.path,
    width: f.width ?? null,
    height: f.height ?? null,
    durationSec: 0, // placeholder; UI/backend will override with actual per-image duration
  }))
}

/**
 * Scan video source và trả về VideoClipItem[] cùng danh sách file lỗi
 * Support: file, folder, hoặc array paths
 */
async function scanVideoSourceForPlan(
  videoSource: FinalExportRequestPayload['videoSource']
): Promise<{ clips: VideoClipItem[]; invalidDetails: InvalidInputFile[] }> {
  const videoClips = await loadVideoClips(videoSource)
  return {
    clips: videoClips.clips.map(c => ({
      path: c.path,
      durationSec: c.durationSec,
      sizeBytes: typeof c.sizeBytes === 'number' ? c.sizeBytes : null,
      width: typeof c.width === 'number' ? c.width : null,
      height: typeof c.height === 'number' ? c.height : null,
    })),
    invalidDetails: videoClips.invalidDetails ?? [],
  }
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
  priorityVideoSource?: FinalExportRequestPayload['priorityVideoSource'],
  imageSource?: FinalExportRequestPayload['imageSource'],
  endingAudio?: FinalExportRequestPayload['endingAudio'],
  uniqueRequired: boolean = false,
  reservedVideoClipIds?: ReadonlySet<string>,
  existingSequenceFingerprints?: ReadonlySet<string>,
  requestId?: string,
): Promise<ExportPlan> {
  if (requestId && videoJobManager.isCancelled(requestId)) {
    throw new Error('Đã dừng bởi người dùng')
  }
  // Medium: Validate output folder writable
  try {
    await fsp.mkdir(outputFolder, { recursive: true })
    await fsp.access(outputFolder, fs.constants.W_OK)
  } catch (err: any) {
    throw new Error(`Không ghi được vào thư mục output: ${outputFolder}. Lỗi: ${err?.message || err}`)
  }

  // 1. Scan audio (probe 1 lần)
  const audioScan = await scanAudioSourceForPlan(audioSource)
  if (requestId && videoJobManager.isCancelled(requestId)) {
    throw new Error('Đã dừng bởi người dùng')
  }
  const audioItems = audioScan.items

  if (audioItems.length === 0) {
    throw new Error('Không có file audio hợp lệ.')
  }
  
  // 2. Scan video (probe 1 lần). Slideshow mode may omit videoSource.
  const scannedVideo = videoSource
    ? await scanVideoSourceForPlan(videoSource)
    : { clips: [], invalidDetails: [] }
  const videoClips: VideoClipItem[] = scannedVideo.clips
  const invalidVideoFiles: InvalidInputFile[] = [...scannedVideo.invalidDetails]
  if (requestId && videoJobManager.isCancelled(requestId)) {
    throw new Error('Đã dừng bởi người dùng')
  }
  let priorityVideoClips: VideoClipItem[] | undefined
  if (priorityVideoSource) {
    try {
      const scannedPriority = await scanVideoSourceForPlan(priorityVideoSource)
      priorityVideoClips = scannedPriority.clips
      if (scannedPriority.invalidDetails.length > 0) {
        invalidVideoFiles.push(...scannedPriority.invalidDetails)
      }
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
  
  if (videoClips.length === 0 && !imageSource) {
    throw new Error('Không có clip video hợp lệ.')
  }

  const endingAudioItems: AudioSourceItem[] = endingAudio?.paths?.length
    ? (await scanAudioSourceForPlan({ type: 'files', path: endingAudio.paths[0] || '', paths: endingAudio.paths })).items
    : []

  // Tab 6 strict mapping: khi user chọn danh sách video files, phải ghép audio[i] -> video[i].
  // Chỉ áp dụng cho files mode CÓ strictPairing (mặc định true cho Tab 6 manual).
  // Autopilot pool mode gửi strictPairing: false → skip guard, dùng random/LRU pick.
  const strictFilesVideoPairing =
    !!videoSource && videoSource.type === 'files' && videoSource.strictPairing !== false

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
      endingAudios: endingAudioItems,
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

  const sourcePathKeys = new Set<string>([
    ...audioItems.map((item) => path.resolve(item.path).toLowerCase()),
    ...videoClips.map((clip) => path.resolve(clip.path).toLowerCase()),
    ...(priorityVideoClips ?? []).map((clip) => path.resolve(clip.path).toLowerCase()),
    ...endingAudioItems.map((item) => path.resolve(item.path).toLowerCase()),
  ])
  for (const job of jobs) {
    const outputKey = path.resolve(job.outputPath).toLowerCase()
    if (sourcePathKeys.has(outputKey)) {
      throw new Error(`Output trùng file nguồn, từ chối xuất để tránh ghi đè/xóa file gốc: ${job.outputPath}`)
    }
    try {
      await fsp.access(job.outputPath, fs.constants.F_OK)
      throw new Error(`File output đã tồn tại, không ghi đè: ${job.outputPath}`)
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  // 4. Calculate totals
  const endingDurationPerJobSec = endingAudioItems.reduce((sum, a) => sum + a.durationSec, 0)
  const totalAudioDurationSec = audioItems.reduce((sum, a) => sum + a.durationSec + endingDurationPerJobSec, 0)
  const totalVideoDurationSec = videoClips.reduce((sum, v) => sum + v.durationSec, 0)

  if (!strictFilesVideoPairing && (uniqueRequired || existingSequenceFingerprints)) {
    if (videoClips.length === 0) {
      throw new Error('Chế độ unique sequence không hỗ trợ slideshow vì không có clip video vật lý để cấp phát.')
    }

    const sourceClips = [...(priorityVideoClips ?? []), ...videoClips]
    const plannerClips = (await Promise.all(sourceClips.map(async (clip) => {
      let canonicalPath: string
      try {
        canonicalPath = await fsp.realpath(clip.path)
      } catch (error: any) {
        throw new Error(`Không thể xác nhận clip unique: ${clip.path}. ${error?.message || error}`)
      }
      return {
        id: createHash('md5').update(canonicalPath.replace(/\\/g, '/').toLowerCase()).digest('hex').slice(0, 12),
        path: clip.path,
        durationSec: clip.durationSec,
      }
    }))).filter((clip) => !uniqueRequired || !reservedVideoClipIds?.has(clip.id))
    const planned = planVideoBatch({
      jobs: jobs.map((job) => ({
        jobIndex: job.jobIndex,
        targetDurationSec: job.audio.durationSec + endingDurationPerJobSec,
      })),
      clips: plannerClips,
      uniqueRequired,
      requireUniqueSequences: !uniqueRequired && !!existingSequenceFingerprints,
      existingFingerprints: existingSequenceFingerprints,
      seed: Date.now() ^ randomBytes(4).readUInt32BE(0),
    })
    const jobsByIndex = new Map(jobs.map((job) => [job.jobIndex, job]))
    for (const plannedJob of planned.jobs) {
      const job = jobsByIndex.get(plannedJob.jobIndex)
      if (!job) throw new Error(`Video batch plan trả về job không tồn tại: ${plannedJob.jobIndex}`)
      job.plannedVideoJob = plannedJob
    }
  }

  if (audioScan.failures.length > 0) {
    console.warn(
      `[FinalExport] Audio plan: requested=${audioScan.requestedCount}, accepted=${audioItems.length}, rejected=${audioScan.failures.length}`,
    )
    for (const failure of audioScan.failures.slice(0, 20)) {
      console.warn(`[FinalExport] Rejected audio: ${failure.path} | stage=${failure.stage} | ${failure.detail} | ${failure.repairHint}`)
    }
  } else {
    console.log(`[FinalExport] Audio plan: requested=${audioScan.requestedCount}, accepted=${audioItems.length}, rejected=0`)
  }

  return {
    jobs,
    totalJobs: jobs.length,
    requestedAudioCount: audioScan.requestedCount,
    acceptedAudioCount: audioItems.length,
    audioFailures: audioScan.failures,
    invalidVideoFiles,
    totalAudioDurationSec,
    totalVideoDurationSec,
    endingAudioItems,
    videoClips,
    priorityVideoClips,
    uniqueRequired,
    uniqueVideoClipIds: uniqueRequired
      ? jobs.flatMap((job) => job.plannedVideoJob?.clips.map((clip) => clip.id) ?? [])
      : undefined,
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

async function prepareJobAudioWithEnding(
  job: ExportJob,
  jobScratchDir: string,
  requestId: string,
): Promise<AudioSourceItem> {
  const endingAudios = job.endingAudios ?? []
  if (endingAudios.length === 0) {
    job.effectiveAudio = job.audio
    return job.audio
  }

  if (videoJobManager.isCancelled(requestId)) {
    throw new Error('Đã dừng bởi người dùng')
  }

  const inputs = [job.audio, ...endingAudios]
  const outputPath = path.join(jobScratchDir, 'audio_with_ending.m4a')
  const filter = [
    ...inputs.map((_, index) => `[${index}:a:0]asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${index}]`),
    `${inputs.map((_, index) => `[a${index}]`).join('')}concat=n=${inputs.length}:v=0:a=1[aout]`,
  ].join(';')
  const args = [
    '-hide_banner', '-y', '-loglevel', 'error', '-stats',
    ...inputs.flatMap((audio) => ['-i', audio.path]),
    '-filter_complex', filter,
    '-map', '[aout]',
    '-vn',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-ac', '2',
    '-movflags', '+faststart',
    outputPath,
  ]
  const ffmpegPath = getFfmpegExecutable()
  const childRequestId = `${requestId}-ending-audio-${job.jobIndex}`
  const totalDurationSec = inputs.reduce((sum, audio) => sum + audio.durationSec, 0)

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let stderrTail = ''
    const safeResolve = () => { if (!settled) { settled = true; resolve() } }
    const safeReject = (err: Error) => { if (!settled) { settled = true; reject(err) } }
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    // Register under parent requestId too, so UI/jobQueue cancel kills this prepare-phase FFmpeg immediately.
    videoJobManager.registerJob(requestId, child)
    videoJobManager.registerJob(childRequestId, child)
    child.stdout?.resume()

    const cleanupChildJob = () => videoJobManager.clearCancelled(childRequestId)

    child.stderr?.on('data', (chunk: Buffer) => {
      if (videoJobManager.isCancelled(requestId) || videoJobManager.isCancelled(childRequestId)) {
        if (!child.killed) child.kill(process.platform === 'win32' ? 'SIGKILL' : 'SIGTERM')
        return
      }
      stderrTail += chunk.toString('utf-8')
      if (stderrTail.length > 12000) stderrTail = stderrTail.slice(-12000)
    })

    child.on('error', (err) => {
      cleanupChildJob()
      safeReject(new Error(`FFmpeg ending audio spawn error: ${err.message}`))
    })
    child.on('close', (code) => {
      cleanupChildJob()
      if (videoJobManager.isCancelled(requestId) || videoJobManager.isCancelled(childRequestId)) {
        safeReject(new Error('Đã dừng bởi người dùng'))
        return
      }
      if (code === 0 && fs.existsSync(outputPath)) {
        safeResolve()
        return
      }
      safeReject(new Error(`Ghép nhạc cuối thất bại (code=${code}). stderr:\n${stderrTail.slice(-1000)}`))
    })
  })

  job.effectiveAudio = {
    path: outputPath,
    durationSec: totalDurationSec,
    codecName: 'aac',
  }
  return job.effectiveAudio
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
  useGpuEncoding?: 'gpu' | 'cpu' | 'auto',
  deleteSourceFiles: boolean = false,
  unifyFormat: boolean = false,
  targetResolution?: string,
  targetFps?: string,
  preferredPreTranscodeMode: PreTranscodeMode = 'software',
  chromaKeyOverlay?: ChromaKeyOverlay,
  // Slideshow mode (pure images + music)
  imageSource?: FinalExportRequestPayload['imageSource'],
  perImageDurationSec?: number,
  imageAspectMode?: 'letterbox' | 'crop-fill' | 'blur-background',
  imageTransition?: string,
  imageKenBurns?: boolean,
  imageShuffle?: boolean,
  audioVisualizer?: FinalExportVisualizerOptions,
): Promise<FinalExportDonePayload> {
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

  // FIX PERF-12: Share pre-transcode cache across all jobs.
  // Declared OUTSIDE try block — finally needs to reference it for cleanup,
  // and `const` inside `try {}` is not visible in `finally {}` (ReferenceError).
  const sharedTranscodedClipCache = new Map<string, string>()

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

    // ========== SLIDESHOW RENDERING ==========
    // Nếu có imageSource và chưa có videoClips → render ảnh thành clip video tạm
    let slideshowClips: ClipItem[] = []
    if ((imageSource && baseClips.length === 0) || (plan.videoClips.length === 0 && imageSource)) {
      const dur = typeof perImageDurationSec === 'number' && perImageDurationSec > 0 ? perImageDurationSec : 5
      const aspect = imageAspectMode || 'letterbox'
      const ken = !!imageKenBurns
      const transition = imageTransition || 'none'

      // Lấy danh sách ảnh từ imageSource (đã scan ở plan phase nếu cần)
      // Hiện tại imageItems chưa có trong ExportPlan → chúng ta scan lại ở đây (đơn giản)
      const scanned = await scanImageSourceForPlan(imageSource)
      const imagesForRender = scanned.map(i => ({
        path: i.path,
        durationSec: dur,
        width: i.width,
        height: i.height,
      }))

      if (imagesForRender.length > 0) {
        const tempSlideshowDir = path.join(tempDir, 'slideshow-clips')
        const rendered = await renderSlideshowClips({
          images: imagesForRender,
          targetResolution: targetResolution || '1920x1080',
          targetFps: targetFps || '30',
          transition: transition !== 'none' ? transition : undefined,
          transitionDurationSec: 0.5,
          kenBurns: ken,
          aspectMode: aspect,
          tempDir: tempSlideshowDir,
          requestId,
          onProgress: (completed, total) => {
            emitter.progress({
              requestId,
              stage: 'prepare-video',
              percent: total > 0 ? Math.min(99, (completed / total) * 100) : 0,
              timeSec: 0,
              totalDurationSec: 0,
              status: `Đang render slideshow ảnh ${completed}/${total}...`,
            })
          },
        })

        slideshowClips = rendered.map(r => ({
          path: r.path,
          durationSec: r.durationSec,
          id: r.path,
        }))

        console.log(`[FinalExport] Slideshow rendered ${slideshowClips.length} clips`)
      }
    }

    // Nếu có slideshow clips → dùng chúng thay vì baseClips trống
    const effectiveBaseClips: ClipItem[] = slideshowClips.length > 0 ? slideshowClips : baseClips
    const effectivePriorityClips: ClipItem[] = slideshowClips.length > 0 ? [] : priorityClips

    const canMapOneToOne = !shuffle && effectiveBaseClips.length >= plan.jobs.length
    if (canMapOneToOne) {
      console.log('[FinalExport] Enough videos for 1:1 mapping without shuffle.')
    }

    const quarantinedClipPaths = new Set<string>()
    const usedVideoSourcePathsBySucceededJob = new Map<number, string[]>()
    const usedVideoClipIdsBySucceededJob = new Map<number, string[]>()
    const jobDiagnostics = new Map<number, { stage: string; sourcePaths: string[]; failureDetails: Array<{ path: string; stage: string; detail: string }> }>()

    // Run jobs sequentially to keep progress stable and deterministic
    const processJob = async (job: ExportJob): Promise<void> => {
      const diagnostics = {
        stage: 'chuẩn bị audio',
        sourcePaths: [] as string[],
        failureDetails: [] as Array<{ path: string; stage: string; detail: string }>,
      }
      jobDiagnostics.set(job.jobIndex, diagnostics)
      // Kiểm tra cancel trước khi bắt đầu job
      if (videoJobManager.isCancelled(requestId)) {
        throw new Error('Đã dừng bởi người dùng')
      }
      
      // Dùng job.jobIndex (index cố định) thay vì thứ tự chạy để đảm bảo mapping 1-1 đúng
      const jobIndex = job.jobIndex
      const currentJobIndex = jobIndex + 1
      
      console.log(`[Job ${currentJobIndex}/${plan.totalJobs}] ${job.outputFileName}`)

      const jobScratchDir = path.join(tempDir, `job_${String(job.jobIndex + 1).padStart(2, '0')}`)
      await fsp.mkdir(jobScratchDir, { recursive: true })
      const effectiveAudio = await prepareJobAudioWithEnding(job, jobScratchDir, requestId)
      diagnostics.stage = 'chọn video nguồn'

      // Emit progress: prepare-video stage
      emitter.progress({
        requestId,
        stage: 'prepare-video',
        percent: (jobIndex / plan.totalJobs) * 100,
        timeSec: 0,
        totalDurationSec: effectiveAudio.durationSec,
        currentIndex: currentJobIndex,
        totalOutputs: plan.totalJobs,
        currentAudioPath: job.audio.path,
        currentOutputFilename: job.outputFileName,
        status: `Đang chuẩn bị video ${currentJobIndex}/${plan.totalJobs}`,
      })

      // 1. Build video playlist cho job này
      const targetDurationSec = effectiveAudio.durationSec
      const jobBaseClips = filterOutQuarantinedClips(effectiveBaseClips, quarantinedClipPaths)
      const jobPriorityClips = filterOutQuarantinedClips(effectivePriorityClips, quarantinedClipPaths)
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

      if (job.plannedVideoJob) {
        videoPlaylist = job.plannedVideoJob.clips.map((clip) => ({
          path: clip.path,
          durationSec: clip.durationSec,
          id: clip.id,
        }))
        const plannedDuration = videoPlaylist.reduce((sum, clip) => sum + clip.durationSec, 0)
        if (plannedDuration < targetDurationSec) {
          throw new Error(`Video plan không đủ duration cho job ${job.jobIndex + 1}`)
        }
      } else if (strictFilesPairingForJob && mappedClip) {
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
        // Xoay priority theo job để tránh mọi output bắt đầu cùng sequence khi shuffle tắt.
        const priorityOffset = job.jobIndex % jobPriorityClips.length
        const rotatedPriorityClips = priorityOffset === 0
          ? jobPriorityClips
          : [...jobPriorityClips.slice(priorityOffset), ...jobPriorityClips.slice(0, priorityOffset)]
        const priorityEntropy = randomBytes(4).readUInt32BE(0)
        const prioritySeed = Date.now() + job.jobIndex * 1000000 + priorityEntropy
        const priorityPlaylist = buildPlaylistToFillDuration(rotatedPriorityClips, targetDurationSec, shuffle, prioritySeed)
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
                const loopSeed = Date.now() + job.jobIndex * 2000000 + randomBytes(4).readUInt32BE(0)
                const additional = buildPlaylistToFillDuration(remainingNonPriority, stillRemaining, shuffle, loopSeed)
                loopPlaylist.push(...additional)
              }
            } else {
              // Video tương ứng quá dài hoặc không phù hợp → loop từ nonPriorityClips
              const loopSeed = Date.now() + job.jobIndex * 2000000 + randomBytes(4).readUInt32BE(0)
              loopPlaylist = buildPlaylistToFillDuration(jobNonPriorityClips, remainingTarget, shuffle, loopSeed)
            }
          } else {
            // Không map 1-1 hoặc không có nonPriorityClips → loop từ nonPriorityClips (hoặc baseClips nếu không có priority)
            const loopSource = jobNonPriorityClips.length > 0 ? jobNonPriorityClips : jobBaseClips
            const loopSeed = Date.now() + job.jobIndex * 2000000 + randomBytes(4).readUInt32BE(0)
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
        const defaultJobSeed = Date.now() + job.jobIndex * 2000000 + randomBytes(4).readUInt32BE(0)
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
              const fillClips = buildPlaylistToFillDuration(loopSource, remainingTarget, true, defaultJobSeed)
              videoPlaylist.push(...fillClips)
            }
          } else {
            videoPlaylist = buildPlaylistToFillDuration(jobBaseClips, targetDurationSec, shuffle, defaultJobSeed)
          }
        } else {
          videoPlaylist = buildPlaylistToFillDuration(jobBaseClips, targetDurationSec, shuffle, defaultJobSeed)
        }
      }
      
      if (!plan.uniqueRequired && !job.plannedVideoJob && !strictFilesPairingForJob) {
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
      diagnostics.sourcePaths = videoPlaylist.map((clip) => clip.path)
      diagnostics.stage = 'tạo danh sách concat video'
      console.log(
        `[Job ${currentJobIndex}] Video playlist: ${videoPlaylist.length} clips (pool=${jobBaseClips.length}, priority=${jobPriorityClips.length})`
      )

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
      const audioCodec = effectiveAudio.codecName ?? await probeAudioCodec(effectiveAudio.path)
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
      diagnostics.stage = 'FFmpeg ghép/mã hóa video'
      // FIX PERF-12: Dùng shared cache thay vì tạo mới cho mỗi job
      // → clip đã pre-transcode ở job trước sẽ được reuse, không cần encode lại
      const reusableTranscodedClipCache = sharedTranscodedClipCache
      if (isAudioVisualizerActive(audioVisualizer)) {
        const visualizerTwoPassReasons = collectForceReencodeTwoPassReasons(videoPlaylist)
        if (visualizerTwoPassReasons.length > 0) {
          throw new Error(
            `Sóng nhạc hiện chưa hỗ trợ playlist cần normalize/two-pass (${visualizerTwoPassReasons.join(', ')}). ` +
            'Cách xử lý: bật Chuẩn hóa video trước khi xuất rồi tắt sóng nhạc, hoặc dùng các clip cùng độ phân giải/FPS, không lặp clip quá ngắn.'
          )
        }
      }
      const effectiveNormalizeVfFilter = resolveEffectiveNormalizeVfFilter({
        explicitNormalizeVfFilter: normalizeVfFilter,
        clips: videoPlaylist,
        forceReencode,
        jobLabel: `${currentJobIndex}/${plan.totalJobs}`,
      })
      if (isAudioVisualizerActive(audioVisualizer) && effectiveNormalizeVfFilter) {
        throw new Error(
          'Sóng nhạc hiện chưa hỗ trợ chạy chung với Chuẩn hóa video/two-pass trong cùng job. ' +
          'Cách xử lý: tắt Chuẩn hóa video hoặc tắt sóng nhạc; nếu clip bị lệch độ phân giải/FPS, hãy chuẩn hóa clip trước rồi xuất lại với sóng nhạc.'
        )
      }
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

      const stagedOutputPath = path.join(jobScratchDir, `output-${String(job.jobIndex + 1).padStart(2, '0')}.mp4`)
      await runFinalCommand({
        requestId,
        totalDurationSec: effectiveAudio.durationSec,
        videoListPath: videoListFile,
        tempWorkspaceDir: jobScratchDir,
        audioPath: effectiveAudio.path,
        outputPath: stagedOutputPath,
        audioCodec,
        forceReencode,
        normalizeAudio,
        useGpuEncoding,
        normalizeVfFilter: effectiveNormalizeVfFilter,
        gpuHybridNormalizeVfFilter: effectiveGpuHybridNormalizeVfFilter,
        preTranscodeMode: effectiveNormalizeVfFilter ? resolvedPreTranscodeMode : 'software',
        failedVideoSourcePaths: quarantinedClipPaths,
        strictSourcePlan: !!job.plannedVideoJob,
        failureDetails: diagnostics.failureDetails,
        reusableTranscodedClipCache,
        chromaKeyOverlay,
        audioVisualizer,
        // FIX PERF-12: Giữ lại pre-transcoded clips khi có nhiều job để reuse
        skipTempCleanup: plan.totalJobs > 1,
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

      let stagedOutputStat: fs.Stats
      try {
        stagedOutputStat = await fsp.stat(stagedOutputPath)
      } catch {
        throw new Error(`FFmpeg completed but output file was not created: ${job.outputFileName}`)
      }
      if (!stagedOutputStat.isFile() || stagedOutputStat.size <= 0) {
        throw new Error(`FFmpeg produced an empty output file: ${job.outputFileName}`)
      }

      // 5. Verify output (metadata + decode smoke/deep verify) + optional playback test
      diagnostics.stage = 'kiểm tra video output (ffprobe/decode)'
      const shouldRunDeepVerify = forceReencode || needAudioEncode || normalizeAudio || !!normalizeVfFilter || isAudioVisualizerActive(audioVisualizer) || !!job.endingAudios?.length
      emitter.progress({
        requestId,
        stage: 'finishing',
        percent: ((job.jobIndex + 0.5) / plan.totalJobs) * 100,
        timeSec: effectiveAudio.durationSec,
        totalDurationSec: effectiveAudio.durationSec,
        currentIndex: currentJobIndex,
        totalOutputs: plan.totalJobs,
        currentAudioPath: job.audio.path,
        currentOutputFilename: job.outputFileName,
        status: shouldRunDeepVerify
          ? `Đang kiểm tra file xuất ra ${currentJobIndex}/${plan.totalJobs} (ffprobe + decode)...`
          : `Đang smoke-check file xuất ra ${currentJobIndex}/${plan.totalJobs} (copy-stream)...`,
      })

      const verify = await verifyOutputVideo(stagedOutputPath, {
        expectedDurationSec: effectiveAudio.durationSec,
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
        const truncatedSec = effectiveAudio.durationSec - verify.durationSec
        const truncatedNote = truncatedSec > 0 ? `, bị cắt ~${truncatedSec.toFixed(2)}s` : ''
        throw new Error(
          `Output duration mismatch cho ${job.outputFileName}: expected=${effectiveAudio.durationSec.toFixed(2)}s, actual=${verify.durationSec.toFixed(2)}s, diff=${(verify.durationDiffSec ?? 0).toFixed(2)}s${truncatedNote}`
        )
      }

      if (verify.resolutionMismatch) {
        throw new Error(
          `Output resolution mismatch cho ${job.outputFileName}: header=${verify.width}x${verify.height} vs coded=${verify.codedWidth}x${verify.codedHeight}. Container header lệch với stream thật → file structurally hỏng (Pass-2 concat copy lẫn lộn resolution).`
        )
      }

      if (!verify.decodeOk) {
        const sizeMB = verify.fileSizeBytes != null ? (verify.fileSizeBytes / 1024 / 1024).toFixed(1) + 'MB' : 'n/a'
        const stderrSnippet = verify.decodeStderrTail
          ? ` | stderrTail: ${verify.decodeStderrTail.replace(/\s+/g, ' ').slice(-500)}`
          : ''
        throw new Error(
          `Output decode verification failed cho ${job.outputFileName} (size=${sizeMB}, dur=${verify.durationSec.toFixed(2)}s, decodeExitCode=${verify.decodeExitCode ?? 'null'})${stderrSnippet}`
        )
      }

      if (forceReencode) {
        const playback = await runPlaybackTest(stagedOutputPath)
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
            timeSec: effectiveAudio.durationSec,
            totalDurationSec: effectiveAudio.durationSec,
            currentIndex: currentJobIndex,
            totalOutputs: plan.totalJobs,
            currentAudioPath: job.audio.path,
            currentOutputFilename: job.outputFileName,
            status: `⚠️ Playback test thất bại cho ${job.outputFileName} (mpv/VLC), hãy kiểm tra lại file.`,
          })
        }
      }

      await fsp.rm(job.outputPath, { force: true })
      await fsp.rename(stagedOutputPath, job.outputPath)

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
      
      const committedVideoPlaylist = trimPlaylistToDuration(videoPlaylist, targetDurationSec)
      if (job.plannedVideoJob) {
        const plannedIds = job.plannedVideoJob.clips.map((clip) => clip.id)
        const executedIds = committedVideoPlaylist.map((clip) => clip.id)
        if (plannedIds.length !== executedIds.length || plannedIds.some((id, index) => id !== executedIds[index])) {
          throw new Error(`Playlist thực tế lệch video plan ở job ${job.jobIndex + 1}; không commit history.`)
        }
      }
      const committedVideoPaths = committedVideoPlaylist.map((clip) => clip.path)
      usedVideoSourcePathsBySucceededJob.set(job.jobIndex, committedVideoPaths)
      usedVideoClipIdsBySucceededJob.set(
        job.jobIndex,
        await Promise.all(committedVideoPaths.map(async (clipPath) => {
          const canonicalPath = (await fsp.realpath(clipPath)).replace(/\\/g, '/').toLowerCase()
          return createHash('md5').update(canonicalPath).digest('hex').slice(0, 12)
        })),
      )
      console.log(`[Job ${currentJobIndex}/${plan.totalJobs}] ✓ Completed: ${job.outputFileName}`)
    }

    // Chạy tuần tự từng job một (không chạy song song)
    // Wrap mỗi job trong try/catch để 1 job lỗi không chặn các job còn lại
    const failedJobs: NonNullable<FinalExportDonePayload['failedJobs']> = []
    const succeededJobs: ExportJob[] = []

    for (const job of plan.jobs) {
      const jobStartTime = Date.now()
      const jobLabel = `${job.jobIndex + 1}/${plan.totalJobs}`
      console.log(`[FinalExport] ═══ Starting job ${jobLabel}: ${job.outputFileName} ═══`)
      try {
        await processJob(job)
        succeededJobs.push(job)
        const jobElapsed = ((Date.now() - jobStartTime) / 1000).toFixed(1)
        console.log(`[FinalExport] ═══ Job ${jobLabel} SUCCEEDED in ${jobElapsed}s: ${job.outputFileName} ═══`)
      } catch (err: any) {
        if (videoJobManager.isCancelled(requestId)) {
          throw new Error('Đã dừng bởi người dùng')
        }

        const failedStagedOutputPath = path.join(
          tempDir,
          `job_${String(job.jobIndex + 1).padStart(2, '0')}`,
          `output-${String(job.jobIndex + 1).padStart(2, '0')}.mp4`,
        )
        await fsp.rm(failedStagedOutputPath, { force: true }).catch(() => {})

        const diagnostic = jobDiagnostics.get(job.jobIndex) ?? {
          stage: 'không xác định',
          sourcePaths: [],
          failureDetails: [],
        }
        const diagnosedSourceFailures = diagnostic.failureDetails.length === 0
          ? await diagnoseVideoSourceFiles(diagnostic.sourcePaths, requestId)
          : []
        if (videoJobManager.isCancelled(requestId)) {
          throw new Error('Đã dừng bởi người dùng')
        }
        const sourceFailures = [...diagnostic.failureDetails, ...diagnosedSourceFailures]
        const errorWithDiagnostics = sourceFailures.length > 0
          ? new Error([
              describeErrorForLog(err),
              'Nguồn video bị lỗi trong quá trình xử lý:',
              sourceFailures.slice(0, 12).map((failure) => `• ${failure.path} | ${failure.stage} | ${failure.detail}`).join('\n'),
            ].join('\n'))
          : err
        const errorMsg = describeVideoJobFailure({
          error: errorWithDiagnostics,
          stage: diagnostic.stage,
          job,
          sourcePaths: diagnostic.sourcePaths,
        })
        const jobElapsed = ((Date.now() - jobStartTime) / 1000).toFixed(1)
        failedJobs.push({
          jobIndex: job.jobIndex,
          fileName: job.outputFileName,
          error: errorMsg,
          audioFile: job.audio.path,
          outputPath: job.outputPath,
          stage: diagnostic.stage,
          repairHint: getVideoRecoveryHint(describeErrorForLog(errorWithDiagnostics)),
          sourceVideoPaths: diagnostic.sourcePaths,
        })
        console.error(
          `[FinalExport] ═══ Job ${jobLabel} FAILED in ${jobElapsed}s (${job.outputFileName}) | audio=${job.audio.path} | output=${job.outputPath} | ${errorMsg} ═══`
        )
        // Emit progress để UI biết job này lỗi, nhưng không dừng pipeline
        emitter.progress({
          requestId,
          stage: 'finishing',
          percent: ((job.jobIndex + 1) / plan.totalJobs) * 100,
          timeSec: 0,
          totalDurationSec: job.effectiveAudio?.durationSec ?? job.audio.durationSec,
          currentIndex: job.jobIndex + 1,
          totalOutputs: plan.totalJobs,
          currentAudioPath: job.audio.path,
          currentOutputFilename: job.outputFileName,
          status: `❌ Job ${job.jobIndex + 1}/${plan.totalJobs} thất bại: ${errorMsg.slice(0, 120)}. Tiếp tục các job còn lại...`,
        })
      }
    }

    if (videoJobManager.isCancelled(requestId)) {
      throw new Error('Đã dừng bởi người dùng')
    }

    console.log(`[FinalExport] ═══ ALL JOBS COMPLETE: ${succeededJobs.length} succeeded, ${failedJobs.length} failed out of ${plan.totalJobs} ═══`)

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

    if (videoJobManager.isCancelled(requestId)) {
      throw new Error('Đã dừng bởi người dùng')
    }

    const donePayload: FinalExportDonePayload = {
      requestId,
      requestedAudioCount: plan.requestedAudioCount,
      acceptedAudioCount: plan.acceptedAudioCount,
      audioFailures: plan.audioFailures,
      outputs: succeededJobs.map(j => ({
        audioFile: j.audio.path,
        videoFile: j.outputPath,
        durationSec: j.effectiveAudio?.durationSec ?? j.audio.durationSec,
        tracklistFile: tracklistPaths[j.jobIndex],
      })),
      failedJobs: failedJobs.length > 0 ? failedJobs : undefined,
      warnings: tracklistWarnings.length > 0 ? tracklistWarnings : undefined,
      videoSequences: succeededJobs.map((job) => ({
        jobIndex: job.jobIndex,
        videoPaths: usedVideoSourcePathsBySucceededJob.get(job.jobIndex) ?? [],
        clipIds: usedVideoClipIdsBySucceededJob.get(job.jobIndex) ?? [],
      })),
    }
    if (videoJobManager.isCancelled(requestId)) {
      throw new Error('Đã dừng bởi người dùng')
    }
    emitter.done(donePayload)

    // Xóa file audio và video nguồn nếu được yêu cầu
    if (deleteSourceFiles) {
      if (videoJobManager.isCancelled(requestId)) {
        throw new Error('Đã dừng bởi người dùng')
      }
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

    // Tự động xóa tất cả các file hỏng/lỗi (cả audio và video) đã phát hiện trong quá trình scan hoặc render
    // Giúp người dùng hoàn thành công việc sạch sẽ, không bị vướng lỗi cho các lần chạy sau
    const corruptFilesToDelete = new Set<string>()
    if (plan.audioFailures && plan.audioFailures.length > 0) {
      for (const f of plan.audioFailures) {
        if (f?.path) corruptFilesToDelete.add(f.path)
      }
    }
    if (plan.invalidVideoFiles && plan.invalidVideoFiles.length > 0) {
      for (const f of plan.invalidVideoFiles) {
        if (f?.path) corruptFilesToDelete.add(f.path)
      }
    }
    for (const p of quarantinedClipPaths) {
      if (p) corruptFilesToDelete.add(p)
    }

    if (corruptFilesToDelete.size > 0) {
      console.log(`[FinalExport][AutoClean] Phát hiện ${corruptFilesToDelete.size} file hỏng. Tự động xóa khỏi ổ đĩa...`)
      for (const corruptedPath of corruptFilesToDelete) {
        try {
          await fsp.unlink(corruptedPath)
          console.log(`[FinalExport][AutoClean] Đã tự động xóa file lỗi: ${corruptedPath}`)
        } catch (cleanErr: any) {
          if (cleanErr?.code !== 'ENOENT') {
            console.warn(`[FinalExport][AutoClean] Không thể xóa file lỗi ${corruptedPath}:`, cleanErr?.message || cleanErr)
          }
        }
      }
    }

    return donePayload
  } catch (error: any) {
    // NOTE: Không gọi emitter.error() ở đây — hàm gọi (exportFinalVideo) sẽ catch
    // và emit error. Gọi ở cả 2 chỗ gây duplicate error event trên UI.
    throw error
  } finally {
    // FIX PERF-12: Clear shared cache to release memory
    sharedTranscodedClipCache.clear()
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
  /** Strict batch plans fail if a source cannot be preserved. */
  strictSourcePlan?: boolean
  /** Per-source failures retained for user-facing diagnostics. */
  failureDetails?: Array<{ path: string; stage: string; detail: string }>
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

function trimPlaylistToDuration(clips: ClipItem[], targetDurationSec: number): ClipItem[] {
  if (clips.length === 0 || !Number.isFinite(targetDurationSec) || targetDurationSec <= 0) return []
  const result: ClipItem[] = []
  let duration = 0
  for (const clip of clips) {
    result.push(clip)
    duration += Math.max(0, clip.durationSec)
    if (duration >= targetDurationSec) break
  }
  return result
}

/**
 * FIX PERF-15: Tweak encoder args cho pre-transcode intermediate files.
 *
 * ⚠️ LƯU Ý QUAN TRỌNG: Pre-transcoded clips CHÍNH LÀ video stream cuối cùng!
 * Pass 2 chỉ concat copy (-c:v copy) → CRF/CQ của pre-transcode quyết định
 * chất lượng video output cuối cùng. KHÔNG được giảm CRF.
 *
 * Chỉ tweak preset cho CPU path (ultrafast thay vì veryfast):
 * - ultrafast tạo file lớn hơn ~30% nhưng encode nhanh ~40%
 * - Chất lượng visual gần như tương đương tại cùng CRF
 *   (ultrafast chỉ tắt một số tính năng nén nâng cao,
 *   nhưng giữ nguyên CRF target → bitrate tăng bù quality)
 */
function tweakArgsForPreTranscode(args: string[]): string[] {
  const tweaked = [...args]
  for (let i = 0; i < tweaked.length; i++) {
    // CPU: veryfast → ultrafast (40% faster encode, same visual quality at same CRF)
    if (tweaked[i] === '-preset' && tweaked[i + 1] === 'veryfast') {
      tweaked[i + 1] = 'ultrafast'
    }
  }
  return tweaked
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
    strictSourcePlan = false,
    failureDetails,
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

  // FIX PERF-15: Pre-transcode chỉ tạo intermediate files (Pass 2 sẽ copy stream)
  // → KHÔNG cần chất lượng cao → dùng CRF cao hơn + preset nhanh hơn
  // → Encode nhanh hơn ~30-50% + file nhỏ hơn + ít disk I/O
  const primaryEncoder = await buildVideoEncoderArgsWithChoice(true, effectiveEncoderChoice, 'fast')
  const gpuHeavyRequested = preTranscodeMode === 'gpu_heavy' && primaryEncoder.usedEncoder === 'gpu'
  const primaryArgs = tweakArgsForPreTranscode(
    gpuHeavyRequested
      ? buildGpuHeavyPreTranscodeArgs(primaryEncoder.args)
      : sanitizePreTranscodeEncoderArgs(primaryEncoder.args)
  )
  const cpuFallback = primaryEncoder.usedEncoder === 'gpu'
    ? await buildVideoEncoderArgsWithChoice(true, 'cpu', 'fast')
    : null
  const cpuFallbackArgs = tweakArgsForPreTranscode(
    cpuFallback
      ? sanitizePreTranscodeEncoderArgs(cpuFallback.args)
      : sanitizePreTranscodeEncoderArgs(primaryEncoder.args)
  )
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

      // FIX PERF-16: Luôn dùng software vf filter thay vì hybrid CUDA.
      // Hybrid CUDA gây 3 lần CPU↔GPU transfer mỗi frame (hwupload → scale_cuda → hwdownload)
      // → chậm hơn software scale + NVENC encode (chỉ 1 lần transfer cho encode).
      // CPU scale (lanczos) trên modern CPU chỉ ~15ms/frame cho 1080p,
      // trong khi 3x PCIe transfer tốn ~5-10ms × 3 = 15-30ms overhead mỗi frame.
      const selectedVfFilter = vfFilter
      // Pick concat-safe args matching the encoder being used in this attempt
      const concatSafeArgs = mode === 'gpu' ? concatSafeArgsPrimary : concatSafeArgsCpu
      const args =
        source.kind === 'file'
          ? [
              '-hide_banner',
              '-n',
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
              '-n',
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
      videoJobManager.registerJob(requestId, proc)
      videoJobManager.registerJob(childRequestId, proc)

      // Smart timeout: tối thiểu 3 phút, tỉ lệ 15x duration (clip 60s → 15 phút),
      // tối đa 30 phút. Card cũ encode chậm sẽ không bị kill oan.
      const clipDuration = clip.durationSec || 10
      const clipTimeoutMs = Math.max(3 * 60 * 1000, Math.min(30 * 60 * 1000, clipDuration * 15 * 1000))
      const clipTimer = setTimeout(() => {
        if (!proc.killed) {
          console.warn(
            `[PreTranscode] Clip ${index + 1}/${clips.length} (${mode}) timed out after ${Math.round(clipTimeoutMs / 1000)}s (clip duration=${clipDuration.toFixed(1)}s), killing...`
          )
          proc.kill('SIGTERM')
          setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 2000)
          const detail = stderrTail.trim() ? `\nstderr:\n${stderrTail.trim()}` : ''
          safeReject(
            new Error(
              `[PreTranscode] Clip ${index + 1}/${clips.length} timed out after ${Math.round(clipTimeoutMs / 60000)} phút: ${path.basename(clip.path)}${detail}`
            )
          )
        }
      }, clipTimeoutMs)

      // GPU speed watchdog: nếu sau 90s encode, speed vẫn < 0.2x → GPU đang treo/quá chậm
      // → kill ngay và reject để fallback CPU, không phải chờ hết timeout
      let speedWatchdogTimer: ReturnType<typeof setTimeout> | null = null
      let latestSpeedSample = 0
      let speedSampleCount = 0
      if (mode === 'gpu') {
        speedWatchdogTimer = setTimeout(() => {
          // Chỉ can thiệp nếu đã có speed sample và speed quá thấp
          if (speedSampleCount > 0 && latestSpeedSample < 0.2 && !proc.killed) {
            console.warn(
              `[PreTranscode] GPU speed watchdog: clip ${index + 1}/${clips.length} speed=${latestSpeedSample.toFixed(2)}x after 90s — killing for CPU fallback`
            )
            proc.kill('SIGTERM')
            setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 2000)
            safeReject(
              new Error(
                `[PreTranscode] GPU quá chậm (speed=${latestSpeedSample.toFixed(2)}x) cho ${path.basename(clip.path)} — fallback CPU`
              )
            )
          } else if (speedSampleCount === 0 && !proc.killed && !settled) {
            // 90s không nhận được speed nào → FFmpeg có thể đang treo ở bước init/decode
            console.warn(
              `[PreTranscode] GPU speed watchdog: clip ${index + 1}/${clips.length} no speed output after 90s — killing for CPU fallback`
            )
            proc.kill('SIGTERM')
            setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL') }, 2000)
            safeReject(
              new Error(
                `[PreTranscode] GPU không phản hồi sau 90s cho ${path.basename(clip.path)} — fallback CPU`
              )
            )
          }
        }, 90_000)
      }

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
            latestSpeedSample = speed
            speedSampleCount++
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
        if (speedWatchdogTimer) clearTimeout(speedWatchdogTimer)
        const detail = stderrTail.trim() ? `\nstderr:\n${stderrTail.trim()}` : ''
        safeReject(
          new Error(
            `[PreTranscode] Spawn error (${mode}) for ${path.basename(clip.path)}: ${err.message}${detail}`
          )
        )
      })

      proc.on('close', (code) => {
        clearTimeout(clipTimer)
        if (speedWatchdogTimer) clearTimeout(speedWatchdogTimer)
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

  // FIX PERF-14: Parallel pre-transcode — chạy tối đa CONCURRENCY FFmpeg cùng lúc
  // NVENC có thể handle 2-3 encode sessions đồng thời trên cùng GPU.
  // Parallel tăng throughput ~1.5-2x so với tuần tự.
  // FIX SLOW-GPU: Start GPU at concurrency 1 to measure speed first.
  // If first clip encodes fast (>= 2x speed) → bump to 2. Card cũ stays at 1 to avoid thrashing.
  let CONCURRENCY = primaryEncoder.usedEncoder === 'gpu' ? 1 : Math.min(2, Math.max(1, Math.floor(os.cpus().length / 2)))
  let gpuSpeedMeasured = false
  console.log(`[PreTranscode] Initial concurrency: ${CONCURRENCY} (encoder=${primaryEncoder.usedEncoder})`)

  // Pre-allocate slots để giữ đúng thứ tự (Pass 2 concat theo index)
  type SlotResult = { outputFile: string; durationSec: number } | null
  const slotResults: SlotResult[] = new Array(clips.length).fill(null)
  let hasAnySlotResult = false

  // Semaphore-based parallel processing
  let nextIndex = 0
  const processClip = async (): Promise<void> => {
    while (true) {
      // Grab next index atomically (JS is single-threaded, no race)
      const i = nextIndex++
      if (i >= clips.length) return
      if (usableDurationSec >= minimumDurationSec && hasAnySlotResult) return
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
        slotResults[i] = { outputFile: cachedOutput, durationSec: clip.durationSec }
        hasAnySlotResult = true
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
        slotResults[i] = { outputFile, durationSec: clip.durationSec }
        hasAnySlotResult = true
        reusableTranscodedClipCache.set(clip.path, outputFile)
        usableDurationSec += Math.max(clip.durationSec, 0)

        // Adaptive concurrency: sau clip GPU đầu tiên thành công, nếu speed >= 2x
        // → card đủ nhanh, bump concurrency lên 2 (sẽ apply ở lần launch workers tiếp)
        if (primaryMode === 'gpu' && !gpuSpeedMeasured) {
          gpuSpeedMeasured = true
          if (lastSpeedX >= 2) {
            CONCURRENCY = 2
            console.log(`[PreTranscode] GPU speed OK (${lastSpeedX.toFixed(1)}x) — bumping concurrency to 2`)
          } else {
            console.log(`[PreTranscode] GPU speed slow (${lastSpeedX.toFixed(1)}x) — keeping concurrency at 1 to avoid thrashing`)
          }
        }
      } catch (primaryErr: any) {
        if (videoJobManager.isCancelled(requestId)) {
          throw primaryErr
        }

        const primaryMessage = primaryErr?.message || String(primaryErr)
        failureDetails?.push({
          path: clip.path,
          stage: `pre-transcode ${primaryMode.toUpperCase()}`,
          detail: primaryMessage.slice(-1200),
        })
        let recovered = false

        if (primaryMode === 'gpu') {
          console.warn(
            `[PreTranscode] GPU ${gpuHeavyRequested ? 'hybrid normalize ' : ''}failed for clip ${i + 1}/${clips.length} (${path.basename(clip.path)}). Retrying on CPU software normalize.\n${primaryMessage}`
          )
          cleanupPreTranscodeOutput(outputFile)
          try {
            await runAttempt(clip, i, 'cpu', defaultFfmpegPath, cpuFallbackArgs, outputFile, { kind: 'file', path: clip.path })
            slotResults[i] = { outputFile, durationSec: clip.durationSec }
            hasAnySlotResult = true
            reusableTranscodedClipCache.set(clip.path, outputFile)
            usableDurationSec += Math.max(clip.durationSec, 0)
            gpuDisabledForRemainingClips = true
            recovered = true
            console.warn(
              `[PreTranscode] CPU retry succeeded for ${path.basename(clip.path)}. GPU disabled for remaining clips in this export.`
            )
          } catch (cpuErr: any) {
            const cpuMessage = cpuErr?.message || String(cpuErr)
            failureDetails?.push({
              path: clip.path,
              stage: 'pre-transcode CPU retry',
              detail: cpuMessage.slice(-1200),
            })
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
  }

  // Launch CONCURRENCY workers
  // FIX: Dùng Promise.allSettled thay vì Promise.all để 1 worker fail không cancel workers khác
  const workers = Array.from({ length: CONCURRENCY }, () => processClip())
  const workerResults = await Promise.allSettled(workers)

  // Log worker failures
  const workerErrors = workerResults.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (workerErrors.length > 0) {
    // Nếu tất cả đều bị cancel → re-throw cancel error
    const cancelError = workerErrors.find(r => r.reason?.message?.includes('Đã dừng bởi người dùng'))
    if (cancelError) {
      throw cancelError.reason
    }
    // Log non-cancel errors nhưng KHÔNG throw — vẫn continue với những clips đã transcode OK
    for (const err of workerErrors) {
      console.error(`[PreTranscode] Worker error (non-fatal):`, err.reason?.message || err.reason)
    }
  }

  if (strictSourcePlan && skippedClipCount > 0) {
    const failed = failureDetails && failureDetails.length > 0
      ? ` Nguồn lỗi:\n${failureDetails.slice(0, 12).map((item) => `• ${item.path} | ${item.stage} | ${item.detail}`).join('\n')}`
      : ''
    throw new Error(`Nguồn video trong strict plan bị lỗi; không thay thế bằng clip khác.${failed}\nCách xử lý: sửa/thay các video nêu trên rồi chạy lại.`)
  }

  // Collect results in order from pre-allocated slots
  for (let i = 0; i < clips.length; i++) {
    const slot = slotResults[i]
    if (slot) {
      transcodedPaths.push(slot.outputFile)
      outDurations?.push(slot.durationSec)
    }
  }

  if (usableDurationSec < minimumDurationSec) {
    if (strictSourcePlan) {
      throw new Error(
        `[PreTranscode] Strict video plan lost ${ (minimumDurationSec - usableDurationSec).toFixed(2) }s after source failure; refusing placeholder/reuse.`
      )
    }
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
    `[PreTranscode] Ready ${transcodedPaths.length} clip(s) with usableDuration=${usableDurationSec.toFixed(2)}s for target=${minimumDurationSec.toFixed(2)}s` +
    ` (reused=${reusedClipCount}, skipped=${skippedClipCount}, placeholder=${placeholderClipCount}, cacheSize=${reusableTranscodedClipCache.size})`
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

/**
 * FIX BUG 4: Re-probe pre-transcoded files between Pass 1 and Pass 2.
 *
 * Why: source `clip.durationSec` (từ concat list / VideoPool) đôi khi sai so với
 * stream thật của file pre-transcoded (header VBR, GOP boundary, encoder rounding).
 * Nếu sai mà vẫn dùng làm `duration` directive trong Pass-2 concat list,
 * ffmpeg concat copy sẽ cắt clip ở mốc duration → output bị truncate →
 * verifier báo "Output decode verification failed".
 *
 * Đồng thời check tất cả file phải cùng codec + resolution — concat copy yêu cầu
 * strict match, mismatch => decoder fail trên file output.
 *
 * Trả về:
 *  - actualDurations: duration thật từ ffprobe (override transcodedDurations cũ)
 *  - mismatchReport: mô tả lỗi nếu phát hiện heterogeneity, null nếu OK
 */
async function validatePreTranscodedClips(
  transcodedPaths: string[],
  fallbackDurations: number[] = []
): Promise<{
  actualDurations: number[]
  mismatchReport: string | null
}> {
  type Profile = {
    index: number
    path: string
    durationSec: number
    width: number
    height: number
    codec: string
    pixFmt: string | null
  }
  const actualDurations: number[] = new Array(transcodedPaths.length).fill(0)
  const profiles: Profile[] = []
  const probeFailures: Array<{ path: string; reason: string }> = []

  // FIX #4: probe theo batch concurrency 8 thay vì serial — 3300 clip serial = 3-8 phút treo.
  const CONCURRENCY = 8
  for (let batchStart = 0; batchStart < transcodedPaths.length; batchStart += CONCURRENCY) {
    const batch = transcodedPaths.slice(batchStart, batchStart + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async (filePath, j) => {
        const index = batchStart + j
        const info = await probeFile(filePath)
        return { index, filePath, info }
      })
    )
    for (let j = 0; j < results.length; j++) {
      const index = batchStart + j
      const filePath = batch[j]
      const fallback = fallbackDurations[index]
      const result = results[j]
      if (result.status !== 'fulfilled') {
        // FIX #3: probe fail KHÔNG fatal — giữ duration cũ từ Pass 1, log warning.
        probeFailures.push({
          path: path.basename(filePath),
          reason: (result.reason as any)?.message?.slice(0, 100) || 'probe error',
        })
        actualDurations[index] = fallback != null && fallback > 0 ? fallback : 0
        continue
      }
      const info = result.value.info
      const dur = info?.format?.duration ?? 0
      const v = info?.video
      if (!v || dur <= 0) {
        probeFailures.push({
          path: path.basename(filePath),
          reason: !v ? 'no video stream' : `duration=${dur}`,
        })
        actualDurations[index] = fallback != null && fallback > 0 ? fallback : 0
        continue
      }
      actualDurations[index] = dur
      profiles.push({
        index,
        path: filePath,
        durationSec: dur,
        width: v.width || 0,
        height: v.height || 0,
        codec: v.codec || 'unknown',
        pixFmt: v.pix_fmt ?? null,
      })
    }
  }

  const issues: string[] = []

  // FIX #3: probe failure chỉ log warning, KHÔNG đưa vào issues (không throw cả export
  // chỉ vì 1 file probe hiccup trong số hàng nghìn). Pass 2 vẫn dùng duration fallback.
  if (probeFailures.length > 0) {
    const sample = probeFailures.slice(0, 3).map(p => `${p.path} (${p.reason})`).join('; ')
    console.warn(
      `[FinalExport 2-Pass] ${probeFailures.length}/${transcodedPaths.length} clip re-probe lỗi (non-fatal, dùng duration Pass 1): ${sample}`
    )
  }

  // Chỉ throw khi pre-transcoded clips THẬT SỰ không đồng nhất (concat copy yêu cầu strict match).
  if (profiles.length > 1) {
    const first = profiles[0]
    const wrongRes = profiles.filter(p => p.width !== first.width || p.height !== first.height)
    const wrongCodec = profiles.filter(p => p.codec !== first.codec)
    const wrongPix = profiles.filter(p => p.pixFmt !== first.pixFmt)

    if (wrongRes.length > 0) {
      const sample = wrongRes.slice(0, 3).map(p => `${path.basename(p.path)}=${p.width}x${p.height}`).join(', ')
      issues.push(
        `Resolution mismatch (baseline=${first.width}x${first.height}): ${wrongRes.length} clip(s) different — ${sample}`
      )
    }
    if (wrongCodec.length > 0) {
      const sample = wrongCodec.slice(0, 3).map(p => `${path.basename(p.path)}=${p.codec}`).join(', ')
      issues.push(
        `Codec mismatch (baseline=${first.codec}): ${wrongCodec.length} clip(s) different — ${sample}`
      )
    }
    if (wrongPix.length > 0) {
      const sample = wrongPix.slice(0, 3).map(p => `${path.basename(p.path)}=${p.pixFmt ?? 'null'}`).join(', ')
      issues.push(
        `Pixel format mismatch (baseline=${first.pixFmt ?? 'null'}): ${wrongPix.length} clip(s) different — ${sample}`
      )
    }
  }

  return {
    actualDurations,
    mismatchReport: issues.length > 0 ? issues.join(' | ') : null,
  }
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
  failureDetails?: Array<{ path: string; stage: string; detail: string }>
  reusableTranscodedClipCache?: Map<string, string>
  chromaKeyOverlay?: ChromaKeyOverlay
  audioVisualizer?: FinalExportVisualizerOptions
  strictSourcePlan?: boolean
  /** FIX PERF-12: Skip cleanup of pre-transcoded clips so they can be reused by next job */
  skipTempCleanup?: boolean
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
    failureDetails,
    strictSourcePlan = false,
    reusableTranscodedClipCache,
    chromaKeyOverlay,
    audioVisualizer,
  } = opts
  const defaultFfmpegPath = getFfmpegExecutable()

  await fsp.mkdir(path.dirname(outputPath), { recursive: true })

  const codec = audioCodec?.toLowerCase() ?? null
  const needAudioEncode = !codec || (codec !== 'aac' && codec !== 'mp3')
  // FIX COPY-STREAM BUG 1+2: Decouple video re-encode decision from audio encode decision.
  // Before: needsReencode = forceReencode || needAudioEncode || normalizeAudio || !!normalizeVfFilter
  //   → This forced VIDEO re-encode whenever AUDIO needed encoding (e.g., FLAC audio → AAC).
  //   → Massive performance waste: full libx264/NVENC re-encode of video just for audio conversion.
  // After: needVideoReencode only considers video-specific conditions (forceReencode, vf filter, chroma key).
  // Chroma key uses filter_complex which forces video re-encode, so include it here to ensure
  // videoCodecArgs is built via buildVideoEncoderArgsWithChoice (honoring user's GPU/CPU choice)
  // instead of falling back to copy in single-step.
  const chromaKeyActive = !!(chromaKeyOverlay?.enabled && chromaKeyOverlay?.videoPath)
  const visualizerActive = isAudioVisualizerActive(audioVisualizer)
  const needVideoReencode = forceReencode || !!normalizeVfFilter || chromaKeyActive || visualizerActive

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
    if (visualizerActive) {
      throw new Error('Sóng nhạc hiện chưa hỗ trợ chế độ Chuẩn hóa video khi xuất. Hãy tắt "Chuẩn hóa video khi xuất" hoặc tắt sóng nhạc.')
    }
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
    chromaKeyOverlay: opts.chromaKeyOverlay,
    audioVisualizer: opts.audioVisualizer,
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
    failureDetails,
    reusableTranscodedClipCache,
    skipTempCleanup = false,
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
        strictSourcePlan: opts.strictSourcePlan,
        failureDetails,
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
      // FIX PERF-12b: Chỉ cleanup files MISSING, không xóa files đang valid trong shared cache
      // Trước đây: cleanup ALL transcodedPaths → xóa cả files từ job trước → corrupt shared cache
      const missingSet = new Set(missingPass2Inputs)
      for (const outputFile of Array.from(new Set(transcodedPaths))) {
        if (missingSet.has(outputFile)) {
          cleanupPreTranscodeOutput(outputFile)
        }
      }
      // Invalidate shared cache entries pointing to missing files
      if (reusableTranscodedClipCache) {
        for (const [key, val] of reusableTranscodedClipCache.entries()) {
          if (missingSet.has(val)) {
            reusableTranscodedClipCache.delete(key)
          }
        }
      }
      transcodedDurations = []
      // FIX PERF-12b: Dùng shared cache thay vì new Map() để giữ entries valid
      transcodedPaths = await runPass1(reusableTranscodedClipCache ?? new Map<string, string>(), transcodedDurations)
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

    // ──── VALIDATE: Re-probe pre-transcoded clips trước Pass 2 ────
    // FIX BUG 4: Tin source durationSec là sai lầm — header VBR / GOP rounding /
    // encoder snap khiến file thật khác clip metadata. Nếu cứ ghi `duration X`
    // theo metadata cũ, ffmpeg concat copy cắt stream sớm → output truncate.
    console.log(`[FinalExport 2-Pass] === VALIDATE: Re-probing ${transcodedPaths.length} pre-transcoded clips ===`)
    const validation = await validatePreTranscodedClips(transcodedPaths, transcodedDurations)
    if (validation.mismatchReport) {
      console.error(`[FinalExport 2-Pass] ❌ Pre-Pass-2 validation FAIL: ${validation.mismatchReport}`)
      throw new Error(
        `[FinalExport 2-Pass] Pre-transcoded clips không đồng nhất, không thể concat copy: ${validation.mismatchReport}`
      )
    }
    // Override duration metadata cũ bằng giá trị thật từ ffprobe
    const drift = validation.actualDurations.reduce((maxDrift, actualDur, idx) => {
      const oldDur = transcodedDurations[idx]
      if (oldDur != null && oldDur > 0 && actualDur > 0) {
        return Math.max(maxDrift, Math.abs(actualDur - oldDur))
      }
      return maxDrift
    }, 0)
    if (drift > 0.05) {
      console.warn(
        `[FinalExport 2-Pass] ⚠ Duration drift detected: max=${drift.toFixed(3)}s. Source-reported durations replaced with ffprobe-actual values.`
      )
    }
    transcodedDurations = validation.actualDurations

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

      const pass2OutputPath = path.join(tempDir, `pass2-${mode}.mp4`)
      await fsp.rm(pass2OutputPath, { force: true })
      const publishPass2Output = async () => {
        try {
          await fsp.link(pass2OutputPath, outputPath)
        } catch (error: any) {
          if (error?.code !== 'EXDEV') throw error
          await fsp.copyFile(pass2OutputPath, outputPath, fs.constants.COPYFILE_EXCL)
        }
        await fsp.unlink(pass2OutputPath)
      }
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
        '-n',
        pass2OutputPath,
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
            try {
              await publishPass2Output()
            } catch (publishError) {
              safeReject(publishError instanceof Error ? publishError : new Error(String(publishError)))
              return
            }
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
          // No-clobber policy: do not delete an existing output during retry.
          // FIX PERF-12b: Chỉ cleanup files MISSING, không xóa files valid trong shared cache
          const missingFiles = findMissingPreTranscodedOutputs(transcodedPaths)
          const missingSet = new Set(missingFiles)
          for (const outputFile of Array.from(new Set(transcodedPaths))) {
            if (missingSet.has(outputFile)) {
              cleanupPreTranscodeOutput(outputFile)
            }
          }
          // Invalidate shared cache entries pointing to missing files
          if (reusableTranscodedClipCache) {
            for (const [key, val] of reusableTranscodedClipCache.entries()) {
              if (missingSet.has(val)) {
                reusableTranscodedClipCache.delete(key)
              }
            }
          }
          transcodedDurations = []
          // FIX PERF-12b: Dùng shared cache thay vì new Map() để giữ entries valid
          transcodedPaths = await runPass1(reusableTranscodedClipCache ?? new Map<string, string>(), transcodedDurations)
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
          // No-clobber policy: leave existing output untouched on retry.
          continue
        }
        throw error
      }
    }

    console.log(`[FinalExport 2-Pass] ✓ Export complete: ${outputPath}`)
  } finally {
    // FIX PERF-12: Skip cleanup of pre-transcoded clips when shared cache is active
    // → pre-transcoded clips will be reused by subsequent jobs
    // → final cleanup happens in executeFinalExport after ALL jobs complete
    if (skipTempCleanup) {
      // Only cleanup the pass2 concat list file, keep pre-transcoded clips
      try {
        const pass2File = path.join(tempDir, 'concat_pass2.txt')
        await fsp.rm(pass2File, { force: true }).catch(() => {})
        console.log(`[FinalExport 2-Pass] Skipped temp cleanup (shared cache mode) — pre-transcoded clips preserved for reuse`)
      } catch {}
    } else {
      // Cleanup temp dir fully
      try {
        await fsp.rm(tempDir, { recursive: true, force: true })
        console.log(`[FinalExport 2-Pass] Cleaned up temp dir`)
      } catch (cleanupErr) {
        console.warn(`[FinalExport 2-Pass] Failed to cleanup temp dir:`, cleanupErr)
      }
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
  chromaKeyOverlay?: ChromaKeyOverlay
  audioVisualizer?: FinalExportVisualizerOptions
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
    chromaKeyOverlay,
    audioVisualizer,
    emitProgress,
  } = opts

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const safeResolve = () => { if (!settled) { settled = true; resolve() } }
    const safeReject = (err: Error) => { if (!settled) { settled = true; reject(err) } }

    const visualizerActive = isAudioVisualizerActive(audioVisualizer)
    const shouldEncodeAudio = forceReencode || needAudioEncode || normalizeAudio || visualizerActive
    const audioCodecArgs = shouldEncodeAudio
      ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2']
      : ['-c:a', 'copy']
    const audioFilterArgs = normalizeAudio && !visualizerActive
      ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']
      : []

    // Chroma Key Overlay / Bars Spectrum: thêm input/filter_complex khi cần
    const hasChromaKey = !!(chromaKeyOverlay?.enabled && chromaKeyOverlay?.videoPath)
    const hasFilterComplex = hasChromaKey || visualizerActive
    // Input order: [0] = concat video, [1] = chroma video (nếu có) hoặc audio, [?] = audio
    // Khi có chroma key: [0]=concat, [1]=chroma, [2]=audio
    // Khi không có:      [0]=concat, [1]=audio
    const audioInputIndex = hasChromaKey ? 2 : 1

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
    ]

    // Chroma key: thêm video overlay input trước audio
    if (hasChromaKey) {
      args.push('-i', chromaKeyOverlay!.videoPath)
    }

    // Audio input
    args.push('-i', audioPath)

    if (hasFilterComplex) {
      const { filterComplex, mapsAudioFromFilter } = buildFinalOverlayFilterComplex({
        hasChromaKey,
        chromaKeyOverlay,
        audioVisualizer,
        audioInputIndex,
        normalizeAudio,
      })
      args.push('-filter_complex', filterComplex)
      args.push('-map', '[vout]')
      args.push('-map', mapsAudioFromFilter ? '[aout]' : `${audioInputIndex}:a:0`)
      // Chroma key / Bars Spectrum dùng filter_complex → buộc video re-encode.
      // Phòng trường hợp gọi trực tiếp với copy args, fall back về libx264.
      const filteredVideoCodecArgs = videoCodecArgs.includes('copy')
        ? ['-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p']
        : videoCodecArgs
      args.push(
        ...filteredVideoCodecArgs,
        ...audioFilterArgs,
        ...audioCodecArgs,
      )
    } else {
      // Flow cũ: không có chroma key
      args.push('-map', '0:v:0')
      args.push(
        '-map', `${audioInputIndex}:a:0`,
        ...videoCodecArgs,
        ...(normalizeVfFilter ? ['-vf', normalizeVfFilter] : []),
        ...audioFilterArgs,
        ...audioCodecArgs,
      )
    }

    args.push(
      '-max_muxing_queue_size', '2048',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags', '+faststart',
      '-t',
      totalDurationSec.toFixed(3),
      '-n',
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
  const result = await loadAudioFiles(payload.audioSource)
  const totalDurationSec = result.files.reduce((sum, f) => sum + f.durationSec, 0)
  return {
    requestId: payload.requestId,
    kind: 'audio',
    fileCount: result.files.length,
    totalDurationSec,
    requestedCount: result.requestedCount,
    audioFailures: result.failures,
    items: result.files.map((f) => ({
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

export async function scanImageSource(payload: {
  requestId: string
  imageSource: FinalExportRequestPayload['imageSource']
  perImageDurationSec?: number
}): Promise<FinalExportScanResult> {
  const items = await scanImageSourceForPlan(payload.imageSource)
  const dur = typeof payload.perImageDurationSec === 'number' && payload.perImageDurationSec > 0
    ? payload.perImageDurationSec
    : 5
  const withDur = items.map(i => ({ ...i, durationSec: dur }))
  const totalDurationSec = withDur.reduce((sum, i) => sum + i.durationSec, 0)
  return {
    requestId: payload.requestId,
    kind: 'image',
    fileCount: withDur.length,
    totalDurationSec,
    items: withDur.map(i => ({
      path: i.path,
      durationSec: i.durationSec,
      width: i.width ?? undefined,
      height: i.height ?? undefined,
    })),
  }
}

export async function exportFinalVideo(
  request: FinalExportJobRequest,
  emitter: FinalExportEmitter
): Promise<FinalExportDonePayload> {
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
      request.priorityVideoSource,
      request.imageSource,
      request.endingAudio,
      !!request.uniqueRequired,
      undefined,
      undefined,
      requestId,
    )

    // PLAN A: Disk space CHỈ CẢNH BÁO, KHÔNG CHẶN xuất video.
    // getDiskSpace đã đo đúng bằng fs.statfs (fix cảnh báo sai do WMIC/os.freemem).
    // Nếu ước lượng thiếu → log + emit warning nhưng vẫn cho FFmpeg chạy; nếu ổ thật sự
    // đầy, FFmpeg sẽ báo ENOSPC và được xử lý ở tầng dưới.
    const estimatedClipBytes = plan.videoClips.reduce(
      (sum, v) => sum + (v.sizeBytes ?? 200 * 1024 * 1024), 0
    )
    const estimatedOutputBytes = estimatedClipBytes + plan.totalJobs * 500 * 1024 * 1024
    try {
      await assertMinDiskSpace(
        estimatedOutputBytes,
        request.outputFolder,
        `Xuất ${plan.totalJobs} video (Final Export)`
      )
    } catch (diskWarn: any) {
      console.warn('[FinalExport] ⚠️ Cảnh báo dung lượng (vẫn tiếp tục):', diskWarn?.message || diskWarn)
      emitter.progress({
        requestId,
        stage: 'prepare-audio',
        percent: 0,
        timeSec: 0,
        totalDurationSec: 0,
        status: `⚠️ ${diskWarn?.message || 'Dung lượng ổ đĩa có thể không đủ'} — vẫn đang tiếp tục xuất.`,
      })
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

    // Step 2: Execute - chạy từng job
    const donePayload = await executeFinalExport(
      plan,
      requestId,
      emitter,
      request.shuffle || false,
      !!request.forceReencode,
      !!request.normalizeAudio,
      !!request.tracklistAuto,
      request.useGpuEncoding || 'auto',
      !!request.deleteSourceFiles,
      !!request.unifyFormat,
      request.targetResolution,
      request.targetFps,
      'software',
      request.chromaKeyOverlay,
      // Slideshow parameters
      request.imageSource,
      request.perImageDurationSec,
      request.imageAspectMode,
      request.imageTransition,
      request.imageKenBurns,
      undefined,
      request.audioVisualizer,
    )
    return donePayload
  } catch (error: any) {
    const detailedError = describeErrorForLog(error)
    console.error('[FinalExport] Lỗi export video hoàn chỉnh:', detailedError, error)
    emitter.error({
      requestId,
      error: detailedError || 'Xuất video thất bại.',
      message: detailedError,
    })
    throw error
  } finally {
    videoJobManager.clearCancelled(requestId)
  }
}

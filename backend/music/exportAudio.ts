import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runFfmpeg } from '../ffmpeg/wrapper'
import { getPlaylistById, type PlaylistDefinition, type PlaylistTrack } from './playlistEngine'
import { loadScanResult } from './scanStore'
import {
  checkMinimumSpace,
  createDiskSpaceErrorMessage,
  formatBytes,
  getDiskSpace,
} from '../utils/diskSpace'
import { addHistoryEntry } from './exportHistory'
import { probeFile } from '../ffmpeg/probe'

export interface ExportPlaylistRequest {
  playlistId: string
  outputDir: string
  fileName: string // không có phần mở rộng
  format: 'mp3' | 'wav' | 'aac'
  bitrateKbps?: number // chỉ dùng cho mp3, default 320
  smoothTransitions?: boolean // bật crossfade (re-encode)
  crossfadeDurationSec?: number // thời lượng crossfade (giây)
  /** Cân bằng âm lượng giữa các bài (EBU R128 loudnorm) */
  normalizeLoudness?: boolean
  /** Target LUFS (default -14 = YouTube/Spotify standard) */
  loudnessTargetLufs?: number
  /** Internal: Job queue request ID */
  requestId?: string
  /** Internal: AbortSignal from job queue for cancellation */
  signal?: AbortSignal
}

export interface ExportPlaylistResult {
  success: boolean
  outputPath?: string
  durationSec?: number
  error?: string
}

export interface CrossfadeTrackIssue {
  trackPath: string
  trackName: string
  reason: string
}

export interface CrossfadePlaylistCheckResult {
  playlistId: string
  playlistName: string
  issues: CrossfadeTrackIssue[]
}

export interface ValidatePlaylistsForCrossfadeRequest {
  playlistIds: string[]
  crossfadeDurationSec?: number
}

export interface ValidatePlaylistsForCrossfadeResult {
  results: CrossfadePlaylistCheckResult[]
  totalChecked: number
  totalWithIssues: number
}

/**
 * Chuẩn hóa tên file: bỏ ký tự đặc biệt, thay bằng _
 */
function sanitizeFileName(fileName: string): string {
  // Bỏ ký tự không hợp lệ cho tên file Windows/Linux
  return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
}

function escapePathForFfmpegConcatList(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''")
}

/**
 * Tạo file concat list.txt cho FFmpeg
 */
function createConcatListFile(
  tracks: PlaylistDefinition['tracks'],
  tempDir: string,
  playlistId: string
): string {
  const listFile = path.join(tempDir, `concat-${playlistId}-${Date.now()}.txt`)

  const lines: string[] = []
  for (const track of tracks) {
    lines.push(`file '${escapePathForFfmpegConcatList(track.path)}'`)
  }

  fs.writeFileSync(listFile, lines.join('\n'), 'utf-8')
  return listFile
}

function recomputePlaylistTracks(tracks: PlaylistDefinition['tracks']): PlaylistDefinition['tracks'] {
  let cumulativeDuration = 0
  return tracks.map((track, index) => {
    cumulativeDuration += track.duration
    return {
      ...track,
      order: index + 1,
      cumulativeDuration,
    }
  })
}

function getEndingDurationSec(playlist: PlaylistDefinition): number {
  return playlist.endingDurationSec ?? playlist.tracks
    .filter(track => track.role === 'ending')
    .reduce((sum, track) => sum + track.duration, 0)
}

/**
 * Pre-normalize từng track riêng lẻ bằng FFmpeg loudnorm (EBU R128).
 * Mỗi bài được analyze và normalize RIÊNG → đảm bảo âm lượng đều giữa các bài.
 *
 * FFmpeg loudnorm cần 2-pass nhưng single-pass mode (linear=false, default)
 * đã đủ tốt cho use case này vì chỉ cần cân bằng giữa các bài, không cần master-grade.
 *
 * Return: mảng đường dẫn file WAV tạm (cùng thứ tự với input tracks).
 */
async function preNormalizeTracks(
  tracks: PlaylistDefinition['tracks'],
  tempDir: string,
  playlistId: string,
  targetLufs: number,
  tempFiles: Set<string>,
  onProgress?: (trackIndex: number, totalTracks: number) => void,
  requestId?: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const normalizedPaths: string[] = []
  const loudnormFilter = `loudnorm=I=${targetLufs}:TP=-1:LRA=11`

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]
    if (!track?.path) {
      throw new Error(`Track ${i + 1} has no path`)
    }
    const outFile = path.join(
      tempDir,
      `norm-${playlistId}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.wav`
    )
    tempFiles.add(outFile)

    if (onProgress) onProgress(i, tracks.length)

    const args = [
      '-hide_banner',
      '-y',
      '-i', track.path,
      '-vn',
      '-af', loudnormFilter,
      '-ar', '48000',
      '-ac', '2',
      '-acodec', 'pcm_s16le',
      outFile,
    ]

    console.log(`[ExportAudio] Normalizing track ${i + 1}/${tracks.length}: ${path.basename(track.path)} → ${targetLufs} LUFS`)

    const result = await runFfmpeg({
      args,
      timeoutMs: 600000, // 10 min per track
      requestId,
      signal,
    })

    if (result.code !== 0) {
      throw new Error(
        `Normalize track ${i + 1} failed (${path.basename(track.path)}): ${result.stderr || 'Unknown error'}`
      )
    }

    normalizedPaths.push(outFile)
  }

  console.log(`[ExportAudio] ✓ Pre-normalized ${tracks.length} tracks → ${targetLufs} LUFS`)
  return normalizedPaths
}

function buildCrossfadeRenderArgs(
  inputPaths: string[],
  outputPath: string,
  format: ExportPlaylistRequest['format'],
  bitrate: number | undefined,
  crossfadeDurationSec: number,
): string[] {
  const args = ['-hide_banner', '-y']
  const filterLines: string[] = []
  const inputLabels: string[] = []

  for (let i = 0; i < inputPaths.length; i++) {
    const label = `a${i}`
    inputLabels.push(`[${label}]`)
    filterLines.push(`[${i}:a]asetpts=PTS-STARTPTS[${label}]`)
    args.push('-i', inputPaths[i]!)
  }

  let outputLabel = inputLabels[0] ?? '[amixout]'
  if (inputPaths.length <= 1) {
    filterLines.push(`${outputLabel}acopy[amixout]`)
    outputLabel = '[amixout]'
  } else {
    for (let i = 1; i < inputPaths.length; i++) {
      const nextLabel = inputLabels[i]!
      const outLabel = i === inputPaths.length - 1 ? 'amixout' : `acfade${i}`
      filterLines.push(`${outputLabel}${nextLabel}acrossfade=d=${crossfadeDurationSec}:c1=tri:c2=tri[${outLabel}]`)
      outputLabel = `[${outLabel}]`
    }
  }

  args.push(
    '-filter_complex',
    filterLines.join(';'),
    '-map',
    outputLabel,
    '-ar',
    '48000',
    '-ac',
    '2',
  )

  if (format === 'mp3') {
    args.push('-acodec', 'libmp3lame', '-b:a', `${(bitrate ?? 320)}k`)
  } else if (format === 'aac') {
    args.push('-acodec', 'aac', '-b:a', `${(bitrate ?? 384)}k`)
  } else {
    args.push('-acodec', 'pcm_s16le')
  }

  args.push(outputPath)
  return args
}

/**
 * Export playlist thành một file audio duy nhất
 */
export async function exportPlaylistToFile(
  req: ExportPlaylistRequest,
  progressEmitter?: (progress: {
    playlistId: string
    outputPath: string
    currentSec: number
    totalSec: number
    percent: number
  }) => void
): Promise<ExportPlaylistResult> {
  // Fix High #2.1: Track all temp files in Set for better cleanup
  const tempFiles = new Set<string>() // Track all temp files for cleanup
  let listFile: string | null = null
  // FIX BUG: Lưu original track paths trước khi normalize thay đổi path sang temp files
  // Dùng cho history entry ở cuối
  let originalTrackPaths: Map<string, string> | null = null
  try {
    // 1. Validate playlist
    let playlist = getPlaylistById(req.playlistId)
    if (!playlist) {
      return {
        success: false,
        error: 'Playlist không tồn tại.',
      }
    }

    if (playlist.tracks.length === 0) {
      return {
        success: false,
        error: 'Playlist không có bài hát nào.',
      }
    }

    // 2. Validate output directory
    if (!fs.existsSync(req.outputDir)) {
      return {
        success: false,
        error: `Thư mục xuất không tồn tại: ${req.outputDir}`,
      }
    }

    // 3. Kiểm tra dung lượng ổ đĩa trước khi export (CHỈ CẢNH BÁO, KHÔNG CHẶN)
    // FIX: Không chặn export nữa, chỉ log warning để user biết
    // User có thể tự quyết định có muốn tiếp tục hay không (thông qua dialog nếu cần)
    try {
      // Lấy thông tin ổ đĩa từ outputDir
      const diskInfo = await getDiskSpace(req.outputDir)
      console.log(
        `[ExportAudio] Disk ${diskInfo.drive}: ${formatBytes(diskInfo.free)} free (${(
          diskInfo.free /
          (1024 * 1024 * 1024)
        ).toFixed(2)} GB)`
      )

      const spaceCheck = checkMinimumSpace(diskInfo.free, 4)
      if (!spaceCheck.enough) {
        const warningMsg = createDiskSpaceErrorMessage(diskInfo, spaceCheck, {
          tabName: 'Tab 4 - Xuất nhạc',
          operation: 'Export playlist',
          additionalInfo: `Playlist: ${playlist.name} – số bài: ${playlist.tracks.length}`,
        })

        // CHỈ CẢNH BÁO, KHÔNG CHẶN: Log warning nhưng vẫn cho phép export
        console.warn('[ExportAudio] ⚠️ Disk space warning (vẫn tiếp tục):\n', warningMsg)
      } else {
        console.log('[ExportAudio] ✓ Disk space OK')
      }
    } catch (diskErr: any) {
      // Nếu không kiểm tra được dung lượng, chỉ log warning, không chặn
      console.warn(
        `[ExportAudio] ⚠️ Không thể kiểm tra dung lượng ổ đĩa:`,
        diskErr instanceof Error ? diskErr.message : String(diskErr)
      )
      console.warn('[ExportAudio] Vẫn tiếp tục export...')
      // KHÔNG throw error - cho phép user tiếp tục
    }

    // 4. Tạo đường dẫn output
    const safeName = sanitizeFileName(req.fileName)
    const ext = req.format === 'mp3' ? '.mp3' : req.format === 'aac' ? '.m4a' : '.wav'
    const outputPath = path.join(req.outputDir, safeName + ext)

    // 5. Tạo thư mục temp nếu chưa có
    // Fix High #2.3: Check disk space before creating temp dir
    const tempDirPath = os.tmpdir()
    try {
      const diskInfo = await getDiskSpace(tempDirPath)
      // Estimate: assume each track needs ~50MB temp space
      const estimatedBytes = playlist.tracks.length * 50 * 1024 * 1024
      const spaceCheck = checkMinimumSpace(diskInfo.free, Math.ceil(estimatedBytes / (1024 * 1024 * 1024)))
      if (!spaceCheck.enough && !diskInfo.unknown) {
        // PLAN A: CHỈ CẢNH BÁO, KHÔNG CHẶN — user vẫn xuất được; nếu thật sự đầy
        // FFmpeg sẽ báo ENOSPC. getDiskSpace đã đo đúng bằng fs.statfs.
        console.warn(
          `[ExportAudio] ⚠️ Temp dir có thể thiếu dung lượng (vẫn tiếp tục): ` +
          `cần ~${formatBytes(estimatedBytes)}, còn ${formatBytes(diskInfo.free)}`
        )
      }
    } catch (diskErr: any) {
      console.warn('[ExportAudio] Disk space check failed, continuing anyway:', diskErr)
    }
    
    const tempDir = path.join(os.tmpdir(), '93-media-tool-mix-nhac')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    // 5b. Loudness normalization config (EBU R128) — sẽ thực hiện per-track SAU khi playlist final
    const loudnormEnabled = !!req.normalizeLoudness
    const loudnormLufs = req.loudnessTargetLufs ?? -14
    if (loudnormEnabled) {
      console.log(`[ExportAudio] Loudness normalization ON → will pre-normalize each track to ${loudnormLufs} LUFS`)
    }

    // 6. Chế độ crossfade (re-encode) hoặc concat copy-stream
    const smoothTransitions = !!req.smoothTransitions && playlist.tracks.length > 1
    const crossfadeDurationSec = (() => {
      const raw = req.crossfadeDurationSec
      const fallback = 4 // default 4s trong khoảng 1-10s
      if (!raw || raw <= 0) return fallback
      return Math.min(Math.max(raw, 1), 10)
    })()

    const defaultBitrate =
      req.format === 'aac' ? 256 : req.format === 'mp3' ? 320 : undefined
    const bitrate = req.bitrateKbps ?? defaultBitrate
    
    // Target duration là thời lượng hiển thị trong UI (người dùng mong đợi).
    // Nhạc role=ending là yêu cầu nối thêm sau target chính, nên output dài hơn target.
    const endingDurationSec = getEndingDurationSec(playlist)
    const targetDurationSec = endingDurationSec > 0
      ? playlist.totalDurationSec
      : (playlist.targetDurationSec || playlist.totalDurationSec)
    
    // Tính duration thực tế sẽ xuất ra (sẽ được cập nhật khi có crossfade)
    let totalDurationSec = playlist.totalDurationSec

    let args: string[] = []
    let finalProgressStartPercent = 0
    let finalProgressSpanPercent = 100

    if (!smoothTransitions) {
      // Giữ concat copy như cũ (nhanh, không fade)

      // Pre-normalize per-track TRƯỚC khi concat (playlist đã final cho concat mode)
      if (loudnormEnabled) {
        // Lưu original paths trước khi normalize thay đổi
        if (!originalTrackPaths) {
          originalTrackPaths = new Map(playlist.tracks.map(t => [t.id, t.path]))
        }
        const normalizeTotalSec = playlist.totalDurationSec
        const normalizedPaths = await preNormalizeTracks(
          playlist.tracks, tempDir, req.playlistId, loudnormLufs, tempFiles,
          (idx, total) => {
            if (progressEmitter) progressEmitter({
              playlistId: req.playlistId, outputPath, currentSec: 0,
              totalSec: normalizeTotalSec,
              percent: Math.round((idx / total) * 20),
            })
          },
          req.requestId, req.signal,
        )
        playlist = {
          ...playlist,
          tracks: playlist.tracks.map((t, i) => ({ ...t, path: normalizedPaths[i]! })),
        }
      }

      try {
        listFile = createConcatListFile(playlist.tracks, tempDir, req.playlistId)
        if (listFile) tempFiles.add(listFile) // Fix High #2.1: Track for cleanup

        // Detect nếu tất cả track đầu vào là AAC native (m4a/aac)
        // → dùng -c copy thay vì re-encode để nhanh gấp 20-50x
        const AAC_EXTS = new Set(['.m4a', '.aac'])
        const allTracksAreAac = playlist.tracks.every(t =>
          AAC_EXTS.has(path.extname(t.path).toLowerCase())
        )
        const canStreamCopy = req.format === 'aac' && allTracksAreAac

        if (canStreamCopy) {
          // Stream copy: input AAC → output AAC, không re-encode
          console.log(`[ExportAudio] ✓ All tracks are AAC → using stream copy (no re-encode)`)
          args = [
            '-hide_banner',
            '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', listFile,
            '-vn',
            '-c', 'copy',
            outputPath,
          ]
        } else if (req.format === 'mp3') {
          args = [
            '-hide_banner',
            '-y', // overwrite output file
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            listFile,
            '-vn', // no video
            '-acodec',
            'libmp3lame',
            '-ar',
            '48000',
            '-ac',
            '2',
            '-b:a',
            `${(bitrate ?? 320)}k`,
            outputPath,
          ]
        } else if (req.format === 'aac') {
          // AAC input nhưng không phải tất cả là m4a/aac → re-encode bình thường
          args = [
            '-hide_banner',
            '-y',
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            listFile,
            '-vn',
            '-acodec',
            'aac',
            '-ar',
            '48000',
            '-ac',
            '2',
            '-b:a',
            `${(bitrate ?? 384)}k`,
            outputPath,
          ]
        } else {
          // WAV
          args = [
            '-hide_banner',
            '-y',
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            listFile,
            '-vn',
            '-acodec',
            'pcm_s16le',
            '-ar',
            '48000',
            '-ac',
            '2',
            outputPath,
          ]
        }
        
        // Cập nhật totalDurationSec để dùng cho progress tracking
        totalDurationSec = targetDurationSec
        
        // Emit progress ban đầu với target duration
        if (progressEmitter) {
          progressEmitter({
            playlistId: req.playlistId,
            outputPath,
            currentSec: 0,
            totalSec: totalDurationSec,
            percent: 0,
          })
        }
      } catch (err) {
        if (listFile && fs.existsSync(listFile)) {
          try {
            fs.unlinkSync(listFile)
          } catch {}
        }
        throw err
      }
    } else {
      // Crossfade (decode + re-encode)
      // Xử lý theo batch để tránh lỗi "Cannot allocate memory" khi có nhiều tracks
      const MAX_TRACKS_PER_BATCH = 8 // Giới hạn số tracks mỗi batch để tránh memory issue
      let totalTracks = playlist.tracks.length
      
      // QUAN TRỌNG: Tính toán và tự động thêm bài nhạc nếu thiếu thời lượng (trước khi build filter)
      // Tính toán duration thực tế sau crossfade
      let crossfadePoints = totalTracks > 1 ? totalTracks - 1 : 0
      let estimatedOutputDurationSec = Math.max(
        0,
        playlist.totalDurationSec - (crossfadeDurationSec * crossfadePoints),
      )
      
      // Debug logging để kiểm tra tính toán
      console.log(`[exportAudio] Crossfade duration calculation (trước khi extend):`)
      console.log(`  - Total tracks: ${totalTracks}`)
      console.log(`  - Crossfade points: ${crossfadePoints}`)
      console.log(`  - Crossfade duration: ${crossfadeDurationSec}s`)
      console.log(`  - Playlist total duration: ${playlist.totalDurationSec.toFixed(2)}s`)
      console.log(`  - Estimated output duration: ${estimatedOutputDurationSec.toFixed(2)}s`)
      console.log(`  - Target duration: ${targetDurationSec.toFixed(2)}s`)
      
      // QUAN TRỌNG: Nếu playlist thiếu thời lượng, tự động thêm bài nhạc vào playlist
      // KHÔNG pad silence - đây là dối trá!
      const durationDiff = targetDurationSec - estimatedOutputDurationSec
      
      if (durationDiff > 5.0) {
        console.log(
          `[exportAudio] Playlist thiếu ${durationDiff.toFixed(2)}s so với target (${targetDurationSec.toFixed(2)}s). ` +
          `Đang tự động thêm bài nhạc vào playlist...`
        )
        
        // Lấy scan result để có danh sách tracks có thể thêm
        const scanResult = loadScanResult()
        if (scanResult && scanResult.tracks.length > 0) {
          // Tính average track duration
          const averageTrackDuration = scanResult.tracks.reduce((sum, t) => sum + t.duration, 0) / scanResult.tracks.length
          
          // Ước tính số bài cần thêm
          // Mỗi bài thêm sẽ tăng duration = averageTrackDuration - crossfadeDurationSec (do overlap)
          const durationPerNewTrack = averageTrackDuration - crossfadeDurationSec
          // Bug #13 fix: durationPerNewTrack can be negative when crossfade > avg track duration.
          // Negative value makes Math.ceil return a negative count → zero tracks added silently.
          // Fall back to raw averageTrackDuration so the count is always positive.
          const effectiveDurationPerTrack = durationPerNewTrack > 0 ? durationPerNewTrack : averageTrackDuration
          const estimatedTracksNeeded = Math.ceil(durationDiff / Math.max(effectiveDurationPerTrack, 1))

          console.log(
            `[exportAudio] Ước tính cần thêm ${estimatedTracksNeeded} bài (average: ${averageTrackDuration.toFixed(1)}s, ` +
            `duration per new track: ${durationPerNewTrack.toFixed(1)}s)`
          )
          
          // Lấy danh sách tracks chưa được dùng trong playlist
          const usedTrackIds = new Set(playlist.tracks.map(t => t.id))
          const availableTracks = scanResult.tracks.filter(
            (t) => !usedTrackIds.has(t.id) && t.duration > crossfadeDurationSec,
          )

          if (availableTracks.length === 0) {
            console.warn(`[exportAudio] Không còn bài nhạc nào để thêm vào playlist.`)
          } else {
            // Thêm bài nhạc vào playlist. Nếu có role=ending, chèn filler TRƯỚC ending để ending vẫn là cuối.
            const tracksToAdd: PlaylistTrack[] = []
            let addedDuration = 0
            const endingStartIndex = playlist.tracks.findIndex(t => t.role === 'ending')
            const mainTracks = endingStartIndex >= 0 ? playlist.tracks.slice(0, endingStartIndex) : playlist.tracks
            const endingTracks = endingStartIndex >= 0 ? playlist.tracks.slice(endingStartIndex) : []
            let lastTrackId = mainTracks[mainTracks.length - 1]?.id || ''

            // Shuffle available tracks để thêm ngẫu nhiên (Fisher-Yates)
            const shuffled = [...availableTracks]
            for (let si = shuffled.length - 1; si > 0; si--) {
              const sj = Math.floor(Math.random() * (si + 1));
              [shuffled[si], shuffled[sj]] = [shuffled[sj], shuffled[si]]
            }

            for (const track of shuffled) {
              if (tracksToAdd.length >= estimatedTracksNeeded + 10) break // Thêm thêm 10 bài để đảm bảo đủ

              // Tránh trùng liên tiếp
              if (track.id === lastTrackId && shuffled.length > 1) continue

              tracksToAdd.push({
                ...track,
                order: mainTracks.length + tracksToAdd.length + 1,
                cumulativeDuration: mainTracks.reduce((s, t) => s + t.duration, 0) + addedDuration + track.duration,
              })

              addedDuration += track.duration
              lastTrackId = track.id

              // Tính lại estimated duration sau khi thêm bài này
              const newTotalTracks = totalTracks + tracksToAdd.length
              const newCrossfadePoints = newTotalTracks > 1 ? newTotalTracks - 1 : 0
              const newTotalDuration = playlist.totalDurationSec + addedDuration
              const newEstimatedDuration = Math.max(
                0,
                newTotalDuration - (crossfadeDurationSec * newCrossfadePoints),
              )

              // Nếu đã đủ hoặc vượt target, dừng lại
              if (newEstimatedDuration >= targetDurationSec - 1.0) {
                break
              }
            }

            if (tracksToAdd.length > 0) {
              const extendedTracks = recomputePlaylistTracks([...mainTracks, ...tracksToAdd, ...endingTracks])
              // Tạo playlist mới với thêm bài nhạc
              const extendedPlaylist: PlaylistDefinition = {
                ...playlist,
                tracks: extendedTracks,
                totalDurationSec: extendedTracks.reduce((sum, track) => sum + track.duration, 0),
              }

              // Cập nhật lại các giá trị
              const newTotalTracks = extendedPlaylist.tracks.length
              const newCrossfadePoints = newTotalTracks > 1 ? newTotalTracks - 1 : 0
              estimatedOutputDurationSec = Math.max(
                0,
                extendedPlaylist.totalDurationSec - (crossfadeDurationSec * newCrossfadePoints),
              )
              
              console.log(
                `[exportAudio] Đã thêm ${tracksToAdd.length} bài vào playlist. ` +
                `Duration: ${playlist.totalDurationSec.toFixed(1)}s -> ${extendedPlaylist.totalDurationSec.toFixed(1)}s. ` +
                `Estimated sau crossfade: ${estimatedOutputDurationSec.toFixed(1)}s (target: ${targetDurationSec.toFixed(1)}s)`
              )
              
              // Dùng playlist mới
              playlist = extendedPlaylist
              totalTracks = newTotalTracks
              crossfadePoints = newCrossfadePoints
            }
          }
        } else {
          console.warn(`[exportAudio] Không có scan result để thêm bài nhạc vào playlist.`)
        }
      }

      const invalidCrossfadeTrack = playlist.tracks.find(
        (track) => (track.duration ?? 0) <= crossfadeDurationSec,
      )
      if (invalidCrossfadeTrack) {
        return {
          success: false,
          error: `Track "${invalidCrossfadeTrack.fileName || path.basename(invalidCrossfadeTrack.path)}" ngắn hơn hoặc bằng crossfade ${crossfadeDurationSec}s.`,
        }
      }

      // Pre-normalize per-track SAU khi playlist đã final (bao gồm cả bài mới thêm)
      if (loudnormEnabled) {
        // Lưu original paths trước khi normalize thay đổi
        if (!originalTrackPaths) {
          originalTrackPaths = new Map(playlist.tracks.map(t => [t.id, t.path]))
        }
        const normalizeTotalSec = playlist.totalDurationSec
        const normalizedPaths = await preNormalizeTracks(
          playlist.tracks, tempDir, req.playlistId, loudnormLufs, tempFiles,
          (idx, total) => {
            if (progressEmitter) progressEmitter({
              playlistId: req.playlistId, outputPath, currentSec: 0,
              totalSec: normalizeTotalSec,
              percent: Math.round((idx / total) * 20),
            })
          },
          req.requestId, req.signal,
        )
        playlist = {
          ...playlist,
          tracks: playlist.tracks.map((t, i) => ({ ...t, path: normalizedPaths[i]! })),
        }
      }

      if (totalTracks <= MAX_TRACKS_PER_BATCH) {
        console.log(`[exportAudio] Crossfade duration (final, sau extend nếu có):`)
        console.log(`  - Total tracks: ${totalTracks}, Crossfade points: ${crossfadePoints}`)
        console.log(`  - Estimated output: ${estimatedOutputDurationSec.toFixed(2)}s, Target: ${targetDurationSec.toFixed(2)}s`)

        totalDurationSec = estimatedOutputDurationSec
        if (progressEmitter) {
          progressEmitter({
            playlistId: req.playlistId,
            outputPath,
            currentSec: 0,
            totalSec: totalDurationSec,
            percent: 0,
          })
        }

        args = buildCrossfadeRenderArgs(
          playlist.tracks.map((track) => track.path),
          outputPath,
          req.format,
          bitrate,
          crossfadeDurationSec,
        )
      } else {
        // Nếu số tracks > MAX_TRACKS_PER_BATCH, xử lý theo batch
        console.log(`[ExportAudio] Playlist có ${totalTracks} tracks, chia thành batch để tránh memory issue`)
        
        // Chia tracks thành các batch
        const batches: PlaylistDefinition['tracks'][] = []
        for (let i = 0; i < totalTracks; i += MAX_TRACKS_PER_BATCH) {
          batches.push(playlist.tracks.slice(i, i + MAX_TRACKS_PER_BATCH))
        }

        console.warn(
          `[ExportAudio] Crossfade batch mode: render ${batches.length} batch rồi crossfade tiếp giữa các batch để giữ smoothTransitions xuyên suốt.`,
        )
        
        // Xử lý từng batch và lưu vào file temp
        const batchOutputFiles: string[] = []
        const totalBatchRenderedDurationSec = batches.reduce((sum, batch) => {
          const batchDuration = batch.reduce((batchSum, track) => batchSum + track.duration, 0)
          const batchOverlap = batch.length > 1 ? crossfadeDurationSec * (batch.length - 1) : 0
          return sum + Math.max(0, batchDuration - batchOverlap)
        }, 0)
        let processedBatchRenderedDurationSec = 0

        totalDurationSec = estimatedOutputDurationSec
        if (progressEmitter) {
          progressEmitter({
            playlistId: req.playlistId,
            outputPath,
            currentSec: 0,
            totalSec: totalDurationSec,
            percent: 0,
          })
        }
        
        for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
          // FIX: Kiểm tra abort signal giữa các batch
          if (req.signal?.aborted) {
            return {
              success: false,
              error: 'Export đã bị hủy.',
            }
          }
          const batch = batches[batchIdx]
          const batchOutputFile = path.join(tempDir, `batch-${req.playlistId}-${batchIdx}-${Date.now()}.wav`)
          batchOutputFiles.push(batchOutputFile)
          tempFiles.add(batchOutputFile) // Fix High #2.1: Track in Set for better cleanup
          const batchArgs = buildCrossfadeRenderArgs(
            batch.map((track) => track.path),
            batchOutputFile,
            'wav',
            undefined,
            crossfadeDurationSec,
          )
          
          // Chạy FFmpeg cho batch này
          console.log(`[ExportAudio] Xử lý batch ${batchIdx + 1}/${batches.length} (${batch.length} tracks)...`)
          const batchResult = await runFfmpeg({
            args: batchArgs,
            timeoutMs: 3600000,
            requestId: req.requestId,
            signal: req.signal,
            onProgress: (p) => {
              if (!progressEmitter) return
              const renderedSec = processedBatchRenderedDurationSec + p.timeSec
              const batchPhaseRatio =
                totalBatchRenderedDurationSec > 0
                  ? renderedSec / totalBatchRenderedDurationSec
                  : 0
              const percent = Math.max(0, Math.min(75, batchPhaseRatio * 75))
              
              progressEmitter({
                playlistId: req.playlistId,
                outputPath,
                currentSec: (percent / 100) * totalDurationSec,
                totalSec: totalDurationSec,
                percent,
              })
            },
          })
          
          if (batchResult.code !== 0) {
            // Temp files sẽ được cleanup trong finally block
            return {
              success: false,
              error: `Batch ${batchIdx + 1} failed: ${batchResult.stderr || 'Unknown error'}`,
            }
          }
          
          // Cập nhật processed duration (trừ crossfade overlap)
          const batchDuration = batch.reduce((sum, t) => sum + t.duration, 0)
          const batchCrossfadeOverlap = batch.length > 1 ? crossfadeDurationSec * (batch.length - 1) : 0
          processedBatchRenderedDurationSec += Math.max(0, batchDuration - batchCrossfadeOverlap)
        }

        console.log(`[ExportAudio] Crossfade ${batches.length} batch outputs...`)
        finalProgressStartPercent = 75
        finalProgressSpanPercent = 25
        args = buildCrossfadeRenderArgs(
          batchOutputFiles,
          outputPath,
          req.format,
          bitrate,
          crossfadeDurationSec,
        )
      }
    }

    // 7. Chạy FFmpeg
    console.log('[ExportAudio] Running FFmpeg with args:', args)
    // Lấy requestId từ req nếu có (được pass từ jobQueue context)
    const requestId = req.requestId
    const result = await runFfmpeg({
      args,
      timeoutMs: 3600000, // 1 hour timeout
      requestId, // Pass requestId để register vào videoJobManager
      signal: req.signal, // Pass AbortSignal từ jobQueue context
      onStderrChunk: (chunk) => {
        // Log progress (FFmpeg thường log vào stderr)
        process.stdout.write(chunk)
      },
      onProgress: (p) => {
        if (!totalDurationSec || !progressEmitter) return
        const phaseProgressRatio = totalDurationSec > 0 ? (p.timeSec / totalDurationSec) : 0
        const percent = Math.max(
          0,
          Math.min(
            100,
            finalProgressStartPercent + (phaseProgressRatio * finalProgressSpanPercent),
          ),
        )
        progressEmitter({
          playlistId: req.playlistId,
          outputPath,
          currentSec: (percent / 100) * totalDurationSec,
          totalSec: totalDurationSec,
          percent,
        })
      },
    })

    // 8. Kiểm tra kết quả
    if (result.code === 0 && fs.existsSync(outputPath)) {
      // Đảm bảo emit progress 100% khi hoàn thành (tránh progress đứng ở ~99%)
      if (progressEmitter && totalDurationSec) {
        progressEmitter({
          playlistId: req.playlistId,
          outputPath,
          currentSec: totalDurationSec,
          totalSec: totalDurationSec,
          percent: 100,
        })
      }
      // Lấy duration thực tế từ file output (nếu có thể probe)
      let actualDurationSec = totalDurationSec
      try {
        const probed = await probeFile(outputPath)
        if (probed.format?.duration && probed.format.duration > 0) {
          actualDurationSec = probed.format.duration
        }
      } catch (err) {
        console.warn('[ExportAudio] Could not probe output file duration, using estimated:', err)
      }
      
      // KHÔNG pad silence - đây là dối trá!
      // Nếu duration thiếu, cần thêm bài nhạc vào playlist khi tạo playlist, không phải pad silence ở đây
      // Log warning nếu duration thiếu nhiều
      if (smoothTransitions && actualDurationSec < targetDurationSec - 5.0) {
        const diffSec = targetDurationSec - actualDurationSec
        console.warn(
          `[ExportAudio] WARNING: File xuất ra thiếu ${diffSec.toFixed(2)}s so với target (${targetDurationSec.toFixed(2)}s). ` +
          `Cần thêm bài nhạc vào playlist để đạt target duration. ` +
          `Actual duration: ${actualDurationSec.toFixed(2)}s`
        )
      }
      
      const successResult = {
        success: true,
        outputPath,
        durationSec: actualDurationSec,
      }
      // Lưu lịch sử export (tất cả các đợt)
      try {
        let historyStartSec = 0
        addHistoryEntry({
          playlistId: playlist.id,
          playlistName: playlist.name,
          outputPath,
          tracks: playlist.tracks.map((t, index) => {
            const startSec =
              index === 0
                ? 0
                : historyStartSec

            if (smoothTransitions) {
              historyStartSec += Math.max(0, t.duration - crossfadeDurationSec)
            } else {
              historyStartSec = t.cumulativeDuration ?? (startSec + t.duration)
            }

            return {
              name: t.fileName,
              // FIX: Dùng original path thay vì temp normalized path (sẽ bị xóa trong finally)
              path: originalTrackPaths?.get(t.id) ?? t.path,
              durationSec: t.duration,
              startSec,
            }
          }),
        })
      } catch (err) {
        console.warn('[ExportAudio] Failed to record export history:', err)
      }
      return successResult
    } else {
      return {
        success: false,
        error: result.stderr || 'FFmpeg export failed',
      }
    }
  } catch (err: any) {
    console.error('[ExportAudio] exportPlaylistToFile error:', err)
    return {
      success: false,
      error: err?.message || 'Lỗi không xác định khi xuất playlist.',
    }
  } finally {
    // Fix High #2.1: Cleanup all temp files comprehensively
    try {
      // Cleanup all tracked temp files (bao gồm listFile, concatListFile, batch files, norm files)
      tempFiles.forEach(f => {
        try {
          if (fs.existsSync(f)) {
            fs.unlinkSync(f)
          }
        } catch (err) {
          console.warn(`[ExportAudio] Failed to delete temp file ${f}:`, err)
        }
      })
    } catch (err) {
      console.warn('[ExportAudio] Error during temp files cleanup:', err)
    }
  }
}

/**
 * Kiểm tra các track trong playlist có phù hợp để chạy crossfade không.
 * - Decode thử 2s đầu của từng file bằng FFmpeg: nếu FFmpeg lỗi → mark là track lỗi.
 * - KHÔNG xuất file, chỉ trả về danh sách issues để UI hiển thị.
 */
export async function validatePlaylistForCrossfade(
  playlistId: string,
  crossfadeDurationSec: number = 4,
): Promise<CrossfadePlaylistCheckResult> {
  const playlist = getPlaylistById(playlistId)
  if (!playlist) {
    return {
      playlistId,
      playlistName: '(unknown)',
      issues: [
        {
          trackPath: '',
          trackName: '',
          reason: 'Playlist không tồn tại.',
        },
      ],
    }
  }

  const issues: CrossfadeTrackIssue[] = []

  // Thư mục tạm để FFmpeg ghi output null
  for (const track of playlist.tracks) {
    const srcPath = track.path
    if (!srcPath || !fs.existsSync(srcPath)) {
      issues.push({
        trackPath: srcPath,
        trackName: track.fileName || path.basename(srcPath || '(unknown)'),
        reason: 'File không tồn tại trên đĩa.',
      })
      continue
    }

    if ((track.duration ?? 0) <= crossfadeDurationSec) {
      issues.push({
        trackPath: srcPath,
        trackName: track.fileName || path.basename(srcPath),
        reason: `Track ngắn hơn hoặc bằng crossfade ${crossfadeDurationSec}s.`,
      })
      continue
    }

    try {
      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-t',
        '2', // decode thử 2 giây đầu
        '-i',
        srcPath,
        '-f',
        'null',
        '-',
      ]

      const result = await runFfmpeg({
        args,
        timeoutMs: 60_000,
      })

      if (result.code !== 0) {
        issues.push({
          trackPath: srcPath,
          trackName: track.fileName || path.basename(srcPath),
          reason: result.stderr || 'FFmpeg báo lỗi khi decode file (crossfade pre-check).',
        })
      }
    } catch (err: any) {
      issues.push({
        trackPath: srcPath,
        trackName: track.fileName || path.basename(srcPath),
        reason: err?.message || 'Lỗi không xác định khi decode file.',
      })
    }
  }

  return {
    playlistId: playlist.id,
    playlistName: playlist.name,
    issues,
  }
}

/**
 * Validate nhiều playlist cùng lúc cho crossfade
 */
export async function validatePlaylistsForCrossfade(
  req: ValidatePlaylistsForCrossfadeRequest
): Promise<ValidatePlaylistsForCrossfadeResult> {
  const results: CrossfadePlaylistCheckResult[] = []
  const crossfadeDurationSec = (() => {
    const raw = req.crossfadeDurationSec
    const fallback = 4
    if (!raw || raw <= 0) return fallback
    return Math.min(Math.max(raw, 1), 10)
  })()
  
  for (const playlistId of req.playlistIds) {
    const checkResult = await validatePlaylistForCrossfade(playlistId, crossfadeDurationSec)
    results.push(checkResult)
  }
  
  const totalWithIssues = results.filter(r => r.issues.length > 0).length
  
  return {
    results,
    totalChecked: results.length,
    totalWithIssues,
  }
}

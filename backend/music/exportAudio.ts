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
    // Normalize path: Windows backslashes -> forward slashes cho FFmpeg
    let normalizedPath = track.path.replace(/\\/g, '/')
    // Escape single quotes trong path (đã normalize thành forward slashes rồi)
    normalizedPath = normalizedPath.replace(/'/g, "\\'")
    lines.push(`file '${normalizedPath}'`)
  }

  fs.writeFileSync(listFile, lines.join('\n'), 'utf-8')
  return listFile
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
  const batchTempFiles: string[] = [] // Track batch temp files để cleanup
  let concatListFile: string | null = null // Track concat list file để cleanup
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
      if (!spaceCheck.enough) {
        return {
          success: false,
          error: `Không đủ dung lượng ổ đĩa để tạo temp files. Cần: ${formatBytes(estimatedBytes)}, Còn: ${formatBytes(diskInfo.free)}`,
        }
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
    
    // Target duration là thời lượng hiển thị trong UI (người dùng mong đợi)
    // File xuất ra PHẢI đúng thời lượng này
    const targetDurationSec = playlist.targetDurationSec || playlist.totalDurationSec
    
    // Tính duration thực tế sẽ xuất ra (sẽ được cập nhật khi có crossfade)
    let totalDurationSec = playlist.totalDurationSec

    let args: string[] = []

    if (!smoothTransitions) {
      // Giữ concat copy như cũ (nhanh, không fade)

      // Pre-normalize per-track TRƯỚC khi concat (playlist đã final cho concat mode)
      if (loudnormEnabled) {
        const normalizedPaths = await preNormalizeTracks(
          playlist.tracks, tempDir, req.playlistId, loudnormLufs, tempFiles,
          (idx, total) => {
            if (progressEmitter) progressEmitter({
              playlistId: req.playlistId, outputPath, currentSec: 0,
              totalSec: playlist.totalDurationSec,
              percent: Math.round((idx / total) * 20),
            })
          },
          (req as any).requestId, (req as any).signal,
        )
        playlist = {
          ...playlist,
          tracks: playlist.tracks.map((t, i) => ({ ...t, path: normalizedPaths[i]! })),
        }
      }

      try {
        listFile = createConcatListFile(playlist.tracks, tempDir, req.playlistId)
        if (listFile) tempFiles.add(listFile) // Fix High #2.1: Track for cleanup

        if (req.format === 'mp3') {
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
      let lastTrackDuration = playlist.tracks[playlist.tracks.length - 1]?.duration || 0
      let lastTrackRemainingSec = lastTrackDuration > crossfadeDurationSec 
        ? (lastTrackDuration - crossfadeDurationSec) 
        : 0
      
      let estimatedOutputDurationSec = playlist.totalDurationSec 
        - (crossfadeDurationSec * crossfadePoints)
        + lastTrackRemainingSec
      
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
          const availableTracks = scanResult.tracks.filter(t => !usedTrackIds.has(t.id))
          
          if (availableTracks.length === 0) {
            console.warn(`[exportAudio] Không còn bài nhạc nào để thêm vào playlist.`)
          } else {
            // Thêm bài nhạc vào playlist
            const tracksToAdd: PlaylistTrack[] = []
            let addedDuration = 0
            let lastTrackId = playlist.tracks[playlist.tracks.length - 1]?.id || ''
            
            // Shuffle available tracks để thêm ngẫu nhiên
            const shuffled = [...availableTracks].sort(() => Math.random() - 0.5)
            
            for (const track of shuffled) {
              if (tracksToAdd.length >= estimatedTracksNeeded + 10) break // Thêm thêm 10 bài để đảm bảo đủ
              
              // Tránh trùng liên tiếp
              if (track.id === lastTrackId && shuffled.length > 1) continue
              
              // Thêm bài vào danh sách
              const cumulativeDuration = playlist.totalDurationSec + addedDuration + track.duration
              tracksToAdd.push({
                ...track,
                order: playlist.tracks.length + tracksToAdd.length + 1,
                cumulativeDuration,
              })
              
              addedDuration += track.duration
              lastTrackId = track.id
              
              // Tính lại estimated duration sau khi thêm bài này
              const newTotalTracks = totalTracks + tracksToAdd.length
              const newCrossfadePoints = newTotalTracks > 1 ? newTotalTracks - 1 : 0
              const newTotalDuration = playlist.totalDurationSec + addedDuration
              const newLastTrackDuration = track.duration
              const newLastTrackRemainingSec = newLastTrackDuration > crossfadeDurationSec 
                ? (newLastTrackDuration - crossfadeDurationSec) 
                : 0
              
              const newEstimatedDuration = newTotalDuration 
                - (crossfadeDurationSec * newCrossfadePoints)
                + newLastTrackRemainingSec
              
              // Nếu đã đủ hoặc vượt target, dừng lại
              if (newEstimatedDuration >= targetDurationSec - 1.0) {
                break
              }
            }
            
            if (tracksToAdd.length > 0) {
              // Tạo playlist mới với thêm bài nhạc
              const extendedPlaylist: PlaylistDefinition = {
                ...playlist,
                tracks: [...playlist.tracks, ...tracksToAdd],
                totalDurationSec: playlist.totalDurationSec + addedDuration,
              }
              
              // Cập nhật lại các giá trị
              const newTotalTracks = extendedPlaylist.tracks.length
              const newCrossfadePoints = newTotalTracks > 1 ? newTotalTracks - 1 : 0
              const newLastTrackDuration = extendedPlaylist.tracks[extendedPlaylist.tracks.length - 1]?.duration || 0
              const newLastTrackRemainingSec = newLastTrackDuration > crossfadeDurationSec 
                ? (newLastTrackDuration - crossfadeDurationSec) 
                : 0
              
              estimatedOutputDurationSec = extendedPlaylist.totalDurationSec 
                - (crossfadeDurationSec * newCrossfadePoints)
                + newLastTrackRemainingSec
              
              console.log(
                `[exportAudio] Đã thêm ${tracksToAdd.length} bài vào playlist. ` +
                `Duration: ${playlist.totalDurationSec.toFixed(1)}s -> ${extendedPlaylist.totalDurationSec.toFixed(1)}s. ` +
                `Estimated sau crossfade: ${estimatedOutputDurationSec.toFixed(1)}s (target: ${targetDurationSec.toFixed(1)}s)`
              )
              
              // Dùng playlist mới
              playlist = extendedPlaylist
              totalTracks = newTotalTracks
              crossfadePoints = newCrossfadePoints
              lastTrackDuration = newLastTrackDuration
              lastTrackRemainingSec = newLastTrackRemainingSec
            }
          }
        } else {
          console.warn(`[exportAudio] Không có scan result để thêm bài nhạc vào playlist.`)
        }
      }

      // Pre-normalize per-track SAU khi playlist đã final (bao gồm cả bài mới thêm)
      if (loudnormEnabled) {
        const normalizedPaths = await preNormalizeTracks(
          playlist.tracks, tempDir, req.playlistId, loudnormLufs, tempFiles,
          (idx, total) => {
            if (progressEmitter) progressEmitter({
              playlistId: req.playlistId, outputPath, currentSec: 0,
              totalSec: playlist.totalDurationSec,
              percent: Math.round((idx / total) * 20),
            })
          },
          (req as any).requestId, (req as any).signal,
        )
        playlist = {
          ...playlist,
          tracks: playlist.tracks.map((t, i) => ({ ...t, path: normalizedPaths[i]! })),
        }
      }

      if (totalTracks <= MAX_TRACKS_PER_BATCH) {
        // Nếu số tracks <= MAX_TRACKS_PER_BATCH, xử lý bình thường
      args = ['-hide_banner', '-y']

      // Inputs
      playlist.tracks.forEach((track) => {
        args.push('-i', track.path)
      })

      // Filter graph
      const filterLines: string[] = []
      const inputLabels: string[] = []
      
      // Đảm bảo tất cả các bài được decode đầy đủ (không trim)
      // FIX: Bài cuối cùng cần split=2 vì stream [N-1:a] đã bị asetpts tiêu thụ,
      // không thể dùng lại [N-1:a] trong atrim ở bước sau — gây lỗi FFmpeg silent/short output.
      for (let i = 0; i < playlist.tracks.length; i++) {
        const label = `a${i}`
        inputLabels.push(`[${label}]`)
        const isLastAndNeedsAtrim =
          i === playlist.tracks.length - 1 &&
          totalTracks > 1 &&
          (playlist.tracks[i]?.duration ?? 0) > crossfadeDurationSec
        if (isLastAndNeedsAtrim) {
          // asplit tạo 2 bản: [label] cho acrossfade, [last_track_raw] cho atrim tail
          filterLines.push(`[${i}:a]asetpts=PTS-STARTPTS,asplit=2[${label}][last_track_raw]`)
        } else {
          filterLines.push(`[${i}:a]asetpts=PTS-STARTPTS[${label}]`)
        }
      }

      // Crossfade các bài với nhau
      // QUAN TRỌNG: acrossfade filter KHÔNG tự động phát hết bài cuối cùng!
      // Khi crossfade bài áp cuối với bài cuối, acrossfade sẽ:
      // - Fade out bài áp cuối trong crossfadeDurationSec
      // - Fade in bài cuối trong crossfadeDurationSec đầu
      // - NHƯNG chỉ phát đến hết phần fade in, không phát phần còn lại của bài cuối
      // Vì vậy, CẦN concat phần còn lại của bài cuối (từ crossfadeDurationSec đến hết)
      let lastLabel = inputLabels[0]
      // totalTracks đã được tính ở trên (sau khi extend playlist nếu cần)
      
      if (totalTracks === 1) {
        // Chỉ có 1 bài: không cần crossfade, chỉ copy
        filterLines.push(`${inputLabels[0]}acopy[amixout]`)
        lastLabel = '[amixout]'
      } else {
        // Crossfade các bài từ đầu đến bài áp cuối
        // Bài cuối sẽ được xử lý riêng để đảm bảo phát hết
        for (let i = 1; i < totalTracks; i++) {
          const nextLabel = inputLabels[i]
          const isLastTrack = i === totalTracks - 1
          const outLabel = isLastTrack ? 'amixout' : `acfade${i}`
          
          filterLines.push(
            `${lastLabel}${nextLabel}acrossfade=d=${crossfadeDurationSec}:c1=tri:c2=tri[${outLabel}]`
          )
          lastLabel = `[${outLabel}]`
        }
        
        // Đảm bảo lastLabel là [amixout]
        if (lastLabel !== '[amixout]') {
          filterLines.push(`${lastLabel}acopy[amixout]`)
          lastLabel = '[amixout]'
        }
      }

      // Tính toán duration sau crossfade:
      // Khi acrossfade, mỗi điểm nối (giữa 2 bài) sẽ overlap crossfadeDurationSec giây
      // - Bài đầu fade out trong crossfadeDurationSec cuối
      // - Bài sau fade in trong crossfadeDurationSec đầu
      // - Overlap = crossfadeDurationSec
      // 
      // Với N bài, có N-1 điểm nối
      // Tổng duration = tổng tất cả bài - (crossfadeDurationSec * số điểm nối)
      // 
      // Tuy nhiên, bài cuối cần được phát hết:
      // - Khi acrossfade với bài áp cuối, bài cuối chỉ fade in trong crossfadeDurationSec đầu
      // - Nếu bài cuối dài hơn crossfadeDurationSec, phần còn lại (từ crossfadeDurationSec đến hết) cần concat thêm
      // 
      // Công thức đúng:
      // Duration = tổng duration - (crossfadeDurationSec * số điểm nối) + phần còn lại của bài cuối (nếu có)
      // = tổng duration - (crossfadeDurationSec * (N-1)) + max(0, lastTrackDuration - crossfadeDurationSec)
      
      // crossfadePoints, lastTrackDuration đã được tính ở trên (sau khi extend playlist nếu cần)
      
      // Xử lý bài cuối: concat phần còn lại (sau phần fade in đã được crossfade)
      // Đảm bảo bài cuối được phát hết mà không gây im lặng
      if (totalTracks > 1 && lastTrackDuration > crossfadeDurationSec) {
        const lastTrackRemainingLabel = 'last_track_remaining'
        const remainingStartSec = crossfadeDurationSec

        // FIX: dùng [last_track_raw] (từ asplit=2 ở trên) thay vì [N-1:a] đã bị tiêu thụ rồi.
        // Dùng [last_track_raw]atrim... thay vì [${totalTracks-1}:a]atrim...
        filterLines.push(
          `[last_track_raw]atrim=start=${remainingStartSec.toFixed(3)},asetpts=PTS-STARTPTS[${lastTrackRemainingLabel}]`
        )
        
        // Concat phần crossfade với phần còn lại của bài cuối
        // Đảm bảo không có gap bằng cách dùng concat với cùng sample rate và reset PTS
        filterLines.push(
          `[amixout][${lastTrackRemainingLabel}]concat=n=2:v=0:a=1[final_crossfade]`
        )
        lastLabel = '[final_crossfade]'
      }
      // Nếu bài cuối ngắn hơn hoặc bằng crossfadeDurationSec, acrossfade đã phát hết rồi
      
      // Tính toán duration thực tế sau crossfade
      // Công thức: tổng duration - (crossfade * số điểm nối) + phần còn lại của bài cuối
      let lastTrackRemainingSec = lastTrackDuration > crossfadeDurationSec 
        ? (lastTrackDuration - crossfadeDurationSec) 
        : 0
      
      let estimatedOutputDurationSec = playlist.totalDurationSec 
        - (crossfadeDurationSec * crossfadePoints)
        + lastTrackRemainingSec
      
      // Debug logging để kiểm tra tính toán
      console.log(`[exportAudio] Crossfade duration calculation:`)
      console.log(`  - Total tracks: ${totalTracks}`)
      console.log(`  - Crossfade points: ${crossfadePoints}`)
      console.log(`  - Crossfade duration: ${crossfadeDurationSec}s`)
      console.log(`  - Playlist total duration: ${playlist.totalDurationSec.toFixed(2)}s`)
      console.log(`  - Last track duration: ${lastTrackDuration.toFixed(2)}s`)
      console.log(`  - Last track remaining: ${lastTrackRemainingSec.toFixed(2)}s`)
      console.log(`  - Estimated output duration: ${estimatedOutputDurationSec.toFixed(2)}s`)
      console.log(`  - Formula: ${playlist.totalDurationSec.toFixed(2)} - (${crossfadeDurationSec} * ${crossfadePoints}) + ${lastTrackRemainingSec.toFixed(2)} = ${estimatedOutputDurationSec.toFixed(2)}s`)
      
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
          const availableTracks = scanResult.tracks.filter(t => !usedTrackIds.has(t.id))
          
          if (availableTracks.length === 0) {
            console.warn(`[exportAudio] Không còn bài nhạc nào để thêm vào playlist.`)
          } else {
            // Thêm bài nhạc vào playlist
            const tracksToAdd: PlaylistTrack[] = []
            let addedDuration = 0
            let lastTrackId = playlist.tracks[playlist.tracks.length - 1]?.id || ''
            
            // Shuffle available tracks để thêm ngẫu nhiên
            const shuffled = [...availableTracks].sort(() => Math.random() - 0.5)
            
            for (const track of shuffled) {
              if (tracksToAdd.length >= estimatedTracksNeeded + 10) break // Thêm thêm 10 bài để đảm bảo đủ
              
              // Tránh trùng liên tiếp
              if (track.id === lastTrackId && shuffled.length > 1) continue
              
              // Thêm bài vào danh sách
              const cumulativeDuration = playlist.totalDurationSec + addedDuration + track.duration
              tracksToAdd.push({
                ...track,
                order: playlist.tracks.length + tracksToAdd.length + 1,
                cumulativeDuration,
              })
              
              addedDuration += track.duration
              lastTrackId = track.id
              
              // Tính lại estimated duration sau khi thêm bài này
              const newTotalTracks = totalTracks + tracksToAdd.length
              const newCrossfadePoints = newTotalTracks > 1 ? newTotalTracks - 1 : 0
              const newTotalDuration = playlist.totalDurationSec + addedDuration
              const newLastTrackDuration = track.duration
              const newLastTrackRemainingSec = newLastTrackDuration > crossfadeDurationSec 
                ? (newLastTrackDuration - crossfadeDurationSec) 
                : 0
              
              const newEstimatedDuration = newTotalDuration 
                - (crossfadeDurationSec * newCrossfadePoints)
                + newLastTrackRemainingSec
              
              // Nếu đã đủ hoặc vượt target, dừng lại
              if (newEstimatedDuration >= targetDurationSec - 1.0) {
                break
              }
            }
            
            if (tracksToAdd.length > 0) {
              // Tạo playlist mới với thêm bài nhạc
              const extendedPlaylist: PlaylistDefinition = {
                ...playlist,
                tracks: [...playlist.tracks, ...tracksToAdd],
                totalDurationSec: playlist.totalDurationSec + addedDuration,
              }
              
              // Cập nhật lại các giá trị
              const newTotalTracks = extendedPlaylist.tracks.length
              const newCrossfadePoints = newTotalTracks > 1 ? newTotalTracks - 1 : 0
              const newLastTrackDuration = extendedPlaylist.tracks[extendedPlaylist.tracks.length - 1]?.duration || 0
              const newLastTrackRemainingSec = newLastTrackDuration > crossfadeDurationSec 
                ? (newLastTrackDuration - crossfadeDurationSec) 
                : 0
              
              estimatedOutputDurationSec = extendedPlaylist.totalDurationSec 
                - (crossfadeDurationSec * newCrossfadePoints)
                + newLastTrackRemainingSec
              
              console.log(
                `[exportAudio] Đã thêm ${tracksToAdd.length} bài vào playlist. ` +
                `Duration: ${playlist.totalDurationSec.toFixed(1)}s -> ${extendedPlaylist.totalDurationSec.toFixed(1)}s. ` +
                `Estimated sau crossfade: ${estimatedOutputDurationSec.toFixed(1)}s (target: ${targetDurationSec.toFixed(1)}s)`
              )
              
              // Dùng playlist mới
              playlist = extendedPlaylist
              totalTracks = newTotalTracks
              crossfadePoints = newCrossfadePoints
              lastTrackDuration = newLastTrackDuration
              lastTrackRemainingSec = newLastTrackRemainingSec
              
              // Cập nhật lại inputLabels và filterLines với số tracks mới
              // Cần rebuild filter graph với số tracks mới
              // Tạm thời, sẽ rebuild ở dưới
            }
          }
        } else {
          console.warn(`[exportAudio] Không có scan result để thêm bài nhạc vào playlist.`)
        }
      }
      
      // Progress tracking dùng estimated duration (thời lượng thực tế sau crossfade)
      totalDurationSec = estimatedOutputDurationSec
      
      // Emit progress ban đầu với target duration (thời lượng hiển thị trong UI)
      // Để UI cập nhật totalSec đúng từ đầu
      if (progressEmitter) {
        progressEmitter({
          playlistId: req.playlistId,
          outputPath, // outputPath đã được tính ở trên (dòng 166)
          currentSec: 0,
          totalSec: totalDurationSec,
          percent: 0,
        })
      }

      const filterComplex = filterLines.join(';')

      args.push(
        '-filter_complex',
        filterComplex,
        '-map',
        lastLabel,
        '-ar',
        '48000',
        '-ac',
        '2'
      )

      if (req.format === 'mp3') {
        args.push('-acodec', 'libmp3lame', '-b:a', `${(bitrate ?? 320)}k`)
      } else if (req.format === 'aac') {
        args.push('-acodec', 'aac', '-b:a', `${(bitrate ?? 384)}k`)
      } else {
        args.push('-acodec', 'pcm_s16le')
      }

      // KHÔNG dùng -t để cắt - để FFmpeg xuất hết audio thực tế
      // Nếu muốn đúng target duration, cần thêm bài nhạc vào playlist, không phải cắt/pad
      args.push(outputPath)
      } else {
        // Nếu số tracks > MAX_TRACKS_PER_BATCH, xử lý theo batch
        console.log(`[ExportAudio] Playlist có ${totalTracks} tracks, chia thành batch để tránh memory issue`)
        
        // Chia tracks thành các batch
        const batches: PlaylistDefinition['tracks'][] = []
        for (let i = 0; i < totalTracks; i += MAX_TRACKS_PER_BATCH) {
          batches.push(playlist.tracks.slice(i, i + MAX_TRACKS_PER_BATCH))
        }
        
        // Xử lý từng batch và lưu vào file temp
        const batchOutputFiles: string[] = []
        let processedDuration = 0
        
        for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
          const batch = batches[batchIdx]
          const batchOutputFile = path.join(tempDir, `batch-${req.playlistId}-${batchIdx}-${Date.now()}.wav`)
          batchOutputFiles.push(batchOutputFile)
          batchTempFiles.push(batchOutputFile) // Track để cleanup
          tempFiles.add(batchOutputFile) // Fix High #2.1: Track in Set for better cleanup
          
          // Tạo filter graph cho batch này
          const batchFilterLines: string[] = []
          const batchInputLabels: string[] = []
          
          // Inputs cho batch
          const batchArgs: string[] = ['-hide_banner', '-y']
          batch.forEach((track) => {
            batchArgs.push('-i', track.path)
          })
          
          // Tạo labels cho batch
          // FIX: Bài cuối của batch cuối cùng cần asplit=2 vì [N-1:a] bị asetpts tiêu thụ,
          // không thể dùng lại [N-1:a] trong atrim (gây lỗi FFmpeg silent/wrong output).
          const isLastBatch = batchIdx === batches.length - 1
          const lastBatchTrackDuration = batch[batch.length - 1]?.duration ?? 0
          const lastBatchNeedsAtrim = isLastBatch && batch.length > 1 && lastBatchTrackDuration > crossfadeDurationSec
          for (let i = 0; i < batch.length; i++) {
            const label = `a${i}`
            batchInputLabels.push(`[${label}]`)
            if (lastBatchNeedsAtrim && i === batch.length - 1) {
              // asplit=2: [label] → acrossfade, [batch_last_raw] → atrim tail
              batchFilterLines.push(`[${i}:a]asetpts=PTS-STARTPTS,asplit=2[${label}][batch_last_raw]`)
            } else {
              batchFilterLines.push(`[${i}:a]asetpts=PTS-STARTPTS[${label}]`)
            }
          }
          
          // Crossfade trong batch
          let batchLastLabel = batchInputLabels[0]
          const batchTrackCount = batch.length
          
          if (batchTrackCount === 1) {
            batchFilterLines.push(`${batchInputLabels[0]}acopy[batchout]`)
            batchLastLabel = '[batchout]'
          } else {
            for (let i = 1; i < batchTrackCount; i++) {
              const nextLabel = batchInputLabels[i]
              const isLastInBatch = i === batchTrackCount - 1
              const outLabel = isLastInBatch ? 'batchout' : `batchfade${i}`
              
              batchFilterLines.push(
                `${batchLastLabel}${nextLabel}acrossfade=d=${crossfadeDurationSec}:c1=tri:c2=tri[${outLabel}]`
              )
              batchLastLabel = `[${outLabel}]`
            }
            
            if (batchLastLabel !== '[batchout]') {
              batchFilterLines.push(`${batchLastLabel}acopy[batchout]`)
              batchLastLabel = '[batchout]'
            }
          }
          
          // Xử lý bài cuối của batch (nếu không phải batch cuối cùng, không cần xử lý đặc biệt)
          // Nếu là batch cuối cùng, cần đảm bảo bài cuối phát hết
          // FIX: dùng [batch_last_raw] (từ asplit=2 ở trên) thay vì [N-1:a] đã bị tiêu thụ.
          // lastBatchNeedsAtrim đã được tính sẵn khi tạo label ở trên.
          if (lastBatchNeedsAtrim) {
            const lastTrackRemainingLabel = 'batch_last_remaining'
            batchFilterLines.push(
              `[batch_last_raw]atrim=start=${crossfadeDurationSec.toFixed(3)},asetpts=PTS-STARTPTS[${lastTrackRemainingLabel}]`
            )
            batchFilterLines.push(
              `[batchout][${lastTrackRemainingLabel}]concat=n=2:v=0:a=1[batchfinal]`
            )
            batchLastLabel = '[batchfinal]'
          }
          
          const batchFilterComplex = batchFilterLines.join(';')
          
          batchArgs.push(
            '-filter_complex',
            batchFilterComplex,
            '-map',
            batchLastLabel,
            '-ar',
            '44100',
            '-ac',
            '2',
            '-acodec',
            'pcm_s16le', // Luôn dùng WAV cho batch temp
            batchOutputFile
          )
          
          // Chạy FFmpeg cho batch này
          console.log(`[ExportAudio] Xử lý batch ${batchIdx + 1}/${batches.length} (${batch.length} tracks)...`)
          const batchResult = await runFfmpeg({
            args: batchArgs,
            timeoutMs: 3600000,
            requestId: (req as any).requestId,
            signal: (req as any).signal,
            onProgress: (p) => {
              if (!progressEmitter) return
              // Tính progress tổng thể
              const batchProgress = p.timeSec / (batch.reduce((sum, t) => sum + t.duration, 0) || 1)
              const batchWeight = batch.length / totalTracks
              const overallProgress = (processedDuration + p.timeSec) / totalDurationSec
              const percent = Math.max(0, Math.min(100, overallProgress * 100))
              
              progressEmitter({
                playlistId: req.playlistId,
                outputPath,
                currentSec: processedDuration + p.timeSec,
                totalSec: totalDurationSec,
                percent,
              })
            },
          })
          
          if (batchResult.code !== 0) {
            // Fix High #2.1: Cleanup all temp files when batch fails
            tempFiles.forEach(f => {
              if (fs.existsSync(f)) {
                try { fs.unlinkSync(f) } catch {}
              }
            })
            return {
              success: false,
              error: `Batch ${batchIdx + 1} failed: ${batchResult.stderr || 'Unknown error'}`,
            }
          }
          
          // Cập nhật processed duration
          const batchDuration = batch.reduce((sum, t) => sum + t.duration, 0)
          processedDuration += batchDuration
        }
        
        // Concat tất cả các batch lại
        console.log(`[ExportAudio] Concat ${batches.length} batches...`)
        concatListFile = path.join(tempDir, `concat-batches-${req.playlistId}-${Date.now()}.txt`)
        tempFiles.add(concatListFile) // Fix High #2.1: Track for cleanup
        const concatLines = batchOutputFiles.map(f => {
          const normalizedPath = f.replace(/\\/g, '/').replace(/'/g, "\\'")
          return `file '${normalizedPath}'`
        })
        fs.writeFileSync(concatListFile, concatLines.join('\n'), 'utf-8')
        
        // Tạo args để concat các batch
        args = [
          '-hide_banner',
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatListFile,
          '-vn',
          '-ar',
          '48000',
          '-ac',
          '2',
        ]
        
        if (req.format === 'mp3') {
          args.push('-acodec', 'libmp3lame', '-b:a', `${(bitrate ?? 320)}k`)
        } else if (req.format === 'aac') {
          args.push('-acodec', 'aac', '-b:a', `${(bitrate ?? 384)}k`)
        } else {
          args.push('-acodec', 'pcm_s16le')
        }

        // KHÔNG dùng -t để cắt - để FFmpeg xuất hết audio thực tế
        // Nếu muốn đúng target duration, cần thêm bài nhạc vào playlist, không phải cắt/pad
        args.push(outputPath)
      }
    }

    // 7. Chạy FFmpeg
    console.log('[ExportAudio] Running FFmpeg with args:', args)
    // Lấy requestId từ req nếu có (được pass từ jobQueue context)
    const requestId = (req as any).requestId
    const result = await runFfmpeg({
      args,
      timeoutMs: 3600000, // 1 hour timeout
      requestId, // Pass requestId để register vào videoJobManager
      signal: (req as any).signal, // Pass AbortSignal từ jobQueue context
      onStderrChunk: (chunk) => {
        // Log progress (FFmpeg thường log vào stderr)
        process.stdout.write(chunk)
      },
      onProgress: (p) => {
        if (!totalDurationSec || !progressEmitter) return
        const percent = Math.max(0, Math.min(100, (p.timeSec / totalDurationSec) * 100))
        progressEmitter({
          playlistId: req.playlistId,
          outputPath,
          currentSec: p.timeSec,
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
        addHistoryEntry({
          playlistId: playlist.id,
          playlistName: playlist.name,
          outputPath,
          tracks: playlist.tracks.map((t) => ({
            name: t.fileName,
            path: t.path,
            durationSec: t.duration,
            startSec: (t.cumulativeDuration ?? t.duration) - t.duration,
          })),
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
      // Cleanup all tracked temp files
      tempFiles.forEach(f => {
        try {
          if (fs.existsSync(f)) {
            fs.unlinkSync(f)
          }
        } catch (err) {
          console.warn(`[ExportAudio] Failed to delete temp file ${f}:`, err)
        }
      })
      
      // Also cleanup batch temp files (backward compatibility)
      batchTempFiles.forEach(f => {
        if (!tempFiles.has(f) && fs.existsSync(f)) {
          try {
            fs.unlinkSync(f)
          } catch (err) {
            console.warn(`[ExportAudio] Failed to delete batch temp file ${f}:`, err)
          }
        }
      })
      
      // Cleanup listFile and concatListFile if not already in tempFiles
      if (listFile && !tempFiles.has(listFile) && fs.existsSync(listFile)) {
        try {
          fs.unlinkSync(listFile)
        } catch (err) {
          console.warn('[ExportAudio] Failed to delete temp list file:', err)
        }
      }
      
      if (concatListFile && !tempFiles.has(concatListFile) && fs.existsSync(concatListFile)) {
        try {
          fs.unlinkSync(concatListFile)
        } catch (err) {
          console.warn('[ExportAudio] Failed to delete concat list file:', err)
        }
      }
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
  
  for (const playlistId of req.playlistIds) {
    const checkResult = await validatePlaylistForCrossfade(playlistId)
    results.push(checkResult)
  }
  
  const totalWithIssues = results.filter(r => r.issues.length > 0).length
  
  return {
    results,
    totalChecked: results.length,
    totalWithIssues,
  }
}

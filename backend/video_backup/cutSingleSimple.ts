/**
 * VIDEO CUT SINGLE - Đơn giản, nhanh, ưu tiên tốc độ
 * Cắt 1 video thành nhiều đoạn bằng FFmpeg segment muxer (1 lệnh duy nhất)
 * 
 * Pipeline:
 * - Dùng 1 lệnh FFmpeg với segment muxer: -f segment -segment_time X
 * - Copy stream (-c copy), không re-encode, tốc độ cực nhanh
 * - Chấp nhận sai số vài giây do keyframe alignment
 * 
 * Success condition:
 * - exitCode === 0
 * - segmentCount > 0 (có ít nhất 1 file output khớp pattern)
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import { getVideoFileInfo } from './videoInfo'

export interface CutSingleSimpleRequest {
  inputPath: string
  outputDir: string
  segmentLengthSec: number
  format?: 'mp4' | 'mkv'
}

export interface CutSingleSimpleResult {
  requestId: string
  outputFiles: string[]
  segmentCount: number
  elapsedMs: number
  avgSpeed: number // Tốc độ trung bình (lần realtime, vd: 22.3x)
  success: boolean
  error?: string
}

/**
 * Sanitize tên file để tránh ký tự đặc biệt
 */
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
}

/**
 * Escape regex special characters
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Trích số thứ tự từ tên file segment
 * Ví dụ: "done_2_part_001.mp4" → 1
 */
function extractPartIndex(fileName: string, baseName: string): number {
  const re = new RegExp('^' + escapeRegExp(baseName) + '_part_(\\d+)', 'i')
  const m = fileName.match(re)
  return m ? parseInt(m[1], 10) : 0
}

/**
 * Cắt video thành nhiều đoạn bằng FFmpeg segment muxer
 * 
 * Pipeline đơn giản:
 * 1. Lấy baseName từ inputPath
 * 2. Tạo output pattern: {baseName}_part_%03d{ext}
 * 3. Chạy 1 lệnh FFmpeg với segment muxer
 * 4. Verify số file thật sự tồn tại
 * 5. Trả về danh sách file
 */
export async function cutVideoIntoSegmentsSimple(
  req: CutSingleSimpleRequest,
  onProgress?: (message: string, requestId: string) => void
): Promise<CutSingleSimpleResult> {
  const requestId = randomUUID()
  
  // Emit initial progress
  if (onProgress) {
    onProgress('Đang khởi tạo...', requestId)
  }

  try {
    // 1. Validate input
    if (!fs.existsSync(req.inputPath)) {
      throw new Error(`File video không tồn tại: ${req.inputPath}`)
    }

    if (!fs.existsSync(req.outputDir)) {
      fs.mkdirSync(req.outputDir, { recursive: true })
    }

    if (req.segmentLengthSec <= 0) {
      throw new Error('Thời lượng mỗi đoạn phải > 0')
    }

    // 1.5. Probe video để lấy duration (chỉ lấy duration, không metadata nặng)
    let totalDurationSec = 0
    try {
      const videoInfo = await getVideoFileInfo(req.inputPath)
      totalDurationSec = videoInfo.durationSec || 0
      console.log(`[cutSingleSimple] Video duration: ${totalDurationSec.toFixed(2)}s`)
    } catch (err) {
      console.warn('[cutSingleSimple] Failed to probe video duration, will estimate from segments:', err)
      // Sẽ estimate sau từ segmentCount
    }

    // 2. Tạo baseName và output pattern
    // Lấy extension từ input file gốc (giữ nguyên format)
    const inputExt = path.extname(req.inputPath) || '.mp4'
    const inputBaseName = path.basename(req.inputPath, inputExt)
    const safeBaseName = sanitizeFileName(inputBaseName)
    
    // Dùng extension từ input file, hoặc fallback theo format request
    let ext = inputExt
    if (!ext || ext === '') {
      const format = req.format ?? 'mp4'
      ext = format === 'mp4' ? '.mp4' : '.mkv'
    }
    
    // Output pattern: {baseName}_part_%03d{ext}
    // %03d = 000, 001, 002, ... (3 chữ số, zero-padded)
    const outputPattern = path.join(req.outputDir, `${safeBaseName}_part_%03d${ext}`)

    // Debug log: in rõ các thông tin quan trọng
    console.log(`[cutSingleSimple] ===== DEBUG INFO =====`)
    console.log(`[cutSingleSimple] inputPath: ${req.inputPath}`)
    console.log(`[cutSingleSimple] outputDir: ${req.outputDir}`)
    console.log(`[cutSingleSimple] safeBaseName: ${safeBaseName}`)
    console.log(`[cutSingleSimple] ext: ${ext}`)
    console.log(`[cutSingleSimple] outputPattern: ${outputPattern}`)
    console.log(`[cutSingleSimple] segmentLengthSec: ${req.segmentLengthSec}`)
    console.log(`[cutSingleSimple] totalDurationSec: ${totalDurationSec.toFixed(2)}s`)
    console.log(`[cutSingleSimple] ffmpeg single-shot segment muxer ENABLED`)

    // 3. Build FFmpeg args
    const paths = getFfmpegPaths()
    let ffmpegPath = paths.ffmpeg

    // Windows long path support
    if (process.platform === 'win32' && ffmpegPath.match(/^[A-Z]:\\.*$/) && ffmpegPath.length > 240) {
      if (!ffmpegPath.startsWith('\\\\?\\')) {
        ffmpegPath = '\\\\?\\' + ffmpegPath
      }
    }

    // FFmpeg command với segment muxer:
    // ffmpeg -v error -stats -i input -c copy -map 0 -f segment -segment_time X -reset_timestamps 1 -avoid_negative_ts make_zero output
    const args = [
      '-v', 'error',           // Chỉ hiển thị errors
      '-stats',                // Hiển thị stats (time, bitrate, ...)
      '-i', req.inputPath,     // Input file
      '-c', 'copy',            // Copy stream (không re-encode)
      '-map', '0',             // Map tất cả streams
      '-f', 'segment',         // Segment muxer
      '-segment_time', String(req.segmentLengthSec), // Thời lượng mỗi segment
      '-reset_timestamps', '1', // Reset timestamps cho mỗi segment
      '-avoid_negative_ts', 'make_zero', // Tránh negative timestamps
      outputPattern,           // Output pattern
      '-y',                    // Overwrite output files
    ]

    console.log(`[singleCutDebug] ffmpeg args:`, args.join(' '))

    if (onProgress) {
      onProgress('Đang cắt video...', requestId)
    }

    // 4. Chạy FFmpeg (1 lệnh duy nhất với segment muxer)
    const startTime = Date.now()
    const result = await new Promise<{ code: number; stderr: string; avgSpeedX?: number }>((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath, args, {
        stdio: ['ignore', 'ignore', 'pipe'], // Chỉ capture stderr
      })

      let stderr = ''
      let lastSpeedX: number | undefined = undefined

      const progressStartTime = Date.now()
      let lastProgressTime = 0

      ffmpeg.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString('utf-8')
        stderr += chunk
        
        // Parse time từ stderr: "time=00:01:23.45"
        const timeMatch = chunk.match(/time=([0-9:.]+)/)
        if (timeMatch && timeMatch[1] && totalDurationSec > 0) {
          const timeStr = timeMatch[1]
          const parts = timeStr.split(':')
          if (parts.length === 3) {
            const hours = parseFloat(parts[0]) || 0
            const minutes = parseFloat(parts[1]) || 0
            const seconds = parseFloat(parts[2]) || 0
            const currentTimeSec = hours * 3600 + minutes * 60 + seconds
            
            // Chỉ emit progress mỗi 0.5 giây để tránh spam
            if (currentTimeSec - lastProgressTime >= 0.5) {
              lastProgressTime = currentTimeSec
              
              // Tính progress
              const percent = totalDurationSec > 0 ? (currentTimeSec / totalDurationSec) * 100 : 0
              const currentSegment = req.segmentLengthSec > 0 ? Math.floor(currentTimeSec / req.segmentLengthSec) + 1 : 1
              const totalSegments = Math.ceil(totalDurationSec / req.segmentLengthSec)
              
              // Tính speedX và etaSec
              const elapsedSec = (Date.now() - progressStartTime) / 1000
              const speedX = elapsedSec > 0 && currentTimeSec > 0 ? currentTimeSec / elapsedSec : null
              const remainingSec = Math.max(0, totalDurationSec - currentTimeSec)
              const etaSec = speedX && speedX > 0 ? remainingSec / speedX : null
              
              // Emit progress với đầy đủ thông tin
              if (onProgress) {
                const progressData = {
                  timeSec: currentTimeSec,
                  totalDurationSec,
                  percent: Math.min(100, Math.max(0, percent)),
                  speedX,
                  etaSec,
                  currentSegment: Math.min(currentSegment, totalSegments),
                  totalSegments,
                }
                onProgress(JSON.stringify(progressData), requestId)
              }
            }
          }
        }
        
        // Parse speed từ stderr: "speed=45.6x" hoặc "speed=  45.6x"
        const speedMatch = chunk.match(/speed=\s*([0-9.]+)x/i)
        if (speedMatch && speedMatch[1]) {
          const speed = parseFloat(speedMatch[1])
          if (!isNaN(speed) && speed > 0) {
            lastSpeedX = speed
            console.log(`[singleCutDebug] FFmpeg speed: ${speed.toFixed(1)}x`)
          }
        }
        
        // Log progress nếu có (optional, không bắt buộc)
        if (chunk.includes('time=')) {
          console.log(`[singleCutDebug] FFmpeg progress: ${chunk.trim()}`)
        }
      })

      ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg spawn error: ${error.message}`))
      })

      ffmpeg.on('close', (code) => {
        resolve({ code: code ?? 1, stderr, avgSpeedX: lastSpeedX })
      })
    })

    const endTime = Date.now()
    const elapsedMs = endTime - startTime
    const exitCode = result.code
    const stderrStr = result.stderr

    console.log(`[cutSingleSimple] FFmpeg exit code: ${exitCode}, elapsed: ${elapsedMs}ms`)

    // 5. Thu thập file output thật sự tồn tại
    const allFiles = fs.readdirSync(req.outputDir)
    const pattern = new RegExp(
      '^' + escapeRegExp(safeBaseName) + '_part_\\d+' + escapeRegExp(ext) + '$',
      'i'
    )

    console.log(`[cutSingleSimple] ===== FILE DETECTION =====`)
    console.log(`[cutSingleSimple] Pattern regex: ${pattern}`)
    console.log(`[cutSingleSimple] All files in outputDir (${allFiles.length}):`, allFiles.slice(0, 10))

    const segmentFiles = allFiles.filter((file) => {
      const filePath = path.join(req.outputDir, file)
      const isFile = fs.statSync(filePath).isFile()
      const matches = pattern.test(file)
      if (matches) {
        console.log(`[cutSingleSimple] ✓ Matched: ${file}`)
      }
      return isFile && matches
    })

    console.log(`[cutSingleSimple] Found ${segmentFiles.length} segment files matching pattern`)
    console.log(`[cutSingleSimple] Segment files:`, segmentFiles.slice(0, 20))

    // 6. Kiểm tra điều kiện thành công/thất bại
    // THẤT BẠI nếu:
    // - exitCode !== 0
    // - exitCode === 0 nhưng segmentCount === 0
    if (exitCode !== 0) {
      const errorMsg = `[cutSingleSimple] FFmpeg exited with code ${exitCode}. stderr: ${stderrStr.slice(0, 4000)}`
      console.error(`[cutSingleSimple] ERROR: ${errorMsg}`)
      throw new Error(errorMsg)
    }

    // Kiểm tra kỹ: nếu exitCode === 0 nhưng không có file, có thể do:
    // 1. Pattern không match (safeBaseName hoặc ext sai)
    // 2. File được tạo ở nơi khác
    // 3. FFmpeg không tạo file (lỗi silent)
    if (segmentFiles.length === 0) {
      // Debug: liệt kê tất cả files để tìm pattern gần đúng
      const allFileNames = allFiles.filter(f => {
        const filePath = path.join(req.outputDir, f)
        return fs.statSync(filePath).isFile()
      })
      console.error(`[cutSingleSimple] ERROR: No segment files found!`)
      console.error(`[cutSingleSimple] Expected pattern: ${safeBaseName}_part_XXX${ext}`)
      console.error(`[cutSingleSimple] All files in directory:`, allFileNames)
      console.error(`[cutSingleSimple] safeBaseName: "${safeBaseName}", ext: "${ext}"`)
      
      // Nếu có file nhưng không match pattern, có thể do safeBaseName bị thay đổi
      const similarFiles = allFileNames.filter(f => f.includes('_part_') || f.endsWith(ext))
      if (similarFiles.length > 0) {
        console.error(`[cutSingleSimple] Found similar files (may be segments):`, similarFiles)
      }
      
      const errorMsg = `[cutSingleSimple] FFmpeg exitCode=0 nhưng không tìm thấy file output khớp pattern "${safeBaseName}_part_XXX${ext}" trong thư mục ${req.outputDir}. Tìm thấy ${allFileNames.length} file(s) khác.`
      console.error(`[cutSingleSimple] ERROR: ${errorMsg}`)
      throw new Error(errorMsg)
    }

    // THÀNH CÔNG: exitCode === 0 và có file output

    // 7. Sắp xếp segments theo số thứ tự
    const sortedSegmentFiles = segmentFiles.sort(
      (a, b) => extractPartIndex(a, safeBaseName) - extractPartIndex(b, safeBaseName)
    )

    console.log(`[cutSingleSimple] Sorted ${sortedSegmentFiles.length} segments`)
    console.log(`[cutSingleSimple] First 5 sorted files:`, sortedSegmentFiles.slice(0, 5))

    // 8. Rename thành 1.ext, 2.ext, ..., N.ext
    const finalOutputFiles: string[] = []
    sortedSegmentFiles.forEach((oldName, idx) => {
      const oldPath = path.join(req.outputDir, oldName)
      const newName = `${idx + 1}${ext}`
      const newPath = path.join(req.outputDir, newName)

      if (idx < 5 || idx === sortedSegmentFiles.length - 1) {
        console.log(`[cutSingleSimple] Rename segment ${idx + 1}/${sortedSegmentFiles.length}: ${oldName} → ${newName}`)
      }

      // Xóa file cũ nếu đã tồn tại (tránh conflict)
      if (fs.existsSync(newPath)) {
        console.log(`[cutSingleSimple] Warning: File ${newName} already exists, deleting...`)
        fs.unlinkSync(newPath)
      }

      fs.renameSync(oldPath, newPath)
      finalOutputFiles.push(newPath)
    })

    console.log(`[cutSingleSimple] ===== RENAME COMPLETE =====`)
    console.log(`[cutSingleSimple] Renamed ${finalOutputFiles.length} segments to 1..N`)
    console.log(`[cutSingleSimple] Final output files (first 10):`, finalOutputFiles.slice(0, 10).map(f => path.basename(f)))

    const segmentCount = finalOutputFiles.length

    // 9. Tính tốc độ trung bình
    // Dùng totalDurationSec từ probe, hoặc estimate từ segmentCount * segmentLengthSec
    const finalTotalDurationSec = totalDurationSec > 0 
      ? totalDurationSec 
      : segmentCount * req.segmentLengthSec
    const processingSeconds = elapsedMs / 1000
    const avgSpeed = finalTotalDurationSec > 0 && processingSeconds > 0
      ? finalTotalDurationSec / processingSeconds
      : 0

    console.log(`[cutSingleSimple] Successfully created ${segmentCount} segments`)
    console.log(`[cutSingleSimple] Elapsed: ${elapsedMs}ms (${processingSeconds.toFixed(2)}s)`)
    console.log(`[cutSingleSimple] Average speed: ${avgSpeed.toFixed(1)}x`)
    
    if (onProgress) {
      onProgress(`Đã cắt thành ${segmentCount} đoạn (tốc độ ≈ ${avgSpeed.toFixed(1)}x)`, requestId)
    }

    return {
      requestId,
      outputFiles: finalOutputFiles,
      segmentCount,
      elapsedMs,
      avgSpeed,
      success: true,
    }

  } catch (error: any) {
    console.error(`[cutSingleSimple] Exception:`, error)
    
    return {
      requestId,
      outputFiles: [],
      segmentCount: 0,
      elapsedMs: 0,
      avgSpeed: 0,
      success: false,
      error: error?.message || 'Lỗi không xác định khi cắt video',
    }
  }
}


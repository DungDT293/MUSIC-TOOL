import { spawn } from 'child_process'
import fs from 'node:fs'
import { getFfmpegPaths } from '../ffmpeg/config'
import { probeFile } from '../ffmpeg/probe'

export interface VideoVerificationResult {
  durationSec: number
  fps: number | null
  videoCodec: string | null
  audioCodec: string | null
  width: number | null
  height: number | null
  codedWidth: number | null
  codedHeight: number | null
  resolutionMismatch: boolean
  fileSizeBytes: number | null
  bitRate: number | null
  formatName: string | null
  durationDiffSec: number | null
  durationWarning: boolean
  decodeOk: boolean
  decodeStderrTail: string
  decodeExitCode: number | null
  hasVideoStream: boolean
  hasAudioStream: boolean
}

function parseFps(rate?: string | number | null): number | null {
  if (typeof rate === 'number') {
    return Number.isFinite(rate) && rate > 0 ? rate : null
  }
  if (!rate || rate === '0/0') return null
  const parts = rate.split('/')
  if (parts.length === 2) {
    const num = Number(parts[0])
    const den = Number(parts[1])
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null
    const result = num / den
    return Number.isFinite(result) && result > 0 ? result : null
  }
  const value = Number(rate)
  return Number.isFinite(value) && value > 0 ? value : null
}

export async function verifyOutputVideo(
  outputPath: string,
  opts?: {
    expectedDurationSec?: number | null
    toleranceSec?: number
    decodeWindowSec?: number
    decodeTimeoutMs?: number
    onLog?: (msg: string) => void
  }
): Promise<VideoVerificationResult> {
  const {
    expectedDurationSec = null,
    toleranceSec = 5,
    decodeWindowSec = 60,
    decodeTimeoutMs = 90_000,
    onLog,
  } = opts || {}

  const info = await probeFile(outputPath)
  const durationSec = info?.format?.duration ?? 0
  const videoStream = info?.video
  const audioStream = info?.audio

  const fps =
    parseFps((videoStream as any)?.fps) ??
    parseFps((videoStream as any)?.avg_frame_rate) ??
    parseFps((videoStream as any)?.r_frame_rate) ??
    null

  const videoCodec = (videoStream as any)?.codec ?? (videoStream as any)?.codec_name ?? null
  const audioCodec = (audioStream as any)?.codec ?? (audioStream as any)?.codec_name ?? null
  const hasVideoStream = !!videoStream
  const hasAudioStream = !!audioStream

  const width = videoStream?.width && videoStream.width > 0 ? videoStream.width : null
  const height = videoStream?.height && videoStream.height > 0 ? videoStream.height : null
  const codedWidth =
    videoStream?.coded_width && videoStream.coded_width > 0 ? videoStream.coded_width : null
  const codedHeight =
    videoStream?.coded_height && videoStream.coded_height > 0 ? videoStream.coded_height : null

  // Resolution mismatch: chỉ flag khi coded NHỎ HƠN display (= stream thật bị
  // truncate / thiếu dữ liệu). KHÔNG flag khi coded >= display: H.264 pad lên bội
  // số 16 macroblock là BÌNH THƯỜNG (1920x1080 → coded 1920x1088, 1080 không chia hết 16).
  // Bug cũ dùng `!==` làm reject mọi video 1080p.
  const resolutionMismatch =
    width != null &&
    height != null &&
    codedWidth != null &&
    codedHeight != null &&
    (codedWidth < width || codedHeight < height)

  let fileSizeBytes: number | null = null
  try {
    const st = fs.statSync(outputPath)
    fileSizeBytes = st.size
  } catch {
    fileSizeBytes = null
  }
  const bitRate = info?.format?.bit_rate ?? null
  const formatName = info?.format?.format_name ?? null

  let durationDiffSec: number | null = null
  let durationWarning = false
  if (expectedDurationSec && expectedDurationSec > 0 && durationSec > 0) {
    durationDiffSec = Math.abs(durationSec - expectedDurationSec)
    durationWarning = durationDiffSec > toleranceSec
  }

  // Log full probe summary — luôn log để debug retroactive khi fail.
  const resStr =
    width != null && height != null
      ? `${width}x${height}` +
        (resolutionMismatch ? ` (header) vs ${codedWidth}x${codedHeight} (coded) MISMATCH` : '')
      : 'unknown'
  const sizeMB = fileSizeBytes != null ? (fileSizeBytes / 1024 / 1024).toFixed(2) : 'n/a'
  const expectedStr =
    expectedDurationSec != null && expectedDurationSec > 0
      ? `${expectedDurationSec.toFixed(2)}s`
      : 'n/a'
  onLog?.(
    `[verifyOutput] file=${sizeMB}MB, fmt=${formatName ?? 'unknown'}, bitrate=${
      bitRate != null ? Math.round(bitRate / 1000) + 'kbps' : 'n/a'
    }, dur=${durationSec.toFixed(2)}s (expected=${expectedStr}, diff=${
      durationDiffSec != null ? durationDiffSec.toFixed(2) + 's' : 'n/a'
    }), res=${resStr}, fps=${fps ?? 'unknown'}, vCodec=${videoCodec || 'unknown'}, aCodec=${
      audioCodec || 'unknown'
    }`
  )

  if (resolutionMismatch) {
    onLog?.(
      `[verifyOutput] ⚠ RESOLUTION MISMATCH: container header says ${width}x${height} but stream is actually ${codedWidth}x${codedHeight}. Đây là dấu hiệu Pass-2 concat copy clip có resolution khác nhau hoặc header bị hỏng.`
    )
  }

  if (durationWarning) {
    const expected = expectedDurationSec ?? 0
    const truncatedSec = expected - durationSec
    onLog?.(
      `[verifyOutput] ⚠ DURATION MISMATCH: expected=${expected.toFixed(2)}s, actual=${durationSec.toFixed(
        2
      )}s, diff=${(durationDiffSec ?? 0).toFixed(2)}s${
        truncatedSec > 0 ? ` → bị cắt mất ~${truncatedSec.toFixed(2)}s` : ''
      }`
    )
  }

  const { ffmpeg } = getFfmpegPaths()
  const decodeDurationArg = String(Math.max(1, Math.floor(decodeWindowSec)))

  let decodeStderrTail = ''
  let decodeExitCode: number | null = null

  const decodeOk: boolean = await new Promise((resolve) => {
    let isSettled = false
    const safeResolve = (result: boolean) => {
      if (isSettled) return
      isSettled = true
      resolve(result)
    }

    try {
      const child = spawn(
        ffmpeg,
        ['-v', 'error', '-t', decodeDurationArg, '-i', outputPath, '-f', 'null', '-'],
        { windowsHide: true }
      )
      child.stdout?.resume()

      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8')
        if (stderr.length > 8192) {
          stderr = stderr.slice(-8192)
        }
      })

      const killTimer = setTimeout(() => {
        decodeStderrTail = stderr.slice(-1000)
        onLog?.(
          `[verifyOutput] decode test timeout (${decodeTimeoutMs}ms), killing process — treating as failed verification`
        )
        if (decodeStderrTail.trim().length > 0) {
          onLog?.(`[verifyOutput] decode stderr (timeout, tail 1KB): ${decodeStderrTail}`)
        }
        try {
          child.kill('SIGKILL')
        } catch {}
        // Timeout cannot prove file integrity; fail verification instead of accepting unknown output.
        safeResolve(false)
      }, decodeTimeoutMs)

      child.on('error', (err) => {
        decodeStderrTail = stderr.slice(-1000)
        onLog?.(`[verifyOutput] ffmpeg decode error: ${err.message}`)
        if (decodeStderrTail.trim().length > 0) {
          onLog?.(`[verifyOutput] decode stderr (error, tail 1KB): ${decodeStderrTail}`)
        }
        clearTimeout(killTimer)
        safeResolve(false)
      })

      child.on('close', (code) => {
        clearTimeout(killTimer)
        decodeExitCode = code
        decodeStderrTail = stderr.slice(-1000)
        // CHỈ check lỗi thật sự nghiêm trọng — KHÔNG dùng "error" hay "failed" vì
        // FFmpeg stderr luôn chứa chúng (e.g. "-v error" log level, error-concealment messages).
        // KHÔNG thêm "non-monotonous dts" / "premature end" — đó là warning THƯỜNG GẶP của
        // concat demuxer copy path (Pass 2), không phải lỗi hỏng file → sẽ fail nhầm video hợp lệ.
        const errorPattern = /corrupt|invalid data|moov atom not found|could not find codec|truncated|missing picture|partial file/i
        const hasError = errorPattern.test(stderr)
        if (code === 0 && !hasError) {
          // Pass — vẫn log stderr nếu có nội dung warning hữu ích cho post-mortem
          if (stderr.trim().length > 0 && onLog) {
            onLog(
              `[verifyOutput] decode PASS (code=0). stderr (tail 400 bytes): ${stderr.slice(-400)}`
            )
          }
          safeResolve(true)
          return
        }
        if (onLog) {
          onLog(
            `[verifyOutput] ❌ decode FAIL: code=${code}, errorPattern=${hasError}, stderrTail (1KB): ${decodeStderrTail}`
          )
        }
        safeResolve(false)
      })
    } catch (err: any) {
      onLog?.(`[verifyOutput] Failed to spawn ffmpeg decode: ${err?.message || String(err)}`)
      safeResolve(false)
    }
  })

  return {
    durationSec,
    fps,
    videoCodec,
    audioCodec,
    width,
    height,
    codedWidth,
    codedHeight,
    resolutionMismatch,
    fileSizeBytes,
    bitRate,
    formatName,
    durationDiffSec,
    durationWarning,
    decodeOk,
    decodeStderrTail,
    decodeExitCode,
    hasVideoStream,
    hasAudioStream,
  }
}

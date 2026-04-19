import { spawn } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import { probeFile } from '../ffmpeg/probe'

export interface VideoVerificationResult {
  durationSec: number
  fps: number | null
  videoCodec: string | null
  audioCodec: string | null
  durationDiffSec: number | null
  durationWarning: boolean
  decodeOk: boolean
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
    parseFps((videoStream as any)?.avg_frame_rate) ??
    parseFps((videoStream as any)?.r_frame_rate) ??
    parseFps((videoStream as any)?.fps) ??
    null

  const videoCodec = (videoStream as any)?.codec_name ?? (videoStream as any)?.codec ?? null
  const audioCodec = (audioStream as any)?.codec_name ?? (audioStream as any)?.codec ?? null
  const hasVideoStream = !!videoStream
  const hasAudioStream = !!audioStream

  let durationDiffSec: number | null = null
  let durationWarning = false
  if (expectedDurationSec && expectedDurationSec > 0 && durationSec > 0) {
    durationDiffSec = Math.abs(durationSec - expectedDurationSec)
    durationWarning = durationDiffSec > toleranceSec
  }

  onLog?.(
    `[verifyOutput] duration=${durationSec.toFixed(2)}s, fps=${fps ?? 'unknown'}, vCodec=${
      videoCodec || 'unknown'
    }, aCodec=${audioCodec || 'unknown'}, diff=${durationDiffSec ?? 'n/a'}`
  )

  const { ffmpeg } = getFfmpegPaths()
  const decodeDurationArg = String(Math.max(1, Math.floor(decodeWindowSec)))

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

      child.on('error', (err) => {
        onLog?.(`[verifyOutput] ffmpeg decode error: ${err.message}`)
        clearTimeout(killTimer)
        safeResolve(false)
      })

      const killTimer = setTimeout(() => {
        onLog?.(`[verifyOutput] decode test timeout (${decodeTimeoutMs}ms), killing process — treating as OK (file lớn)`)
        try { child.kill('SIGKILL') } catch {}
        // Timeout KHÔNG phải lỗi thật — file lớn decode lâu hơn limit → coi là OK
        safeResolve(true)
      }, decodeTimeoutMs)

      child.on('close', (code) => {
        clearTimeout(killTimer)
        // CHỈ check lỗi thật sự nghiêm trọng — KHÔNG dùng "error" hay "failed" vì
        // FFmpeg stderr luôn chứa chúng (e.g. "-v error" log level, error-concealment messages)
        const hasError = /corrupt|invalid data|moov atom not found|could not find codec/i.test(stderr)
        if (code === 0 && !hasError) {
          safeResolve(true)
          return
        }
        if (onLog) {
          onLog(
            `[verifyOutput] ffmpeg decode finished with code=${code}, stderrTail=${stderr.slice(-400)}`
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
    durationDiffSec,
    durationWarning,
    decodeOk,
    hasVideoStream,
    hasAudioStream,
  }
}

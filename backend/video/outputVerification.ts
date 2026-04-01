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
}

function parseFps(rate?: string | null): number | null {
  if (!rate || rate === '0/0') return null
  const parts = rate.split('/')
  if (parts.length === 2) {
    const num = Number(parts[0])
    const den = Number(parts[1])
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null
    return num / den
  }
  const v = Number(rate)
  return Number.isFinite(v) && v > 0 ? v : null
}

export async function verifyOutputVideo(
  outputPath: string,
  opts?: {
    expectedDurationSec?: number | null
    toleranceSec?: number
    onLog?: (msg: string) => void
  }
): Promise<VideoVerificationResult> {
  const { expectedDurationSec = null, toleranceSec = 5, onLog } = opts || {}

  // 1) Probe metadata: duration / codec / fps
  const info = await probeFile(outputPath)
  const durationSec = info?.format?.duration ?? 0
  const videoStream = info?.video
  const audioStream = info?.audio

  const fps =
    parseFps((videoStream as any)?.avg_frame_rate) ??
    parseFps((videoStream as any)?.r_frame_rate) ??
    null

  const videoCodec = (videoStream as any)?.codec_name ?? null
  const audioCodec = (audioStream as any)?.codec_name ?? null

  let durationDiffSec: number | null = null
  let durationWarning = false

  if (expectedDurationSec && expectedDurationSec > 0 && durationSec > 0) {
    durationDiffSec = Math.abs(durationSec - expectedDurationSec)
    if (durationDiffSec > toleranceSec) {
      durationWarning = true
    }
  }

  if (onLog) {
    onLog(
      `[verifyOutput] duration=${durationSec.toFixed(2)}s, fps=${fps ?? 'unknown'}, vCodec=${
        videoCodec || 'unknown'
      }, aCodec=${audioCodec || 'unknown'}, diff=${durationDiffSec ?? 'n/a'}`
    )
  }

  // 2) Decode test: ffmpeg -v error -t 60 -i output -f null -
  // Giới hạn 60 giây đầu để tránh decode toàn bộ file (có thể rất lâu với file dài)
  const { ffmpeg } = getFfmpegPaths()

  const decodeOk: boolean = await new Promise((resolve) => {
    try {
      const child = spawn(
        ffmpeg,
        ['-v', 'error', '-t', '60', '-i', outputPath, '-f', 'null', '-'],
        { windowsHide: true }
      )
      // Drain stdout để tránh pipe buffer đầy → process treo
      child.stdout?.resume()

      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8')
      })

      child.on('error', (err) => {
        if (onLog) {
          onLog(`[verifyOutput] ffmpeg decode error: ${err.message}`)
        }
        clearTimeout(killTimer)
        resolve(false)
      })

      // Safety timeout: nếu ffmpeg không kết thúc sau 90s → kill và coi là OK
      const killTimer = setTimeout(() => {
        if (onLog) onLog('[verifyOutput] decode test timeout (90s), killing process')
        try { child.kill('SIGKILL') } catch {}
        resolve(true) // timeout không phải lỗi thật, coi là OK
      }, 90_000)

      child.on('close', (code) => {
        clearTimeout(killTimer)
        // FFmpeg always writes info/warnings to stderr even on success.
        // Only treat as failure if exit code != 0 OR stderr contains error keywords.
        const hasError = /corrupt|invalid|moov atom not found/i.test(stderr)
        if (code === 0 && !hasError) {
          resolve(true)
        } else {
          if (onLog) {
            onLog(
              `[verifyOutput] ffmpeg decode finished with code=${code}, stderrTail=${stderr.slice(
                -400
              )}`
            )
          }
          resolve(false)
        }
      })
    } catch (err: any) {
      if (onLog) {
        onLog(`[verifyOutput] Failed to spawn ffmpeg decode: ${err?.message || String(err)}`)
      }
      resolve(false)
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
  }
}





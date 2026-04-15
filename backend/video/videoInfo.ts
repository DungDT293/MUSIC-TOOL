/**
 * Video Info - Probe video file để lấy metadata cơ bản
 */

import { spawn } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import fsp from 'node:fs/promises'

export interface VideoFileInfo {
  filePath: string
  durationSec: number | null
  width: number | null
  height: number | null
  fps?: number | null
  codecName?: string | null
  formatName?: string | null
  bitrateBps?: number | null
  sizeBytes: number | null
}

/**
 * Probe video file để lấy duration, width, height
 */
export async function getVideoFileInfo(filePath: string): Promise<VideoFileInfo> {
  // Lấy file size async — TOCTOU-safe, không block event loop
  let sizeBytes: number | null = null
  try {
    const stats = await fsp.stat(filePath)
    sizeBytes = stats?.size ?? null
  } catch {
    throw new Error(`File không tồn tại: ${filePath}`)
  }

  const paths = getFfmpegPaths()
  const ffprobePath = paths.ffprobe

  return new Promise((resolve, _reject) => {
    let isSettled = false
    const nullResult: VideoFileInfo = {
      filePath,
      durationSec: null,
      width: null,
      height: null,
      fps: null,
      codecName: null,
      formatName: null,
      bitrateBps: null,
      sizeBytes,
    }
    const safeResolve = (val: VideoFileInfo) => {
      if (isSettled) return
      isSettled = true
      resolve(val)
    }

    // Dùng ffprobe để lấy metadata cần cho audit + validation.
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration,format_name,bit_rate:stream=width,height,codec_type,codec_name,r_frame_rate',
      '-of', 'json',
      filePath,
    ]

    const proc = spawn(ffprobePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // Timeout 30s: file corrupt / network drive mất kết nối có thể khiến ffprobe treo mãi
    const PROBE_TIMEOUT_MS = 30_000
    const killTimer = setTimeout(() => {
      console.warn(`[getVideoFileInfo] ffprobe timeout (30s) for: ${filePath}`)
      try { proc.kill('SIGKILL') } catch { /* ignore */ }
      safeResolve(nullResult)
    }, PROBE_TIMEOUT_MS)

    let stdout = ''
    let stderr = ''
    const MAX_BUFFER = 512 * 1024 // 512KB cap — ffprobe output nhỏ, nhưng phòng trường hợp bất thường

    proc.stdout?.on('data', (data: Buffer) => {
      if (stdout.length < MAX_BUFFER) {
        stdout += data.toString('utf-8')
      }
    })

    proc.stderr?.on('data', (data: Buffer) => {
      if (stderr.length < MAX_BUFFER) {
        stderr += data.toString('utf-8')
      }
    })

    proc.on('close', (code) => {
      clearTimeout(killTimer)
      if (code !== 0) {
        console.warn(`[getVideoFileInfo] ffprobe failed for ${filePath}:`, stderr.slice(-400))
        safeResolve(nullResult)
        return
      }

      try {
        const json = JSON.parse(stdout)
        const format = json.format || {}
        const streams = Array.isArray(json.streams) ? json.streams : []
        const videoStream = streams.find((s: any) => s?.codec_type === 'video')

        let fps: number | null = null
        const rawRate = videoStream?.r_frame_rate
        if (typeof rawRate === 'string' && rawRate && rawRate !== '0/0') {
          const parts = rawRate.split('/')
          if (parts.length === 2) {
            const numerator = Number(parts[0])
            const denominator = Number(parts[1])
            if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
              const value = numerator / denominator
              fps = Number.isFinite(value) && value > 0 ? value : null
            }
          } else {
            const value = Number(rawRate)
            fps = Number.isFinite(value) && value > 0 ? value : null
          }
        }

        safeResolve({
          filePath,
          durationSec: format.duration ? parseFloat(format.duration) : null,
          width: videoStream?.width ? parseInt(videoStream.width, 10) : null,
          height: videoStream?.height ? parseInt(videoStream.height, 10) : null,
          fps,
          codecName: typeof videoStream?.codec_name === 'string' ? videoStream.codec_name : null,
          formatName: typeof format.format_name === 'string' ? format.format_name : null,
          bitrateBps: format.bit_rate ? parseInt(format.bit_rate, 10) : null,
          sizeBytes,
        })
      } catch (error) {
        console.warn(`[getVideoFileInfo] Failed to parse ffprobe output:`, error)
        safeResolve(nullResult)
      }
    })

    proc.on('error', (error) => {
      clearTimeout(killTimer)
      console.warn(`[getVideoFileInfo] Spawn error:`, error)
      safeResolve(nullResult)
    })
  })
}

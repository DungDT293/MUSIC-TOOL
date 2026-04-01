/**
 * Video Info - Probe video file để lấy metadata cơ bản
 */

import { spawn } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import fs from 'node:fs'

export interface VideoFileInfo {
  filePath: string
  durationSec: number | null
  width: number | null
  height: number | null
  sizeBytes: number | null
}

/**
 * Probe video file để lấy duration, width, height
 */
export async function getVideoFileInfo(filePath: string): Promise<VideoFileInfo> {
  // Kiểm tra file tồn tại
  if (!fs.existsSync(filePath)) {
    throw new Error(`File không tồn tại: ${filePath}`)
  }

  const stats = fs.statSync(filePath)
  const sizeBytes = stats?.size ?? null

  const paths = getFfmpegPaths()
  const ffprobePath = paths.ffprobe

  return new Promise((resolve, reject) =\u003e {
    // Dùng ffprobe để lấy metadata
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=width,height',
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
    }, PROBE_TIMEOUT_MS)

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8')
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8')
    })

    proc.on('close', (code) => {
      clearTimeout(killTimer)
      if (code !== 0) {
        console.warn(`[getVideoFileInfo] ffprobe failed for ${filePath}:`, stderr)
        // Trả về null values nhưng không throw
        resolve({
          filePath,
          durationSec: null,
          width: null,
          height: null,
          sizeBytes,
        })
        return
      }

      try {
        const json = JSON.parse(stdout)
        const format = json.format || {}
        const streams = json.streams || []

        // Tìm video stream đầu tiên
        const videoStream = streams.find((s: any) => s.codec_type === 'video')

        const durationSec = format.duration ? parseFloat(format.duration) : null
        const width = videoStream?.width ? parseInt(videoStream.width, 10) : null
        const height = videoStream?.height ? parseInt(videoStream.height, 10) : null

        resolve({
          filePath,
          durationSec,
          width,
          height,
          sizeBytes,
        })
      } catch (error) {
        console.warn(`[getVideoFileInfo] Failed to parse ffprobe output:`, error)
        resolve({
          filePath,
          durationSec: null,
          width: null,
          height: null,
          sizeBytes,
        })
      }
    })

    proc.on('error', (error) => {
      clearTimeout(killTimer)
      console.warn(`[getVideoFileInfo] Spawn error:`, error)
      resolve({
        filePath,
        durationSec: null,
        width: null,
        height: null,
        sizeBytes,
      })
    })
  })
}













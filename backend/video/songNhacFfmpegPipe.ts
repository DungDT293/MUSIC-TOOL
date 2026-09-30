import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getFfmpegPaths } from '../ffmpeg/config'
import { probeFile } from '../ffmpeg/probe'
import type { SongNhacExportProgress, SongNhacExportRequest } from '../../shared/songNhacChannels'

export interface SongNhacFfmpegPipe {
  run: (onProgress: (progress: SongNhacExportProgress) => void) => Promise<void>
  cancel: () => void
}

export function createSongNhacFfmpegPipe(
  request: SongNhacExportRequest,
  onProcess?: (child: ChildProcessWithoutNullStreams) => void,
): SongNhacFfmpegPipe {
  let child: ChildProcessWithoutNullStreams | null = null
  let cancelled = false

  const cancel = () => {
    cancelled = true
    if (!child || child.killed) return
    child.kill('SIGTERM')
    setTimeout(() => {
      if (child && !child.killed) child.kill('SIGKILL')
    }, 1500)
  }

  const run = async (onProgress: (progress: SongNhacExportProgress) => void): Promise<void> => {
    if (!fs.existsSync(request.audioPath)) throw new Error('Audio file không tồn tại.')
    if (path.extname(request.outputPath).toLowerCase() !== '.mp4') throw new Error('Output Song Nhạc phải là file .mp4.')
    await fs.promises.mkdir(path.dirname(request.outputPath), { recursive: true })
    const probe = await probeFile(request.audioPath)
    const totalSec = Number.isFinite(probe.format.duration) && probe.format.duration > 0 ? probe.format.duration : 0
    if (totalSec <= 0) throw new Error('Không đọc được thời lượng audio.')

    const { ffmpeg } = getFfmpegPaths()
    const visual = request.style === 'orbit-spectrum'
      ? `showfreqs=s=${request.width}x${Math.max(180, Math.round(request.height * 0.28))}:mode=bar:colors=0xd946ef|0x22d3ee`
      : request.style === 'pulse-grid'
      ? `showwaves=s=${request.width}x${Math.max(180, Math.round(request.height * 0.28))}:mode=cline:colors=0xd946ef`
      : `showwaves=s=${request.width}x${Math.max(180, Math.round(request.height * 0.28))}:mode=line:colors=0x22d3ee`
    const filter = [
      `[1:a]${visual},format=rgba[wave]`,
      `[0:v][wave]overlay=(W-w)/2:(H-h)/2:shortest=1[v]`,
    ].join(';')
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=0x030712:s=${request.width}x${request.height}:r=${request.fps}:d=${totalSec.toFixed(3)}`,
      '-i', request.audioPath,
      '-filter_complex', filter,
      '-map', '[v]', '-map', '1:a:0',
      '-t', totalSec.toFixed(3),
      '-r', String(request.fps),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', request.outputPath,
    ]

    await new Promise<void>((resolve, reject) => {
      child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      onProcess?.(child)
      let stderr = ''
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        child = null
        if (error) reject(error)
        else resolve()
      }
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
        const match = stderr.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/g)
        const last = match?.[match.length - 1]
        if (!last) return
        const timeMatch = last.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/)
        if (!timeMatch) return
        const timeSec = Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3])
        onProgress({ requestId: request.requestId, timeSec, totalSec, percent: Math.min(100, (timeSec / totalSec) * 100) })
      })
      child.once('error', (error) => finish(error))
      child.once('close', (code) => {
        if (cancelled) finish(new Error('Song Nhạc export đã bị hủy.'))
        else if (code !== 0) finish(new Error(stderr.trim().slice(-1200) || `FFmpeg exited with code ${code}.`))
        else finish()
      })
    })
  }

  return { run, cancel }
}

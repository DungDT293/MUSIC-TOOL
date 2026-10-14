/**
 * Preview Mix - Tạo đoạn nghe thử hòa âm giữa nhạc ghép và nhạc nền
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import { probeFile } from '../ffmpeg/probe'

export interface PreviewMixOptions {
  mainTrackPath: string
  bgTrackPath: string
  mainVolumeDb?: number // Mặc định +2 dB
  bgMusicVolumeDb?: number // Mặc định -4 dB
  durationSec?: number // Mặc định 20 giây
}

export interface PreviewMixResult {
  success: boolean
  previewUrl?: string // Data URL: data:audio/mp3;base64,...
  error?: string
}

export async function renderPreviewMix(opts: PreviewMixOptions): Promise<PreviewMixResult> {
  const {
    mainTrackPath,
    bgTrackPath,
    mainVolumeDb = 2,
    bgMusicVolumeDb = -4,
    durationSec = 20,
  } = opts

  if (!mainTrackPath || !fs.existsSync(mainTrackPath)) {
    return { success: false, error: `File nhạc chính không tồn tại: ${mainTrackPath || '(trống)'}` }
  }

  if (!bgTrackPath || !fs.existsSync(bgTrackPath)) {
    return { success: false, error: `File nhạc nền không tồn tại: ${bgTrackPath || '(trống)'}` }
  }

  const { ffmpeg } = getFfmpegPaths()
  const duration = Math.min(Math.max(durationSec, 5), 60)
  const fadeStart = Math.max(0, duration - 2)

  let mainStart = 0
  try {
    const probe = await probeFile(mainTrackPath)
    if ((probe.format?.duration || 0) >= 15) {
      mainStart = 5
    }
  } catch {}

  const outPath = path.join(
    os.tmpdir(),
    `preview_mix_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3`
  )

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-ss', String(mainStart),
    '-t', String(duration),
    '-i', mainTrackPath,
    '-stream_loop', '-1',
    '-ss', '0',
    '-t', String(duration),
    '-i', bgTrackPath,
    '-filter_complex',
    `[0:a]volume=${mainVolumeDb}dB[main];[1:a]volume=${bgMusicVolumeDb}dB[bg];[main][bg]amix=inputs=2:duration=first:dropout_transition=2:normalize=0,afade=t=out:st=${fadeStart}:d=2[out]`,
    '-map', '[out]',
    '-ar', '44100',
    '-ac', '2',
    '-acodec', 'libmp3lame',
    '-b:a', '192k',
    outPath,
  ]

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg, args, { windowsHide: true })
      let stderr = ''
      child.stderr?.on('data', (c) => { stderr += c.toString() })
      child.on('error', (err) => reject(new Error(`Lỗi khởi động FFmpeg: ${err.message}`)))
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`FFmpeg exited code ${code}: ${stderr}`))
      })
    })

    if (!fs.existsSync(outPath)) {
      return { success: false, error: 'Không tạo được file nghe thử âm thanh.' }
    }

    const buf = fs.readFileSync(outPath)
    const base64 = buf.toString('base64')
    const previewUrl = `data:audio/mp3;base64,${base64}`

    try { fs.unlinkSync(outPath) } catch {}

    return { success: true, previewUrl }
  } catch (err: any) {
    if (fs.existsSync(outPath)) {
      try { fs.unlinkSync(outPath) } catch {}
    }
    return { success: false, error: err?.message || String(err) }
  }
}


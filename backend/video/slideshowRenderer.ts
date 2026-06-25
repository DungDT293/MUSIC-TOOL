/**
 * slideshowRenderer.ts
 * Pure slideshow clip renderer: images -> temp uniform MP4 clips
 *
 * Responsibilities:
 * - Convert still images to short video clips with target duration
 * - Apply aspect handling: letterbox / crop-fill / blur-background
 * - Optional FFmpeg-native transitions (xfade) and Ken Burns (zoompan)
 * - Emit uniform format (resolution + fps + yuv420p) for safe concat
 *
 * Reuses:
 * - getFfmpegPaths from backend/ffmpeg/config
 * - temp dir patterns already used in final export
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { getFfmpegPaths } from '../ffmpeg/config'
import { videoJobManager } from './videoJobManager'

export interface SlideshowRenderOptions {
  images: Array<{ path: string; durationSec: number; width?: number | null; height?: number | null }>
  targetResolution: string // e.g. '1920x1080'
  targetFps: string // e.g. '30' or '30000/1001'
  transition?: string // xfade transition name or 'none'
  transitionDurationSec?: number // default 0.5
  kenBurns?: boolean // apply slow zoompan
  aspectMode: 'letterbox' | 'crop-fill' | 'blur-background'
  tempDir: string // caller-managed scratch dir for this job
  requestId?: string
  onProgress?: (completed: number, total: number) => void
}

export interface SlideshowClip {
  path: string
  durationSec: number
}

/**
 * If escapePathForFfmpegList is not exported from finalExport, define a local copy:
 */
function resolveFfmpegPath(): string {
  const paths = getFfmpegPaths()
  const ffmpegPath = paths.ffmpeg
  if (!ffmpegPath) {
    throw new Error('Không tìm thấy đường dẫn FFmpeg để render slideshow')
  }
  return ffmpegPath
}

/**
 * Build scale/pad or crop vf for a single image -> video stream
 */
function buildAspectVf(
  inW: number | null,
  inH: number | null,
  targetW: number,
  targetH: number,
  mode: 'letterbox' | 'crop-fill' | 'blur-background'
): string {
  const tw = targetW
  const th = targetH
  const iw = inW ?? tw
  const ih = inH ?? th

  if (mode === 'letterbox') {
    // fit inside, black pad
    return [
      `scale=${tw}:${th}:force_original_aspect_ratio=decrease`,
      `pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:black`,
      'setsar=1/1',
    ].join(',')
  }

  if (mode === 'crop-fill') {
    // cover, center crop
    return [
      `scale=${tw}:${th}:force_original_aspect_ratio=increase`,
      `crop=${tw}:${th}`,
      'setsar=1/1',
    ].join(',')
  }

  // blur-background: letterbox on blurred enlarged bg + sharp foreground
  // Simplified: scale to cover for bg blur, overlay sharp scaled letterbox on top
  // For simplicity and speed we do a single-pass composite:
  // 1) bg: scale to cover + gblur
  // 2) fg: letterbox fit
  // 3) overlay fg on bg
  return [
    `split=2[bg][fg]`,
    `[bg]scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th},gblur=sigma=20[bgblurred]`,
    `[fg]scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:black[fgbox]`,
    `[bgblurred][fgbox]overlay=0:0,setsar=1/1`,
  ].join(',')
}

/**
 * Build zoompan for Ken Burns (slow center zoom in)
 * zoompan requires eval per-frame; keep it gentle to avoid perf hit.
 */
function buildKenBurnsVf(
  targetW: number,
  targetH: number,
  durationSec: number,
  fps: number
): string {
  // Gentle zoom from 1.0 -> 1.15 over duration
  const z = `zoompan=z='min(zoom+0.0005,1.15)':d=${Math.max(1, Math.floor(durationSec * fps))}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${targetW}x${targetH}`
  return z
}

/**
 * Render a single image to a temp MP4 clip
 */
async function renderSingleImageClip(opts: {
  imagePath: string
  durationSec: number
  outPath: string
  targetW: number
  targetH: number
  fps: number
  aspectVf: string
  kenBurnsVf?: string
  ffmpegPath: string
  requestId?: string
}): Promise<void> {
  const { imagePath, durationSec, outPath, targetW, targetH, fps, aspectVf, kenBurnsVf, ffmpegPath, requestId } = opts

  const args: string[] = [
    '-y',
    '-loop', '1',
    '-i', imagePath,
    '-t', String(durationSec),
    '-vf', kenBurnsVf ? `${aspectVf},${kenBurnsVf}` : aspectVf,
    '-r', String(fps),
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-an',
    outPath,
  ]

  await new Promise<void>((resolve, reject) => {
    if (requestId && videoJobManager.isCancelled(requestId)) {
      reject(new Error('Đã dừng bởi người dùng'))
      return
    }

    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    if (requestId) {
      videoJobManager.registerJob(requestId, p)
    }
    let err = ''
    p.stderr.on('data', (d) => {
      if (requestId && videoJobManager.isCancelled(requestId) && !p.killed) {
        p.kill('SIGKILL')
        return
      }
      err += d.toString()
    })
    p.on('error', reject)
    p.on('close', (code) => {
      if (requestId && videoJobManager.isCancelled(requestId)) {
        reject(new Error('Đã dừng bởi người dùng'))
        return
      }
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg slideshow clip failed (${code}): ${err.slice(-500)}`))
    })
  })
}

/**
 * Optional: build xfade filter_complex for consecutive clips
 * NOTE: For initial cut we render each image clip independently.
 * Cross-clip xfade can be added later in a second pass (more complex concat planning).
 * We keep the function signature for future extension.
 */
export function buildXfadeComplex(_clips: SlideshowClip[], _xfadeName: string, _xfadeDur: number): string | null {
  // Placeholder: returning null means "no cross-clip filter_complex yet"
  // Real implementation would construct [0][1]xfade=transition=... , [1][2]...
  // and would require re-encoding pass anyway.
  return null
}

/**
 * Main entry: render all images -> temp clips
 */
export async function renderSlideshowClips(opts: SlideshowRenderOptions): Promise<SlideshowClip[]> {
  const {
    images,
    targetResolution,
    targetFps,
    transition,
    transitionDurationSec = 0.5,
    kenBurns = false,
    aspectMode,
    tempDir,
    requestId,
    onProgress,
  } = opts

  await fsp.mkdir(tempDir, { recursive: true })

  const ffmpegPath = resolveFfmpegPath()
  const [twStr, thStr] = targetResolution.split('x')
  const targetW = parseInt(twStr, 10)
  const targetH = parseInt(thStr, 10)
  const fps = targetFps.includes('/') ? 30 : parseFloat(targetFps) || 30

  const results: SlideshowClip[] = []

  for (let i = 0; i < images.length; i++) {
    if (requestId && videoJobManager.isCancelled(requestId)) {
      throw new Error('Đã dừng bởi người dùng')
    }

    const img = images[i]
    const outName = `slide_${String(i + 1).padStart(4, '0')}.mp4`
    const outPath = path.join(tempDir, outName)

    const aspectVf = buildAspectVf(
      img.width ?? null,
      img.height ?? null,
      targetW,
      targetH,
      aspectMode
    )

    let kenVf: string | undefined
    if (kenBurns) {
      kenVf = buildKenBurnsVf(targetW, targetH, img.durationSec, fps)
    }

    await renderSingleImageClip({
      imagePath: img.path,
      durationSec: img.durationSec,
      outPath,
      targetW,
      targetH,
      fps,
      aspectVf,
      kenBurnsVf: kenVf,
      ffmpegPath,
      requestId,
    })

    results.push({ path: outPath, durationSec: img.durationSec })
    onProgress?.(i + 1, images.length)
  }

  // Future: if transition && transition !== 'none' we could apply xfade here or in a 2nd pass.
  // For v1 we render clips independently; playlist/concat reuses existing two-pass if needed.
  return results
}

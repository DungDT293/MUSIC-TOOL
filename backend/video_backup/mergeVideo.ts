import fs from 'node:fs'
import path from 'node:path'
import { runFfmpeg, type FfmpegProgress } from '../ffmpeg/wrapper'
import { getVideoFileInfo } from './videoInfo'

export interface VideoMergeOptions {
  inputFiles: string[]
  outputDir: string
  outputFileName: string // e.g. '1.mp4'
  shuffle?: boolean
  mute?: boolean
  targetDurationSec?: number
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function buildConcatListContent(files: string[]): string {
  // FFmpeg concat demuxer requires: file '<path>' per line
  // Escape single quotes by replacing ' with '\'' inside path
  return files
    .map((p) => {
      const norm = p.replace(/'/g, "'\\''")
      return `file '${norm}'`
    })
    .join('\n')
}

export async function mergeVideosOnce(
  options: VideoMergeOptions,
  progressEmitter?: (p: { timeSec: number; totalDurationSec: number; percent: number }) => void
): Promise<{ outputFiles: string[]; totalDurationSec: number }> {
  const { inputFiles, outputDir } = options
  if (!inputFiles || inputFiles.length === 0) {
    throw new Error('Không có inputFiles để ghép')
  }

  ensureDir(outputDir)
  const outputPath = path.join(outputDir, options.outputFileName || 'output.mp4')

  // 1) Tính tổng thời lượng
  let totalDurationSec = 0
  for (const f of inputFiles) {
    try {
      const info = await getVideoFileInfo(f)
      totalDurationSec += info.durationSec || 0
    } catch (e) {
      // Nếu probe lỗi, bỏ qua file này
      // (hoặc có thể throw tùy yêu cầu; Phase 8.2 cho phép đơn giản hóa)
      // Để đảm bảo percent không NaN
    }
  }

  // 2) Tạo concat list
  const concatListPath = path.join(outputDir, `concat_${Date.now()}.txt`)
  fs.writeFileSync(concatListPath, buildConcatListContent(inputFiles), { encoding: 'utf8' })

  // 3) Chạy FFmpeg concat với -c copy
  const args = [
    '-hide_banner',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatListPath,
    '-c',
    'copy',
  ]

  if (options.mute) {
    args.push('-an')
  }

  args.push(outputPath)

  const result = await runFfmpeg({
    args,
    timeoutMs: 3600000,
    onStderrChunk: (chunk) => {
      process.stdout.write(chunk)
    },
    onProgress: (p: FfmpegProgress) => {
      if (!progressEmitter || totalDurationSec <= 0) return
      const percent = Math.max(0, Math.min(100, (p.timeSec / totalDurationSec) * 100))
      progressEmitter({ timeSec: p.timeSec, totalDurationSec, percent })
    },
  })

  try {
    fs.unlinkSync(concatListPath)
  } catch {}

  if (result.code !== 0 || !fs.existsSync(outputPath)) {
    throw new Error('FFmpeg merge failed')
  }

  return {
    outputFiles: [outputPath],
    totalDurationSec,
  }
}


/**
 * ffmpegRunner.ts — Chạy FFmpeg để enhance 1 audio file
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn, ChildProcess } from 'child_process'
import { getFfmpegPaths } from '../../ffmpeg/config'
import { getCodecArgs, getOutputExtension, type OutputFormat } from './filterBuilder'

// ── Cancel state (module-level, single job) ────────────────────────────────

let currentProc: ChildProcess | null = null
let cancelRequested = false

export function setCancelRequested(): void {
  cancelRequested = true
  if (currentProc) {
    try { currentProc.kill('SIGKILL') } catch { /* ignore */ }
  }
}

export function resetCancel(): void {
  cancelRequested = false
  currentProc = null
}

export function isCancelRequested(): boolean {
  return cancelRequested
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface RunEnhanceOptions {
  inputFile: string
  outputFile: string
  filterChain: string | null   // null = chỉ re-encode, không filter
  outputFormat: OutputFormat
  bitrateKbps?: number
}

export interface RunEnhanceResult {
  success: boolean
  outputFile?: string
  error?: string
  durationMs?: number
}

// ── Core runner ────────────────────────────────────────────────────────────

export async function runEnhanceSingleFile(opts: RunEnhanceOptions): Promise<RunEnhanceResult> {
  if (cancelRequested) return { success: false, error: 'cancelled' }

  const { inputFile, outputFile, filterChain, outputFormat, bitrateKbps } = opts
  const { ffmpeg } = getFfmpegPaths()
  const inputExt = path.extname(inputFile).replace('.', '').toLowerCase()
  const startTime = Date.now()

  // Ensure output directory exists
  const outDir = path.dirname(outputFile)
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  const args: string[] = [
    '-hide_banner',
    '-y',
    '-i', inputFile,
    '-vn',                  // strip video
    '-ar', '48000',
    '-ac', '2',
  ]

  if (filterChain) {
    args.push('-af', filterChain)
  }

  // Codec
  const codecArgs = getCodecArgs(outputFormat, bitrateKbps, inputExt)
  args.push(...codecArgs, outputFile)

  return new Promise((resolve) => {
    let stderr = ''

    let proc: ChildProcess
    try {
      proc = spawn(ffmpeg, args)
    } catch (err: any) {
      resolve({ success: false, error: `Cannot spawn FFmpeg: ${err?.message}` })
      return
    }

    currentProc = proc

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('error', (err) => {
      currentProc = null
      resolve({ success: false, error: err.message })
    })

    proc.on('close', (code) => {
      currentProc = null
      const durationMs = Date.now() - startTime

      if (cancelRequested) {
        // Clean up partial output
        try { if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile) } catch { /* ignore */ }
        resolve({ success: false, error: 'cancelled' })
        return
      }

      if (code === 0) {
        resolve({ success: true, outputFile, durationMs })
      } else {
        // Extract last meaningful line from stderr
        const lines = stderr.split('\n').filter(l => l.trim())
        const lastErr = lines[lines.length - 1] ?? `FFmpeg exited with code ${code}`
        resolve({ success: false, error: lastErr, durationMs })
      }
    })
  })
}

// ── Output path builder ────────────────────────────────────────────────────

/**
 * Tính đường dẫn output cho 1 file.
 * - outputDir: thư mục đích (nếu không có → ghi đè tại chỗ với suffix _enhanced)
 * - overwrite: true → thay thế file gốc; false → thêm _enhanced vào tên
 */
export function buildOutputPath(
  inputFile: string,
  outputDir: string | undefined,
  outputFormat: OutputFormat,
  overwrite = false
): string {
  const inputExt = path.extname(inputFile).replace('.', '').toLowerCase()
  const baseName = path.basename(inputFile, path.extname(inputFile))
  const outExt = getOutputExtension(outputFormat, inputExt)

  if (outputDir) {
    const outName = overwrite ? `${baseName}.${outExt}` : `${baseName}_enhanced.${outExt}`
    return path.join(outputDir, outName)
  }

  // Ghi đè tại thư mục gốc
  const inputDir = path.dirname(inputFile)
  const outName = overwrite ? `${baseName}.${outExt}` : `${baseName}_enhanced.${outExt}`
  return path.join(inputDir, outName)
}

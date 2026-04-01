/**
 * index.ts — Orchestrator cho tính năng Nâng cấp âm thanh
 * Điều phối ffmpegRunner + filterBuilder, xử lý loop file tuần tự.
 */

import fs from 'node:fs'
import path from 'node:path'
import { buildFilterChain } from './filterBuilder'
import {
  runEnhanceSingleFile,
  buildOutputPath,
  setCancelRequested,
  resetCancel,
  isCancelRequested,
} from './ffmpegRunner'
import type {
  EQSettings, CompressorSettings, LoudnormSettings, StereoSettings,
  NoiseGateSettings, LimiterSettings, ExciterSettings, NoiseReductionSettings,
  OutputFormat,
} from './filterBuilder'

// Re-export types for IPC handler
export type {
  EQSettings, CompressorSettings, LoudnormSettings, StereoSettings,
  NoiseGateSettings, LimiterSettings, ExciterSettings, NoiseReductionSettings,
  OutputFormat,
}
export { renderPreviewClip, cleanupPreviewFiles } from './previewRenderer'
export type { PreviewRenderOptions, PreviewRenderResult } from './previewRenderer'

// ── Types ──────────────────────────────────────────────────────────────────

export interface EnhanceAudioRequest {
  files: string[]
  outputDir?: string
  outputFormat?: OutputFormat
  bitrateKbps?: number
  overwrite?: boolean
  // All 8 effect settings
  eq?: EQSettings
  compressor?: CompressorSettings
  loudnorm?: LoudnormSettings
  stereo?: StereoSettings
  noiseGate?: NoiseGateSettings
  limiter?: LimiterSettings
  exciter?: ExciterSettings
  noiseReduction?: NoiseReductionSettings
}

export interface EnhanceAudioProgress {
  currentFile: string
  currentIndex: number
  totalFiles: number
  percent: number
  status: 'processing' | 'completed' | 'error' | 'cancelled'
  error?: string
}

export interface EnhanceAudioResult {
  success: boolean
  processed: number
  failed: number
  errors: Array<{ file: string; error: string }>
  outputFiles: string[]
}

// ── Main export function ───────────────────────────────────────────────────

export async function enhanceAudio(
  req: EnhanceAudioRequest,
  onProgress?: (p: EnhanceAudioProgress) => void
): Promise<EnhanceAudioResult> {
  const {
    files,
    outputDir,
    outputFormat = 'keep',
    bitrateKbps,
    overwrite = false,
    eq,
    compressor,
    loudnorm,
    stereo,
    noiseGate,
    limiter,
    exciter,
    noiseReduction,
  } = req

  resetCancel()

  const result: EnhanceAudioResult = {
    success: false,
    processed: 0,
    failed: 0,
    errors: [],
    outputFiles: [],
  }

  if (!files || files.length === 0) {
    result.errors.push({ file: '', error: 'Không có file nào để xử lý' })
    return result
  }

  // Build filter chain once (same for all files in the batch)
  // Order: NoiseReduction → NoiseGate → EQ → Compressor → Exciter → Stereo → Loudnorm → Limiter
  const filterChain = buildFilterChain(
    eq,
    compressor,
    loudnorm,
    stereo,
    noiseGate,
    limiter,
    exciter,
    noiseReduction,
  )

  const totalFiles = files.length

  for (let i = 0; i < totalFiles; i++) {
    if (isCancelRequested()) {
      onProgress?.({
        currentFile: '',
        currentIndex: i,
        totalFiles,
        percent: Math.round((i / totalFiles) * 100),
        status: 'cancelled',
      })
      break
    }

    const inputFile = files[i]
    const fileName = path.basename(inputFile)

    // Skip non-existent files
    if (!fs.existsSync(inputFile)) {
      result.failed++
      result.errors.push({ file: fileName, error: 'File không tồn tại' })
      continue
    }

    onProgress?.({
      currentFile: fileName,
      currentIndex: i,
      totalFiles,
      percent: Math.round((i / totalFiles) * 100),
      status: 'processing',
    })

    const outputFile = buildOutputPath(inputFile, outputDir, outputFormat, overwrite)

    const runResult = await runEnhanceSingleFile({
      inputFile,
      outputFile,
      filterChain,
      outputFormat,
      bitrateKbps,
    })

    if (runResult.success && runResult.outputFile) {
      result.processed++
      result.outputFiles.push(runResult.outputFile)
    } else if (runResult.error === 'cancelled') {
      onProgress?.({
        currentFile: fileName,
        currentIndex: i,
        totalFiles,
        percent: Math.round((i / totalFiles) * 100),
        status: 'cancelled',
      })
      break
    } else {
      result.failed++
      result.errors.push({ file: fileName, error: runResult.error ?? 'Lỗi không xác định' })
    }
  }

  result.success = result.processed > 0

  if (!isCancelRequested()) {
    onProgress?.({
      currentFile: '',
      currentIndex: totalFiles,
      totalFiles,
      percent: 100,
      status: result.failed > 0 && result.processed === 0 ? 'error' : 'completed',
    })
  }

  return result
}

export function cancelEnhanceAudio(): void {
  setCancelRequested()
}

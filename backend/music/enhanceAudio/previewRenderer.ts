/**
 * previewRenderer.ts — FFmpeg 2-pass loudnorm preview (30s clip)
 * Dùng cho loudnorm preview vì cần 2-pass để có output chất lượng tốt.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'child_process'
import { getFfmpegPaths } from '../../ffmpeg/config'
import { buildLoudnormFilterWithMeasured, buildEQFilter, buildCompressorFilter, buildStereoFilter } from './filterBuilder'
import type { EQSettings, CompressorSettings, LoudnormSettings, StereoSettings } from './filterBuilder'

// ── Types ──────────────────────────────────────────────────────────────────

export interface PreviewRenderOptions {
  inputFile: string
  loudnorm: LoudnormSettings
  eq?: EQSettings
  compressor?: CompressorSettings
  stereo?: StereoSettings
  durationSec?: number   // default 30
  startSec?: number      // default 0
  bitrateKbps?: number   // default 192
}

export interface PreviewRenderResult {
  success: boolean
  previewPath?: string
  error?: string
}

interface LoudnormMeasured {
  input_i: number
  input_tp: number
  input_lra: number
  input_thresh: number
  offset: number
}

// ── Temp file registry (cleanup after 5min) ────────────────────────────────

const tempFiles = new Set<string>()

export function cleanupPreviewFiles(): void {
  for (const f of tempFiles) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch { /* ignore */ }
  }
  tempFiles.clear()
}

function registerTempFile(filePath: string): void {
  tempFiles.add(filePath)
  setTimeout(() => {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath) } catch { /* ignore */ }
    tempFiles.delete(filePath)
  }, 5 * 60 * 1000) // 5 phút
}

// ── FFmpeg helpers ─────────────────────────────────────────────────────────

function spawnFfmpeg(ffmpegPath: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stderr = ''
    const proc = spawn(ffmpegPath, args)
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => resolve({ code: code ?? 0, stderr }))
  })
}

function parseLoudnormJson(stderr: string): LoudnormMeasured | null {
  try {
    // FFmpeg prints loudnorm JSON to stderr
    const match = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0])
    return {
      input_i: parseFloat(parsed.input_i),
      input_tp: parseFloat(parsed.input_tp),
      input_lra: parseFloat(parsed.input_lra),
      input_thresh: parseFloat(parsed.input_thresh),
      offset: parseFloat(parsed.target_offset ?? parsed.offset ?? '0'),
    }
  } catch {
    return null
  }
}

// ── Main renderer ──────────────────────────────────────────────────────────

export async function renderPreviewClip(opts: PreviewRenderOptions): Promise<PreviewRenderResult> {
  const {
    inputFile,
    loudnorm,
    eq,
    compressor,
    stereo,
    durationSec = 30,
    startSec = 0,
    bitrateKbps = 192,
  } = opts

  if (!fs.existsSync(inputFile)) {
    return { success: false, error: `File không tồn tại: ${inputFile}` }
  }

  const { ffmpeg } = getFfmpegPaths()
  const outPath = path.join(os.tmpdir(), `enhance_preview_${Date.now()}.mp3`)

  // ── Pass 1: Measure loudness ───────────────────────────────────────────

  // Build filter chain for pass 1 (EQ + compressor first, then loudnorm analysis)
  const preFilters: string[] = []
  if (eq) { const f = buildEQFilter(eq); if (f) preFilters.push(f) }
  if (compressor) { const f = buildCompressorFilter(compressor); if (f) preFilters.push(f) }
  if (stereo) { const f = buildStereoFilter(stereo); if (f) preFilters.push(f) }

  const loudnormAnalyze =
    `loudnorm=I=${loudnorm.integratedLufs}:TP=${loudnorm.truePeakDbtp}:LRA=${loudnorm.lra}:print_format=json`

  const pass1Filter = [...preFilters, loudnormAnalyze].join(',')

  const pass1Args = [
    '-hide_banner',
    '-ss', String(startSec),
    '-t', String(durationSec),
    '-i', inputFile,
    '-af', pass1Filter,
    '-f', 'null',
    '-',
  ]

  let measured: LoudnormMeasured | null = null
  try {
    const pass1 = await spawnFfmpeg(ffmpeg, pass1Args)
    measured = parseLoudnormJson(pass1.stderr)
  } catch (err: any) {
    return { success: false, error: `Pass 1 failed: ${err?.message}` }
  }

  if (!measured) {
    // Fallback: 1-pass loudnorm (less accurate but still works)
    console.warn('[PreviewRenderer] Pass 1 parse failed, falling back to 1-pass loudnorm')
  }

  // ── Pass 2: Render normalized output ──────────────────────────────────

  const loudnormRender = measured
    ? buildLoudnormFilterWithMeasured(loudnorm, measured)
    : `loudnorm=I=${loudnorm.integratedLufs}:TP=${loudnorm.truePeakDbtp}:LRA=${loudnorm.lra}`

  const pass2Filters = [...preFilters, loudnormRender].join(',')

  const pass2Args = [
    '-hide_banner',
    '-y',
    '-ss', String(startSec),
    '-t', String(durationSec),
    '-i', inputFile,
    '-af', pass2Filters,
    '-ar', '44100',
    '-ac', '2',
    '-acodec', 'libmp3lame',
    '-b:a', `${bitrateKbps}k`,
    outPath,
  ]

  try {
    const pass2 = await spawnFfmpeg(ffmpeg, pass2Args)
    if (pass2.code !== 0) {
      const lines = pass2.stderr.split('\n').filter(l => l.trim())
      return { success: false, error: lines[lines.length - 1] ?? `Pass 2 failed (code ${pass2.code})` }
    }
  } catch (err: any) {
    return { success: false, error: `Pass 2 failed: ${err?.message}` }
  }

  if (!fs.existsSync(outPath)) {
    return { success: false, error: 'Preview file không được tạo ra' }
  }

  registerTempFile(outPath)
  return { success: true, previewPath: outPath }
}

/**
 * GPU Detection and Encoder Selection
 * Detects available GPU hardware and selects optimal encoder for FFmpeg
 */

import { spawn } from 'child_process'
import {
  getPreferredGpuFfmpegProfile,
  listGpuFfmpegCandidates,
  type GpuFfmpegProfile,
  type ResolvedGpuFfmpegProfile,
} from '../ffmpeg/gpuProfile'
import fs from 'node:fs'
import { buildNormalizeCudaHybridVfFilter } from '../video/utils/normalizeVf'

export type GpuEncoder = 'nvenc' | 'amf' | 'videotoolbox' | 'cpu'

export interface GpuInfo {
  encoder: GpuEncoder
  available: boolean
  name?: string
  reason?: string
  ffmpegProfile?: ResolvedGpuFfmpegProfile
  ffmpegPath?: string
  ffprobePath?: string
  normalizeCudaAvailable?: boolean
  normalizeCudaReason?: string
}

const cachedGpuInfo = new Map<GpuFfmpegProfile, GpuInfo>()

const DETECT_TIMEOUT_MS = 5000
const NVIDIA_SMI_TIMEOUT_MS = 2000
const GPU_SMOKE_TEST_TIMEOUT_MS = 8000
const GPU_SMOKE_TEST_FRAME_SIZE = '320x180'
// `ffmpeg -encoders` can exceed 14 KB on full builds. Keeping only the last 4 KB
// drops lines like `h264_nvenc`, which makes GPU detection falsely fall back to CPU.
const PROCESS_OUTPUT_LIMIT = 128_000

interface ProcessResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  error?: string
}

type UsableGpuEncoder = Exclude<GpuEncoder, 'cpu'>
type GpuFailureKind = 'old_driver' | 'generic'

interface GpuProbeFailure {
  profile: ResolvedGpuFfmpegProfile
  encoder?: UsableGpuEncoder
  reason: string
  kind: GpuFailureKind
}

function isOldDriverNvencMismatchReason(message: string): boolean {
  return /driver does not support the required nvenc api version|minimum required nvidia driver|nvenc api version/i.test(
    message,
  )
}

function classifyGpuFailure(
  profile: ResolvedGpuFfmpegProfile,
  reason: string,
  encoder?: UsableGpuEncoder,
): GpuProbeFailure {
  return {
    profile,
    encoder,
    reason,
    kind: encoder === 'nvenc' && isOldDriverNvencMismatchReason(reason) ? 'old_driver' : 'generic',
  }
}

function summarizeGpuFailures(
  profilePreference: GpuFfmpegProfile,
  failures: GpuProbeFailure[],
  fallbackReason: string,
): string {
  if (failures.length === 0) {
    return fallbackReason
  }

  const joined = failures.map((failure) => failure.reason).join(' | ')
  const modernOldDriverFailure = failures.find(
    (failure) => failure.profile === 'modern' && failure.kind === 'old_driver',
  )

  if (profilePreference === 'auto' && modernOldDriverFailure) {
    const legacyTried = failures.some((failure) => failure.profile === 'legacy')
    const legacyNote = legacyTried
      ? ' Legacy profile was also tried but is not usable.'
      : ' Legacy GPU FFmpeg profile not found.'
    return `Auto GPU detect: modern profile appears incompatible with the current NVIDIA driver/API.${legacyNote} ${joined}`
  }

  return joined
}

function buildGpuSuccessReason(
  candidateProfile: ResolvedGpuFfmpegProfile,
  encoder: UsableGpuEncoder,
  options?: { gpuName?: string; autoFellBackFromOldDriverModern?: boolean },
): string {
  const profileLabel = formatProfileLabel(candidateProfile)
  const legacyFallbackSuffix =
    options?.autoFellBackFromOldDriverModern && candidateProfile === 'legacy'
      ? ' after auto fallback from modern due to old NVIDIA driver/API mismatch'
      : ''

  if (encoder === 'nvenc') {
    return options?.gpuName
      ? `NVENC encoder detected and smoke test passed via ${profileLabel} profile${legacyFallbackSuffix}`
      : `NVENC encoder detected and smoke test passed via ${profileLabel} profile${legacyFallbackSuffix} (nvidia-smi not available)`
  }

  if (encoder === 'amf') {
    return `AMF encoder detected and smoke test passed via ${profileLabel} profile${legacyFallbackSuffix}`
  }

  return `VideoToolbox encoder detected and smoke test passed via ${profileLabel} profile${legacyFallbackSuffix}`
}

function trimOutput(value: string): string {
  if (!value) return ''
  return value.length > PROCESS_OUTPUT_LIMIT ? value.slice(-PROCESS_OUTPUT_LIMIT) : value
}

function formatProcessFailure(result: ProcessResult): string {
  const reason = result.error || `exit code ${result.code ?? 'unknown'}`
  const details = result.stderr.trim() || result.stdout.trim()
  return details ? `${reason}. stderr: ${details}` : reason
}

async function runProcess(command: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (result: ProcessResult) => {
      if (settled) return
      settled = true
      resolve({
        ...result,
        stdout: trimOutput(result.stdout),
        stderr: trimOutput(result.stderr),
      })
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error: any) {
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        error: error?.message || String(error),
      })
      return
    }

    const timer = setTimeout(() => {
      if (!child.killed) {
        try {
          child.kill('SIGTERM')
          setTimeout(() => {
            try {
              if (!child.killed) child.kill('SIGKILL')
            } catch {
              // Ignore kill errors
            }
          }, 1000)
        } catch {
          // Ignore kill errors
        }
      }

      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        error: `timeout after ${timeoutMs}ms`,
      })
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf-8')
      stdout = trimOutput(stdout)
    })

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf-8')
      stderr = trimOutput(stderr)
    })

    child.on('error', (error: any) => {
      clearTimeout(timer)
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        error: error?.message || String(error),
      })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      finish({
        ok: code === 0,
        code,
        stdout,
        stderr,
      })
    })
  })
}

function getSmokeTestArgs(encoder: UsableGpuEncoder): string[] {
  const baseArgs = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${GPU_SMOKE_TEST_FRAME_SIZE}:r=30`,
    '-t',
    '0.2',
    '-an',
  ]

  if (encoder === 'nvenc') {
    return [
      ...baseArgs,
      '-c:v',
      'h264_nvenc',
      '-preset',
      'p1',
      '-pix_fmt',
      'yuv420p',
      '-f',
      'null',
      '-',
    ]
  }

  if (encoder === 'amf') {
    return [
      ...baseArgs,
      '-c:v',
      'h264_amf',
      '-quality',
      'speed',
      '-pix_fmt',
      'yuv420p',
      '-f',
      'null',
      '-',
    ]
  }

  return [
    ...baseArgs,
    '-c:v',
    'h264_videotoolbox',
    '-b:v',
    '8M',
    '-pix_fmt',
    'yuv420p',
    '-f',
    'null',
    '-',
  ]
}

async function runGpuSmokeTest(ffmpeg: string, encoder: UsableGpuEncoder): Promise<string | null> {
  const result = await runProcess(ffmpeg, getSmokeTestArgs(encoder), GPU_SMOKE_TEST_TIMEOUT_MS)
  if (result.ok) return null
  return `${encoder.toUpperCase()} encoder detected but smoke test failed: ${formatProcessFailure(result)}`
}

function getNormalizeCudaSmokeTestArgs(): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${GPU_SMOKE_TEST_FRAME_SIZE}:r=30`,
    '-t',
    '0.2',
    '-an',
    '-vf',
    buildNormalizeCudaHybridVfFilter('1920x1080', '30'),
    '-c:v',
    'h264_nvenc',
    '-preset',
    'p1',
    '-pix_fmt',
    'yuv420p',
    '-f',
    'null',
    '-',
  ]
}

async function runNormalizeCudaSmokeTest(ffmpeg: string, encoder: UsableGpuEncoder): Promise<string | null> {
  if (encoder !== 'nvenc') {
    return `${encoder.toUpperCase()} normalize path is not implemented for hybrid CUDA pre-transcode`
  }

  const result = await runProcess(ffmpeg, getNormalizeCudaSmokeTestArgs(), GPU_SMOKE_TEST_TIMEOUT_MS)
  if (result.ok) return null
  return `NVENC hybrid normalize smoke test failed: ${formatProcessFailure(result)}`
}

async function getNvidiaGpuName(): Promise<string | undefined> {
  const result = await runProcess(
    'nvidia-smi',
    ['--query-gpu=name', '--format=csv,noheader'],
    NVIDIA_SMI_TIMEOUT_MS,
  )
  if (!result.ok) return undefined

  const name = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  return name || undefined
}

function formatProfileLabel(profile: ResolvedGpuFfmpegProfile): string {
  return profile === 'legacy' ? 'legacy' : 'modern'
}

/**
 * Detect GPU encoder availability using FFmpeg
 * Has timeout to prevent app freezing
 */
async function detectGpuEncoder(
  profilePreference: GpuFfmpegProfile = getPreferredGpuFfmpegProfile(),
): Promise<GpuInfo> {
  const candidates = listGpuFfmpegCandidates(profilePreference).filter(
    (candidate) => fs.existsSync(candidate.ffmpeg) && fs.existsSync(candidate.ffprobe),
  )

  if (candidates.length === 0) {
    const profileNote =
      profilePreference === 'legacy'
        ? 'Legacy GPU FFmpeg profile not found'
        : profilePreference === 'modern'
          ? 'Modern GPU FFmpeg profile not found'
          : 'No GPU FFmpeg profile found'
    return { encoder: 'cpu', available: false, reason: profileNote }
  }

  const failures: GpuProbeFailure[] = []
  const autoFellBackFromOldDriverProfiles = new Set<ResolvedGpuFfmpegProfile>()

  for (const candidate of candidates) {
    const encoderListResult = await runProcess(candidate.ffmpeg, ['-hide_banner', '-encoders'], DETECT_TIMEOUT_MS)
    if (!encoderListResult.ok) {
      const failure = classifyGpuFailure(
        candidate.profile,
        `[${candidate.profile}] Failed to detect GPU encoder: ${formatProcessFailure(encoderListResult)}`,
      )
      console.warn(`[GPU Detection] ${failure.reason}`)
      failures.push(failure)
      continue
    }

    const encoderOutput = `${encoderListResult.stdout}\n${encoderListResult.stderr}`
    const availableEncoders: UsableGpuEncoder[] = []
    if (/h264_nvenc|hevc_nvenc/i.test(encoderOutput)) availableEncoders.push('nvenc')
    if (/h264_amf|hevc_amf/i.test(encoderOutput)) availableEncoders.push('amf')
    if (/h264_videotoolbox|hevc_videotoolbox/i.test(encoderOutput)) availableEncoders.push('videotoolbox')

    if (availableEncoders.length === 0) {
      failures.push(
        classifyGpuFailure(candidate.profile, `[${candidate.profile}] No GPU encoder found, using CPU (libx264)`),
      )
      continue
    }

    for (const encoder of availableEncoders) {
      const smokeTestFailure = await runGpuSmokeTest(candidate.ffmpeg, encoder)
      if (smokeTestFailure) {
        const failure = classifyGpuFailure(candidate.profile, `[${candidate.profile}] ${smokeTestFailure}`, encoder)
        console.warn(`[GPU Detection] ${failure.reason}`)
        failures.push(failure)
        if (profilePreference === 'auto' && candidate.profile === 'modern' && failure.kind === 'old_driver') {
          autoFellBackFromOldDriverProfiles.add(candidate.profile)
        }
        continue
      }

      if (encoder === 'nvenc') {
        const gpuName = await getNvidiaGpuName()
        const normalizeCudaFailure = await runNormalizeCudaSmokeTest(candidate.ffmpeg, encoder)
        return {
          encoder: 'nvenc',
          available: true,
          name: gpuName || 'NVIDIA GPU',
          reason: buildGpuSuccessReason(candidate.profile, encoder, {
            gpuName,
            autoFellBackFromOldDriverModern: autoFellBackFromOldDriverProfiles.has('modern'),
          }),
          ffmpegProfile: candidate.profile,
          ffmpegPath: candidate.ffmpeg,
          ffprobePath: candidate.ffprobe,
          normalizeCudaAvailable: !normalizeCudaFailure,
          normalizeCudaReason: normalizeCudaFailure || 'NVENC hybrid normalize smoke test passed',
        }
      }

      if (encoder === 'amf') {
        return {
          encoder: 'amf',
          available: true,
          name: 'AMD GPU',
          reason: buildGpuSuccessReason(candidate.profile, encoder, {
            autoFellBackFromOldDriverModern: autoFellBackFromOldDriverProfiles.has('modern'),
          }),
          ffmpegProfile: candidate.profile,
          ffmpegPath: candidate.ffmpeg,
          ffprobePath: candidate.ffprobe,
          normalizeCudaAvailable: false,
          normalizeCudaReason: 'Hybrid CUDA normalize path is only supported for NVENC right now',
        }
      }

      return {
        encoder: 'videotoolbox',
        available: true,
        name: 'Apple GPU',
        reason: buildGpuSuccessReason(candidate.profile, encoder, {
          autoFellBackFromOldDriverModern: autoFellBackFromOldDriverProfiles.has('modern'),
        }),
        ffmpegProfile: candidate.profile,
        ffmpegPath: candidate.ffmpeg,
        ffprobePath: candidate.ffprobe,
        normalizeCudaAvailable: false,
        normalizeCudaReason: 'Hybrid CUDA normalize path is only supported for NVENC right now',
      }
    }
  }

  return {
    encoder: 'cpu',
    available: false,
    reason: summarizeGpuFailures(
      profilePreference,
      failures,
      profilePreference === 'legacy'
        ? 'Legacy GPU FFmpeg profile not found'
        : profilePreference === 'modern'
          ? 'Modern GPU FFmpeg profile not found'
          : 'GPU encoder(s) detected but none passed smoke test',
    ),
  }
}

/**
 * Get GPU info (cached)
 */
export async function getGpuInfo(
  profilePreference: GpuFfmpegProfile = getPreferredGpuFfmpegProfile(),
): Promise<GpuInfo> {
  const cached = cachedGpuInfo.get(profilePreference)
  if (cached) {
    console.log(`[getGpuInfo] Using cached GPU info:`, cached)
    return cached
  }

  console.log(`[getGpuInfo] Detecting GPU encoder...`)
  const gpuInfo = await detectGpuEncoder(profilePreference)
  cachedGpuInfo.set(profilePreference, gpuInfo)
  console.log(`[getGpuInfo] GPU detection result:`, gpuInfo)
  return gpuInfo
}

/**
 * Build FFmpeg video encoder args based on GPU availability
 */
export async function buildVideoEncoderArgs(
  needsReencode: boolean,
  quality: 'fast' | 'medium' | 'slow' = 'fast'
): Promise<string[]> {
  if (!needsReencode) {
    return ['-c:v', 'copy']
  }

  const gpuInfo = await getGpuInfo()

  if (gpuInfo.encoder === 'nvenc' && gpuInfo.available) {
    // NVIDIA NVENC - very fast, good quality
    const preset = quality === 'fast' ? 'p1' : quality === 'medium' ? 'p4' : 'p6' // p1 = fastest, p7 = slowest
    const crf = quality === 'fast' ? '23' : quality === 'medium' ? '21' : '19' // Lower = better quality
    return [
      '-c:v',
      'h264_nvenc',
      '-preset',
      preset,
      '-rc',
      'vbr',
      '-cq',
      crf,
      '-b:v',
      '0', // Let CQ control bitrate
      '-pix_fmt',
      'yuv420p',
      '-vsync',
      '2',
    ]
  }

  if (gpuInfo.encoder === 'amf' && gpuInfo.available) {
    // AMD AMF - fast, good quality
    const qualityPreset = quality === 'fast' ? 'speed' : quality === 'medium' ? 'balanced' : 'quality'
    return [
      '-c:v',
      'h264_amf',
      '-quality',
      qualityPreset,
      '-rc',
      'vbr_peak',
      '-qmin',
      '18',
      '-qmax',
      '28',
      '-pix_fmt',
      'yuv420p',
      '-vsync',
      '2',
    ]
  }

  if (gpuInfo.encoder === 'videotoolbox' && gpuInfo.available) {
    // Apple VideoToolbox - fast on macOS
    return [
      '-c:v',
      'h264_videotoolbox',
      '-b:v',
      quality === 'fast' ? '8M' : quality === 'medium' ? '12M' : '16M',
      '-pix_fmt',
      'yuv420p',
      '-vsync',
      '2',
    ]
  }

  // Fallback to CPU (libx264)
  const preset = quality === 'fast' ? 'veryfast' : quality === 'medium' ? 'medium' : 'slow'
  const crf = quality === 'fast' ? '23' : quality === 'medium' ? '21' : '19'
  return ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-vsync', '2']
}

/**
 * Build FFmpeg video encoder args with user choice (GPU/CPU/Auto)
 * @param needsReencode - Whether re-encoding is needed
 * @param userChoice - User's choice: 'gpu' (prefer GPU), 'cpu' (force CPU), 'auto' (auto-detect)
 * @param quality - Quality preset: 'fast', 'medium', 'slow'
 * @returns Object with encoder args, used encoder type, and GPU info (if GPU used)
 */
export async function buildVideoEncoderArgsWithChoice(
  needsReencode: boolean,
  userChoice: 'gpu' | 'cpu' | 'auto' = 'auto',
  quality: 'fast' | 'medium' | 'slow' = 'fast',
  gpuFfmpegProfile: GpuFfmpegProfile = getPreferredGpuFfmpegProfile(),
): Promise<{ args: string[], usedEncoder: 'gpu' | 'cpu', gpuInfo?: GpuInfo }> {
  if (!needsReencode) {
    return { args: ['-c:v', 'copy'], usedEncoder: 'cpu' }
  }

  // If user explicitly wants CPU, use CPU
  if (userChoice === 'cpu') {
    const preset = quality === 'fast' ? 'veryfast' : quality === 'medium' ? 'medium' : 'slow'
    const crf = quality === 'fast' ? '23' : quality === 'medium' ? '21' : '19'
    return {
      args: ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-vsync', '2'],
      usedEncoder: 'cpu',
    }
  }

  // Get GPU info
  const gpuInfo = await getGpuInfo(gpuFfmpegProfile)
  console.log(`[buildVideoEncoderArgsWithChoice] userChoice=${userChoice}, gpuInfo:`, {
    encoder: gpuInfo.encoder,
    available: gpuInfo.available,
    name: gpuInfo.name,
    reason: gpuInfo.reason,
    ffmpegProfile: gpuInfo.ffmpegProfile,
  })

  // If user wants GPU but GPU not available, fallback to CPU with warning
  if (userChoice === 'gpu' && !gpuInfo.available) {
    console.warn(`[GPU Detection] ⚠️ User requested GPU encoding but GPU not available (${gpuInfo.reason}), falling back to CPU`)
    const preset = quality === 'fast' ? 'veryfast' : quality === 'medium' ? 'medium' : 'slow'
    const crf = quality === 'fast' ? '23' : quality === 'medium' ? '21' : '19'
    return {
      args: ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-vsync', '2'],
      usedEncoder: 'cpu',
    }
  }

  // Use GPU if available (either user requested GPU or auto-detect found GPU)
  if (gpuInfo.available && (userChoice === 'gpu' || userChoice === 'auto')) {
    if (gpuInfo.encoder === 'nvenc') {
      // NVIDIA NVENC - Add hardware acceleration for input decoding (NVDEC)
      const preset = quality === 'fast' ? 'p1' : quality === 'medium' ? 'p4' : 'p6'
      const crf = quality === 'fast' ? '23' : quality === 'medium' ? '21' : '19'
      return {
        args: [
          // Hardware acceleration for input decoding (NVDEC)
          // Use 'nvdec' or 'cuda' - both work, but 'nvdec' is more explicit
          '-hwaccel',
          'nvdec',
          // GPU encoder (NVENC)
          '-c:v',
          'h264_nvenc',
          '-preset',
          preset,
          '-rc',
          'vbr',
          '-cq',
          crf,
          '-b:v',
          '0',
          '-gpu',
          '0', // Use first GPU (0 = first GPU, 1 = second GPU, etc.)
          '-pix_fmt',
          'yuv420p',
          '-vsync',
          '2',
        ],
        usedEncoder: 'gpu',
        gpuInfo,
      }
    }

    if (gpuInfo.encoder === 'amf') {
      // AMD AMF - Add hardware acceleration for input decoding
      const qualityPreset = quality === 'fast' ? 'speed' : quality === 'medium' ? 'balanced' : 'quality'
      return {
        args: [
          // Hardware acceleration for input decoding (AMD)
          '-hwaccel',
          'd3d11va',
          // GPU encoder (AMF)
          '-c:v',
          'h264_amf',
          '-quality',
          qualityPreset,
          '-rc',
          'vbr_peak',
          '-qmin',
          '18',
          '-qmax',
          '28',
          '-pix_fmt',
          'yuv420p',
          '-vsync',
          '2',
        ],
        usedEncoder: 'gpu',
        gpuInfo,
      }
    }

    if (gpuInfo.encoder === 'videotoolbox') {
      // Apple VideoToolbox
      return {
        args: [
          '-c:v',
          'h264_videotoolbox',
          '-b:v',
          quality === 'fast' ? '8M' : quality === 'medium' ? '12M' : '16M',
          '-pix_fmt',
          'yuv420p',
          '-vsync',
          '2',
        ],
        usedEncoder: 'gpu',
        gpuInfo,
      }
    }
  }

  // Fallback to CPU (either no GPU available or auto-detect didn't find GPU)
  const preset = quality === 'fast' ? 'veryfast' : quality === 'medium' ? 'medium' : 'slow'
  const crf = quality === 'fast' ? '23' : quality === 'medium' ? '21' : '19'
  return {
    args: ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-vsync', '2'],
    usedEncoder: 'cpu',
  }
}

/**
 * Clear GPU cache (useful for re-detection)
 */
export function clearGpuCache(): void {
  cachedGpuInfo.clear()
}

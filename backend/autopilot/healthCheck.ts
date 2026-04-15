import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { getFfmpegPaths } from '../ffmpeg/config'
import {
  getPreferredGpuFfmpegProfile,
  listGpuFfmpegCandidates,
  type ResolvedGpuFfmpegProfile,
} from '../ffmpeg/gpuProfile'
import {
  buildVideoEncoderArgsWithChoice,
  clearGpuCache,
  getGpuInfo,
  type GpuInfo,
} from '../utils/gpuDetection'
import type { AutopilotConfig } from './autopilotRunner'

type EncoderChoice = 'gpu' | 'cpu' | 'auto'
type ResolvedGpuEncoder = Exclude<GpuInfo['encoder'], 'cpu'>

export interface AutopilotHealthCheckResult {
  ok: boolean
  recommendedUseGpuEncoding: EncoderChoice
  notice: string
  noticeLevel: 'info' | 'warn'
  error?: string
  resolvedGpuProfile?: ResolvedGpuFfmpegProfile
  resolvedGpuFfmpegPath?: string
  resolvedGpuEncoder?: ResolvedGpuEncoder
  gpuFallbackReason?: string
}

interface CommandCheckResult {
  ok: boolean
  code: number | null
  stderrTail: string
  stdoutTail: string
  error?: string
}

const VERSION_CHECK_TIMEOUT_MS = 5_000
const ENCODE_CHECK_TIMEOUT_MS = 15_000
const STDERR_TAIL_LIMIT = 4_000
const GPU_SMOKE_TEST_SIZE = '320x180'

function normalizeExecutablePath(binaryPath: string): string {
  if (
    process.platform === 'win32' &&
    binaryPath.match(/^[A-Z]:\\.*$/) &&
    binaryPath.length > 240 &&
    !binaryPath.startsWith('\\\\?\\')
  ) {
    return `\\\\?\\${binaryPath}`
  }
  return binaryPath
}

function needsVideoReencode(config: AutopilotConfig): boolean {
  return config.dayPlans.some(
    (plan) => !!plan.overrides?.normalizeVideoInput || !!plan.overrides?.unifyVideoFormat,
  )
}

function trimTail(value: string): string {
  if (!value) return ''
  return value.length > STDERR_TAIL_LIMIT ? value.slice(-STDERR_TAIL_LIMIT) : value
}

function formatFailureDetail(result: CommandCheckResult): string {
  const reason = result.error || `exit code ${result.code ?? 'unknown'}`
  const stderr = result.stderrTail.trim()
  return stderr ? `${reason}. stderr: ${stderr}` : reason
}

function getLegacyGpuHint(reason: string, requestedEncoder: EncoderChoice): string {
  if (
    !/nvenc api version|minimum required nvidia driver|driver does not support the required nvenc|incompatible with the current nvidia driver\/api/i.test(
      reason,
    )
  ) {
    return ''
  }

  const profilePreference = getPreferredGpuFfmpegProfile()
  const hasLegacyCandidate = listGpuFfmpegCandidates('legacy').length > 0
  if (hasLegacyCandidate) {
    return profilePreference === 'modern'
      ? ' Dang ep Modern profile. Neu may dung driver NVIDIA cu, doi sang Auto hoac Legacy.'
      : ' Hay thu chuyen GPU FFmpeg profile sang Legacy.'
  }

  if (requestedEncoder === 'gpu' || profilePreference === 'legacy') {
    return ' App chua tim thay bo FFmpeg legacy. Vao Settings > FFmpeg GPU va chon file ffmpeg.exe cua bo legacy.'
  }

  return ' Neu day la may NVIDIA driver cu, vao Settings > FFmpeg GPU va chon file ffmpeg.exe cua bo legacy de tranh roi ve CPU.'
}

function sanitizeEncoderArgsForSmokeTest(args: string[]): string[] {
  const sanitized: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-hwaccel') {
      i++
      continue
    }
    sanitized.push(args[i])
  }
  return sanitized
}

async function runCommandCheck(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandCheckResult> {
  return new Promise((resolve) => {
    let stderrTail = ''
    let stdoutTail = ''
    let settled = false

    const finish = (result: CommandCheckResult) => {
      if (settled) return
      settled = true
      resolve({
        ...result,
        stderrTail: trimTail(result.stderrTail),
        stdoutTail: trimTail(result.stdoutTail),
      })
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error: any) {
      finish({
        ok: false,
        code: null,
        stdoutTail,
        stderrTail,
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
              // ignore
            }
          }, 1_000)
        } catch {
          // ignore
        }
      }

      finish({
        ok: false,
        code: null,
        stdoutTail,
        stderrTail,
        error: `timeout after ${timeoutMs}ms`,
      })
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutTail += chunk.toString('utf8')
      stdoutTail = trimTail(stdoutTail)
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail += chunk.toString('utf8')
      stderrTail = trimTail(stderrTail)
    })

    child.on('error', (error: any) => {
      clearTimeout(timer)
      finish({
        ok: false,
        code: null,
        stdoutTail,
        stderrTail,
        error: error?.message || String(error),
      })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      finish({
        ok: code === 0,
        code,
        stdoutTail,
        stderrTail,
      })
    })
  })
}

async function checkBinaryVersion(binaryPath: string, label: string): Promise<string | null> {
  if (!binaryPath || !fs.existsSync(binaryPath)) {
    return `${label} not found at ${binaryPath || '(empty path)'}`
  }

  const result = await runCommandCheck(
    normalizeExecutablePath(binaryPath),
    ['-hide_banner', '-version'],
    VERSION_CHECK_TIMEOUT_MS,
  )
  if (!result.ok) {
    return `${label} failed version check: ${formatFailureDetail(result)}`
  }

  return null
}

async function checkAudioEncode(ffmpegPath: string): Promise<string | null> {
  const result = await runCommandCheck(
    normalizeExecutablePath(ffmpegPath),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000:cl=stereo',
      '-t',
      '0.15',
      '-c:a',
      'aac',
      '-f',
      'null',
      '-',
    ],
    ENCODE_CHECK_TIMEOUT_MS,
  )

  if (!result.ok) {
    return `FFmpeg AAC encode test failed: ${formatFailureDetail(result)}`
  }

  return null
}

async function checkCpuVideoEncode(ffmpegPath: string): Promise<string | null> {
  const result = await runCommandCheck(
    normalizeExecutablePath(ffmpegPath),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=${GPU_SMOKE_TEST_SIZE}:r=30`,
      '-t',
      '0.2',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-f',
      'null',
      '-',
    ],
    ENCODE_CHECK_TIMEOUT_MS,
  )

  if (!result.ok) {
    return `FFmpeg CPU video encode test failed: ${formatFailureDetail(result)}`
  }

  return null
}

async function checkGpuVideoEncode(ffmpegPath: string, gpuInfo: GpuInfo): Promise<string | null> {
  const encoderArgs = await buildVideoEncoderArgsWithChoice(true, 'gpu', 'fast')
  if (encoderArgs.usedEncoder !== 'gpu') {
    return `GPU encoder was requested but builder fell back to CPU (${gpuInfo.reason || 'unknown reason'})`
  }

  const gpuFfmpegPath = gpuInfo.ffmpegPath || ffmpegPath

  const result = await runCommandCheck(
    normalizeExecutablePath(gpuFfmpegPath),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=${GPU_SMOKE_TEST_SIZE}:r=30`,
      '-t',
      '0.2',
      '-an',
      ...sanitizeEncoderArgsForSmokeTest(encoderArgs.args),
      '-f',
      'null',
      '-',
    ],
    ENCODE_CHECK_TIMEOUT_MS,
  )

  if (!result.ok) {
    return `${gpuInfo.encoder.toUpperCase()} encode test failed: ${formatFailureDetail(result)}`
  }

  return null
}

export async function runAutopilotHealthCheck(
  config: AutopilotConfig,
): Promise<AutopilotHealthCheckResult> {
  const { ffmpeg, ffprobe } = getFfmpegPaths()
  const requestedEncoder = config.runtimeOverrides?.finalExportUseGpuEncoding ?? 'auto'
  const requireGpuForVideoEncode = !!config.runtimeOverrides?.requireGpuForVideoEncode
  const requiresVideoEncode = needsVideoReencode(config)

  const ffmpegError = await checkBinaryVersion(ffmpeg, 'FFmpeg')
  if (ffmpegError) {
    return {
      ok: false,
      recommendedUseGpuEncoding: 'auto',
      notice: '',
      noticeLevel: 'warn',
      error: ffmpegError,
    }
  }

  const ffprobeError = await checkBinaryVersion(ffprobe, 'FFprobe')
  if (ffprobeError) {
    return {
      ok: false,
      recommendedUseGpuEncoding: 'auto',
      notice: '',
      noticeLevel: 'warn',
      error: ffprobeError,
    }
  }

  const audioEncodeError = await checkAudioEncode(ffmpeg)
  if (audioEncodeError) {
    return {
      ok: false,
      recommendedUseGpuEncoding: 'auto',
      notice: '',
      noticeLevel: 'warn',
      error: audioEncodeError,
    }
  }

  if (!requiresVideoEncode) {
    return {
      ok: true,
      recommendedUseGpuEncoding: 'auto',
      notice: 'Health-check OK: FFmpeg/FFprobe/AAC ready. Batch nay chi dung copy-stream video nen bo qua GPU encode test.',
      noticeLevel: 'info',
    }
  }

  const cpuVideoError = await checkCpuVideoEncode(ffmpeg)
  if (cpuVideoError) {
    return {
      ok: false,
      recommendedUseGpuEncoding: 'cpu',
      notice: '',
      noticeLevel: 'warn',
      error: cpuVideoError,
    }
  }

  if (requireGpuForVideoEncode && requestedEncoder === 'cpu') {
    return {
      ok: false,
      recommendedUseGpuEncoding: 'cpu',
      notice: '',
      noticeLevel: 'warn',
      error: 'Cau hinh xung dot: Batch dang bat GPU bat buoc nhung encoder lai bi ep CPU.',
    }
  }

  if (requestedEncoder === 'cpu') {
    return {
      ok: true,
      recommendedUseGpuEncoding: 'cpu',
      notice: 'Health-check OK: FFmpeg/FFprobe/AAC/libx264 ready. Batch nay se dung CPU encoder theo cau hinh.',
      noticeLevel: 'info',
    }
  }

  clearGpuCache()
  const gpuInfo = await getGpuInfo()
  const gpuRequired = requestedEncoder === 'gpu' || requireGpuForVideoEncode
  if (!gpuInfo.available) {
    const legacyHint = getLegacyGpuHint(gpuInfo.reason || '', requestedEncoder)
    if (gpuRequired) {
      const policyHint = requireGpuForVideoEncode
        ? ' Batch dang bat GPU bat buoc nen khong duoc phep roi ve CPU.'
        : ''
      return {
        ok: false,
        recommendedUseGpuEncoding: 'gpu',
        notice: '',
        noticeLevel: 'warn',
        error: `GPU encoder was requested but no usable GPU encoder was detected: ${gpuInfo.reason || 'unknown reason'}${policyHint}${legacyHint}`,
        gpuFallbackReason: gpuInfo.reason || 'unknown reason',
      }
    }

    return {
      ok: true,
      recommendedUseGpuEncoding: 'cpu',
      notice: `Health-check warning: GPU encoder not ready (${gpuInfo.reason || 'unknown reason'}). Batch nay se tu dong dung CPU encoder.${legacyHint}`,
      noticeLevel: 'warn',
      gpuFallbackReason: gpuInfo.reason || 'unknown reason',
    }
  }

  const gpuVideoError = await checkGpuVideoEncode(ffmpeg, gpuInfo)
  if (gpuVideoError) {
    const legacyHint = getLegacyGpuHint(gpuVideoError, requestedEncoder)
    if (gpuRequired) {
      const policyHint = requireGpuForVideoEncode
        ? ' Batch dang bat GPU bat buoc nen khong duoc phep roi ve CPU.'
        : ''
      return {
        ok: false,
        recommendedUseGpuEncoding: 'gpu',
        notice: '',
        noticeLevel: 'warn',
        error: `${gpuVideoError}${policyHint}${legacyHint}`,
        gpuFallbackReason: gpuVideoError,
      }
    }

    return {
      ok: true,
      recommendedUseGpuEncoding: 'cpu',
      notice: `Health-check warning: GPU encoder ${gpuInfo.encoder.toUpperCase()} detected but smoke test failed. Batch nay se tu dong dung CPU encoder. Chi tiet: ${gpuVideoError}${legacyHint}`,
      noticeLevel: 'warn',
      gpuFallbackReason: gpuVideoError,
    }
  }

  const resolvedProfile = gpuInfo.ffmpegProfile || 'modern'
  const resolvedViaLegacyNotice =
    requestedEncoder === 'auto' && resolvedProfile === 'legacy'
      ? ' Auto da resolve sang Legacy GPU profile cho may/driver hien tai.'
      : ''

  return {
    ok: true,
    recommendedUseGpuEncoding: 'gpu',
    notice: `Health-check OK: FFmpeg/FFprobe/AAC/libx264 ready, GPU ${gpuInfo.encoder.toUpperCase()} smoke test passed via ${resolvedProfile} profile.${resolvedViaLegacyNotice}`,
    noticeLevel: 'info',
    resolvedGpuProfile: gpuInfo.ffmpegProfile,
    resolvedGpuFfmpegPath: gpuInfo.ffmpegPath || ffmpeg,
    resolvedGpuEncoder: gpuInfo.encoder === 'cpu' ? undefined : gpuInfo.encoder,
  }
}

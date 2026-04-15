import fs from 'node:fs'
import path from 'node:path'
import { getFfmpegPaths } from './config'
import { getGpuFfmpegProfileSetting, getLegacyGpuFfmpegPathSetting } from '../app/appSettings'

export type GpuFfmpegProfile = 'auto' | 'modern' | 'legacy'
export type ResolvedGpuFfmpegProfile = Exclude<GpuFfmpegProfile, 'auto'>

export interface GpuFfmpegCandidatePaths {
  profile: ResolvedGpuFfmpegProfile
  ffmpeg: string
  ffprobe: string
}

function normalizeProfile(value: string | undefined | null): GpuFfmpegProfile {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'modern' || normalized === 'legacy' || normalized === 'auto') {
    return normalized
  }
  return 'auto'
}

function getPackagedBinDir(): string {
  const { ffmpeg } = getFfmpegPaths()
  return path.dirname(ffmpeg)
}

function hasBinaryPair(ffmpegPath: string, ffprobePath: string): boolean {
  return fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)
}

function deriveSiblingBinaryPath(filePath: string, targetName: 'ffmpeg' | 'ffprobe'): string {
  const parsed = path.parse(filePath)
  const currentName = parsed.name
  const replacedName =
    targetName === 'ffprobe'
      ? currentName.replace(/ffmpeg/i, 'ffprobe')
      : currentName.replace(/ffprobe/i, 'ffmpeg')
  const finalName =
    replacedName === currentName
      ? targetName
      : replacedName

  return path.join(parsed.dir, `${finalName}${parsed.ext}`)
}

function getModernCandidate(): GpuFfmpegCandidatePaths | null {
  const globalPaths = getFfmpegPaths()
  const envFfmpeg = process.env.FFMPEG_GPU_MODERN_PATH?.trim()
  const envFfprobe = process.env.FFPROBE_GPU_MODERN_PATH?.trim()

  if (envFfmpeg && envFfprobe) {
    return {
      profile: 'modern',
      ffmpeg: envFfmpeg,
      ffprobe: envFfprobe,
    }
  }

  const isWindows = process.platform === 'win32'
  const exeExt = isWindows ? '.exe' : ''
  const binDir = getPackagedBinDir()
  const namedModern = {
    ffmpeg: path.join(binDir, `ffmpeg-modern${exeExt}`),
    ffprobe: path.join(binDir, `ffprobe-modern${exeExt}`),
  }

  if (hasBinaryPair(namedModern.ffmpeg, namedModern.ffprobe)) {
    return {
      profile: 'modern',
      ffmpeg: namedModern.ffmpeg,
      ffprobe: namedModern.ffprobe,
    }
  }

  return {
    profile: 'modern',
    ffmpeg: globalPaths.ffmpeg,
    ffprobe: globalPaths.ffprobe,
  }
}

function getLegacyCandidate(): GpuFfmpegCandidatePaths | null {
  const envFfmpeg = process.env.FFMPEG_GPU_LEGACY_PATH?.trim()
  const envFfprobe = process.env.FFPROBE_GPU_LEGACY_PATH?.trim()

  if (envFfmpeg && envFfprobe) {
    return {
      profile: 'legacy',
      ffmpeg: envFfmpeg,
      ffprobe: envFfprobe,
    }
  }

  const configuredLegacyFfmpeg = getLegacyGpuFfmpegPathSetting()
  if (configuredLegacyFfmpeg) {
    const configuredLegacyFfprobe = deriveSiblingBinaryPath(configuredLegacyFfmpeg, 'ffprobe')
    if (hasBinaryPair(configuredLegacyFfmpeg, configuredLegacyFfprobe)) {
      return {
        profile: 'legacy',
        ffmpeg: configuredLegacyFfmpeg,
        ffprobe: configuredLegacyFfprobe,
      }
    }
  }

  const isWindows = process.platform === 'win32'
  const exeExt = isWindows ? '.exe' : ''
  const binDir = getPackagedBinDir()
  const namedLegacy = {
    ffmpeg: path.join(binDir, `ffmpeg-legacy${exeExt}`),
    ffprobe: path.join(binDir, `ffprobe-legacy${exeExt}`),
  }

  if (!hasBinaryPair(namedLegacy.ffmpeg, namedLegacy.ffprobe)) {
    return null
  }

  return {
    profile: 'legacy',
    ffmpeg: namedLegacy.ffmpeg,
    ffprobe: namedLegacy.ffprobe,
  }
}

export function getPreferredGpuFfmpegProfile(): GpuFfmpegProfile {
  const envValue = process.env.FFMPEG_GPU_PROFILE
  if (envValue && envValue.trim()) {
    return normalizeProfile(envValue)
  }
  return normalizeProfile(getGpuFfmpegProfileSetting())
}

export function listGpuFfmpegCandidates(
  profilePreference: GpuFfmpegProfile = getPreferredGpuFfmpegProfile(),
): GpuFfmpegCandidatePaths[] {
  const modern = getModernCandidate()
  const legacy = getLegacyCandidate()

  if (profilePreference === 'modern') {
    return modern ? [modern] : []
  }

  if (profilePreference === 'legacy') {
    return legacy ? [legacy] : []
  }

  const ordered = [modern, legacy].filter((candidate): candidate is GpuFfmpegCandidatePaths => !!candidate)
  const deduped = new Map<string, GpuFfmpegCandidatePaths>()
  for (const candidate of ordered) {
    const key = `${candidate.ffmpeg}::${candidate.ffprobe}`
    if (!deduped.has(key)) {
      deduped.set(key, candidate)
    }
  }
  return Array.from(deduped.values())
}

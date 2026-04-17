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

function hasBinary(binaryPath: string | undefined | null): binaryPath is string {
  return !!binaryPath && fs.existsSync(binaryPath)
}

function buildGpuCandidatePaths(
  profile: ResolvedGpuFfmpegProfile,
  ffmpegPath: string | undefined | null,
  preferredFfprobePath: string | undefined | null,
  fallbackFfprobePath: string | undefined | null,
): GpuFfmpegCandidatePaths | null {
  if (!hasBinary(ffmpegPath)) {
    return null
  }

  const resolvedFfprobe = hasBinary(preferredFfprobePath)
    ? preferredFfprobePath
    : hasBinary(fallbackFfprobePath)
      ? fallbackFfprobePath
      : null

  if (!resolvedFfprobe) {
    return null
  }

  return {
    profile,
    ffmpeg: ffmpegPath,
    ffprobe: resolvedFfprobe,
  }
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

  const globalCandidate = buildGpuCandidatePaths('modern', globalPaths.ffmpeg, envFfprobe || globalPaths.ffprobe, globalPaths.ffprobe)

  if (envFfmpeg) {
    return buildGpuCandidatePaths('modern', envFfmpeg, envFfprobe || deriveSiblingBinaryPath(envFfmpeg, 'ffprobe'), globalPaths.ffprobe) || globalCandidate
  }

  const isWindows = process.platform === 'win32'
  const exeExt = isWindows ? '.exe' : ''
  const binDir = getPackagedBinDir()
  const namedModern = {
    ffmpeg: path.join(binDir, `ffmpeg-modern${exeExt}`),
    ffprobe: path.join(binDir, `ffprobe-modern${exeExt}`),
  }

  const namedModernCandidate = buildGpuCandidatePaths('modern', namedModern.ffmpeg, namedModern.ffprobe, globalPaths.ffprobe)
  if (namedModernCandidate) {
    return namedModernCandidate
  }

  return globalCandidate
}

function getLegacyCandidate(): GpuFfmpegCandidatePaths | null {
  const envFfmpeg = process.env.FFMPEG_GPU_LEGACY_PATH?.trim()
  const envFfprobe = process.env.FFPROBE_GPU_LEGACY_PATH?.trim()

  const globalPaths = getFfmpegPaths()

  if (envFfmpeg) {
    return buildGpuCandidatePaths('legacy', envFfmpeg, envFfprobe || deriveSiblingBinaryPath(envFfmpeg, 'ffprobe'), globalPaths.ffprobe)
  }

  const configuredLegacyFfmpeg = getLegacyGpuFfmpegPathSetting()
  if (configuredLegacyFfmpeg) {
    const configuredLegacyFfprobe = deriveSiblingBinaryPath(configuredLegacyFfmpeg, 'ffprobe')
    const configuredCandidate = buildGpuCandidatePaths(
      'legacy',
      configuredLegacyFfmpeg,
      configuredLegacyFfprobe,
      globalPaths.ffprobe,
    )
    if (configuredCandidate) {
      return configuredCandidate
    }
  }

  const isWindows = process.platform === 'win32'
  const exeExt = isWindows ? '.exe' : ''
  const binDir = getPackagedBinDir()
  const namedLegacy = {
    ffmpeg: path.join(binDir, `ffmpeg-legacy${exeExt}`),
    ffprobe: path.join(binDir, `ffprobe-legacy${exeExt}`),
  }

  return buildGpuCandidatePaths('legacy', namedLegacy.ffmpeg, namedLegacy.ffprobe, globalPaths.ffprobe)
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

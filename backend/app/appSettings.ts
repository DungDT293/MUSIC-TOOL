import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

export type AppGpuFfmpegProfile = 'auto' | 'modern' | 'legacy'

interface AppSettingsData {
  gpuFfmpegProfile?: AppGpuFfmpegProfile
  legacyGpuFfmpegPath?: string
}

let cachedSettings: AppSettingsData | null = null

function normalizeGpuFfmpegProfile(value: unknown): AppGpuFfmpegProfile {
  if (value === 'modern' || value === 'legacy' || value === 'auto') {
    return value
  }
  return 'auto'
}

function normalizeOptionalPath(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function getSettingsFilePath(): string {
  try {
    const userDataDir = app?.getPath?.('userData')
    if (userDataDir) {
      return path.join(userDataDir, 'appSettings.json')
    }
  } catch {
    // Fall back outside Electron app lifecycle, e.g. tests or early imports.
  }

  return path.join(os.tmpdir(), '93-media-tool-mix-nhac-appSettings.json')
}

function loadSettingsFromDisk(): AppSettingsData {
  const settingsPath = getSettingsFilePath()
  try {
    if (!fs.existsSync(settingsPath)) {
      return {}
    }
    const raw = fs.readFileSync(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw) as AppSettingsData
    return {
      gpuFfmpegProfile: normalizeGpuFfmpegProfile(parsed.gpuFfmpegProfile),
      legacyGpuFfmpegPath: normalizeOptionalPath(parsed.legacyGpuFfmpegPath),
    }
  } catch {
    return {}
  }
}

function saveSettingsToDisk(settings: AppSettingsData): void {
  const settingsPath = getSettingsFilePath()
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
}

export function getAppSettings(): AppSettingsData {
  if (!cachedSettings) {
    cachedSettings = loadSettingsFromDisk()
  }
  return cachedSettings
}

export function getGpuFfmpegProfileSetting(): AppGpuFfmpegProfile {
  return normalizeGpuFfmpegProfile(getAppSettings().gpuFfmpegProfile)
}

export function setGpuFfmpegProfileSetting(profile: AppGpuFfmpegProfile): AppGpuFfmpegProfile {
  const normalized = normalizeGpuFfmpegProfile(profile)
  cachedSettings = {
    ...getAppSettings(),
    gpuFfmpegProfile: normalized,
  }
  saveSettingsToDisk(cachedSettings)
  return normalized
}

export function getLegacyGpuFfmpegPathSetting(): string | undefined {
  return normalizeOptionalPath(getAppSettings().legacyGpuFfmpegPath)
}

export function setLegacyGpuFfmpegPathSetting(binaryPath: string | null | undefined): string | undefined {
  const normalized = normalizeOptionalPath(binaryPath)
  cachedSettings = {
    ...getAppSettings(),
    legacyGpuFfmpegPath: normalized,
  }
  saveSettingsToDisk(cachedSettings)
  return normalized
}

export function clearAppSettingsCache(): void {
  cachedSettings = null
}

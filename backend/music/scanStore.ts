import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import type { ScanMusicConfig, ScanMusicResult } from './scanMusic'

function isCurrentTrackId(track: ScanMusicResult['tracks'][number]): boolean {
  try {
    const canonicalPath = fs.realpathSync(track.path)
    if (track.folderType === 'background') {
      const bgHash = createHash('md5').update(`${track.genreId || 'default'}:background:${canonicalPath}`).digest('hex')
      if (track.id === bgHash) return true
    }
    const rawHash = createHash('md5').update(canonicalPath).digest('hex')
    if (track.id === rawHash) return true
    if (track.genreId && track.id === createHash('md5').update(`${track.genreId}:${canonicalPath}`).digest('hex')) {
      return true
    }
    return false
  } catch {
    return false
  }
}

const STORE_DIR = path.join(os.homedir(), '.93-media-tool-mix-nhac')
const STORE_FILE = path.join(STORE_DIR, 'music-scan-result.json')

let cache: ScanMusicResult | null = null

function ensureStoreDir() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true })
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function scanConfigKey(config?: ScanMusicConfig): string {
  if (!config) return ''
  return stableStringify({
    version: config.version,
    genres: (config.genres ?? []).map((genre) => ({
      id: genre.id,
      name: genre.name,
      priorityFolders: [...(genre.priorityFolders ?? [])].map((f) => f.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)),
      randomFolders: [...(genre.randomFolders ?? [])].map((f) => f.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)),
      openingFolders: [...(genre.openingFolders ?? [])].map((f) => f.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)),
      backgroundFolders: [...(genre.backgroundFolders ?? [])].map((f) => f.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  })
}

export function isScanResultUsable(result: ScanMusicResult | null | undefined, config?: ScanMusicConfig): result is ScanMusicResult {
  if (!result || !Array.isArray(result.tracks)) return false
  if (config && scanConfigKey(result.config) !== scanConfigKey(config)) return false
  const seenIds = new Set<string>()
  for (const track of result.tracks) {
    if (!track?.path || !path.isAbsolute(track.path) || !fs.existsSync(track.path) || !isCurrentTrackId(track)) {
      return false
    }
    if (seenIds.has(track.id)) return false
    seenIds.add(track.id)
  }
  return true
}

export function saveScanResult(result: ScanMusicResult): void {
  try {
    const payload: ScanMusicResult = {
      ...result,
      scannedAt: result.scannedAt ?? Date.now(),
    }
    cache = payload
    ensureStoreDir()
    fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), 'utf-8')
    console.log('[scanStore] Saved scan result:', STORE_FILE)
  } catch (err) {
    console.warn('[scanStore] Failed to save scan result:', err)
  }
}

export function loadScanResult(): ScanMusicResult | null {
  if (cache) {
    return cache
  }
  try {
    if (!fs.existsSync(STORE_FILE)) {
      return null
    }
    const raw = fs.readFileSync(STORE_FILE, 'utf-8')
    cache = JSON.parse(raw) as ScanMusicResult
    return cache
  } catch (err) {
    console.warn('[scanStore] Failed to load scan result:', err)
    return null
  }
}

export function loadUsableScanResult(): ScanMusicResult | null {
  const result = loadScanResult()
  if (!isScanResultUsable(result)) return null
  return { ...result, cacheStatus: 'loaded' }
}

export function loadReusableScanResult(config: ScanMusicConfig): ScanMusicResult | null {
  const result = loadScanResult()
  if (!isScanResultUsable(result, config)) return null
  return { ...result, cacheStatus: 'reused' }
}

export function clearScanResult(): void {
  cache = null
  try {
    if (fs.existsSync(STORE_FILE)) {
      fs.unlinkSync(STORE_FILE)
    }
  } catch (err) {
    console.warn('[scanStore] Failed to clear scan result:', err)
  }
}

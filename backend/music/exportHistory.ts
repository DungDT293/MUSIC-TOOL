import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface ExportedTrackInfo {
  name: string
  path: string
  durationSec: number
  startSec: number
}

export interface ExportHistoryEntry {
  id: string
  playlistId: string
  playlistName: string
  exportedAt: number
  outputPath: string
  tracks: ExportedTrackInfo[]
}

export interface DownloadPlaylistHistoryOptions {
  dates?: string[]
  entryIds?: string[]
  outputDir?: string
}

function getHistoryPath() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron')
    const base = app?.getPath?.('userData')
    if (base) {
      const dir = path.join(base, 'music-history')
      return { dir, file: path.join(dir, 'music_export_history.json') }
    }
  } catch {}

  const dir = path.join(process.cwd(), 'backups')
  return { dir, file: path.join(dir, 'music_export_history.json') }
}

const { dir: HISTORY_DIR, file: HISTORY_FILE } = getHistoryPath()
const MAX_ENTRIES_WHEN_LARGE = 1000

function ensureHistoryDir() {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true })
  }
}

export function loadHistory(): ExportHistoryEntry[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return []
    const raw = fs.readFileSync(HISTORY_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as ExportHistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.warn('[exportHistory] Failed to load history:', err)
    return []
  }
}

function pruneOld(entries: ExportHistoryEntry[]): ExportHistoryEntry[] {
  if (entries.length > MAX_ENTRIES_WHEN_LARGE) {
    return entries.sort((a, b) => b.exportedAt - a.exportedAt).slice(0, MAX_ENTRIES_WHEN_LARGE)
  }
  return entries
}

export function addHistoryEntry(entry: Omit<ExportHistoryEntry, 'id' | 'exportedAt'>): void {
  ensureHistoryDir()
  const current = loadHistory()
  const newEntry: ExportHistoryEntry = {
    ...entry,
    id: randomUUID(),
    exportedAt: Date.now(),
  }

  const merged = [newEntry, ...current]
  const final = merged.length > MAX_ENTRIES_WHEN_LARGE ? pruneOld(merged) : merged
  const sorted = final.sort((a, b) => b.exportedAt - a.exportedAt)

  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(sorted, null, 2), 'utf-8')
  } catch (err) {
    console.warn('[exportHistory] Failed to write history:', err)
  }
}

export function getRecentHistory(): ExportHistoryEntry[] {
  const all = loadHistory()
  if (all.length > MAX_ENTRIES_WHEN_LARGE) {
    return pruneOld(all)
  }
  return all.sort((a, b) => b.exportedAt - a.exportedAt)
}

export function deleteHistoryEntries(ids: string[]): { deleted: number } {
  if (!ids || ids.length === 0) return { deleted: 0 }
  const idSet = new Set(ids)
  const current = loadHistory()
  const filtered = current.filter((entry) => !idSet.has(entry.id))
  const deleted = current.length - filtered.length
  try {
    ensureHistoryDir()
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(filtered, null, 2), 'utf-8')
  } catch (err) {
    console.warn('[exportHistory] Failed to write after delete:', err)
  }
  return { deleted }
}

function formatTracklistTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function sanitizeFileStem(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()

  return sanitized || 'playlist_history'
}

function buildTracklistText(entry: ExportHistoryEntry): string {
  const lines = entry.tracks.map((track) => `${formatTracklistTime(track.startSec)} - ${track.name}`)
  return ['Tracklist:', ...lines].join('\r\n')
}

function createTracklistFilePath(targetDir: string, entry: ExportHistoryEntry, usedNames: Set<string>): string {
  const outputBaseName = entry.outputPath
    ? path.basename(entry.outputPath, path.extname(entry.outputPath))
    : ''
  const baseStem = sanitizeFileStem(outputBaseName || entry.playlistName)
  const preferredStem = `${baseStem}_tracklist`
  let fileName = `${preferredStem}.txt`
  let suffix = 2

  while (usedNames.has(fileName.toLowerCase()) || fs.existsSync(path.join(targetDir, fileName))) {
    fileName = `${preferredStem}_${suffix}.txt`
    suffix += 1
  }

  usedNames.add(fileName.toLowerCase())
  return path.join(targetDir, fileName)
}

export function downloadPlaylistHistory(
  options: DownloadPlaylistHistoryOptions
): { success: boolean; savedFiles: string[]; outputDir: string } {
  const { dates = [], entryIds = [], outputDir } = options
  const all = getRecentHistory()
  const targetDir = outputDir || HISTORY_DIR

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }
  } catch (err) {
    console.warn('[exportHistory] Cannot create output dir:', err)
    return { success: false, savedFiles: [], outputDir: targetDir }
  }

  let entriesToExport: ExportHistoryEntry[] = []
  if (entryIds.length > 0) {
    const entryIdSet = new Set(entryIds)
    entriesToExport = all.filter((entry) => entryIdSet.has(entry.id))
  } else if (dates.length > 0) {
    const dateSet = new Set(dates)
    entriesToExport = all.filter((entry) => dateSet.has(new Date(entry.exportedAt).toLocaleDateString()))
  }

  const savedFiles: string[] = []
  const usedNames = new Set<string>()

  for (const entry of entriesToExport) {
    if (!Array.isArray(entry.tracks) || entry.tracks.length === 0) continue
    const outFile = createTracklistFilePath(targetDir, entry, usedNames)
    try {
      fs.writeFileSync(outFile, `\uFEFF${buildTracklistText(entry)}`, 'utf-8')
      savedFiles.push(outFile)
    } catch (err) {
      console.warn(`[exportHistory] Cannot write ${outFile}:`, err)
    }
  }

  return { success: savedFiles.length > 0, savedFiles, outputDir: targetDir }
}

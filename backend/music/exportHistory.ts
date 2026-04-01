import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

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
  exportedAt: number // timestamp ms
  outputPath: string
  tracks: ExportedTrackInfo[]
}

// Lưu ở userData nếu có Electron app, fallback về ./backups
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
// Lưu tất cả lịch sử, không giới hạn 3 ngày
// Chỉ prune khi file quá lớn (> 10MB) để tránh file quá nặng
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
const MAX_ENTRIES_WHEN_LARGE = 1000 // Nếu file > 10MB, chỉ giữ 1000 entry gần nhất

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
  // Không prune theo thời gian nữa - lưu tất cả lịch sử
  // Chỉ prune khi có quá nhiều entries (giữ 1000 entry gần nhất)
  if (entries.length > MAX_ENTRIES_WHEN_LARGE) {
    // Sort theo thời gian (mới nhất trước) và chỉ giữ 1000 entry gần nhất
    return entries.sort((a, b) => b.exportedAt - a.exportedAt).slice(0, MAX_ENTRIES_WHEN_LARGE)
  }
  return entries
}

function shouldPruneByFileSize(): boolean {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return false
    const stats = fs.statSync(HISTORY_FILE)
    return stats.size > MAX_FILE_SIZE_BYTES
  } catch {
    return false
  }
}

export function addHistoryEntry(entry: Omit<ExportHistoryEntry, 'id' | 'exportedAt'>): void {
  ensureHistoryDir()
  const current = loadHistory()
  const newEntry: ExportHistoryEntry = {
    ...entry,
    id: randomUUID(),
    exportedAt: Date.now(),
  }
  
  // Thêm entry mới vào đầu danh sách (mới nhất trước)
  const merged = [newEntry, ...current]
  
  // Chỉ prune nếu có quá nhiều entries (giữ 1000 entry gần nhất)
  // Không prune theo thời gian - lưu tất cả các đợt
  const final = merged.length > MAX_ENTRIES_WHEN_LARGE ? pruneOld(merged) : merged
  
  // Sort theo thời gian (mới nhất trước)
  const sorted = final.sort((a, b) => b.exportedAt - a.exportedAt)
  
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(sorted, null, 2), 'utf-8')
  } catch (err) {
    console.warn('[exportHistory] Failed to write history:', err)
  }
}

export function getRecentHistory(): ExportHistoryEntry[] {
  // Trả về tất cả lịch sử, không giới hạn 3 ngày
  // Chỉ prune nếu có quá nhiều entries (> 1000)
  const all = loadHistory()
  if (all.length > MAX_ENTRIES_WHEN_LARGE) {
    return pruneOld(all)
  }
  return all.sort((a, b) => b.exportedAt - a.exportedAt)
}

/**
 * Xóa các lịch sử theo danh sách id.
 * Trả về số lượng đã xóa.
 */
export function deleteHistoryEntries(ids: string[]): { deleted: number } {
  if (!ids || ids.length === 0) return { deleted: 0 }
  const idSet = new Set(ids)
  const current = loadHistory()
  const filtered = current.filter((e) => !idSet.has(e.id))
  const deleted = current.length - filtered.length
  try {
    ensureHistoryDir()
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(filtered, null, 2), 'utf-8')
  } catch (err) {
    console.warn('[exportHistory] Failed to write after delete:', err)
  }
  return { deleted }
}

/**
 * Xuất danh sách track của các playlist thuộc ngày đã chọn ra thư mục.
 * Mỗi ngày → 1 file JSON.
 * @param dates mảng chuỗi ngày (toLocaleDateString() format)
 * @param outputDir thư mục xuất, mặc định là HISTORY_DIR
 */
export function downloadPlaylistHistory(dates: string[], outputDir?: string): { success: boolean; savedFiles: string[] } {
  const all = getRecentHistory()
  const targetDir = outputDir || HISTORY_DIR

  try {
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })
  } catch (err) {
    console.warn('[exportHistory] Cannot create output dir:', err)
    return { success: false, savedFiles: [] }
  }

  const savedFiles: string[] = []
  for (const dateStr of dates) {
    const entries = all.filter((e) => new Date(e.exportedAt).toLocaleDateString() === dateStr)
    if (entries.length === 0) continue

    // Tạo tên file an toàn từ dateStr (vd: "3/31/2026" → "2026-03-31")
    let safeName: string
    try {
      const d = new Date(dateStr)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      safeName = `${y}-${m}-${day}`
    } catch {
      safeName = dateStr.replace(/[/\\:*?"<>|]/g, '-')
    }

    const outFile = path.join(targetDir, `playlist_history_${safeName}.json`)
    try {
      fs.writeFileSync(outFile, JSON.stringify(entries, null, 2), 'utf-8')
      savedFiles.push(outFile)
    } catch (err) {
      console.warn(`[exportHistory] Cannot write ${outFile}:`, err)
    }
  }

  return { success: savedFiles.length > 0, savedFiles }
}

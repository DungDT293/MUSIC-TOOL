/**
 * Video Pool System — LRU Tracking + Session Sequence Deduplication
 *
 * Layer 1 — Pool ID (LRU):
 *   - Mỗi clip có ID = hash(filename + fileSize) → bền vững khi move folder
 *   - Ưu tiên clip chưa dùng → dùng lâu nhất (LRU-first)
 *   - Nếu pool không đủ target → fill bằng LRU (không crash)
 *
 * Layer 2 — Session Sequence:
 *   - Mỗi session export = 1 fingerprint = hash(50 clip IDs đầu tiên theo thứ tự)
 *   - Lưu 500 sessions gần nhất vào JSON
 *   - Shuffle cho đến khi fingerprint chưa được dùng → đảm bảo sequence mới
 *   - Với 3000 clips, xác suất collision ≈ 0
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VideoPoolEntry {
  id: string           // hash(basename + fileSize) — 12 hex chars
  filePath: string     // absolute path (best effort, cập nhật nếu move)
  basename: string     // tên file để matching
  fileSize: number     // bytes
  lastUsedAt: number | null  // timestamp ms, null = chưa bao giờ dùng
  useCount: number           // tổng số lần dùng
  addedAt: number            // khi nào lần đầu discover
}

export interface VideoPoolSession {
  sessionId: string
  timestamp: number
  dateCode: string
  sequenceFingerprint: string  // hash 16 hex của 50 clip IDs đầu theo thứ tự
  totalClips: number
}

interface VideoPoolStore {
  version: number
  updatedAt: number
  entries: Record<string, VideoPoolEntry>  // id → entry
}

interface VideoSessionStore {
  version: number
  sessions: VideoPoolSession[]
}

export interface PoolStats {
  totalClips: number
  neverUsed: number
  usedInLast24h: number
  usedInLast7d: number
  totalSessions: number
  lastSessionAt: number | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POOL_VERSION = 1
const SESSION_VERSION = 1
const MAX_SESSIONS = 500
const FINGERPRINT_LENGTH = 50  // số clip IDs đầu để tạo fingerprint
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000 // 30 ngày — xóa entries không còn file trên disk

// ── Storage paths ─────────────────────────────────────────────────────────────

function getStorageDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron')
    return path.join(app.getPath('userData'), 'videoPool')
  } catch {
    return path.join(process.cwd(), '.videoPool')
  }
}

function ensureDir(): void {
  const dir = getStorageDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function getPoolPath(): string {
  return path.join(getStorageDir(), 'videoPool.json')
}

function getSessionPath(): string {
  return path.join(getStorageDir(), 'videoPoolSessions.json')
}

// ── Load / Save ───────────────────────────────────────────────────────────────

function loadPoolStore(): VideoPoolStore {
  try {
    const fp = getPoolPath()
    if (!fs.existsSync(fp)) return { version: POOL_VERSION, updatedAt: Date.now(), entries: {} }
    return JSON.parse(fs.readFileSync(fp, 'utf8')) as VideoPoolStore
  } catch {
    return { version: POOL_VERSION, updatedAt: Date.now(), entries: {} }
  }
}

/** Atomic write: ghi vào file .tmp rồi rename → tránh corrupt khi crash giữa chừng */
function savePoolStore(store: VideoPoolStore): void {
  try {
    ensureDir()
    store.updatedAt = Date.now()
    const target = getPoolPath()
    const tmp = target + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
    fs.renameSync(tmp, target)
  } catch (err) {
    console.warn('[VideoPool] Failed to save pool store:', err)
  }
}

function loadSessionStore(): VideoSessionStore {
  try {
    const fp = getSessionPath()
    if (!fs.existsSync(fp)) return { version: SESSION_VERSION, sessions: [] }
    return JSON.parse(fs.readFileSync(fp, 'utf8')) as VideoSessionStore
  } catch {
    return { version: SESSION_VERSION, sessions: [] }
  }
}

/** Atomic write: ghi vào file .tmp rồi rename → tránh corrupt khi crash giữa chừng */
function saveSessionStore(store: VideoSessionStore): void {
  try {
    ensureDir()
    // Giữ chỉ MAX_SESSIONS sessions gần nhất
    if (store.sessions.length > MAX_SESSIONS) {
      store.sessions = store.sessions.slice(-MAX_SESSIONS)
    }
    const target = getSessionPath()
    const tmp = target + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
    fs.renameSync(tmp, target)
  } catch (err) {
    console.warn('[VideoPool] Failed to save session store:', err)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function generateClipId(basename: string, fileSize: number): string {
  return crypto.createHash('md5').update(`${basename}:${fileSize}`).digest('hex').slice(0, 12)
}

function generateFingerprint(clipIds: string[]): string {
  const sample = clipIds.slice(0, FINGERPRINT_LENGTH).join(',')
  return crypto.createHash('sha256').update(sample).digest('hex').slice(0, 16)
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Prune pool entries không còn file trên disk sau PRUNE_AFTER_MS.
 * Gọi tự động trong syncPoolWithFiles().
 * @returns số entries đã xóa
 */
function pruneStaleEntries(store: VideoPoolStore, currentFileIds: Set<string>): number {
  const now = Date.now()
  let pruned = 0
  for (const [id, entry] of Object.entries(store.entries)) {
    if (!currentFileIds.has(id) && now - entry.addedAt > PRUNE_AFTER_MS) {
      delete store.entries[id]
      pruned++
    }
  }
  if (pruned > 0) {
    console.log(`[VideoPool] Pruned ${pruned} stale entries (not seen on disk for 30+ days)`)
  }
  return pruned
}

/**
 * Scan file list và sync vào pool:
 * - Clip mới → thêm vào pool
 * - Clip đã có → cập nhật path nếu đã move
 * - Clip không còn file trên disk sau PRUNE_AFTER_MS → xóa khỏi pool
 * Trả về stats về thay đổi.
 *
 * PERF: Dùng async fs.promises.stat với batching (50 files/batch)
 *       để tránh block event loop khi có 3000+ files.
 */
export async function syncPoolWithFiles(
  filePaths: string[],
  onProgress?: (current: number, total: number) => void,
): Promise<{ added: number; updated: number; pruned: number; total: number }> {
  const store = loadPoolStore()
  let added = 0
  let updated = 0

  const BATCH_SIZE = 50
  const currentFileIds = new Set<string>()

  for (let batchStart = 0; batchStart < filePaths.length; batchStart += BATCH_SIZE) {
    const batch = filePaths.slice(batchStart, batchStart + BATCH_SIZE)

    if (onProgress && batchStart % 200 === 0) onProgress(batchStart, filePaths.length)

    const statResults = await Promise.allSettled(
      batch.map(async (fp) => {
        const stats = await fsp.stat(fp)
        return { fp, size: stats.size }
      })
    )

    for (const result of statResults) {
      if (result.status !== 'fulfilled') continue
      const { fp, size: fileSize } = result.value

      const basename = path.basename(fp)
      const id = generateClipId(basename, fileSize)
      currentFileIds.add(id)

      if (!store.entries[id]) {
        store.entries[id] = {
          id,
          filePath: fp,
          basename,
          fileSize,
          lastUsedAt: null,
          useCount: 0,
          addedAt: Date.now(),
        }
        added++
      } else {
        // Cập nhật path nếu clip đã move sang thư mục khác
        if (store.entries[id].filePath !== fp) {
          store.entries[id].filePath = fp
          updated++
        }
      }
    }
  }

  if (onProgress) onProgress(filePaths.length, filePaths.length)

  // Prune: xóa entries không còn file trên disk sau 30 ngày
  const pruned = pruneStaleEntries(store, currentFileIds)

  savePoolStore(store)
  return { added, updated, pruned, total: Object.keys(store.entries).length }
}

/**
 * Chọn clips theo thứ tự LRU:
 * 1. Chưa bao giờ dùng (addedAt asc)
 * 2. Dùng lâu nhất rồi (lastUsedAt asc)
 * 3. Nếu pool không đủ → fill bằng recently-used (không crash)
 *
 * PERF: Dùng async fs.promises.stat với batching (50 files/batch)
 *       để tránh block event loop khi có 3000+ files.
 *
 * @returns clip IDs + filePaths đã sắp xếp theo LRU priority (chưa shuffle)
 */
export async function pickClipsLRU(
  availableFilePaths: string[],
  targetCount: number,
): Promise<{ clipIds: string[]; filePaths: string[]; reusedCount: number; totalAvailable: number }> {
  const store = loadPoolStore()

  // Build id→filepath từ available files (async batched)
  const BATCH_SIZE = 50
  const pathMap = new Map<string, string>()

  for (let batchStart = 0; batchStart < availableFilePaths.length; batchStart += BATCH_SIZE) {
    const batch = availableFilePaths.slice(batchStart, batchStart + BATCH_SIZE)
    const statResults = await Promise.allSettled(
      batch.map(async (fp) => {
        const stats = await fsp.stat(fp)
        return { fp, size: stats.size }
      })
    )

    for (const result of statResults) {
      if (result.status !== 'fulfilled') continue
      const { fp, size } = result.value
      const id = generateClipId(path.basename(fp), size)
      pathMap.set(id, fp)
    }
  }

  const allIds = Array.from(pathMap.keys())
  const neverUsed: string[] = []
  const usedBefore: string[] = []

  for (const id of allIds) {
    const entry = store.entries[id]
    if (!entry || entry.lastUsedAt === null) {
      neverUsed.push(id)
    } else {
      usedBefore.push(id)
    }
  }

  // Sort never-used: addedAt asc (clip cũ nhất được thêm vào pool trước)
  neverUsed.sort((a, b) => {
    const ea = store.entries[a]?.addedAt ?? 0
    const eb = store.entries[b]?.addedAt ?? 0
    return ea - eb
  })

  // Sort used: lastUsedAt asc (dùng lâu nhất ưu tiên trước)
  usedBefore.sort((a, b) => {
    const ta = store.entries[a]?.lastUsedAt ?? 0
    const tb = store.entries[b]?.lastUsedAt ?? 0
    return ta - tb
  })

  // Gộp: never-used first → LRU
  const ordered = [...neverUsed, ...usedBefore]
  const selected = ordered.slice(0, Math.min(targetCount, ordered.length))
  const reusedCount = Math.max(0, selected.length - neverUsed.length)

  if (selected.length < targetCount) {
    console.warn(
      `[VideoPool] Pool không đủ target: ${selected.length}/${targetCount} (có ${allIds.length} clip available). ` +
      `Đã tái dùng ${reusedCount} clip.`
    )
  }

  const selectedFilePaths = selected.map(id => pathMap.get(id)!).filter(Boolean)

  return {
    clipIds: selected,
    filePaths: selectedFilePaths,
    reusedCount,
    totalAvailable: allIds.length,
  }
}

/**
 * Chọn clips LRU + shuffle để tạo sequence UNIQUE so với các session trước.
 *
 * - Fingerprint = hash của 50 clip IDs đầu tiên theo thứ tự xuất
 * - Shuffle tối đa maxAttempts lần cho đến khi unique
 * - Nếu vẫn không unique sau maxAttempts → dùng kết quả cuối cùng (xác suất collision ≈ 0)
 */
export async function pickUniqueSequence(
  availableFilePaths: string[],
  targetCount: number,
  dateCode: string,
  maxAttempts = 30,
): {
  filePaths: string[]
  clipIds: string[]
  reusedCount: number
  totalAvailable: number
  fingerprint: string
  isUnique: boolean
  attemptCount: number
} {
  const sessionStore = loadSessionStore()
  const usedFingerprints = new Set(sessionStore.sessions.map(s => s.sequenceFingerprint))

  // Lấy clips theo LRU
  const { clipIds, filePaths, reusedCount, totalAvailable } = await pickClipsLRU(availableFilePaths, targetCount)

  if (filePaths.length === 0) {
    return {
      filePaths: [],
      clipIds: [],
      reusedCount: 0,
      totalAvailable: 0,
      fingerprint: '',
      isUnique: true,
      attemptCount: 0,
    }
  }

  // Tạo paired array (giữ id↔filepath đồng bộ khi shuffle)
  let pairs = clipIds.map((id, i) => ({ id, fp: filePaths[i] }))

  // Shuffle lần đầu
  shuffleInPlace(pairs)
  let fingerprint = generateFingerprint(pairs.map(p => p.id))
  let isUnique = !usedFingerprints.has(fingerprint)
  let attempts = 1

  // Thử shuffle lại nếu trùng fingerprint
  while (!isUnique && attempts < maxAttempts) {
    shuffleInPlace(pairs)
    fingerprint = generateFingerprint(pairs.map(p => p.id))
    isUnique = !usedFingerprints.has(fingerprint)
    attempts++
  }

  if (!isUnique) {
    // Xác suất collision cực kỳ thấp → vẫn dùng, chỉ log warning
    console.warn(
      `[VideoPool] Không tìm được sequence unique sau ${maxAttempts} lần shuffle. ` +
      `Fingerprint ${fingerprint} có thể đã dùng. Tiếp tục với sequence hiện tại.`
    )
  }

  return {
    filePaths: pairs.map(p => p.fp),
    clipIds: pairs.map(p => p.id),
    reusedCount,
    totalAvailable,
    fingerprint,
    isUnique,
    attemptCount: attempts,
  }
}

/**
 * Đánh dấu clips đã dùng và lưu session sau khi export thành công.
 * Gọi hàm này SAU KHI export xong (không phải khi bắt đầu).
 */
export function markClipsUsed(clipIds: string[], dateCode: string, fingerprint: string): void {
  if (clipIds.length === 0) return

  const store = loadPoolStore()
  const now = Date.now()

  for (const id of clipIds) {
    if (store.entries[id]) {
      store.entries[id].lastUsedAt = now
      store.entries[id].useCount++
    } else {
      // Clip chưa được sync vào pool → add mới
      store.entries[id] = {
        id,
        filePath: '',
        basename: '',
        fileSize: 0,
        lastUsedAt: now,
        useCount: 1,
        addedAt: now,
      }
    }
  }

  savePoolStore(store)

  // Lưu session
  const sessionStore = loadSessionStore()
  sessionStore.sessions.push({
    sessionId: `${dateCode}-${now}`,
    timestamp: now,
    dateCode,
    sequenceFingerprint: fingerprint,
    totalClips: clipIds.length,
  })
  saveSessionStore(sessionStore)

  console.log(
    `[VideoPool] Đánh dấu ${clipIds.length} clip đã dùng. ` +
    `Session fingerprint: ${fingerprint}. ` +
    `Tổng sessions: ${sessionStore.sessions.length}`
  )
}

/**
 * Thống kê pool để hiển thị trong UI
 */
export function getPoolStats(): PoolStats {
  const store = loadPoolStore()
  const sessionStore = loadSessionStore()
  const now = Date.now()
  const DAY = 86_400_000

  const entries = Object.values(store.entries)
  const neverUsed = entries.filter(e => e.lastUsedAt === null).length
  const usedInLast24h = entries.filter(e => e.lastUsedAt !== null && now - e.lastUsedAt < DAY).length
  const usedInLast7d = entries.filter(e => e.lastUsedAt !== null && now - e.lastUsedAt < 7 * DAY).length
  const lastSession = sessionStore.sessions.at(-1)

  return {
    totalClips: entries.length,
    neverUsed,
    usedInLast24h,
    usedInLast7d,
    totalSessions: sessionStore.sessions.length,
    lastSessionAt: lastSession?.timestamp ?? null,
  }
}

/**
 * Reset toàn bộ pool (xóa file JSON)
 */
export function clearPool(): void {
  try {
    const poolFile = getPoolPath()
    const sessionFile = getSessionPath()
    if (fs.existsSync(poolFile)) fs.unlinkSync(poolFile)
    if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile)
    console.log('[VideoPool] Pool cleared.')
  } catch (err) {
    console.warn('[VideoPool] Failed to clear pool:', err)
  }
}

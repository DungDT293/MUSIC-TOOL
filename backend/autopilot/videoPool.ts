/**
 * Video Pool System — LRU Tracking + Session Sequence Deduplication
 *
 * Layer 1 — Pool ID (LRU):
 *   - Mỗi clip có ID = hash(filename + fileSize) → bền vững khi move folder
 *   - Ưu tiên clip chưa dùng → dùng lâu nhất (LRU-first)
 *   - Nếu pool không đủ target → fill bằng LRU (không crash)
 *
 * Layer 2 — Output Sequence:
 *   - Mỗi output thành công = SHA-256 của toàn bộ clip IDs theo đúng thứ tự
 *   - Lưu 500 output gần nhất vào JSON
 *   - Autopilot planner chặn sequence đã có trước khi chạy FFmpeg
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VideoPoolEntry {
  id: string           // hash(canonical physical path) — 12 hex chars
  filePath: string     // original readable path
  basename: string
  fileSize: number
  lastUsedAt: number | null
  useCount: number
  addedAt: number
}

export interface VideoPoolSession {
  sessionId: string
  timestamp: number
  dateCode: string
  sequenceFingerprint: string  // SHA-256 của toàn bộ clip IDs theo thứ tự
  totalClips: number
  /** Legacy entries hashed only a prefix and cannot establish full-sequence equality. */
  fullSequence?: boolean
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
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000
let poolWriteChain: Promise<void> = Promise.resolve()

function withPoolLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = poolWriteChain.then(operation)
  poolWriteChain = run.then(() => undefined, () => undefined)
  return run
}

function normalizeCanonicalPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

async function getPhysicalFile(fp: string): Promise<{ originalPath: string; canonicalPath: string; size: number }> {
  const stats = await fsp.stat(fp)
  const canonicalPath = await fsp.realpath(fp)
  return { originalPath: fp, canonicalPath: normalizeCanonicalPath(canonicalPath), size: stats.size }
}

function generateClipIdFromCanonicalPath(canonicalPath: string): string {
  return crypto.createHash('md5').update(canonicalPath).digest('hex').slice(0, 12)
}

export interface VideoPoolSyncOptions {
  completeSnapshot?: boolean
}

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
  ensureDir()
  // Giữ chỉ MAX_SESSIONS sessions gần nhất
  if (store.sessions.length > MAX_SESSIONS) {
    store.sessions = store.sessions.slice(-MAX_SESSIONS)
  }
  const target = getSessionPath()
  const tmp = target + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  fs.renameSync(tmp, target)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function generateClipId(basename: string, fileSize: number): string {
  // Legacy callers cannot resolve a path; keep deterministic fallback for IPC compatibility.
  return crypto.createHash('md5').update(`${basename}:${fileSize}`).digest('hex').slice(0, 12)
}

export async function generateClipIdForFile(filePath: string): Promise<string> {
  const physical = await getPhysicalFile(filePath)
  return generateClipIdFromCanonicalPath(physical.canonicalPath)
}

async function resolveUniqueFiles(filePaths: string[]): Promise<Array<{ fp: string; id: string; size: number }>> {
  const seen = new Set<string>()
  const resolved: Array<{ fp: string; id: string; size: number }> = []
  for (const fp of filePaths) {
    try {
      const physical = await getPhysicalFile(fp)
      if (seen.has(physical.canonicalPath)) continue
      seen.add(physical.canonicalPath)
      resolved.push({ fp: physical.originalPath, id: generateClipIdFromCanonicalPath(physical.canonicalPath), size: physical.size })
    } catch {
      // Missing/unreadable files stay out of pool selection.
    }
  }
  return resolved
}

function generateFingerprint(clipIds: string[]): string {
  return crypto.createHash('sha256').update(clipIds.join(',')).digest('hex')
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
  options: VideoPoolSyncOptions = {},
): Promise<{ added: number; updated: number; pruned: number; total: number }> {
  return withPoolLock(async () => {
    const store = loadPoolStore()
    let added = 0
    let updated = 0
    const resolved = await resolveUniqueFiles(filePaths)
    const currentFileIds = new Set(resolved.map((file) => file.id))

    for (let i = 0; i < resolved.length; i += 50) {
      const batch = resolved.slice(i, i + 50)
      if (onProgress && i % 200 === 0) onProgress(i, resolved.length)
      for (const { fp, id, size: fileSize } of batch) {
        const basename = path.basename(fp)
        const entry = store.entries[id]
        if (!entry) {
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
        } else if (entry.filePath !== fp || entry.fileSize !== fileSize) {
          entry.filePath = fp
          entry.basename = basename
          entry.fileSize = fileSize
          updated++
        }
      }
    }

    if (onProgress) onProgress(resolved.length, resolved.length)
    const pruned = options.completeSnapshot ? pruneStaleEntries(store, currentFileIds) : 0
    savePoolStore(store)
    return { added, updated, pruned, total: Object.keys(store.entries).length }
  })
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
  if (!Number.isSafeInteger(targetCount) || targetCount < 0) {
    throw new Error('Video pool targetCount must be a non-negative integer')
  }
  const store = loadPoolStore()
  const resolved = await resolveUniqueFiles(availableFilePaths)
  const pathMap = new Map(resolved.map((file) => [file.id, file.fp]))
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
 * Chọn thứ tự LRU đa dạng trước planner output sequence.
 *
 * Planner final export mới kiểm full ordered sequence thực tế cho từng output;
 * hàm này không được dùng để cấp guarantee history nữa.
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
    console.warn(
      `[VideoPool] Không tìm được thứ tự pool mới sau ${maxAttempts} lần shuffle. ` +
      'Final export sẽ kiểm full sequence từng output trước FFmpeg.'
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
export async function markClipsUsed(clipIds: string[], dateCode: string, fingerprint: string): Promise<void> {
  if (clipIds.length === 0) return
  await withPoolLock(async () => {
    const store = loadPoolStore()
    const now = Date.now()
    const knownIds = clipIds.filter((id) => !!store.entries[id])
    for (const id of knownIds) {
      store.entries[id].lastUsedAt = now
      store.entries[id].useCount += 1
    }
    if (knownIds.length === 0) return
    savePoolStore(store)
    const sessionStore = loadSessionStore()
    sessionStore.sessions.push({
      sessionId: `${dateCode}-${now}`,
      timestamp: now,
      dateCode,
      sequenceFingerprint: fingerprint,
      totalClips: clipIds.length,
      fullSequence: true,
    })
    saveSessionStore(sessionStore)
    console.log(`[VideoPool] Đánh dấu ${knownIds.length} clip đã dùng. Session fingerprint: ${fingerprint}.`)
  })
}

export async function markClipIdsUsed(clipIds: string[]): Promise<void> {
  if (clipIds.length === 0) return
  await withPoolLock(async () => {
    const store = loadPoolStore()
    const now = Date.now()
    for (const id of clipIds) {
      const entry = store.entries[id]
      if (!entry) continue
      entry.lastUsedAt = now
      entry.useCount += 1
    }
    savePoolStore(store)
  })
}

export async function markFilePathsUsed(
  filePaths: string[],
  dateCode: string,
  allowedClipIds?: ReadonlySet<string>,
): Promise<{ clipIds: string[]; fingerprint: string }> {
  const ids: string[] = []
  for (const filePath of filePaths) {
    try {
      const id = await generateClipIdForFile(filePath)
      if (!allowedClipIds || allowedClipIds.has(id)) ids.push(id)
    } catch {
      // Ignore files removed after export.
    }
  }
  const fingerprint = generateFingerprint(ids)
  await markClipsUsed(ids, dateCode, fingerprint)
  return { clipIds: ids, fingerprint }
}

export function fingerprintClipIds(clipIds: string[]): string {
  return generateFingerprint(clipIds)
}

export function getUsedSequenceFingerprints(): Set<string> {
  return new Set(
    loadSessionStore().sessions
      .filter((session) => session.fullSequence === true)
      .map((session) => session.sequenceFingerprint),
  )
}

export function hasLegacySequenceHistory(): boolean {
  return loadSessionStore().sessions.some((session) => session.fullSequence !== true)
}

export async function recordOutputSequences(
  sequences: Array<{ dateCode: string; clipIds: string[] }>,
): Promise<void> {
  if (sequences.length === 0) return
  await withPoolLock(async () => {
    const sessionStore = loadSessionStore()
    const existing = new Set(sessionStore.sessions.map((session) => session.sequenceFingerprint))
    const now = Date.now()
    for (const sequence of sequences) {
      const fingerprint = generateFingerprint(sequence.clipIds)
      if (!sequence.clipIds.length || existing.has(fingerprint)) continue
      sessionStore.sessions.push({
        sessionId: `${sequence.dateCode}-${now}-${sessionStore.sessions.length}`,
        timestamp: now,
        dateCode: sequence.dateCode,
        sequenceFingerprint: fingerprint,
        totalClips: sequence.clipIds.length,
        fullSequence: true,
      })
      existing.add(fingerprint)
    }
    saveSessionStore(sessionStore)
    const persisted = getUsedSequenceFingerprints()
    const missing = sequences.some((sequence) => {
      if (sequence.clipIds.length === 0) return false
      return !persisted.has(generateFingerprint(sequence.clipIds))
    })
    if (missing) throw new Error('Không thể lưu Video Pool sequence history; dừng trước khi xác nhận guarantee.')
  })
}

export function hasSequenceFingerprint(fingerprint: string, pending: ReadonlySet<string> = new Set()): boolean {
  return getUsedSequenceFingerprints().has(fingerprint) || pending.has(fingerprint)
}


export function clearPool(): void {
  poolWriteChain = poolWriteChain.then(async () => {
    try {
      const poolFile = getPoolPath()
      const sessionFile = getSessionPath()
      if (fs.existsSync(poolFile)) fs.unlinkSync(poolFile)
      if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile)
      console.log('[VideoPool] Pool cleared.')
    } catch (err) {
      console.warn('[VideoPool] Failed to clear pool:', err)
    }
  })
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

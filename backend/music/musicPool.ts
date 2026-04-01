/**
 * Music Pool — LRU Track Tracking for Cross-Session Deduplication
 *
 * Đảm bảo bài hát không bị lặp lại giữa các phiên tạo playlist liên tiếp.
 * - Tracks chưa bao giờ dùng → ưu tiên dùng trước (Tier 0)
 * - Tracks dùng > 7 ngày trước → ưu tiên kế tiếp (Tier 1)
 * - Tracks dùng gần đây → dùng cuối cùng (Tier 2)
 * - Persist qua JSON trong userData/musicPool/
 */

import fs from 'node:fs'
import path from 'node:path'
import type { ScannedTrack } from './scanMusic'

// ── Types ────────────────────────────────────────────────────────────────────

export interface MusicPoolEntry {
  id: string
  lastUsedAt: number | null  // null = chưa bao giờ dùng
  useCount: number
  addedAt: number
}

interface MusicPoolStore {
  version: number
  updatedAt: number
  entries: Record<string, MusicPoolEntry>
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POOL_VERSION = 1
const DAY_MS = 24 * 60 * 60 * 1000
const RECENT_THRESHOLD_DAYS = 7

// ── Storage ───────────────────────────────────────────────────────────────────

function getStorageDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron')
    return path.join(app.getPath('userData'), 'musicPool')
  } catch {
    return path.join(process.cwd(), '.musicPool')
  }
}

function ensureDir(): void {
  const dir = getStorageDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function getPoolPath(): string {
  return path.join(getStorageDir(), 'musicPool.json')
}

function loadPoolStore(): MusicPoolStore {
  try {
    const fp = getPoolPath()
    if (!fs.existsSync(fp)) return { version: POOL_VERSION, updatedAt: Date.now(), entries: {} }
    return JSON.parse(fs.readFileSync(fp, 'utf8')) as MusicPoolStore
  } catch {
    return { version: POOL_VERSION, updatedAt: Date.now(), entries: {} }
  }
}

function savePoolStore(store: MusicPoolStore): void {
  try {
    ensureDir()
    fs.writeFileSync(getPoolPath(), JSON.stringify(store, null, 2), 'utf8')
  } catch (err) {
    console.warn('[MusicPool] Không thể lưu pool store:', err)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sort tracks theo thứ tự LRU-tiered:
 *   Tier 0: chưa bao giờ dùng → đầu tiên (shuffled within tier)
 *   Tier 1: dùng > 7 ngày trước → tiếp theo (shuffled within tier)
 *   Tier 2: dùng gần đây → cuối cùng (shuffled within tier)
 *
 * Shuffle trong mỗi tier để có sự đa dạng trong phiên.
 */
export function sortByLRU(tracks: ScannedTrack[]): ScannedTrack[] {
  if (tracks.length === 0) return tracks

  const store = loadPoolStore()
  const now = Date.now()

  // Fisher-Yates shuffle
  function shuffleArr<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  const tier0: ScannedTrack[] = []  // chưa bao giờ dùng
  const tier1: ScannedTrack[] = []  // dùng > 7 ngày trước
  const tier2: ScannedTrack[] = []  // dùng gần đây

  for (const track of tracks) {
    const entry = store.entries[track.id]
    const lastUsed = entry?.lastUsedAt ?? null

    if (lastUsed === null) {
      tier0.push(track)
    } else if (now - lastUsed > RECENT_THRESHOLD_DAYS * DAY_MS) {
      tier1.push(track)
    } else {
      tier2.push(track)
    }
  }

  // Shuffle within each tier for intra-session variety
  return [...shuffleArr(tier0), ...shuffleArr(tier1), ...shuffleArr(tier2)]
}

/**
 * Đánh dấu các track đã được dùng trong phiên vừa rồi.
 * Gọi sau khi build playlists thành công.
 */
export function markTracksUsed(trackIds: string[]): void {
  if (trackIds.length === 0) return

  const store = loadPoolStore()
  const now = Date.now()

  for (const id of trackIds) {
    const existing = store.entries[id]
    if (existing) {
      existing.lastUsedAt = now
      existing.useCount++
    } else {
      store.entries[id] = {
        id,
        lastUsedAt: now,
        useCount: 1,
        addedAt: now,
      }
    }
  }

  store.updatedAt = now
  savePoolStore(store)
  console.log(`[MusicPool] Đã đánh dấu ${trackIds.length} bài đã dùng.`)
}

/**
 * Đăng ký tracks vào pool (lần đầu tiên scan).
 * Safe to call nhiều lần — chỉ thêm tracks chưa có.
 */
export function registerTracks(tracks: ScannedTrack[]): void {
  if (tracks.length === 0) return

  const store = loadPoolStore()
  const now = Date.now()
  let changed = false

  for (const track of tracks) {
    if (!store.entries[track.id]) {
      store.entries[track.id] = {
        id: track.id,
        lastUsedAt: null,
        useCount: 0,
        addedAt: now,
      }
      changed = true
    }
  }

  if (changed) {
    store.updatedAt = now
    savePoolStore(store)
  }
}

/**
 * Lấy số bài chưa bao giờ dùng theo folderType.
 */
export function getUnusedCount(trackIds: string[]): number {
  const store = loadPoolStore()
  return trackIds.filter(id => !store.entries[id] || store.entries[id].lastUsedAt === null).length
}

/**
 * Reset toàn bộ pool (xoá lịch sử sử dụng).
 */
export function clearMusicPool(): void {
  try {
    const fp = getPoolPath()
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
    console.log('[MusicPool] Pool đã được reset.')
  } catch (err) {
    console.warn('[MusicPool] Không thể reset pool:', err)
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface MusicPoolTrackStat {
  id: string
  lastUsedAt: number | null
  useCount: number
  addedAt: number
  tier: 0 | 1 | 2  // 0=chưa dùng, 1=>7ngày, 2=gần đây
  daysSinceUsed: number | null  // null = chưa bao giờ dùng
}

export interface MusicPoolStats {
  total: number         // tổng tracks trong pool
  tier0: number         // chưa bao giờ dùng
  tier1: number         // dùng > 7 ngày
  tier2: number         // dùng gần đây (≤ 7 ngày)
  updatedAt: number | null
  tracks: MusicPoolTrackStat[]  // chi tiết từng track (join với scanResult nếu có)
}

/**
 * Lấy stats đầy đủ của pool, join với danh sách trackIds hiện tại.
 * @param currentTrackIds các ID đang có trong thư viện hiện tại (từ scanResult)
 */
export function getMusicPoolStats(currentTrackIds: string[]): MusicPoolStats {
  const store = loadPoolStore()
  const now = Date.now()
  const currentSet = new Set(currentTrackIds)

  // Chỉ tính tracks đang có trong thư viện hiện tại
  const relevantEntries = Object.values(store.entries).filter(e => currentSet.has(e.id))

  // Tracks trong thư viện nhưng chưa có trong pool (chưa register)
  const inPoolIds = new Set(relevantEntries.map(e => e.id))
  const unregisteredIds = currentTrackIds.filter(id => !inPoolIds.has(id))

  const allStats: MusicPoolTrackStat[] = []

  for (const entry of relevantEntries) {
    const lastUsed = entry.lastUsedAt
    let tier: 0 | 1 | 2
    let daysSinceUsed: number | null = null

    if (lastUsed === null) {
      tier = 0
    } else {
      const diffDays = (now - lastUsed) / DAY_MS
      daysSinceUsed = Math.floor(diffDays)
      tier = diffDays > RECENT_THRESHOLD_DAYS ? 1 : 2
    }

    allStats.push({ id: entry.id, lastUsedAt: entry.lastUsedAt, useCount: entry.useCount, addedAt: entry.addedAt, tier, daysSinceUsed })
  }

  // Tracks chưa register → coi như tier 0
  for (const id of unregisteredIds) {
    allStats.push({ id, lastUsedAt: null, useCount: 0, addedAt: now, tier: 0, daysSinceUsed: null })
  }

  const tier0 = allStats.filter(t => t.tier === 0).length
  const tier1 = allStats.filter(t => t.tier === 1).length
  const tier2 = allStats.filter(t => t.tier === 2).length

  return {
    total: allStats.length,
    tier0,
    tier1,
    tier2,
    updatedAt: store.updatedAt ?? null,
    tracks: allStats,
  }
}

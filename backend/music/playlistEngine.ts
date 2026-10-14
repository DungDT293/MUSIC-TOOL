import type { ScannedTrack } from './scanMusic'
import { randomUUID } from 'crypto'
import { sortByLRU } from './musicPool'

export interface PlaylistTrack extends ScannedTrack {
  order: number // vị trí trong playlist (1-based)
  cumulativeDuration: number // tổng thời lượng tính đến hết bài này (giây)
  role?: 'opening' | 'ending'
}

export interface PlaylistDefinition {
  id: string
  name: string
  targetDurationSec: number
  totalDurationSec: number
  priorityDurationSec: number
  randomDurationSec: number
  openingDurationSec?: number
  openingCount?: number
  priorityCount: number
  randomCount: number
  endingDurationSec?: number
  endingCount?: number
  backgroundTrack?: ScannedTrack
  bgMusicVolumeDb?: number
  mainMusicVolumeDb?: number
  tracks: PlaylistTrack[]
  createdAt: number
  genreId?: string
  genreName?: string
  genreSettings?: {
    smoothTransitions: boolean
    crossfadeDurationSec?: number
    normalizeLoudness: boolean
  }
}

export interface BuildPlaylistWarning {
  type: 'priority_ratio_not_met' | 'track_reuse_needed' | 'insufficient_tracks'
  playlistIndex?: number // undefined = warning toàn cục
  message: string
  actualRatioPct?: number  // tỷ lệ thực tế đạt được (%)
  targetRatioPct?: number  // tỷ lệ người dùng yêu cầu (%)
}

export interface BuildPlaylistsResult {
  playlists: PlaylistDefinition[]
  warnings: BuildPlaylistWarning[]
}

export interface BuildPlaylistsOptions {
  tracks: ScannedTrack[]
  pinnedTrackIds: string[]
  playlistCount: number
  targetDurationMinutes: number
  priorityRatioMin?: number // default 0.65
  priorityRatioMax?: number // default 0.8
  openingTracks?: ScannedTrack[]
  pinnedOpeningTrackIds?: string[]
  combineAllPinnedOpenings?: boolean
  endingTracks?: ScannedTrack[]
  backgroundTracks?: ScannedTrack[]
  selectedBackgroundTrackId?: string
  bgMusicVolumeDb?: number
  mainMusicVolumeDb?: number
  /** Thời lượng crossfade (giây). Nếu có, target sẽ được inflate để sau crossfade vẫn đạt đủ thời lượng */
  crossfadeDurationSec?: number
  /** Renderer batch flow: append instead of replacing previous genre playlists. */
  replaceExisting?: boolean
  genreId?: string
  genreName?: string
  genreSettings?: {
    smoothTransitions: boolean
    crossfadeDurationSec?: number
    normalizeLoudness: boolean
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Rotate array by offset (xoay vòng để mỗi playlist có thứ tự pinned khác nhau)
function rotate<T>(array: T[], offset: number): T[] {
  if (array.length === 0) return array
  const n = ((offset % array.length) + array.length) % array.length
  return [...array.slice(n), ...array.slice(0, n)]
}

// Thêm track vào playlist
function pushTrack(
  playlistTracks: PlaylistTrack[],
  track: ScannedTrack,
  currentTotalSec: number,
  role?: PlaylistTrack['role']
): PlaylistTrack {
  const pt: PlaylistTrack = {
    ...track,
    order: playlistTracks.length + 1,
    cumulativeDuration: currentTotalSec + track.duration,
    ...(role ? { role } : {}),
  }
  playlistTracks.push(pt)
  return pt
}

// ── Core builder ──────────────────────────────────────────────────────────────

/**
 * Build một playlist đơn theo thứ tự: Opening → Pinned → Priority → Random → Ending
 *
 * Thứ tự CỨNG, không bao giờ trộn lẫn nhóm.
 * Mỗi nhóm nhận thứ tự đã được xoay sẵn từ buildPlaylists.
 *
 * @param index  chỉ số playlist (0-based), dùng để tính offset xoay vòng
 * @param pinnedTracks  bài đã ghim — luôn đứng đầu, xoay vòng theo index
 * @param priorityPool  nhạc ưu tiên (đã LRU-sorted), có index offset
 * @param randomPool    nhạc random (đã LRU-sorted), có index offset
 * @param targetSec     thời lượng mục tiêu (giây)
 * @param desiredPriorityMin  ngưỡng tối thiểu nhạc priority (giây)
 * @param desiredPriorityMax  ngưỡng tối đa nhạc priority (giây)
 * @param allowReuse    cho phép lặp bài nếu không đủ thư viện
 */
function buildSinglePlaylist(
  index: number,
  pinnedTracks: ScannedTrack[],
  priorityPool: ScannedTrack[],
  randomPool: ScannedTrack[],
  targetSec: number,
  desiredPriorityMin: number,
  _desiredPriorityMax: number,
  allowReuse: boolean,
  openingTrack: ScannedTrack | ScannedTrack[] | undefined,
  endingTracks: ScannedTrack[] = [],
  meta: {
    genreId?: string
    genreName?: string
    genreSettings?: PlaylistDefinition['genreSettings']
  } = {}
): PlaylistDefinition {
  const playlistTracks: PlaylistTrack[] = []
  const usedTrackIds = new Set<string>()
  let lastTrackId: string | null = null
  let currentTotalSec = 0
  let currentBodySec = 0
  const openingList = Array.isArray(openingTrack)
    ? openingTrack
    : openingTrack ? [openingTrack] : []
  for (const op of openingList) {
    const opening = pushTrack(playlistTracks, op, currentTotalSec, 'opening')
    currentTotalSec = opening.cumulativeDuration
    lastTrackId = op.id
    if (!allowReuse) usedTrackIds.add(op.id)
  }
  let currentPrioritySec = 0
  let currentRandomSec = 0

  // ── Hàm tiện ích ──────────────────────────────────────────────────────────

  function canUse(track: ScannedTrack): boolean {
    if (track.id === lastTrackId) return false
    if (!allowReuse && usedTrackIds.has(track.id)) return false
    return true
  }

  function add(track: ScannedTrack): void {
    const pt = pushTrack(playlistTracks, track, currentTotalSec)
    currentTotalSec = pt.cumulativeDuration
    currentBodySec += track.duration
    lastTrackId = track.id
    if (!allowReuse) usedTrackIds.add(track.id)
    if (track.folderType === 'priority') {
      currentPrioritySec += track.duration
    } else {
      currentRandomSec += track.duration
    }
  }

  function drainPool(
    pool: ScannedTrack[],
    startOffset: number,
    stopWhen: () => boolean,
    maxCycles: number
  ): void {
    if (pool.length === 0 || stopWhen()) return
    let idx = startOffset % pool.length
    let cycles = 0
    let addedInCycle = false

    outerLoop:
    while (!stopWhen() && cycles < maxCycles) {
      addedInCycle = false
      for (let j = 0; j < pool.length; j++) {
        const track = pool[idx]
        if (canUse(track)) {
          add(track)
          addedInCycle = true
          if (stopWhen()) break outerLoop
        }
        idx = (idx + 1) % pool.length
      }
      if (!addedInCycle) {
        if (!allowReuse) break // không còn bài chưa dùng
        // allowReuse: chọn deterministic, tránh lastTrackId để candidate có thể exhaustively test
        const available = pool.filter(t => t.id !== lastTrackId)
        const picked = available.length > 0
          ? available[(cycles + startOffset) % available.length]
          : undefined
        if (picked) {
          add(picked)
          if (stopWhen()) break
        } else {
          break
        }
      }
      cycles++
    }
  }

  const maxCycles = allowReuse ? 200 : 5

  // ── BƯỚC 1: Pinned tracks (luôn đứng sau Opening, giữ nguyên toàn bộ bài ghim, candidate đã xoay sẵn) ────────
  if (pinnedTracks.length > 0) {
    for (const track of pinnedTracks) {
      if (canUse(track)) add(track)
    }
  }

  // ── BƯỚC 2: Priority tracks cho đến khi đạt ngưỡng MIN ───────────────────
  if (currentBodySec < targetSec) {
    drainPool(
      priorityPool,
      0,
      () => currentBodySec >= targetSec || currentPrioritySec >= desiredPriorityMin,
      maxCycles
    )
  }

  // ── BƯỚC 3: Random tracks cho đủ targetSec ───────────────────────────────
  if (currentBodySec < targetSec && randomPool.length > 0) {
    drainPool(
      randomPool,
      0,
      () => currentBodySec >= targetSec,
      maxCycles
    )
  }

  // ── BƯỚC 4: Nếu random pool rỗng, tiếp tục priority để đủ target ─────────
  // Không append priority sau random: group order phải luôn giữ cứng.
  if (currentBodySec < targetSec && randomPool.length === 0) {
    drainPool(
      priorityPool,
      0,
      () => currentBodySec >= targetSec,
      allowReuse ? 100 : 3
    )
  }

  // ── BƯỚC 5: Nhạc thêm cuối — append sau target chính, không tính vào ratio ──
  for (const track of endingTracks) {
    const pt = pushTrack(playlistTracks, track, currentTotalSec, 'ending')
    currentTotalSec = pt.cumulativeDuration
  }

  const endingIdSet = new Set(endingTracks.map(t => t.id))

  // ── Tính stats ────────────────────────────────────────────────────────────
  let finalPrioritySec = 0, finalRandomSec = 0
  let finalPriorityCount = 0, finalRandomCount = 0
  let openingDurationSec = 0, openingCount = 0
  let endingDurationSec = 0, endingCount = 0
  let cumulative = 0

  for (const track of playlistTracks) {
    cumulative += track.duration
    track.order = playlistTracks.indexOf(track) + 1
    track.cumulativeDuration = cumulative
    if (track.role === 'opening') {
      openingDurationSec += track.duration
      openingCount++
    } else if (track.role === 'ending' || endingIdSet.has(track.id)) {
      endingDurationSec += track.duration
      endingCount++
    } else if (track.folderType === 'priority') {
      finalPrioritySec += track.duration
      finalPriorityCount++
    } else {
      finalRandomSec += track.duration
      finalRandomCount++
    }
  }

  const mainDurationSec = cumulative - openingDurationSec - endingDurationSec

  if (mainDurationSec < targetSec) {
    console.warn(`[PlaylistEngine] Playlist ${index + 1}: chỉ đạt ${mainDurationSec.toFixed(0)}s / ${targetSec}s trước nhạc thêm cuối. Thư viện không đủ bài.`)
  }

  const name = meta.genreName
    ? `${meta.genreName} - Playlist ${index + 1}`
    : `Playlist ${index + 1}`

  return {
    id: randomUUID(),
    name,
    targetDurationSec: targetSec,
    totalDurationSec: cumulative,
    priorityDurationSec: finalPrioritySec,
    randomDurationSec: finalRandomSec,
    openingDurationSec,
    openingCount,
    priorityCount: finalPriorityCount,
    randomCount: finalRandomCount,
    endingDurationSec,
    endingCount,
    tracks: playlistTracks,
    createdAt: Date.now(),
    genreId: meta.genreId,
    genreName: meta.genreName,
    genreSettings: meta.genreSettings,
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildPlaylists(options: BuildPlaylistsOptions): BuildPlaylistsResult {
  const {
    tracks,
    pinnedTrackIds,
    playlistCount,
    targetDurationMinutes,
    priorityRatioMin = 0.65,
    priorityRatioMax = 0.8,
    openingTracks = [],
    pinnedOpeningTrackIds,
    combineAllPinnedOpenings,
    endingTracks = [],
    crossfadeDurationSec,
    genreId,
    genreName,
    genreSettings,
  } = options

  // Lọc phòng vệ: nếu có genreId, bảo đảm chỉ dùng tracks thuộc genreId này
  const targetGenreId = genreId
  const scopedTracks = targetGenreId
    ? tracks.filter((t) => !t.genreId || t.genreId === targetGenreId)
    : tracks

  const uniqueOpeningTracks = (targetGenreId
    ? openingTracks.filter((t) => !t.genreId || t.genreId === targetGenreId)
    : openingTracks
  ).filter((track, index, list) => {
    if (!track?.path || !track.duration || track.duration <= 0) return false
    const key = track.path.toLowerCase()
    return list.findIndex(t => t.path?.toLowerCase() === key) === index
  })

  // Nếu người dùng chọn ghim các bài mở đầu cụ thể:
  const pinnedOpeningTracks = (pinnedOpeningTrackIds && pinnedOpeningTrackIds.length > 0)
    ? uniqueOpeningTracks.filter(t => pinnedOpeningTrackIds.includes(t.id))
    : []

  const effectiveOpeningPool = pinnedOpeningTracks.length > 0
    ? pinnedOpeningTracks
    : uniqueOpeningTracks

  if (playlistCount < 1) throw new Error('playlistCount must be >= 1')
  if (targetDurationMinutes <= 0) throw new Error('targetDurationMinutes must be > 0')

  const targetSec = targetDurationMinutes * 60

  // Nếu có crossfade, inflate targetSec để sau khi overlap playlist vẫn đạt đủ thời lượng.
  // Ước tính số bài dựa trên thời lượng trung bình 3.5 phút (210s), rồi tính tổng overlap.
  const effectiveTargetSec = (() => {
    if (!crossfadeDurationSec || crossfadeDurationSec <= 0) return targetSec
    const avgTrackSec = 210 // 3.5 phút — trung bình nhạc DJ/pop
    const estimatedTrackCount = Math.ceil(targetSec / avgTrackSec)
    const totalOverlap = crossfadeDurationSec * Math.max(0, estimatedTrackCount - 1)
    return targetSec + totalOverlap
  })()
  const desiredPriorityMin = effectiveTargetSec * priorityRatioMin
  const desiredPriorityMax = effectiveTargetSec * priorityRatioMax
  const warnings: BuildPlaylistWarning[] = []

  // ── Phân loại tracks ──────────────────────────────────────────────────────
  const uniqueEndingTracks = (targetGenreId
    ? endingTracks.filter((t) => !t.genreId || t.genreId === targetGenreId)
    : endingTracks
  ).filter((track, index, list) => {
    if (!track?.path || !track.duration || track.duration <= 0) return false
    const key = track.path.toLowerCase()
    return list.findIndex(t => t.path?.toLowerCase() === key) === index
  })
  const openingPathSet = new Set(uniqueOpeningTracks.map(t => t.path.toLowerCase()))
  const endingPathSet = new Set(uniqueEndingTracks.map(t => t.path.toLowerCase()))
  const uniqueBackgroundTracks = (targetGenreId
    ? (options.backgroundTracks || scopedTracks.filter((t) => t.folderType === 'background')).filter((t) => !t.genreId || t.genreId === targetGenreId)
    : (options.backgroundTracks || scopedTracks.filter((t) => t.folderType === 'background'))
  ).filter((track, index, list) => {
    if (!track?.path || !track.duration || track.duration <= 0) return false
    const key = track.path.toLowerCase()
    return list.findIndex(t => t.path?.toLowerCase() === key) === index
  })
  const mainTracks = scopedTracks.filter(t =>
    !openingPathSet.has(t.path.toLowerCase()) &&
    !endingPathSet.has(t.path.toLowerCase()) &&
    t.folderType !== 'opening' &&
    t.folderType !== 'background'
  )
  const pinnedTracks = mainTracks.filter(t => pinnedTrackIds.includes(t.id))
  const priorityTracks = mainTracks.filter(t => t.folderType === 'priority' && !pinnedTrackIds.includes(t.id))
  const randomTracks = mainTracks.filter(t => t.folderType === 'random' && !pinnedTrackIds.includes(t.id))

  // ── LRU sort: tracks chưa dùng sẽ lên trước ──────────────────────────────
  // Priority và random được sort riêng theo LRU pool
  // Pinned không cần sort LRU (người dùng đã chọn cụ thể, chỉ xoay vòng vị trí)
  const lruSortedPriority = sortByLRU(priorityTracks)
  const lruSortedRandom = sortByLRU(randomTracks)

  console.log(`[PlaylistEngine] Phân loại: ${pinnedTracks.length} pinned, ${priorityTracks.length} priority, ${randomTracks.length} random`)

  // ── Kiểm tra đủ tỷ lệ priority không ─────────────────────────────────────
  const totalPriorityDuration = [...pinnedTracks, ...priorityTracks]
    .filter(t => t.folderType === 'priority' || pinnedTrackIds.includes(t.id))
    .reduce((s, t) => s + t.duration, 0)

  if (desiredPriorityMin > 0 && totalPriorityDuration < desiredPriorityMin) {
    const achievablePct = totalPriorityDuration > 0
      ? Math.round((totalPriorityDuration / effectiveTargetSec) * 100)
      : 0
    warnings.push({
      type: 'priority_ratio_not_met',
      message: `Nhạc ưu tiên chỉ đủ cho ~${achievablePct}% thời lượng (yêu cầu ${Math.round(priorityRatioMin * 100)}%). Sẽ bổ sung thêm nhạc random để đủ thời lượng.`,
      actualRatioPct: achievablePct,
      targetRatioPct: Math.round(priorityRatioMin * 100),
    })
  }

  // ── Kiểm tra có cần reuse không ──────────────────────────────────────────
  const totalLibraryDuration = mainTracks.reduce((s, t) => s + t.duration, 0)
  const totalRequiredDuration = playlistCount * effectiveTargetSec
  const allowReuse = totalRequiredDuration > totalLibraryDuration

  if (allowReuse) {
    console.log(`[PlaylistEngine] Cần reuse: required ${totalRequiredDuration.toFixed(0)}s > library ${totalLibraryDuration.toFixed(0)}s`)
    warnings.push({
      type: 'track_reuse_needed',
      message: `Thư viện (${Math.round(totalLibraryDuration / 60)} phút) không đủ cho ${playlistCount} playlist × ${targetDurationMinutes} phút. Một số bài sẽ được lặp lại (nhưng không lặp liên tiếp).`,
    })
  }

  // ── Kiểm tra thư viện rỗng ────────────────────────────────────────────────
  if (mainTracks.length === 0) {
    warnings.push({
      type: 'insufficient_tracks',
      message: 'Không có bài hát nào trong thư viện. Vui lòng quét nhạc trước.',
    })
    return { playlists: [], warnings }
  }

  // ── Build từng playlist ───────────────────────────────────────────────────
  const playlists: PlaylistDefinition[] = []
  const playlistSignatures = new Set<string>()
  const shouldCombineOpenings = Boolean(combineAllPinnedOpenings && pinnedOpeningTracks.length > 0)
  const openingVariants = shouldCombineOpenings
    ? 1
    : Math.max(1, effectiveOpeningPool.length)
  const pinnedVariants = Math.max(1, pinnedTracks.length)
  const priorityVariants = Math.max(1, priorityTracks.length)
  const randomVariants = Math.max(1, randomTracks.length)
  for (let i = 0; i < playlistCount; i++) {
    let playlist: PlaylistDefinition | undefined
    let signature = ''

    // Cơ chế tạo candidate variant cho Opening / Pinned / Priority / Random.
    // Lần lặp đầu tiên (dOpen=0, dPin=0, dPrio=0, dRand=0) tương ứng với quy tắc xoay vòng tự nhiên
    // của playlist i. Nếu bị trùng signature, tiếp tục thử các biến thể kết hợp khác.
    outerVariantLoop:
    for (let dOpen = 0; dOpen < openingVariants; dOpen++) {
      for (let dPin = 0; dPin < pinnedVariants; dPin++) {
        for (let dPrio = 0; dPrio < priorityVariants; dPrio++) {
          for (let dRand = 0; dRand < randomVariants; dRand++) {
            const openIdx = (i + dOpen) % openingVariants
            const pinOff = (i + dPin) % pinnedVariants
            const prioOff = (i + dPrio) % priorityVariants
            const randOff = (i + dRand) % randomVariants

            const openingForBuild = shouldCombineOpenings
              ? pinnedOpeningTracks
              : effectiveOpeningPool.length > 0
                ? effectiveOpeningPool[openIdx]
                : undefined
            const pinnedForBuild = rotate(pinnedTracks, pinOff)
            const priorityForBuild = rotate(lruSortedPriority, prioOff)
            const randomForBuild = rotate(lruSortedRandom, randOff)

            const candidate = buildSinglePlaylist(
              i,
              pinnedForBuild,
              priorityForBuild,
              randomForBuild,
              effectiveTargetSec,
              desiredPriorityMin,
              desiredPriorityMax,
              allowReuse,
              openingForBuild,
              uniqueEndingTracks,
              { genreId, genreName, genreSettings }
            )

            // So sánh toàn bộ chuỗi ID theo thứ tự: openingId|pinnedId1|pinnedId2|priorityId1|randomId1...
            const candidateSignature = candidate.tracks.map(t => t.id).join('|')
            if (!playlistSignatures.has(candidateSignature)) {
              playlist = candidate
              signature = candidateSignature
              break outerVariantLoop
            }
          }
        }
      }
    }

    if (!playlist) {
      throw new Error(
        `Không thể tạo đủ ${playlistCount} playlist có thứ tự bài hát khác nhau. ` +
        `Thư viện hiện tại không có đủ biến thể thứ tự cho playlist ${i + 1}. ` +
        `Giảm số playlist hoặc thêm bài hát rồi thử lại.`
      )
    }

    playlistSignatures.add(signature)

    // ── Cảnh báo per-playlist nếu tỷ lệ lệch nhiều ────────────────────────
    if (playlist.totalDurationSec > 0) {
      const mainDurationSec = Math.max(playlist.totalDurationSec - (playlist.openingDurationSec ?? 0) - (playlist.endingDurationSec ?? 0), 0)
      const actualPct = mainDurationSec > 0 ? Math.round((playlist.priorityDurationSec / mainDurationSec) * 100) : 0
      const targetPct = Math.round(priorityRatioMin * 100)

      // Warn nếu thực tế thấp hơn yêu cầu tối thiểu quá 10%
      if (actualPct < targetPct - 10) {
        const alreadyWarned = warnings.some(w => w.type === 'priority_ratio_not_met' && w.playlistIndex == null)
        if (!alreadyWarned) {
          warnings.push({
            type: 'priority_ratio_not_met',
            playlistIndex: i,
            message: `Playlist ${i + 1}: nhạc ưu tiên chỉ đạt ${actualPct}% (yêu cầu ${targetPct}%). Không đủ nhạc ưu tiên trong thư viện.`,
            actualRatioPct: actualPct,
            targetRatioPct: targetPct,
          })
        }
      }

      // Warn nếu playlist không đủ thời lượng
      if (mainDurationSec < effectiveTargetSec * 0.9) {
        warnings.push({
          type: 'insufficient_tracks',
          playlistIndex: i,
          message: `Playlist ${i + 1}: chỉ đạt ${Math.round(mainDurationSec / 60)} phút / ${targetDurationMinutes} phút trước nhạc thêm cuối do thư viện không đủ bài.`,
        })
      }
    }

    if (uniqueBackgroundTracks.length > 0) {
      const pickedBg = options.selectedBackgroundTrackId
        ? (uniqueBackgroundTracks.find(t => t.id === options.selectedBackgroundTrackId) || uniqueBackgroundTracks[i % uniqueBackgroundTracks.length])
        : uniqueBackgroundTracks[i % uniqueBackgroundTracks.length]
      playlist.backgroundTrack = pickedBg
      playlist.bgMusicVolumeDb = options.bgMusicVolumeDb ?? -4
      playlist.mainMusicVolumeDb = options.mainMusicVolumeDb ?? 2
    }

    playlists.push(playlist)

    const statsDurationSec = Math.max(playlist.totalDurationSec - (playlist.endingDurationSec ?? 0), 0)
    const pPct = statsDurationSec > 0
      ? ((playlist.priorityDurationSec / statsDurationSec) * 100).toFixed(1)
      : '0.0'
    const rPct = statsDurationSec > 0
      ? ((playlist.randomDurationSec / statsDurationSec) * 100).toFixed(1)
      : '0.0'
    console.log(
      `[PlaylistEngine] P${i + 1}: ${playlist.totalDurationSec.toFixed(0)}s, priority=${pPct}%, random=${rPct}%, tracks=${playlist.tracks.length}`
    )
  }

  return { playlists, warnings }
}

// ── In-memory storage + disk persistence ─────────────────────────────────────

import fs from 'node:fs'
import path from 'node:path'

function getPlaylistStorePath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron')
    return path.join(app.getPath('userData'), 'playlists.json')
  } catch {
    return path.join(process.cwd(), '.playlists.json')
  }
}

function persistPlaylists(list: PlaylistDefinition[]): void {
  try {
    fs.writeFileSync(getPlaylistStorePath(), JSON.stringify(list, null, 2), 'utf-8')
  } catch (err) {
    console.warn('[PlaylistEngine] Không thể lưu playlist ra disk:', err)
  }
}

function loadPersistedPlaylists(): PlaylistDefinition[] {
  try {
    const fp = getPlaylistStorePath()
    if (!fs.existsSync(fp)) return []
    const list = JSON.parse(fs.readFileSync(fp, 'utf-8')) as PlaylistDefinition[]
    if (!Array.isArray(list)) return []
    // Return as-is — validation happens lazily when user selects a track.
    // We don't validate paths here because fs.existsSync on UNC/network paths
    // can block for 30+ seconds per directory when network is unavailable.
    return list
  } catch {
    return []
  }
}

const inMemoryPlaylists: PlaylistDefinition[] = []

export function savePlaylists(list: PlaylistDefinition[]) {
  inMemoryPlaylists.length = 0
  inMemoryPlaylists.push(...list)
  persistPlaylists(list)
}

export function getPlaylists(): PlaylistDefinition[] {
  // Nếu RAM trống (vd: vừa restart app) → load từ disk
  if (inMemoryPlaylists.length === 0) {
    const fromDisk = loadPersistedPlaylists()
    if (fromDisk.length > 0) {
      inMemoryPlaylists.push(...fromDisk)
    }
  }
  return [...inMemoryPlaylists]
}

export function getPlaylistById(id: string): PlaylistDefinition | undefined {
  getPlaylists() // ensure loaded
  return inMemoryPlaylists.find(p => p.id === id)
}

export function clearPlaylists(): void {
  inMemoryPlaylists.length = 0
  try {
    const fp = getPlaylistStorePath()
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
  } catch {
    // ignore
  }
}

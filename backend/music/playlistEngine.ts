import type { ScannedTrack } from './scanMusic'
import { randomUUID } from 'crypto'

export interface PlaylistTrack extends ScannedTrack {
  order: number // vị trí trong playlist (1-based)
  cumulativeDuration: number // tổng thời lượng tính đến hết bài này (giây)
}

export interface PlaylistDefinition {
  id: string // uuid
  name: string // tên playlist
  targetDurationSec: number // mục tiêu (giây)
  totalDurationSec: number // tổng thực tế (giây)
  priorityDurationSec: number
  randomDurationSec: number
  priorityCount: number
  randomCount: number
  tracks: PlaylistTrack[]
  createdAt: number // timestamp
}

export interface BuildPlaylistsOptions {
  tracks: ScannedTrack[]
  pinnedTrackIds: string[] // id các bài user chọn
  playlistCount: number // số playlist cần tạo (>=1)
  targetDurationMinutes: number // thời lượng target (phút), vd 30 → 30'
  priorityRatioMin?: number // default 0.65
  priorityRatioMax?: number // default 0.8
}

// Fisher-Yates shuffle
function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

// Rotate array
function rotate<T>(array: T[], offset: number): T[] {
  if (array.length === 0) return array
  const normalizedOffset = offset % array.length
  return [...array.slice(normalizedOffset), ...array.slice(0, normalizedOffset)]
}

function buildSinglePlaylist(
  index: number,
  pinnedTracks: ScannedTrack[],
  shuffledPriority: ScannedTrack[],
  shuffledRandom: ScannedTrack[],
  targetSec: number,
  desiredPriorityMin: number,
  desiredPriorityMax: number,
  allowReuse: boolean = false, // Cho phép reuse tracks khi thiếu
  hasPinnedTracks: boolean = true, // Có pinned tracks hay không
  shuffledAll: ScannedTrack[] = [] // Dùng cho trường hợp 2 (xáo trộn toàn bộ)
): PlaylistDefinition {
  const playlistTracks: PlaylistTrack[] = []
  const usedTrackIds = new Set<string>()
  let lastTrackId: string | null = null // Track ID cuối cùng để tránh trùng liên tiếp

  let currentTotalSec = 0
  let currentPrioritySec = 0
  let currentRandomSec = 0

  // Helper: Chọn track không trùng với lastTrackId
  const pickTrackAvoidingLast = (
    pool: ScannedTrack[],
    avoidId: string | null,
    maxAttempts: number = 10
  ): ScannedTrack | null => {
    if (pool.length === 0) return null
    
    // Lọc các track không trùng với avoidId
    const available = avoidId ? pool.filter(t => t.id !== avoidId) : pool
    
    if (available.length > 0) {
      // Random từ available
      const randomIndex = Math.floor(Math.random() * available.length)
      return available[randomIndex]
    }
    
    // Nếu không có available (trường hợp cực đoan: chỉ còn 1 bài), chấp nhận trùng
    if (pool.length > 0) {
      return pool[Math.floor(Math.random() * pool.length)]
    }
    
    return null
  }

  // TRƯỜNG HỢP 2: Không có pinned tracks → xáo trộn toàn bộ nhưng vẫn đảm bảo tỷ lệ
  if (!hasPinnedTracks && shuffledAll.length > 0) {
    let allIndex = 0
    let allCycles = 0
    const maxAllCycles = allowReuse ? 200 : 10

    while (currentTotalSec < targetSec && allCycles < maxAllCycles) {
      let addedInCycle = false

      for (let j = 0; j < shuffledAll.length; j++) {
        const track = shuffledAll[allIndex]

        // Kiểm tra tỷ lệ: nếu priority chưa đạt min, ưu tiên priority
        const priorityRatio = currentTotalSec > 0 ? currentPrioritySec / currentTotalSec : 0
        const shouldPreferPriority = priorityRatio < (desiredPriorityMin / targetSec) && track.folderType === 'priority'

        // Nếu không cho phép reuse và đã dùng, skip
        if (!allowReuse && usedTrackIds.has(track.id)) {
          allIndex = (allIndex + 1) % shuffledAll.length
          continue
        }

        // Tránh trùng liên tiếp
        if (track.id === lastTrackId) {
          allIndex = (allIndex + 1) % shuffledAll.length
          continue
        }

        // Nếu priority đã đạt max và track là priority, skip (ưu tiên random)
        const priorityRatioAfter = (currentPrioritySec + track.duration) / (currentTotalSec + track.duration)
        if (track.folderType === 'priority' && priorityRatioAfter > (desiredPriorityMax / targetSec)) {
          allIndex = (allIndex + 1) % shuffledAll.length
          continue
        }

        // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
        const cumulativeDuration = currentTotalSec + track.duration
        playlistTracks.push({
          ...track,
          order: playlistTracks.length + 1,
          cumulativeDuration,
        })

        currentTotalSec = cumulativeDuration
        lastTrackId = track.id
        if (!allowReuse) {
          usedTrackIds.add(track.id)
        }

        if (track.folderType === 'priority') {
          currentPrioritySec += track.duration
        } else if (track.folderType === 'random') {
          currentRandomSec += track.duration
        }
        addedInCycle = true

        // SAU KHI THÊM, mới check đạt target để dừng
        if (currentTotalSec >= targetSec) break

        allIndex = (allIndex + 1) % shuffledAll.length
      }

      if (!addedInCycle && !allowReuse) break
      if (!addedInCycle && allowReuse) {
        const picked = pickTrackAvoidingLast(shuffledAll, lastTrackId)
        if (picked) {
          // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
          const cumulativeDuration = currentTotalSec + picked.duration
          playlistTracks.push({
            ...picked,
            order: playlistTracks.length + 1,
            cumulativeDuration,
          })
          currentTotalSec = cumulativeDuration
          lastTrackId = picked.id
          if (picked.folderType === 'priority') {
            currentPrioritySec += picked.duration
          } else if (picked.folderType === 'random') {
            currentRandomSec += picked.duration
          }
          addedInCycle = true
          
          // SAU KHI THÊM, mới check đạt target để dừng
          if (currentTotalSec >= targetSec) break
        }
      }
      if (!addedInCycle) break
      allCycles++
    }

    // Đảm bảo playlist luôn >= targetSec (BẮT BUỘC) - cho TRƯỜNG HỢP 2
    if (currentTotalSec < targetSec && shuffledAll.length > 0) {
      let fillIndex = 0
      let fillCycles = 0
      const maxFillCycles = 500

      while (currentTotalSec < targetSec && fillCycles < maxFillCycles) {
        const track = shuffledAll[fillIndex % shuffledAll.length]

        // Tránh trùng liên tiếp nếu có thể
        if (track.id === lastTrackId && shuffledAll.length > 1) {
          fillIndex++
          fillCycles++
          continue
        }

        const cumulativeDuration = currentTotalSec + track.duration
        playlistTracks.push({
          ...track,
          order: playlistTracks.length + 1,
          cumulativeDuration,
        })

        currentTotalSec = cumulativeDuration
        lastTrackId = track.id

        if (track.folderType === 'priority') {
          currentPrioritySec += track.duration
        } else if (track.folderType === 'random') {
          currentRandomSec += track.duration
        }

        // SAU KHI THÊM, mới check đạt target để dừng
        if (currentTotalSec >= targetSec) break

        fillIndex++
        fillCycles++
      }
    }

    // Tính stats và return
    let finalPrioritySec = 0
    let finalRandomSec = 0
    let finalPriorityCount = 0
    let finalRandomCount = 0

    for (const track of playlistTracks) {
      if (track.folderType === 'priority') {
        finalPrioritySec += track.duration
        finalPriorityCount++
      } else if (track.folderType === 'random') {
        finalRandomSec += track.duration
        finalRandomCount++
      }
    }

    let cumulative = 0
    for (const track of playlistTracks) {
      cumulative += track.duration
      track.cumulativeDuration = cumulative
    }

    return {
      id: randomUUID(),
      name: `Playlist ${index + 1}`,
      targetDurationSec: targetSec,
      totalDurationSec: cumulative,
      priorityDurationSec: finalPrioritySec,
      randomDurationSec: finalRandomSec,
      priorityCount: finalPriorityCount,
      randomCount: finalRandomCount,
      tracks: playlistTracks,
      createdAt: Date.now(),
    }
  }

  // TRƯỜNG HỢP 1: Có pinned tracks
  // Bước 1: Pinned lên đầu
  const rotatedPinned = rotate(pinnedTracks, index * 7) // Offset khác nhau cho mỗi playlist
  for (const track of rotatedPinned) {
    if (!allowReuse && usedTrackIds.has(track.id)) continue
    
    // Tránh trùng liên tiếp
    if (track.id === lastTrackId) continue

    // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
    const cumulativeDuration = currentTotalSec + track.duration
    playlistTracks.push({
      ...track,
      order: playlistTracks.length + 1,
      cumulativeDuration,
    })

    currentTotalSec = cumulativeDuration
    lastTrackId = track.id
    if (!allowReuse) {
      usedTrackIds.add(track.id)
    }

    if (track.folderType === 'priority') {
      currentPrioritySec += track.duration
    } else if (track.folderType === 'random') {
      currentRandomSec += track.duration
    }

    // SAU KHI THÊM, mới check đạt target để dừng
    if (currentTotalSec >= targetSec) break
  }

  // Bước 2: Bổ sung PRIORITY (không pinned) đến khi đạt ngưỡng MIN
  const priorityStart = shuffledPriority.length > 0 ? (index * 13) % shuffledPriority.length : 0 // Offset khác nhau
  let priorityIndex = priorityStart
  let priorityCycles = 0
  const maxPriorityCycles = allowReuse ? 100 : 3 // Nếu cho phép reuse, tăng cycles

  while (
    currentTotalSec < targetSec &&
    currentPrioritySec < desiredPriorityMin &&
    priorityCycles < maxPriorityCycles &&
    shuffledPriority.length > 0
  ) {
    let addedInCycle = false

    for (let j = 0; j < shuffledPriority.length; j++) {
      const track = shuffledPriority[priorityIndex]

      // Nếu không cho phép reuse và đã dùng, skip
      if (!allowReuse && usedTrackIds.has(track.id)) {
        priorityIndex = (priorityIndex + 1) % shuffledPriority.length
        continue
      }

      // Tránh trùng liên tiếp
      if (track.id === lastTrackId) {
        priorityIndex = (priorityIndex + 1) % shuffledPriority.length
        continue
      }

      if (currentPrioritySec >= desiredPriorityMin) break

      // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
      const cumulativeDuration = currentTotalSec + track.duration
      playlistTracks.push({
        ...track,
        order: playlistTracks.length + 1,
        cumulativeDuration,
      })

      currentTotalSec = cumulativeDuration
      currentPrioritySec += track.duration
      lastTrackId = track.id
      if (!allowReuse) {
        usedTrackIds.add(track.id)
      }
      addedInCycle = true

      // SAU KHI THÊM, mới check đạt target để dừng
      if (currentTotalSec >= targetSec) break

      priorityIndex = (priorityIndex + 1) % shuffledPriority.length
    }

    if (!addedInCycle && !allowReuse) break
    if (!addedInCycle && allowReuse) {
      // Nếu allowReuse và không thêm được, thử lại với logic khác
      const picked = pickTrackAvoidingLast(shuffledPriority, lastTrackId)
      if (picked && currentPrioritySec < desiredPriorityMin) {
        // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
        const cumulativeDuration = currentTotalSec + picked.duration
        playlistTracks.push({
          ...picked,
          order: playlistTracks.length + 1,
          cumulativeDuration,
        })
        currentTotalSec = cumulativeDuration
        currentPrioritySec += picked.duration
        lastTrackId = picked.id
        addedInCycle = true
        
        // SAU KHI THÊM, mới check đạt target để dừng
        if (currentTotalSec >= targetSec) break
      }
    }
    if (!addedInCycle) break
    priorityCycles++
  }

  // Bước 3: Bổ sung RANDOM cho đủ target
  if (shuffledRandom.length > 0) {
    const randomStart = (index * 17) % shuffledRandom.length // Offset khác nhau
    let randomIndex = randomStart
    let randomCycles = 0
    const maxRandomCycles = allowReuse ? 100 : 3

    while (currentTotalSec < targetSec && randomCycles < maxRandomCycles) {
      let addedInCycle = false

      for (let j = 0; j < shuffledRandom.length; j++) {
        const track = shuffledRandom[randomIndex]

        // Nếu không cho phép reuse và đã dùng, skip
        if (!allowReuse && usedTrackIds.has(track.id)) {
          randomIndex = (randomIndex + 1) % shuffledRandom.length
          continue
        }

        // Tránh trùng liên tiếp
        if (track.id === lastTrackId) {
          randomIndex = (randomIndex + 1) % shuffledRandom.length
          continue
        }

        // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
        const cumulativeDuration = currentTotalSec + track.duration
        playlistTracks.push({
          ...track,
          order: playlistTracks.length + 1,
          cumulativeDuration,
        })

        currentTotalSec = cumulativeDuration
        currentRandomSec += track.duration
        lastTrackId = track.id
        if (!allowReuse) {
          usedTrackIds.add(track.id)
        }
        addedInCycle = true

        // SAU KHI THÊM, mới check đạt target để dừng
        if (currentTotalSec >= targetSec) break

        randomIndex = (randomIndex + 1) % shuffledRandom.length
      }

      if (!addedInCycle && !allowReuse) break
      if (!addedInCycle && allowReuse) {
        // Nếu allowReuse và không thêm được, thử lại với logic khác
        const picked = pickTrackAvoidingLast(shuffledRandom, lastTrackId)
        if (picked) {
          // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
          const cumulativeDuration = currentTotalSec + picked.duration
          playlistTracks.push({
            ...picked,
            order: playlistTracks.length + 1,
            cumulativeDuration,
          })
          currentTotalSec = cumulativeDuration
          currentRandomSec += picked.duration
          lastTrackId = picked.id
          addedInCycle = true
          
          // SAU KHI THÊM, mới check đạt target để dừng
          if (currentTotalSec >= targetSec) break
        }
      }
      if (!addedInCycle) break
      randomCycles++
    }
  }

  // Bước 4: Nếu vẫn thiếu, thêm PRIORITY/RANDOM xen kẽ (với reuse nếu cần)
  // CHỈ CHẠY TRONG TRƯỜNG HỢP 1 (có pinned tracks)
  if (hasPinnedTracks) {
    const marginSec = 5 // Margin để tránh loop vô hạn
    const combinedPool = [...shuffledPriority, ...shuffledRandom]
    let combinedIndex = 0
    let combinedCycles = 0
    const maxCombinedCycles = allowReuse ? 200 : 10

    while (
      currentTotalSec < targetSec - marginSec &&
      combinedCycles < maxCombinedCycles &&
      combinedPool.length > 0
    ) {
      let addedInCycle = false

      // Ưu tiên priority nếu chưa đạt min
      const preferPriority = currentPrioritySec < desiredPriorityMin && shuffledPriority.length > 0
      const candidatePool = preferPriority ? shuffledPriority : combinedPool

      // Thử chọn track từ pool
      const picked = pickTrackAvoidingLast(candidatePool, lastTrackId, 10)
    
    if (picked) {
      // Nếu không cho phép reuse và đã dùng, skip
      if (!allowReuse && usedTrackIds.has(picked.id)) {
        combinedIndex = (combinedIndex + 1) % combinedPool.length
        combinedCycles++
        continue
      }

      // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
      const cumulativeDuration = currentTotalSec + picked.duration
      playlistTracks.push({
        ...picked,
        order: playlistTracks.length + 1,
        cumulativeDuration,
      })

      currentTotalSec = cumulativeDuration
      lastTrackId = picked.id
      if (!allowReuse) {
        usedTrackIds.add(picked.id)
      }

      if (picked.folderType === 'priority') {
        currentPrioritySec += picked.duration
      } else if (picked.folderType === 'random') {
        currentRandomSec += picked.duration
      }
      addedInCycle = true

      // SAU KHI THÊM, mới check đạt target để dừng
      if (currentTotalSec >= targetSec) break
    }

      if (!addedInCycle) break
      combinedCycles++
      combinedIndex = (combinedIndex + 1) % combinedPool.length
    }
  }

  // Bước 5: Đảm bảo playlist luôn >= targetSec (BẮT BUỘC)
  // Nếu vẫn chưa đạt target sau tất cả các bước trên, tiếp tục thêm tracks
  // Bỏ qua allowReuse ở đây vì đây là yêu cầu bắt buộc
  if (currentTotalSec < targetSec) {
    const allAvailableTracks = [...shuffledPriority, ...shuffledRandom]
    if (allAvailableTracks.length > 0) {
      let fillIndex = 0
      let fillCycles = 0
      const maxFillCycles = 500 // Giới hạn để tránh loop vô hạn

      while (currentTotalSec < targetSec && fillCycles < maxFillCycles) {
        const track = allAvailableTracks[fillIndex % allAvailableTracks.length]

        // Tránh trùng liên tiếp nếu có thể
        if (track.id === lastTrackId && allAvailableTracks.length > 1) {
          fillIndex++
          fillCycles++
          continue
        }

        const cumulativeDuration = currentTotalSec + track.duration
        playlistTracks.push({
          ...track,
          order: playlistTracks.length + 1,
          cumulativeDuration,
        })

        currentTotalSec = cumulativeDuration
        lastTrackId = track.id

        if (track.folderType === 'priority') {
          currentPrioritySec += track.duration
        } else if (track.folderType === 'random') {
          currentRandomSec += track.duration
        }

        // SAU KHI THÊM, mới check đạt target để dừng
        if (currentTotalSec >= targetSec) break

        fillIndex++
        fillCycles++
      }
    }
  }

  // Bước 6: Tính stats chính xác từ playlistTracks
  let finalPrioritySec = 0
  let finalRandomSec = 0
  let finalPriorityCount = 0
  let finalRandomCount = 0

  for (const track of playlistTracks) {
    if (track.folderType === 'priority') {
      finalPrioritySec += track.duration
      finalPriorityCount++
    } else if (track.folderType === 'random') {
      finalRandomSec += track.duration
      finalRandomCount++
    }
  }

  // Tính lại cumulativeDuration cho tất cả tracks
  let cumulative = 0
  for (const track of playlistTracks) {
    cumulative += track.duration
    track.cumulativeDuration = cumulative
  }

  const totalDurationSec = cumulative

  // VALIDATION CUỐI CÙNG: Đảm bảo playlist luôn >= targetSec
  // Nếu vẫn chưa đạt (edge case hiếm), log warning nhưng vẫn return
  if (totalDurationSec < targetSec) {
    console.warn(
      `[PlaylistEngine] WARNING: Playlist ${index + 1} chỉ có ${totalDurationSec.toFixed(1)}s, nhỏ hơn target ${targetSec}s. Có thể do không đủ tracks trong thư viện.`
    )
  }

  return {
    id: randomUUID(),
    name: `Playlist ${index + 1}`,
    targetDurationSec: targetSec,
    totalDurationSec,
    priorityDurationSec: finalPrioritySec,
    randomDurationSec: finalRandomSec,
    priorityCount: finalPriorityCount,
    randomCount: finalRandomCount,
    tracks: playlistTracks,
    createdAt: Date.now(),
  }
}

export function buildPlaylists(options: BuildPlaylistsOptions): PlaylistDefinition[] {
  const {
    tracks,
    pinnedTrackIds,
    playlistCount,
    targetDurationMinutes,
    priorityRatioMin = 0.65,
    priorityRatioMax = 0.8,
  } = options

  if (playlistCount < 1) {
    throw new Error('playlistCount must be >= 1')
  }

  if (targetDurationMinutes <= 0) {
    throw new Error('targetDurationMinutes must be > 0')
  }

  const targetSec = targetDurationMinutes * 60
  const desiredPriorityMin = targetSec * priorityRatioMin
  const desiredPriorityMax = targetSec * priorityRatioMax

  // Chuẩn bị chung
  const priorityTracks = tracks.filter((t) => t.folderType === 'priority')
  const randomTracks = tracks.filter((t) => t.folderType === 'random')
  const pinnedTracks = tracks.filter((t) => pinnedTrackIds.includes(t.id))

  // PHÂN BIỆT 2 TRƯỜNG HỢP:
  const hasPinnedTracks = pinnedTracks.length > 0

  // Tính tổng duration thư viện
  const totalLibraryDuration = tracks.reduce((sum, t) => sum + t.duration, 0)
  const totalRequiredDuration = playlistCount * targetSec

  // Xác định có cần reuse không
  const allowReuse = totalRequiredDuration > totalLibraryDuration

  if (allowReuse) {
    console.log(
      `[PlaylistEngine] Total required duration (${totalRequiredDuration.toFixed(1)}s) > library duration (${totalLibraryDuration.toFixed(1)}s). Enabling track reuse.`
    )
  }

  // TRƯỜNG HỢP 1: Có pinned tracks
  // - Pinned → Priority (không pinned) → Random
  // TRƯỜNG HỢP 2: Không có pinned tracks
  // - Xáo trộn toàn bộ (cả priority và random) nhưng vẫn đảm bảo tỷ lệ

  let shuffledPriority: ScannedTrack[] = []
  let shuffledPriorityNonPinned: ScannedTrack[] = []
  let shuffledRandom: ScannedTrack[] = []
  let shuffledAll: ScannedTrack[] = [] // Dùng cho trường hợp 2

  if (hasPinnedTracks) {
    // TRƯỜNG HỢP 1: Tách priority thành pinned và non-pinned
    const priorityPinnedIds = new Set(pinnedTracks.filter(t => t.folderType === 'priority').map(t => t.id))
    shuffledPriorityNonPinned = shuffle(priorityTracks.filter(t => !priorityPinnedIds.has(t.id)))
    shuffledRandom = shuffle(randomTracks)
    console.log(`[PlaylistEngine] Trường hợp 1: Có ${pinnedTracks.length} bài đã chọn. Priority (không pinned): ${shuffledPriorityNonPinned.length}, Random: ${shuffledRandom.length}`)
  } else {
    // TRƯỜNG HỢP 2: Xáo trộn toàn bộ
    shuffledAll = shuffle([...priorityTracks, ...randomTracks])
    console.log(`[PlaylistEngine] Trường hợp 2: Không có bài đã chọn. Xáo trộn toàn bộ ${shuffledAll.length} bài.`)
  }

  // Build từng playlist
  const playlists: PlaylistDefinition[] = []
  const playlistSignatures = new Set<string>() // Để đảm bảo mỗi playlist khác nhau

  for (let i = 0; i < playlistCount; i++) {
    let playlist: PlaylistDefinition
    let attempts = 0
    const MAX_ATTEMPTS = 50 // Tối đa 50 lần thử để tạo playlist khác nhau

    // Đảm bảo mỗi playlist khác nhau
    do {
      if (hasPinnedTracks) {
        // TRƯỜNG HỢP 1: Shuffle lại mỗi lần để đảm bảo khác nhau
        const shuffledPriorityNonPinnedThisTime = shuffle(priorityTracks.filter(t => !pinnedTrackIds.includes(t.id)))
        const shuffledRandomThisTime = shuffle(randomTracks)
        const shuffledPinnedThisTime = shuffle(pinnedTracks) // Shuffle pinned để mỗi playlist khác nhau

        playlist = buildSinglePlaylist(
          i,
          shuffledPinnedThisTime,
          shuffledPriorityNonPinnedThisTime,
          shuffledRandomThisTime,
          targetSec,
          desiredPriorityMin,
          desiredPriorityMax,
          allowReuse,
          hasPinnedTracks
        )
      } else {
        // TRƯỜNG HỢP 2: Shuffle lại toàn bộ mỗi lần
        const shuffledAllThisTime = shuffle([...priorityTracks, ...randomTracks])
        playlist = buildSinglePlaylist(
          i,
          [],
          [],
          [],
          targetSec,
          desiredPriorityMin,
          desiredPriorityMax,
          allowReuse,
          hasPinnedTracks,
          shuffledAllThisTime
        )
      }

      // Tạo signature từ thứ tự tracks
      const signature = playlist.tracks.map(t => t.id).join('|')
      
      if (!playlistSignatures.has(signature)) {
        playlistSignatures.add(signature)
        break // Tìm được playlist khác nhau
      }

      attempts++
      if (attempts >= MAX_ATTEMPTS) {
        console.warn(`[PlaylistEngine] Không thể tạo playlist ${i + 1} khác nhau sau ${MAX_ATTEMPTS} lần thử. Sử dụng playlist hiện tại.`)
        break // Chấp nhận playlist trùng nếu không thể tạo khác
      }
    } while (true)

    playlists.push(playlist)

    // Logging
    const priorityPercent = playlist.totalDurationSec > 0
      ? ((playlist.priorityDurationSec / playlist.totalDurationSec) * 100).toFixed(1)
      : '0.0'
    const randomPercent = playlist.totalDurationSec > 0
      ? ((playlist.randomDurationSec / playlist.totalDurationSec) * 100).toFixed(1)
      : '0.0'
    const targetPercent = playlist.totalDurationSec > 0
      ? ((playlist.totalDurationSec / targetSec) * 100).toFixed(1)
      : '0.0'

    console.log(
      `[PlaylistEngine] P${i + 1}: total=${playlist.totalDurationSec.toFixed(1)}s (${targetPercent}% of target), priority=${playlist.priorityDurationSec.toFixed(1)}s (${priorityPercent}%), random=${playlist.randomDurationSec.toFixed(1)}s (${randomPercent}%), tracks=${playlist.tracks.length}`
    )
  }

  return playlists
}

// In-memory storage
const inMemoryPlaylists: PlaylistDefinition[] = []

export function savePlaylists(list: PlaylistDefinition[]) {
  // Ghi vào inMemoryPlaylists, có thể overwrite toàn bộ batch mới
  inMemoryPlaylists.length = 0
  inMemoryPlaylists.push(...list)
}

export function getPlaylists(): PlaylistDefinition[] {
  return [...inMemoryPlaylists]
}

export function getPlaylistById(id: string): PlaylistDefinition | undefined {
  return inMemoryPlaylists.find((p) => p.id === id)
}

export function clearPlaylists(): void {
  // Clear in-memory playlists (khi quét nhạc mới)
  inMemoryPlaylists.length = 0
}



















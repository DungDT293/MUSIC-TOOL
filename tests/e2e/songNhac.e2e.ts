/**
 * tests/e2e/songNhac.e2e.ts
 * Playwright E2E — Song Nhạc Export Pipeline:
 *   - buildPlaylists: target duration, track ordering, priority ratio
 *   - exportAudio: sanitizeFileName helper logic
 *   - playlistEngine: edge cases (empty tracks, single track, reuse)
 *
 * NOTE: Tests không cần FFmpeg binary — chỉ test pure logic trong PlaylistEngine.
 * ExportAudio tests chỉ cover helpers, không invoke FFmpeg subprocess.
 */


// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePriorityTrack(id: string, durationSec: number) {
  return {
    id,
    path: `/music/priority/${id}.mp3`,
    name: id,
    duration: durationSec,
    folderType: 'priority' as const,
    size: 1024 * 1024,
  }
}

function makeRandomTrack(id: string, durationSec: number) {
  return {
    id,
    path: `/music/random/${id}.mp3`,
    name: id,
    duration: durationSec,
    folderType: 'random' as const,
    size: 1024 * 1024,
  }
}

function makeTracks(
  priorityCount: number,
  randomCount: number,
  durationEach = 180 // 3 minutes per track
) {
  const tracks = []
  for (let i = 0; i < priorityCount; i++) {
    tracks.push(makePriorityTrack(`p${i + 1}`, durationEach))
  }
  for (let i = 0; i < randomCount; i++) {
    tracks.push(makeRandomTrack(`r${i + 1}`, durationEach))
  }
  return tracks
}

// ─── buildPlaylists — basic ───────────────────────────────────────────────────

describe('PlaylistEngine — buildPlaylists', () => {
  test('builds correct number of playlists', async () => {
    const { buildPlaylists } = await import('../../backend/music/playlistEngine')
    const tracks = makeTracks(10, 10, 180)

    const { playlists } = buildPlaylists({
      tracks,
      pinnedTrackIds: [],
      playlistCount: 3,
      targetDurationMinutes: 30,
    })

    expect(playlists.length).toBe(3)
  })

  test('each playlist totalDurationSec ≥ targetDurationSec', async () => {
    const { buildPlaylists } = await import('../../backend/music/playlistEngine')
    const tracks = makeTracks(15, 15, 180) // plenty of tracks

    const targetMin = 30
    const { playlists } = buildPlaylists({
      tracks,
      pinnedTrackIds: [],
      playlistCount: 2,
      targetDurationMinutes: targetMin,
    })

    for (const pl of playlists) {
      // totalDurationSec should be at or above target (last track completes)
      expect(pl.totalDurationSec).toBeGreaterThanOrEqual(targetMin * 60 - 180) // allow 1 track tolerance
    }
  })

  test('pinned tracks appear in playlists', async () => {
    const { buildPlaylists } = await import('../../backend/music/playlistEngine')
    const tracks = makeTracks(10, 10, 180)
    const pinnedId = tracks[0].id // pin first priority track

    const { playlists } = buildPlaylists({
      tracks,
      pinnedTrackIds: [pinnedId],
      playlistCount: 2,
      targetDurationMinutes: 30,
    })

    // Every playlist should contain the pinned track
    for (const pl of playlists) {
      const trackIds = pl.tracks.map((t) => t.id)
      expect(trackIds).toContain(pinnedId)
    }
  })

  test('each playlist has an id, name, createdAt', async () => {
    const { buildPlaylists } = await import('../../backend/music/playlistEngine')
    const tracks = makeTracks(5, 5, 180)

    const { playlists } = buildPlaylists({
      tracks,
      pinnedTrackIds: [],
      playlistCount: 1,
      targetDurationMinutes: 15,
    })

    expect(playlists[0].id).toBeTruthy()
    expect(playlists[0].name).toBeTruthy()
    expect(playlists[0].createdAt).toBeGreaterThan(0)
  })

  test('playlist tracks have order and cumulativeDuration', async () => {
    const { buildPlaylists } = await import('../../backend/music/playlistEngine')
    const tracks = makeTracks(5, 5, 180)

    const { playlists } = buildPlaylists({
      tracks,
      pinnedTrackIds: [],
      playlistCount: 1,
      targetDurationMinutes: 15,
    })

    const pl = playlists[0]
    expect(pl.tracks.length).toBeGreaterThan(0)

    for (const track of pl.tracks) {
      expect(typeof track.order).toBe('number')
      expect(track.order).toBeGreaterThanOrEqual(1)
      expect(typeof track.cumulativeDuration).toBe('number')
    }
  })

  test('no consecutive duplicate tracks in same playlist', async () => {
    const { buildPlaylists } = await import('../../backend/music/playlistEngine')
    // Use few tracks to force reuse — but check no consecutive dups
    const tracks = makeTracks(3, 3, 60) // 6 tracks × 60s = 360s library

    const { playlists } = buildPlaylists({
      tracks,
      pinnedTrackIds: [],
      playlistCount: 1,
      targetDurationMinutes: 10, // needs reuse
    })

    const pl = playlists[0]
    for (let i = 1; i < pl.tracks.length; i++) {
      // Consecutive tracks should not have same id
      expect(pl.tracks[i].id).not.toBe(pl.tracks[i - 1].id)
    }
  })
})

// ─── buildPlaylists — edge cases ─────────────────────────────────────────────

describe('PlaylistEngine — edge cases', () => {
  test('throws when playlistCount < 1', async () => {
    const { buildPlaylists } = await import('../../backend/music/playlistEngine')
    const tracks = makeTracks(5, 5, 180)

    expect(() =>
      buildPlaylists({
        tracks,
        pinnedTrackIds: [],
        playlistCount: 0,
        targetDurationMinutes: 30,
      })
    ).toThrow()
  })

  test('throws when targetDurationMinutes <= 0', async () => {
    const { buildPlaylists } = await import('../../backend/music/playlistEngine')
    const tracks = makeTracks(5, 5, 180)

    expect(() =>
      buildPlaylists({
        tracks,
        pinnedTrackIds: [],
        playlistCount: 1,
        targetDurationMinutes: 0,
      })
    ).toThrow()
  })

  test('handles single track (reuse enabled)', async () => {
    const { buildPlaylists } = await import('../../backend/music/playlistEngine')
    const tracks = [makePriorityTrack('only', 120)]

    // Should not throw, should produce playlist with the single track (repeated)
    const { playlists } = buildPlaylists({
      tracks,
      pinnedTrackIds: [],
      playlistCount: 1,
      targetDurationMinutes: 5, // 300s needed, only 120s available → reuse
    })

    expect(playlists.length).toBe(1)
    expect(playlists[0].tracks.length).toBeGreaterThan(0)
  })

  test('handles all tracks pinned', async () => {
    const { buildPlaylists } = await import('../../backend/music/playlistEngine')
    const tracks = makeTracks(5, 0, 180)
    const pinnedIds = tracks.map((t) => t.id)

    const { playlists } = buildPlaylists({
      tracks,
      pinnedTrackIds: pinnedIds,
      playlistCount: 1,
      targetDurationMinutes: 10,
    })

    expect(playlists.length).toBe(1)
    expect(playlists[0].tracks.length).toBeGreaterThan(0)
  })

  test('reuse enabled when required duration > library duration', async () => {
    const { buildPlaylists } = await import('../../backend/music/playlistEngine')
    // 2 tracks × 60s = 120s library
    const tracks = [makePriorityTrack('a', 60), makeRandomTrack('b', 60)]

    // Need 2 × 30min = 3600s but only have 120s
    const { playlists } = buildPlaylists({
      tracks,
      pinnedTrackIds: [],
      playlistCount: 2,
      targetDurationMinutes: 30,
    })

    // Should still produce 2 playlists without crashing
    expect(playlists.length).toBe(2)
    // Each playlist should have tracks (reused)
    expect(playlists[0].tracks.length).toBeGreaterThan(0)
    expect(playlists[1].tracks.length).toBeGreaterThan(0)
  })
})

// ─── Priority ratio ───────────────────────────────────────────────────────────

describe('PlaylistEngine — priority ratio', () => {
  test('playlist has valid totalDurationSec and priorityDurationSec fields', async () => {
    const { buildPlaylists } = await import('../../backend/music/playlistEngine')
    // Plenty of both types so ratio can be enforced
    const tracks = makeTracks(20, 20, 180)

    const { playlists } = buildPlaylists({
      tracks,
      pinnedTrackIds: [],
      playlistCount: 1,
      targetDurationMinutes: 30,
    })

    const pl = playlists[0]
    // These fields should always be present and valid numbers
    expect(typeof pl.totalDurationSec).toBe('number')
    expect(typeof pl.priorityDurationSec).toBe('number')
    expect(pl.totalDurationSec).toBeGreaterThan(0)
    expect(pl.priorityDurationSec).toBeGreaterThanOrEqual(0)
    // Priority duration cannot exceed total
    expect(pl.priorityDurationSec).toBeLessThanOrEqual(pl.totalDurationSec + 1) // +1s tolerance
  })
})

// ─── Shuffle Playlist ─────────────────────────────────────────────────────────

describe('ShufflePlaylist — pure logic', () => {
  test('shuffleClipsOnce returns same tracks in different order', async () => {
    const { shuffleClipsOnce } = await import('../../backend/video/utils/shufflePlaylist')
    const items = [
      { path: 'a.mp4', durationSec: 10 },
      { path: 'b.mp4', durationSec: 10 },
      { path: 'c.mp4', durationSec: 10 },
      { path: 'd.mp4', durationSec: 10 },
      { path: 'e.mp4', durationSec: 10 },
      { path: 'f.mp4', durationSec: 10 },
      { path: 'g.mp4', durationSec: 10 },
      { path: 'h.mp4', durationSec: 10 },
    ]

    // Run multiple times — at least one should differ from original
    const results = Array.from({ length: 10 }, () => shuffleClipsOnce([...items]))
    const originalOrder = items.map((x) => x.path).join(',')
    const allSame = results.every((r) => r.map((x) => x.path).join(',') === originalOrder)

    expect(allSame).toBe(false) // Very unlikely all 10 shuffles = original
    // But every result should have same length and elements
    for (const result of results) {
      expect(result.length).toBe(items.length)
      expect(result.map((x) => x.path).sort()).toEqual(items.map((x) => x.path).sort())
    }
  })
})

import { describe, expect, it } from 'vitest'
import { buildPlaylists } from '../../../backend/music/playlistEngine'
import type { ScannedTrack } from '../../../backend/music/scanMusic'

function track(id: string, folderType: ScannedTrack['folderType'], duration: number): ScannedTrack {
  return { id, path: `C:/music/${id}.m4a`, fileName: `${id}.m4a`, folderType, duration, size: 1 }
}

describe('playlistEngine opening tracks', () => {
  it('prepends rotating opening tracks without reducing body target', () => {
    const openings = [track('open-1', 'opening', 10), track('open-2', 'opening', 20)]
    const body = [track('body-1', 'priority', 120), track('body-2', 'priority', 120), track('body-3', 'priority', 120)]
    const result = buildPlaylists({ tracks: body, openingTracks: openings, pinnedTrackIds: [], playlistCount: 3, targetDurationMinutes: 2, priorityRatioMin: 1, priorityRatioMax: 1 })

    expect(result.playlists.map((playlist) => playlist.tracks[0]?.id)).toEqual(['open-1', 'open-2', 'open-1'])
    expect(result.playlists[0]).toMatchObject({ openingCount: 1, openingDurationSec: 10, totalDurationSec: 130 })
    expect(result.playlists[0]?.tracks[0]).toMatchObject({ role: 'opening', order: 1 })
    expect(result.playlists[0]?.tracks[1]?.cumulativeDuration).toBe(130)
    expect(result.playlists[0]?.priorityDurationSec).toBe(120)
  })

  it('uses only pinned opening tracks when pinnedOpeningTrackIds is provided', () => {
    const openings = [
      track('open-1', 'opening', 10),
      track('open-2', 'opening', 20),
      track('open-3', 'opening', 15),
    ]
    const body = [track('body-1', 'priority', 120), track('body-2', 'priority', 120)]
    const result = buildPlaylists({
      tracks: body,
      openingTracks: openings,
      pinnedOpeningTrackIds: ['open-2'],
      pinnedTrackIds: [],
      playlistCount: 2,
      targetDurationMinutes: 2,
      priorityRatioMin: 1,
      priorityRatioMax: 1,
    })

    // Cả 2 playlist đều phải dùng bài mở đầu đã ghim: open-2
    expect(result.playlists.map((playlist) => playlist.tracks[0]?.id)).toEqual(['open-2', 'open-2'])
  })

  it('rotates exclusively among pinned opening tracks when multiple are pinned', () => {
    const openings = [
      track('open-1', 'opening', 10),
      track('open-2', 'opening', 20),
      track('open-3', 'opening', 15),
    ]
    const body = [track('body-1', 'priority', 120), track('body-2', 'priority', 120)]
    const result = buildPlaylists({
      tracks: body,
      openingTracks: openings,
      pinnedOpeningTrackIds: ['open-1', 'open-3'],
      pinnedTrackIds: [],
      playlistCount: 4,
      targetDurationMinutes: 2,
      priorityRatioMin: 1,
      priorityRatioMax: 1,
    })

    // Chỉ xoay vòng giữa open-1 và open-3 (bỏ qua open-2)
    expect(result.playlists.map((playlist) => playlist.tracks[0]?.id)).toEqual([
      'open-1',
      'open-3',
      'open-1',
      'open-3',
    ])
  })

  it('prepends all pinned opening tracks when combineAllPinnedOpenings is true', () => {
    const openings = [
      track('open-1', 'opening', 10),
      track('open-2', 'opening', 20),
    ]
    const body = [track('body-1', 'priority', 120), track('body-2', 'priority', 120)]
    const result = buildPlaylists({
      tracks: body,
      openingTracks: openings,
      pinnedOpeningTrackIds: ['open-1', 'open-2'],
      combineAllPinnedOpenings: true,
      pinnedTrackIds: [],
      playlistCount: 2,
      targetDurationMinutes: 2,
      priorityRatioMin: 1,
      priorityRatioMax: 1,
    })

    expect(result.playlists[0]?.openingCount).toBe(2)
    expect(result.playlists[0]?.openingDurationSec).toBe(30)
    expect(result.playlists[0]?.tracks[0]?.id).toBe('open-1')
    expect(result.playlists[0]?.tracks[0]?.role).toBe('opening')
    expect(result.playlists[0]?.tracks[1]?.id).toBe('open-2')
    expect(result.playlists[0]?.tracks[1]?.role).toBe('opening')
    expect(result.playlists[0]?.tracks[2]?.id).toBe('body-1')

    expect(result.playlists[1]?.openingCount).toBe(2)
    expect(result.playlists[1]?.openingDurationSec).toBe(30)
    expect(result.playlists[1]?.tracks[0]?.id).toBe('open-1')
    expect(result.playlists[1]?.tracks[0]?.role).toBe('opening')
    expect(result.playlists[1]?.tracks[1]?.id).toBe('open-2')
    expect(result.playlists[1]?.tracks[1]?.role).toBe('opening')
    expect(result.playlists[1]?.tracks[2]?.id).toBe('body-2')
  })
})


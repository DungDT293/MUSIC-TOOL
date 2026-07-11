import { describe, expect, it } from 'vitest'
import { buildPlaylists } from '../../../backend/music/playlistEngine'
import type { ScannedTrack } from '../../../backend/music/scanMusic'

function track(id: string, folderType: ScannedTrack['folderType'], duration: number): ScannedTrack {
  return {
    id,
    path: `C:/music/${id}.m4a`,
    fileName: `${id}.m4a`,
    folderType,
    duration,
    size: 1024,
    codec: 'aac',
  }
}

describe('playlistEngine ending tracks', () => {
  it('appends ending tracks after the main target and excludes them from main stats', () => {
    const priority = track('priority', 'priority', 60)
    const random = track('random', 'random', 70)
    const ending = track('ending', 'random', 10)

    const result = buildPlaylists({
      tracks: [priority, random, ending],
      pinnedTrackIds: [],
      endingTracks: [ending],
      playlistCount: 1,
      targetDurationMinutes: 2,
    })

    const playlist = result.playlists[0]
    expect(playlist).toBeTruthy()
    expect(playlist.tracks.at(-1)).toMatchObject({ id: 'ending', role: 'ending' })
    expect(playlist.endingCount).toBe(1)
    expect(playlist.endingDurationSec).toBe(10)
    expect(playlist.priorityCount).toBe(1)
    expect(playlist.randomCount).toBe(1)
    expect(playlist.priorityDurationSec).toBe(60)
    expect(playlist.randomDurationSec).toBe(70)
    expect(playlist.totalDurationSec).toBe(140)
    expect(playlist.totalDurationSec - (playlist.endingDurationSec ?? 0)).toBeGreaterThanOrEqual(120)
  })
})

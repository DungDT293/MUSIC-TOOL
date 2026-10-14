import { describe, expect, it } from 'vitest'
import { buildPlaylists } from '../../../backend/music/playlistEngine'
import type { ScannedTrack } from '../../../backend/music/scanMusic'

function track(id: string, folderType: ScannedTrack['folderType'], duration = 60): ScannedTrack {
  return {
    id,
    path: `C:/music/${id}.m4a`,
    fileName: `${id}.m4a`,
    folderType,
    duration,
    size: 1,
  }
}

describe('playlistEngine group rotation', () => {
  it('keeps Opening, Pinned, Priority, Random, Ending order and rotates groups', () => {
    const opening = [track('o1', 'opening'), track('o2', 'opening')]
    const pinned = [track('pin-a', 'priority'), track('pin-b', 'priority')]
    const priority = [track('p1', 'priority'), track('p2', 'priority'), track('p3', 'priority')]
    const random = [track('r1', 'random'), track('r2', 'random'), track('r3', 'random')]
    const ending = track('end', 'random', 10)

    const result = buildPlaylists({
      tracks: [...opening, ...pinned, ...priority, ...random, ending],
      openingTracks: opening,
      pinnedTrackIds: pinned.map((item) => item.id),
      endingTracks: [ending],
      playlistCount: 2,
      targetDurationMinutes: 5,
      priorityRatioMin: 0.75,
      priorityRatioMax: 1,
    })

    expect(result.playlists).toHaveLength(2)
    expect(result.playlists.map((playlist) => playlist.tracks[0]?.id)).toEqual(['o1', 'o2'])
    expect(result.playlists.map((playlist) => playlist.tracks.at(-1)?.id)).toEqual(['end', 'end'])

    const first = result.playlists[0].tracks.map((item) => item.id)
    const second = result.playlists[1].tracks.map((item) => item.id)
    expect(first).not.toEqual(second)
    const firstTypes = result.playlists[0].tracks.map((item) => item.role === 'ending' ? 'ending' : item.folderType)
    const secondTypes = result.playlists[1].tracks.map((item) => item.role === 'ending' ? 'ending' : item.folderType)
    expect(firstTypes.indexOf('priority')).toBeLessThan(firstTypes.indexOf('random'))
    expect(firstTypes.indexOf('random')).toBeLessThan(firstTypes.indexOf('ending'))
    expect(secondTypes.indexOf('priority')).toBeLessThan(secondTypes.indexOf('random'))
    expect(secondTypes.indexOf('random')).toBeLessThan(secondTypes.indexOf('ending'))
  })

  it.each([2, 3, 4])('does not cancel pinned rotation for %i pinned tracks', (count) => {
    const pinned = Array.from({ length: count }, (_, index) => track(`pin-${index}`, 'priority'))
    const result = buildPlaylists({
      tracks: [...pinned, track('random', 'random', 60)],
      pinnedTrackIds: pinned.map((item) => item.id),
      playlistCount: 2,
      targetDurationMinutes: 5,
      priorityRatioMin: 1,
      priorityRatioMax: 1,
    })

    const pinnedSequences = result.playlists.map((playlist) =>
      playlist.tracks.filter((item) => item.id.startsWith('pin-')).map((item) => item.id),
    )
    expect(pinnedSequences[0]).not.toEqual(pinnedSequences[1])
  })

  it('rotates priority and random groups independently', () => {
    const priority = [track('p1', 'priority'), track('p2', 'priority')]
    const random = [track('r1', 'random'), track('r2', 'random')]
    const result = buildPlaylists({
      tracks: [...priority, ...random],
      pinnedTrackIds: [],
      playlistCount: 4,
      targetDurationMinutes: 2,
      priorityRatioMin: 0.5,
      priorityRatioMax: 1,
    })

    const sequences = result.playlists.map((playlist) => playlist.tracks.map((item) => item.id))
    expect(new Set(sequences.map((sequence) => JSON.stringify(sequence))).size).toBe(4)
    for (const sequence of sequences) {
      expect(sequence).toHaveLength(2)
      expect(priority.map((item) => item.id)).toContain(sequence[0])
      expect(random.map((item) => item.id)).toContain(sequence[1])
    }
    expect(new Set(sequences.map((sequence) => sequence[0])).size).toBe(2)
    expect(new Set(sequences.map((sequence) => sequence[1])).size).toBe(2)
  })

  it('allows shared tracks when complete ordered sequences differ', () => {
    const tracks = [
      track('p1', 'priority'),
      track('p2', 'priority'),
      track('r1', 'random'),
    ]
    const result = buildPlaylists({
      tracks,
      pinnedTrackIds: [],
      playlistCount: 2,
      targetDurationMinutes: 2,
      priorityRatioMin: 0.5,
      priorityRatioMax: 1,
    })

    const sequences = result.playlists.map((playlist) => playlist.tracks.map((item) => item.id))
    expect(sequences[0]).toContain('p1')
    expect(sequences[0]).toContain('r1')
    expect(sequences[1]).toContain('p2')
    expect(sequences[1]).toContain('r1')
    expect(new Set(sequences.map((sequence) => JSON.stringify(sequence))).size).toBe(2)
  })

  it('matches exact user specification example with Opening, Pinned, Priority, Random', () => {
    const openings = [track('O1', 'opening', 10), track('O2', 'opening', 10)]
    const pinned = [track('A', 'priority', 60), track('B', 'priority', 60)]
    const priorities = [track('P1', 'priority', 60), track('P2', 'priority', 60), track('P3', 'priority', 60)]
    const randoms = [track('R1', 'random', 60), track('R2', 'random', 60), track('R3', 'random', 60)]

    const result = buildPlaylists({
      tracks: [...openings, ...pinned, ...priorities, ...randoms],
      openingTracks: openings,
      pinnedTrackIds: ['A', 'B'],
      playlistCount: 3,
      targetDurationMinutes: 6,
      priorityRatioMin: 0.6,
      priorityRatioMax: 0.6,
    })

    expect(result.playlists).toHaveLength(3)
    const p1Tracks = result.playlists[0].tracks.map((t) => t.id)
    const p2Tracks = result.playlists[1].tracks.map((t) => t.id)
    const p3Tracks = result.playlists[2].tracks.map((t) => t.id)

    expect(p1Tracks).toEqual(['O1', 'A', 'B', 'P1', 'P2', 'R1', 'R2'])
    expect(p2Tracks).toEqual(['O2', 'B', 'A', 'P2', 'P3', 'R2', 'R3'])
    expect(p3Tracks).toEqual(['O1', 'A', 'B', 'P3', 'P1', 'R3', 'R1'])
  })

  it('throws instead of returning duplicate full sequences when variants are exhausted', () => {
    expect(() => buildPlaylists({
      tracks: [track('only', 'priority')],
      pinnedTrackIds: [],
      playlistCount: 2,
      targetDurationMinutes: 1,
    })).toThrow(/Không thể tạo đủ/)
  })
})

import { describe, expect, it } from 'vitest'
import { buildMusicGenreQueue } from '../../src/features/musicGenreQueue'

describe('musicGenreQueue', () => {
  it('keeps genre playlists sequential and isolated', () => {
    const queue = buildMusicGenreQueue([
      { genreId: 'a', genreName: 'A', playlists: [{ id: 'a1' } as any, { id: 'a2' } as any] },
      { genreId: 'b', genreName: 'B', playlists: [{ id: 'b1' } as any] },
    ])
    expect(queue.map((item) => `${item.genreId}:${item.playlist.id}`)).toEqual(['a:a1', 'a:a2', 'b:b1'])
  })
})

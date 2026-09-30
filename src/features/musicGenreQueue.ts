import type { PlaylistDefinition } from '../types/ipc'

export interface MusicGenreQueueItem {
  genreId: string
  genreName: string
  playlist: PlaylistDefinition
  ordinal: number
}

export function buildMusicGenreQueue(groups: Array<{ genreId: string; genreName: string; playlists: PlaylistDefinition[] }>): MusicGenreQueueItem[] {
  let ordinal = 0
  return groups.flatMap((group) => group.playlists.map((playlist) => ({
    genreId: group.genreId,
    genreName: group.genreName,
    playlist,
    ordinal: ordinal++,
  })))
}

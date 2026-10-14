import { describe, it, expect } from 'vitest'
import {
  sanitizeFileName,
  buildPlaylistExportFileName,
  resolveBatchFileNames,
} from '../../../src/pages/Music/exportNamingUtils'
import type { PlaylistDefinition } from '../../../src/types/ipc'

describe('exportNamingUtils', () => {
  describe('sanitizeFileName', () => {
    it('converts Vietnamese diacritics including d/D correctly', () => {
      expect(sanitizeFileName('Mặc định')).toBe('mac_dinh')
      expect(sanitizeFileName('Thể loại 2')).toBe('the_loai_2')
      expect(sanitizeFileName('Đồng Quê')).toBe('dong_que')
      expect(sanitizeFileName('Nhạc Trẻ - Hot 2026!')).toBe('nhac_tre_hot_2026')
    })

    it('collapses dashes and multiple underscores', () => {
      expect(sanitizeFileName('  Pop -- Rock  __  2026 ')).toBe('pop_rock_2026')
    })
  })

  describe('buildPlaylistExportFileName', () => {
    const makePl = (id: string, name: string, genreId: string, genreName: string): PlaylistDefinition => ({
      id,
      name,
      genreId,
      genreName,
      targetDurationSec: 3600,
      totalDurationSec: 3600,
      priorityDurationSec: 2500,
      randomDurationSec: 1100,
      openingDurationSec: 0,
      openingCount: 0,
      priorityCount: 10,
      randomCount: 5,
      endingDurationSec: 0,
      endingCount: 0,
      tracks: [],
      createdAt: Date.now(),
    })

    it('automatically prefixes genre tag when exporting multiple genres with generic playlist names', () => {
      const plDefault = makePl('1', 'Playlist 1', 'g1', 'Mặc định')
      const plGenre2 = makePl('2', 'Playlist 1', 'g2', 'Thể loại 2')

      const nameDefault = buildPlaylistExportFileName(plDefault, { isMultiGenreExport: true })
      const nameGenre2 = buildPlaylistExportFileName(plGenre2, { isMultiGenreExport: true })

      expect(nameDefault).toBe('mac_dinh_playlist_1')
      expect(nameGenre2).toBe('the_loai_2_playlist_1')
    })

    it('uses user-customized genre name if provided', () => {
      const pl = makePl('1', 'Playlist 1', 'g1', 'Mặc định')
      const name = buildPlaylistExportFileName(pl, { genreCustomName: 'nhac_xuan_2026' })
      expect(name).toBe('nhac_xuan_2026_playlist_1')
    })

    it('applies common prefix cleanly', () => {
      const pl = makePl('1', 'Playlist 1', 'g1', 'Mặc định')
      const name = buildPlaylistExportFileName(pl, {
        commonPrefix: 'set_tet_',
        genreCustomName: 'edm',
      })
      expect(name).toBe('set_tet_edm_playlist_1')
    })

    it('does not duplicate genre name if playlist name already contains it', () => {
      const pl = makePl('1', 'Mặc định - Playlist 1', 'g1', 'Mặc định')
      const name = buildPlaylistExportFileName(pl, { isMultiGenreExport: true })
      expect(name).toBe('mac_dinh_playlist_1')
    })
  })

  describe('resolveBatchFileNames (Collision Prevention)', () => {
    const makePl = (id: string, name: string, genreId: string, genreName: string): PlaylistDefinition => ({
      id,
      name,
      genreId,
      genreName,
      targetDurationSec: 3600,
      totalDurationSec: 3600,
      priorityDurationSec: 2500,
      randomDurationSec: 1100,
      openingDurationSec: 0,
      openingCount: 0,
      priorityCount: 10,
      randomCount: 5,
      endingDurationSec: 0,
      endingCount: 0,
      tracks: [],
      createdAt: Date.now(),
    })

    it('prevents collision when multiple genres export into the exact same folder', () => {
      const pl1 = makePl('pl1', 'Playlist 1', 'g1', 'Mặc định')
      const pl2 = makePl('pl2', 'Playlist 1', 'g2', 'Thể loại 2')

      // Both genres export into the SAME folder D:\Music
      const getOutputDir = () => 'D:\\Music'

      const resolved = resolveBatchFileNames([pl1, pl2], getOutputDir, { quality: 'aac_384' })

      expect(resolved.get('pl1')).toBe('mac_dinh_playlist_1')
      expect(resolved.get('pl2')).toBe('the_loai_2_playlist_1')
      expect(resolved.get('pl1')).not.toBe(resolved.get('pl2'))
    })

    it('appends counter suffix when identical playlist names exist within the same genre/folder', () => {
      const pl1 = makePl('pl1', 'Playlist 1', 'g1', 'Mặc định')
      const pl2 = makePl('pl2', 'Playlist 1', 'g1', 'Mặc định')

      const getOutputDir = () => 'D:\\Music'

      const resolved = resolveBatchFileNames([pl1, pl2], getOutputDir, { quality: 'aac_384' })

      expect(resolved.get('pl1')).toBe('mac_dinh_playlist_1')
      expect(resolved.get('pl2')).toBe('mac_dinh_playlist_1_2')
    })
  })
})

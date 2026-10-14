import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'

vi.mock('../../../backend/ffmpeg/probe', () => ({
  probeFile: vi.fn(),
}))

vi.mock('../../../backend/ffmpeg/wrapper', () => ({
  runFfmpeg: vi.fn().mockImplementation(async ({ args }) => {
    const outFile = args?.[args.length - 1]
    if (outFile && typeof outFile === 'string' && !outFile.startsWith('-')) {
      await fsp.writeFile(outFile, 'fake audio content').catch(() => {})
    }
    return { code: 0, stdout: '', stderr: '' }
  }),
}))

import { probeFile } from '../../../backend/ffmpeg/probe'
import { runFfmpeg } from '../../../backend/ffmpeg/wrapper'
import { scanMusicFolders, type ScannedTrack } from '../../../backend/music/scanMusic'
import { buildPlaylists } from '../../../backend/music/playlistEngine'
import { exportPlaylistToFile } from '../../../backend/music/exportAudio'
import * as scanStore from '../../../backend/music/scanStore'

const tempDirs: string[] = []

describe('Genre Isolation - Features 1-4', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) =>
        fsp.rm(dir, { recursive: true, force: true }),
      ),
    )
  })

  describe('Tab 1: Quét nhạc (ScanMusic)', () => {
    it('isolates tracks between multiple genres with separate folders', async () => {
      const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'genre-iso-'))
      tempDirs.push(root)

      const edmPriority = path.join(root, 'edm_priority')
      const edmRandom = path.join(root, 'edm_random')
      const boleroPriority = path.join(root, 'bolero_priority')
      const boleroRandom = path.join(root, 'bolero_random')

      await fsp.mkdir(edmPriority, { recursive: true })
      await fsp.mkdir(edmRandom, { recursive: true })
      await fsp.mkdir(boleroPriority, { recursive: true })
      await fsp.mkdir(boleroRandom, { recursive: true })

      await fsp.writeFile(path.join(edmPriority, 'edm1.mp3'), '1')
      await fsp.writeFile(path.join(edmRandom, 'edm2.mp3'), '2')
      await fsp.writeFile(path.join(boleroPriority, 'bolero1.mp3'), '3')
      await fsp.writeFile(path.join(boleroRandom, 'bolero2.mp3'), '4')

      vi.mocked(probeFile).mockResolvedValue({
        format: { duration: 60, size: 1024, bit_rate: 192000 },
        audio: { codec: 'aac' },
      } as any)

      const result = await scanMusicFolders({
        genres: [
          {
            id: 'genre-edm',
            name: 'EDM',
            priorityFolders: [edmPriority],
            randomFolders: [edmRandom],
          },
          {
            id: 'genre-bolero',
            name: 'Bolero',
            priorityFolders: [boleroPriority],
            randomFolders: [boleroRandom],
          },
        ],
        forceRescan: true,
        persist: false,
      })

      const edmTracks = result.tracks.filter((t) => t.genreId === 'genre-edm')
      const boleroTracks = result.tracks.filter((t) => t.genreId === 'genre-bolero')

      expect(edmTracks).toHaveLength(2)
      expect(boleroTracks).toHaveLength(2)

      // Ensure no EDM track leaked into Bolero
      expect(edmTracks.every((t) => t.fileName.startsWith('edm'))).toBe(true)
      expect(boleroTracks.every((t) => t.fileName.startsWith('bolero'))).toBe(true)

      // Check summary per genre
      const edmSummary = result.summary.genres?.find((g) => g.genreId === 'genre-edm')
      const boleroSummary = result.summary.genres?.find((g) => g.genreId === 'genre-bolero')
      expect(edmSummary?.priorityCount).toBe(1)
      expect(edmSummary?.randomCount).toBe(1)
      expect(boleroSummary?.priorityCount).toBe(1)
      expect(boleroSummary?.randomCount).toBe(1)
    })

    it('scans shared opening folders independently for each genre without skipping', async () => {
      const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'genre-shared-open-'))
      tempDirs.push(root)

      const sharedOpening = path.join(root, 'shared_opening')
      const g1Priority = path.join(root, 'g1_priority')
      const g2Priority = path.join(root, 'g2_priority')

      await fsp.mkdir(sharedOpening, { recursive: true })
      await fsp.mkdir(g1Priority, { recursive: true })
      await fsp.mkdir(g2Priority, { recursive: true })

      await fsp.writeFile(path.join(sharedOpening, 'intro.mp3'), 'intro')
      await fsp.writeFile(path.join(g1Priority, 'song1.mp3'), 'song1')
      await fsp.writeFile(path.join(g2Priority, 'song2.mp3'), 'song2')

      vi.mocked(probeFile).mockResolvedValue({
        format: { duration: 15, size: 1024, bit_rate: 192000 },
        audio: { codec: 'aac' },
      } as any)

      const result = await scanMusicFolders({
        genres: [
          {
            id: 'g1',
            name: 'Genre 1',
            priorityFolders: [g1Priority],
            randomFolders: [],
            openingFolders: [sharedOpening],
          },
          {
            id: 'g2',
            name: 'Genre 2',
            priorityFolders: [g2Priority],
            randomFolders: [],
            openingFolders: [sharedOpening],
          },
        ],
        forceRescan: true,
        persist: false,
      })

      const g1Opening = result.tracks.filter((t) => t.genreId === 'g1' && t.folderType === 'opening')
      const g2Opening = result.tracks.filter((t) => t.genreId === 'g2' && t.folderType === 'opening')

      // BOTH genres MUST get their opening track!
      expect(g1Opening).toHaveLength(1)
      expect(g2Opening).toHaveLength(1)
      expect(g1Opening[0].fileName).toBe('intro.mp3')
      expect(g2Opening[0].fileName).toBe('intro.mp3')

      // Track IDs are uniquely scoped to their respective genres
      expect(g1Opening[0].id).not.toBe(g2Opening[0].id)
    })
  })

  describe('Tab 2: Tạo playlist (CreatePlaylist)', () => {
    it('strictly isolates tracks by genreId and prefixes playlist name with genreName', () => {
      const edmTrack: ScannedTrack = {
        id: 'edm-1',
        path: '/music/edm/1.mp3',
        fileName: 'edm1.mp3',
        folderType: 'priority',
        genreId: 'edm',
        genreName: 'EDM',
        duration: 120,
        size: 1000,
      }
      const boleroTrack: ScannedTrack = {
        id: 'bolero-1',
        path: '/music/bolero/1.mp3',
        fileName: 'bolero1.mp3',
        folderType: 'priority',
        genreId: 'bolero',
        genreName: 'Bolero',
        duration: 120,
        size: 1000,
      }

      // Even if tracks array accidentally contains tracks from both genres:
      const result = buildPlaylists({
        tracks: [edmTrack, boleroTrack],
        pinnedTrackIds: [],
        playlistCount: 1,
        targetDurationMinutes: 2,
        genreId: 'edm',
        genreName: 'EDM',
      })

      expect(result.playlists).toHaveLength(1)
      const pl = result.playlists[0]
      expect(pl.name).toBe('EDM - Playlist 1')
      expect(pl.genreId).toBe('edm')
      expect(pl.genreName).toBe('EDM')

      // Every track in playlist MUST belong strictly to EDM
      expect(pl.tracks.every((t) => t.id === 'edm-1')).toBe(true)
      expect(pl.tracks.some((t) => t.id === 'bolero-1')).toBe(false)
    })
  })

  describe('Tab 4: Xuất nhạc (ExportAudio)', () => {
    it('only picks filler tracks belonging to the playlist genre during crossfade duration compensation', async () => {
      const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'export-genre-iso-'))
      tempDirs.push(root)

      const outputDir = path.join(root, 'output')
      await fsp.mkdir(outputDir, { recursive: true })

      const boleroP1 = path.join(root, 'bolero_p1.m4a')
      const boleroP2 = path.join(root, 'bolero_p2.m4a')
      const boleroFiller = path.join(root, 'bolero_filler.m4a')
      const edmSong = path.join(root, 'edm_song.m4a')

      await fsp.writeFile(boleroP1, 'audio')
      await fsp.writeFile(boleroP2, 'audio')
      await fsp.writeFile(boleroFiller, 'audio')
      await fsp.writeFile(edmSong, 'audio')

      // Mock scanResult in scanStore
      const mockScanResult = {
        tracks: [
          {
            id: 'b1',
            path: boleroP1,
            fileName: 'bolero_p1.m4a',
            folderType: 'priority' as const,
            genreId: 'bolero',
            genreName: 'Bolero',
            duration: 60,
            size: 100,
            codec: 'aac',
          },
          {
            id: 'b2',
            path: boleroP2,
            fileName: 'bolero_p2.m4a',
            folderType: 'priority' as const,
            genreId: 'bolero',
            genreName: 'Bolero',
            duration: 60,
            size: 100,
            codec: 'aac',
          },
          {
            id: 'b-filler',
            path: boleroFiller,
            fileName: 'bolero_filler.m4a',
            folderType: 'random' as const,
            genreId: 'bolero',
            genreName: 'Bolero',
            duration: 60,
            size: 100,
            codec: 'aac',
          },
          {
            id: 'edm-intruder',
            path: edmSong,
            fileName: 'edm_song.m4a',
            folderType: 'priority' as const,
            genreId: 'edm',
            genreName: 'EDM',
            duration: 120,
            size: 100,
            codec: 'aac',
          },
        ],
        summary: { priorityCount: 3, randomCount: 1, totalCount: 4, priorityDuration: 240, randomDuration: 60, totalDuration: 300 },
      }

      vi.spyOn(scanStore, 'loadScanResult').mockReturnValue(mockScanResult as any)

      vi.mocked(probeFile).mockResolvedValue({
        format: { duration: 150, size: 1024, bit_rate: 192000 },
        audio: { codec: 'aac' },
      } as any)

      // Playlist Bolero target 180s, but only has 120s of tracks (b1 + b2).
      // With crossfade 4s, estimated is 120 - 4 = 116s.
      // Deficit is 180 - 116 = 64s > 5s -> triggers filler track insertion!
      const mockPlaylist = {
        id: 'pl-bolero-1',
        name: 'Bolero - Playlist 1',
        targetDurationSec: 180,
        totalDurationSec: 120,
        priorityDurationSec: 120,
        randomDurationSec: 0,
        priorityCount: 2,
        randomCount: 0,
        genreId: 'bolero',
        genreName: 'Bolero',
        genreSettings: {
          smoothTransitions: true,
          crossfadeDurationSec: 4,
          normalizeLoudness: false,
        },
        createdAt: Date.now(),
        tracks: [
          {
            ...mockScanResult.tracks[0],
            order: 1,
            cumulativeDuration: 60,
          },
          {
            ...mockScanResult.tracks[1],
            order: 2,
            cumulativeDuration: 120,
          },
        ],
      }

      // Mock playlistEngine.getPlaylistById
      const playlistEngineModule = await import('../../../backend/music/playlistEngine')
      vi.spyOn(playlistEngineModule, 'getPlaylistById').mockReturnValue(mockPlaylist as any)

      // We simulate export
      const result = await exportPlaylistToFile({
        playlistId: 'pl-bolero-1',
        outputDir,
        fileName: 'bolero_playlist_1',
        format: 'aac',
        smoothTransitions: true,
        crossfadeDurationSec: 4,
      })

      expect(result.success).toBe(true)

      // Verify what was passed to FFmpeg - check inputs
      const runFfmpegCalls = vi.mocked(runFfmpeg).mock.calls
      expect(runFfmpegCalls.length).toBeGreaterThan(0)

      // Ensure that edm_song.m4a was NEVER passed to FFmpeg for this Bolero playlist!
      for (const call of runFfmpegCalls) {
        const args: string[] = call[0]?.args ?? []
        expect(args.some((arg) => arg.includes('edm_song'))).toBe(false)
      }
    })
  })
})

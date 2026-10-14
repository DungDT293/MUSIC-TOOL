import { describe, expect, it } from 'vitest'
import {
  shuffleOnce,
  createSeededRandom,
  generateUniqueSeed,
  buildRandomPermutations,
  buildPlaylistToFillDuration,
  type ClipItem,
} from '../../../backend/video/utils/videoShuffleHelpers'

const createMockClips = (count: number, durationSec = 10): ClipItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `clip-${i}`,
    path: `E:/clips/clip_${i}.mp4`,
    durationSec,
  }))

describe('videoShuffleHelpers', () => {
  describe('shuffleOnce', () => {
    it('does not mutate input array', () => {
      const original = createMockClips(5)
      const inputCopy = [...original]
      const shuffled = shuffleOnce(original)

      expect(original).toEqual(inputCopy)
      expect(shuffled).toHaveLength(original.length)
      expect(new Set(shuffled.map((c) => c.path)).size).toBe(original.length)
    })

    it('returns empty array when given empty input', () => {
      expect(shuffleOnce([])).toEqual([])
    })

    it('returns single item when given 1 clip', () => {
      const single = createMockClips(1)
      expect(shuffleOnce(single)).toEqual(single)
    })
  })

  describe('createSeededRandom', () => {
    it('is deterministic for the same seed', () => {
      const rng1 = createSeededRandom(42)
      const rng2 = createSeededRandom(42)
      const values1 = Array.from({ length: 10 }, () => rng1())
      const values2 = Array.from({ length: 10 }, () => rng2())
      expect(values1).toEqual(values2)
    })

    it('produces different sequences for different seeds', () => {
      const rng1 = createSeededRandom(100)
      const rng2 = createSeededRandom(200)
      const values1 = Array.from({ length: 10 }, () => rng1())
      const values2 = Array.from({ length: 10 }, () => rng2())
      expect(values1).not.toEqual(values2)
    })

    it('does not get stuck when seed is 0', () => {
      const rng = createSeededRandom(0)
      const values = Array.from({ length: 10 }, () => rng())
      expect(values.every((v) => v === 0)).toBe(false)
      expect(new Set(values).size).toBe(10)
    })
  })

  describe('buildRandomPermutations', () => {
    it('generates distinct permutations for pools with enough clips', () => {
      const clips = createMockClips(10)
      const perms = buildRandomPermutations(clips, 5)

      expect(perms).toHaveLength(5)
      const signatures = new Set(perms.map((p) => p.map((c) => c.id).join('|')))
      expect(signatures.size).toBe(5)
    })

    it('gracefully handles small pools without crashing when repeatCount exceeds permutations', () => {
      const clips = createMockClips(2) // Only 2 possible permutations
      const perms = buildRandomPermutations(clips, 4)

      expect(perms).toHaveLength(4)
      for (const p of perms) {
        expect(p).toHaveLength(2)
      }
    })

    it('handles single clip without crashing', () => {
      const clips = createMockClips(1)
      const perms = buildRandomPermutations(clips, 3)
      expect(perms).toHaveLength(3)
      expect(perms[0]).toHaveLength(1)
    })
  })

  describe('buildPlaylistToFillDuration', () => {
    it('fills target duration and prevents adjacent repeats across loop boundaries', () => {
      const clips = createMockClips(3, 10) // 30s total
      const targetSec = 100 // needs >3 loops

      const playlist = buildPlaylistToFillDuration(clips, targetSec, true, 12345)
      const totalDuration = playlist.reduce((sum, c) => sum + c.durationSec, 0)

      expect(totalDuration).toBeGreaterThanOrEqual(targetSec)
      // Verify no adjacent identical clips
      for (let i = 1; i < playlist.length; i++) {
        expect(playlist[i].id).not.toBe(playlist[i - 1].id)
      }
    })

    it('produces diverse playlists between renders using different seeds', () => {
      const clips = createMockClips(15, 10)
      const targetSec = 100

      const playlist1 = buildPlaylistToFillDuration(clips, targetSec, true, 1111)
      const playlist2 = buildPlaylistToFillDuration(clips, targetSec, true, 2222)

      const seq1 = playlist1.map((c) => c.id).join(',')
      const seq2 = playlist2.map((c) => c.id).join(',')

      expect(seq1).not.toBe(seq2)
    })
  })
})


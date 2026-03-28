/**
 * Uniform shuffle helper for merge & final export
 * Ensures ALL clips participate in shuffle, no clips are dropped, and no repeating patterns
 */

export interface ClipWithDuration {
  path: string
  durationSec: number
  [key: string]: any // Allow additional fields
}

export interface BuildShuffledPlaylistOptions {
  clips: ClipWithDuration[]
  targetDurationSec: number
  safetyMarginSec?: number // default: 10s
  shuffle?: boolean // default: true
  seed?: string // optional seed for reproducibility
}

export interface ShuffledPlaylistResult {
  items: ClipWithDuration[]
  totalDurationSec: number
  usedUniqueClips: number // Number of unique clips used
}

/**
 * Create seeded random number generator
 */
function createSeededRandom(seed: string): () => number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  let state = hash >>> 0
  
  return () => {
    state = ((state * 1103515245) + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

/**
 * Fisher-Yates shuffle
 */
function fisherYatesShuffle<T>(arr: T[], random: () => number): T[] {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * Shuffle clips once (no looping) - for "no target duration" mode
 * Returns exactly N clips in random order
 */
export function shuffleClipsOnce<T extends ClipWithDuration>(
  clips: T[],
  seed?: string
): T[] {
  if (!clips.length) return []
  
  const random = seed ? createSeededRandom(seed) : () => Math.random()
  return fisherYatesShuffle(clips, random)
}

/**
 * Build shuffled playlist that uses ALL clips uniformly
 * - Each clip appears before reshuffling
 * - Reshuffles when pool is exhausted to avoid repeating patterns
 * - Never drops clips
 */
export function buildShuffledPlaylistForDuration(
  opts: BuildShuffledPlaylistOptions
): ShuffledPlaylistResult {
  const { clips, targetDurationSec, safetyMarginSec = 10, shuffle = true, seed } = opts

  if (!clips.length) {
    return { items: [], totalDurationSec: 0, usedUniqueClips: 0 }
  }

  // If no shuffle, just append sequentially
  if (!shuffle) {
    const result: ClipWithDuration[] = []
    let total = 0
    let index = 0
    while (total < targetDurationSec + safetyMarginSec) {
      const clip = clips[index % clips.length]
      result.push(clip)
      total += clip.durationSec
      index++
    }
    const unique = new Set(result.map(c => c.path))
    return {
      items: result,
      totalDurationSec: total,
      usedUniqueClips: unique.size,
    }
  }

  // Shuffle mode: use Fisher-Yates with reshuffling
  const random = seed ? createSeededRandom(seed) : () => Math.random()
  let pool: ClipWithDuration[] = []

  const reshuffle = () => {
    pool = fisherYatesShuffle(clips, random)
  }

  // Initial shuffle
  reshuffle()

  const result: ClipWithDuration[] = []
  let total = 0

  while (total < targetDurationSec + safetyMarginSec) {
    if (!pool.length) {
      // Pool exhausted, reshuffle to avoid repeating pattern
      reshuffle()
    }
    const clip = pool.pop()!
    result.push(clip)
    total += clip.durationSec
  }

  // Count unique clips used
  const unique = new Set(result.map(c => c.path))

  return {
    items: result,
    totalDurationSec: total,
    usedUniqueClips: unique.size,
  }
}


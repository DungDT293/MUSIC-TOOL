import path from 'node:path'
import { randomBytes } from 'crypto'

/**
 * Core shuffle helpers for video merge and final export
 * Simple, clean, easy to debug
 */

export interface ClipItem {
  path: string
  durationSec: number // đã được probe, > 0
  id?: string // optional, dùng để debug nếu cần
  sizeBytes?: number
  width?: number
  height?: number
}

/**
 * Fisher-Yates shuffle - shuffle một lần
 * 
 * - KHÔNG mutate input: luôn copy (const result = [...clips])
 * - Input có N phần tử → output cũng N phần tử, không thêm/bớt, chỉ đổi thứ tự
 * 
 * @param clips - Tập clips cần shuffle
 * @returns Mảng clips đã shuffle (cùng số lượng, khác thứ tự)
 */
export function shuffleOnce(clips: ClipItem[], randomFn: () => number = Math.random): ClipItem[] {
  if (!clips.length) return []
  if (clips.length === 1) return [...clips]
  
  // Deep copy để tránh mutate input
  const result = clips.map((clip) => ({ ...clip }))
  
  // Standard unbiased Fisher-Yates shuffle
  for (let i = result.length - 1; i > 0; i--) {
    const r = Math.min(0.999999999, Math.max(0, randomFn()))
    const j = Math.floor(r * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  
  return result
}

export const shuffleClipsOnce = shuffleOnce

export function createSeededRandom(seed: number): () => number {
  // Mulberry32 PRNG - fast, high quality 32-bit state, full 2^32 period
  let s = (seed >>> 0) || 0x12345678
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Tạo seed unique cho mỗi merge job
 * Dùng crypto random bytes để đảm bảo entropy tối đa
 */
export function generateUniqueSeed(baseSeed: number, index: number): number {
  let randomPart = 0
  try {
    randomPart = randomBytes(4).readUInt32BE(0)
  } catch {
    randomPart = (Math.random() * 0xffffffff) >>> 0
  }
  const h = Math.imul((baseSeed ^ randomPart) >>> 0, 0x85ebca6b)
  const mixed = Math.imul((h ^ (index + 1)) >>> 0, 0x9e3779b9)
  return (mixed >>> 0) || 0x1337c0de
}

/**
 * Tạo nhiều permutations của cùng một tập clips
 * 
 * - Trả về array 2D: mỗi phần tử là 1 permutation của toàn bộ clips
 * - repeatCount lần, mỗi lần gọi shuffleOnce()
 * 
 * @param clips - Tập clips gốc
 * @param repeatCount - Số lần tạo permutation
 * @returns Array 2D: mỗi phần tử là 1 permutation đầy đủ
 */
export function buildRandomPermutations(
  clips: ClipItem[],
  repeatCount: number
): ClipItem[][] {
  if (!clips.length || repeatCount <= 0) return []
  if (clips.length === 1) {
    return Array(repeatCount).fill(null).map(() => [...clips])
  }
  
  const permutations: ClipItem[][] = []
  const signatures = new Set<string>()
  const MAX_ATTEMPTS = 30
  console.log(`[buildRandomPermutations] Creating ${repeatCount} permutations from ${clips.length} clips`)
  
  // Tạo base seed unique cho toàn bộ batch
  const baseSeed = Date.now() ^ randomBytes(4).readUInt32BE(0)
  
  for (let i = 0; i < repeatCount; i++) {
    let permutation: ClipItem[] = []
    let signature = ''
    let attempt = 0
    
    while (attempt < MAX_ATTEMPTS) {
      const seed = generateUniqueSeed(baseSeed, i * 1000 + attempt)
      const rng = createSeededRandom(seed)
      permutation = shuffleOnce(clips, rng)
      signature = permutation.map((c) => c.path).join('|')
      if (!signatures.has(signature)) {
        break
      }
      attempt++
    }
    
    // Nếu hết số permutations duy nhất khả dĩ (ví dụ pool chỉ có 2 clip nhưng yêu cầu 5 lần ghép),
    // không throw lỗi sập hệ thống mà chấp nhận permutation đã shuffle để hoàn tất job.
    if (signatures.has(signature)) {
      console.warn(`[buildRandomPermutations] Hết hoán vị hoàn toàn mới tại lần ${i + 1}/${repeatCount} (có ${clips.length} clip). Dùng hoán vị ngẫu nhiên tốt nhất.`)
    } else {
      signatures.add(signature)
    }
    
    const first3 = permutation.slice(0, 3).map((c) => path.basename(c.path))
    console.log(`  Permutation ${i + 1}/${repeatCount} first 3 clips: ${first3.join(', ')}`)
    
    permutations.push(permutation)
  }
  
  console.log(`[buildRandomPermutations] ✓ Created ${permutations.length} permutations (${signatures.size} unique signatures)`)
  return permutations
}

/**
 * Build playlist để đủ target duration bằng cách loop clips
 * 
 * Logic:
 *   playlist = []
 *   total = 0
 *   while (total < targetDurationSec) {
 *     shuffled = shuffleOnce(clips)
 *     for (clip of shuffled) {
 *       playlist.push(clip)
 *       total += clip.durationSec
 *       if (total >= targetDurationSec) break
 *     }
 *   }
 *   return playlist
 * 
 * - Không drop clips
 * - Cho phép lặp lại clips nếu target > tổng input
 * - Input validation: clips.length > 0, targetDurationSec > 0
 * 
 * @param clips - Tập clips gốc (clips.length > 0, mọi clip có durationSec > 0)
 * @param targetDurationSec - Thời lượng mục tiêu (targetDurationSec > 0)
 * @param shuffle - Có shuffle hay không (default: true)
 * @param seed - Seed để đảm bảo mỗi lần gọi tạo playlist khác nhau (optional)
 * @returns Playlist có thể dài hơn số clip gốc (do loop)
 */
export function buildPlaylistToFillDuration(
  clips: ClipItem[],
  targetDurationSec: number,
  shuffle: boolean = true,
  seed?: number
): ClipItem[] {
  // Input validation
  if (!clips.length || targetDurationSec <= 0) return []
  
  const playlist: ClipItem[] = []
  let total = 0
  
  // Tạo random function với seed nếu có, để đảm bảo mỗi lần gọi tạo playlist khác nhau
  // Seed phải được đảm bảo là unique cho mỗi merge job
  const baseSeed = seed !== undefined 
    ? seed 
    : (Date.now() ^ randomBytes(4).readUInt32BE(0))
  const randomFn = createSeededRandom(baseSeed)
  
  // FIX: Shuffle toàn bộ clips trước khi bắt đầu loop (nếu shuffle = true)
  // Điều này đảm bảo thứ tự đầu tiên được shuffle đúng cách
  let currentClips = shuffle ? shuffleOnce(clips, randomFn) : [...clips]
  let clipIndex = 0
  let reshuffleCount = 0
  
  while (total < targetDurationSec) {
    // Nếu đã dùng hết clips, shuffle lại và reset index
    if (clipIndex >= currentClips.length) {
      if (shuffle) {
        // Mỗi lần reshuffle, dùng seed hoàn toàn khác nhau để tránh trùng pattern
        // Dùng generateUniqueSeed để đảm bảo seed unique và randomness tốt
        const reshuffleSeed = generateUniqueSeed(baseSeed, (reshuffleCount + 1) * 10000)
        const reshuffleRng = createSeededRandom(reshuffleSeed)
        currentClips = shuffleOnce(clips, reshuffleRng)
      } else {
        currentClips = [...clips]
      }
      const previousClipId = playlist.at(-1)?.id
      if (previousClipId && currentClips.length > 1 && currentClips[0]?.id === previousClipId) {
        const replacementIndex = currentClips.findIndex((candidate) => candidate.id !== previousClipId)
        if (replacementIndex > 0) {
          ;[currentClips[0], currentClips[replacementIndex]] = [currentClips[replacementIndex], currentClips[0]]
        }
      }
      clipIndex = 0
      reshuffleCount++
    }
    
    const clip = currentClips[clipIndex]
    playlist.push(clip)
    total += clip.durationSec
    clipIndex++
    
    if (total >= targetDurationSec) {
      break
    }
  }
  
  return playlist
}

/**
 * Validate playlist (chỉ dùng trong DEBUG/log, không throw ở production trừ khi thật sự sai)
 * 
 * Check:
 * - Mọi playlist[i].path đều thuộc set path của sourceClips
 * - Nếu có targetDurationSec, tổng duration playlist không được < targetDurationSec - 0.5
 * 
 * @param playlist - Playlist cần validate
 * @param sourceClips - Tập clips gốc
 * @param targetDurationSec - Thời lượng mục tiêu (optional)
 * @returns { valid: boolean, errors: string[] }
 */
export function validatePlaylist(
  playlist: ClipItem[],
  sourceClips: ClipItem[],
  targetDurationSec?: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const sourcePaths = new Set(sourceClips.map(c => c.path))
  
  // Check: Mọi path trong playlist phải thuộc source
  for (const item of playlist) {
    if (!sourcePaths.has(item.path)) {
      errors.push(`Playlist chứa path không thuộc source: ${item.path}`)
    }
  }
  
  // Check: Nếu có target, tổng duration không được < target - 0.5
  if (targetDurationSec !== undefined) {
    const totalDuration = playlist.reduce((sum, c) => sum + c.durationSec, 0)
    if (totalDuration < targetDurationSec - 0.5) {
      errors.push(
        `Playlist duration (${totalDuration.toFixed(2)}s) < target (${targetDurationSec.toFixed(2)}s) - 0.5s`
      )
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  }
}

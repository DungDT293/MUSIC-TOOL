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
  
  // Deep copy để tránh reference tới cùng phần tử khi shuffle nhiều lần
  const result = clips.map((clip) => ({ ...clip }))
  
  // Fisher-Yates shuffle với cải thiện: đảm bảo randomness tốt hơn
  // Dùng nhiều lần random để tránh bias
  for (let i = result.length - 1; i > 0; i--) {
    // Lấy random value và đảm bảo nó trong range [0, i]
    // Dùng multiple calls để tăng entropy
    let r = randomFn()
    // Nếu randomFn trả về giá trị quá gần 0 hoặc 1, lấy thêm một lần nữa
    if (r < 0.0001 || r > 0.9999) {
      r = randomFn()
    }
    const j = Math.floor(r * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  
  return result
}

function createSeededRandom(seed: number): () => number {
  // Cải thiện PRNG để đảm bảo randomness tốt hơn
  let state = seed >>> 0
  return () => {
    // Xorshift32 algorithm - tốt hơn cho shuffle
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) / 4294967296)
  }
}

/**
 * Tạo seed unique cho mỗi merge job
 * Dùng crypto random để đảm bảo không trùng
 */
function generateUniqueSeed(baseSeed: number, index: number): number {
  // Dùng crypto random bytes để tạo entropy tốt hơn
  const randomPart = randomBytes(4).readUInt32BE(0)
  // Kết hợp với baseSeed và index để đảm bảo unique
  return (baseSeed ^ randomPart) + index * 0x9e3779b9 + (index * index * 0x6d2b79f5)
}

/**
 * Tạo nhiều permutations của cùng một tập clips
 * 
 * - Trả về array 2D: mỗi phần tử là 1 permutation của toàn bộ clips
 * - repeatCount lần, mỗi lần gọi shuffleOnce()
 * - Ví dụ: 100 clips, repeatCount = 3 → output: [[100], [100], [100]]
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
  
  const permutations: ClipItem[][] = []
  const signatures = new Set<string>()
  const MAX_ATTEMPTS = 10
  console.log(`[buildRandomPermutations] Creating ${repeatCount} permutations from ${clips.length} clips`)
  
  // Tạo base seed unique cho toàn bộ batch
  const baseSeed = Date.now() ^ randomBytes(4).readUInt32BE(0)
  
  for (let i = 0; i < repeatCount; i++) {
    let permutation: ClipItem[] = []
    let signature = ''
    let attempt = 0
    
    while (attempt < MAX_ATTEMPTS) {
      // Dùng generateUniqueSeed để đảm bảo mỗi permutation có seed hoàn toàn khác nhau
      const seed = generateUniqueSeed(baseSeed, i * 1000 + attempt)
      const rng = createSeededRandom(seed)
      permutation = shuffleOnce(clips, rng)
      signature = permutation.map((c) => c.path).join('|')
      if (!signatures.has(signature)) {
        break
      }
      attempt++
      console.warn(`[buildRandomPermutations] Duplicate permutation detected (perm ${i + 1}, attempt ${attempt}). Retrying...`)
    }
    
    if (signatures.has(signature)) {
      throw new Error(`[buildRandomPermutations] Failed to create unique permutation cho lần ${i + 1} sau ${MAX_ATTEMPTS} attempts.`)
    }
    
    signatures.add(signature)
    
    const first3 = permutation.slice(0, 3).map((c) => path.basename(c.path))
    console.log(`  Permutation ${i + 1}/${repeatCount} first 3 clips: ${first3.join(', ')}`)
    
    permutations.push(permutation)
  }
  
  console.log(`[buildRandomPermutations] ✓ Created ${permutations.length} unique permutations`)
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
        const reshuffleSeed = generateUniqueSeed(baseSeed, reshuffleCount * 10000)
        const reshuffleRng = createSeededRandom(reshuffleSeed)
        currentClips = shuffleOnce(clips, reshuffleRng)
      } else {
        currentClips = [...clips]
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

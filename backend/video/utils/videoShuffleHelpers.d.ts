/**
 * Core shuffle helpers for video merge and final export
 * Simple, clean, easy to debug
 */
export interface ClipItem {
    path: string;
    durationSec: number;
    id?: string;
    sizeBytes?: number;
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
export declare function shuffleOnce(clips: ClipItem[], randomFn?: () => number): ClipItem[];
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
export declare function buildRandomPermutations(clips: ClipItem[], repeatCount: number): ClipItem[][];
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
export declare function buildPlaylistToFillDuration(clips: ClipItem[], targetDurationSec: number, shuffle?: boolean, seed?: number): ClipItem[];
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
export declare function validatePlaylist(playlist: ClipItem[], sourceClips: ClipItem[], targetDurationSec?: number): {
    valid: boolean;
    errors: string[];
};

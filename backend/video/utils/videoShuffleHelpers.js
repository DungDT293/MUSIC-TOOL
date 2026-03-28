var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import path from 'node:path';
import { randomBytes } from 'crypto';
/**
 * Fisher-Yates shuffle - shuffle một lần
 *
 * - KHÔNG mutate input: luôn copy (const result = [...clips])
 * - Input có N phần tử → output cũng N phần tử, không thêm/bớt, chỉ đổi thứ tự
 *
 * @param clips - Tập clips cần shuffle
 * @returns Mảng clips đã shuffle (cùng số lượng, khác thứ tự)
 */
export function shuffleOnce(clips, randomFn) {
    var _a;
    if (randomFn === void 0) { randomFn = Math.random; }
    if (!clips.length)
        return [];
    if (clips.length === 1)
        return __spreadArray([], clips, true);
    // Deep copy để tránh reference tới cùng phần tử khi shuffle nhiều lần
    var result = clips.map(function (clip) { return (__assign({}, clip)); });
    // Fisher-Yates shuffle với cải thiện: đảm bảo randomness tốt hơn
    // Dùng nhiều lần random để tránh bias
    for (var i = result.length - 1; i > 0; i--) {
        // Lấy random value và đảm bảo nó trong range [0, i]
        // Dùng multiple calls để tăng entropy
        var r = randomFn();
        // Nếu randomFn trả về giá trị quá gần 0 hoặc 1, lấy thêm một lần nữa
        if (r < 0.0001 || r > 0.9999) {
            r = randomFn();
        }
        var j = Math.floor(r * (i + 1));
        _a = [result[j], result[i]], result[i] = _a[0], result[j] = _a[1];
    }
    return result;
}
function createSeededRandom(seed) {
    // Cải thiện PRNG để đảm bảo randomness tốt hơn
    var state = seed >>> 0;
    return function () {
        // Xorshift32 algorithm - tốt hơn cho shuffle
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return ((state >>> 0) / 4294967296);
    };
}
/**
 * Tạo seed unique cho mỗi merge job
 * Dùng crypto random để đảm bảo không trùng
 */
function generateUniqueSeed(baseSeed, index) {
    // Dùng crypto random bytes để tạo entropy tốt hơn
    var randomPart = randomBytes(4).readUInt32BE(0);
    // Kết hợp với baseSeed và index để đảm bảo unique
    return (baseSeed ^ randomPart) + index * 0x9e3779b9 + (index * index * 0x6d2b79f5);
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
export function buildRandomPermutations(clips, repeatCount) {
    if (!clips.length || repeatCount <= 0)
        return [];
    var permutations = [];
    var signatures = new Set();
    var MAX_ATTEMPTS = 10;
    console.log("[buildRandomPermutations] Creating ".concat(repeatCount, " permutations from ").concat(clips.length, " clips"));
    // Tạo base seed unique cho toàn bộ batch
    var baseSeed = Date.now() ^ randomBytes(4).readUInt32BE(0);
    for (var i = 0; i < repeatCount; i++) {
        var permutation = [];
        var signature = '';
        var attempt = 0;
        while (attempt < MAX_ATTEMPTS) {
            // Dùng generateUniqueSeed để đảm bảo mỗi permutation có seed hoàn toàn khác nhau
            var seed = generateUniqueSeed(baseSeed, i * 1000 + attempt);
            var rng = createSeededRandom(seed);
            permutation = shuffleOnce(clips, rng);
            signature = permutation.map(function (c) { return c.path; }).join('|');
            if (!signatures.has(signature)) {
                break;
            }
            attempt++;
            console.warn("[buildRandomPermutations] Duplicate permutation detected (perm ".concat(i + 1, ", attempt ").concat(attempt, "). Retrying..."));
        }
        if (signatures.has(signature)) {
            throw new Error("[buildRandomPermutations] Failed to create unique permutation cho l\u1EA7n ".concat(i + 1, " sau ").concat(MAX_ATTEMPTS, " attempts."));
        }
        signatures.add(signature);
        var first3 = permutation.slice(0, 3).map(function (c) { return path.basename(c.path); });
        console.log("  Permutation ".concat(i + 1, "/").concat(repeatCount, " first 3 clips: ").concat(first3.join(', ')));
        permutations.push(permutation);
    }
    console.log("[buildRandomPermutations] \u2713 Created ".concat(permutations.length, " unique permutations"));
    return permutations;
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
export function buildPlaylistToFillDuration(clips, targetDurationSec, shuffle, seed) {
    if (shuffle === void 0) { shuffle = true; }
    // Input validation
    if (!clips.length || targetDurationSec <= 0)
        return [];
    var playlist = [];
    var total = 0;
    // Tạo random function với seed nếu có, để đảm bảo mỗi lần gọi tạo playlist khác nhau
    // Seed phải được đảm bảo là unique cho mỗi merge job
    var baseSeed = seed !== undefined
        ? seed
        : (Date.now() ^ randomBytes(4).readUInt32BE(0));
    var randomFn = createSeededRandom(baseSeed);
    // FIX: Shuffle toàn bộ clips trước khi bắt đầu loop (nếu shuffle = true)
    // Điều này đảm bảo thứ tự đầu tiên được shuffle đúng cách
    var currentClips = shuffle ? shuffleOnce(clips, randomFn) : __spreadArray([], clips, true);
    var clipIndex = 0;
    var reshuffleCount = 0;
    while (total < targetDurationSec) {
        // Nếu đã dùng hết clips, shuffle lại và reset index
        if (clipIndex >= currentClips.length) {
            if (shuffle) {
                // Mỗi lần reshuffle, dùng seed hoàn toàn khác nhau để tránh trùng pattern
                // Dùng generateUniqueSeed để đảm bảo seed unique và randomness tốt
                var reshuffleSeed = generateUniqueSeed(baseSeed, reshuffleCount * 10000);
                var reshuffleRng = createSeededRandom(reshuffleSeed);
                currentClips = shuffleOnce(clips, reshuffleRng);
            }
            else {
                currentClips = __spreadArray([], clips, true);
            }
            clipIndex = 0;
            reshuffleCount++;
        }
        var clip = currentClips[clipIndex];
        playlist.push(clip);
        total += clip.durationSec;
        clipIndex++;
        if (total >= targetDurationSec) {
            break;
        }
    }
    return playlist;
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
export function validatePlaylist(playlist, sourceClips, targetDurationSec) {
    var errors = [];
    var sourcePaths = new Set(sourceClips.map(function (c) { return c.path; }));
    // Check: Mọi path trong playlist phải thuộc source
    for (var _i = 0, playlist_1 = playlist; _i < playlist_1.length; _i++) {
        var item = playlist_1[_i];
        if (!sourcePaths.has(item.path)) {
            errors.push("Playlist ch\u1EE9a path kh\u00F4ng thu\u1ED9c source: ".concat(item.path));
        }
    }
    // Check: Nếu có target, tổng duration không được < target - 0.5
    if (targetDurationSec !== undefined) {
        var totalDuration = playlist.reduce(function (sum, c) { return sum + c.durationSec; }, 0);
        if (totalDuration < targetDurationSec - 0.5) {
            errors.push("Playlist duration (".concat(totalDuration.toFixed(2), "s) < target (").concat(targetDurationSec.toFixed(2), "s) - 0.5s"));
        }
    }
    return {
        valid: errors.length === 0,
        errors: errors,
    };
}

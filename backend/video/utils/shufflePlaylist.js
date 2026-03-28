/**
 * Uniform shuffle helper for merge & final export
 * Ensures ALL clips participate in shuffle, no clips are dropped, and no repeating patterns
 */
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
/**
 * Create seeded random number generator
 */
function createSeededRandom(seed) {
    var hash = 0;
    for (var i = 0; i < seed.length; i++) {
        var char = seed.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    var state = hash >>> 0;
    return function () {
        state = ((state * 1103515245) + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}
/**
 * Fisher-Yates shuffle
 */
function fisherYatesShuffle(arr, random) {
    var _a;
    var result = __spreadArray([], arr, true);
    for (var i = result.length - 1; i > 0; i--) {
        var j = Math.floor(random() * (i + 1));
        _a = [result[j], result[i]], result[i] = _a[0], result[j] = _a[1];
    }
    return result;
}
/**
 * Shuffle clips once (no looping) - for "no target duration" mode
 * Returns exactly N clips in random order
 */
export function shuffleClipsOnce(clips, seed) {
    if (!clips.length)
        return [];
    var random = seed ? createSeededRandom(seed) : function () { return Math.random(); };
    return fisherYatesShuffle(clips, random);
}
/**
 * Build shuffled playlist that uses ALL clips uniformly
 * - Each clip appears before reshuffling
 * - Reshuffles when pool is exhausted to avoid repeating patterns
 * - Never drops clips
 */
export function buildShuffledPlaylistForDuration(opts) {
    var clips = opts.clips, targetDurationSec = opts.targetDurationSec, _a = opts.safetyMarginSec, safetyMarginSec = _a === void 0 ? 10 : _a, _b = opts.shuffle, shuffle = _b === void 0 ? true : _b, seed = opts.seed;
    if (!clips.length) {
        return { items: [], totalDurationSec: 0, usedUniqueClips: 0 };
    }
    // If no shuffle, just append sequentially
    if (!shuffle) {
        var result_1 = [];
        var total_1 = 0;
        var index = 0;
        while (total_1 < targetDurationSec + safetyMarginSec) {
            var clip = clips[index % clips.length];
            result_1.push(clip);
            total_1 += clip.durationSec;
            index++;
        }
        var unique_1 = new Set(result_1.map(function (c) { return c.path; }));
        return {
            items: result_1,
            totalDurationSec: total_1,
            usedUniqueClips: unique_1.size,
        };
    }
    // Shuffle mode: use Fisher-Yates with reshuffling
    var random = seed ? createSeededRandom(seed) : function () { return Math.random(); };
    var pool = [];
    var reshuffle = function () {
        pool = fisherYatesShuffle(clips, random);
    };
    // Initial shuffle
    reshuffle();
    var result = [];
    var total = 0;
    while (total < targetDurationSec + safetyMarginSec) {
        if (!pool.length) {
            // Pool exhausted, reshuffle to avoid repeating pattern
            reshuffle();
        }
        var clip = pool.pop();
        result.push(clip);
        total += clip.durationSec;
    }
    // Count unique clips used
    var unique = new Set(result.map(function (c) { return c.path; }));
    return {
        items: result,
        totalDurationSec: total,
        usedUniqueClips: unique.size,
    };
}

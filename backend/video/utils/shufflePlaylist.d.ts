/**
 * Uniform shuffle helper for merge & final export
 * Ensures ALL clips participate in shuffle, no clips are dropped, and no repeating patterns
 */
export interface ClipWithDuration {
    path: string;
    durationSec: number;
    [key: string]: any;
}
export interface BuildShuffledPlaylistOptions {
    clips: ClipWithDuration[];
    targetDurationSec: number;
    safetyMarginSec?: number;
    shuffle?: boolean;
    seed?: string;
}
export interface ShuffledPlaylistResult {
    items: ClipWithDuration[];
    totalDurationSec: number;
    usedUniqueClips: number;
}
/**
 * Shuffle clips once (no looping) - for "no target duration" mode
 * Returns exactly N clips in random order
 */
export declare function shuffleClipsOnce<T extends ClipWithDuration>(clips: T[], seed?: string): T[];
/**
 * Build shuffled playlist that uses ALL clips uniformly
 * - Each clip appears before reshuffling
 * - Reshuffles when pool is exhausted to avoid repeating patterns
 * - Never drops clips
 */
export declare function buildShuffledPlaylistForDuration(opts: BuildShuffledPlaylistOptions): ShuffledPlaylistResult;

/**
 * Shared Progress Engine for Video Jobs
 * Unified types and helpers for single-cut, multi-cut, and merge operations
 */
export type VideoJobMode = 'single-cut' | 'multi-cut' | 'merge';
export interface BaseVideoProgress {
    mode: VideoJobMode;
    requestId?: string;
    percent?: number;
    timeSec?: number;
    totalDurationSec?: number;
    speedX?: number | null;
    etaSec?: number | null;
}
export interface SingleCutProgress extends BaseVideoProgress {
    mode: 'single-cut';
    currentSegment?: number;
    totalSegments?: number;
}
export interface MultiCutProgress extends BaseVideoProgress {
    mode: 'multi-cut';
    currentFileIndex?: number;
    totalFiles?: number;
    currentFilePercent?: number;
    currentFileSegment?: number;
    currentFileTotalSegments?: number;
    currentFileSpeedX?: number | null;
    currentFileEtaSec?: number | null;
    overallPercent?: number;
    currentFilePath?: string;
    error?: string;
    completed?: boolean;
    message?: string;
}
export interface MergeProgress extends BaseVideoProgress {
    mode: 'merge';
    stage?: 'probe' | 'build-list' | 'concat' | 'cut' | 'merge' | 'finalizing';
    batchIndex?: number;
    totalBatches?: number;
    currentJob?: number;
    totalJobs?: number;
    currentFile?: string;
    message?: string;
    completed?: boolean;
    error?: string;
}
export type VideoProgressPayload = SingleCutProgress | MultiCutProgress | MergeProgress;
/**
 * Safe number conversion with fallback
 */
export declare function safeNumber(v: any, fallback?: number): number;
/**
 * Build SingleCutProgress with safe defaults
 */
export declare function buildSingleCutProgress(partial: Partial<SingleCutProgress>): SingleCutProgress;
/**
 * Build MultiCutProgress with safe defaults
 */
export declare function buildMultiCutProgress(partial: Partial<MultiCutProgress>): MultiCutProgress;
/**
 * Build MergeProgress with safe defaults
 */
export declare function buildMergeProgress(partial: Partial<MergeProgress>): MergeProgress;

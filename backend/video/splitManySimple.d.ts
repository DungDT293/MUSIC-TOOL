import { type MultiCutProgress } from './videoProgress';
export interface SplitManySimpleRequest {
    inputFiles?: string[];
    inputPaths?: string[];
    outputRootDir: string;
    outputBaseDir?: string;
    segmentLengthSec: number;
    format?: 'mp4' | 'mkv';
    requestId?: string;
    normalizeOutput?: boolean;
}
export interface SplitManySimpleResult {
    requestId: string;
    success: boolean;
    totalFiles: number;
    successCount: number;
    failCount: number;
    elapsedMs: number;
    avgSpeed: number;
    results: Array<{
        inputPath: string;
        outputDir: string;
        segmentCount: number;
        success: boolean;
        error?: string;
    }>;
}
type SplitManySimpleProgress = MultiCutProgress;
/**
 * Cắt nhiều video tuần tự dựa trên engine single-cut.
 */
export declare function splitManyVideosSimple(req: SplitManySimpleRequest, onProgress?: (progress: SplitManySimpleProgress) => void, options?: {
    signal?: AbortSignal;
}): Promise<SplitManySimpleResult>;
export declare const splitMultipleVideosSimple: typeof splitManyVideosSimple;
export {};

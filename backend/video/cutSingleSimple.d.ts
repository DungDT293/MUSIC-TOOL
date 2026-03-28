/**
 * Cut single video into segments using FFmpeg segment filter
 * SIMPLE, WORKING VERSION - DO NOT COMPLICATE
 */
import { type SingleCutProgress } from './videoProgress';
export interface CutSingleSimpleRequest {
    inputPath: string;
    outputDir: string;
    segmentLengthSec: number;
    format?: 'mp4' | 'mkv';
    requestId?: string;
    normalizeOutput?: boolean;
}
export interface CutSingleSimpleResult {
    requestId: string;
    outputFiles: string[];
    segmentCount: number;
    elapsedMs: number;
    avgSpeed: number;
    success: boolean;
    error?: string;
}
export declare function cutVideoIntoSegmentsSimple(params: CutSingleSimpleRequest, onProgress?: (progress: SingleCutProgress) => void, options?: {
    signal?: AbortSignal;
}): Promise<CutSingleSimpleResult>;

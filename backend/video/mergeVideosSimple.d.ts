import { type MergeProgress } from './videoProgress';
export interface MergeVideosSimpleRequest {
    inputFiles: string[];
    outputDir: string;
    outputFileName: string;
    shuffle?: boolean;
    mute?: boolean;
    targetDurationSec?: number | null;
    mergeCount?: number;
    repeatCount?: number;
    requestId?: string;
    forceReencode?: boolean;
    /** Danh sách path video ưu tiên (thường nằm ở đầu inputFiles). Dùng để không bị loop lại khi targetDuration > tổng input. */
    priorityPaths?: string[];
}
export interface MergeVideosSimpleResult {
    requestId: string;
    outputPaths: string[];
    outputPath?: string;
    totalDurationSec: number;
    success: boolean;
    error?: string;
    avgSpeed?: number;
    elapsedMs?: number;
}
/**
 * Main merge function - Rebuilt for maximum speed
 */
export declare function mergeVideosSimple(req: MergeVideosSimpleRequest, onProgress?: (progress: MergeProgress) => void): Promise<MergeVideosSimpleResult>;

import type { FinalExportDonePayload, FinalExportErrorPayload, FinalExportProgressPayload, FinalExportRequestPayload, FinalExportScanResult } from '../../shared/videoFinalExportChannels';
interface FinalExportEmitter {
    progress: (payload: FinalExportProgressPayload) => void;
    done: (payload: FinalExportDonePayload) => void;
    error: (payload: FinalExportErrorPayload) => void;
}
export interface AudioSourceItem {
    path: string;
    durationSec: number;
}
export interface VideoClipItem {
    path: string;
    durationSec: number;
    sizeBytes?: number | null;
}
export interface ExportJob {
    jobIndex: number;
    audio: AudioSourceItem;
    outputPath: string;
    outputFileName: string;
    customOutputName?: string;
    tracklistText?: string;
}
export interface ExportPlan {
    jobs: ExportJob[];
    totalJobs: number;
    totalAudioDurationSec: number;
    totalVideoDurationSec: number;
    /** Toàn bộ pool video (không phân loại ưu tiên) */
    videoClips: VideoClipItem[];
    /** Clip video ưu tiên (tùy chọn) – sẽ luôn xuất hiện đầu video trước khi loop các clip còn lại */
    priorityVideoClips?: VideoClipItem[];
}
/**
 * PHASE 4: Plan final export - tạo ExportPlan từ audio/video sources
 *
 * - Probe audio/video chỉ 1 lần ở đây
 * - KHÔNG chạy FFmpeg trong planner
 * - Mỗi audio = 1 job riêng
 */
export declare function planFinalExport(audioSource: FinalExportRequestPayload['audioSource'], videoSource: FinalExportRequestPayload['videoSource'], outputFolder: string, baseOutputFilename: string, outputNames?: string[], priorityVideoSource?: FinalExportRequestPayload['priorityVideoSource']): Promise<ExportPlan>;
/**
 * PHASE 5: Execute final export - chạy từng job trong ExportPlan
 *
 * - Mỗi job dùng TOÀN BỘ videoClips pool (không chia subset)
 * - Audio codec check: AAC/MP3 → copy, WAV/PCM → encode aac
 * - Progress: percentJob + percentTotal
 * - KHÔNG concat audio lại
 */
export declare function executeFinalExport(plan: ExportPlan, requestId: string, emitter: FinalExportEmitter, shuffle?: boolean, forceReencode?: boolean, normalizeAudio?: boolean, tracklistAuto?: boolean, subtitle?: FinalExportRequestPayload['subtitle']): Promise<void>;
export type FinalExportJobRequest = FinalExportRequestPayload;
export declare function scanAudioSource(payload: {
    requestId: string;
    audioSource: FinalExportRequestPayload['audioSource'];
}): Promise<FinalExportScanResult>;
export declare function scanVideoSource(payload: {
    requestId: string;
    videoSource: FinalExportRequestPayload['videoSource'];
}): Promise<FinalExportScanResult>;
export declare function exportFinalVideo(request: FinalExportJobRequest, emitter: FinalExportEmitter): Promise<void>;
export {};

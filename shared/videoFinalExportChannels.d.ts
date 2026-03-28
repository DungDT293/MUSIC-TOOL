export declare const VIDEO_FINAL_EXPORT_REQUEST = "video:final-export:request";
export declare const VIDEO_FINAL_EXPORT_PROGRESS = "video:final-export:progress";
export declare const VIDEO_FINAL_EXPORT_DONE = "video:final-export:done";
export declare const VIDEO_FINAL_EXPORT_ERROR = "video:final-export:error";
export declare const VIDEO_FINAL_EXPORT_SCAN_AUDIO = "video:final-export:scan-audio";
export declare const VIDEO_FINAL_EXPORT_SCAN_VIDEO = "video:final-export:scan-video";
export interface FinalExportSource {
    type: 'file' | 'folder' | 'files';
    path: string;
    paths?: string[];
}
export interface SubtitleOptions {
    enabled: boolean;
    text: string;
    autoLyrics?: boolean;
    useWhisper?: boolean;
    whisperLanguage?: string;
    subtitleStyle?: 'simple' | 'karaoke' | 'word-by-word' | 'dynamic';
    subtitleFormat?: 'srt' | 'ass';
    position?: 'top' | 'bottom' | 'center';
    fontSize?: number;
    fontColor?: string;
    subtitleFile?: string;
    highlightColor?: string;
    backgroundColor?: string;
    backgroundOpacity?: number;
    fontFamily?: string;
    x?: number;
    y?: number;
}
export interface FinalExportRequestPayload {
    requestId: string;
    audioSource: FinalExportSource;
    videoSource: FinalExportSource;
    /** Nguồn video ưu tiên (tùy chọn) – các clip trong nguồn này sẽ được ưu tiên xuất hiện đầu video trước khi loop các clip khác */
    priorityVideoSource?: FinalExportSource;
    outputFolder: string;
    outputFilename: string;
    shuffle?: boolean;
    outputNames?: string[];
    tracklists?: string[];
    tracklistAuto?: boolean;
    forceReencode?: boolean;
    normalizeAudio?: boolean;
    subtitle?: SubtitleOptions;
}
export interface FinalExportProgressPayload {
    requestId: string;
    percent: number;
    timeSec?: number;
    totalDurationSec?: number;
    speedX?: number;
    etaSec?: number;
    status?: string;
    stage?: 'scan-audio' | 'scan-video' | 'prepare-audio' | 'prepare-video' | 'export' | 'finishing';
    audioFileCount?: number;
    videoFileCount?: number;
    usedVideoCount?: number;
    concatVideoDurationSec?: number;
    currentIndex?: number;
    totalOutputs?: number;
    currentAudioPath?: string;
    currentOutputFilename?: string;
}
export interface FinalExportDonePayload {
    requestId: string;
    outputs: {
        audioFile: string;
        videoFile: string;
        outputFile?: string;
        durationSec: number;
        tracklistFile?: string;
    }[];
}
export interface FinalExportErrorPayload {
    requestId: string;
    error: string;
    message?: string;
    currentIndex?: number;
    currentAudioPath?: string;
}
export interface FinalExportScanItem {
    path: string;
    durationSec: number;
    codecName?: string | null;
}
export interface FinalExportScanResult {
    requestId: string;
    kind: 'audio' | 'video';
    fileCount: number;
    totalDurationSec: number;
    items: FinalExportScanItem[];
}

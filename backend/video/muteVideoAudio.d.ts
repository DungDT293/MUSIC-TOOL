export interface MuteVideoAudioRequest {
    inputFiles: string[];
    outputDir: string;
    requestId?: string;
}
export interface MuteVideoAudioResult {
    requestId: string;
    outputPaths: string[];
    success: boolean;
    error?: string;
    processed: number;
    failed: number;
}
interface MuteVideoAudioProgressPayload {
    requestId?: string;
    currentFile?: string;
    currentIndex?: number;
    totalFiles?: number;
    percent?: number;
    message?: string;
    error?: string;
}
export declare function muteVideoAudio(req: MuteVideoAudioRequest, onProgress?: (progress: MuteVideoAudioProgressPayload) => void): Promise<MuteVideoAudioResult>;
export {};

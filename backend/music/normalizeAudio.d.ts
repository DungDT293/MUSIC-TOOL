/**
 * Normalize Audio Bitrate
 * Chuẩn hóa bitrate của các file audio về cùng một giá trị
 */
export interface NormalizeAudioRequest {
    files?: string[];
    folder?: string;
    targetBitrate: number;
    outputFormat?: 'mp3' | 'aac' | 'keep';
    backupOriginal?: boolean;
    outputFolder?: string;
}
export interface NormalizeAudioProgress {
    currentFile: string;
    currentIndex: number;
    totalFiles: number;
    percent: number;
    status: 'processing' | 'completed' | 'error' | 'cancelled';
    error?: string;
    etaSeconds?: number;
}
export interface NormalizeAudioResult {
    success: boolean;
    processed: number;
    failed: number;
    errors: Array<{
        file: string;
        error: string;
    }>;
    outputFiles: string[];
}
export declare function cancelNormalizeAudio(): void;
/**
 * Normalize audio files
 */
export declare function normalizeAudio(request: NormalizeAudioRequest, onProgress?: (progress: NormalizeAudioProgress) => void): Promise<NormalizeAudioResult>;

export interface ScannedTrack {
    id: string;
    path: string;
    fileName: string;
    folderType: 'priority' | 'random';
    duration: number;
    size: number;
    codec?: string;
    bitrate?: number;
}
export interface ScanSummary {
    priorityCount: number;
    randomCount: number;
    totalCount: number;
    priorityDuration: number;
    randomDuration: number;
    totalDuration: number;
}
export interface ScanMusicResult {
    tracks: ScannedTrack[];
    summary: ScanSummary;
    scannedAt?: number;
}
export interface ScanMusicPayload {
    priorityFolder: string | null;
    randomFolder: string | null;
}
export declare function scanMusicFolders(payload: ScanMusicPayload): Promise<ScanMusicResult>;

export interface ExportedTrackInfo {
    name: string;
    path: string;
    durationSec: number;
    startSec: number;
}
export interface ExportHistoryEntry {
    id: string;
    playlistId: string;
    playlistName: string;
    exportedAt: number;
    outputPath: string;
    tracks: ExportedTrackInfo[];
}
export declare function loadHistory(): ExportHistoryEntry[];
export declare function addHistoryEntry(entry: Omit<ExportHistoryEntry, 'id' | 'exportedAt'>): void;
export declare function getRecentHistory(): ExportHistoryEntry[];

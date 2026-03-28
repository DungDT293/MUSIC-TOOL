export interface ExportPlaylistRequest {
    playlistId: string;
    outputDir: string;
    fileName: string;
    format: 'mp3' | 'wav' | 'aac';
    bitrateKbps?: number;
    smoothTransitions?: boolean;
    crossfadeDurationSec?: number;
}
export interface ExportPlaylistResult {
    success: boolean;
    outputPath?: string;
    durationSec?: number;
    error?: string;
}
export interface CrossfadeTrackIssue {
    trackPath: string;
    trackName: string;
    reason: string;
}
export interface CrossfadePlaylistCheckResult {
    playlistId: string;
    playlistName: string;
    issues: CrossfadeTrackIssue[];
}
export interface ValidatePlaylistsForCrossfadeRequest {
    playlistIds: string[];
    crossfadeDurationSec?: number;
}
export interface ValidatePlaylistsForCrossfadeResult {
    results: CrossfadePlaylistCheckResult[];
    totalChecked: number;
    totalWithIssues: number;
}
/**
 * Export playlist thành một file audio duy nhất
 */
export declare function exportPlaylistToFile(req: ExportPlaylistRequest, progressEmitter?: (progress: {
    playlistId: string;
    outputPath: string;
    currentSec: number;
    totalSec: number;
    percent: number;
}) => void): Promise<ExportPlaylistResult>;
/**
 * Kiểm tra các track trong playlist có phù hợp để chạy crossfade không.
 * - Decode thử 2s đầu của từng file bằng FFmpeg: nếu FFmpeg lỗi → mark là track lỗi.
 * - KHÔNG xuất file, chỉ trả về danh sách issues để UI hiển thị.
 */
export declare function validatePlaylistForCrossfade(playlistId: string): Promise<CrossfadePlaylistCheckResult>;
/**
 * Validate nhiều playlist cùng lúc cho crossfade
 */
export declare function validatePlaylistsForCrossfade(req: ValidatePlaylistsForCrossfadeRequest): Promise<ValidatePlaylistsForCrossfadeResult>;

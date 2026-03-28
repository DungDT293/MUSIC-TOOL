/**
 * Phát hiện tracklist từ mô tả video YouTube
 */
export interface TracklistItem {
    index: number;
    time?: string;
    title: string;
    artist?: string;
    rawLine: string;
}
export interface DetectedTracklist {
    items: TracklistItem[];
    format: 'numbered' | 'timestamped' | 'simple' | 'unknown';
}
/**
 * Phát hiện tracklist từ description
 * Hỗ trợ các format:
 * - Số thứ tự: "1. Song Name - Artist", "01. Song Name"
 * - Timestamp: "0:00 Song Name - Artist", "00:00 Song Name"
 * - Danh sách: "- Song Name - Artist", "• Song Name"
 */
export declare function detectTracklist(description: string): DetectedTracklist | null;
/**
 * Format tracklist thành text để lưu vào file
 */
export declare function formatTracklistForFile(tracklist: DetectedTracklist): string;

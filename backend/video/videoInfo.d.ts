/**
 * Video Info - Probe video file để lấy metadata cơ bản
 */
export interface VideoFileInfo {
    filePath: string;
    durationSec: number | null;
    width: number | null;
    height: number | null;
    sizeBytes: number | null;
}
/**
 * Probe video file để lấy duration, width, height
 */
export declare function getVideoFileInfo(filePath: string): Promise<VideoFileInfo>;

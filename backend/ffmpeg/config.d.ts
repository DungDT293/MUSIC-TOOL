/**
 * FFmpeg Config - Lấy đường dẫn đến ffmpeg và ffprobe
 */
export interface FfmpegPaths {
    ffmpeg: string;
    ffprobe: string;
}
/**
 * Lấy đường dẫn đến ffmpeg và ffprobe
 * - Ưu tiên: environment variables FFMPEG_PATH và FFPROBE_PATH
 * - DEV mode: tìm trong <project root>/bin/
 * - PROD mode: tìm trong <resourcesPath>/bin/
 */
export declare function getFfmpegPaths(): FfmpegPaths;

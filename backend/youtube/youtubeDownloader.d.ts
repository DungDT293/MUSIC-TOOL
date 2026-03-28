import { EventEmitter } from 'events';
import { DownloadVideoRequest, VideoInfo, Quality } from './types';
export declare class YouTubeDownloader extends EventEmitter {
    private ytDlpPath;
    private currentProcess;
    constructor();
    /**
     * Verify yt-dlp is available
     */
    verify(): Promise<boolean>;
    /**
     * Get yt-dlp version
     */
    getVersion(): Promise<string>;
    /**
     * Check if URL is valid YouTube URL
     */
    isValidYouTubeUrl(url: string): boolean;
    /**
     * Detect URL type
     */
    detectUrlType(url: string): 'video' | 'channel' | 'playlist' | 'unknown';
    /**
     * Get quality format string for yt-dlp
     */
    getQualityFormat(quality: Quality): string;
    /**
     * Check if yt-dlp executable exists (for backward compatibility)
     */
    checkYtDlpAvailable(): Promise<boolean>;
    /**
     * Get video information without downloading
     * Thử web client trước (có format cao hơn), nếu fail thì fallback về android
     */
    getVideoInfo(url: string): Promise<VideoInfo>;
    /**
     * Helper: Get video info với client cụ thể
     */
    private getVideoInfoWithClient;
    /**
     * Validate download request (including disk space)
     */
    private validateDownloadRequest;
    /**
     * Cancel ongoing download
     */
    cancelDownload(): void;
    /**
     * Parse download progress from yt-dlp output
     */
    private parseDownloadProgress;
    /**
     * Download single video với tự động thử các browser nếu cookies fail
     */
    downloadVideo(request: DownloadVideoRequest): Promise<string>;
    /**
     * Helper: Download video với args cụ thể
     */
    private downloadVideoWithArgs;
    /**
     * Internal single-attempt downloader (extracted for retry wrapper)
     */
    private downloadVideoWithArgsOnce;
    /**
     * Get list of videos from channel or playlist
     */
    getChannelVideos(url: string, limit?: number): Promise<VideoInfo[]>;
    /**
     * Get channel info - FIXED VERSION (extract from URL + first video)
     */
    getChannelInfo(url: string): Promise<{
        channelName: string;
        channelId: string;
        videoCount: number;
    }>;
    /**
     * Estimate total download size for channel
     */
    estimateChannelSize(url: string, quality: Quality, limit?: number): Promise<{
        videoCount: number;
        estimatedSizeBytes: number;
        estimatedSizeFormatted: string;
        avgSizePerVideo: number;
    }>;
    /**
     * Download entire channel or playlist
     */
    downloadChannel(url: string, outputDir: string, quality: Quality, options?: {
        downloadSubtitles?: boolean;
        downloadThumbnail?: boolean;
        limit?: number;
        continueOnError?: boolean;
        audioOnly?: boolean;
        audioFormat?: 'mp3' | 'wav';
    }): Promise<{
        downloaded: string[];
        failed: Array<{
            video: VideoInfo;
            error: string;
        }>;
        channelFolder?: string;
    }>;
    /**
     * Download video to specific folders (videos & thumbnails separate)
     */
    private downloadVideoToFolder;
    /**
     * Download channel with concurrent downloads (faster but more complex)
     */
    downloadChannelConcurrent(url: string, outputDir: string, quality: Quality, options?: {
        downloadSubtitles?: boolean;
        downloadThumbnail?: boolean;
        limit?: number;
        concurrency?: number;
        continueOnError?: boolean;
        audioOnly?: boolean;
        audioFormat?: 'mp3' | 'wav';
    }): Promise<{
        downloaded: string[];
        failed: Array<{
            video: VideoInfo;
            error: string;
        }>;
    }>;
    /**
     * Upscale video to 4K using FFmpeg (placeholder - will be implemented later)
     */
    upscaleTo4K(_inputPath: string, _outputPath: string, _onProgress?: (percent: number) => void): Promise<void>;
}

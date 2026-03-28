export interface DownloadVideoRequest {
    url: string;
    outputDir: string;
    quality: Quality;
    downloadSubtitles: boolean;
    downloadTracklist?: boolean;
    downloadThumbnail: boolean;
    upscaleTo4K?: boolean;
    audioOnly?: boolean;
    audioFormat?: 'mp3' | 'wav';
    useCookies?: boolean;
    cookiesFile?: string;
    cookiesFromBrowser?: 'chrome' | 'firefox' | 'edge' | 'opera' | 'safari';
}
export type Quality = 'best' | '2160' | '1440' | '1080' | '720' | '480';
export interface VideoInfo {
    id: string;
    title: string;
    duration: number;
    thumbnail: string;
    description: string;
    uploader: string;
    uploadDate: string;
    viewCount: number;
    likeCount: number;
    width: number;
    height: number;
    formats: VideoFormat[];
    hasSubtitles?: boolean;
    subtitles?: Array<{
        lang: string;
        langCode: string;
    }>;
}
export interface VideoFormat {
    formatId: string;
    ext: string;
    resolution: string;
    fps: number;
    filesize: number;
    vcodec: string;
    acodec: string;
}
export interface DownloadProgress {
    type: 'info' | 'download' | 'postprocess' | 'complete' | 'error';
    videoId?: string;
    title?: string;
    percent?: number;
    downloadedBytes?: number;
    totalBytes?: number;
    speed?: string;
    eta?: string;
    message?: string;
}
export interface ChannelInfo {
    channelId: string;
    channelName: string;
    channelUrl: string;
    videoCount: number;
    videos: VideoInfo[];
}
export interface BatchDownloadProgress {
    currentVideoIndex: number;
    totalVideos: number;
    currentVideoTitle: string;
    currentVideoPercent: number;
    completedVideos: number;
    failedVideos: number;
    overallPercent: number;
    errors: Array<{
        videoTitle: string;
        error: string;
    }>;
}

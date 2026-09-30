export interface DownloadVideoRequest {
  url: string;                  // YouTube URL
  outputDir: string;            // Output folder
  quality: Quality;             // Quality preference
  downloadSubtitles: boolean;   // Download subs (legacy - sẽ được dùng cho tracklist)
  downloadTracklist?: boolean;  // Download tracklist nếu có (mới)
  downloadThumbnail: boolean;   // Download thumbnail
  upscaleTo4K?: boolean;         // Optional: upscale to 4K if < 4K
  audioOnly?: boolean;
  audioFormat?: 'mp3' | 'wav';
  useCookies?: boolean;         // Use cookies from browser (Chrome/Firefox)
  cookiesFile?: string;         // Path to cookies file (Netscape format)
  cookiesFromBrowser?: 'chrome' | 'firefox' | 'edge' | 'opera' | 'safari' | 'brave' | 'chromium' | 'vivaldi'; // Auto extract from browser (sử dụng Python extractor)
  createChannelFolder?: boolean; // Tạo folder theo tên kênh (default: true, giống tool Python)
}

export interface SpotifyDownloadTrack {
  id: string;
  name: string;
  artists: string[];
  albumName?: string;
  durationMs?: number;
}

export interface SpotifyYouTubeDownloadRequest {
  tracks: SpotifyDownloadTrack[];
  outputDir: string;
  audioFormat?: 'mp3' | 'wav';
  createZip?: boolean;
  cookiesFile?: string;
  cookiesFromBrowser?: 'auto' | 'chrome' | 'firefox' | 'edge' | 'opera' | 'safari' | 'brave' | 'chromium' | 'vivaldi';
}

export interface SpotifyYouTubeDownloadFailure {
  track: SpotifyDownloadTrack;
  error: string;
}

export interface SpotifyYouTubeDownloadResult {
  downloaded: string[];
  failed: SpotifyYouTubeDownloadFailure[];
  zipPath?: string;
  cancelled?: boolean;
}

export type Quality = 'best' | '4320' | '2160' | '1440' | '1080' | '720' | '480' | '360';

export interface VideoInfo {
  id: string;
  title: string;
  duration: number;             // seconds
  thumbnail: string;            // URL
  description: string;
  uploader: string;
  uploadDate: string;
  viewCount: number;
  likeCount: number;
  width: number;
  height: number;
  formats: VideoFormat[];
  hasSubtitles?: boolean;       // Video có phụ đề không
  subtitles?: Array<{          // Danh sách phụ đề có sẵn
    lang: string;
    langCode: string;
  }>;
}

export interface VideoFormat {
  formatId: string;
  ext: string;
  resolution: string;           // "1920x1080"
  fps: number;
  filesize: number;             // bytes
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
  speed?: string;               // "1.23MiB/s"
  eta?: string;                 // "00:42"
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
  errors: Array<{ videoTitle: string; error: string }>;
}



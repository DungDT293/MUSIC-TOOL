import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import { EventEmitter } from 'events';
// import { getFfmpegPaths } from '../ffmpeg/config'; // Reserved for future upscale feature
import {
  DownloadVideoRequest,
  VideoInfo,
  VideoFormat,
  DownloadProgress,
  BatchDownloadProgress,
  Quality
} from './types';
import { detectTracklist, formatTracklistForFile } from './tracklistDetector';
import { SafeFolderManager } from './SafeFolderManager';
import { extractCookiesFromBrowsers } from './browserCookieService';
import type { SupportedBrowser } from './browserCookieService';
import { FacebookScraper, FacebookReelInfo } from './facebookScraper';
import { CookieManager } from './cookieManager';

type CookieBrowserSelection = SupportedBrowser | 'auto';

const DEFAULT_COOKIE_BROWSERS: SupportedBrowser[] = [
  'chrome',
  'edge',
  'firefox',
  'opera',
  'brave',
  'chromium',
  'vivaldi',
  'safari',
];

export class YouTubeDownloader extends EventEmitter {

  private ytDlpPath: string;
  // private ffmpegPath: string; // Reserved for future upscale feature
  // Fix P0-07: dùng Map<jobId, ChildProcess> thay vì single currentProcess
  // để hỗ trợ concurrent downloads và cancel đúng process
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private folderManager: SafeFolderManager | null = null;
  private facebookScraper: FacebookScraper;
  private cookieManager: CookieManager;

  constructor() {
    super();

    // Determine yt-dlp path based on platform and environment
    // Use same logic as FFmpeg config
    const platform = process.platform;

    let binDir: string;
    let isPackaged = false;

    try {
      // Try to get isPackaged from Electron app (only available in main process)
      const { app } = require('electron');
      isPackaged = app.isPackaged;
    } catch {
      // If not in main process or electron not loaded, use fallback
      const resourcesPath = (process as any).resourcesPath;
      if (resourcesPath && typeof resourcesPath === 'string') {
        // In DEV, resourcesPath points to node_modules/electron/dist/resources
        // In PROD, resourcesPath points to app resources
        const isNodeModulesPath = resourcesPath.includes('node_modules') && resourcesPath.includes('electron');
        isPackaged = !isNodeModulesPath;
      }
    }

    if (isPackaged) {
      // Production: yt-dlp is in resources/bin (extraResources)
      const resourcesPath = (process as any).resourcesPath || process.resourcesPath || path.join(process.execPath, '..', 'resources');
      binDir = path.join(resourcesPath, 'bin');
    } else {
      // Development: yt-dlp is in bin/ at project root
      binDir = path.join(process.cwd(), 'bin');
    }

    if (platform === 'win32') {
      this.ytDlpPath = path.join(binDir, 'yt-dlp.exe');
    } else {
      this.ytDlpPath = path.join(binDir, 'yt-dlp');
    }

    console.log(`[YouTubeDownloader] yt-dlp path: ${this.ytDlpPath}`);
    console.log(`[YouTubeDownloader] isPackaged: ${isPackaged}, binDir: ${binDir}, cwd: ${process.cwd()}`);

    // Verify yt-dlp exists on startup
    // Bug #33 fix: guard against non-Error throws in catch (strings, null, etc.)
    this.verify().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[YouTubeDownloader] WARNING: yt-dlp not found at startup: ${msg}`);
    });

    // Initialize FacebookScraper and CookieManager
    this.facebookScraper = new FacebookScraper();
    this.cookieManager = new CookieManager();

    // Auto-load Facebook cookies from CookieManager if available
    if (this.cookieManager.hasCookies('facebook')) {
      const cookieStr = this.cookieManager.getCookieString('facebook');
      this.facebookScraper.setCookieString(cookieStr);
      console.log('[YouTubeDownloader] Auto-loaded Facebook cookies from CookieManager');
    }

    // Get FFmpeg path (reserved for future upscale feature)
    // const ffmpegPaths = getFfmpegPaths();
    // this.ffmpegPath = ffmpegPaths.ffmpeg;
  }

  /**
   * Get CookieManager instance (for IPC handlers)
   */
  getCookieManager(): CookieManager {
    return this.cookieManager;
  }

  /**
   * Get FacebookScraper instance
   */
  getFacebookScraper(): FacebookScraper {
    return this.facebookScraper;
  }

  /**
   * Refresh Facebook cookies from CookieManager (after import)
   */
  refreshFacebookCookies(): void {
    if (this.cookieManager.hasCookies('facebook')) {
      const cookieStr = this.cookieManager.getCookieString('facebook');
      this.facebookScraper.setCookieString(cookieStr);
      console.log('[YouTubeDownloader] Refreshed Facebook cookies');
    }
  }

  private async resolveCookieArgsForYtDlp(
    platform: string,
    request?: { cookiesFile?: string; cookiesFromBrowser?: CookieBrowserSelection }
  ): Promise<{ args: string[]; cleanup: () => void; source?: string }> {
    if (request?.cookiesFile) {
      console.log(`[YouTubeDownloader] Using explicit cookies file: ${request.cookiesFile}`);
      return { args: ['--cookies', request.cookiesFile], cleanup: () => {}, source: request.cookiesFile };
    }

    if (request?.cookiesFromBrowser) {
      const browsers = request.cookiesFromBrowser === 'auto'
        ? DEFAULT_COOKIE_BROWSERS
        : [request.cookiesFromBrowser];
      let tempCookieFile: string | null = null;

      try {
        const cookieResult = await extractCookiesFromBrowsers(browsers, `${platform}.com`);
        if (cookieResult.success && cookieResult.cookie_file) {
          tempCookieFile = cookieResult.cookie_file;
          console.log(`[YouTubeDownloader] Using cookies extracted from ${cookieResult.browser}`);
          return {
            args: ['--cookies', cookieResult.cookie_file],
            source: cookieResult.browser,
            cleanup: () => {
              if (!tempCookieFile) return;
              try {
                if (fsSync.existsSync(tempCookieFile)) fsSync.unlinkSync(tempCookieFile);
              } catch (_) {}
              tempCookieFile = null;
            },
          };
        }
      } catch (extractError: any) {
        console.warn(`[YouTubeDownloader] Cookie extraction failed (${extractError?.message}), falling back to saved cookies if available`);
      }
    }

    if (this.cookieManager.hasCookies(platform)) {
      const cookieFile = this.cookieManager.writeCookiesFileForYtDlp(platform);
      if (cookieFile) {
        console.log(`[YouTubeDownloader] Using saved ${platform} cookies from CookieManager: ${cookieFile}`);
        return { args: ['--cookies', cookieFile], cleanup: () => {}, source: 'cookie-manager' };
      }
    }

    return { args: [], cleanup: () => {} };
  }

  private getCookiePlatformForUrl(url: string): 'youtube' | 'tiktok' | 'instagram' | null {
    const platform = CookieManager.detectPlatformFromUrl(url);
    if (platform === 'youtube' || platform === 'tiktok' || platform === 'instagram') {
      return platform;
    }
    return null;
  }

  private normalizeYtDlpMessage(message: string): string {
    return message.replace(/\uFFFD/g, "'").replace(/\r\n/g, '\n').trim();
  }

  private isExpiredCookieError(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('account cookies are no longer valid') ||
      lower.includes('cookies are no longer valid') ||
      lower.includes('likely been rotated in the browser');
  }

  private isBotVerificationError(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('sign in to confirm') ||
      lower.includes('not a bot') ||
      lower.includes('use --cookies-from-browser') ||
      lower.includes('use --cookies for the authentication');
  }

  private isUnsupportedCookieClientError(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('does not support cookies') ||
      lower.includes('skipping client "android"');
  }

  private isChallengeRuntimeError(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('challenge solving failed') ||
      lower.includes('supported javascript runtime') ||
      lower.includes('some formats may be missing');
  }

  private formatYtDlpFailure(stderr: string, fallback: string): string {
    const normalized = this.normalizeYtDlpMessage(stderr || fallback);

    if (this.isExpiredCookieError(normalized)) {
      return [
        'Cookies YouTube đã hết hạn hoặc đã bị trình duyệt xoay vòng bảo mật.',
        '',
        'Cách sửa:',
        '1. Mở Cookie Manager trong tab YouTube Downloader.',
        '2. Xóa cookies YouTube cũ.',
        '3. Đăng nhập YouTube trên trình duyệt, export lại cookies bằng J2Team Cookies.',
        '4. Import lại file cookies mới rồi thử lại.',
      ].join('\n');
    }

    if (this.isBotVerificationError(normalized)) {
      return [
        'YouTube yêu cầu xác minh bạn không phải bot.',
        '',
        'Cách sửa:',
        '1. Đăng nhập YouTube trong trình duyệt.',
        '2. Bật "Sử dụng cookies từ trình duyệt" hoặc import cookies YouTube mới trong Cookie Manager.',
        '3. Nếu vừa export cookies mà vẫn lỗi, hãy đóng trình duyệt rồi export lại cookies mới.',
        '',
        `Chi tiết: ${normalized.substring(0, 500)}`,
      ].join('\n');
    }

    if (this.isUnsupportedCookieClientError(normalized)) {
      return [
        'Cookies YouTube không tương thích với client tải hiện tại.',
        '',
        'App đã bỏ fallback android cho cookies. Hãy chạy lại bản mới nhất và thử lại.',
        '',
        `Chi tiết: ${normalized.substring(0, 500)}`,
      ].join('\n');
    }

    if (this.isChallengeRuntimeError(normalized)) {
      return [
        'yt-dlp bị lỗi giải challenge của YouTube.',
        '',
        'Cách xử lý:',
        '1. Bấm "Cập nhật yt-dlp" trong tab YouTube Downloader.',
        '2. Nếu đang dùng cookies, export/import lại cookies YouTube mới.',
        '3. Thử lại với client ổn định hơn bằng cách đóng app và mở lại bản portable mới.',
        '',
        `Chi tiết: ${normalized.substring(0, 500)}`,
      ].join('\n');
    }

    return normalized || fallback;
  }

  /**
   * Check if a URL is a Facebook URL that needs scraper
   */
  private isFacebookUrl(url: string): boolean {
    return url.includes('facebook.com') || url.includes('fb.watch');
  }

  /**
   * Download a single Facebook reel/video using direct scraper (no yt-dlp)
   */
  private async downloadFacebookVideo(
    reelUrl: string,
    outputDir: string,
    options: { createChannelFolder?: boolean; audioOnly?: boolean; audioFormat?: string } = {}
  ): Promise<string> {
    if (!this.facebookScraper.hasCookies()) {
      throw new Error('Chưa import cookies Facebook. Vui lòng vào Quản lý Cookies để import.');
    }

    // Get video info from Facebook
    const reelInfo = await this.facebookScraper.getReelVideoUrl(reelUrl);
    const videoUrl = reelInfo.videoUrlHD || reelInfo.videoUrl;

    if (!videoUrl) {
      throw new Error(`Không tìm thấy URL video cho reel ${reelInfo.id}`);
    }

    // Build output filename
    const sanitizedTitle = FacebookScraper.sanitizeFilename(
      reelInfo.title || `Facebook_Reel_${reelInfo.id}`
    );
    const ext = options.audioOnly ? (options.audioFormat || 'mp3') : 'mp4';

    let outputPath: string;
    if (options.createChannelFolder !== false && reelInfo.uploader) {
      const uploaderFolder = FacebookScraper.sanitizeFilename(reelInfo.uploader);
      const folder = path.join(outputDir, uploaderFolder, 'videos');
      if (!fsSync.existsSync(folder)) {
        fsSync.mkdirSync(folder, { recursive: true });
      }
      outputPath = path.join(folder, `${sanitizedTitle}.${ext}`);
    } else {
      outputPath = path.join(outputDir, `${sanitizedTitle}.${ext}`);
    }

    // Avoid overwriting
    let finalPath = outputPath;
    let counter = 1;
    while (fsSync.existsSync(finalPath)) {
      const parsed = path.parse(outputPath);
      finalPath = path.join(parsed.dir, `${parsed.name} (${counter})${parsed.ext}`);
      counter++;
    }

    // Emit progress
    this.emit('progress', {
      type: 'download',
      videoId: reelInfo.id,
      title: reelInfo.title || `Reel ${reelInfo.id}`,
      percent: 0,
      message: `Đang tải: ${reelInfo.title || reelInfo.id}`,
    } as DownloadProgress);

    // Download directly from CDN
    await this.facebookScraper.downloadVideo(videoUrl, finalPath, (percent, downloaded, total) => {
      this.emit('progress', {
        type: 'download',
        videoId: reelInfo.id,
        title: reelInfo.title || `Reel ${reelInfo.id}`,
        percent,
        downloadedBytes: downloaded,
        totalBytes: total,
        message: `Đang tải: ${percent.toFixed(1)}%`,
      } as DownloadProgress);
    });

    // If audioOnly, convert to audio using ffmpeg
    if (options.audioOnly) {
      // For now, just return the video file — audio extraction can be added later
      console.log(`[YouTubeDownloader] Facebook video downloaded (audio extraction not implemented for direct download)`);
    }

    this.emit('progress', {
      type: 'complete',
      videoId: reelInfo.id,
      title: reelInfo.title || `Reel ${reelInfo.id}`,
      percent: 100,
      message: 'Hoàn thành!',
    } as DownloadProgress);

    return finalPath;
  }

  /**
   * Get channel videos for Facebook using scraper (bypass yt-dlp)
   */
  private async getFacebookChannelVideos(url: string): Promise<VideoInfo[]> {
    if (!this.facebookScraper.hasCookies()) {
      throw new Error('Chưa import cookies Facebook. Vui lòng vào Quản lý Cookies để import.');
    }

    const reelIds = await this.facebookScraper.getReelIds(url);

    return reelIds.map(id => ({
      id,
      title: `Facebook Reel ${id}`,
      duration: 0,
      thumbnail: '',
      description: '',
      uploader: '',
      uploadDate: '',
      viewCount: 0,
      likeCount: 0,
      width: 0,
      height: 0,
      formats: [] as VideoFormat[],
    }));
  }

  /**
   * Verify yt-dlp is available
   */
  async verify(): Promise<boolean> {
    try {
      await fs.access(this.ytDlpPath);

      // Test version
      const version = await this.getVersion();
      console.log(`[YouTubeDownloader] yt-dlp version: ${version}`);

      return true;
    } catch (error) {
      console.error('[YouTubeDownloader] yt-dlp not found:', error);
      return false;
    }
  }

  /**
   * Get yt-dlp version
   */
  async getVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(this.ytDlpPath, ['--version']);

      let output = '';

      process.stdout.on('data', (data) => {
        output += data.toString().trim();
      });

      process.stderr.on('data', (data) => {
        // Version might be in stderr
        const stderrOutput = data.toString().trim();
        if (stderrOutput && !output) {
          output = stderrOutput;
        }
      });

      process.on('close', (code) => {
        if (code === 0 || output) {
          resolve(output || 'unknown');
        } else {
          reject(new Error('Failed to get yt-dlp version'));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to spawn yt-dlp: ${error.message}`));
      });
    });
  }

  /**
   * Update yt-dlp to latest version
   */
  async updateYtDlp(): Promise<{ success: boolean; version?: string; message: string }> {
    return new Promise((resolve) => {
      const proc = spawn(this.ytDlpPath, ['-U']); // --no-update-to-nightly not supported in older versions
      let output = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { output += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', async (code) => {
        const combined = (output + stderr).trim();
        // Get new version after update
        let version: string | undefined;
        try { version = await this.getVersion(); } catch (_) {}
        if (code === 0 || combined.toLowerCase().includes('up-to-date') || combined.toLowerCase().includes('updated')) {
          resolve({
            success: true,
            version,
            message: combined || `yt-dlp updated successfully to ${version ?? 'latest'}`,
          });
        } else {
          resolve({
            success: false,
            version,
            message: combined || 'Update failed (unknown error)',
          });
        }
      });
      proc.on('error', (err) => {
        resolve({ success: false, message: `Failed to run yt-dlp update: ${err.message}` });
      });
    });
  }

  /**
   * Check if URL is valid YouTube / SoundCloud / TikTok / Facebook URL
   */
  isValidYouTubeUrl(url: string): boolean {
    const patterns = [
      // YouTube
      /^https?:\/\/(www\.)?youtube\.com\/watch\?v=.+/,           // Video
      /^https?:\/\/youtu\.be\/.+/,                                // Short URL
      /^https?:\/\/(www\.)?youtube\.com\/channel\/.+/,           // Channel
      /^https?:\/\/(www\.)?youtube\.com\/c\/.+/,                 // Custom channel
      /^https?:\/\/(www\.)?youtube\.com\/@.+/,                   // Handle
      /^https?:\/\/(www\.)?youtube\.com\/playlist\?list=.+/,     // Playlist
      /^https?:\/\/(www\.)?youtube\.com\/user\/.+/,              // User
      // SoundCloud
      /^https?:\/\/(www\.)?soundcloud\.com\/.+/,                 // SoundCloud track/set/artist
      // TikTok
      /^https?:\/\/(www\.)?tiktok\.com\/.+/,                     // TikTok video/user
      /^https?:\/\/vm\.tiktok\.com\/.+/,                         // TikTok short URL
      // Facebook (mọi dạng URL: reel, reels, watch, video, share, profile/reels, ...)
      /^https?:\/\/(www\.|m\.|web\.|l\.)?facebook\.com\/.+/,
      /^https?:\/\/fb\.watch\/.+/,
    ];

    return patterns.some(pattern => pattern.test(url));
  }

  /**
   * Detect URL type
   */
  detectUrlType(url: string): 'video' | 'channel' | 'playlist' | 'unknown' {
    // YouTube
    if (url.includes('/watch?v=') || url.includes('youtu.be/')) {
      return 'video';
    }
    if (url.includes('/channel/') || url.includes('/c/') || url.includes('/@') || url.includes('/user/')) {
      return 'channel';
    }
    if (url.includes('/playlist?list=')) {
      return 'playlist';
    }

    // SoundCloud
    if (url.includes('soundcloud.com/')) {
      // soundcloud.com/artist/sets/... = playlist, soundcloud.com/artist = channel, else = video
      if (url.includes('/sets/')) return 'playlist';
      const scPath = url.replace(/^https?:\/\/(www\.)?soundcloud\.com\//, '').split('?')[0];
      const segments = scPath.split('/').filter(Boolean);
      return segments.length === 1 ? 'channel' : 'video';
    }

    // TikTok
    if (url.includes('tiktok.com/')) {
      if (url.includes('/video/') || url.match(/\/t\/[A-Za-z0-9]+/)) return 'video';
      if (url.includes('/@')) return 'channel';
      return 'video'; // vm.tiktok.com short links
    }

    // Facebook
    if (url.includes('facebook.com/') || url.includes('fb.watch/')) {
      // Specific single reel/video URLs
      if (url.match(/facebook\.com\/reel\/\d+/)) return 'video';        // /reel/123456789
      if (url.includes('/share/r/') || url.includes('/share/v/')) return 'video';  // share links
      if (url.match(/facebook\.com\/.+\/videos\/\d+/)) return 'video';  // /username/videos/123
      if (url.includes('/watch/?v=') || url.includes('/watch?v=')) return 'video'; // /watch/?v=123
      if (url.includes('story.php')) return 'video';
      if (url.includes('fb.watch/')) return 'video';

      // Listing pages → treat as channel (yt-dlp will enumerate)
      if (url.match(/facebook\.com\/[^/]+\/reels\/?$/)) return 'channel';  // /username/reels/
      if (url.match(/facebook\.com\/[^/]+\/videos\/?$/)) return 'channel'; // /username/videos/
      if (url.match(/facebook\.com\/[^/]+\/?$/)) return 'channel';         // /username/ (profile)

      return 'video'; // fallback
    }

    return 'unknown';
  }

  /**
   * Get quality format string for yt-dlp - Nâng cấp với format IDs cụ thể và fallback chain chi tiết
   * Dựa trên best practices từ tool Python và yt-dlp documentation
   */
  getQualityFormat(quality: Quality): string {
    // Format selector strategy:
    // 1. Ưu tiên format IDs cụ thể (315=8K VP9, 271=4K VP9, 137=1080p H.264, etc.)
    // 2. Fallback về height-based selector
    // 3. Cuối cùng fallback về best available
    // Format: video+audio/bestvideo+bestaudio/best

    const formats: Record<Quality, string> = {
      // 8K (4320p): Ultra Ultra HD - Format IDs: 315 (VP9 8K), 313 (AV1 8K), 271 (VP9 4K fallback)
      // Tích hợp từ tool Python: "315+140/271+251/bestvideo[height>=4320]+bestaudio/best[height>=4320]/best"
      '4320': '315+140/313+140/271+251/271+140/248+251/bestvideo[height>=4320]+bestaudio/best[height>=4320]/best',

      // 4K (2160p): Ultra HD - Format IDs: 137+140 (H.264), 248+251 (VP9), 271+140 (VP9)
      // Tích hợp từ tool Python: "137+140/248+251/bestvideo[height>=2160]+bestaudio/best[height>=2160]/best"
      '2160': '137+140/248+251/271+140/bestvideo[height>=2160]+bestaudio/best[height>=2160]/best',

      // 2K (1440p): Quad HD - Format IDs: 271+140 (VP9), 248+251 (VP9)
      // Tích hợp từ tool Python: "271+140/248+251/bestvideo[height>=1440]+bestaudio/best[height>=1440]/best"
      '1440': '271+140/248+251/bestvideo[height>=1440]+bestaudio/best[height>=1440]/best',

      // 1080p: Full HD - Format IDs: 137+140 (H.264), 248+251 (VP9)
      // Tích hợp từ tool Python: "137+140/248+251/bestvideo[height>=1080]+bestaudio/best[height>=1080]/best"
      '1080': '137+140/248+251/bestvideo[height>=1080]+bestaudio/best[height>=1080]/best',

      // 720p: HD - Format IDs: 136+140 (H.264), 247+251 (VP9)
      // Tích hợp từ tool Python: "136+140/247+251/bestvideo[height>=720]+bestaudio/best[height>=720]/best"
      '720': '136+140/247+251/bestvideo[height>=720]+bestaudio/best[height>=720]/best',

      // 480p: SD - Format IDs: 135+140 (H.264), 244+251 (VP9)
      // Tích hợp từ tool Python: "135+140/244+251/bestvideo[height>=480]+bestaudio/best[height>=480]/best"
      '480': '135+140/244+251/bestvideo[height>=480]+bestaudio/best[height>=480]/best',

      // 360p: Low quality - Format ID: 18 (MP4)
      // Tích hợp từ tool Python: "18/best[height>=360]/best"
      '360': '18/best[height>=360]/best',

      // Best: Tự động chọn quality cao nhất có sẵn
      // Tích hợp từ tool Python: "315+140/271+140/137+140/248+251/bestvideo[height>=1440]+bestaudio/best[height>=1440]/best"
      'best': '315+140/271+140/137+140/248+251/bestvideo[height>=1440]+bestaudio/best[height>=1440]/best'
    };

    return formats[quality] || formats['best'];
  }

  /**
   * Check if yt-dlp executable exists (for backward compatibility)
   */
  async checkYtDlpAvailable(): Promise<boolean> {
    return this.verify();
  }

  /**
   * Add platform-specific options based on hostname
   */
  private addPlatformSpecificOptions(args: string[], hostname: string): void {
    // Chinese streaming platforms (iQIYI, Youku, Tencent)
    if (hostname.includes('iq.com') || hostname.includes('iqiyi.com')) {
      args.push(
        '--extractor-args', 'iqiyi:player_client=android',
        '--extractor-args', 'iqiyi:player_skip=webpage',
        '--sleep-interval', '2',
        '--max-sleep-interval', '5'
      );
      console.log(`[YouTubeDownloader] Added iQIYI-specific options`);
    } else if (hostname.includes('youku.com')) {
      args.push(
        '--extractor-args', 'youku:player_client=android',
        '--add-header', 'Referer:https://v.youku.com/',
        '--sleep-interval', '2',
        '--max-sleep-interval', '5'
      );
      console.log(`[YouTubeDownloader] Added Youku-specific options`);
    } else if (hostname.includes('tencent.com')) {
      args.push(
        '--extractor-args', 'tencent:player_client=android',
        '--sleep-interval', '2',
        '--max-sleep-interval', '5'
      );
      console.log(`[YouTubeDownloader] Added Tencent-specific options`);
    }
    // International streaming platforms
    else if (hostname.includes('netflix.com')) {
      args.push(
        '--sleep-interval', '3',
        '--max-sleep-interval', '8',
        '--fragment-retries', '10'
      );
      console.log(`[YouTubeDownloader] Added Netflix-specific options`);
    } else if (hostname.includes('disneyplus.com') || hostname.includes('disney.com')) {
      args.push(
        '--sleep-interval', '3',
        '--max-sleep-interval', '8',
        '--fragment-retries', '10'
      );
      console.log(`[YouTubeDownloader] Added Disney+-specific options`);
    } else if (hostname.includes('hbomax.com') || hostname.includes('hbo.com')) {
      args.push(
        '--sleep-interval', '3',
        '--max-sleep-interval', '8',
        '--fragment-retries', '10'
      );
      console.log(`[YouTubeDownloader] Added HBO Max-specific options`);
    }
    // TikTok
    else if (hostname.includes('tiktok.com')) {
      args.push(
        '--extractor-args', 'tiktok:webpage_url_basename=t',
        '--sleep-interval', '1',
        '--add-header', 'Referer:https://www.tiktok.com/',
        // Ưu tiên format không watermark: download_addr-0 = no watermark, play_addr = có watermark
        '--format', 'download_addr-0+bestaudio/bestvideo+bestaudio/best'
      );
      console.log(`[YouTubeDownloader] Added TikTok-specific options (no watermark)`);
    }
    // Facebook / Facebook Reels
    else if (hostname.includes('facebook.com') || hostname.includes('fb.watch')) {
      args.push(
        '--add-header', 'Referer:https://www.facebook.com/',
        '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '--sleep-interval', '1',
        '--max-sleep-interval', '3',
        '--retries', '5',
        '--extractor-retries', '3',
        '--no-check-certificates'
      );
      console.log(`[YouTubeDownloader] Added Facebook-specific options`);
    }
    // Vietnamese movie platforms
    else if (hostname.includes('rophim.me') || hostname.includes('phimmoi.net') ||
             hostname.includes('phimhay.vn') || hostname.includes('phimle.net') ||
             hostname.includes('phimhd.vn')) {
      args.push(
        '--add-header', 'Referer:https://www.rophim.me/',
        '--sleep-interval', '2',
        '--max-sleep-interval', '5',
        '--fragment-retries', '10',
        '--retries', '5',
        '--extractor-retries', '3',
        '--http-chunk-size', '10485760', // 10MB chunks
        '--concurrent-fragments', '4'
      );
      console.log(`[YouTubeDownloader] Added Vietnamese movie platform-specific options`);
    }
    // Video hosting services (goatembed, streamtape, doodstream, etc.)
    else if (hostname.includes('goatembed.com') || hostname.includes('streamtape.com') ||
             hostname.includes('doodstream.com') || hostname.includes('mixdrop.co') ||
             hostname.includes('upstream.to') || hostname.includes('vidoza.net')) {
      args.push(
        '--add-header', 'Referer:https://www.rophim.me/',
        '--sleep-interval', '1',
        '--max-sleep-interval', '3',
        '--fragment-retries', '20',
        '--retries', '10',
        '--retry-sleep', 'http:3',
        '--retry-sleep', 'fragment:3',
        '--extractor-retries', '2'
      );
      console.log(`[YouTubeDownloader] Added video hosting service-specific options`);
    }
  }

  /**
   * Get video information without downloading
   * REFACTORED: Dùng android,web client cùng lúc như tool Python để lấy format cao nhất
   */
  async getVideoInfo(url: string): Promise<VideoInfo> {
    console.log(`[YouTubeDownloader] Getting info for: ${url}`);

    // Facebook: use scraper to get video info
    if (this.isFacebookUrl(url)) {
      console.log('[YouTubeDownloader] Using FacebookScraper for video info');
      if (!this.facebookScraper.hasCookies()) {
        throw new Error('Chưa import cookies Facebook. Vui lòng vào Quản lý Cookies để import.');
      }
      try {
        const reelInfo = await this.facebookScraper.getReelVideoUrl(url);
        return {
          id: reelInfo.id,
          title: reelInfo.title || `Facebook Reel ${reelInfo.id}`,
          duration: reelInfo.duration || 0,
          thumbnail: reelInfo.thumbnail || '',
          description: reelInfo.description || '',
          uploader: reelInfo.uploader || 'Facebook',
          uploadDate: '',
          viewCount: 0,
          likeCount: 0,
          width: reelInfo.width || 0,
          height: reelInfo.height || 0,
          formats: [] as VideoFormat[],
        };
      } catch (error: any) {
        throw new Error(`Không thể lấy thông tin reel: ${error.message}`);
      }
    }

    if (!(await this.verify())) {
      throw new Error(`yt-dlp not found at ${this.ytDlpPath}. Please download it from https://github.com/yt-dlp/yt-dlp/releases`);
    }

    const usesSavedYoutubeCookies =
      this.getCookiePlatformForUrl(url) === 'youtube' && this.cookieManager.hasCookies('youtube');
    const clientsToTry = usesSavedYoutubeCookies
      ? ['tv', 'web_safari']
      : ['tv,android_vr,web_safari', 'android,web'];

    let lastError: any = null;
    for (const client of clientsToTry) {
      try {
        console.log(`[YouTubeDownloader] Using ${client} client for video info...`);
        return await this.getVideoInfoWithClient(url, client);
      } catch (error: any) {
        lastError = error;
        const message = error?.message || '';

        if (this.isExpiredCookieError(message)) {
          throw error;
        }

        console.warn(`[YouTubeDownloader] ${client} failed for video info: ${message}`);
      }
    }

    throw new Error(`Failed to get video info: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Helper: Get video info với client cụ thể
   * REFACTORED: Hỗ trợ 'android,web' như tool Python
   */
  private async getVideoInfoWithClient(url: string, client: string): Promise<VideoInfo> {
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
    const isFacebook = url.includes('facebook.com') || url.includes('fb.watch');

    const args = [
      '--dump-json',
      '--no-playlist',
      '--skip-download',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
    ];

    if (isYouTube) {
      args.push('--referer', 'https://www.youtube.com/');
      args.push('--extractor-args', `youtube:player_client=${client}`);
    } else if (isFacebook) {
      args.push('--referer', 'https://www.facebook.com/');
      args.push('--no-check-certificates');
    } else {
      args.push('--referer', 'https://www.google.com/');
    }

    const cookiePlatform = this.getCookiePlatformForUrl(url);
    let cookieContext: { args: string[]; cleanup: () => void; source?: string } | null = null;
    if (cookiePlatform) {
      cookieContext = await this.resolveCookieArgsForYtDlp(cookiePlatform);
      args.push(...cookieContext.args);
    }

    args.push(url);

    return new Promise((resolve, reject) => {
      const proc = spawn(this.ytDlpPath, args);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          try {
            const rawInfo = JSON.parse(stdout);

            // Kiểm tra phụ đề có sẵn
            const subtitles = rawInfo.subtitles || rawInfo.automatic_captions || {};
            const subtitleLangs = Object.keys(subtitles);
            const hasSubtitles = subtitleLangs.length > 0;

            // Parse formats và tìm resolution cao nhất
            interface ParsedFormatWithSize {
              formatId: string;
              ext: string;
              resolution: string;
              fps: number;
              filesize: number;
              vcodec: string;
              acodec: string;
              width: number;
              height: number;
            }
            const parsedFormatsWithSize: ParsedFormatWithSize[] = rawInfo.formats ? rawInfo.formats.map((f: any): ParsedFormatWithSize => ({
              formatId: f.format_id || '',
              ext: f.ext || '',
              resolution: (f.resolution && f.resolution !== 'none') ? f.resolution : `${f.width || 0}x${f.height || 0}`,
              fps: f.fps || 0,
              filesize: f.filesize || f.filesize_approx || 0,
              vcodec: f.vcodec || 'none',
              acodec: f.acodec || 'none',
              width: f.width || 0,
              height: f.height || 0
            })) : [];

            // Tìm format có resolution cao nhất (video only, có vcodec)
            const videoFormats = parsedFormatsWithSize.filter((f: ParsedFormatWithSize) => f.vcodec && f.vcodec !== 'none');
            const maxHeight = videoFormats.length > 0
              ? Math.max(...videoFormats.map((f: ParsedFormatWithSize) => f.height || 0))
              : (rawInfo.height || 0);
            const maxWidth = videoFormats.length > 0
              ? videoFormats.find((f: ParsedFormatWithSize) => f.height === maxHeight)?.width || (rawInfo.width || 0)
              : (rawInfo.width || 0);

            // Convert to VideoFormat[] (bỏ width/height vì không có trong interface)
            const formats: VideoFormat[] = parsedFormatsWithSize.map((f: ParsedFormatWithSize): VideoFormat => ({
              formatId: f.formatId,
              ext: f.ext,
              resolution: f.resolution,
              fps: f.fps,
              filesize: f.filesize,
              vcodec: f.vcodec,
              acodec: f.acodec
            }));

            // Parse to our VideoInfo format
            const videoInfo: VideoInfo = {
              id: rawInfo.id || '',
              title: rawInfo.title || '',
              duration: rawInfo.duration || 0,
              thumbnail: rawInfo.thumbnail || '',
              description: rawInfo.description || '',
              uploader: rawInfo.uploader || rawInfo.channel || 'Unknown',
              uploadDate: rawInfo.upload_date || '',
              viewCount: rawInfo.view_count || 0,
              likeCount: rawInfo.like_count || 0,
              width: maxWidth, // Sử dụng resolution cao nhất
              height: maxHeight, // Sử dụng resolution cao nhất
              formats: formats,
              hasSubtitles: hasSubtitles,
              subtitles: subtitleLangs.map(lang => ({
                lang: lang,
                langCode: lang
              }))
            };

            console.log(`[YouTubeDownloader] Video info:`, {
              title: videoInfo.title,
              duration: videoInfo.duration,
              resolution: `${videoInfo.width}x${videoInfo.height}`,
              uploader: videoInfo.uploader,
              hasSubtitles: videoInfo.hasSubtitles,
              subtitleCount: videoInfo.subtitles?.length || 0,
              availableFormats: videoInfo.formats.length,
              maxResolution: `${maxWidth}x${maxHeight}`
            });

            // Log các format có sẵn để debug
            if (videoInfo.formats.length > 0) {
              const videoOnlyFormats = videoInfo.formats.filter(f => f.vcodec && f.vcodec !== 'none');
              const uniqueResolutions = Array.from(new Set(videoOnlyFormats.map(f => f.resolution)));
              console.log(`[YouTubeDownloader] Available video resolutions:`, uniqueResolutions);

              // Log format IDs có sẵn để debug
              const formatIds = videoOnlyFormats.map(f => `${f.formatId} (${f.resolution}, ${f.vcodec})`).slice(0, 10);
              console.log(`[YouTubeDownloader] Sample format IDs:`, formatIds);

              // Log format cao nhất có sẵn
              const maxHeightFormat = videoOnlyFormats.reduce((max, f) => {
                const height = parseInt(f.resolution.split('x')[1] || '0');
                const maxHeight = parseInt(max.resolution.split('x')[1] || '0');
                return height > maxHeight ? f : max;
              }, videoOnlyFormats[0]);
              if (maxHeightFormat) {
                console.log(`[YouTubeDownloader] Highest quality format: ${maxHeightFormat.formatId} (${maxHeightFormat.resolution}, ${maxHeightFormat.vcodec})`);
              }
            }

            resolve(videoInfo);

          } catch (error: any) {
            reject(new Error(`Failed to parse video info: ${error.message}`));
          }
        } else {
          reject(new Error(this.formatYtDlpFailure(stderr, 'yt-dlp failed: Unknown error')));
        }
        cookieContext?.cleanup();
      });

      proc.on('error', (error) => {
        cookieContext?.cleanup();
        reject(new Error(`Failed to spawn yt-dlp: ${error.message}`));
      });
    });
  }

  /**
   * Validate download request (including disk space)
   */
  private async validateDownloadRequest(
    outputDir: string,
    estimatedSizeBytes?: number
  ): Promise<void> {
    // Check output directory exists or create it
    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (error: any) {
      throw new Error(`Thư mục output không tồn tại: ${outputDir}`);
    }

    // Check disk space
    const { getDiskSpace, checkMinimumSpace, formatBytes } = await import('../utils/diskSpace');

    try {
      const diskInfo = await getDiskSpace(outputDir);

      console.log(`[YouTubeDownloader] Disk space check:`);
      console.log(`  Drive: ${diskInfo.drive}`);
      console.log(`  Free: ${formatBytes(diskInfo.free)}`);

      // Minimum 1GB required
      const minGB = 1;
      const spaceCheck = checkMinimumSpace(diskInfo.free, minGB);

      if (!spaceCheck.enough) {
        const freeGB = spaceCheck.freeBytes / (1024 ** 3);
        throw new Error(
          `Không đủ dung lượng ổ đĩa!\n\n` +
          `Ổ đĩa: ${diskInfo.drive}\n` +
          `Dung lượng trống: ${freeGB.toFixed(2)} GB\n` +
          `Yêu cầu tối thiểu: ${minGB} GB\n\n` +
          `Vui lòng dọn dẹp ổ đĩa hoặc chọn thư mục output khác.`
        );
      }

      // If we have estimated size, check if enough
      if (estimatedSizeBytes) {
        const estimatedGB = estimatedSizeBytes / (1024 ** 3);
        const requiredGB = estimatedGB + 0.5; // Add 0.5GB buffer
        const freeGB = spaceCheck.freeBytes / (1024 ** 3);

        if (diskInfo.free < requiredGB * (1024 ** 3)) {
          throw new Error(
            `Không đủ dung lượng để download!\n\n` +
            `Ổ đĩa: ${diskInfo.drive}\n` +
            `Dung lượng trống: ${freeGB.toFixed(2)} GB\n` +
            `Dung lượng cần thiết: ~${requiredGB.toFixed(2)} GB\n` +
            `Thiếu: ${(requiredGB - freeGB).toFixed(2)} GB\n\n` +
            `Vui lòng:\n` +
            `1. Dọn dẹp ổ đĩa ${diskInfo.drive}\n` +
            `2. Hoặc chọn thư mục output ở ổ đĩa khác\n` +
            `3. Hoặc giảm số lượng videos cần download`
          );
        }

        console.log(`  Estimated size: ${formatBytes(estimatedSizeBytes)}`);
        console.log(`  ✓ Disk space OK`);
      } else {
        console.log(`  ✓ Minimum disk space OK`);
      }

    } catch (error: any) {
      if (error.message.includes('Không đủ dung lượng')) {
        throw error;
      }
      console.warn(`[YouTubeDownloader] Disk space check warning:`, error.message);
      // Continue anyway if disk check fails
    }
  }

  /**
   * Cancel ongoing download
   */
  cancelDownload(): void {
    // Fix P0-07: Kill ALL active processes, not just the last one
    if (this.activeProcesses.size > 0) {
      console.log(`[YouTubeDownloader] Cancelling ${this.activeProcesses.size} active download(s)...`);
      for (const [jobId, proc] of this.activeProcesses) {
        try {
          if (!proc.killed) proc.kill('SIGTERM');
        } catch (err) {
          console.warn(`[YouTubeDownloader] Error killing process ${jobId}:`, err);
        }
      }
      this.activeProcesses.clear();

      this.emit('progress', {
        type: 'error',
        message: 'Download cancelled by user'
      } as DownloadProgress);
    }
  }

  /** Helper: track a new process so cancelDownload() can kill it */
  private addProcess(jobId: string, proc: ChildProcess): void {
    this.activeProcesses.set(jobId, proc);
    proc.once('close', () => this.activeProcesses.delete(jobId));
  }

  /** Helper: remove a tracked process (called on completion) */
  private removeProcess(jobId: string): void {
    this.activeProcesses.delete(jobId);
  }

  /**
   * Parse download progress from yt-dlp output
   */
  private parseDownloadProgress(output: string, title: string) {
    // Example output:
    // [download]   45.6% of  123.45MiB at    1.23MiB/s ETA 00:42

    const progressMatch = output.match(
      /\[download\]\s+(\d+\.?\d*)%\s+of\s+(~?\s*[\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+\/s)\s+ETA\s+(\d+:\d+)/
    );

    if (progressMatch) {
      const percent = parseFloat(progressMatch[1]);
      // const totalSize = progressMatch[2].trim(); // Not used currently
      const speed = progressMatch[3].trim();
      const eta = progressMatch[4].trim();

      // Emit progress event
      this.emit('progress', {
        type: 'download',
        title: title,
        percent: percent,
        speed: speed,
        eta: eta,
        message: `Downloading: ${percent.toFixed(1)}% at ${speed}`
      } as DownloadProgress);
    }

    // Check for other status messages
    if (output.includes('[download] Downloading video')) {
      this.emit('progress', {
        type: 'info',
        message: 'Starting download...'
      } as DownloadProgress);
    }

    if (output.includes('[Merger]')) {
      this.emit('progress', {
        type: 'postprocess',
        message: 'Merging video and audio...'
      } as DownloadProgress);
    }

    if (output.includes('[EmbedSubtitle]')) {
      this.emit('progress', {
        type: 'postprocess',
        message: 'Embedding subtitles...'
      } as DownloadProgress);
    }

    if (output.includes('[EmbedThumbnail]')) {
      this.emit('progress', {
        type: 'postprocess',
        message: 'Embedding thumbnail...'
      } as DownloadProgress);
    }
  }

  /**
   * Download single video với tự động thử các browser nếu cookies fail
   */
  /**
   * Download single video - VIẾT LẠI HOÀN TOÀN giống hệt tool Python
   * Logic cực kỳ đơn giản: CHỈ dùng android,web client, KHÔNG cookies, KHÔNG phức tạp
   */
  async downloadVideo(request: DownloadVideoRequest): Promise<string> {
    // Check URL
    if (!this.isValidYouTubeUrl(request.url)) {
      throw new Error(`Invalid URL (YouTube / SoundCloud / TikTok only): ${request.url}`);
    }

    // Facebook: use direct scraper instead of yt-dlp
    if (this.isFacebookUrl(request.url)) {
      console.log('[YouTubeDownloader] Using FacebookScraper for direct download');
      await this.validateDownloadRequest(request.outputDir);
      return this.downloadFacebookVideo(request.url, request.outputDir, {
        createChannelFolder: request.createChannelFolder,
        audioOnly: request.audioOnly,
        audioFormat: request.audioFormat,
      });
    }

    // Validate (including disk space)
    await this.validateDownloadRequest(request.outputDir);

    console.log(`[YouTubeDownloader] Starting download:`, {
      url: request.url,
      quality: request.quality,
      outputDir: request.outputDir
    });

    const { outputDir, url, quality, downloadSubtitles, downloadThumbnail, audioOnly = false, audioFormat = 'mp3' } = request;

    // Build output template - Giống hệt tool Python
    let outputTemplate: string;
    if (request.createChannelFolder !== false) {
      outputTemplate = path.join(outputDir, '%(uploader)s', '%(title)s.%(ext)s');
    } else {
      outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');
    }

    // Build yt-dlp command - GIỐNG 100% TOOL PYTHON (thứ tự chính xác)
    // Tool Python: format selector → output template → thumbnail → subtitles → headers/extractor args → retry → URL
    const cmd = [
      this.ytDlpPath,
      '-f', audioOnly ? 'bestaudio/best' : this.getQualityFormat(quality),  // Format selector (giống tool Python)
      '-o', outputTemplate,  // Output template (giống tool Python)
    ];

    // Thumbnail - GIỐNG HỆT TOOL PYTHON (đặt TRƯỚC headers)
    if (downloadThumbnail) {
      cmd.push('--write-thumbnail');  // Tool Python chỉ có option này, KHÔNG có --convert-thumbnails
    }

    // Subtitles - GIỐNG HỆT TOOL PYTHON (đặt TRƯỚC headers)
    if (downloadSubtitles) {
      cmd.push('--write-subs', '--sub-langs', 'vi,en,zh', '--convert-subs', 'srt');
    }

    // Headers và extractor args - GIỐNG HỆT TOOL PYTHON
    cmd.push(
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--referer', 'https://www.youtube.com/',
      '--add-header', 'Accept-Language:vi-VN,vi;q=0.9,en;q=0.8',
      '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '--add-header', 'Sec-Fetch-Dest:document',
      '--add-header', 'Sec-Fetch-Mode:navigate',
      '--add-header', 'Sec-Fetch-Site:none',
      '--add-header', 'Sec-Fetch-User:?1',
      '--no-check-certificate',
      '--no-warnings',
      // Fix: Dùng tv,android_vr làm primary — không cần PO token, không bị SABR,
      // có thể lấy DASH 4K. web_safari fallback cho HLS 1080p.
      // (Theo yt-dlp docs 2025: web/android đã bị SABR/broken)
      '--extractor-args', 'youtube:player_client=tv,android_vr,web_safari',
      '--fragment-retries', '30',
      '--retries', '15',
      '--retry-sleep', 'http:3',
      '--retry-sleep', 'fragment:3',
      '--http-chunk-size', '10M',
      '--throttled-rate', '100K',
      '--sleep-interval', '1',
      '--max-sleep-interval', '5'
    );

    // Cookies: thêm nếu user yêu cầu, nhưng KHÔNG crash nếu fail
    // (Chrome lock DB khi đang chạy — phải graceful fallback)
    const cookiePlatform = this.getCookiePlatformForUrl(url);
    const cookieContext = cookiePlatform
      ? await this.resolveCookieArgsForYtDlp(cookiePlatform, request)
      : { args: [] as string[], cleanup: () => {} };
    cmd.push(...cookieContext.args);

    // Audio options - GIỐNG HỆT TOOL PYTHON (nếu audioOnly)
    if (audioOnly) {
      cmd.push('--extract-audio', '--audio-format', audioFormat, '--audio-quality', '0', '--add-metadata');
    }

    // Tool Python KHÔNG có --merge-output-format, --newline, --progress, --no-playlist
    // Nhưng chúng ta giữ lại để có progress tracking và đảm bảo output là mp4
    if (!audioOnly) {
      cmd.push('--merge-output-format', 'mp4');
    }
    cmd.push('--newline', '--progress', '--no-playlist');

    // URL
    cmd.push(url);

    console.log(`[YouTubeDownloader] Command: ${cmd.join(' ')}`);

    // Execute - GIỐNG HỆT TOOL PYTHON (chỉ gọi một lần, không retry phức tạp)
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd[0], cmd.slice(1));
      const _procId = `dl-${Date.now()}`
      this.addProcess(_procId, proc);

      let downloadedFile = '';
      let stderrBuffer = '';

      proc.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('[yt-dlp]', output.trim());
        this.parseDownloadProgress(output, '');

        const destMatch = output.match(/\[download\] Destination: (.+)/);
        if (destMatch) downloadedFile = destMatch[1].trim();

        const mergeMatch = output.match(/\[Merger\] Merging formats into "(.+)"/);
        if (mergeMatch) downloadedFile = mergeMatch[1].trim();
      });

      proc.stderr.on('data', (data) => {
        const output = data.toString();
        stderrBuffer += output;
        console.log('[yt-dlp stderr]', output.trim());
        this.parseDownloadProgress(output, '');
      });

      proc.on('close', async (code) => {
        this.removeProcess(_procId);
        cookieContext.cleanup()

        if (code === 0) {
          if (!downloadedFile) {
            // Try to find file in output directory
            try {
              const files = await fs.readdir(outputDir);
              const videoFile = files.find(f => /\.(mp4|webm|mkv|avi|flv)$/i.test(f));
              if (videoFile) {
                downloadedFile = path.join(outputDir, videoFile);
              }
            } catch {}
          }

          if (downloadedFile) {
            resolve(downloadedFile);
          } else {
            reject(new Error('Download completed but file not found'));
          }
        } else {
          reject(new Error(this.formatYtDlpFailure(
            stderrBuffer,
            `yt-dlp failed with exit code ${code}`
          )));
        }
      });

      proc.on('error', (err) => {
        this.removeProcess(_procId);
        cookieContext.cleanup()
        reject(new Error(`Failed to start yt-dlp: ${err.message}`));
      });
    });
  }

  /**
   * Get list of videos from channel or playlist
   */
  async getChannelVideos(url: string, limit?: number): Promise<VideoInfo[]> {
    console.log(`[YouTubeDownloader] Getting channel/playlist videos: ${url}`);
    console.log(`  Limit: ${limit || 'unlimited'}`);

    // Facebook: use custom scraper instead of yt-dlp
    if (this.isFacebookUrl(url)) {
      console.log('[YouTubeDownloader] Using FacebookScraper for channel videos');
      const videos = await this.getFacebookChannelVideos(url);
      if (limit && limit > 0) {
        return videos.slice(0, limit);
      }
      return videos;
    }

    if (!(await this.verify())) {
      throw new Error(`yt-dlp not found at ${this.ytDlpPath}. Please download it from https://github.com/yt-dlp/yt-dlp/releases`);
    }

    const args = [
      '--flat-playlist',      // Fast extraction (don't get full info)
      '--dump-json',          // Output JSON
      '--skip-download',      // Don't download
    ];

    const cookiePlatform = this.getCookiePlatformForUrl(url);
    let cookieContext: { args: string[]; cleanup: () => void; source?: string } | null = null;
    if (cookiePlatform) {
      cookieContext = await this.resolveCookieArgsForYtDlp(cookiePlatform);
      args.push(...cookieContext.args);
    }

    // Facebook-specific headers for channel/reels listing
    if (url.includes('facebook.com') || url.includes('fb.watch')) {
      args.push(
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '--add-header', 'Referer:https://www.facebook.com/',
        '--no-check-certificates'
      );
    }

    args.push(url);

    // Limit number of videos
    if (limit && limit > 0) {
      args.push('--playlist-end', limit.toString());
    }

    console.log(`[YouTubeDownloader] yt-dlp args:`, args.join(' '));

    return new Promise((resolve, reject) => {
      const proc = spawn(this.ytDlpPath, args);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          try {
            // Parse multiple JSON objects (one per line)
            const lines = stdout.trim().split('\n').filter(line => line.trim());

            console.log(`[YouTubeDownloader] Raw output lines: ${lines.length}`);

            if (lines.length === 0) {
              console.warn('[YouTubeDownloader] No videos found in output');
              resolve([]);
              return;
            }

            // Debug: Log first line sample
            if (lines.length > 0) {
              console.log(`[YouTubeDownloader] First line sample:`, lines[0].substring(0, 200));
            }

            const videos: VideoInfo[] = lines
              .map(line => {
                try {
                  const raw = JSON.parse(line);

                  // Try multiple fields for channel name
                  const uploader = raw.uploader ||
                                 raw.channel ||
                                 raw.channel_name ||
                                 raw.uploader_id ||
                                 'Unknown';

                  return {
                    id: raw.id || raw.url || '',
                    title: raw.title || 'Unknown',
                    duration: raw.duration || 0,
                    thumbnail: raw.thumbnail || raw.thumbnails?.[0]?.url || '',
                    description: '',
                    uploader: uploader,
                    uploadDate: raw.upload_date || '',
                    viewCount: raw.view_count || 0,
                    likeCount: 0,
                    width: 0,
                    height: 0,
                    formats: [] as VideoInfo['formats']
                  } as VideoInfo;
                } catch (e) {
                  console.warn('[YouTubeDownloader] Failed to parse video line:', line.substring(0, 100));
                  return null;
                }
              })
              .filter((v): v is VideoInfo => v !== null);

            console.log(`[YouTubeDownloader] Parsed ${videos.length} videos`);

            // Log first few videos with uploader info
            if (videos.length > 0) {
              console.log(`[YouTubeDownloader] Sample video:`, {
                title: videos[0].title,
                uploader: videos[0].uploader,
                id: videos[0].id
              });

              videos.slice(0, 5).forEach((v, i) => {
                console.log(`  ${i + 1}. ${v.title} (${v.duration}s) - ${v.uploader}`);
              });

              if (videos.length > 5) {
                console.log(`  ... and ${videos.length - 5} more`);
              }
            }

            resolve(videos);

          } catch (error: any) {
            console.error('[YouTubeDownloader] Parse error:', error);
            console.error('[YouTubeDownloader] Raw stdout:', stdout.substring(0, 500));
            reject(new Error(`Failed to parse: ${error.message}`));
          }
        } else {
          console.error('[YouTubeDownloader] yt-dlp failed with code:', code);
          console.error('[YouTubeDownloader] stderr:', stderr);
          reject(new Error(this.formatYtDlpFailure(stderr, `yt-dlp failed: Exit code ${code}`)));
        }
        cookieContext?.cleanup();
      });

      proc.on('error', (error) => {
        console.error('[YouTubeDownloader] Process error:', error);
        cookieContext?.cleanup();
        reject(new Error(`Failed to spawn yt-dlp: ${error.message}`));
      });
    });
  }

  /**
   * Get channel info - FIXED VERSION (extract from URL + first video)
   */
  async getChannelInfo(url: string): Promise<{
    channelName: string;
    channelId: string;
    videoCount: number;
  }> {
    console.log(`\n[YouTubeDownloader] ====== GET CHANNEL INFO ======`);
    console.log(`[YouTubeDownloader] URL: ${url}`);
    console.log(`[YouTubeDownloader] URL Type: ${this.detectUrlType(url)}`);

    // Facebook: use scraper to get channel info
    if (this.isFacebookUrl(url)) {
      console.log('[YouTubeDownloader] Using FacebookScraper for channel info');
      if (!this.facebookScraper.hasCookies()) {
        throw new Error('Chưa import cookies Facebook. Vui lòng vào Quản lý Cookies để import.');
      }

      const fbUrlMatch = url.match(/facebook\.com\/([^\/\?]+)/);
      const channelName = fbUrlMatch ? fbUrlMatch[1] : 'Facebook';

      const videos = await this.getFacebookChannelVideos(url);

      const result = {
        channelName,
        channelId: '',
        videoCount: videos.length,
      };

      console.log(`[YouTubeDownloader] ====== RESULT (Facebook) ======`);
      console.log(result);
      return result;
    }

    if (!(await this.verify())) {
      throw new Error(`yt-dlp not found at ${this.ytDlpPath}. Please download it from https://github.com/yt-dlp/yt-dlp/releases`);
    }

    try {
      // Method 1: Try to extract channel name from URL first
      let channelNameFromUrl = '';
      const ytUrlMatch = url.match(/youtube\.com\/@([^\/\?]+)/);
      const fbUrlMatch = url.match(/facebook\.com\/([^\/\?]+)/);
      if (ytUrlMatch) {
        channelNameFromUrl = ytUrlMatch[1];
        console.log(`[YouTubeDownloader] Extracted from YouTube URL: ${channelNameFromUrl}`);
      } else if (fbUrlMatch) {
        channelNameFromUrl = fbUrlMatch[1];
        console.log(`[YouTubeDownloader] Extracted from Facebook URL: ${channelNameFromUrl}`);
      }

      // Method 2: Get first video with full info (not flat-playlist) to get channel name
      console.log(`[YouTubeDownloader] Step 1: Getting first video with full info...`);
      let channelName = channelNameFromUrl;

      try {
        // Get first video URL from flat playlist
        const firstVideos = await this.getChannelVideos(url, 1);

        if (firstVideos.length > 0) {
          const firstVideoId = firstVideos[0].id;

          // Build correct URL based on platform
          const isFacebook = url.includes('facebook.com') || url.includes('fb.watch');
          const firstVideoUrl = isFacebook
            ? `https://www.facebook.com/reel/${firstVideoId}`
            : `https://www.youtube.com/watch?v=${firstVideoId}`;

          console.log(`[YouTubeDownloader] Getting full info for first video: ${firstVideoUrl}`);

          // Get full video info (not flat-playlist) to get channel name
          const fullVideoInfo = await this.getVideoInfo(firstVideoUrl);

          if (fullVideoInfo.uploader && fullVideoInfo.uploader !== 'Unknown') {
            channelName = fullVideoInfo.uploader;
            console.log(`[YouTubeDownloader] ✓ Channel name from video: ${channelName}`);
          } else if (channelNameFromUrl) {
            channelName = channelNameFromUrl;
            console.log(`[YouTubeDownloader] ✓ Using channel name from URL: ${channelName}`);
          } else {
            channelName = firstVideos[0].uploader || 'Unknown Channel';
            console.log(`[YouTubeDownloader] ⚠ Using uploader from flat-playlist: ${channelName}`);
          }
        } else {
          if (channelNameFromUrl) {
            channelName = channelNameFromUrl;
          } else {
            throw new Error('Không tìm thấy video nào trong channel');
          }
        }
      } catch (error: any) {
        console.warn(`[YouTubeDownloader] Could not get channel name from video: ${error.message}`);
        if (channelNameFromUrl) {
          channelName = channelNameFromUrl;
        } else {
          channelName = 'Unknown Channel';
        }
      }

      // Step 2: Count all videos
      console.log(`[YouTubeDownloader] Step 2: Counting all videos...`);
      const allVideos = await this.getChannelVideos(url, undefined);
      console.log(`[YouTubeDownloader] ✓ Total videos: ${allVideos.length}`);

      const result = {
        channelName: channelName,
        channelId: '',  // Not available in flat playlist mode
        videoCount: allVideos.length
      };

      console.log(`[YouTubeDownloader] ====== RESULT ======`);
      console.log(result);
      console.log(`[YouTubeDownloader] ====================\n`);

      return result;

    } catch (error: any) {
      console.error(`[YouTubeDownloader] ====== ERROR ======`);
      console.error('[YouTubeDownloader] Error:', error);
      console.error(`[YouTubeDownloader] ===================\n`);
      throw error;
    }
  }

  /**
   * Estimate total download size for channel
   */
  async estimateChannelSize(
    url: string,
    quality: Quality,
    limit?: number
  ): Promise<{
    videoCount: number;
    estimatedSizeBytes: number;
    estimatedSizeFormatted: string;
    avgSizePerVideo: number;
  }> {
    console.log(`[YouTubeDownloader] Estimating channel download size...`);

    // Get videos
    const videos = await this.getChannelVideos(url, limit);

    // Estimate based on quality and duration
    const qualityToBitrate: Record<Quality, number> = {
      'best': 8_000_000,    // 8 Mbps
      '4320': 25_000_000,   // 25 Mbps for 8K
      '2160': 15_000_000,   // 15 Mbps for 4K
      '1440': 10_000_000,   // 10 Mbps for 1440p
      '1080': 5_000_000,    // 5 Mbps for 1080p
      '720': 2_500_000,     // 2.5 Mbps for 720p
      '480': 1_000_000,     // 1 Mbps for 480p
      '360': 700_000,       // 0.7 Mbps for 360p
    };

    const bitrate = qualityToBitrate[quality] || qualityToBitrate['1080'];

    // Calculate total size
    let totalSize = 0;

    for (const video of videos) {
      const durationSec = video.duration || 300; // Default 5 min if unknown
      const videoSize = (bitrate / 8) * durationSec; // bytes
      totalSize += videoSize;
    }

    const avgSize = videos.length > 0 ? totalSize / videos.length : 0;

    // Format
    const { formatBytes } = await import('../utils/diskSpace');

    return {
      videoCount: videos.length,
      estimatedSizeBytes: totalSize,
      estimatedSizeFormatted: formatBytes(totalSize),
      avgSizePerVideo: avgSize
    };
  }

  /**
   * Build video URL from video ID based on source platform
   */
  private buildVideoUrl(videoId: string, sourceUrl: string): string {
    if (sourceUrl.includes('facebook.com') || sourceUrl.includes('fb.watch')) {
      if (videoId.startsWith('http')) return videoId;
      return `https://www.facebook.com/reel/${videoId}`;
    }
    if (sourceUrl.includes('soundcloud.com')) {
      if (videoId.startsWith('http')) return videoId;
      return videoId;
    }
    if (sourceUrl.includes('tiktok.com')) {
      if (videoId.startsWith('http')) return videoId;
      return `https://www.tiktok.com/video/${videoId}`;
    }
    // Default: YouTube
    if (videoId.startsWith('http')) return videoId;
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  /**
   * Download entire channel or playlist
   */
  async downloadChannel(
    url: string,
    outputDir: string,
    quality: Quality,
    options: {
      downloadSubtitles?: boolean;
      downloadThumbnail?: boolean;
      limit?: number;           // Limit number of videos
      continueOnError?: boolean; // Continue if one video fails
      audioOnly?: boolean;
      audioFormat?: 'mp3' | 'wav';
      cookiesFile?: string;
      cookiesFromBrowser?: CookieBrowserSelection;
      minDurationSeconds?: number;
    } = {}
  ): Promise<{
    downloaded: string[];
    failed: Array<{ video: VideoInfo; error: string }>;
    channelFolder?: string;
  }> {
    console.log(`[YouTubeDownloader] Downloading channel/playlist: ${url}`);

    // Get channel info
    const channelInfo = await this.getChannelInfo(url);

    // Sanitize channel name (remove invalid characters)
    const sanitizedChannelName = channelInfo.channelName
      .replace(/[<>:"/\\|?*]/g, '_')  // Replace invalid chars
      .replace(/\s+/g, ' ')            // Normalize spaces
      .trim();

    // Create channel folder
    const channelFolder = path.join(outputDir, sanitizedChannelName);
    await fs.mkdir(channelFolder, { recursive: true });

    console.log(`[YouTubeDownloader] Created channel folder: ${channelFolder}`);

    // Create subfolders
    const mediaSubfolder = options.audioOnly ? 'audios' : 'videos';
    const videosFolder = path.join(channelFolder, mediaSubfolder);
    await fs.mkdir(videosFolder, { recursive: true });

    let thumbnailsFolder: string | undefined;
    if (options.downloadThumbnail) {
      thumbnailsFolder = path.join(channelFolder, 'thumbnails');
      await fs.mkdir(thumbnailsFolder, { recursive: true });
      console.log(`[YouTubeDownloader] Created thumbnails folder: ${thumbnailsFolder}`);
    }

    console.log(`[YouTubeDownloader] Folder structure:`);
    console.log(`  ${channelFolder}/`);
    console.log(`    ${mediaSubfolder}/`);
    if (thumbnailsFolder) {
      console.log(`    thumbnails/`);
    }

    // Get list of videos
    let videos = await this.getChannelVideos(url, options.limit);

    if (videos.length === 0) {
      throw new Error('Không tìm thấy video nào trong channel/playlist');
    }

    // Estimate size (skip for Facebook — no duration info available)
    const { formatBytes } = await import('../utils/diskSpace');
    if (options.minDurationSeconds && options.minDurationSeconds > 0) {
      const beforeFilter = videos.length;
      videos = videos.filter(video => !video.duration || video.duration >= options.minDurationSeconds!);
      console.log(`[YouTubeDownloader] Duration filter kept ${videos.length}/${beforeFilter} videos (min ${options.minDurationSeconds}s)`);
      if (videos.length === 0) {
        throw new Error('No videos match the minimum duration filter');
      }
    }

    if (!this.isFacebookUrl(url)) {
      const qualityToBitrate: Record<Quality, number> = {
        'best': 8_000_000,
        '4320': 25_000_000,
        '2160': 15_000_000,
        '1440': 10_000_000,
        '1080': 5_000_000,
        '720': 2_500_000,
        '480': 1_000_000,
        '360': 700_000,
      };
      const bitrate = qualityToBitrate[quality] || qualityToBitrate['1080'];
      const estimatedSizeBytes = videos.reduce((total, video) => {
        const durationSec = video.duration || 300;
        return total + (bitrate / 8) * durationSec;
      }, 0);
      console.log(`[YouTubeDownloader] Estimated download size: ${formatBytes(estimatedSizeBytes)}`);
      // Validate disk space với estimated size
      await this.validateDownloadRequest(outputDir, estimatedSizeBytes);
    } else {
      console.log(`[YouTubeDownloader] Facebook channel — skipping size estimation`);
      await this.validateDownloadRequest(outputDir);
    }

    console.log(`[YouTubeDownloader] Starting batch download: ${videos.length} videos`);

    const downloaded: string[] = [];
    const failed: Array<{ video: VideoInfo; error: string }> = [];
    const cookiePlatform = this.getCookiePlatformForUrl(url);
    const cookieContext = cookiePlatform
      ? await this.resolveCookieArgsForYtDlp(cookiePlatform, options)
      : { args: [] as string[], cleanup: () => {} };

    // Download videos sequentially
    try {
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const videoUrl = this.buildVideoUrl(video.id, url);
      console.log(`\n[YouTubeDownloader] [${i + 1}/${videos.length}] ${video.title}`);

      // Emit batch progress
      this.emit('batch-progress', {
        currentVideoIndex: i,
        totalVideos: videos.length,
        currentVideoTitle: video.title,
        currentVideoPercent: 0,
        completedVideos: downloaded.length,
        failedVideos: failed.length,
        overallPercent: (i / videos.length) * 100,
        errors: failed.map(f => ({ videoTitle: f.video.title, error: f.error }))
      } as BatchDownloadProgress);

      try {
        let outputFile: string;

        // Facebook: use direct scraper download
        if (this.isFacebookUrl(url)) {
          const reelUrl = `https://www.facebook.com/reel/${video.id}`;
          outputFile = await this.downloadFacebookVideo(reelUrl, videosFolder, {
            createChannelFolder: false,
            audioOnly: options.audioOnly,
            audioFormat: options.audioFormat,
          });
        } else {
          // Download video với custom output paths (yt-dlp)
          outputFile = await this.downloadVideoToFolder(
            videoUrl,
            videosFolder,
            thumbnailsFolder,
            quality,
            options.downloadSubtitles || false,
            options.downloadThumbnail || false,
            options.audioOnly ?? false,
            options.audioFormat ?? 'mp3',
            cookieContext.args
          );
        }

        downloaded.push(outputFile);
        console.log(`[YouTubeDownloader] ✓ Downloaded: ${video.title}`);

      } catch (error: any) {
        console.error(`[YouTubeDownloader] ✗ Failed to download: ${video.title}`, error.message);

        failed.push({
          video: video,
          error: error.message
        });

        // Continue or abort?
        if (!options.continueOnError) {
          console.log('[YouTubeDownloader] Aborting batch download due to error');
          break;
        } else {
          console.log('[YouTubeDownloader] Continuing to next video...');
        }
      }
    }
    } finally {
      cookieContext.cleanup();
    }

    // Final batch progress
    this.emit('batch-progress', {
      currentVideoIndex: videos.length,
      totalVideos: videos.length,
      currentVideoTitle: '',
      currentVideoPercent: 100,
      completedVideos: downloaded.length,
      failedVideos: failed.length,
      overallPercent: 100,
      errors: failed.map(f => ({ videoTitle: f.video.title, error: f.error }))
    } as BatchDownloadProgress);

    console.log(`\n[YouTubeDownloader] Batch download completed:`);
    console.log(`  ✓ Downloaded: ${downloaded.length}`);
    console.log(`  ✗ Failed: ${failed.length}`);
    console.log(`  📁 Channel folder: ${channelFolder}`);

    return { downloaded, failed, channelFolder };
  }

  /**
   * Download video to specific folders (videos & thumbnails separate)
   */
  private async downloadVideoToFolder(
    url: string,
    videosFolder: string,
    thumbnailsFolder: string | undefined,
    quality: Quality,
    downloadSubtitles: boolean,
    downloadThumbnail: boolean,
    audioOnly = false,
    audioFormat: 'mp3' | 'wav' = 'mp3',
    cookieArgs: string[] = []
  ): Promise<string> {
    const outputTemplate = path.join(videosFolder, '%(title)s [%(id)s].%(ext)s');

    const args = [
      '-o', outputTemplate,
      '--newline',
      '--progress',
      '--no-playlist',
      '--retries', '15',
      '--fragment-retries', '30',
      '--retry-sleep', 'http:3',
      '--retry-sleep', 'fragment:3',
      '--http-chunk-size', '10M',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--referer', 'https://www.youtube.com/',
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
      '--extractor-args', 'youtube:player_client=tv,android_vr,web_safari', // Dùng tv+android_vr để lấy đủ format cao
      '--continue', // Resume interrupted downloads
    ];

    if (audioOnly) {
      args.push(
        '-f', 'bestaudio/best',
        '--extract-audio',
        '--audio-format', audioFormat,
        '--audio-quality', '0',
        '--add-metadata'
      );
    } else {
      args.push(
        '-f', this.getQualityFormat(quality),
        '--merge-output-format', 'mp4'
      );
    }

    if (downloadSubtitles) {
      args.push('--write-subs', '--sub-lang', 'vi,en', '--embed-subs');
    }

    if (downloadThumbnail && thumbnailsFolder) {
      // Download thumbnail to separate folder as JPEG
      const thumbnailTemplate = path.join(thumbnailsFolder, '%(title)s [%(id)s].%(ext)s');

      args.push(
        '--write-thumbnail',           // Download thumbnail
        '--convert-thumbnails', 'jpg', // Convert to JPEG
        '-o', `thumbnail:${thumbnailTemplate}`, // Separate thumbnail path
        '--embed-thumbnail'            // Also embed in video
      );
    } else if (downloadThumbnail) {
      // Just embed, no separate file
      args.push(
        '--write-thumbnail',
        '--convert-thumbnails', 'jpg',
        '--embed-thumbnail'
      );
    }

    if (cookieArgs.length > 0) {
      args.push(...cookieArgs);
    }

    args.push(url);

    return new Promise((resolve, reject) => {
      const proc = spawn(this.ytDlpPath, args);
      const _procId = `dl-folder-${Date.now()}`
      this.addProcess(_procId, proc);

      let downloadedFile = '';
      let stderrBuffer = '';

      proc.stdout.on('data', (data) => {
        const output = data.toString();
        this.parseDownloadProgress(output, '');

        const destMatch = output.match(/\[download\] Destination: (.+)/);
        if (destMatch) {
          downloadedFile = destMatch[1].trim();
        }

        const mergeMatch = output.match(/\[Merger\] Merging formats into "(.+)"/);
        if (mergeMatch) {
          downloadedFile = mergeMatch[1].trim();
        }
      });

      proc.stderr.on('data', (data) => {
        const output = data.toString();
        stderrBuffer += output;
        this.parseDownloadProgress(output, '');
      });

      proc.on('close', (code) => {
        this.removeProcess(_procId);

        if (code === 0) {
          resolve(downloadedFile);
        } else {
          reject(new Error(this.formatYtDlpFailure(
            stderrBuffer,
            `yt-dlp failed with exit code ${code}`
          )));
        }
      });

      proc.on('error', (error) => {
        this.removeProcess(_procId);
        reject(error);
      });
    });
  }

  /**
   * Download channel with concurrent downloads (faster but more complex)
   */
  async downloadChannelConcurrent(
    url: string,
    outputDir: string,
    quality: Quality,
    options: {
      downloadSubtitles?: boolean;
      downloadThumbnail?: boolean;
      limit?: number;
      concurrency?: number;     // Number of parallel downloads (default: 2)
      continueOnError?: boolean;
      audioOnly?: boolean;
      audioFormat?: 'mp3' | 'wav';
      cookiesFile?: string;
      cookiesFromBrowser?: CookieBrowserSelection;
      minDurationSeconds?: number;
    } = {}
  ): Promise<{
    downloaded: string[];
    failed: Array<{ video: VideoInfo; error: string }>
  }> {
    console.log(`[YouTubeDownloader] Downloading channel (concurrent): ${url}`);

    const concurrency = options.concurrency || 2;

    // Get videos
    let videos = await this.getChannelVideos(url, options.limit);

    if (videos.length === 0) {
      throw new Error('No videos found');
    }

    if (options.minDurationSeconds && options.minDurationSeconds > 0) {
      const beforeFilter = videos.length;
      videos = videos.filter(video => !video.duration || video.duration >= options.minDurationSeconds!);
      console.log(`[YouTubeDownloader] Duration filter kept ${videos.length}/${beforeFilter} videos (min ${options.minDurationSeconds}s)`);
      if (videos.length === 0) {
        throw new Error('No videos match the minimum duration filter');
      }
    }

    console.log(`[YouTubeDownloader] Starting concurrent download: ${videos.length} videos, ${concurrency} at a time`);

    const downloaded: string[] = [];
    const failed: Array<{ video: VideoInfo; error: string }> = [];

    // Process in chunks
    for (let i = 0; i < videos.length; i += concurrency) {
      const chunk = videos.slice(i, i + concurrency);

      // Download this chunk in parallel
      const results = await Promise.allSettled(
        chunk.map(video => {
          const videoUrl = this.buildVideoUrl(video.id, url);
          return this.downloadVideo({
            url: videoUrl,
            outputDir: outputDir,
            quality: quality,
            downloadSubtitles: options.downloadSubtitles || false,
            downloadThumbnail: options.downloadThumbnail || false,
            audioOnly: options.audioOnly ?? false,
            audioFormat: options.audioFormat ?? 'mp3',
            cookiesFile: options.cookiesFile,
            cookiesFromBrowser: options.cookiesFromBrowser as any,
          }).then(file => ({ video, file }));
        })
      );

      // Process results
      results.forEach((result, idx) => {
        const video = chunk[idx];

        if (result.status === 'fulfilled') {
          downloaded.push(result.value.file);
          console.log(`[YouTubeDownloader] ✓ Downloaded: ${video.title}`);
        } else {
          failed.push({
            video: video,
            error: result.reason?.message || 'Unknown error'
          });
          console.error(`[YouTubeDownloader] ✗ Failed: ${video.title}`, result.reason?.message);

          if (!options.continueOnError) {
            throw new Error(`Download failed: ${video.title}`);
          }
        }
      });

      // Emit progress
      this.emit('batch-progress', {
        currentVideoIndex: Math.min(i + concurrency, videos.length),
        totalVideos: videos.length,
        currentVideoTitle: '',
        currentVideoPercent: 100,
        completedVideos: downloaded.length,
        failedVideos: failed.length,
        overallPercent: (Math.min(i + concurrency, videos.length) / videos.length) * 100,
        errors: failed.map(f => ({ videoTitle: f.video.title, error: f.error }))
      } as BatchDownloadProgress);
    }

    console.log(`\n[YouTubeDownloader] Concurrent download completed:`);
    console.log(`  ✓ Downloaded: ${downloaded.length}`);
    console.log(`  ✗ Failed: ${failed.length}`);

    return { downloaded, failed };
  }

  /**
   * Upscale video to 4K using FFmpeg (not yet implemented)
   * Returns early with a warning instead of throwing to avoid crashing callers.
   */
  async upscaleTo4K(_inputPath: string, _outputPath: string, _onProgress?: (percent: number) => void): Promise<void> {
    console.warn('[YouTubeDownloader] upscaleTo4K is not yet implemented — skipping')
    return
  }
}



















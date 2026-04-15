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

export class YouTubeDownloader extends EventEmitter {

  private ytDlpPath: string;
  // private ffmpegPath: string; // Reserved for future upscale feature
  // Fix P0-07: dùng Map<jobId, ChildProcess> thay vì single currentProcess
  // để hỗ trợ concurrent downloads và cancel đúng process
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private _legacyCurrentProcess: ChildProcess | null = null; // backward compat alias
  private get currentProcess(): ChildProcess | null {
    // Trả về process cuối cùng được thêm vào (backward compat)
    const values = Array.from(this.activeProcesses.values())
    return values[values.length - 1] ?? null
  }
  private set currentProcess(proc: ChildProcess | null) {
    // Legacy setter — dùng addProcess/removeProcess thay thế
    this._legacyCurrentProcess = proc
  }
  private folderManager: SafeFolderManager | null = null;
  
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
    
    // Get FFmpeg path (reserved for future upscale feature)
    // const ffmpegPaths = getFfmpegPaths();
    // this.ffmpegPath = ffmpegPaths.ffmpeg;
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
   * Check if URL is valid YouTube / SoundCloud / TikTok URL
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
        '--fragment-retries', '5',
        '--retries', '3',
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
    
    if (!(await this.verify())) {
      throw new Error(`yt-dlp not found at ${this.ytDlpPath}. Please download it from https://github.com/yt-dlp/yt-dlp/releases`);
    }
    
    // Fix: Dùng tv,android_vr,web_safari cho getVideoInfo — GIỐNG với downloadVideo()
    // android/web client cũ bị SABR block, chỉ trả về format 18 (360p muxed)
    // tv/android_vr trả đầy đủ DASH adaptive formats (1080p, 4K, etc.)
    try {
      console.log(`[YouTubeDownloader] Using tv,android_vr,web_safari client for video info...`);
      return await this.getVideoInfoWithClient(url, 'tv,android_vr,web_safari');
    } catch (error: any) {
      // Fallback: thử android,web nếu tv client fail
      console.warn(`[YouTubeDownloader] tv,android_vr,web_safari failed, trying android,web...`);
      try {
        return await this.getVideoInfoWithClient(url, 'android,web');
      } catch (fallbackError: any) {
        throw new Error(`Failed to get video info: ${fallbackError?.message || error?.message}`);
      }
    }
  }
  
  /**
   * Helper: Get video info với client cụ thể
   * REFACTORED: Hỗ trợ 'android,web' như tool Python
   */
  private async getVideoInfoWithClient(url: string, client: string): Promise<VideoInfo> {
    const args = [
      '--dump-json',
      '--no-playlist',      // Single video only (nếu URL trong playlist)
      '--skip-download',    // Don't download
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--referer', 'https://www.youtube.com/',
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
      '--extractor-args', `youtube:player_client=${client}`,
      url
    ];
    
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
          // Check for SABR streaming / challenge solving errors
          const stderrLower = stderr.toLowerCase();
          if (stderrLower.includes('sabr') || stderrLower.includes('challenge') || stderrLower.includes('format is not available') || stderrLower.includes('only images')) {
            reject(new Error(`Web client blocked: ${stderr.substring(0, 200)}`));
          } else {
            reject(new Error(`yt-dlp failed: ${stderr || 'Unknown error'}`));
          }
        }
      });
      
      proc.on('error', (error) => {
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
      '--fragment-retries', '10',
      '--retries', '5',
      '--throttled-rate', '100K',
      '--sleep-interval', '1',
      '--max-sleep-interval', '5'
    );

    // Cookies: thêm nếu user yêu cầu, nhưng KHÔNG crash nếu fail
    // (Chrome lock DB khi đang chạy — phải graceful fallback)
    let tempCookieFile: string | null = null
    if (request.cookiesFile) {
      cmd.push('--cookies', request.cookiesFile);
      console.log(`[YouTubeDownloader] Using cookies file: ${request.cookiesFile}`);
    } else if (request.cookiesFromBrowser) {
      try {
        const cookieResult = await extractCookiesFromBrowsers(
          [request.cookiesFromBrowser as any],
          'youtube.com'
        );
        if (cookieResult.success && cookieResult.cookie_file) {
          tempCookieFile = cookieResult.cookie_file
          cmd.push('--cookies', cookieResult.cookie_file);
          console.log(`[YouTubeDownloader] Using cookies from ${cookieResult.browser}`);
        } else {
          // Graceful: warn but continue without cookies
          console.warn(`[YouTubeDownloader] Could not extract cookies from ${request.cookiesFromBrowser}, downloading without cookies`);
        }
      } catch (extractError: any) {
        // Graceful: warn but continue without cookies (Chrome DB locked, etc.)
        console.warn(`[YouTubeDownloader] Cookie extraction failed (${extractError?.message}), downloading without cookies`);
      }
    }
    
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
    const cleanupTempCookie = () => {
      if (tempCookieFile) {
        try { if (fsSync.existsSync(tempCookieFile)) fsSync.unlinkSync(tempCookieFile) } catch (_) {}
        tempCookieFile = null
      }
    }
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
        cleanupTempCookie()

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
          reject(new Error(`yt-dlp failed with exit code ${code}. stderr: ${stderrBuffer.substring(0, 500)}`));
        }
      });
      
      proc.on('error', (err) => {
        this.currentProcess = null;
        cleanupTempCookie()
        reject(new Error(`Failed to start yt-dlp: ${err.message}`));
      });
    });
  }

  /**
   * Internal single-attempt downloader (extracted for retry wrapper)
   */
  private async downloadVideoWithArgsOnce(
    request: DownloadVideoRequest,
    outputTemplate: string,
    cookieArgs: string[]
  ): Promise<string> {
    const {
      url,
      quality,
      downloadSubtitles, // Legacy: giờ dùng cho tracklist
      downloadThumbnail,
      audioOnly = false,
      audioFormat = 'mp3'
    } = request;
    const downloadTracklist = request.downloadTracklist ?? downloadSubtitles; // Nếu không có downloadTracklist, dùng downloadSubtitles
    
    // Build yt-dlp arguments với bot detection bypass mạnh mẽ
    // Strategy: Thử web client trước (có format cao hơn), nếu bị chặn thì fallback về android
    // Tối ưu tốc độ download theo IDM style: multi-threaded fragments
    const args = [
      '-o', outputTemplate,
      '--newline',
      '--progress',
      '--no-playlist',
      // Retry logic - Giống hệt tool Python
      // Tool Python: --retries 3, --fragment-retries 5
      '--retries', '3',  // Giống tool Python
      '--fragment-retries', '5',  // Giống tool Python
      // IDM-style optimization: Download nhiều fragments đồng thời để tăng tốc độ
      // YouTube DASH videos được chia thành nhiều fragments, download song song sẽ nhanh hơn
      '--concurrent-fragments', '8', // Download 8 fragments đồng thời (tương tự IDM multi-threaded)
      
      // Bot detection bypass headers - Giống hệt tool Python
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--referer', 'https://www.youtube.com/',
      '--add-header', 'Accept-Language:vi-VN,vi;q=0.9,en;q=0.8',  // Giống tool Python
      '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',  // Giống tool Python
      '--add-header', 'Sec-Fetch-Dest:document',  // Giống tool Python
      '--add-header', 'Sec-Fetch-Mode:navigate',  // Giống tool Python
      '--add-header', 'Sec-Fetch-Site:none',  // Giống tool Python
      '--add-header', 'Sec-Fetch-User:?1',  // Giống tool Python
      '--no-check-certificate',
      '--ignore-errors',
      '--no-warnings',
    ];
    
    // Strategy: Đơn giản hóa như tool Python - CHỈ dùng android,web client
    // Tool Python thành công vì đơn giản: không cookies, không phức tạp
    // Bug fix: dùng tv,android_vr,web_safari — có DASH 4K, không PO token, không bị SABR
    // (Theo yt-dlp docs 2025: tv client stable nhất, android_vr backup, web_safari cho HLS)
    args.push('--extractor-args', 'youtube:player_client=tv,android_vr,web_safari');
    args.push('--throttled-rate', '100K');
    args.push('--sleep-interval', '1');
    args.push('--max-sleep-interval', '5');
    args.push('--continue'); // Resume interrupted downloads
    
    // Thêm cookies nếu có (chỉ khi user cung cấp)
    if (cookieArgs.length > 0) {
      args.push(...cookieArgs);
      console.log(`[YouTubeDownloader] Using android,web client with cookies (like Python tool)`);
    } else {
      console.log(`[YouTubeDownloader] Using android,web client (no cookies) - simple and stable like Python tool`);
    }
    
    // Platform-specific options
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    this.addPlatformSpecificOptions(args, hostname);

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
    
    // Add subtitle options - Giống tool Python
    if (downloadSubtitles) {
      args.push(
        '--write-subs',         // Download subtitles
        '--sub-langs', 'vi,en,zh',  // Vietnamese, English, Chinese (giống tool Python)
        '--convert-subs', 'srt'  // Convert to SRT format (giống tool Python)
      );
    }
    
    // Add thumbnail options - FIX: Convert to JPEG
    if (downloadThumbnail) {
      args.push(
        '--write-thumbnail',           // Download thumbnail
        '--convert-thumbnails', 'jpg', // Convert to JPEG format
        '--embed-thumbnail'            // Embed into file
      );
    }
    
    // Add URL
    args.push(url);
    
    console.log(`[YouTubeDownloader] yt-dlp args:`, args);
    console.log(`[YouTubeDownloader] Full command: ${this.ytDlpPath} ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);
    
    // Verify yt-dlp exists before spawning
    try {
      await fs.access(this.ytDlpPath);
    } catch (error) {
      throw new Error(`yt-dlp not found at ${this.ytDlpPath}. Please ensure yt-dlp is installed.`);
    }
    
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ytDlpPath, args);
      this.currentProcess = proc; // Store for cancellation
      
      let downloadedFile = '';
      let currentTitle = '';
      let stderrBuffer = '';
      
      proc.stdout.on('data', (data) => {
        const output = data.toString();
        
        // Log output
        console.log('[yt-dlp]', output.trim());
        
        // Debug: Log format selection info
        if (output.includes('[format]') || output.includes('format selection') || output.includes('Selected format')) {
          console.log('[YouTubeDownloader] Format selection info:', output.trim());
        }
        
        // Debug: Log which format ID is being downloaded
        const formatIdMatch = output.match(/\[download\]\s+Format\s+(\d+)/i);
        if (formatIdMatch) {
          console.log(`[YouTubeDownloader] Downloading format ID: ${formatIdMatch[1]}`);
        }
        
        // Parse progress
        this.parseDownloadProgress(output, currentTitle);
        
        // Extract destination file
        const destMatch = output.match(/\[download\] Destination: (.+)/);
        if (destMatch) {
          downloadedFile = destMatch[1].trim();
        }
        
        // Extract merged file (final output)
        const mergeMatch = output.match(/\[Merger\] Merging formats into "(.+)"/);
        if (mergeMatch) {
          downloadedFile = mergeMatch[1].trim();
        }
        
        // Extract title from destination
        if (downloadedFile && !currentTitle) {
          const titleMatch = downloadedFile.match(/(.+?)\s+\[/);
          if (titleMatch) {
            currentTitle = titleMatch[1].trim();
          }
        }
      });
      
      proc.stderr.on('data', (data) => {
        const output = data.toString();
        stderrBuffer += output;
        console.log('[yt-dlp stderr]', output.trim());
        
        // yt-dlp outputs progress to stderr sometimes
        this.parseDownloadProgress(output, currentTitle);
        
        // Extract destination from stderr too
        const destMatch = output.match(/\[download\] Destination: (.+)/);
        if (destMatch) {
          downloadedFile = destMatch[1].trim();
        }
        
        // Extract merged file (final output) from stderr
        const mergeMatch = output.match(/\[Merger\] Merging formats into "(.+)"/);
        if (mergeMatch) {
          downloadedFile = mergeMatch[1].trim();
        }
        
        // Extract final file after merge (yt-dlp sometimes outputs this)
        const finalMatch = output.match(/\[download\]\s+100% of\s+[\d.]+\s*\w+\s+in\s+[\d:]+ at\s+[\d.]+\s*\w+\/s/i);
        if (finalMatch && downloadedFile) {
          // File đã download xong
          console.log(`[YouTubeDownloader] Download completed (from stderr): ${downloadedFile}`);
        }
      });
      
      proc.on('close', async (code) => {
        this.currentProcess = null; // Clear reference
        
        if (code === 0) {
          // Nếu chưa có downloadedFile, thử tìm trong output directory
          if (!downloadedFile) {
            console.warn(`[YouTubeDownloader] Downloaded file path not found, trying to locate in output directory...`);
            // Có thể file đã được merge và tên đã thay đổi
            // yt-dlp sẽ tự động merge và xóa file tạm
          }
          
          console.log(`[YouTubeDownloader] Download completed with exit code 0: ${downloadedFile || 'file path not captured'}`);
          
          // Phase 3: Download tracklist nếu có
          if (downloadTracklist && downloadedFile) {
            try {
              // Lấy thông tin video để lấy description
              const videoInfo = await this.getVideoInfo(url);
              if (videoInfo.description) {
                const tracklist = detectTracklist(videoInfo.description);
                if (tracklist && tracklist.items.length > 0) {
                  // Tạo file tracklist
                  const tracklistText = formatTracklistForFile(tracklist);
                  const tracklistPath = path.join(
                    path.dirname(downloadedFile),
                    path.basename(downloadedFile, path.extname(downloadedFile)) + '_tracklist.txt'
                  );
                  await fs.writeFile(tracklistPath, tracklistText, 'utf-8');
                  console.log(`[YouTubeDownloader] Tracklist saved: ${tracklistPath} (${tracklist.items.length} tracks)`);
                  
                  this.emit('progress', {
                    type: 'info',
                    message: `Tracklist đã được lưu: ${path.basename(tracklistPath)}`
                  } as DownloadProgress);
                } else {
                  console.log(`[YouTubeDownloader] No tracklist found in video description`);
                }
              }
            } catch (error: any) {
              console.warn(`[YouTubeDownloader] Failed to download tracklist:`, error.message);
              // Không throw error, chỉ log warning
            }
          }
          
          // Nếu chưa có downloadedFile, thử tìm file cuối cùng trong output directory
          if (!downloadedFile) {
            console.warn(`[YouTubeDownloader] Downloaded file path not captured, trying to find in output directory...`);
            try {
              // Thử tìm file mới nhất trong output directory
              const outputDir = path.dirname(outputTemplate.replace(/%(uploader|title|id|ext)s/g, '*'));
              const files = await fs.readdir(outputDir);
              const videoFiles = files.filter(f => /\.(mp4|mkv|webm|avi)$/i.test(f));
              if (videoFiles.length > 0) {
                // Lấy file mới nhất
                const stats = await Promise.all(
                  videoFiles.map(f => fs.stat(path.join(outputDir, f)).then(s => ({ file: f, mtime: s.mtime })))
                );
                stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
                downloadedFile = path.join(outputDir, stats[0].file);
                console.log(`[YouTubeDownloader] Found downloaded file: ${downloadedFile}`);
              }
            } catch (error) {
              console.warn(`[YouTubeDownloader] Could not find downloaded file:`, error);
            }
          }
          
          // Emit completion event
          this.emit('progress', {
            type: 'complete',
            message: 'Download completed',
            percent: 100
          } as DownloadProgress);
          
          // Resolve với file path (có thể là empty nếu không tìm thấy, nhưng vẫn thành công)
          resolve(downloadedFile || outputTemplate.replace(/%(uploader|title|id|ext)s/g, 'unknown'));
        } else {
          // Check for common error patterns
          const stderrText = stderrBuffer || '';
          let errorMsg = `yt-dlp failed with exit code ${code}`;
          
          // Log full stderr for debugging
          console.error(`[YouTubeDownloader] yt-dlp stderr (full):`, stderrText);
          
          // Detect format not available errors
          if (stderrText.includes('requested format is not available') ||
              stderrText.includes('format is not available') ||
              stderrText.includes('No video formats found') ||
              stderrText.includes('format selection returned no format')) {
            errorMsg = `Format không tồn tại!\n\n` +
                      `Video không có format ${quality}p như bạn đã chọn.\n` +
                      `Vui lòng:\n` +
                      `1. Chọn quality thấp hơn (720p, 480p, hoặc "Tốt nhất")\n` +
                      `2. Hoặc để tool tự động tải quality cao nhất có sẵn\n\n` +
                      `Lỗi chi tiết: ${stderrText.substring(0, 500)}`;
          }
          // Detect bot verification errors
          else if (stderrText.includes('Please sign in to confirm you are not a bot') ||
              stderrText.includes('Sign in to confirm your age') ||
              stderrText.includes('unable to extract') ||
              stderrText.includes('Private video') ||
              stderrText.includes('Video unavailable') ||
              stderrText.includes('HTTP Error 403') ||
              stderrText.includes('HTTP Error 429')) {
            errorMsg = `YouTube yêu cầu xác minh. Tool đã tự động thử cookies từ Chrome/Firefox/Edge nhưng vẫn bị chặn.\n\n` +
                      `Vui lòng:\n` +
                      `1. Mở trình duyệt Chrome/Firefox/Edge và đăng nhập YouTube\n` +
                      `2. Đảm bảo bạn đã xem video trên YouTube ít nhất 1 lần\n` +
                      `3. Đợi vài phút rồi thử lại\n\n` +
                      `Lỗi chi tiết: ${stderrText.substring(0, 500)}`;
          }
          // Detect network errors
          else if (stderrText.includes('network') ||
              stderrText.includes('timeout') ||
              stderrText.includes('connection') ||
              stderrText.includes('HTTP Error 5') ||
              stderrText.includes('HTTP Error 50')) {
            errorMsg = `Lỗi kết nối!\n\n` +
                      `Không thể kết nối đến YouTube.\n` +
                      `Vui lòng:\n` +
                      `1. Kiểm tra kết nối internet\n` +
                      `2. Thử lại sau vài phút\n\n` +
                      `Lỗi chi tiết: ${stderrText.substring(0, 500)}`;
          }
          // Generic error with full stderr
          else {
            errorMsg = `yt-dlp failed with exit code ${code}\n\n` +
                      `Lỗi chi tiết:\n${stderrText.substring(0, 1000)}`;
          }
          
          this.emit('progress', {
            type: 'error',
            message: errorMsg
          } as DownloadProgress);
          reject(new Error(errorMsg));
        }
      });
      
      proc.on('error', (error) => {
        this.currentProcess = null;
        const errorMsg = `Failed to spawn yt-dlp: ${error.message}`;
        this.emit('progress', {
          type: 'error',
          message: errorMsg
        } as DownloadProgress);
        reject(new Error(errorMsg));
      });
    });
  }
  
  /**
   * Get list of videos from channel or playlist
   */
  async getChannelVideos(url: string, limit?: number): Promise<VideoInfo[]> {
    console.log(`[YouTubeDownloader] Getting channel/playlist videos: ${url}`);
    console.log(`  Limit: ${limit || 'unlimited'}`);
    
    if (!(await this.verify())) {
      throw new Error(`yt-dlp not found at ${this.ytDlpPath}. Please download it from https://github.com/yt-dlp/yt-dlp/releases`);
    }
    
    const args = [
      '--flat-playlist',      // Fast extraction (don't get full info)
      '--dump-json',          // Output JSON
      '--skip-download',      // Don't download
      url
    ];
    
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
          reject(new Error(`yt-dlp failed: ${stderr || `Exit code ${code}`}`));
        }
      });
      
      proc.on('error', (error) => {
        console.error('[YouTubeDownloader] Process error:', error);
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
    
    if (!(await this.verify())) {
      throw new Error(`yt-dlp not found at ${this.ytDlpPath}. Please download it from https://github.com/yt-dlp/yt-dlp/releases`);
    }
    
    try {
      // Method 1: Try to extract channel name from URL first
      let channelNameFromUrl = '';
      const urlMatch = url.match(/youtube\.com\/@([^\/\?]+)/);
      if (urlMatch) {
        channelNameFromUrl = urlMatch[1];
        console.log(`[YouTubeDownloader] Extracted from URL: ${channelNameFromUrl}`);
      }
      
      // Method 2: Get first video with full info (not flat-playlist) to get channel name
      console.log(`[YouTubeDownloader] Step 1: Getting first video with full info...`);
      let channelName = channelNameFromUrl;
      
      try {
        // Get first video URL from flat playlist
        const firstVideos = await this.getChannelVideos(url, 1);
        
        if (firstVideos.length > 0) {
          const firstVideoId = firstVideos[0].id;
          const firstVideoUrl = `https://www.youtube.com/watch?v=${firstVideoId}`;
          
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
    const videos = await this.getChannelVideos(url, options.limit);
    
    if (videos.length === 0) {
      throw new Error('Không tìm thấy video nào trong channel/playlist');
    }
    
    // Estimate size
    const { formatBytes } = await import('../utils/diskSpace');
    const estimate = await this.estimateChannelSize(url, quality, options.limit);
    console.log(`[YouTubeDownloader] Estimated download size: ${formatBytes(estimate.estimatedSizeBytes)}`);
    
    // Validate disk space với estimated size
    await this.validateDownloadRequest(outputDir, estimate.estimatedSizeBytes);
    
    console.log(`[YouTubeDownloader] Starting batch download: ${videos.length} videos`);
    
    const downloaded: string[] = [];
    const failed: Array<{ video: VideoInfo; error: string }> = [];
    
    // Download videos sequentially
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
      
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
        // Download video với custom output paths
        const outputFile = await this.downloadVideoToFolder(
          videoUrl,
          videosFolder,
          thumbnailsFolder,
          quality,
          options.downloadSubtitles || false,
          options.downloadThumbnail || false,
          options.audioOnly ?? false,
          options.audioFormat ?? 'mp3'
        );
        
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
    audioFormat: 'mp3' | 'wav' = 'mp3'
  ): Promise<string> {
    const outputTemplate = path.join(videosFolder, '%(title)s [%(id)s].%(ext)s');
    
    const args = [
      '-o', outputTemplate,
      '--newline',
      '--progress',
      '--no-playlist',
      '--retries', '5',
      '--fragment-retries', '5',
      '--retry-sleep', '2',
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
    
    args.push(url);
    
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ytDlpPath, args);
      this.currentProcess = proc;
      
      let downloadedFile = '';
      
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
        this.parseDownloadProgress(data.toString(), '');
      });
      
      proc.on('close', (code) => {
        this.currentProcess = null;
        
        if (code === 0) {
          resolve(downloadedFile);
        } else {
          reject(new Error(`yt-dlp failed with exit code ${code}`));
        }
      });
      
      proc.on('error', (error) => {
        this.currentProcess = null;
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
    } = {}
  ): Promise<{ 
    downloaded: string[]; 
    failed: Array<{ video: VideoInfo; error: string }> 
  }> {
    console.log(`[YouTubeDownloader] Downloading channel (concurrent): ${url}`);
    
    const concurrency = options.concurrency || 2;
    
    // Get videos
    const videos = await this.getChannelVideos(url, options.limit);
    
    if (videos.length === 0) {
      throw new Error('No videos found');
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
          const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
          
          return this.downloadVideo({
            url: videoUrl,
            outputDir: outputDir,
            quality: quality,
            downloadSubtitles: options.downloadSubtitles || false,
            downloadThumbnail: options.downloadThumbnail || false,
            audioOnly: options.audioOnly ?? false,
            audioFormat: options.audioFormat ?? 'mp3'
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



















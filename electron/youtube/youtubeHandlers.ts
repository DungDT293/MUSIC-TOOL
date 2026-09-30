import { ipcMain, BrowserWindow, dialog } from 'electron';
import { YouTubeDownloader } from '../../backend/youtube/youtubeDownloader';
import { jobQueue } from '../../backend/jobQueue/jobQueue';
import { 
  DownloadVideoRequest, 
  VideoInfo, 
  Quality,
  DownloadProgress,
  BatchDownloadProgress,
  SpotifyYouTubeDownloadRequest,
} from '../../backend/youtube/types';
import { isValidAbsolutePath } from '../authState';
import type { CookieEntry } from '../../backend/youtube/cookieManager';

// Global downloader instance
let downloader: YouTubeDownloader | null = null;
let currentYoutubeJobId: string | null = null;
let youtubeHandlersRegistered = false; // FIX M20: Guard against double-registration

export function getSpotifyCookieString(): string | undefined {
  const cookies = downloader?.getCookieManager().getCookieString('spotify');
  return cookies || undefined;
}

export function getSpotifyCookies(): CookieEntry[] {
  return downloader?.getCookieManager().getCookies('spotify') ?? [];
}

const RETRYABLE_YTDLP_ERROR_PATTERNS = [
  /bytes read,\s*\d+\s*more expected/i,
  /got error:\s*\d+\s*bytes read/i,
  /giving up after \d+ retries/i,
  /timed?\s*out/i,
  /timeout/i,
  /connection (?:reset|aborted|closed)/i,
  /econnreset/i,
  /network/i,
  /http error 5\d\d/i,
];

function isRetryableYtDlpError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return RETRYABLE_YTDLP_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Initialize YouTube downloader và setup IPC handlers.
 * Safe to call multiple times (macOS dock-icon re-launch calls createWindow() again).
 * On second+ call: cleans up old handlers first, then re-registers with fresh mainWindow.
 */
export function setupYouTubeHandlers(mainWindow: BrowserWindow) {
  console.log('[IPC] Setting up YouTube handlers...');

  // FIX M20: If handlers are already registered (macOS re-launch), clean up first
  // to avoid "Attempted to register a second handler" crash.
  if (youtubeHandlersRegistered) {
    console.log('[IPC] YouTube handlers already registered — cleaning up before re-registering...');
    cleanupYouTubeHandlers();
  }
  
  // Create downloader instance
  downloader = new YouTubeDownloader();
  
  // Forward progress events to renderer
  downloader.on('progress', (progress: DownloadProgress) => {
    mainWindow.webContents.send('youtube:progress', progress);
  });
  
  downloader.on('batch-progress', (progress: BatchDownloadProgress) => {
    mainWindow.webContents.send('youtube:batch-progress', progress);
  });
  
  // ============================================
  // Handler: Verify yt-dlp
  // ============================================
  ipcMain.handle('youtube:verify', async () => {
    try {
      if (!downloader) {
        throw new Error('Downloader not initialized');
      }
      
      const isAvailable = await downloader.verify();
      
      return {
        success: true,
        available: isAvailable
      };
    } catch (error: any) {
      console.error('[IPC] youtube:verify error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });
  
  // ============================================
  // Handler: Validate URL
  // ============================================
  ipcMain.handle('youtube:validate-url', async (event, url: string) => {
    try {
      if (!downloader) {
        throw new Error('Downloader not initialized');
      }
      
      const isValid = downloader.isValidYouTubeUrl(url);
      const type = downloader.detectUrlType(url);
      
      return {
        success: true,
        isValid: isValid,
        type: type
      };
    } catch (error: any) {
      console.error('[IPC] youtube:validate-url error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });
  
  // ============================================
  // Handler: Get video info
  // ============================================
  ipcMain.handle('youtube:get-video-info', async (event, url: string) => {
    try {
      if (!downloader) {
        throw new Error('Downloader not initialized');
      }
      if (typeof url !== 'string' || !downloader.isValidYouTubeUrl(url)) {
        throw new Error('URL không được hỗ trợ hoặc không hợp lệ.')
      }

      const videoInfo = await downloader.getVideoInfo(url);
      
      return {
        success: true,
        videoInfo: videoInfo
      };
    } catch (error: any) {
      console.error('[IPC] youtube:get-video-info error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });
  
  // ============================================
  // Handler: Get channel info
  // ============================================
  ipcMain.handle('youtube:get-channel-info', async (event, url: string) => {
    try {
      if (!downloader) {
        throw new Error('Downloader not initialized');
      }
      if (typeof url !== 'string' || !downloader.isValidYouTubeUrl(url)) {
        throw new Error('URL không được hỗ trợ hoặc không hợp lệ.')
      }

      const channelInfo = await downloader.getChannelInfo(url);
      
      return {
        success: true,
        channelInfo: channelInfo
      };
    } catch (error: any) {
      console.error('[IPC] youtube:get-channel-info error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });
  
  // ============================================
  // Handler: Get channel videos
  // ============================================
  ipcMain.handle('youtube:get-channel-videos', async (event, url: string, limit?: number) => {
    try {
      if (!downloader) {
        throw new Error('Downloader not initialized');
      }
      if (typeof url !== 'string' || !downloader.isValidYouTubeUrl(url)) {
        throw new Error('URL không được hỗ trợ hoặc không hợp lệ.')
      }

      const videos = await downloader.getChannelVideos(url, limit);
      
      return {
        success: true,
        videos: videos
      };
    } catch (error: any) {
      console.error('[IPC] youtube:get-channel-videos error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });
  
  // ============================================
  // Handler: Estimate channel size
  // ============================================
  ipcMain.handle(
    'youtube:estimate-channel-size', 
    async (event, url: string, quality: Quality, limit?: number) => {
      try {
        if (!downloader) {
          throw new Error('Downloader not initialized');
        }
        if (typeof url !== 'string' || !downloader.isValidYouTubeUrl(url)) {
          throw new Error('URL không được hỗ trợ hoặc không hợp lệ.')
        }

        const estimate = await downloader.estimateChannelSize(url, quality, limit);
        
        return {
          success: true,
          estimate: estimate
        };
      } catch (error: any) {
        console.error('[IPC] youtube:estimate-channel-size error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  );
  
  // ============================================
  // Handler: Download single video
  // ============================================
  ipcMain.handle('youtube:download-video', async (_event, request: DownloadVideoRequest) => {
    try {
      if (!downloader) {
        throw new Error('Downloader not initialized');
      }
      const activeDownloader = downloader;
      console.log('[IPC] Starting video download:', request);

      const jobHandle = jobQueue.enqueue<string>({
        type: 'youtube:download-video',
        payload: { url: request.url, quality: request.quality },
        onCancel: () => activeDownloader.cancelDownload(),
        task: async (ctx) => {
          currentYoutubeJobId = ctx.jobId;
          const progressListener = (progress: DownloadProgress) => {
            const percent = progress.percent ?? (progress.type === 'complete' ? 100 : 0);
            ctx.updateProgress(percent, progress.message ?? progress.type);
          };

          activeDownloader.on('progress', progressListener);

          try {
            let lastError: unknown;

            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                if (attempt > 1) {
                  ctx.updateProgress(0, `Thử tải lại lần ${attempt}/3...`);
                }

                const outputFile = await activeDownloader.downloadVideo(request);
                ctx.updateProgress(100, 'Download completed');
                return outputFile;
              } catch (error) {
                lastError = error;

                if (ctx.signal.aborted || attempt >= 3 || !isRetryableYtDlpError(error)) {
                  throw error;
                }

                const waitMs = attempt * 3000;
                console.warn(
                  `[IPC] Retryable yt-dlp error, retrying ${attempt + 1}/3 after ${waitMs}ms:`,
                  error
                );
                ctx.updateProgress(0, `Lỗi mạng/fragment, thử lại sau ${Math.round(waitMs / 1000)}s...`);
                await sleep(waitMs);
              }
            }

            throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Download failed'));
          } finally {
            currentYoutubeJobId = null;
            activeDownloader.off('progress', progressListener);
          }
        },
      });

      const outputFile = await jobHandle.result;

      return {
        success: true,
        outputFile,
      };
    } catch (error: any) {
      console.error('[IPC] youtube:download-video error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });
  
  // ============================================
  // Handler: Download Spotify metadata matches from accessible YouTube sources
  // ============================================
  ipcMain.handle('youtube:download-spotify', async (_event, request: SpotifyYouTubeDownloadRequest) => {
    try {
      if (!downloader) throw new Error('Downloader not initialized');
      if (!request || !isValidAbsolutePath(request.outputDir)) throw new Error('Invalid output directory path');
      if (request.cookiesFile && !isValidAbsolutePath(request.cookiesFile)) throw new Error('Invalid cookies file path');
      if (request.cookiesFromBrowser && !['auto', 'chrome', 'firefox', 'edge', 'opera', 'safari', 'brave', 'chromium', 'vivaldi'].includes(request.cookiesFromBrowser)) {
        throw new Error('Invalid browser cookie source');
      }
      if (!Array.isArray(request.tracks) || request.tracks.length === 0 || request.tracks.length > 500 || request.tracks.some((track) =>
        !track || typeof track.id !== 'string' || track.id.length > 200 || typeof track.name !== 'string' || track.name.length > 500 ||
        !Array.isArray(track.artists) || track.artists.length > 20 || track.artists.some((artist) => typeof artist !== 'string' || artist.length > 200)
      )) {
        throw new Error('Spotify track list must contain 1-500 valid tracks');
      }
      const activeDownloader = downloader;
      const jobHandle = jobQueue.enqueue({
        type: 'youtube:download-spotify',
        payload: { trackCount: request.tracks.length },
        onCancel: () => activeDownloader.cancelDownload(),
        task: async (ctx) => {
          const progressListener = (progress: BatchDownloadProgress) => {
            ctx.updateProgress(progress.overallPercent, progress.currentVideoTitle || 'Spotify download');
          };
          activeDownloader.on('batch-progress', progressListener);
          try {
            return await activeDownloader.downloadSpotifyTracks(request);
          } finally {
            activeDownloader.off('batch-progress', progressListener);
          }
        },
      });
      const result = await jobHandle.result;
      return { success: true, result };
    } catch (error: any) {
      console.error('[IPC] youtube:download-spotify error:', error?.message || 'unknown error');
      return { success: false, error: error?.message || 'Spotify download failed' };
    }
  });

  // ============================================
  // Handler: Download channel
  // ============================================
  ipcMain.handle(
    'youtube:download-channel',
    async (event, params: {
      url: string;
      outputDir: string;
      quality: Quality;
      options: {
        downloadSubtitles?: boolean;
        downloadThumbnail?: boolean;
        limit?: number;
        continueOnError?: boolean;
        concurrent?: boolean;
        concurrency?: number;
        audioOnly?: boolean;
        audioFormat?: 'mp3' | 'wav';
        cookiesFile?: string;
        cookiesFromBrowser?: any;
        minDurationSeconds?: number;
      };
    }) => {
      try {
        if (!downloader) {
          throw new Error('Downloader not initialized');
        }
        const activeDownloader = downloader;

        console.log('[IPC] Starting channel download:', params);

        const jobHandle = jobQueue.enqueue<{
          downloaded: string[];
          failed: Array<{ video: VideoInfo; error: string }>;
        }>({
          type: 'youtube:download-channel',
          payload: { url: params.url, limit: params.options.limit },
          onCancel: () => activeDownloader.cancelDownload(),
          task: async (ctx) => {
            currentYoutubeJobId = ctx.jobId;
            const progressListener = (progress: DownloadProgress) => {
              const percent = progress.percent ?? 0;
              ctx.updateProgress(percent, progress.message ?? progress.type);
            };
            const batchListener = (batch: BatchDownloadProgress) => {
              const percent = batch.overallPercent ?? 0;
              ctx.updateProgress(percent, `Channel: ${batch.currentVideoTitle}`);
            };

            activeDownloader.on('progress', progressListener);
            activeDownloader.on('batch-progress', batchListener);

            try {
              const result = params.options.concurrent
                ? await activeDownloader.downloadChannelConcurrent(
                    params.url,
                    params.outputDir,
                    params.quality,
                    params.options
                  )
                : await activeDownloader.downloadChannel(
                    params.url,
                    params.outputDir,
                    params.quality,
                    params.options
                  );
              ctx.updateProgress(100, 'Channel download completed');
              return result;
            } finally {
              currentYoutubeJobId = null;
              activeDownloader.off('progress', progressListener);
              activeDownloader.off('batch-progress', batchListener);
            }
          },
        });

        const result = await jobHandle.result;

        return {
          success: true,
          downloaded: result.downloaded,
          failed: result.failed,
        };
      } catch (error: any) {
        console.error('[IPC] youtube:download-channel error:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }
  );
  
  // ============================================
  // Handler: Cancel download
  // ============================================
  ipcMain.handle('youtube:cancel-download', async () => {
    try {
      if (!downloader) {
        throw new Error('Downloader not initialized');
      }
      if (currentYoutubeJobId) {
        await jobQueue.cancelJob(currentYoutubeJobId);
      } else {
        downloader.cancelDownload();
      }
      
      return {
        success: true
      };
    } catch (error: any) {
      console.error('[IPC] youtube:cancel-download error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });
  
  // ============================================
  // Handler: Update yt-dlp
  // ============================================
  ipcMain.handle('youtube:update-ytdlp', async () => {
    try {
      if (!downloader) throw new Error('Downloader not initialized');
      const result = await downloader.updateYtDlp();
      return result;
    } catch (error: any) {
      console.error('[IPC] youtube:update-ytdlp error:', error);
      return { success: false, message: error.message };
    }
  });

  // ============================================
  // Cookie Management Handlers
  // ============================================

  // Import cookie file (file dialog)
  ipcMain.handle('youtube:cookie-import', async (_event, filePath?: string) => {
    try {
      if (!downloader) throw new Error('Downloader not initialized');

      let cookieFilePath = filePath;

      // If no path provided, open file dialog
      if (!cookieFilePath) {
        const result = await dialog.showOpenDialog(mainWindow, {
          title: 'Chọn file cookies JSON (J2Team Cookies)',
          filters: [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, error: 'Cancelled' };
        }
        cookieFilePath = result.filePaths[0];
      }

      const cookieManager = downloader.getCookieManager();
      const cookieFile = await cookieManager.importCookieFile(cookieFilePath!);

      // If Facebook cookies, refresh scraper
      if (cookieFile.platform === 'facebook') {
        downloader.refreshFacebookCookies();
      }

      return { success: true, cookieFile };
    } catch (error: any) {
      console.error('[IPC] youtube:cookie-import error:', error);
      return { success: false, error: error.message };
    }
  });

  // List all cookie files
  ipcMain.handle('youtube:cookie-list', async () => {
    try {
      if (!downloader) throw new Error('Downloader not initialized');
      const cookieManager = downloader.getCookieManager();
      return { success: true, cookieFiles: cookieManager.getCookieFiles() };
    } catch (error: any) {
      return { success: false, error: error.message, cookieFiles: [] };
    }
  });

  // Test cookies for a platform
  ipcMain.handle('youtube:cookie-test', async (_event, platform: string) => {
    try {
      if (!downloader) throw new Error('Downloader not initialized');
      const cookieManager = downloader.getCookieManager();
      const result = await cookieManager.testCookies(platform);
      return { success: true, result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Remove cookie file
  ipcMain.handle('youtube:cookie-remove', async (_event, id: string) => {
    try {
      if (!downloader) throw new Error('Downloader not initialized');
      const cookieManager = downloader.getCookieManager();
      const removed = cookieManager.removeCookieFile(id);
      return { success: removed };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Check if platform has cookies
  ipcMain.handle('youtube:cookie-has', async (_event, platform: string) => {
    try {
      if (!downloader) throw new Error('Downloader not initialized');
      const cookieManager = downloader.getCookieManager();
      return { success: true, hasCookies: cookieManager.hasCookies(platform) };
    } catch (error: any) {
      return { success: false, hasCookies: false };
    }
  });

  console.log('[IPC] YouTube handlers setup complete')
  youtubeHandlersRegistered = true; // FIX M20: Mark as registered

  // ── Auto-update yt-dlp on startup (background, silent) ──────────────────────
  // Chạy sau 5s để không block startup UI
  setTimeout(async () => {
    if (!downloader) return
    try {
      const version = await downloader.getVersion()
      // yt-dlp version format: YYYY.MM.DD (e.g. "2025.03.15")
      const match = version.match(/(\d{4})\.(\d{2})\.(\d{2})/)
      if (!match) return

      const versionDate = new Date(`${match[1]}-${match[2]}-${match[3]}`)
      const ageMs = Date.now() - versionDate.getTime()
      const ageDays = Math.floor(ageMs / 86_400_000)

      if (ageDays >= 30) {
        console.log(`[yt-dlp] Version ${version} is ${ageDays} days old — auto-updating silently...`)
        const result = await downloader.updateYtDlp()
        if (result.success) {
          console.log(`[yt-dlp] Auto-update success: ${result.message}`)
          // Notify renderer về update thành công
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('youtube:ytdlp-auto-updated', {
              success: true,
              version: result.version,
              ageDays,
              message: result.message,
            })
          }
        } else {
          console.warn(`[yt-dlp] Auto-update failed (non-blocking): ${result.message}`)
        }
      } else {
        console.log(`[yt-dlp] Version ${version} is ${ageDays} days old — no update needed`)
        // Hiển thị warning nếu > 15 ngày (nhưng chưa 30)
        if (ageDays >= 15 && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('youtube:ytdlp-age-warning', {
            version,
            ageDays,
          })
        }
      }
    } catch (err: any) {
      console.warn('[yt-dlp] Auto-update check failed (non-blocking):', err?.message)
    }
  }, 5000)
}

/**
 * Cleanup YouTube handlers
 */
export function cleanupYouTubeHandlers() {
  console.log('[IPC] Cleaning up YouTube handlers...');

  if (downloader) {
    try { downloader.cancelDownload() } catch (error: any) {
      console.warn('[IPC] Failed to cancel YouTube processes during cleanup:', error?.message || error)
    }
    downloader.removeAllListeners();
    downloader = null;
  }

  // Remove IPC handlers — wrap each in try/catch to avoid crash if already removed
  const channels = [
    'youtube:verify',
    'youtube:validate-url',
    'youtube:get-video-info',
    'youtube:get-channel-info',
    'youtube:get-channel-videos',
    'youtube:estimate-channel-size',
    'youtube:download-video',
    'youtube:download-spotify',
    'youtube:download-channel',
    'youtube:cancel-download',
    'youtube:update-ytdlp',
    // Cookie management
    'youtube:cookie-import',
    'youtube:cookie-list',
    'youtube:cookie-test',
    'youtube:cookie-remove',
    'youtube:cookie-has',
  ];
  for (const ch of channels) {
    try { ipcMain.removeHandler(ch); } catch (_) {}
  }

  youtubeHandlersRegistered = false; // FIX M20: Reset flag
  console.log('[IPC] YouTube handlers cleaned up');
}


















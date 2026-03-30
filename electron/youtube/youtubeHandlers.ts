import { ipcMain, BrowserWindow } from 'electron';
import { YouTubeDownloader } from '../../backend/youtube/youtubeDownloader';
import { jobQueue } from '../../backend/jobQueue/jobQueue';
import { 
  DownloadVideoRequest, 
  VideoInfo, 
  Quality,
  DownloadProgress,
  BatchDownloadProgress
} from '../../backend/youtube/types';

// Global downloader instance
let downloader: YouTubeDownloader | null = null;
let currentYoutubeJobId: string | null = null;

/**
 * Initialize YouTube downloader và setup IPC handlers
 */
export function setupYouTubeHandlers(mainWindow: BrowserWindow) {
  console.log('[IPC] Setting up YouTube handlers...');
  
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
            const outputFile = await activeDownloader.downloadVideo(request);
            ctx.updateProgress(100, 'Download completed');
            return outputFile;
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

  console.log('[IPC] YouTube handlers setup complete')

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
    downloader.removeAllListeners();
    downloader = null;
  }
  
  // Remove IPC handlers
  ipcMain.removeHandler('youtube:verify');
  ipcMain.removeHandler('youtube:validate-url');
  ipcMain.removeHandler('youtube:get-video-info');
  ipcMain.removeHandler('youtube:get-channel-info');
  ipcMain.removeHandler('youtube:get-channel-videos');
  ipcMain.removeHandler('youtube:estimate-channel-size');
  ipcMain.removeHandler('youtube:download-video');
  ipcMain.removeHandler('youtube:download-channel');
  ipcMain.removeHandler('youtube:update-ytdlp');
  
  console.log('[IPC] YouTube handlers cleaned up');
}


















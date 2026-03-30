import React, { useState, useEffect, useRef } from 'react';
import { 
  YouTubeQuality, 
  YouTubeVideoInfo, 
  YouTubeDownloadProgress, 
  YouTubeBatchDownloadProgress,
  YouTubeDownloadVideoRequest
} from '../../types/ipc';
import './YouTubeDownloaderTab.css';

export function YouTubeDownloaderTab() {
  // ============================================
  // State
  // ============================================
  const [url, setUrl] = useState('');
  const [urlType, setUrlType] = useState<'video' | 'channel' | 'playlist' | 'unknown' | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isValidUrl, setIsValidUrl] = useState<boolean | null>(null);
  
  const [videoInfo, setVideoInfo] = useState<YouTubeVideoInfo | null>(null);
  const [channelInfo, setChannelInfo] = useState<{
    channelName: string;
    channelId: string;
    videoCount: number;
  } | null>(null);
  const [channelVideos, setChannelVideos] = useState<YouTubeVideoInfo[]>([]);
  
  const [outputDir, setOutputDir] = useState('');
  const [quality, setQuality] = useState<YouTubeQuality>('1080');
  const [downloadSubtitles, setDownloadSubtitles] = useState(false);
  const [downloadThumbnail, setDownloadThumbnail] = useState(false);
  const [audioOnly, setAudioOnly] = useState(false);
  const [audioFormat, setAudioFormat] = useState<'mp3' | 'wav'>('mp3');
  const [channelLimit, setChannelLimit] = useState<number | undefined>(undefined);
  const [continueOnError, setContinueOnError] = useState(true);
  const [minDuration, setMinDuration] = useState<number | undefined>(undefined);
  // REFACTORED (Phase 1): Cookies now OPTIONAL (default OFF - simple & stable)
  // User can enable if needed (advanced feature)
  const [useCookiesFromBrowser, setUseCookiesFromBrowser] = useState(false);
  const [cookiesFilePath, setCookiesFilePath] = useState<string | null>(null);
  const [cookiesBrowser, setCookiesBrowser] = useState<string>('auto');

  const [isDownloading, setIsDownloading] = useState(false);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [isEstimating, setIsEstimating] = useState(false);
  
  const [progress, setProgress] = useState<YouTubeDownloadProgress | null>(null);
  const [batchProgress, setBatchProgress] = useState<YouTubeBatchDownloadProgress | null>(null);
  
  const [estimate, setEstimate] = useState<{
    videoCount: number;
    estimatedSizeBytes: number;
    estimatedSizeFormatted: string;
    avgSizePerVideo: number;
  } | null>(null);
  
  const [error, setError] = useState<string | null>(null);
  const [downloadResult, setDownloadResult] = useState<{
    downloaded: string[];
    failed: Array<{ video: YouTubeVideoInfo; error: string }>;
    channelFolder?: string;
  } | null>(null);
  
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // ── Download Queue (Sprint 2.2) ──────────────────────────────────────────
  interface QueueItem {
    id: string;
    url: string;
    status: 'pending' | 'running' | 'done' | 'error';
    error?: string;
    outputFile?: string;
  }
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueUrlInput, setQueueUrlInput] = useState('');
  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = queue;
  
  // ============================================
  // Effects
  // ============================================
  
  // Restore state từ running job khi component mount lại (sau khi chuyển tab)
  useEffect(() => {
    let mounted = true

    const restoreRunningJob = async () => {
      try {
        const jobs = await window.api.jobQueue.list()
        const runningJob = jobs.find(
          (job: any) =>
            (job.type === 'youtube:download-video' || job.type === 'youtube:download-channel') &&
            (job.status === 'running' || job.status === 'pending')
        )

        if (runningJob && mounted) {
          setIsDownloading(true)
          
          // Restore progress nếu có
          if (runningJob.progress) {
            // Progress sẽ được update từ progress events
          }
        }
      } catch (err) {
        console.error('[YouTubeDownloader] Failed to restore running job:', err)
      }
    }

    restoreRunningJob()

    return () => {
      mounted = false
    }
  }, []) // Chạy một lần khi component mount
  
  // Setup progress listeners
  useEffect(() => {
    if (!window.api?.youtube?.onProgress || !window.api?.youtube?.onBatchProgress) return

    const unsubscribeProgress = window.api.youtube.onProgress((prog) => {
      setProgress(prog);
    });

    const unsubscribeBatch = window.api.youtube.onBatchProgress((prog) => {
      setBatchProgress(prog);
    });

    return () => {
      unsubscribeProgress();
      unsubscribeBatch();
    };
  }, []);
  
  // Validate URL when changed
  useEffect(() => {
    if (!url.trim()) {
      setIsValidUrl(null);
      setUrlType(null);
      setVideoInfo(null);
      setChannelInfo(null);
      setChannelVideos([]);
      setEstimate(null);
      return;
    }
    
    const timeoutId = setTimeout(() => {
      validateUrl();
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [url]);
  
  // ============================================
  // Handlers
  // ============================================
  
  const validateUrl = async () => {
    setIsValidating(true);
    setError(null);
    
    try {
      const result = await window.api.youtube.validateUrl(url);
      
      if (result.success) {
        setIsValidUrl(result.isValid || false);
        setUrlType(result.type || 'unknown');
      } else {
        setError(result.error || 'Failed to validate URL');
      }
    } catch (error) {
      console.error('Validate URL error:', error);
      setError('Failed to validate URL');
    } finally {
      setIsValidating(false);
    }
  };
  
  const handlePasteUrl = async () => {
    try {
      // Sử dụng Clipboard API
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text);
        // The useEffect on [url] will trigger validateUrl automatically
        // No need for explicit setTimeout call (which would use stale closure)
      }
    } catch (error) {
      void error
      setError('Không thể đọc từ clipboard. Vui lòng dán thủ công (Ctrl+V)');
    }
  };
  
  const handleTestUrl = async () => {
    if (!url.trim()) {
      setError('Vui lòng nhập URL trước!');
      return;
    }

    setError(null);

    try {
      // Test URL với validateUrl
      const result = await window.api.youtube.validateUrl(url);

      if (result.success && result.isValid) {
        // MED-*: replace alert() with inline state message
        setError(`✅ URL hợp lệ! Loại: ${result.type || 'unknown'}`);
      } else {
        setError(`❌ URL không hợp lệ: ${result.error || 'URL không đúng định dạng'}`);
      }
    } catch (error: any) {
      setError(`❌ Lỗi kiểm tra URL: ${error?.message || 'Unknown error'}`);
    }
  };
  
  const handleGetInfo = async () => {
    setError(null);
    setVideoInfo(null);
    setChannelInfo(null);
    setChannelVideos([]);
    setEstimate(null);
    setIsLoadingInfo(true);
    
    try {
      if (urlType === 'video') {
        const result = await window.api.youtube.getVideoInfo(url);
        
        if (result.success && result.videoInfo) {
          setVideoInfo(result.videoInfo);
        } else {
          setError(result.error || 'Không thể lấy thông tin video');
        }
        
      } else if (urlType === 'channel' || urlType === 'playlist') {
        const [infoResult, videosResult] = await Promise.all([
          window.api.youtube.getChannelInfo(url),
          window.api.youtube.getChannelVideos(url, channelLimit) // Remove default limit 20
        ]);
        
        if (infoResult.success && infoResult.channelInfo) {
          setChannelInfo(infoResult.channelInfo);
        }
        
        if (videosResult.success && videosResult.videos) {
          setChannelVideos(videosResult.videos);
        }
        
        if (!infoResult.success) {
          setError(infoResult.error || 'Không thể lấy thông tin channel');
        }
      }
    } catch (error) {
      console.error('Get info error:', error);
      setError('Không thể lấy thông tin. Vui lòng thử lại.');
    } finally {
      setIsLoadingInfo(false);
    }
  };
  
  const handleEstimateSize = async () => {
    if (!channelInfo) return;
    
    setIsEstimating(true);
    setError(null);
    
    try {
      const result = await window.api.youtube.estimateChannelSize(
        url,
        quality,
        channelLimit
      );
      
      if (result.success && result.estimate) {
        setEstimate(result.estimate);
      } else {
        setError(result.error || 'Failed to estimate size');
      }
    } catch (error) {
      setError('Failed to estimate size');
    } finally {
      setIsEstimating(false);
    }
  };
  
  const handleSelectOutputDir = async () => {
    const result = await window.api.selectFolder();
    if (result) {
      setOutputDir(result);
    }
  };
  
  const handleDownload = async () => {
    setError(null);
    setDownloadResult(null);
    setProgress(null);
    setBatchProgress(null);
    setIsDownloading(true);
    setShowCancelConfirm(false);
    
    try {
      if (urlType === 'video') {
        const request: YouTubeDownloadVideoRequest = {
          url: url,
          outputDir: outputDir,
          quality: quality,
          downloadSubtitles: downloadSubtitles,
          downloadThumbnail: downloadThumbnail,
          audioOnly,
          audioFormat,
          cookiesFile: useCookiesFromBrowser && cookiesBrowser === 'file' ? cookiesFilePath || undefined : undefined,
          cookiesBrowser: useCookiesFromBrowser && cookiesBrowser !== 'file' ? cookiesBrowser : undefined,
        };

        const result = await window.api.youtube.downloadVideo(request);

        if (result.success) {
          setDownloadResult({
            downloaded: result.outputFile ? [result.outputFile] : [],
            failed: [],
            channelFolder: undefined  // Single video không có channel folder
          });
        } else {
          setError(result.error || 'Download failed');
        }

      } else if (urlType === 'channel' || urlType === 'playlist') {
        const result = await window.api.youtube.downloadChannel({
          url: url,
          outputDir: outputDir,
          quality: quality,
          options: {
            downloadSubtitles: downloadSubtitles,
            downloadThumbnail: downloadThumbnail,
            limit: channelLimit,
            continueOnError: continueOnError,
            concurrent: false,
            audioOnly,
            audioFormat,
            cookiesFile: useCookiesFromBrowser && cookiesBrowser === 'file' ? cookiesFilePath || undefined : undefined,
            cookiesBrowser: useCookiesFromBrowser && cookiesBrowser !== 'file' ? cookiesBrowser : undefined,
            minDurationSeconds: minDuration ? minDuration * 60 : undefined,
          }
        });
        
        if (result.success) {
          // Log nếu backup method được dùng
          if ((result as any).usedBackup) {
            console.log('[YouTube] Primary method failed, backup method succeeded');
          }

          setDownloadResult({
            downloaded: result.downloaded || [],
            failed: result.failed || [],
            channelFolder: result.channelFolder  // Channel folder path
          });
        } else {
          setError(result.error || 'Download failed');
        }
      }
      
    } catch (error) {
      console.error('Download error:', error);
      setError('Download failed');
    } finally {
      setIsDownloading(false);
      if (window.api?.refreshDiskInfo) {
        window.api.refreshDiskInfo().catch((err: unknown) => {
          console.error('[YouTubeDownloader] refreshDiskInfo error:', err);
        });
      }
    }
  };
  
  const handleCancelDownload = async () => {
    if (!showCancelConfirm) {
      setShowCancelConfirm(true);
      return;
    }

    await window.api.youtube.cancelDownload();
    setIsDownloading(false);
    setShowCancelConfirm(false);
    setError('Download đã bị hủy');
  };

  // ── Queue handlers ────────────────────────────────────────────────────────
  const handleAddToQueue = () => {
    const lines = queueUrlInput.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const newItems: QueueItem[] = lines.map(u => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      url: u,
      status: 'pending',
    }));
    setQueue(prev => [...prev, ...newItems]);
    setQueueUrlInput('');
  };

  const handleRemoveFromQueue = (id: string) => {
    setQueue(prev => prev.filter(item => item.id !== id));
  };

  const handleRunQueue = async () => {
    if (queueRunning) return;
    if (!outputDir) { setError('Vui lòng chọn thư mục lưu trước khi chạy queue!'); return; }
    setQueueRunning(true);
    setError(null);

    const items = queueRef.current;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.status !== 'pending') continue;

      setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'running' } : q));

      try {
        const request: YouTubeDownloadVideoRequest = {
          url: item.url,
          outputDir,
          quality,
          downloadSubtitles,
          downloadThumbnail,
          audioOnly,
          audioFormat,
        };
        const result = await window.api.youtube.downloadVideo(request);
        if (result.success) {
          setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'done', outputFile: result.outputFile } : q));
        } else {
          setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'error', error: result.error || 'Failed' } : q));
        }
      } catch (err: any) {
        setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'error', error: err?.message || 'Unknown error' } : q));
      }
    }
    setQueueRunning(false);
  };

  const handleClearQueue = () => {
    setQueue(prev => prev.filter(q => q.status === 'running'));
  };
  
  // ============================================
  // Helper functions
  // ============================================
  
  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  
  const formatNumber = (num: number): string => {
    return num.toLocaleString();
  };
  
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };
  
  const canDownload = (): boolean => {
    return !!(
      (videoInfo || channelInfo) &&
      outputDir &&
      !isDownloading &&
      !isLoadingInfo
    );
  };
  
  const getDownloadWarnings = (): string[] => {
    const warnings: string[] = [];
    
    if (!outputDir) {
      warnings.push('Chưa chọn thư mục lưu');
    }
    
    if (urlType === 'channel' || urlType === 'playlist') {
      if (channelVideos.length > 50 && !channelLimit) {
        warnings.push(`Channel có ${channelVideos.length} videos. Khuyến nghị đặt giới hạn để tránh download quá lâu.`);
      }
      
      if (estimate && estimate.estimatedSizeBytes > 10 * 1024 ** 3) {
        warnings.push(`Dung lượng ước tính: ${estimate.estimatedSizeFormatted}. Đảm bảo có đủ dung lượng ổ đĩa.`);
      }
    }
    
    return warnings;
  };
  
  // ============================================
  // Render
  // ============================================
  
  const [ytDlpVersion, setYtDlpVersion] = useState<string>('');
  const [isUpdatingYtDlp, setIsUpdatingYtDlp] = useState(false);
  const [ytDlpUpdateMsg, setYtDlpUpdateMsg] = useState<string | null>(null);

  // Check yt-dlp version on mount
  useEffect(() => {
    const w = window as any;
    if (w.api?.youtube?.verify) {
      w.api.youtube.verify().then((res: any) => {
        if (res?.success && res.available) {
          // Version is logged in backend, also try to get it
        }
      }).catch(() => {});
    }
  }, []);

  const handleUpdateYtDlp = async () => {
    const w = window as any;
    if (!w.api?.youtube?.updateYtDlp) {
      setYtDlpUpdateMsg('API không khả dụng.');
      return;
    }
    setIsUpdatingYtDlp(true);
    setYtDlpUpdateMsg(null);
    try {
      const result = await w.api.youtube.updateYtDlp();
      setYtDlpUpdateMsg(result.message);
      if (result.version) setYtDlpVersion(result.version);
    } catch (err: any) {
      setYtDlpUpdateMsg(`Lỗi: ${err?.message || 'Không xác định'}`);
    } finally {
      setIsUpdatingYtDlp(false);
    }
  };

  return (
    <div className="youtube-downloader-tab">
      <h2>7. YouTube Downloader</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <p style={{ margin: 0 }}>Download videos hoặc toàn bộ channel từ YouTube</p>
        <button
          type="button"
          onClick={handleUpdateYtDlp}
          disabled={isUpdatingYtDlp || isDownloading}
          style={{
            padding: '4px 12px',
            borderRadius: '4px',
            border: '1px solid #4b5563',
            backgroundColor: isUpdatingYtDlp ? '#374151' : '#1e3a5f',
            color: isUpdatingYtDlp ? '#9ca3af' : '#93c5fd',
            cursor: isUpdatingYtDlp || isDownloading ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            whiteSpace: 'nowrap',
          }}
        >
          {isUpdatingYtDlp ? '⏳ Đang cập nhật...' : '🔄 Cập nhật yt-dlp'}
        </button>
        {ytDlpUpdateMsg && (
          <span style={{
            fontSize: '12px',
            color: ytDlpUpdateMsg.includes('Lỗi') || ytDlpUpdateMsg.includes('Không thể') ? '#f87171' : '#4ade80',
          }}>
            {ytDlpUpdateMsg}
          </span>
        )}
      </div>
      
      {/* Step 1: URL Input */}
      <div className="section">
        <h3>1. Nhập URL YouTube</h3>
        
        <div className="url-input-group">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=... hoặc channel URL"
            className="url-input"
            disabled={isDownloading}
          />
          
          {isValidating && <span className="status">Đang kiểm tra...</span>}
          
          {!isValidating && isValidUrl === true && (
            <span className="status valid">
              ✓ URL hợp lệ ({urlType})
            </span>
          )}
          
          {!isValidating && isValidUrl === false && (
            <span className="status invalid">
              ✗ URL không hợp lệ
            </span>
          )}
        </div>
        
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button
            onClick={handlePasteUrl}
            disabled={isDownloading}
            className="btn-secondary"
            style={{ fontSize: '12px', padding: '6px 12px' }}
          >
            📋 Dán URL
          </button>
          
          <button
            onClick={handleTestUrl}
            disabled={isDownloading || !url.trim()}
            className="btn-secondary"
            style={{ fontSize: '12px', padding: '6px 12px' }}
          >
            🧪 Test URL
          </button>
          
          {isValidUrl && (
            <button
              onClick={handleGetInfo}
              disabled={isDownloading || isLoadingInfo}
              className="btn-primary"
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              {isLoadingInfo ? '⏳ Đang tải...' : '📋 Lấy thông tin'}
            </button>
          )}
        </div>
      </div>
      
      {/* Video Info Display */}
      {videoInfo && renderVideoInfo()}
      
      {/* Channel Info Display */}
      {channelInfo && renderChannelInfo()}
      
      {/* Settings */}
      {(videoInfo || channelInfo) && renderSettings()}
      
      {/* Download Button */}
      {(videoInfo || channelInfo) && outputDir && renderDownloadButton()}
      
      {/* Progress */}
      {isDownloading && renderProgress()}
      
      {/* Results */}
      {downloadResult && renderResults()}
      
      {/* Error */}
      {error && renderError()}

      {/* ── Download Queue (Sprint 2.2) ── */}
      <div className="section" style={{ marginTop: '24px' }}>
        <h3>🗂️ Download Queue (nhiều URL)</h3>
        <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
          Nhập nhiều URL (mỗi dòng một URL), sau đó nhấn "Thêm vào Queue" rồi "Chạy Queue".
        </p>

        {/* Input */}
        <textarea
          value={queueUrlInput}
          onChange={e => setQueueUrlInput(e.target.value)}
          placeholder={'https://www.youtube.com/watch?v=...\nhttps://soundcloud.com/...\nhttps://www.tiktok.com/...'}
          disabled={queueRunning}
          rows={4}
          style={{
            width: '100%', boxSizing: 'border-box',
            backgroundColor: '#1a1a2e', color: '#e5e7eb',
            border: '1px solid #374151', borderRadius: '6px',
            padding: '8px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={handleAddToQueue} disabled={queueRunning || !queueUrlInput.trim()}
            style={{ fontSize: '12px', padding: '6px 12px' }}>
            ➕ Thêm vào Queue
          </button>
          <button className="btn-primary" onClick={handleRunQueue} disabled={queueRunning || queue.filter(q => q.status === 'pending').length === 0 || !outputDir}
            style={{ fontSize: '12px', padding: '6px 12px' }}>
            {queueRunning ? '⏳ Đang chạy...' : '▶️ Chạy Queue'}
          </button>
          <button className="btn-secondary" onClick={handleClearQueue} disabled={queueRunning || queue.length === 0}
            style={{ fontSize: '12px', padding: '6px 12px' }}>
            🗑️ Xóa hoàn thành
          </button>
          {!outputDir && (
            <span style={{ fontSize: '12px', color: '#f87171', alignSelf: 'center' }}>
              ⚠️ Chưa chọn thư mục lưu
            </span>
          )}
        </div>

        {/* Queue list */}
        {queue.length > 0 && (
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {queue.map(item => (
              <div key={item.id} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 10px', borderRadius: '6px',
                backgroundColor:
                  item.status === 'done' ? '#052e16' :
                  item.status === 'error' ? '#2d0a0a' :
                  item.status === 'running' ? '#1e3a5f' : '#1f2937',
                fontSize: '12px',
              }}>
                <span style={{ flexShrink: 0 }}>
                  {item.status === 'pending' ? '⏳' :
                   item.status === 'running' ? '⬇️' :
                   item.status === 'done' ? '✅' : '❌'}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#e5e7eb' }}>
                  {item.url}
                </span>
                {item.error && (
                  <span style={{ color: '#f87171', fontSize: '11px', flexShrink: 0, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.error}
                  </span>
                )}
                {item.status === 'pending' && (
                  <button onClick={() => handleRemoveFromQueue(item.id)}
                    style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '14px', flexShrink: 0 }}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Summary */}
        {queue.length > 0 && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af' }}>
            Tổng: {queue.length} |
            Chờ: {queue.filter(q => q.status === 'pending').length} |
            Xong: {queue.filter(q => q.status === 'done').length} |
            Lỗi: {queue.filter(q => q.status === 'error').length}
          </div>
        )}
      </div>
    </div>
  );
  
  // ============================================
  // Render sub-components
  // ============================================
  
  function renderVideoInfo() {
    if (!videoInfo) return null;
    
    return (
      <div className="section video-info">
        <h3>Thông tin video</h3>
        
        <div className="info-grid">
          {videoInfo.thumbnail && (
            <img
              src={videoInfo.thumbnail}
              alt={videoInfo.title}
              className="video-thumbnail"
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
            />
          )}
          
          <div className="info-details">
            <h4>{videoInfo.title}</h4>
            <p><strong>Kênh:</strong> {videoInfo.uploader}</p>
            <p><strong>Thời lượng:</strong> {formatDuration(videoInfo.duration)}</p>
            <p><strong>Lượt xem:</strong> {formatNumber(videoInfo.viewCount)}</p>
            <p><strong>Resolution:</strong> {videoInfo.width}x{videoInfo.height}</p>
            {/* Hiển thị danh sách resolutions có sẵn */}
            {videoInfo.formats && videoInfo.formats.length > 0 && (
              <div style={{ marginTop: '8px' }}>
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                  <strong>Resolutions có sẵn:</strong>
                </p>
                <div style={{ 
                  maxHeight: '100px', 
                  overflowY: 'auto', 
                  backgroundColor: '#1a1a1a', 
                  padding: '6px', 
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontFamily: 'monospace'
                }}>
                  {(() => {
                    // Lọc các format video (có vcodec)
                    const videoFormats = videoInfo.formats.filter(f => f.vcodec && f.vcodec !== 'none');
                    // Lấy unique resolutions
                    const resolutions = [...new Set(videoFormats.map(f => f.resolution))].sort((a, b) => {
                      const heightA = parseInt(a.split('x')[1] || '0');
                      const heightB = parseInt(b.split('x')[1] || '0');
                      return heightB - heightA; // Sort descending
                    });
                    return resolutions.length > 0 ? resolutions.join(', ') : 'Không có format video';
                  })()}
                </div>
                {(() => {
                  const videoFormats = videoInfo.formats.filter(f => f.vcodec && f.vcodec !== 'none');
                  const maxHeight = Math.max(...videoFormats.map(f => {
                    const match = f.resolution.match(/(\d+)x(\d+)/);
                    return match ? parseInt(match[2]) : 0;
                  }));
                  if (maxHeight < 1080 && quality === '1080') {
                    return (
                      <p style={{ fontSize: '12px', color: '#ffaa66', marginTop: '4px' }}>
                        ⚠️ Video chỉ có resolution tối đa {maxHeight}p, không có 1080p. Tool sẽ tải resolution cao nhất có sẵn.
                      </p>
                    );
                  }
                  return null;
                })()}
              </div>
            )}
            {/* Phase 4: Hiển thị thông tin phụ đề */}
            {videoInfo.hasSubtitles !== undefined && (
              <p style={{ color: videoInfo.hasSubtitles ? '#9fcf9f' : '#ffaa66' }}>
                <strong>Phụ đề:</strong> {videoInfo.hasSubtitles ? `Có (${videoInfo.subtitles?.length || 0} ngôn ngữ)` : 'Video không có phụ đề'}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }
  
  function renderChannelInfo() {
    if (!channelInfo) return null;
    
    return (
      <div className="section channel-info">
        <h3>Thông tin channel/playlist</h3>
        
        <div className="info-details">
          <p><strong>Tên:</strong> {channelInfo.channelName}</p>
          <p><strong>Tổng số video:</strong> {formatNumber(channelInfo.videoCount)}</p>
          <p><strong>Số video sẽ tải:</strong> {channelLimit || channelVideos.length}</p>
        </div>
        
        <button
          onClick={handleEstimateSize}
          disabled={isEstimating || isDownloading}
          className="btn-secondary"
          style={{ marginTop: '12px' }}
        >
          {isEstimating ? 'Đang ước tính...' : '📊 Ước tính dung lượng'}
        </button>
        
        {estimate && (
          <div className="estimate-info">
            <p><strong>Dung lượng ước tính:</strong> {estimate.estimatedSizeFormatted}</p>
            <p><strong>Trung bình/video:</strong> {formatBytes(estimate.avgSizePerVideo)}</p>
            <p className="estimate-note">
              * Ước tính dựa trên quality "{quality}" và thời lượng videos
            </p>
          </div>
        )}
        
        {channelVideos.length > 0 && (
          <div className="video-list">
            <h4>Danh sách videos (preview {Math.min(5, channelVideos.length)} videos đầu):</h4>
            <ul>
              {channelVideos.slice(0, 5).map((video, i) => (
                <li key={video.id}>
                  {i + 1}. {video.title} ({formatDuration(video.duration)})
                </li>
              ))}
              {channelVideos.length > 5 && (
                <li>... và {channelVideos.length - 5} videos nữa</li>
              )}
            </ul>
          </div>
        )}
      </div>
    );
  }
  
  function renderSettings() {
    return (
      <div className="section settings">
        <h3>2. Cài đặt download</h3>
        
        <div className="setting-item">
          <label>Thư mục lưu:</label>
          <div className="folder-select">
            <button onClick={handleSelectOutputDir} disabled={isDownloading}>
              Chọn thư mục
            </button>
            {outputDir && <span className="path">{outputDir}</span>}
          </div>
        </div>
        
        <div className="setting-item">
          <label>Chất lượng:</label>
          <select 
            value={quality} 
            onChange={(e) => setQuality(e.target.value as YouTubeQuality)}
            disabled={isDownloading || audioOnly}
          >
            <option value="best">Tốt nhất (Best Available)</option>
            <option value="4320">8K (4320p) - Ultra Ultra HD</option>
            <option value="2160">4K (2160p) - Ultra HD</option>
            <option value="1440">2K (1440p) - Quad HD</option>
            <option value="1080">Full HD (1080p)</option>
            <option value="720">HD (720p)</option>
            <option value="480">SD (480p)</option>
            <option value="360">360p - Low quality</option>
          </select>
          {audioOnly && <p className="hint">Đang bật chế độ audio-only, chất lượng video tạm khóa.</p>}
        </div>

        <div className="setting-item checkbox">
          <label>
            <input
              type="checkbox"
              checked={audioOnly}
              onChange={(e) => setAudioOnly(e.target.checked)}
              disabled={isDownloading}
            />
            Chỉ tải audio (MP3/WAV)
          </label>
        </div>

        {audioOnly && (
          <div className="setting-item">
            <label>Định dạng audio:</label>
            <select
              value={audioFormat}
              onChange={(e) => setAudioFormat(e.target.value as 'mp3' | 'wav')}
              disabled={isDownloading}
            >
              <option value="mp3">MP3 (nhẹ, phổ biến)</option>
              <option value="wav">WAV (không nén, chất lượng cao)</option>
            </select>
          </div>
        )}
        
        {/* Phase 2: Download tracklist */}
        <div className="setting-item checkbox">
          <label>
            <input
              type="checkbox"
              checked={downloadSubtitles}
              onChange={(e) => setDownloadSubtitles(e.target.checked)}
              disabled={isDownloading}
            />
            Download tracklist nếu có
          </label>
          <p style={{ fontSize: '12px', color: '#888', marginTop: '4px', marginLeft: '24px' }}>
            Tự động phát hiện và tải tracklist từ mô tả video (nếu có)
          </p>
        </div>
        
        {/* Phase 4: Download phụ đề - chỉ hiển thị khi video có phụ đề */}
        {videoInfo?.hasSubtitles === true && (
          <div className="setting-item checkbox">
            <label>
              <input
                type="checkbox"
                checked={false}
                disabled={true}
                style={{ opacity: 0.5 }}
              />
              Download phụ đề (Vietnamese + English)
            </label>
            <p style={{ fontSize: '12px', color: '#9fcf9f', marginTop: '4px', marginLeft: '24px' }}>
              Video có {videoInfo.subtitles?.length || 0} ngôn ngữ phụ đề
            </p>
          </div>
        )}
        {videoInfo?.hasSubtitles === false && (
          <div className="setting-item" style={{ padding: '8px', backgroundColor: '#2a2a2a', borderRadius: '4px' }}>
            <p style={{ fontSize: '12px', color: '#ffaa66', margin: 0 }}>
              ⚠️ Video không có phụ đề
            </p>
          </div>
        )}

        <div className="setting-item checkbox">
          <label>
            <input
              type="checkbox"
              checked={downloadThumbnail}
              onChange={(e) => setDownloadThumbnail(e.target.checked)}
              disabled={isDownloading}
            />
            Embed thumbnail vào video
          </label>
        </div>

        {/* Cookies - Chọn browser hoặc file */}
        <div className="setting-item checkbox">
          <label>
            <input
              type="checkbox"
              checked={useCookiesFromBrowser}
              onChange={(e) => {
                setUseCookiesFromBrowser(e.target.checked);
                if (!e.target.checked) {
                  setCookiesFilePath(null);
                  setCookiesBrowser('auto');
                }
              }}
              disabled={isDownloading}
            />
            Sử dụng cookies từ trình duyệt
          </label>
          <p style={{ fontSize: '11px', color: '#888', marginTop: '4px', marginLeft: '24px' }}>
            Cookies giúp tải video bị giới hạn tuổi hoặc khu vực. Nếu không cần, bỏ checkbox này.
          </p>
        </div>

        {useCookiesFromBrowser && (
          <div className="setting-item" style={{ marginLeft: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label>Chọn trình duyệt:</label>
            <select
              value={cookiesBrowser}
              onChange={(e) => setCookiesBrowser(e.target.value)}
              disabled={isDownloading}
              style={{ maxWidth: '280px' }}
            >
              <option value="auto">Tự động (thử tất cả browsers)</option>
              <option value="chrome">Google Chrome</option>
              <option value="edge">Microsoft Edge</option>
              <option value="firefox">Firefox</option>
              <option value="opera">Opera</option>
              <option value="brave">Brave</option>
              <option value="vivaldi">Vivaldi</option>
              <option value="chromium">Chromium</option>
              <option value="opera_gx">Opera GX</option>
              <option value="whale">Naver Whale</option>
              <option value="safari">Safari (macOS)</option>
              <option value="file">Chọn file cookies.txt</option>
            </select>

            {cookiesBrowser === 'auto' && (
              <p style={{ fontSize: '11px', color: '#4ade80', margin: 0 }}>
                Tool sẽ tự thử: Chrome, Edge, Firefox, Opera, Brave... và dùng browser đầu tiên hoạt động.
              </p>
            )}

            {cookiesBrowser === 'file' && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  onClick={async () => {
                    try {
                      const result = await window.api.dialog.openFile({
                        title: 'Chọn file cookies.txt',
                        filters: [
                          { name: 'Text Files', extensions: ['txt'] },
                          { name: 'All Files', extensions: ['*'] }
                        ],
                        properties: ['openFile']
                      });
                      if (result && !result.canceled && result.filePaths.length > 0) {
                        setCookiesFilePath(result.filePaths[0]);
                      }
                    } catch (error) {
                      setError('Không thể chọn file cookies');
                    }
                  }}
                  disabled={isDownloading}
                  style={{ padding: '4px 12px', fontSize: '13px' }}
                >
                  Browse...
                </button>
                {cookiesFilePath ? (
                  <span style={{ fontSize: '12px', color: '#4ade80' }}>
                    {cookiesFilePath.split(/[/\\]/).pop()}
                  </span>
                ) : (
                  <span style={{ fontSize: '12px', color: '#fbbf24' }}>
                    Chưa chọn file
                  </span>
                )}
              </div>
            )}

            {cookiesBrowser !== 'auto' && cookiesBrowser !== 'file' && (
              <p style={{ fontSize: '11px', color: '#9ca3af', margin: 0 }}>
                Đảm bảo {cookiesBrowser} đã đóng trước khi download (browser khóa file cookies khi đang mở).
              </p>
            )}
          </div>
        )}

        {(urlType === 'channel' || urlType === 'playlist') && (
          <>
            <div className="setting-item">
              <label>Giới hạn số videos:</label>
              <input
                type="number"
                min="1"
                placeholder="Không giới hạn"
                value={channelLimit || ''}
                onChange={(e) => setChannelLimit(e.target.value ? parseInt(e.target.value) : undefined)}
                disabled={isDownloading}
              />
            </div>

            <div className="setting-item">
              <label>Thời lượng tối thiểu (phút):</label>
              <input
                type="number"
                min="0"
                step="0.5"
                placeholder="Không giới hạn"
                value={minDuration || ''}
                onChange={(e) => setMinDuration(e.target.value ? parseFloat(e.target.value) : undefined)}
                disabled={isDownloading}
              />
              {minDuration && minDuration > 0 && (
                <span style={{ fontSize: '11px', color: '#9ca3af', marginLeft: '8px' }}>
                  Chỉ tải video ≥ {minDuration} phút
                </span>
              )}
            </div>
            
            <div className="setting-item checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={continueOnError}
                  onChange={(e) => setContinueOnError(e.target.checked)}
                  disabled={isDownloading}
                />
                Tiếp tục nếu 1 video lỗi
              </label>
            </div>
          </>
        )}
      </div>
    );
  }
  
  function renderDownloadButton() {
    const warnings = getDownloadWarnings();
    
    return (
      <div className="section download-action">
        <h3>3. Bắt đầu download</h3>
        
        {warnings.length > 0 && (
          <div className="warnings">
            {warnings.map((warning, i) => (
              <div key={i} className="warning-item">
                ⚠️ {warning}
              </div>
            ))}
          </div>
        )}
        
        {!isDownloading ? (
          <button
            onClick={handleDownload}
            disabled={!canDownload()}
            className="btn-download"
          >
            🚀 Bắt đầu download
          </button>
        ) : (
          <div className="cancel-group">
            <button
              onClick={handleCancelDownload}
              className={showCancelConfirm ? 'btn-cancel confirm' : 'btn-cancel'}
            >
              {showCancelConfirm ? '⚠️ Xác nhận hủy?' : '❌ Hủy download'}
            </button>
            {showCancelConfirm && (
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="btn-secondary"
              >
                Tiếp tục download
              </button>
            )}
          </div>
        )}
        
        {!canDownload() && (
          <div className="requirements">
            <p>Yêu cầu:</p>
            <ul>
              {!videoInfo && !channelInfo && <li>✗ Lấy thông tin video/channel</li>}
              {!outputDir && <li>✗ Chọn thư mục lưu</li>}
            </ul>
          </div>
        )}
      </div>
    );
  }
  
  function renderProgress() {
    return (
      <div className="section progress-section">
        <h3>Tiến độ download</h3>
        
        {batchProgress && (
          <div className="batch-progress">
            <div className="progress-header">
              <span>
                Video {batchProgress.currentVideoIndex + 1}/{batchProgress.totalVideos}
              </span>
              <span>
                Hoàn thành: {batchProgress.completedVideos}, Lỗi: {batchProgress.failedVideos}
              </span>
            </div>
            
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${batchProgress.overallPercent}%` }}
              />
            </div>
            
            <div className="progress-text">
              {batchProgress.overallPercent.toFixed(1)}%
            </div>
            
            {batchProgress.currentVideoTitle && (
              <div className="current-video">
                Đang tải: {batchProgress.currentVideoTitle}
              </div>
            )}
          </div>
        )}
        
        {progress && progress.type === 'download' && progress.percent && (
          <div className="video-progress">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            
            <div className="progress-details">
              <span>{progress.percent.toFixed(1)}%</span>
              <span>{progress.speed}</span>
              <span>ETA: {progress.eta}</span>
            </div>
          </div>
        )}
        
        {progress && progress.message && (
          <div className="progress-message">
            {progress.message}
          </div>
        )}
      </div>
    );
  }
  
  function renderResults() {
    if (!downloadResult) return null;
    
    return (
      <div className="section results">
        <h3>Kết quả download</h3>
        
        <div className="results-summary">
          <div className="success-count">
            ✓ Thành công: {downloadResult.downloaded.length} videos
          </div>
          
          {downloadResult.failed.length > 0 && (
            <div className="error-count">
              ✗ Thất bại: {downloadResult.failed.length} videos
            </div>
          )}
        </div>
        
        {downloadResult.downloaded.length > 0 && (
          <div className="downloaded-list">
            <h4>Files đã tải:</h4>
            <ul>
              {downloadResult.downloaded.map((file, i) => (
                <li key={i}>
                  <span className="file-icon">📁</span>
                  {file.split(/[/\\]/).pop()}
                </li>
              ))}
            </ul>
          </div>
        )}
        
        {downloadResult.failed.length > 0 && (
          <div className="failed-list">
            <h4>Videos lỗi:</h4>
            <ul>
              {downloadResult.failed.map((f, i) => (
                <li key={i}>
                  <span className="error-icon">❌</span>
                  {f.video.title}: {f.error}
                </li>
              ))}
            </ul>
          </div>
        )}
        
        <button
          onClick={() => window.api.openPath(outputDir)}
          className="btn-open-folder"
        >
          Mở thư mục chứa videos
        </button>
      </div>
    );
  }
  
  function renderError() {
    if (!error) return null;
    
    return (
      <div className="error-message">
        <strong>❌ Lỗi:</strong>
        <p>{error}</p>
        <button onClick={() => setError(null)}>Đóng</button>
      </div>
    );
  }
}

export default YouTubeDownloaderTab;


















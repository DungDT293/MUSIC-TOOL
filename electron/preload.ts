import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AuthLoginPayload,
  AuthRegisterPayload,
  AuthState,
  GpuFfmpegProfile,
  IPCAPI,
  LicenseState,
  ScanMusicFoldersPayload,
  ScanMusicResult,
  BuildPlaylistsOptions,
  ExtractAudioBatchRequest,
  ExtractAudioBatchResult,
  SpotifyMetadataRequest,
  SpotifyMetadataResult,
  SpotifyYouTubeDownloadRequest,
  VideoProgressPayload,
} from '../src/types/ipc'
import {
  VIDEO_FINAL_EXPORT_DONE,
  VIDEO_FINAL_EXPORT_ERROR,
  VIDEO_FINAL_EXPORT_PROGRESS,
  VIDEO_FINAL_EXPORT_REQUEST,
  VIDEO_FINAL_EXPORT_SCAN_AUDIO,
  VIDEO_FINAL_EXPORT_SCAN_VIDEO,
  VIDEO_FINAL_EXPORT_SCAN_IMAGE,
  VIDEO_FINAL_EXPORT_CANCEL,
  type FinalExportDonePayload,
  type FinalExportErrorPayload,
  type FinalExportProgressPayload,
  type FinalExportRequestPayload,
  type FinalExportScanResult,
} from '../shared/videoFinalExportChannels'
import {
  SONG_NHAC_EXPORT_CANCEL,
  SONG_NHAC_EXPORT_PROGRESS,
  SONG_NHAC_EXPORT_START,
  SONG_NHAC_FRAMES_BEGIN,
  SONG_NHAC_FRAMES_CANCEL,
  SONG_NHAC_FRAMES_CHUNK,
  SONG_NHAC_FRAMES_END,
  SONG_NHAC_FRAMES_FLUSH,
  type SongNhacExportProgress,
  type SongNhacExportRequest,
  type SongNhacExportResult,
  type SongNhacFramesRequest,
  type SongNhacFramesResult,
} from '../shared/songNhacChannels'

const api: IPCAPI = {
  license: {
    getState: () => ipcRenderer.invoke('license:getState') as Promise<LicenseState>,
    register: (note?: string) =>
      ipcRenderer.invoke('license:register', { note }) as Promise<{
        success: boolean
        error?: string
        state: LicenseState
      }>,
    retry: () => ipcRenderer.invoke('license:retry') as Promise<LicenseState>,
    clear: () => ipcRenderer.invoke('license:clear') as Promise<LicenseState>,
  },
  auth: {
    getState: () => ipcRenderer.invoke('auth:getState') as Promise<AuthState>,
    register: (data: AuthRegisterPayload) =>
      ipcRenderer.invoke('auth:register', data) as Promise<AuthState>,
    refresh: () => ipcRenderer.invoke('auth:refresh') as Promise<AuthState>,
    login: (data: AuthLoginPayload) =>
      ipcRenderer.invoke('auth:login', data) as Promise<{ ok: boolean; message?: string }>,
    clear: () => ipcRenderer.invoke('auth:clear') as Promise<void>,
    checkStatus: (data: { username: string }) =>
      ipcRenderer.invoke('auth:checkStatus', data) as Promise<any>,
    validateKey: (data: { username: string; key: string }) =>
      ipcRenderer.invoke('auth:validateKey', data) as Promise<any>,
    validateToken: () =>
      ipcRenderer.invoke('auth:validateToken') as Promise<any>,
  },
  music: {
    // NOTE: music:scan, music:createPlaylist, music:preview, music:export
    // không có handler trong main.ts — dùng các API cụ thể bên dưới:
    // scanMusicFolders, createPlaylists, exportPlaylist thay thế.
    validatePlaylistsForCrossfade: (payload: any) => ipcRenderer.invoke('music:validatePlaylistsForCrossfade', payload),
    normalizeAudio: (payload: any) => ipcRenderer.invoke('music:normalizeAudio', payload),
    onNormalizeAudioProgress: (handler: (progress: any) => void) => {
      const channel = 'music:normalizeAudio:progress'
      const listener = (_event: IpcRendererEvent, payload: any) => handler(payload)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
    cancelNormalizeAudio: () => ipcRenderer.invoke('music:normalizeAudio:cancel'),
    spotifyMeta: (url: string) => ipcRenderer.invoke('music:spotifyMeta', url),
    spotifyImport: (request: SpotifyMetadataRequest): Promise<SpotifyMetadataResult> =>
      ipcRenderer.invoke('music:spotifyImport', request) as Promise<SpotifyMetadataResult>,
    getExportHistory: () => ipcRenderer.invoke('music:getExportHistory'),
    deleteExportHistory: (ids: string[]) => ipcRenderer.invoke('music:deleteExportHistory', ids),
    downloadPlaylistHistory: (payload: { dates?: string[]; entryIds?: string[]; outputDir?: string }) =>
      ipcRenderer.invoke('music:downloadPlaylistHistory', payload),
    enhanceAudio: (req: any) => ipcRenderer.invoke('music:enhance:run', req),
    cancelEnhanceAudio: () => ipcRenderer.invoke('music:enhance:cancel'),
    renderLoudnormPreview: (opts: any) => ipcRenderer.invoke('music:enhance:renderPreview', opts),
    onEnhanceProgress: (handler: (p: any) => void) => {
      const ch = 'music:enhance:progress'
      const fn = (_e: IpcRendererEvent, p: any) => handler(p)
      ipcRenderer.on(ch, fn)
      return () => ipcRenderer.removeListener(ch, fn)
    },
    previewMix: (opts: any) => ipcRenderer.invoke('music:previewMix', opts),
  },
  preset: {
    list: () => ipcRenderer.invoke('preset:list'),
    save: (name: string, settings: any) => ipcRenderer.invoke('preset:save', name, settings),
    update: (id: string, name: string, settings: any) => ipcRenderer.invoke('preset:update', id, name, settings),
    delete: (id: string) => ipcRenderer.invoke('preset:delete', id),
  },
  probeFile: (path: string) => ipcRenderer.invoke('ffmpeg:probe', path),
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  getRealtimeStats: () => ipcRenderer.invoke('system:realtime'),
  getDiskInfo: () => ipcRenderer.invoke('system:getDiskInfo'),
  refreshDiskInfo: () => ipcRenderer.invoke('system:refreshDiskInfo'),
  onDiskInfo: (handler: (info: any) => void) => {
    const channel = 'system:disk-info'
    const listener = (_event: IpcRendererEvent, payload: any) => handler(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
    selectAudioFile: () => ipcRenderer.invoke('dialog:selectAudioFile'),
    selectAudioFilesMulti: () => ipcRenderer.invoke('dialog:selectAudioFilesMulti'),
    selectImageFile: () => ipcRenderer.invoke('dialog:selectImageFile'),
    selectImageFilesMulti: () => ipcRenderer.invoke('dialog:selectImageFilesMulti'),
  scanMusicFolders: (payload: ScanMusicFoldersPayload) =>
    ipcRenderer.invoke('music:scanFolders', payload) as Promise<ScanMusicResult>,
  getLastScanResult: () => ipcRenderer.invoke('music:getLastScan') as Promise<ScanMusicResult | null>,
  createPlaylists: (payload: BuildPlaylistsOptions) => ipcRenderer.invoke('music:createPlaylists', payload),
  listPlaylists: () => ipcRenderer.invoke('music:listPlaylists'),
  getMusicPoolStats: (trackIds: string[]) => ipcRenderer.invoke('music:getPoolStats', trackIds),
  clearMusicPool: () => ipcRenderer.invoke('music:clearPool'),
  // getExportHistory: xóa top-level duplicate — dùng api.music.getExportHistory() thay thế
  exportPlaylist: (req: any) => ipcRenderer.invoke('music:exportPlaylist', req),
  // Fix P1-03: top-level validatePlaylistsForCrossfade đồng bộ với music.validatePlaylistsForCrossfade
  // Wrap playlistIds array thành object { playlistIds } mà handler mong đợi
  validatePlaylistsForCrossfade: (playlistIds: string[]) =>
    ipcRenderer.invoke('music:validatePlaylistsForCrossfade', { playlistIds }),
  // cutVideoSegment: DEPRECATED - use videoCutSingleSimple instead
  // cutVideoSegment: (req: any) => ipcRenderer.invoke('video:cutSegment', req),
  selectVideoFile: () => ipcRenderer.invoke('dialog:selectVideoFile'),
  selectVideoFilesMulti: () => ipcRenderer.invoke('dialog:selectVideoFilesMulti'),
  selectManyVideos: () => ipcRenderer.invoke('dialog:selectManyVideos'),
  videoProbeFile: (filePath: string) => ipcRenderer.invoke('video:probeFile', filePath),
  // videoSplitFile: DEPRECATED - use videoSplitManySimple instead
  // videoSplitFile: (options: any) => ipcRenderer.invoke('video:splitFile', options),
  // videoMergeFile: DEPRECATED - use videoMergeSimple instead
  // videoMergeFile: (options: any) => ipcRenderer.invoke('video:mergeFile', options),
  // Video Simple Module APIs
  videoGetFileInfo: (filePath: string) => ipcRenderer.invoke('video:getFileInfo', filePath),
  videoCutSingleSimple: (req: any) => ipcRenderer.invoke('video:cutSingleSimple', req),
  videoSplitManySimple: (req: any) => ipcRenderer.invoke('video:splitManySimple', req),
  videoMergeSimple: (req: any) => ipcRenderer.invoke('video:mergeSimple', req),
  videoMuteAudio: (req: any) => ipcRenderer.invoke('video:muteAudio', req),
  videoGetActiveMuteJobId: () => ipcRenderer.invoke('video:getActiveMuteJobId') as Promise<string | null>,
  videoNormalize: (req: any) => ipcRenderer.invoke('video:normalize', req),
  videoExtractAudioBatch: (req: ExtractAudioBatchRequest) =>
    ipcRenderer.invoke('video:extractAudioBatch', req) as Promise<ExtractAudioBatchResult>,
  videoGetActiveExtractAudioJobId: () => ipcRenderer.invoke('video:getActiveExtractAudioJobId') as Promise<string | null>,
  // videoNormalizeVideo: alias xóa (trùng với videoNormalize)
  videoGetActiveNormalizeJobId: () => ipcRenderer.invoke('video:getActiveNormalizeJobId') as Promise<string | null>,
  listVideosInFolder: (dir: string) => ipcRenderer.invoke('video:listVideosInFolder', dir),
  listVideosInFolderSimple: (dir: string) => ipcRenderer.invoke('video:listVideosInFolderSimple', dir),
  ultraFastScanFolder: (folderPath: string) => ipcRenderer.invoke('video:ultraFastScanFolder', folderPath),
  batchLazyProbe: (paths: string[], concurrency?: number) => ipcRenderer.invoke('video:batchLazyProbe', paths, concurrency),
  barsSpectrumPreview: (opts: {
    bgPath: string
    bgKind: 'image' | 'video'
    audioPath: string
    audioVisualizer: {
      enabled: boolean
      preset: 'bars-spectrum' | 'line-waveform' | 'mirror-waveform' | 'neon-waveform'
      position?: 'top' | 'center' | 'bottom'
      widthPercent?: number
      heightPercent?: number
      marginBottomPx?: number
      primaryColor?: string
      secondaryColor?: string
      opacity?: number
      barCount?: number
      sensitivity?: number
    }
  }) => ipcRenderer.invoke('video:barsSpectrumPreview', opts) as Promise<{ ok: boolean; previewPath?: string; error?: string }>,
  chromaKeyPreview: (opts: {
    bgVideoPath: string
    overlayVideoPath: string
    bgType: 'green' | 'black'
    keyColor: string
    similarity: number
    blend: number
    position: 'center' | 'bottom'
    scale: number
  }) => ipcRenderer.invoke('video:chromaKeyPreview', opts) as Promise<{ ok: boolean; previewPath?: string; error?: string }>,
  videoAuditFolder: (paths: string[]) => ipcRenderer.invoke('video:auditFolder', paths),
  videoDeleteFiles: (paths: string[], rootDir: string) => ipcRenderer.invoke('video:deleteFiles', paths, rootDir),
  listMediaFilesInFolder: (folderPath: string, mode?: 'all' | 'video' | 'audio') => ipcRenderer.invoke('media:listMediaFilesInFolder', folderPath, mode),
  createDirectory: (dirPath: string) => ipcRenderer.invoke('system:createDirectory', dirPath),
  openPath: (pathToOpen: string) => ipcRenderer.invoke('system:openPath', pathToOpen),
  videoFinalExport: {
    start: (payload: FinalExportRequestPayload) => ipcRenderer.send(VIDEO_FINAL_EXPORT_REQUEST, payload),
    cancel: (requestId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(VIDEO_FINAL_EXPORT_CANCEL, requestId),
    scanAudioSource: (payload: { requestId: string; audioSource: FinalExportRequestPayload['audioSource'] }): Promise<FinalExportScanResult> =>
      ipcRenderer.invoke(VIDEO_FINAL_EXPORT_SCAN_AUDIO, payload),
    scanVideoSource: (payload: { requestId: string; videoSource: FinalExportRequestPayload['videoSource'] }): Promise<FinalExportScanResult> =>
      ipcRenderer.invoke(VIDEO_FINAL_EXPORT_SCAN_VIDEO, payload),
    scanImageSource: (payload: { requestId: string; imageSource: FinalExportRequestPayload['imageSource']; perImageDurationSec?: number }): Promise<FinalExportScanResult> =>
      ipcRenderer.invoke(VIDEO_FINAL_EXPORT_SCAN_IMAGE, payload),
    onProgress: (handler: (payload: FinalExportProgressPayload) => void) => {
      const listener = (_event: IpcRendererEvent, payload: FinalExportProgressPayload) => handler(payload)
      ipcRenderer.on(VIDEO_FINAL_EXPORT_PROGRESS, listener)
      return () => {
        ipcRenderer.removeListener(VIDEO_FINAL_EXPORT_PROGRESS, listener)
      }
    },
    onDone: (handler: (payload: FinalExportDonePayload) => void) => {
      const listener = (_event: IpcRendererEvent, payload: FinalExportDonePayload) => handler(payload)
      ipcRenderer.on(VIDEO_FINAL_EXPORT_DONE, listener)
      return () => {
        ipcRenderer.removeListener(VIDEO_FINAL_EXPORT_DONE, listener)
      }
    },
    onError: (handler: (payload: FinalExportErrorPayload) => void) => {
      const listener = (_event: IpcRendererEvent, payload: FinalExportErrorPayload) => handler(payload)
      ipcRenderer.on(VIDEO_FINAL_EXPORT_ERROR, listener)
      return () => {
        ipcRenderer.removeListener(VIDEO_FINAL_EXPORT_ERROR, listener)
      }
    },
  },
  // Turbo Engine APIs (REMOVED — handlers deleted in main process)
  // videoCutSingleTurbo, videoSplitManyTurbo, videoMergeTurbo removed
  videoCancelJob: (requestId: string) => ipcRenderer.invoke('video:cancelJob', requestId),
  videoGetAllJobIds: () => ipcRenderer.invoke('video:getAllJobIds'),
  videoGetActiveMergeJobId: () => ipcRenderer.invoke('video:getActiveMergeJobId'),
  videoHasJob: (requestId: string) => ipcRenderer.invoke('video:hasJob', requestId),
  onVideoProgress: (handler: (payload: VideoProgressPayload) => void) => {
    const channel = 'video:progress'
    const listener = (_event: IpcRendererEvent, payload: any) => {
      handler(payload)
    }
    ipcRenderer.on(channel, listener)

    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
  onExportProgress: (
    handler: (payload: {
      requestId?: string
      playlistId: string
      outputPath: string
      currentSec: number
      totalSec: number
      percent: number
    }) => void
  ) => {
    const channel = 'music:exportProgress'
    const listener = (_event: IpcRendererEvent, payload: any) => {
      handler(payload)
    }
    ipcRenderer.on(channel, listener)

    // trả về hàm unsubscribe để React cleanup
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
  toFileUrl: (filePath: string): string => {
    try {
      if (!filePath) return ''
      // pathToFileURL is not available in sandboxed preload — build URL manually
      const normalized = filePath.replace(/\\/g, '/')
      const encoded = normalized.split('/').map(seg => encodeURIComponent(seg)).join('/')
      return `file:///${encoded.replace(/^\/+/, '')}`
    } catch (err) {
      console.error('[preload] toFileUrl error', filePath, err)
      return ''
    }
  },
  readFileAsBase64: (filePath: string) => ipcRenderer.invoke('system:readFileAsBase64', filePath),
  // YouTube API
  youtube: {
    // Verify yt-dlp
    verify: () => ipcRenderer.invoke('youtube:verify'),
    
    // Validate URL
    validateUrl: (url: string) => ipcRenderer.invoke('youtube:validate-url', url),
    
    // Get video info
    getVideoInfo: (url: string) => ipcRenderer.invoke('youtube:get-video-info', url),
    
    // Get channel info
    getChannelInfo: (url: string) => ipcRenderer.invoke('youtube:get-channel-info', url),
    
    // Get channel videos
    getChannelVideos: (url: string, limit?: number) => 
      ipcRenderer.invoke('youtube:get-channel-videos', url, limit),
    
    // Estimate channel size
    estimateChannelSize: (url: string, quality: string, limit?: number) =>
      ipcRenderer.invoke('youtube:estimate-channel-size', url, quality, limit),
    
    // Download single video
    downloadVideo: (request: any) => ipcRenderer.invoke('youtube:download-video', request),
    // Search accessible YouTube sources from Spotify metadata, then download audio.
    downloadSpotify: (request: SpotifyYouTubeDownloadRequest) => ipcRenderer.invoke('youtube:download-spotify', request),

    // Download channel
    downloadChannel: (params: any) => ipcRenderer.invoke('youtube:download-channel', params),
    
    // Cancel download
    cancelDownload: () => ipcRenderer.invoke('youtube:cancel-download'),
    
    // Listen to progress events
    onProgress: (callback: (progress: any) => void) => {
      const listener = (_event: IpcRendererEvent, progress: any) => callback(progress)
      ipcRenderer.on('youtube:progress', listener)
      return () => {
        ipcRenderer.removeListener('youtube:progress', listener)
      }
    },
    
    // Listen to batch progress events
    onBatchProgress: (callback: (progress: any) => void) => {
      const listener = (_event: IpcRendererEvent, progress: any) => callback(progress)
      ipcRenderer.on('youtube:batch-progress', listener)
      return () => {
        ipcRenderer.removeListener('youtube:batch-progress', listener)
      }
    },
    
    // Remove listeners
    removeProgressListener: () => {
      ipcRenderer.removeAllListeners('youtube:progress')
    },
    
    removeBatchProgressListener: () => {
      ipcRenderer.removeAllListeners('youtube:batch-progress')
    },

    // Update yt-dlp binary to latest version
    updateYtDlp: () => ipcRenderer.invoke('youtube:update-ytdlp'),

    // Cookie management
    cookieImport: (filePath?: string) => ipcRenderer.invoke('youtube:cookie-import', filePath),
    cookieList: () => ipcRenderer.invoke('youtube:cookie-list'),
    cookieTest: (platform: string) => ipcRenderer.invoke('youtube:cookie-test', platform),
    cookieRemove: (id: string) => ipcRenderer.invoke('youtube:cookie-remove', id),
    cookieHas: (platform: string) => ipcRenderer.invoke('youtube:cookie-has', platform),

    // Listen to auto-update events (fired on startup)
    onAutoUpdated: (callback: (data: { success: boolean; version?: string; ageDays: number; message: string }) => void) => {
      const listener = (_event: IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('youtube:ytdlp-auto-updated', listener)
      return () => { ipcRenderer.removeListener('youtube:ytdlp-auto-updated', listener) }
    },
    onAgeWarning: (callback: (data: { version: string; ageDays: number }) => void) => {
      const listener = (_event: IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on('youtube:ytdlp-age-warning', listener)
      return () => { ipcRenderer.removeListener('youtube:ytdlp-age-warning', listener) }
    },
  },
  jobQueue: {
    list: () => ipcRenderer.invoke('jobQueue:list'),
    get: (jobId: string) => ipcRenderer.invoke('jobQueue:get', jobId),
    cancel: (jobId: string) => ipcRenderer.invoke('jobQueue:cancel', jobId),
    onUpdate: (handler: (job: any) => void) => {
      const channel = 'jobQueue:update'
      const listener = (_event: IpcRendererEvent, payload: any) => handler(payload)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
  },
  videoPoolMarkUsed: (filePaths: string[]) => ipcRenderer.invoke('video:pool-mark-used', filePaths),
  videoPoolPickLRU: (folderPath: string, count: number) => ipcRenderer.invoke('video:pool-pick-lru', folderPath, count),
  autopilot: {
    repairInvalidVideos: (request: { paths: string[]; rootDir: string; mode: 'delete' | 'replace'; confirmed: boolean }) =>
      ipcRenderer.invoke('autopilot:repairInvalidVideos', request),
    getStatus: () => ipcRenderer.invoke('autopilot:getStatus'),
    getRecentLogs: (limit?: number) => ipcRenderer.invoke('autopilot:getRecentLogs', limit),
    getLogVerbosity: () => ipcRenderer.invoke('autopilot:getLogVerbosity'),
    setLogVerbosity: (verbosity: 'normal' | 'verbose') => ipcRenderer.invoke('autopilot:setLogVerbosity', verbosity),
    start: (config: any) => ipcRenderer.invoke('autopilot:start', config),
    cancel: () => ipcRenderer.invoke('autopilot:cancel'),
    forceReset: () => ipcRenderer.invoke('autopilot:forceReset'),
    scanVideoFolders: (rootVideo: string) => ipcRenderer.invoke('autopilot:scan-video-folders', rootVideo),
    getVideoPoolStats: () => ipcRenderer.invoke('autopilot:video-pool-stats'),
    clearVideoPool: () => ipcRenderer.invoke('autopilot:video-pool-clear'),
    onStatus: (handler: (progress: any) => void) => {
      const channel = 'autopilot:status'
      const listener = (_event: IpcRendererEvent, payload: any) => handler(payload)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
    onLog: (handler: (log: { seq: number; timestamp: string; level: 'info' | 'warn' | 'error'; message: string; verbosity: 'normal' | 'verbose' }) => void) => {
      const channel = 'autopilot:log'
      const listener = (_event: IpcRendererEvent, payload: any) => handler(payload)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
  },
  security: {
    reportAntiDebug: (details: { method: string; detected: boolean }) =>
      ipcRenderer.invoke('security:reportAntiDebug', details) as Promise<{ ok: boolean }>,
  },
  songNhac: {
    start: (request: SongNhacExportRequest) => ipcRenderer.invoke(SONG_NHAC_EXPORT_START, request) as Promise<SongNhacExportResult>,
    cancel: (requestId: string) => ipcRenderer.invoke(SONG_NHAC_EXPORT_CANCEL, requestId) as Promise<{ success: boolean; error?: string }>,
    framesBegin: (request: SongNhacFramesRequest) =>
      ipcRenderer.invoke(SONG_NHAC_FRAMES_BEGIN, request) as Promise<SongNhacFramesResult>,
    framesChunk: (requestId: string, chunk: ArrayBuffer) => {
      ipcRenderer.send(SONG_NHAC_FRAMES_CHUNK, requestId, chunk)
    },
    framesFlush: (requestId: string) =>
      ipcRenderer.invoke(SONG_NHAC_FRAMES_FLUSH, requestId) as Promise<{ success: boolean; receivedBytes?: number }>,
    framesEnd: (requestId: string) =>
      ipcRenderer.invoke(SONG_NHAC_FRAMES_END, requestId) as Promise<SongNhacFramesResult>,
    framesCancel: (requestId: string) =>
      ipcRenderer.invoke(SONG_NHAC_FRAMES_CANCEL, requestId) as Promise<{ success: boolean }>,
    onProgress: (handler: (progress: SongNhacExportProgress) => void) => {
      const listener = (_event: IpcRendererEvent, progress: SongNhacExportProgress) => handler(progress)
      ipcRenderer.on(SONG_NHAC_EXPORT_PROGRESS, listener)
      return () => ipcRenderer.removeListener(SONG_NHAC_EXPORT_PROGRESS, listener)
    },
  },
  dialog: {
    /** Mở dialog chọn file (generic) — trả về { canceled, filePaths } */
    openFile: (options: {
      title?: string
      filters?: Array<{ name: string; extensions: string[] }>
      properties?: Array<'openFile' | 'multiSelections' | 'openDirectory'>
    }) => ipcRenderer.invoke('dialog:openFile', options) as Promise<{ canceled: boolean; filePaths: string[] }>,
    /** Mở dialog lưu video — trả về { canceled, filePath } */
    saveVideoFile: (defaultFileName?: string) =>
      ipcRenderer.invoke('dialog:saveVideoFile', defaultFileName) as Promise<{ canceled: boolean; filePath: string | null }>,
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion') as Promise<string>,
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
    getGpuFfmpegProfile: () =>
      ipcRenderer.invoke('app:getGpuFfmpegProfile') as Promise<{
        ok: boolean
        profile: GpuFfmpegProfile
        error?: string
      }>,
    setGpuFfmpegProfile: (profile: GpuFfmpegProfile) =>
      ipcRenderer.invoke('app:setGpuFfmpegProfile', profile) as Promise<{
        ok: boolean
        profile: GpuFfmpegProfile
        error?: string
      }>,
    getLegacyGpuFfmpegPath: () =>
      ipcRenderer.invoke('app:getLegacyGpuFfmpegPath') as Promise<{
        ok: boolean
        path: string | null
        error?: string
      }>,
    setLegacyGpuFfmpegPath: (binaryPath: string | null) =>
      ipcRenderer.invoke('app:setLegacyGpuFfmpegPath', binaryPath) as Promise<{
        ok: boolean
        path: string | null
        error?: string
      }>,
  },
  updater: {
    check: () => ipcRenderer.invoke('app:checkUpdate'),
    install: () => ipcRenderer.invoke('app:installUpdate'),
    download: () => ipcRenderer.invoke('app:downloadUpdate'),
    getChannel: () => ipcRenderer.invoke('app:getUpdateChannel'),
    setChannel: (channel: string) => ipcRenderer.invoke('app:setUpdateChannel', channel),
    onStatus: (handler: (status: any) => void) => {
      const listener = (_event: IpcRendererEvent, status: any) => handler(status)
      ipcRenderer.on('updater:status', listener)
      return () => { ipcRenderer.removeListener('updater:status', listener) }
    },
  },
  // FIX 1.1: Sync export activity state to main process for updater guard
  setExportActive: (isActive: boolean) => ipcRenderer.invoke('app:setExportActive', isActive),
  policy: {
    get: () => ipcRenderer.invoke('policy:get'),
  },
  on: (channel: string, handler: (...args: any[]) => void) => {
    // Security: only allow subscribing to known channels
    const ALLOWED_CHANNELS = new Set([
      'app:load-error',
      'autopilot:status',
      'autopilot:log',
      'system:disk-info',
      'jobQueue:update',
      'music:exportProgress',
      'music:enhance:progress',
      'music:normalizeProgress',
      'updater:status',
      'version-gate-result',
      'youtube:progress',
      'youtube:batch-progress',
      'youtube:ytdlp-auto-updated',
      'youtube:ytdlp-age-warning',
      SONG_NHAC_EXPORT_PROGRESS,
      VIDEO_FINAL_EXPORT_PROGRESS,
      VIDEO_FINAL_EXPORT_DONE,
      VIDEO_FINAL_EXPORT_ERROR,
    ])
    if (!ALLOWED_CHANNELS.has(channel)) {
      console.warn(`[Preload] Blocked subscription to unknown channel: ${channel}`)
      return () => {} // no-op unsubscribe
    }
    const listener = (_event: IpcRendererEvent, ...args: any[]) => handler(...args)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
}

contextBridge.exposeInMainWorld('api', api)



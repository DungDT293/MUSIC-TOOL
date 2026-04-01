import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AuthLoginPayload, AuthRegisterPayload, AuthState, IPCAPI, LicenseState } from '../src/types/ipc'
import {
  VIDEO_FINAL_EXPORT_DONE,
  VIDEO_FINAL_EXPORT_ERROR,
  VIDEO_FINAL_EXPORT_PROGRESS,
  VIDEO_FINAL_EXPORT_REQUEST,
  VIDEO_FINAL_EXPORT_SCAN_AUDIO,
  VIDEO_FINAL_EXPORT_SCAN_VIDEO,
  type FinalExportDonePayload,
  type FinalExportErrorPayload,
  type FinalExportProgressPayload,
  type FinalExportRequestPayload,
  type FinalExportScanResult,
} from '../shared/videoFinalExportChannels'

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
    getExportHistory: () => ipcRenderer.invoke('music:getExportHistory'),
    deleteExportHistory: (ids: string[]) => ipcRenderer.invoke('music:deleteExportHistory', ids),
    downloadPlaylistHistory: (dates: string[], outputDir?: string) => ipcRenderer.invoke('music:downloadPlaylistHistory', dates, outputDir),
    enhanceAudio: (req: any) => ipcRenderer.invoke('music:enhance:run', req),
    cancelEnhanceAudio: () => ipcRenderer.invoke('music:enhance:cancel'),
    renderLoudnormPreview: (opts: any) => ipcRenderer.invoke('music:enhance:renderPreview', opts),
    onEnhanceProgress: (handler: (p: any) => void) => {
      const ch = 'music:enhance:progress'
      const fn = (_e: IpcRendererEvent, p: any) => handler(p)
      ipcRenderer.on(ch, fn)
      return () => ipcRenderer.removeListener(ch, fn)
    },
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
  scanMusicFolders: (payload: { priorityFolder: string | null; randomFolder: string | null }) =>
    ipcRenderer.invoke('music:scanFolders', payload),
  getLastScanResult: () => ipcRenderer.invoke('music:getLastScan'),
  createPlaylists: (payload: any) => ipcRenderer.invoke('music:createPlaylists', payload),
  listPlaylists: () => ipcRenderer.invoke('music:listPlaylists'),
  getMusicPoolStats: (trackIds: string[]) => ipcRenderer.invoke('music:getPoolStats', trackIds),
  clearMusicPool: () => ipcRenderer.invoke('music:clearPool'),
  getExportHistory: () => ipcRenderer.invoke('music:getExportHistory'),
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
  videoNormalizeVideo: (req: any) => ipcRenderer.invoke('video:normalize', req),
  videoGetActiveNormalizeJobId: () => ipcRenderer.invoke('video:getActiveNormalizeJobId') as Promise<string | null>,
  listVideosInFolder: (dir: string) => ipcRenderer.invoke('video:listVideosInFolder', dir),
  listVideosInFolderSimple: (dir: string) => ipcRenderer.invoke('video:listVideosInFolderSimple', dir),
  ultraFastScanFolder: (folderPath: string) => ipcRenderer.invoke('video:ultraFastScanFolder', folderPath),
  batchLazyProbe: (paths: string[], concurrency?: number) => ipcRenderer.invoke('video:batchLazyProbe', paths, concurrency),
  createDirectory: (dirPath: string) => ipcRenderer.invoke('system:createDirectory', dirPath),
  openPath: (pathToOpen: string) => ipcRenderer.invoke('system:openPath', pathToOpen),
  videoFinalExport: {
    start: (payload: FinalExportRequestPayload) => ipcRenderer.send(VIDEO_FINAL_EXPORT_REQUEST, payload),
    cancel: (requestId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('video:final-export:cancel', requestId),
    scanAudioSource: (payload: { requestId: string; audioSource: FinalExportRequestPayload['audioSource'] }): Promise<FinalExportScanResult> =>
      ipcRenderer.invoke(VIDEO_FINAL_EXPORT_SCAN_AUDIO, payload),
    scanVideoSource: (payload: { requestId: string; videoSource: FinalExportRequestPayload['videoSource'] }): Promise<FinalExportScanResult> =>
      ipcRenderer.invoke(VIDEO_FINAL_EXPORT_SCAN_VIDEO, payload),
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
  onVideoProgress: (
    handler: (payload: {
      requestId: string
      jobIndex?: number
      totalJobs?: number
      currentVideo?: string
      timeSec: number
      totalDurationSec: number
      percent: number
      completed?: boolean
      outputFiles?: string[]
      outputPath?: string
      error?: string
      accelerationMode?: 'NONE' | 'SSD' | 'TEMP_SSD' | 'RAM'
      diskType?: 'SSD' | 'HDD' | 'UNKNOWN'
      speedX?: number
      eta?: number
    }) => void
  ) => {
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
  videoSeoApply: (payload: any) => ipcRenderer.invoke('video:seo:apply', payload),
  videoPoolMarkUsed: (filePaths: string[]) => ipcRenderer.invoke('video:pool-mark-used', filePaths),
  videoPoolPickLRU: (folderPath: string, count: number) => ipcRenderer.invoke('video:pool-pick-lru', folderPath, count),
  autopilot: {
    getStatus: () => ipcRenderer.invoke('autopilot:getStatus'),
    start: (config: any) => ipcRenderer.invoke('autopilot:start', config),
    cancel: () => ipcRenderer.invoke('autopilot:cancel'),
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
    onLog: (handler: (log: { timestamp: string; level: 'info' | 'warn' | 'error'; message: string }) => void) => {
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
    exportVideo: (options: any) => ipcRenderer.invoke('song-nhac:export-video', options),
    getAudioDuration: (filePath: string) => ipcRenderer.invoke('song-nhac:get-audio-duration', filePath),
    readAudioFile: (filePath: string) => ipcRenderer.invoke('song-nhac:read-audio-file', filePath),
    decodeAudioForTimeline: (filePath: string) => ipcRenderer.invoke('song-nhac:decode-audio-timeline', filePath),
    listAudioInFolder: (folderPath: string) => ipcRenderer.invoke('song-nhac:list-audio-in-folder', folderPath),
    cancelExport: (jobId?: string) => ipcRenderer.invoke('song-nhac:cancel-export', jobId),
    onExportStarted: (handler: (data: any) => void) => {
      const listener = (_event: IpcRendererEvent, data: any) => handler(data)
      ipcRenderer.on('song-nhac:export-started', listener)
      return () => { ipcRenderer.removeListener('song-nhac:export-started', listener) }
    },
    onExportProgress: (handler: (data: any) => void) => {
      const listener = (_event: IpcRendererEvent, data: any) => handler(data)
      ipcRenderer.on('song-nhac:export-progress', listener)
      return () => { ipcRenderer.removeListener('song-nhac:export-progress', listener) }
    },
    onExportCancel: (handler: () => void) => {
      const listener = () => handler()
      ipcRenderer.on('song-nhac:export-cancel', listener)
      return () => { ipcRenderer.removeListener('song-nhac:export-cancel', listener) }
    },
    onExportConfig: (handler: (config: any) => void) => {
      const listener = (_event: IpcRendererEvent, config: any) => handler(config)
      ipcRenderer.on('song-nhac:export-config', listener)
      return () => { ipcRenderer.removeListener('song-nhac:export-config', listener) }
    },
    sendExportReady: () => ipcRenderer.send('song-nhac:export-ready'),
    sendExportConfigAck: (config: any) => ipcRenderer.send('song-nhac:export-config-ack', config),
    // Gửi frame đến main process (channel song-nhac:frame — khớp với ipcMain.on trong export handler)
    sendExportFrame: (frameData: any) => ipcRenderer.send('song-nhac:frame', frameData?.jobId, frameData?.buffer),
    sendExportProgress: (progress: any) => ipcRenderer.send('song-nhac:export-progress-report', progress),
    sendExportDone: (result: any) => ipcRenderer.send('song-nhac:export-done', result),
    // Signal kết thúc frame stream — triggers FFmpeg stdin.end() và unblocks export handler
    sendExportEnd: (jobId: string) => ipcRenderer.send('song-nhac:end', jobId),
  },
  dialog: {
    /** Mở dialog chọn file (generic) — trả về { canceled, filePaths } */
    openFile: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }>; properties?: string[] }) =>
      ipcRenderer.invoke('dialog:openFile', options) as Promise<{ canceled: boolean; filePaths: string[] }>,
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion') as Promise<string>,
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  },
  updater: {
    check: () => ipcRenderer.invoke('app:checkUpdate'),
    install: () => ipcRenderer.invoke('app:installUpdate'),
    getChannel: () => ipcRenderer.invoke('app:getUpdateChannel'),
    setChannel: (channel: string) => ipcRenderer.invoke('app:setUpdateChannel', channel),
    onStatus: (handler: (status: any) => void) => {
      const listener = (_event: IpcRendererEvent, status: any) => handler(status)
      ipcRenderer.on('updater:status', listener)
      return () => { ipcRenderer.removeListener('updater:status', listener) }
    },
  },
  policy: {
    get: () => ipcRenderer.invoke('policy:get'),
  },
  on: (channel: string, handler: (...args: any[]) => void) => {
    const listener = (_event: IpcRendererEvent, ...args: any[]) => handler(...args)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
}

contextBridge.exposeInMainWorld('api', api)



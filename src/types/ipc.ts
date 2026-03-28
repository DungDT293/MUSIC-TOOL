import type {
  FinalExportDonePayload,
  FinalExportErrorPayload,
  FinalExportProgressPayload,
  FinalExportRequestPayload,
  FinalExportScanResult,
} from '../../shared/videoFinalExportChannels'
export type LicenseStatus = 'checking' | 'needsRegistration' | 'pending' | 'ok' | 'offline' | 'denied'

export interface LicenseState {
  status: LicenseStatus
  machineHash: string
  message?: string
  lastSuccessAt?: number
  ticket?: string
  requestId?: string
  note?: string
}

// Auth types for đăng ký / đăng nhập người dùng
export type AuthStatus = 'unregistered' | 'pending' | 'allowed' | 'blocked' | 'error'

export interface AuthState {
  status: AuthStatus
  username?: string
  machineId: string
  activationKey?: string
  message?: string
  latestVersion?: string // Phiên bản mới nhất từ server
  downloadUrl?: string // Link tải bản mới
}

// Version Policy types
export interface VersionPolicy {
  latest_version: string
  min_supported_version: string
  blocked_versions: string[]
  recommended_version: string
  recommended_installer_url?: string
  force_update: boolean
  message?: string
  // Beta channel support
  channel?: 'stable' | 'beta'
  beta_latest_version?: string
  beta_update_url?: string
  beta_blocked_versions?: string[]
}

// Version Gate Result (from main process)
export interface VersionGateResult {
  status: 'allow' | 'block-old' | 'block-version'
  policy?: {
    min_supported_version: string
    recommended_version: string
    recommended_installer_url?: string
    message?: string
  }
}

// Updater types
export type UpdaterStatus = 
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdaterStatusPayload {
  state: UpdaterStatus
  progress?: {
    percent: number
    transferred: number
    total: number
    bytesPerSecond: number
  }
  message?: string
  version?: string
}

export interface AuthRegisterPayload {
  username: string
  password: string
  note?: string
}

export interface AuthLoginPayload {
  username: string
  password: string
  remember: boolean
}

export interface MusicScanPayload {
  // TODO: define payload structure
  [key: string]: any
}

export interface MusicCreatePlaylistPayload {
  // TODO: define payload structure
  [key: string]: any
}

export interface MusicPreviewPayload {
  // TODO: define payload structure
  [key: string]: any
}

export interface MusicExportPayload {
  // TODO: define payload structure
  [key: string]: any
}

export interface VideoCutSinglePayload {
  // TODO: define payload structure
  [key: string]: any
}

export interface VideoCutBatchPayload {
  // TODO: define payload structure
  [key: string]: any
}

export interface VideoMergePayload {
  // TODO: define payload structure
  [key: string]: any
}

export interface VideoFinalExportPayload {
  // TODO: define payload structure
  [key: string]: any
}

export interface ProbeResult {
  path: string
  format: {
    duration: number
    size: number
    bit_rate?: number
    start_time?: number
  }
  audio?: {
    codec: string
    sample_rate: number
    channels: number
    channel_layout?: string
  }
  video?: {
    codec: string
    width: number
    height: number
    fps: number
    pix_fmt?: string
  }
}

export interface SystemInfo {
  cpuModel: string
  cpuCores: number
  gpuModel?: string
  ramGB: number
  drives: Array<{
    mount: string
    totalGB: number
    freeGB: number
  }>
  ffmpegVersion?: string
}

export interface RealtimeStatsPayload {
  cpuPercent: number | null
  gpuPercent: number | null
  diskThroughputMBps: number | null
  diskReadMBps: number | null
  diskWriteMBps: number | null
}

export interface DiskDriveStatus {
  drive: string
  totalBytes: number | null
  freeBytes: number | null
  usedBytes: number | null
  usedPercent: number | null
}

export interface DiskTypeSummary {
  type: 'SSD' | 'HDD' | 'UNKNOWN'
  totalBytes: number
  freeBytes: number
  usedBytes: number
  driveCount: number
}

export interface DiskInfoSummary {
  drives: DiskDriveStatus[]
  byType: {
    ssd: DiskTypeSummary | null
    hdd: DiskTypeSummary | null
  }
  updatedAt: number
}

export interface ScannedTrack {
  id: string
  path: string
  fileName: string
  folderType: 'priority' | 'random'
  duration: number
  size: number
  codec?: string
  bitrate?: number
}

export interface ScanSummary {
  priorityCount: number
  randomCount: number
  totalCount: number
  priorityDuration: number
  randomDuration: number
  totalDuration: number
}

export interface ScanMusicResult {
  tracks: ScannedTrack[]
  summary: ScanSummary
  scannedAt?: number
}

export interface PlaylistTrack extends ScannedTrack {
  order: number
  cumulativeDuration: number
}

export interface PlaylistDefinition {
  id: string
  name: string
  targetDurationSec: number
  totalDurationSec: number
  priorityDurationSec: number
  randomDurationSec: number
  priorityCount: number
  randomCount: number
  tracks: PlaylistTrack[]
  createdAt: number
}

export interface BuildPlaylistsOptions {
  tracks: ScannedTrack[]
  pinnedTrackIds: string[]
  playlistCount: number
  targetDurationMinutes: number
  priorityRatioMin?: number
  priorityRatioMax?: number
  // Tham số cho crossfade: nếu có, sẽ tính toán target duration để đảm bảo sau crossfade vẫn đạt target
  crossfadeDurationSec?: number // Thời lượng crossfade (giây), nếu có thì sẽ điều chỉnh target duration
}

export interface ExportPlaylistRequest {
  playlistId: string
  outputDir: string
  fileName: string
  format: 'mp3' | 'wav' | 'aac'
  bitrateKbps?: number
  smoothTransitions?: boolean
  crossfadeDurationSec?: number
}

export interface ExportPlaylistResult {
  success: boolean
  outputPath?: string
  durationSec?: number
  error?: string
  requestId?: string
}

export interface CrossfadeTrackIssue {
  trackPath: string
  trackName: string
  reason: string
}

export interface CrossfadePlaylistCheckResult {
  playlistId: string
  playlistName: string
  issues: CrossfadeTrackIssue[]
}

export interface ValidatePlaylistsForCrossfadeRequest {
  playlistIds: string[]
  crossfadeDurationSec?: number
}

export interface ValidatePlaylistsForCrossfadeResult {
  results: CrossfadePlaylistCheckResult[]
  totalChecked: number
  totalWithIssues: number
}

export interface ExportProgressPayload {
  requestId?: string
  playlistId: string
  outputPath: string
  currentSec: number
  totalSec: number
  percent: number
}

export interface ExportHistoryEntry {
  id: string
  playlistId: string
  playlistName: string
  exportedAt: number
  outputPath: string
  tracks: Array<{
    name: string
    path: string
    durationSec: number
    startSec: number
  }>
}

export interface CutVideoRequest {
  inputVideoPath: string
  outputDir: string
  outputFileName: string
  startTimeSec: number
  durationSec: number
}

export interface CutVideoResult {
  success: boolean
  outputPath?: string
  error?: string
}

export interface VideoFileInfo {
  path: string
  fileName: string
  durationSec: number
  width: number
  height: number
  fps: number
  videoCodec: string
  audioCodec: string | null
  sizeBytes: number
  diskType?: 'SSD' | 'HDD' | 'UNKNOWN'
}

export interface VideoSplitOptions {
  inputPath: string
  outputDir: string
  segmentLengthSec: number
  format?: 'mp4' | 'mkv'
  keepCodec?: boolean
  /** Multicut cần siêu nhanh: cho phép tắt hoàn toàn fallback re-encode */
  allowReencode?: boolean // default: true nếu không truyền
}

// Simple Cut interfaces (NEW - đơn giản, nhanh)
export interface CutSingleSimpleRequest {
  inputPath: string
  outputDir: string
  segmentLengthSec: number
  format?: 'mp4' | 'mkv'
}

export interface CutSingleSimpleResult {
  requestId: string
  outputFiles: string[]
  segmentCount: number
  elapsedMs: number
  avgSpeed: number // Tốc độ trung bình (lần realtime, vd: 22.3x)
  success: boolean
  error?: string
}

export interface SplitManySimpleRequest {
  inputFiles?: string[]
  inputPaths?: string[]
  outputRootDir: string
  outputBaseDir?: string
  segmentLengthSec: number
  format?: 'mp4' | 'mkv'
  requestId?: string
  normalizeOutput?: boolean
}

export interface SplitManySimpleResult {
  requestId: string
  success: boolean
  totalFiles: number
  successCount: number
  failCount: number
  elapsedMs: number
  avgSpeed: number
  results: Array<{
    inputPath: string
    outputDir: string
    segmentCount: number
    success: boolean
    error?: string
  }>
}

// Turbo Engine interfaces
export interface CutSingleTurboRequest {
  inputPath: string
  outputDir: string
  segmentLengthSec: number
  format?: 'mp4' | 'mkv'
  keepCodec?: boolean
}

export interface CutSingleTurboResult {
  requestId: string
  outputFiles: string[]
  totalDurationSec: number
  segmentCount: number
  success: boolean
  error?: string
  accelerationMode: 'NONE' | 'SSD' | 'TEMP_SSD' | 'RAM'
  diskType: 'SSD' | 'HDD' | 'UNKNOWN'
}

export interface SplitManyTurboRequest {
  inputPaths: string[]
  outputBaseDir: string
  segmentLengthSec: number
  format?: 'mp4' | 'mkv'
  maxConcurrency?: number
}

export interface SplitManyTurboResult {
  requestId: string
  totalVideos: number
  successCount: number
  failCount: number
  results: Array<{
    inputPath: string
    outputDir: string
    outputFiles: string[]
    success: boolean
    error?: string
    accelerationMode: 'NONE' | 'SSD' | 'TEMP_SSD' | 'RAM'
    diskType: 'SSD' | 'HDD' | 'UNKNOWN'
  }>
  overallAccelerationMode: 'NONE' | 'SSD' | 'TEMP_SSD' | 'RAM'
  overallDiskType: 'SSD' | 'HDD' | 'UNKNOWN'
}

export interface MergeVideosTurboRequest {
  inputFiles: string[]
  outputDir: string
  outputFileName: string
  shuffle?: boolean
  mute?: boolean
  targetDurationSec?: number | null
}

export interface MergeVideosTurboResult {
  requestId: string
  outputPath: string
  totalDurationSec: number
  success: boolean
  error?: string
  accelerationMode: 'NONE' | 'SSD' | 'TEMP_SSD'
  diskType: 'SSD' | 'HDD' | 'UNKNOWN'
}

export interface MergeVideosSimpleRequest {
  inputFiles: string[]
  outputDir: string
  outputFileName: string
  shuffle?: boolean
  mute?: boolean
  targetDurationSec?: number | null
  mergeCount?: number
  repeatCount?: number
  requestId?: string
  forceReencode?: boolean
  /** Danh sách path video ưu tiên (thường nằm ở đầu inputFiles). Dùng cho logic loop khi có targetDuration. */
  priorityPaths?: string[]
}

export interface MergeVideosSimpleResult {
  requestId: string
  outputPaths: string[]
  outputPath?: string
  totalDurationSec: number
  success: boolean
  error?: string
  avgSpeed?: number
  elapsedMs?: number
}

export interface DiskInfo {
  type: 'SSD' | 'HDD' | 'UNKNOWN'
  mount: string
  isFast: boolean
}

export interface VideoSplitResult {
  requestId: string
  outputFiles: string[]
  totalDurationSec: number
}

export interface VideoProgressPayload {
  requestId: string
  jobIndex?: number // Cho splitMany
  totalJobs?: number // Cho splitMany
  currentVideo?: string // Cho splitMany
  timeSec: number
  totalDurationSec: number
  percent: number
  completed?: boolean
  outputFiles?: string[]
  outputPath?: string // Cho merge
  error?: string
  // Turbo Engine fields
  accelerationMode?: 'NONE' | 'SSD' | 'TEMP_SSD' | 'RAM'
  diskType?: 'SSD' | 'HDD' | 'UNKNOWN'
  speedX?: number // Tốc độ X× (từ frontend tính)
  eta?: number // ETA seconds (từ frontend tính)
}

export interface VideoMergeOptions {
  inputFiles: string[]
  outputDir: string
  outputFileName: string
  shuffle?: boolean
  mute?: boolean
  targetDurationSec?: number
}

export interface VideoMergeResult {
  requestId: string
  outputFiles: string[]
  totalDurationSec: number
}

export interface ListedVideoFile {
  path: string
  fileName: string
  sizeBytes: number
}

export interface SimpleVideoFileEntry {
  path: string
  fileName: string
  sizeBytes: number
  mtimeMs: number
}

export interface SimpleVideoFile {
  id: string // Hash của path
  path: string // Full path
  fileName: string // Tên file
  sizeBytes: number // Size (từ fs.stat)
  mtimeMs: number // Modified time (từ fs.stat)
  extension: string // .mp4, .mkv, etc.
}

export type JobStatus = 'pending' | 'running' | 'cancelling' | 'success' | 'failed' | 'cancelled'

export interface JobInfo {
  id: string
  type: string
  status: JobStatus
  payload?: Record<string, any>
  progress?: {
    percent?: number
    message?: string
  }
  result?: any
  error?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  logs: string[]
}

export type AutopilotStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error' | 'cancelling'

export interface AutopilotProgress {
  status: AutopilotStatus
  currentDayIndex: number | null
  currentStep: 1 | 2 | 3 | 4 | 5 | null
  stepPercent: number
  message?: string
  error?: string
  videoSelectedCount?: number
  videoTargetMin?: number
}

export interface AutopilotLogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface AutopilotDayPlan {
  id: string
  dateCode: string
  playlistCount: number | ''
  minutesPerPlaylist: number | ''
  presetId: 'tomorrowland' | 'partymix' | 'custom'
  overrides?: {
    priorityTracksPerPlaylist?: number | ''
    videoPickPercent?: number | ''
    enableCrossfade?: boolean
    crossfadeSeconds?: number | ''
    titleVariant?: 'pipe' | 'fire'
    useCustomTitles?: boolean
    customTitles?: string[]
    topDj?: string
    generateTracklist?: boolean
    normalizeVideoInput?: boolean
    prioritySelectionMode?: 'auto' | 'manual'
    priorityPinnedTrackIds?: string[]
  }
}

export interface SaveBytesAsFileRequest {
  suggestedName: string
  bytes: number[] | Uint8Array
}

export interface ConvertWebmToMp4Request {
  webmPath: string
  outputPath?: string
}

export interface AutopilotFoldersConfig {
  rootAudio: string
  rootVideo: string
  rootFinal: string
  autoCreateDailySubfolder: boolean
  priorityMusicFolder: string
  randomMusicFolder: string
}

export interface AutopilotConfig {
  dayPlans: AutopilotDayPlan[]
  folders: AutopilotFoldersConfig
}

export interface IPCAPI {
  license: {
    getState: () => Promise<LicenseState>
    register: (note?: string) => Promise<{ success: boolean; error?: string; state: LicenseState }>
    retry: () => Promise<LicenseState>
    clear: () => Promise<LicenseState>
  }
  auth: {
    getState: () => Promise<AuthState>
    register: (data: AuthRegisterPayload) => Promise<AuthState>
    refresh: () => Promise<AuthState>
    login: (data: AuthLoginPayload) => Promise<{
      ok: boolean
      message?: string
      // V2: Tamper detection
      action?: 'SUSPICIOUS' | 'BLOCKED'
      error?: string
      tamperCount?: number
    }>
    clear: () => Promise<void>
    // V2: New handlers
    checkStatus: (data: { username: string }) => Promise<{
      status: 'approved' | 'pending' | 'blocked' | 'locked' | 'revoked' | 'not_found' | 'error'
      message: string
    }>
    validateKey: (data: { username: string; key: string }) => Promise<{
      valid: boolean
      device_token?: string
      refresh_token?: string
      expires_at?: number
      attempts?: number
      locked?: boolean
      message?: string
      // V2: Tamper detection
      action?: 'SUSPICIOUS' | 'BLOCKED'
      tamperCount?: number
    }>
    validateToken: () => Promise<{
      valid: boolean
      username?: string
      expires_at?: number
      error?: string
      // V2: Tamper detection
      action?: 'SUSPICIOUS' | 'BLOCKED'
      tamperCount?: number
    }>
    refreshToken: () => Promise<{
      ok: boolean
      device_token?: string
      refresh_token?: string
      expires_at?: number
      error?: string
      // V2: Tamper detection
      action?: 'SUSPICIOUS' | 'BLOCKED'
      tamperCount?: number
    }>
  }
  music: {
    scan: (payload: MusicScanPayload) => Promise<any>
    createPlaylist: (payload: MusicCreatePlaylistPayload) => Promise<any>
    preview: (payload: MusicPreviewPayload) => Promise<any>
    export: (payload: MusicExportPayload) => Promise<any>
    validatePlaylistsForCrossfade: (
      payload: ValidatePlaylistsForCrossfadeRequest
    ) => Promise<ValidatePlaylistsForCrossfadeResult>
    normalizeAudio: (payload: {
      files?: string[]
      folder?: string
      targetBitrate: number
      outputFormat?: 'mp3' | 'aac' | 'keep'
      backupOriginal?: boolean
      outputFolder?: string
    }) => Promise<{
      success: boolean
      processed: number
      failed: number
      errors: Array<{ file: string; error: string }>
      outputFiles: string[]
    }>
    onNormalizeAudioProgress?: (handler: (progress: {
      currentFile: string
      currentIndex: number
      totalFiles: number
      percent: number
      status: 'processing' | 'completed' | 'error' | 'cancelled'
      etaSeconds?: number
      error?: string
    }) => void) => () => void
    cancelNormalizeAudio?: () => Promise<{ ok: boolean }>
    getExportHistory: () => Promise<ExportHistoryEntry[]>
    downloadPlaylistHistory: (dates: string[], outputDir?: string) => Promise<{
      success: boolean
      downloadedCount: number
      outputDir?: string
      error?: string
    }>
    deleteExportHistory: (entryIds: string[]) => Promise<{
      success: boolean
      deletedCount: number
      error?: string
    }>
  }
  video: {
    cutSingle: (payload: VideoCutSinglePayload) => Promise<any>
    cutBatch: (payload: VideoCutBatchPayload) => Promise<any>
    /** @deprecated Use videoMergeSimple instead */
    merge?: (payload: VideoMergePayload) => Promise<any>
    /** @deprecated Use videoFinalExport.start instead */
    finalExport?: (payload: VideoFinalExportPayload) => Promise<any>
  }
  probeFile: (path: string) => Promise<ProbeResult>
  getSystemInfo: () => Promise<SystemInfo>
  getRealtimeStats: () => Promise<RealtimeStatsPayload>
  getDiskInfo: () => Promise<DiskInfoSummary>
  refreshDiskInfo: () => Promise<DiskInfoSummary>
  onDiskInfo?: (handler: (info: DiskInfoSummary) => void) => () => void
  whisper: {
    preloadModel: () => Promise<{ success: boolean; error?: string }>
    checkAvailable: () => Promise<{ available: boolean; error?: string }>
    onPreloadProgress?: (handler: (progress: { percent: number; message: string }) => void) => () => void
  }
  selectFolder: () => Promise<string | null>
  selectAudioFile: () => Promise<string | null>
  selectAudioFilesMulti: () => Promise<string[] | null>
  selectImageFile: () => Promise<string | null>
  dialog: {
    openFile: (options: { title?: string; filters?: { name: string; extensions: string[] }[]; properties?: ('openFile' | 'multiSelections' | 'openDirectory')[] }) => Promise<{ canceled: boolean; filePaths: string[] }>
  }
  selectVideoFilesMulti: () => Promise<string[] | null>
  selectManyVideos: () => Promise<string[] | null>
  scanMusicFolders: (payload: { priorityFolder: string | null; randomFolder: string | null }) => Promise<ScanMusicResult>
  getLastScanResult: () => Promise<ScanMusicResult | null>
  createPlaylists: (options: BuildPlaylistsOptions) => Promise<PlaylistDefinition[]>
  listPlaylists: () => Promise<PlaylistDefinition[]>
  exportPlaylist: (req: ExportPlaylistRequest) => Promise<ExportPlaylistResult>
  cutVideoSegment?: (req: CutVideoRequest) => Promise<CutVideoResult> // DEPRECATED - use videoCutSingleSimple instead
  selectVideoFile: () => Promise<string | null>
  videoGetFileInfo: (filePath: string) => Promise<VideoFileInfo>
  videoProbeFile: (filePath: string) => Promise<VideoFileInfo>
  videoSplitFile?: (options: VideoSplitOptions) => Promise<VideoSplitResult> // DEPRECATED - use videoSplitManySimple instead
  videoMergeFile?: (options: VideoMergeOptions) => Promise<VideoMergeResult> // DEPRECATED - use videoMergeSimple instead
  listVideosInFolder: (dir: string) => Promise<ListedVideoFile[]>
  listVideosInFolderSimple: (dir: string) => Promise<SimpleVideoFileEntry[]>
  videoAuditFolder: (paths: string[]) => Promise<{
    valid: Array<{ path: string; durationSec: number; width?: number; height?: number; codecName?: string; fps?: number; sizeBytes?: number }>
    invalid: string[]
  }>
  videoDeleteFiles: (paths: string[], rootDir: string) => Promise<{ deleted: number; errors: Array<{ path: string; message: string }> }>
  ultraFastScanFolder: (folderPath: string) => Promise<SimpleVideoFile[]>
  batchLazyProbe: (paths: string[], concurrency?: number) => Promise<Record<string, VideoFileInfo | null>>
  createDirectory: (dirPath: string) => Promise<{ success: boolean; error?: string }>
  openPath: (pathToOpen: string) => Promise<{ success: boolean; error?: string }>
  // Simple Cut API (NEW - đơn giản, nhanh)
  videoCutSingleSimple: (req: CutSingleSimpleRequest) => Promise<CutSingleSimpleResult>
  videoSplitManySimple: (req: SplitManySimpleRequest) => Promise<SplitManySimpleResult>
  videoMergeSimple: (req: MergeVideosSimpleRequest) => Promise<MergeVideosSimpleResult>
  videoMuteAudio: (req: {
    inputFiles: string[]
    outputDir: string
    requestId?: string
  }) => Promise<{
    requestId: string
    outputPaths: string[]
    success: boolean
    error?: string
    processed: number
    failed: number
  }>
  videoGetActiveMuteJobId: () => Promise<string | null>
  videoNormalize: (req: {
    inputFiles: string[]
    outputDir: string
    useGpu?: boolean
    requestId?: string
  }) => Promise<{
    requestId: string
    outputPaths: string[]
    success: boolean
    error?: string
    processed: number
    failed: number
    usedGpu: boolean
  }>
  videoNormalizeVideo: (req: {
    inputFiles: string[]
    outputDir: string
    useGpu?: boolean
    requestId?: string
  }) => Promise<{
    requestId: string
    outputPaths: string[]
    success: boolean
    error?: string
    processed: number
    failed: number
    usedGpu: boolean
  }>
  videoGetActiveNormalizeJobId: () => Promise<string | null>
  // Turbo Engine APIs
  detectDiskType: (filePath: string) => Promise<'SSD' | 'HDD' | 'UNKNOWN'>
  videoGetDiskInfo: (filePath: string) => Promise<DiskInfo>
  videoCutSingleTurbo: (req: CutSingleTurboRequest) => Promise<CutSingleTurboResult>
  videoSplitManyTurbo: (req: SplitManyTurboRequest) => Promise<SplitManyTurboResult>
  videoMergeTurbo: (req: MergeVideosTurboRequest) => Promise<MergeVideosTurboResult>
  videoCancelJob: (requestId: string) => Promise<{ success: boolean; error?: string }>
  onVideoProgress: (
    handler: (payload: VideoProgressPayload) => void
  ) => () => void
  onExportProgress: (
    handler: (payload: ExportProgressPayload) => void
  ) => () => void
  toFileUrl: (filePath: string) => Promise<string>
  videoFinalExport: {
    start: (payload: FinalExportRequestPayload) => void
    cancel: (requestId: string) => Promise<{ success: boolean; error?: string }>
    scanAudioSource: (payload: {
      requestId: string
      audioSource: FinalExportRequestPayload['audioSource']
    }) => Promise<FinalExportScanResult>
    scanVideoSource: (payload: {
      requestId: string
      videoSource: FinalExportRequestPayload['videoSource']
    }) => Promise<FinalExportScanResult>
    onProgress: (handler: (payload: FinalExportProgressPayload) => void) => () => void
    onDone: (handler: (payload: FinalExportDonePayload) => void) => () => void
    onError: (handler: (payload: FinalExportErrorPayload) => void) => () => void
  }
  videoGetAllJobIds: () => Promise<string[]>
  videoGetActiveMergeJobId: () => Promise<string | null>
  videoHasJob: (requestId: string) => Promise<boolean>
  autopilot?: {
    getStatus: () => Promise<AutopilotProgress>
    start: (config: AutopilotConfig) => Promise<{ ok: boolean; error?: string }>
    cancel: () => Promise<{ ok: boolean }>
    onStatus: (handler: (progress: AutopilotProgress) => void) => () => void
    onLog: (handler: (log: AutopilotLogEntry) => void) => () => void
  }
  security?: {
    reportAntiDebug: (details: { method: string; detected: boolean }) => Promise<{ ok: boolean }>
  }
  app: {
    getVersion: () => Promise<string>
  }
  policy: {
    get: () => Promise<VersionPolicy>
  }
  updater: {
    check: () => Promise<{ ok: boolean; error?: string }>
    install: () => Promise<{ ok: boolean; error?: string }>
    getChannel: () => Promise<{ ok: boolean; channel: 'stable' | 'beta'; error?: string }>
    setChannel: (channel: 'stable' | 'beta') => Promise<{ ok: boolean; error?: string }>
    onStatus: (callback: (status: UpdaterStatusPayload) => void) => () => void
  }
  youtube: {
    verify: () => Promise<{ success: boolean; available?: boolean; error?: string }>
    validateUrl: (url: string) => Promise<{
      success: boolean
      isValid?: boolean
      type?: 'video' | 'channel' | 'playlist' | 'unknown'
      error?: string
    }>
    getVideoInfo: (url: string) => Promise<{
      success: boolean
      videoInfo?: YouTubeVideoInfo
      error?: string
    }>
    getChannelInfo: (url: string) => Promise<{
      success: boolean
      channelInfo?: {
        channelName: string
        channelId: string
        videoCount: number
      }
      error?: string
    }>
    getChannelVideos: (url: string, limit?: number) => Promise<{
      success: boolean
      videos?: YouTubeVideoInfo[]
      error?: string
    }>
    estimateChannelSize: (url: string, quality: YouTubeQuality, limit?: number) => Promise<{
      success: boolean
      estimate?: {
        videoCount: number
        estimatedSizeBytes: number
        estimatedSizeFormatted: string
        avgSizePerVideo: number
      }
      error?: string
    }>
    downloadVideo: (request: YouTubeDownloadVideoRequest) => Promise<{
      success: boolean
      outputFile?: string
      error?: string
    }>
    downloadChannel: (params: {
      url: string
      outputDir: string
      quality: YouTubeQuality
      options: {
        downloadSubtitles?: boolean
        downloadThumbnail?: boolean
        limit?: number
        continueOnError?: boolean
        concurrent?: boolean
        concurrency?: number
        audioOnly?: boolean
        audioFormat?: 'mp3' | 'wav'
      }
    }) => Promise<{
      success: boolean
      downloaded?: string[]
      failed?: Array<{ video: YouTubeVideoInfo; error: string }>
      error?: string
    }>
    cancelDownload: () => Promise<{ success: boolean; error?: string }>
    onProgress: (callback: (progress: YouTubeDownloadProgress) => void) => () => void
    onBatchProgress: (callback: (progress: YouTubeBatchDownloadProgress) => void) => () => void
    removeProgressListener: () => void
    removeBatchProgressListener: () => void
  }
  jobQueue: {
    list: () => Promise<JobInfo[]>
    get: (jobId: string) => Promise<JobInfo | null>
    cancel: (jobId: string) => Promise<{ success: boolean }>
    onUpdate: (handler: (job: JobInfo) => void) => () => void
  }
  songNhac: {
    readAudioFile: (filePath: string) => Promise<Uint8Array>
    decodeAudioForTimeline: (filePath: string) => Promise<{ buffer: Uint8Array; sampleRate: number; duration: number; realFileDurationSec?: number }>
    listAudioInFolder: (folderPath: string) => Promise<{ path: string; fileName: string }[]>
    exportVideo: (config: { width: number; height: number; fps: number; durationSec: number; audioFileUrl?: string; outputPath?: string; forceCpuEncoder?: boolean }) => Promise<{ ok: boolean; outPath?: string; error?: string; suggestedRetryWithCpu?: boolean; retryConfig?: Record<string, unknown> }>
    cancelExport: (jobId: string) => Promise<{ ok: boolean }>
    onExportStarted: (callback: (payload: { jobId: string }) => void) => () => void
    onExportProgress: (callback: (frameIndex: number, totalFrames: number) => void) => () => void
    onExportCancel: (callback: () => void) => () => void
    onExportConfig: (callback: (config: unknown) => void) => () => void
    sendExportReady: () => void
    sendExportConfigAck: (jobId: string) => void
    sendExportFrame: (payload: { jobId: string; frameIndex: number; width: number; height: number; buffer: ArrayBuffer }) => void
    sendExportProgress: (payload: { jobId: string; frameIndex: number; totalFrames: number }) => void
    sendExportDone: (payload?: { ok?: boolean; error?: string; framesWritten?: number }) => void
  }
  videoSeoApply: (payload: any) => Promise<any>
  saveBytesAsFile: (req: SaveBytesAsFileRequest) => Promise<string>
  convertWebmToMp4: (req: ConvertWebmToMp4Request) => Promise<string>
  logToTerminal: (...args: any[]) => Promise<boolean>
  // PHASE 2: Canvas Export
  canvasExportToVideo: (req: {
    scene: any // Using any to avoid complex import for now, or use actual type
    outputPath: string
  }) => Promise<{ success: boolean; outputPath: string }>
  onCanvasExportProgress: (callback: (progress: any) => void) => () => void
  muxAudioWithVideo: (req: {
    videoBytes: Uint8Array
    audioPath: string
    outputPath: string
  }) => Promise<{ success: boolean; filePath: string; error?: string }>
  readFile: (filePath: string) => Promise<Uint8Array>
  // General IPC helpers for offscreen renderer
  send: (channel: string, ...args: any[]) => void
  on: (channel: string, callback: (...args: any[]) => void) => () => void
  invoke: (channel: string, ...args: any[]) => Promise<any>
}

declare global {
  interface Window {
    api: IPCAPI
  }
}

// YouTube Types
export type YouTubeQuality = 'best' | '4320' | '2160' | '1440' | '1080' | '720' | '480' | '360'

export interface YouTubeVideoInfo {
  id: string
  title: string
  duration: number
  thumbnail: string
  description: string
  uploader: string
  uploadDate: string
  viewCount: number
  likeCount: number
  width: number
  height: number
  formats: YouTubeVideoFormat[]
  hasSubtitles?: boolean
  subtitles?: Array<{ lang: string; langCode: string }>
}

export interface YouTubeVideoFormat {
  formatId: string
  ext: string
  resolution: string
  fps: number
  filesize: number
  vcodec: string
  acodec: string
}

export interface YouTubeDownloadVideoRequest {
  url: string
  outputDir: string
  quality: YouTubeQuality
  downloadSubtitles: boolean
  downloadThumbnail: boolean
  upscaleTo4K?: boolean
  audioOnly?: boolean
  audioFormat?: 'mp3' | 'wav'
  useCookies?: boolean
  cookiesFile?: string
  cookiesFromBrowser?: 'chrome' | 'firefox' | 'edge' | 'opera' | 'safari'
}

export interface YouTubeDownloadProgress {
  type: 'info' | 'download' | 'postprocess' | 'complete' | 'error'
  videoId?: string
  title?: string
  percent?: number
  downloadedBytes?: number
  totalBytes?: number
  speed?: string
  eta?: string
  message?: string
}

export interface YouTubeBatchDownloadProgress {
  currentVideoIndex: number
  totalVideos: number
  currentVideoTitle: string
  currentVideoPercent: number
  completedVideos: number
  failedVideos: number
  overallPercent: number
  errors: Array<{ videoTitle: string; error: string }>
}

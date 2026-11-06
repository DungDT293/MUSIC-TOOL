import type {
  SongNhacExportProgress,
  SongNhacExportRequest,
  SongNhacExportResult,
  SongNhacFramesRequest,
  SongNhacFramesResult,
} from '../../shared/songNhacChannels'
import type {
  FinalExportAudioFailure,
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
  preferredView?: 'register' | 'login'
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

export type GpuFfmpegProfile = 'auto' | 'modern' | 'legacy'

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

// Stub payload interfaces (MusicScanPayload, MusicCreatePlaylistPayload, etc.) đã xóa
// vì chưa bao giờ được dùng trong codebase (chỉ có TODO: define payload structure)

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

export type MusicFolderType = 'priority' | 'random' | 'opening' | 'background'

export interface MusicScanGenre {
  id: string
  name: string
  priorityFolders: string[]
  randomFolders: string[]
  openingFolders?: string[]
  backgroundFolders?: string[]
}

export interface ScanMusicConfig {
  version: 3
  genres: MusicScanGenre[]
}

export interface ScannedTrack {
  id: string
  path: string
  fileName: string
  folderType: MusicFolderType
  genreId?: string
  genreName?: string
  sourceFolder?: string
  duration: number
  size: number
  codec?: string
  bitrate?: number
}

export interface GenreScanSummary {
  genreId: string
  genreName: string
  openingCount?: number
  priorityCount: number
  randomCount: number
  backgroundCount?: number
  totalCount: number
  openingDuration?: number
  priorityDuration: number
  randomDuration: number
  backgroundDuration?: number
  totalDuration: number
}

export interface ScanSummary {
  openingCount?: number
  priorityCount: number
  randomCount: number
  backgroundCount?: number
  totalCount: number
  openingDuration?: number
  priorityDuration: number
  randomDuration: number
  backgroundDuration?: number
  totalDuration: number
  genres?: GenreScanSummary[]
}

export interface ScanMusicResult {
  tracks: ScannedTrack[]
  summary: ScanSummary
  scannedAt?: number
  config?: ScanMusicConfig
  cacheStatus?: 'scanned' | 'reused' | 'loaded'
  /** Các file audio KHÔNG phải chuẩn AAC (.m4a / .aac). Cần chuẩn hóa. */
  nonAacFiles?: string[]
}

export interface ScanMusicFoldersPayload {
  priorityFolder?: string | null
  randomFolder?: string | null
  genres?: MusicScanGenre[]
  forceRescan?: boolean
  openingFolders?: string[]
  backgroundFolders?: string[]
}

export interface PlaylistTrack extends ScannedTrack {
  order: number
  cumulativeDuration: number
  role?: 'opening' | 'ending'
}

export interface PlaylistDefinition {
  id: string
  name: string
  targetDurationSec: number
  totalDurationSec: number
  priorityDurationSec: number
  randomDurationSec: number
  openingDurationSec?: number
  openingCount?: number
  priorityCount: number
  randomCount: number
  endingDurationSec?: number
  endingCount?: number
  backgroundTrack?: ScannedTrack
  bgMusicVolumeDb?: number
  mainMusicVolumeDb?: number
  tracks: PlaylistTrack[]
  createdAt: number
  genreId?: string
  genreName?: string
  genreSettings?: {
    smoothTransitions: boolean
    crossfadeDurationSec?: number
    normalizeLoudness: boolean
  }
}

export interface SpotifyMetadataRequest {
  url: string
  pageLimit?: number
}

export type SpotifyMetadataErrorCode = 'invalid' | 'auth-required' | 'access-denied' | 'rate-limit' | 'upstream' | 'timeout'

export interface SpotifyMetadataError {
  code: SpotifyMetadataErrorCode
  message: string
  retryAfterSeconds?: number
}

export interface SpotifyMetadataTrack {
  id: string
  name: string
  artists: string[]
  albumName?: string
  durationMs?: number
  externalUrl: string
}

export type SpotifyMetadataResult =
  | {
      success: true
      type: 'track' | 'album' | 'playlist'
      id: string
      name: string
      externalUrl: string
      tracks: SpotifyMetadataTrack[]
    }
  | {
      success: false
      error: SpotifyMetadataError
    }

export interface MusicPoolTrackStat {
  id: string
  lastUsedAt: number | null
  useCount: number
  addedAt: number
  tier: 0 | 1 | 2
  daysSinceUsed: number | null
}

export interface MusicPoolStats {
  total: number
  tier0: number
  tier1: number
  tier2: number
  updatedAt: number | null
  tracks: MusicPoolTrackStat[]
}

export interface BuildPlaylistWarning {
  type: 'priority_ratio_not_met' | 'track_reuse_needed' | 'insufficient_tracks'
  playlistIndex?: number
  message: string
  actualRatioPct?: number
  targetRatioPct?: number
}

export interface BuildPlaylistsResult {
  playlists: PlaylistDefinition[]
  warnings: BuildPlaylistWarning[]
}

export interface BuildPlaylistsOptions {
  tracks: ScannedTrack[]
  pinnedTrackIds: string[]
  playlistCount: number
  targetDurationMinutes: number
  priorityRatioMin?: number
  priorityRatioMax?: number
  openingTracks?: ScannedTrack[]
  pinnedOpeningTrackIds?: string[]
  combineAllPinnedOpenings?: boolean
  endingTracks?: ScannedTrack[]
  backgroundTracks?: ScannedTrack[]
  selectedBackgroundTrackId?: string
  bgMusicVolumeDb?: number
  mainMusicVolumeDb?: number
  // Tham số cho crossfade: nếu có, sẽ tính toán target duration để đảm bảo sau crossfade vẫn đạt target
  crossfadeDurationSec?: number // Thời lượng crossfade (giây), nếu có thì sẽ điều chỉnh target duration
  replaceExisting?: boolean
  genreId?: string
  genreName?: string
  genreSettings?: {
    smoothTransitions: boolean
    crossfadeDurationSec?: number
    normalizeLoudness: boolean
  }
}

export interface ExportPlaylistRequest {
  playlistId: string
  outputDir: string
  fileName: string
  format: 'mp3' | 'wav' | 'aac'
  bitrateKbps?: number
  smoothTransitions?: boolean
  crossfadeDurationSec?: number
  /** Cân bằng âm lượng giữa các bài (EBU R128 loudnorm) */
  normalizeLoudness?: boolean
  /** Target LUFS (default -14 = YouTube/Spotify standard) */
  loudnessTargetLufs?: number
  /** Đường dẫn file nhạc nền trộn kèm (nếu có) */
  backgroundTrackPath?: string
  /** Âm lượng nhạc nền tính theo dB (mặc định -4 dB) */
  bgMusicVolumeDb?: number
  /** Âm lượng nhạc ghép chính tính theo dB (mặc định +2 dB) */
  mainMusicVolumeDb?: number
  /** Tùy chọn: scanResult truyền trực tiếp */
  scanResult?: ScanMusicResult
}

export interface ExportPlaylistResult {
  success: boolean
  outputPath?: string
  durationSec?: number
  error?: string
  requestId?: string
}

// ── Audio Enhancement (Nâng cấp âm thanh) ─────────────────────────────────

export interface EQSettings {
  enabled: boolean
  highpassHz: number     // 20..1000, default 20
  lowpassHz: number      // 8000..22050, default 22050
  bassGainDb: number     // -12..+12, lowshelf 110Hz
  band1Gain: number      // -12..+12, peaking 200Hz
  midGainDb: number      // -12..+12, peaking 1000Hz
  band2Gain: number      // -12..+12, peaking 4000Hz
  trebleGainDb: number   // -12..+12, highshelf 10000Hz
}

export interface CompressorSettings {
  enabled: boolean
  thresholdDb: number   // -40..0, default -18
  ratio: number         // 1..20, default 4
  attackMs: number      // 0.1..100, default 5
  releaseMs: number     // 10..1000, default 50
  makeupGainDb: number  // 0..12, default 2
  knee: number          // 1..8, default 2.83
  mix: number           // 0..1, default 1 (parallel compression)
}

export interface LoudnormSettings {
  enabled: boolean
  integratedLufs: number  // -23..-6, default -14
  truePeakDbtp: number    // -3..0, default -1
  lra: number             // 1..20, default 11
}

export interface StereoSettings {
  enabled: boolean
  amount: number  // 0..3: 0=mono, 1=original, 2=wide, 3=extra-wide
}

export interface NoiseGateSettings {
  enabled: boolean
  thresholdDb: number   // -80..-5, default -40
  ratio: number         // 2..20, default 6
  attackMs: number      // 0.1..50, default 5
  releaseMs: number     // 10..2000, default 200
  rangeDb: number       // -60..0, default -24
}

export interface LimiterSettings {
  enabled: boolean
  thresholdDbtp: number  // -3..0, default -0.5
  attackMs: number       // 0.1..20, default 1
  releaseMs: number      // 10..500, default 50
}

export interface ExciterSettings {
  enabled: boolean
  freq: number           // 2000..12000, default 7500
  amount: number         // 1..50, default 20
  drive: number          // 1..10, default 5
  blend: number          // -10..10, default 2
}

export interface NoiseReductionSettings {
  enabled: boolean
  noiseReducDb: number   // 0..80, default 15
  noiseFloorDb: number   // -90..-20, default -50
}

export interface EnhanceAudioRequest {
  files: string[]
  outputDir?: string
  outputFormat?: 'mp3' | 'aac' | 'wav' | 'keep'
  bitrateKbps?: number
  overwrite?: boolean
  eq?: EQSettings
  compressor?: CompressorSettings
  loudnorm?: LoudnormSettings
  stereo?: StereoSettings
  noiseGate?: NoiseGateSettings
  limiter?: LimiterSettings
  exciter?: ExciterSettings
  noiseReduction?: NoiseReductionSettings
}

export interface EnhanceAudioProgress {
  currentFile: string
  currentIndex: number
  totalFiles: number
  percent: number
  status: 'processing' | 'completed' | 'error' | 'cancelled'
  error?: string
}

export interface EnhanceAudioResult {
  success: boolean
  processed: number
  failed: number
  errors: Array<{ file: string; error: string }>
  outputFiles: string[]
}

export interface LoudnormPreviewResult {
  success: boolean
  previewPath?: string
  error?: string
}

export interface LoudnormPreviewRequest {
  inputFile: string
  integratedLufs: number
  truePeakDbtp: number
  lra: number
  durationSec?: number  // default 30
  startSec?: number     // default 0
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
  normalizeOutput?: boolean
  useGpuEncoding?: boolean
  targetResolution?: string
  targetFps?: string
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

// Turbo Engine interfaces — ĐÃ XÓA (handlers không còn tồn tại, backend/video_backup/ đã bị xóa)

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
  mode?: 'single-cut' | 'multi-cut' | 'merge' | 'mute-audio' | 'normalize' | 'extract-audio'
  jobIndex?: number // Cho splitMany
  totalJobs?: number // Cho splitMany
  currentVideo?: string // Cho splitMany
  currentFile?: string
  currentIndex?: number
  totalFiles?: number
  timeSec?: number
  totalDurationSec?: number
  percent: number
  message?: string
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

export interface ExtractAudioBatchRequest {
  inputFiles: string[]
  outputDir: string
  audioFormat: 'mp3' | 'wav'
  mp4Only?: boolean
  requestId?: string
}

export interface ExtractAudioBatchResult {
  requestId: string
  outputPaths: string[]
  failures: Array<{ inputPath: string; fileName: string; error: string }>
  success: boolean
  error?: string
  processed: number
  failed: number
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

export type AutopilotStatus = 'idle' | 'running' | 'paused' | 'completed' | 'completed_with_errors' | 'error' | 'cancelling'
export type AutopilotLogVerbosity = 'normal' | 'verbose'

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
  seq: number
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  verbosity: AutopilotLogVerbosity
}

export type { FinalExportAudioFailure }

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
    bgMusicVolumeDb?: number | ''
    mainMusicVolumeDb?: number | ''
  }
}

export interface AutopilotFoldersConfig {
  rootAudio: string
  rootVideo: string
  rootFinal: string
  autoCreateDailySubfolder: boolean
  priorityMusicFolder: string
  randomMusicFolder: string
  openingMusicFolder?: string
  backgroundMusicFolder?: string
  priorityVideoFolder?: string
  endingAudioPaths?: string[]
  minVideoClipsTarget?: number
}

export interface AutopilotConfig {
  dayPlans: AutopilotDayPlan[]
  folders: AutopilotFoldersConfig
  runtimeOverrides?: {
    finalExportUseGpuEncoding?: 'gpu' | 'cpu' | 'auto'
    requireGpuForVideoEncode?: boolean
  }
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
    refreshToken?: () => Promise<{
      ok: boolean
      device_token?: string
      refresh_token?: string
      expires_at?: number
      error?: string
    }>
  }
  music: {
    scan?: (payload: any) => Promise<any>
    createPlaylist?: (payload: any) => Promise<any>
    preview?: (payload: any) => Promise<any>
    export?: (payload: any) => Promise<any>
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
      loudnessPreset?: 'streaming' | 'youtube' | 'broadcast' | 'club'
      deleteOriginalOnSuccess?: boolean
      perSourceFolderSuffix?: string
    }) => Promise<{
      success: boolean
      processed: number
      failed: number
      errors: Array<{ file: string; error: string }>
      outputFiles: string[]
      deletedOriginalFiles?: string[]
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
    spotifyMeta?: (url: string) => Promise<{ success: boolean; title?: string; artist?: string; thumbnailUrl?: string; providerName?: string; url?: string; error?: string }>
    spotifyImport: (request: SpotifyMetadataRequest) => Promise<SpotifyMetadataResult>
    getExportHistory: () => Promise<ExportHistoryEntry[]>
    downloadPlaylistHistory: (payload: { dates?: string[]; entryIds?: string[]; outputDir?: string }) => Promise<{
      success: boolean
      downloadedCount: number
      outputDir?: string
      savedFiles?: string[]
      error?: string
    }>
    deleteExportHistory: (entryIds: string[]) => Promise<{
      success: boolean
      deletedCount: number
      error?: string
    }>
    enhanceAudio?: (req: any) => Promise<any>
    cancelEnhanceAudio?: () => Promise<any>
    renderLoudnormPreview?: (opts: any) => Promise<any>
    onEnhanceProgress?: (handler: (p: any) => void) => () => void
    previewMix?: (opts: {
      mainTrackPath: string
      bgTrackPath: string
      mainVolumeDb?: number
      bgMusicVolumeDb?: number
      durationSec?: number
    }) => Promise<{
      success: boolean
      previewUrl?: string
      error?: string
    }>
  }
  probeFile: (path: string) => Promise<ProbeResult>
  preset?: {
    list: () => Promise<{ success: boolean; presets: any[] }>
    save: (name: string, settings: any) => Promise<{ success: boolean; preset?: any; error?: string }>
    update: (id: string, name: string, settings: any) => Promise<{ success: boolean; preset?: any; error?: string }>
    delete: (id: string) => Promise<{ success: boolean; deleted?: boolean; error?: string }>
  }
  getSystemInfo: () => Promise<SystemInfo>
  getRealtimeStats: () => Promise<RealtimeStatsPayload>
  getDiskInfo: () => Promise<DiskInfoSummary>
  refreshDiskInfo: () => Promise<DiskInfoSummary>
  onDiskInfo?: (handler: (info: DiskInfoSummary) => void) => () => void
  // whisper: đã xóa (không có IPC handler nào)
  selectFolder: () => Promise<string | null>
  selectAudioFile: () => Promise<string | null>
  selectAudioFilesMulti: () => Promise<string[] | null>
  selectImageFile: () => Promise<string | null>
  selectImageFilesMulti: () => Promise<string[] | null>
  dialog: {
    openFile: (options: { title?: string; filters?: { name: string; extensions: string[] }[]; properties?: ('openFile' | 'multiSelections' | 'openDirectory')[] }) => Promise<{ canceled: boolean; filePaths: string[] }>
    saveVideoFile: (defaultFileName?: string) => Promise<{ canceled: boolean; filePath: string | null }>
  }
  selectVideoFilesMulti: () => Promise<string[] | null>
  selectManyVideos: () => Promise<string[] | null>
  scanMusicFolders: (payload: ScanMusicFoldersPayload) => Promise<ScanMusicResult>
  getLastScanResult: () => Promise<ScanMusicResult | null>
  createPlaylists: (options: BuildPlaylistsOptions) => Promise<BuildPlaylistsResult>
  listPlaylists: () => Promise<PlaylistDefinition[]>
  getMusicPoolStats: (trackIds: string[]) => Promise<MusicPoolStats>
  clearMusicPool: () => Promise<{ success: boolean }>
  exportPlaylist: (req: ExportPlaylistRequest) => Promise<ExportPlaylistResult>
  cutVideoSegment?: (req: CutVideoRequest) => Promise<CutVideoResult> // DEPRECATED - use videoCutSingleSimple instead
  selectVideoFile: () => Promise<string | null>
  videoGetFileInfo: (filePath: string) => Promise<VideoFileInfo>
  videoProbeFile: (filePath: string) => Promise<VideoFileInfo>
  videoSplitFile?: (options: VideoSplitOptions) => Promise<VideoSplitResult> // DEPRECATED - use videoSplitManySimple instead
  videoMergeFile?: (options: VideoMergeOptions) => Promise<VideoMergeResult> // DEPRECATED - use videoMergeSimple instead
  listVideosInFolder: (dir: string) => Promise<ListedVideoFile[]>
  listVideosInFolderSimple: (dir: string) => Promise<SimpleVideoFileEntry[]>
  listMediaFilesInFolder?: (folderPath: string, mode?: 'all' | 'video' | 'audio') => Promise<Array<{ path: string; fileName: string; sizeBytes: number; kind: 'video' | 'audio' }>>
  videoAuditFolder: (paths: string[]) => Promise<{
    valid: Array<{ path: string; durationSec: number; width?: number; height?: number; codecName?: string; fps?: number; sizeBytes?: number; formatName?: string; bitrateBps?: number; kind?: 'video' | 'audio' }>
    invalid: string[]
    invalidDetails?: Array<{ path: string; reason: string; kind?: 'video' | 'audio' }>
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
  videoExtractAudioBatch: (req: ExtractAudioBatchRequest) => Promise<ExtractAudioBatchResult>
  videoGetActiveExtractAudioJobId: () => Promise<string | null>
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
    targetResolution?: string
    targetFps?: string
    concatSafe?: boolean
    skipExisting?: boolean
    writeManifest?: boolean
    trustInputs?: boolean
  }) => Promise<{
    requestId: string
    outputPaths: string[]
    success: boolean
    error?: string
    processed: number
    failed: number
    skipped?: number
    usedGpu: boolean
    manifestPath?: string
  }>
  // videoNormalizeVideo: alias đã xóa — dùng videoNormalize thay thế
  videoGetActiveNormalizeJobId: () => Promise<string | null>
  // Turbo Engine APIs đã bị xóa — handlers không còn tồn tại
  videoCancelJob: (requestId: string) => Promise<{ success: boolean; error?: string }>
  videoPoolMarkUsed?: (filePaths: string[]) => Promise<{ ok: boolean; marked?: number; error?: string }>
  videoPoolPickLRU?: (folderPath: string, count: number) => Promise<{ ok: boolean; filePaths: string[]; reusedCount?: number; totalAvailable?: number; error?: string }>
  onVideoProgress: (
    handler: (payload: VideoProgressPayload) => void
  ) => () => void
  onExportProgress: (
    handler: (payload: ExportProgressPayload) => void
  ) => () => void
  // toFileUrl is sync in preload (pathToFileURL is sync) — union type to avoid breaking callers that use await
  toFileUrl: (filePath: string) => string | Promise<string>
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
  }) => Promise<{ ok: boolean; previewPath?: string; error?: string }>
  chromaKeyPreview: (opts: {
    bgVideoPath: string
    overlayVideoPath: string
    bgType: 'green' | 'black'
    keyColor: string
    similarity: number
    blend: number
    position: 'center' | 'bottom'
    scale: number
  }) => Promise<{ ok: boolean; previewPath?: string; error?: string }>
  videoFinalExport: {
    start: (payload: FinalExportRequestPayload) => void
    cancel: (requestId: string) => Promise<{ success: boolean; error?: string }>
    scanAudioSource: (payload: {
      requestId: string
      audioSource: FinalExportRequestPayload['audioSource']
    }) => Promise<FinalExportScanResult>
    scanVideoSource: (payload: {
      requestId: string
      videoSource: NonNullable<FinalExportRequestPayload['videoSource']>
    }) => Promise<FinalExportScanResult>
    scanImageSource: (payload: {
      requestId: string
      imageSource: NonNullable<FinalExportRequestPayload['imageSource']>
      perImageDurationSec?: number
    }) => Promise<FinalExportScanResult>
    onProgress: (handler: (payload: FinalExportProgressPayload) => void) => () => void
    onDone: (handler: (payload: FinalExportDonePayload) => void) => () => void
    onError: (handler: (payload: FinalExportErrorPayload) => void) => () => void
  }
  videoGetAllJobIds: () => Promise<string[]>
  videoGetActiveMergeJobId: () => Promise<string | null>
  videoHasJob: (requestId: string) => Promise<boolean>
  autopilot?: {
    repairInvalidVideos: (request: {
      paths: string[]
      rootDir: string
      mode: 'delete' | 'replace'
      confirmed: boolean
    }) => Promise<{
      success: boolean
      repaired: string[]
      failed: Array<{ path: string; error: string }>
      error?: string
    }>
    getStatus: () => Promise<AutopilotProgress>
    getRecentLogs: (limit?: number) => Promise<AutopilotLogEntry[]>
    getLogVerbosity: () => Promise<AutopilotLogVerbosity>
    setLogVerbosity: (verbosity: AutopilotLogVerbosity) => Promise<{ ok: boolean; verbosity: AutopilotLogVerbosity }>
    start: (config: AutopilotConfig) => Promise<{ ok: boolean; error?: string }>
    cancel: () => Promise<{ ok: boolean }>
    onStatus: (handler: (progress: AutopilotProgress) => void) => () => void
    onLog: (handler: (log: AutopilotLogEntry) => void) => () => void
    scanVideoFolders?: (rootVideo: string) => Promise<any>
    getVideoPoolStats?: () => Promise<any>
    clearVideoPool?: () => Promise<any>
  }
  security?: {
    reportAntiDebug: (details: { method: string; detected: boolean }) => Promise<{ ok: boolean }>
  }
  songNhac: {
    start: (request: SongNhacExportRequest) => Promise<SongNhacExportResult>
    cancel: (requestId: string) => Promise<{ success: boolean; error?: string }>
    framesBegin: (request: SongNhacFramesRequest) => Promise<SongNhacFramesResult>
    framesChunk: (requestId: string, chunk: ArrayBuffer | Uint8Array) => void
    framesFlush: (requestId: string) => Promise<{ success: boolean; receivedBytes?: number }>
    framesEnd: (requestId: string) => Promise<SongNhacFramesResult>
    framesCancel: (requestId: string) => Promise<{ success: boolean }>
    onProgress: (handler: (progress: SongNhacExportProgress) => void) => () => void
  }
  app: {
    getVersion: () => Promise<string>
    checkUpdate?: () => Promise<{ updateAvailable: boolean; version?: string }>
    getGpuFfmpegProfile?: () => Promise<{ ok: boolean; profile: GpuFfmpegProfile; error?: string }>
    setGpuFfmpegProfile?: (
      profile: GpuFfmpegProfile,
    ) => Promise<{ ok: boolean; profile: GpuFfmpegProfile; error?: string }>
    getLegacyGpuFfmpegPath?: () => Promise<{ ok: boolean; path: string | null; error?: string }>
    setLegacyGpuFfmpegPath?: (
      binaryPath: string | null,
    ) => Promise<{ ok: boolean; path: string | null; error?: string }>
  }
  policy: {
    get: () => Promise<VersionPolicy>
  }
  updater: {
    check: () => Promise<{ ok: boolean; error?: string }>
    install: () => Promise<{ ok: boolean; error?: string; blocked?: boolean }>
    download: () => Promise<{ ok: boolean; error?: string }>
    getChannel: () => Promise<{ ok: boolean; channel: 'stable' | 'beta'; error?: string }>
    setChannel: (channel: 'stable' | 'beta') => Promise<{ ok: boolean; error?: string }>
    onStatus: (callback: (status: UpdaterStatusPayload) => void) => () => void
  }
  /** FIX 1.1: Sync export activity state to main process for updater guard */
  setExportActive?: (isActive: boolean) => Promise<{ ok: boolean }>
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
    downloadSpotify: (request: SpotifyYouTubeDownloadRequest) => Promise<{
      success: boolean
      result?: SpotifyYouTubeDownloadResult
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
        cookiesFile?: string
        cookiesFromBrowser?: 'auto' | 'chrome' | 'firefox' | 'edge' | 'opera' | 'safari' | 'brave' | 'chromium' | 'vivaldi'
        minDurationSeconds?: number
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
    updateYtDlp?: () => Promise<any>
    // Cookie management
    cookieImport?: (filePath?: string) => Promise<{ success: boolean; cookieFile?: any; error?: string }>
    cookieList?: () => Promise<{ success: boolean; cookieFiles: any[]; error?: string }>
    cookieTest?: (platform: string) => Promise<{ success: boolean; result?: any; error?: string }>
    cookieRemove?: (id: string) => Promise<{ success: boolean; error?: string }>
    cookieHas?: (platform: string) => Promise<{ success: boolean; hasCookies: boolean }>
    onAutoUpdated?: (handler: (info: any) => void) => () => void
    onAgeWarning?: (handler: (info: any) => void) => () => void
  }
  jobQueue: {
    list: () => Promise<JobInfo[]>
    get: (jobId: string) => Promise<JobInfo | null>
    cancel: (jobId: string) => Promise<{ success: boolean }>
    onUpdate: (handler: (job: JobInfo) => void) => () => void
  }
  readFileAsBase64?: (filePath: string) => Promise<{ ok: boolean; base64?: string; mime?: string; error?: string }>
  // General IPC helpers (preload exposes api.on() only)
  on?: (channel: string, callback: (...args: any[]) => void) => () => void
  // Validate playlists for crossfade (top-level convenience)
  validatePlaylistsForCrossfade?: (playlistIds: string[]) => Promise<ValidatePlaylistsForCrossfadeResult>
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
  cookiesFromBrowser?: 'auto' | 'chrome' | 'firefox' | 'edge' | 'opera' | 'safari' | 'brave' | 'chromium' | 'vivaldi'
}

export interface SpotifyYouTubeDownloadRequest {
  tracks: SpotifyMetadataTrack[]
  outputDir: string
  audioFormat?: 'mp3' | 'wav'
  createZip?: boolean
  cookiesFile?: string
  cookiesFromBrowser?: 'auto' | 'chrome' | 'firefox' | 'edge' | 'opera' | 'safari' | 'brave' | 'chromium' | 'vivaldi'
}

export interface SpotifyYouTubeDownloadResult {
  downloaded: string[]
  failed: Array<{ track: SpotifyMetadataTrack; error: string }>
  zipPath?: string
  cancelled?: boolean
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

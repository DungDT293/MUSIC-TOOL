export const VIDEO_FINAL_EXPORT_REQUEST = 'video:final-export:request'
export const VIDEO_FINAL_EXPORT_PROGRESS = 'video:final-export:progress'
export const VIDEO_FINAL_EXPORT_DONE = 'video:final-export:done'
export const VIDEO_FINAL_EXPORT_ERROR = 'video:final-export:error'
export const VIDEO_FINAL_EXPORT_SCAN_AUDIO = 'video:final-export:scan-audio'
export const VIDEO_FINAL_EXPORT_SCAN_VIDEO = 'video:final-export:scan-video'
export const VIDEO_FINAL_EXPORT_SCAN_IMAGE = 'video:final-export:scan-image'
export const VIDEO_FINAL_EXPORT_CANCEL = 'video:final-export:cancel'

// ========================================
// ✅ V2.2: EXPORT QUALITY PRESETS
// ========================================

/**
 * ✅ UNIFIED export quality presets (matches backend types)
 */
export type ExportQualityPreset = 'ultra-fast' | 'fast' | 'balanced' | 'high-quality'

/**
 * Preset metadata for UI display
 */
export interface ExportPresetInfo {
  id: ExportQualityPreset
  name: string
  emoji: string
  description: string
  estimatedSpeed: string // "5 min for 1 hour"
  estimatedFileSize: string // "5-8 GB/hour"
  quality: string // "Good for YouTube/social media"
  bitrate: string // "5-8 Mbps"
  useCase: string // "Quick exports, social media"
  speedMultiplier: number // For ETA calculation (12 = 12x realtime)
}

export const EXPORT_PRESETS: Record<ExportQualityPreset, ExportPresetInfo> = {
  'ultra-fast': {
    id: 'ultra-fast',
    name: 'Ultra Fast',
    emoji: '⚡',
    description: 'Fastest export - good quality',
    estimatedSpeed: '3-5 min for 1 hour',
    estimatedFileSize: '5-8 GB/hour',
    quality: 'Good for YouTube/Instagram/TikTok',
    bitrate: '5-8 Mbps',
    useCase: 'Quick exports, drafts, social media',
    speedMultiplier: 12, // 12x realtime
  },
  fast: {
    id: 'fast',
    name: 'Fast',
    emoji: '🚀',
    description: 'Fast export - balanced quality',
    estimatedSpeed: '6-10 min for 1 hour',
    estimatedFileSize: '8-12 GB/hour',
    quality: 'High quality for most uses',
    bitrate: '8-12 Mbps',
    useCase: 'General purpose, YouTube, web',
    speedMultiplier: 8, // 8x realtime
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced',
    emoji: '⚖️',
    description: 'Good speed & quality',
    estimatedSpeed: '10-15 min for 1 hour',
    estimatedFileSize: '10-15 GB/hour',
    quality: 'Very high quality',
    bitrate: '10-15 Mbps',
    useCase: 'Client deliverables, archiving',
    speedMultiplier: 5, // 5x realtime
  },
  'high-quality': {
    id: 'high-quality',
    name: 'High Quality',
    emoji: '🎨',
    description: 'Best quality (slower)',
    estimatedSpeed: '15-25 min for 1 hour',
    estimatedFileSize: '15-25 GB/hour',
    quality: 'Professional quality',
    bitrate: '15-25 Mbps',
    useCase: 'Final exports, professional work',
    speedMultiplier: 3, // 3x realtime
  },
}

export interface FinalExportSource {
  type: 'file' | 'folder' | 'files'
  path: string
  paths?: string[]
  /** Khi true (mặc định cho Tab 6 manual), yêu cầu audio.length === video.length (ghép 1-1).
   *  Khi false (autopilot pool mode), cho phép video pool lớn hơn audio — random/LRU pick. */
  strictPairing?: boolean
}

// ✅ PHASE 2: Layer overlay system
export interface OverlayLayer {
  id: string
  type: 'image' | 'text'
  visible: boolean
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  imagePath?: string
  text?: string
  fontSize?: number
  fontFamily?: string
  fontColor?: string
  fontWeight?: string
  textAlign?: 'left' | 'center' | 'right'
  startTime?: number
  endTime?: number
}

// ✅ Chroma Key Overlay: Tách phông xanh/đen và đè lên video hoàn chỉnh
export interface ChromaKeyOverlay {
  enabled: boolean
  /** Path đến video có phông xanh/đen cần tách nền */
  videoPath: string
  /** Loại nền: 'green' dùng chromakey (YUV), 'black' dùng colorkey (RGB) */
  bgType: 'green' | 'black'
  /** Hex color cần tách (e.g. '#00FF00' cho xanh, '#000000' cho đen) */
  keyColor: string
  /** Tolerance/similarity: 0.01–1.0 (cao = tách nhiều pixel hơn). Default: 0.15 */
  similarity: number
  /** Smoothing/blend: 0.0–1.0 (cao = viền mềm hơn). Default: 0.05 */
  blend: number
  /** Vị trí overlay: 'center' = chính giữa, 'bottom' = dưới cùng. Default: 'center' */
  position: 'center' | 'bottom'
  /** Scale factor: 0.1–2.0 (1.0 = kích thước gốc). Default: 1.0 */
  scale: number
}

export type FinalExportVisualizerPreset = 'bars-spectrum' | 'line-waveform' | 'mirror-waveform' | 'neon-waveform'

export interface FinalExportVisualizerOptions {
  enabled: boolean
  preset: FinalExportVisualizerPreset
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

export interface FinalExportEndingAudio {
  paths: string[]
}

export interface FinalExportRequestPayload {
  requestId: string
  audioSource: FinalExportSource
  /** Nguồn video (tùy chọn khi dùng slideshow ảnh-only). */
  videoSource?: FinalExportSource
  /** Nguồn ảnh cho slideshow (tùy chọn) – khi có, engine sẽ render ảnh thành clip video tạm trước khi ghép nhạc */
  imageSource?: FinalExportSource
  /** Nguồn video ưu tiên (tùy chọn) – các clip trong nguồn này sẽ được ưu tiên xuất hiện đầu video trước khi loop các clip khác */
  priorityVideoSource?: FinalExportSource
  /** Nhạc nối thêm cuối mỗi output, không làm tăng số job audio chính. */
  endingAudio?: FinalExportEndingAudio
  outputFolder: string
  outputFilename: string
  shuffle?: boolean // Shuffle video clips when building playlist
  outputNames?: string[] // Tên file theo thứ tự job (không kèm phần mở rộng)
  tracklists?: string[] // Tracklist per video (có thể 1 block áp dụng cho tất cả)
  tracklistAuto?: boolean // Tự sinh tracklist từ history audio (Tab 4) nếu có
  forceReencode?: boolean // Bật chế độ re-encode để tránh lỗi khung hình, chậm hơn
  normalizeAudio?: boolean // Chuẩn hoá âm lượng (re-encode audio với loudnorm)
  /** Chuẩn hóa tỉ lệ khung hình + FPS khi ghép video (letterbox/pillarbox) */
  unifyFormat?: boolean
  /** Tỉ lệ khung hình / độ phân giải mục tiêu khi unifyFormat = true, ví dụ '1920x1080' */
  targetResolution?: string
  /** FPS mục tiêu khi unifyFormat = true, ví dụ '30', '30000/1001' */
  targetFps?: string
  // ✅ V2.2: Quality preset system
  qualityPreset?: ExportQualityPreset // Default: 'fast' for backward compatibility
  
  // ✅ DEPRECATED (use qualityPreset instead)
  useGpuEncoding?: 'gpu' | 'cpu' | 'auto' // GPU encoding choice: 'gpu' = prefer GPU, 'cpu' = force CPU, 'auto' = auto-detect (default: 'auto')

  // ✅ Chroma Key Overlay: video phông xanh/đen đè lên video hoàn chỉnh
  chromaKeyOverlay?: ChromaKeyOverlay

  /** Sóng nhạc/phổ nhạc vẽ lên video khi xuất (Tab 6) */
  audioVisualizer?: FinalExportVisualizerOptions

  deleteSourceFiles?: boolean // Xóa file audio và video sau khi xuất xong (tùy chọn)
  /** Autopilot unique mode: fail before FFmpeg if source duration cannot cover all jobs without reuse. */
  uniqueRequired?: boolean

  // ✅ Slideshow (pure images + music) parameters
  perImageDurationSec?: number
  imageAspectMode?: 'letterbox' | 'crop-fill' | 'blur-background'
  imageTransition?: string
  imageKenBurns?: boolean
}

export interface FinalExportProgressPayload {
  requestId: string
  percent: number
  timeSec?: number
  totalDurationSec?: number
  speedX?: number
  etaSec?: number
  status?: string
  stage?: 'scan-audio' | 'scan-video' | 'prepare-audio' | 'prepare-video' | 'export' | 'encode' | 'finishing'
  audioFileCount?: number
  videoFileCount?: number
  usedVideoCount?: number
  concatVideoDurationSec?: number
  currentIndex?: number
  totalOutputs?: number
  currentAudioPath?: string
  currentOutputFilename?: string
}

export interface FinalExportAudioFailure {
  path: string
  stage: 'validate-path' | 'probe' | 'duration'
  detail: string
  repairHint: string
  durationSec?: number
  codecName?: string | null
}

export interface FinalExportDonePayload {
  requestId: string
  outputs: {
    audioFile: string
    videoFile: string
    outputFile?: string
    durationSec: number
    tracklistFile?: string
  }[]
  /** Audio files rejected before jobs were created. */
  audioFailures?: FinalExportAudioFailure[]
  requestedAudioCount?: number
  acceptedAudioCount?: number
  /** Jobs that failed during export (remaining jobs still completed) */
  failedJobs?: {
    jobIndex: number
    fileName: string
    error: string
    audioFile?: string
    outputPath?: string
    stage?: string
    repairHint?: string
    sourceVideoPaths?: string[]
  }[]
  warnings?: string[]
  /** Full source playlist occurrences for each successful output, including repeats. */
  videoSequences?: { jobIndex: number; videoPaths: string[]; clipIds?: string[] }[]
}

export interface FinalExportErrorPayload {
  requestId: string
  error: string
  message?: string
  currentIndex?: number
  currentAudioPath?: string
}

export interface FinalExportScanItem {
  path: string
  durationSec: number
  codecName?: string | null
}

export interface FinalExportScanResult {
  requestId: string
  kind: 'audio' | 'video' | 'image'
  fileCount: number
  totalDurationSec: number
  items: FinalExportScanItem[]
}

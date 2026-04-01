export const VIDEO_FINAL_EXPORT_REQUEST = 'video:final-export:request'
export const VIDEO_FINAL_EXPORT_PROGRESS = 'video:final-export:progress'
export const VIDEO_FINAL_EXPORT_DONE = 'video:final-export:done'
export const VIDEO_FINAL_EXPORT_ERROR = 'video:final-export:error'
export const VIDEO_FINAL_EXPORT_SCAN_AUDIO = 'video:final-export:scan-audio'
export const VIDEO_FINAL_EXPORT_SCAN_VIDEO = 'video:final-export:scan-video'

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
}

export interface SubtitleOptions {
  enabled: boolean
  text: string // Text hiển thị (có thể dùng {filename}, {title}, {artist} để thay thế)
  autoLyrics?: boolean // Tự động dùng lyrics từ metadata (ID3 tags) nếu có
  useWhisper?: boolean // Tự động tạo subtitle bằng Whisper nếu không có lyrics trong metadata
  whisperLanguage?: string // Ngôn ngữ cho Whisper: 'auto' (tự động), 'vi' (Tiếng Việt), 'en' (English), 'zh' (中文), 'ja' (日本語), 'ko' (한국어), 'th' (ไทย), 'fr' (Français), 'de' (Deutsch), 'es' (Español), 'it' (Italiano), 'pt' (Português), 'ru' (Русский), 'ar' (العربية), 'hi' (हिन्दी), v.v. (hỗ trợ ~99 ngôn ngữ)
  subtitleStyle?: 'simple' | 'karaoke' | 'word-by-word' | 'dynamic' // Style của subtitle: simple (text tĩnh), karaoke (thanh màu chạy), word-by-word (chữ nhảy TikTok), dynamic (Alex Hormozi style)
  subtitleFormat?: 'srt' | 'ass' // Format file subtitle: srt (đơn giản), ass (hỗ trợ hiệu ứng karaoke)
  position?: 'top' | 'bottom' | 'center'
  fontSize?: number
  fontColor?: string // Hex color (e.g., '#ffffff')
  subtitleFile?: string // Internal: Path to generated subtitle file (.srt/.ass) - set by backend, not user input
  highlightColor?: string // Hex color cho karaoke highlight (e.g., '#ffff00')
  backgroundColor?: string // Hex color (e.g., '#000000')
  backgroundOpacity?: number // 0-1
  fontFamily?: string // Font family (e.g., 'Arial', 'Roboto')
  x?: number // Horizontal position (0-100, percentage)
  y?: number // Vertical position (0-100, percentage)
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

export interface FinalExportRequestPayload {
  requestId: string
  audioSource: FinalExportSource
  videoSource: FinalExportSource
  /** Nguồn video ưu tiên (tùy chọn) – các clip trong nguồn này sẽ được ưu tiên xuất hiện đầu video trước khi loop các clip khác */
  priorityVideoSource?: FinalExportSource
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
  subtitle?: SubtitleOptions // Subtitle options cho video output
  
  // ✅ V2.2: Quality preset system
  qualityPreset?: ExportQualityPreset // Default: 'fast' for backward compatibility
  
  // ✅ DEPRECATED (use qualityPreset instead)
  useGpuEncoding?: 'gpu' | 'cpu' | 'auto' // GPU encoding choice: 'gpu' = prefer GPU, 'cpu' = force CPU, 'auto' = auto-detect (default: 'auto')
  
  // ✅ PHASE 2: Canvas Export Engine (Option A - Full compositor)
  // Frontend sends complete scene description for offline rendering
  // This enables 100% WYSIWYG export matching canvas preview
  canvasScene?: import('./canvasExportTypes').CanvasExportScene
  
  // ⚠️ DEPRECATED (Phase 2 Option B - not recommended)
  // layers?: OverlayLayer[]
  // canvasSize?: { width: number; height: number }
  
  deleteSourceFiles?: boolean // Xóa file audio và video sau khi xuất xong (tùy chọn)
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

export interface FinalExportDonePayload {
  requestId: string
  outputs: {
    audioFile: string
    videoFile: string
    outputFile?: string
    durationSec: number
    tracklistFile?: string
  }[]
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
  kind: 'audio' | 'video'
  fileCount: number
  totalDurationSec: number
  items: FinalExportScanItem[]
}

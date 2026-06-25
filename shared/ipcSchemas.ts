/**
 * Zod Schemas for IPC Handler Validation
 * 
 * SECURITY: Validates all IPC payloads to prevent invalid data and injection attacks
 */

import { z } from 'zod'

// ========== Music Schemas ==========

export const MusicScanFoldersSchema = z.object({
  priorityFolder: z.string().nullable().optional(),
  randomFolder: z.string().nullable().optional(),
}).transform((data) => ({
  priorityFolder: data.priorityFolder ?? null,
  randomFolder: data.randomFolder ?? null,
}))

export const BuildPlaylistsOptionsSchema = z.object({
  // DATA-01 fix: tracks is an array of track objects (id + path are required minimum fields)
  tracks: z.array(z.object({
    id: z.string().optional(),
    path: z.string().optional(),
    name: z.string().optional(),
    durationSec: z.number().optional(),
  }).passthrough()).optional(),
  pinnedTrackIds: z.array(z.string()).optional(),
  playlistCount: z.number().int().positive().optional(),
  targetDurationMinutes: z.number().positive().optional(),
  shuffle: z.boolean().optional(),
})

export const ExportPlaylistRequestSchema = z.object({
  playlistId: z.string().min(1),
  outputDir: z.string().min(1),
  fileName: z.string().min(1),
  format: z.enum(['mp3', 'wav', 'aac']),
  // FIX: Cho phép bitrate cao hơn cho AAC (384 kbps là phổ biến)
  // MP3 thường max 320, AAC có thể lên đến 512
  bitrateKbps: z.number().int().positive().max(512).optional(),
  smoothTransitions: z.boolean().optional(),
  crossfadeDurationSec: z.number().positive().max(10).optional(),
  outputPath: z.string().optional(), // For internal use
  playlistName: z.string().optional(), // For internal use
  currentIndex: z.number().int().nonnegative().optional(), // For internal use
  totalCount: z.number().int().positive().optional(), // For internal use
  requestId: z.string().optional(), // For internal use
})

export const ValidatePlaylistsForCrossfadeRequestSchema = z.object({
  playlistIds: z.array(z.string().min(1)).min(1),
  crossfadeDurationSec: z.number().positive().max(10).optional(),
})

// ========== Video Schemas ==========

export const CutSingleSimpleRequestSchema = z.object({
  inputPath: z.string().min(1),
  outputDir: z.string().min(1),
  segmentLengthSec: z.number().positive(),
  format: z.enum(['mp4', 'mkv']).optional(),
  requestId: z.string().optional(),
  normalizeOutput: z.boolean().optional(),
  normalizeQuality: z.enum(['preserve', '1080p', '720p', '1440p']).optional(),
  useGpuEncoding: z.boolean().optional(),
})

export const MergeVideosSimpleRequestSchema = z.object({
  inputFiles: z.array(z.string().min(1)).min(1),
  outputDir: z.string().min(1),
  outputFileName: z.string().min(1),
  shuffle: z.boolean().optional(),
  mute: z.boolean().optional(),
  targetDurationSec: z.number().positive().nullable().optional(),
  mergeCount: z.number().int().positive().optional(),
  repeatCount: z.number().int().nonnegative().optional(),
  requestId: z.string().optional(),
  forceReencode: z.boolean().optional(),
  priorityPaths: z.array(z.string()).optional(),
  useGpuEncoding: z.boolean().optional(),
})

export const MuteVideoAudioRequestSchema = z.object({
  inputFiles: z.array(z.string().min(1)).min(1),
  outputDir: z.string().min(1),
  requestId: z.string().optional(),
})

export const NormalizeVideoRequestSchema = z.object({
  inputFiles: z.array(z.string().min(1)).min(1),
  outputDir: z.string().min(1),
  useGpu: z.boolean().optional(),
  requestId: z.string().optional(),
})

export const SplitManySimpleRequestSchema = z.object({
  inputFiles: z.array(z.string().min(1)).min(1).optional(),
  inputPaths: z.array(z.string().min(1)).min(1).optional(),
  outputRootDir: z.string().min(1),
  outputBaseDir: z.string().min(1).optional(),
  segmentLengthSec: z.number().positive(),
  format: z.enum(['mp4', 'mkv']).optional(),
  requestId: z.string().optional(),
  normalizeOutput: z.boolean().optional(),
  normalizeQuality: z.enum(['preserve', '1080p', '720p', '1440p']).optional(),
  useGpuEncoding: z.boolean().optional(),
}).refine((data) => (data.inputFiles?.length ?? 0) > 0 || (data.inputPaths?.length ?? 0) > 0, {
  message: 'Cần ít nhất inputFiles hoặc inputPaths',
  path: ['inputFiles'],
})

// ========== Final Export Schemas ==========

export const FinalExportScanAudioSchema = z.object({
  requestId: z.string().optional(),
  audioSource: z.union([
    z.object({ type: z.literal('folder'), path: z.string().min(1) }),
    z.object({ type: z.literal('file'), path: z.string().min(1) }),
    z.object({ type: z.literal('files'), path: z.string(), paths: z.array(z.string().min(1)).min(1) }),
    z.object({ type: z.literal('playlist'), playlistId: z.string().min(1) }),
  ]),
}).transform((data) => ({
  requestId: data.requestId || '',
  audioSource: data.audioSource,
}))

export const FinalExportScanVideoSchema = z.object({
  requestId: z.string().optional(),
  videoSource: z.union([
    z.object({ type: z.literal('folder'), path: z.string().min(1) }),
    z.object({ type: z.literal('file'), path: z.string().min(1) }),
    z.object({ type: z.literal('files'), path: z.string(), paths: z.array(z.string().min(1)).min(1) }),
  ]),
}).transform((data) => ({
  requestId: data.requestId || '',
  videoSource: data.videoSource,
}))

// Note: FinalExportRequestPayload is complex, validate key fields only.
// audioSource/videoSource must accept same shapes as Scan schemas (folder, file, files, playlist for audio).
export const FinalExportRequestPayloadSchema = z.object({
  requestId: z.string().optional(),
  audioSource: z.union([
    z.object({ type: z.literal('folder'), path: z.string().min(1) }),
    z.object({ type: z.literal('file'), path: z.string().min(1) }),
    z.object({ type: z.literal('files'), path: z.string().optional(), paths: z.array(z.string().min(1)).min(1) }),
    z.object({ type: z.literal('playlist'), playlistId: z.string().min(1) }),
  ]),
  videoSource: z.union([
    z.object({ type: z.literal('folder'), path: z.string().min(1) }),
    z.object({ type: z.literal('file'), path: z.string().min(1) }),
    z.object({ type: z.literal('files'), path: z.string().optional(), paths: z.array(z.string().min(1)).min(1) }),
  ]).optional(),
  imageSource: z.union([
    z.object({ type: z.literal('folder'), path: z.string().min(1) }),
    z.object({ type: z.literal('file'), path: z.string().min(1) }),
    z.object({ type: z.literal('files'), path: z.string().optional(), paths: z.array(z.string().min(1)).min(1) }),
  ]).optional(),
  outputFolder: z.string().min(1),
  outputFilename: z.string().min(1),
  shuffle: z.boolean().optional(),
  forceReencode: z.boolean().optional(),
  normalizeAudio: z.boolean().optional(),
  tracklistAuto: z.boolean().optional(),
  // DATA-01 fix: subtitle is a structured object with text/style fields
  subtitle: z.object({
    enabled: z.boolean().optional(),
    text: z.string().optional(),
    fontFamily: z.string().optional(),
    fontSize: z.number().optional(),
    color: z.string().optional(),
    position: z.enum(['top', 'bottom', 'center']).optional(),
  }).passthrough().optional(),
  useGpuEncoding: z.enum(['gpu', 'cpu', 'auto']).optional(),
  qualityPreset: z.enum(['ultra-fast', 'fast', 'balanced', 'high-quality']).optional(),
  audioVisualizer: z.object({
    enabled: z.boolean(),
    preset: z.enum(['bars-spectrum', 'line-waveform', 'mirror-waveform', 'neon-waveform']),
    position: z.enum(['top', 'center', 'bottom']).optional(),
    widthPercent: z.number().optional(),
    heightPercent: z.number().optional(),
    marginBottomPx: z.number().optional(),
    primaryColor: z.string().optional(),
    secondaryColor: z.string().optional(),
    opacity: z.number().optional(),
    barCount: z.number().optional(),
    sensitivity: z.number().optional(),
  }).optional(),
  deleteSourceFiles: z.boolean().optional(),
}).passthrough()

// ========== Autopilot Schemas ==========

// AutopilotConfig is complex, validate key fields only
// Khi đóng gói, config từ UI/localStorage có thể thiếu autoCreateDailySubfolder hoặc path rỗng → dùng optional/default để tránh "invalid"
export const AutopilotConfigSchema = z.object({
  // FIX: dayPlans khớp với DayPlanConfig thực tế (id, dateCode, playlistCount, minutesPerPlaylist, presetId, overrides)
  dayPlans: z.array(z.object({
    id: z.string().min(1),
    dateCode: z.string().min(1),
    playlistCount: z.coerce.number().int().positive(),
    minutesPerPlaylist: z.coerce.number().positive(),
    presetId: z.string().min(1),
    overrides: z.object({}).passthrough().optional(),
  }).passthrough()).min(0), // Required but can be empty array
  folders: z.object({
    rootAudio: z.string().min(1, 'Thư mục Audio gốc chưa chọn'),
    rootVideo: z.string().min(1, 'Thư mục Video gốc chưa chọn'),
    rootFinal: z.string().min(1, 'Thư mục Output chưa chọn'),
    autoCreateDailySubfolder: z.boolean().optional().default(true), // Legacy config có thể thiếu
    priorityMusicFolder: z.string().optional(),
    randomMusicFolder: z.string().optional(),
    priorityVideoFolder: z.string().optional(),
    minVideoClipsTarget: z.coerce.number().int().min(100).max(100000).optional(), // 100–100000, coerce string từ input
  }),
  // Additional fields that may be present but not in base interface
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().positive().max(1440).optional(),
  outputDir: z.string().min(1).optional(),
  playlistCount: z.number().int().positive().optional(),
  targetDurationMinutes: z.number().positive().optional(),
})

// ========== Auth Schemas ==========

export const AuthRegisterSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
})

export const AuthCheckSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
  machineId: z.string().min(1),
  version: z.string().optional(),
})

// ========== Server Endpoint Schemas ==========

export const ServerRegisterSchema = z.object({
  tai_khoan: z.string().min(1).max(100),
  mat_khau: z.string().min(1).max(200),
  ma_may: z.string().min(1),
  version: z.string().optional(),
})

export const ServerCheckSchema = z.object({
  tai_khoan: z.string().min(1).max(100),
  mat_khau: z.string().min(1).max(200),
  ma_may: z.string().min(1),
  version: z.string().optional(),
})

export const ServerVideoExportSchema = z.object({
  username: z.string().min(1),
  machine_id: z.string().min(1),
  status: z.enum(['success', 'failed']),
  error_message: z.string().optional(),
  video_duration: z.number().nonnegative().optional(),
  file_size: z.number().nonnegative().optional(),
  export_format: z.string().optional(),
})

export const ServerAdminUpdateSchema = z.object({
  id: z.string().min(1),
  hanh_dong: z.enum(['CHO_PHEP', 'CHAN']),
})

// ========== V2 Auth Schemas ==========

export const ServerCheckStatusSchema = z.object({
  tai_khoan: z.string().min(1).max(100),
  ma_may: z.string().min(1),
})

export const ServerValidateKeySchema = z.object({
  tai_khoan: z.string().min(1).max(100),
  key_kich_hoat: z.string().min(1),
  ma_may: z.string().min(1),
})

export const ServerValidateTokenSchema = z.object({
  device_token: z.string().min(1),
  machine_id: z.string().min(1),
})

export const ServerRefreshTokenSchema = z.object({
  refresh_token: z.string().min(1),
  machine_id: z.string().min(1),
})

export const ServerLoginSchema = z.object({
  tai_khoan: z.string().min(1).max(100),
  mat_khau: z.string().min(1).max(200),
  ma_may: z.string().min(1),
})

// ========== V2 Admin Schemas ==========

export const ServerUnlockKeySchema = z.object({
  tai_khoan: z.string().min(1).max(100),
})

export const ServerRevokeKeySchema = z.object({
  tai_khoan: z.string().min(1).max(100),
})

export const ServerAllowRebindSchema = z.object({
  tai_khoan: z.string().min(1).max(100),
  new_machine_id: z.string().min(1),
})

// ========== Version Policy Schemas ==========

export const VersionPolicySchema = z.object({
  latest_version: z.string().min(1),
  min_supported_version: z.string().min(1),
  blocked_versions: z.array(z.string()),
  recommended_version: z.string().min(1),
  recommended_installer_url: z.string().url().optional().or(z.literal('')),
  force_update: z.boolean(),
  message: z.string().optional().or(z.literal('')),
})

export const ServerUpdateVersionPolicySchema = z.object({
  policy: VersionPolicySchema,
})

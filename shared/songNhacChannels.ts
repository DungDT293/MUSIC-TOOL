export const SONG_NHAC_EXPORT_START = 'song-nhac:export:start'
export const SONG_NHAC_EXPORT_CANCEL = 'song-nhac:export:cancel'
export const SONG_NHAC_EXPORT_PROGRESS = 'song-nhac:export:progress'

/** Frame-accurate export: the renderer encodes frames and streams them to the main process. */
export const SONG_NHAC_FRAMES_BEGIN = 'song-nhac:frames:begin'
export const SONG_NHAC_FRAMES_CHUNK = 'song-nhac:frames:chunk'
export const SONG_NHAC_FRAMES_FLUSH = 'song-nhac:frames:flush'
export const SONG_NHAC_FRAMES_END = 'song-nhac:frames:end'
export const SONG_NHAC_FRAMES_CANCEL = 'song-nhac:frames:cancel'

export interface SongNhacFramesRequest {
  requestId: string
  audioPath: string
  outputPath: string
  width: number
  height: number
  fps: number
  totalFrames: number
  /** Optional trim of the source audio, in seconds. Absent = whole file. */
  startSec?: number
  durationSec?: number
}

export interface SongNhacFramesResult {
  success: boolean
  requestId: string
  outputPath?: string
  error?: string
}

export type SongNhacStyle = 'avee-circle' | 'neon-tunnel' | 'orbit-spectrum' | 'pulse-grid'

export interface SongNhacExportRequest {
  requestId: string
  audioPath: string
  outputPath: string
  style: SongNhacStyle
  width: number
  height: number
  fps: number
}

export interface SongNhacExportProgress {
  requestId: string
  percent: number
  timeSec: number
  totalSec: number
}

export interface SongNhacExportResult {
  success: boolean
  requestId: string
  outputPath?: string
  error?: string
}

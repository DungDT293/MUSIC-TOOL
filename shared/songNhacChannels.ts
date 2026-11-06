export const SONG_NHAC_EXPORT_START = 'song-nhac:export:start'
export const SONG_NHAC_EXPORT_CANCEL = 'song-nhac:export:cancel'
export const SONG_NHAC_EXPORT_PROGRESS = 'song-nhac:export:progress'

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

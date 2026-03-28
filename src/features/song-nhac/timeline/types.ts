/**
 * Chức năng 13 — Bước 4. Timeline types.
 * Timeline chỉ vẽ từ data precompute; không FFT realtime, không RAF.
 */

export interface TimelineData {
  duration: number
  /** Normalized peak per window, 0..1 */
  peaks: Float32Array
  /** Beat times in seconds */
  beats: number[]
}

export interface TimelineWorkerInput {
  channelData: Float32Array
  sampleRate: number
  duration: number
  /** Peaks per minute (default ~1000); tổng peaks = resolution * (duration/60) */
  resolution?: number
}

export interface TimelineViewState {
  zoom: number
  scrollPx: number
  /** Playhead time (sec); update chậm 30–60ms, không theo frame */
  playheadTimeSec: number
}

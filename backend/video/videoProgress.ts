/**
 * Shared Progress Engine for Video Jobs
 * Unified types and helpers for single-cut, multi-cut, and merge operations
 */

export type VideoJobMode = 'single-cut' | 'multi-cut' | 'merge'

export interface BaseVideoProgress {
  mode: VideoJobMode
  requestId?: string
  percent?: number // 0-100 của job hiện tại
  timeSec?: number
  totalDurationSec?: number
  speedX?: number | null
  etaSec?: number | null
}

export interface SingleCutProgress extends BaseVideoProgress {
  mode: 'single-cut'
  currentSegment?: number
  totalSegments?: number
}

export interface MultiCutProgress extends BaseVideoProgress {
  mode: 'multi-cut'
  // per-file:
  currentFileIndex?: number
  totalFiles?: number
  currentFilePercent?: number
  currentFileSegment?: number
  currentFileTotalSegments?: number
  currentFileSpeedX?: number | null
  currentFileEtaSec?: number | null
  // overall:
  overallPercent?: number
  currentFilePath?: string
  error?: string
  completed?: boolean
  message?: string // Optional message for status updates (e.g., "Đã bỏ qua X video lỗi")
}

export interface MergeProgress extends BaseVideoProgress {
  mode: 'merge'
  stage?: 'probe' | 'build-list' | 'concat' | 'cut' | 'merge' | 'finalizing' // D3: Thêm 'merge' stage
  batchIndex?: number
  totalBatches?: number
  // Multi-job support (mergeCount > 1)
  currentJob?: number // Current job index (1-based)
  totalJobs?: number // Total number of jobs
  currentFile?: string // Current output filename
  message?: string // Optional message for status updates (e.g., "Đã bỏ qua X video lỗi")
  completed?: boolean
  error?: string
}

export type VideoProgressPayload =
  | SingleCutProgress
  | MultiCutProgress
  | MergeProgress

/**
 * Safe number conversion with fallback
 */
export function safeNumber(v: any, fallback = 0): number {
  return typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v) ? v : fallback
}

/**
 * Build SingleCutProgress with safe defaults
 */
export function buildSingleCutProgress(partial: Partial<SingleCutProgress>): SingleCutProgress {
  return {
    mode: 'single-cut',
    requestId: partial.requestId,
    percent: safeNumber(partial.percent, 0),
    timeSec: safeNumber(partial.timeSec, 0),
    totalDurationSec: safeNumber(partial.totalDurationSec, 0),
    speedX: partial.speedX ?? null,
    etaSec: partial.etaSec ?? null,
    currentSegment: safeNumber(partial.currentSegment, 0),
    totalSegments: safeNumber(partial.totalSegments, 0),
  }
}

/**
 * Build MultiCutProgress with safe defaults
 */
export function buildMultiCutProgress(partial: Partial<MultiCutProgress>): MultiCutProgress {
  return {
    mode: 'multi-cut',
    requestId: partial.requestId,
    percent: safeNumber(partial.percent, 0),
    timeSec: safeNumber(partial.timeSec, 0),
    totalDurationSec: safeNumber(partial.totalDurationSec, 0),
    speedX: partial.speedX ?? null,
    etaSec: partial.etaSec ?? null,
    currentFileIndex: safeNumber(partial.currentFileIndex, 0),
    totalFiles: safeNumber(partial.totalFiles, 0),
    currentFilePercent: safeNumber(partial.currentFilePercent, 0),
    currentFileSegment: safeNumber(partial.currentFileSegment, 0),
    currentFileTotalSegments: safeNumber(partial.currentFileTotalSegments, 0),
    currentFileSpeedX: partial.currentFileSpeedX ?? null,
    currentFileEtaSec: partial.currentFileEtaSec ?? null,
    overallPercent: safeNumber(partial.overallPercent, 0),
    currentFilePath: partial.currentFilePath,
    error: partial.error,
    completed: partial.completed,
    message: partial.message,
  }
}

/**
 * Build MergeProgress with safe defaults
 */
export function buildMergeProgress(partial: Partial<MergeProgress>): MergeProgress {
  return {
    mode: 'merge',
    requestId: partial.requestId,
    percent: safeNumber(partial.percent, 0),
    timeSec: safeNumber(partial.timeSec, 0),
    totalDurationSec: safeNumber(partial.totalDurationSec, 0),
    speedX: partial.speedX ?? null,
    etaSec: partial.etaSec ?? null,
    stage: partial.stage,
    batchIndex: safeNumber(partial.batchIndex, 0),
    totalBatches: safeNumber(partial.totalBatches, 0),
    currentJob: partial.currentJob,
    totalJobs: partial.totalJobs,
    currentFile: partial.currentFile,
    completed: partial.completed ?? false,
    error: partial.error,
    message: partial.message,
  }
}


import type { SongNhacStyle } from '../../shared/songNhacChannels'

export interface SongNhacVisualFilterOptions {
  style: SongNhacStyle
  width: number
  height: number
}

const DEFAULT_WAVE_RATIO = 0.28
const MIN_WAVE_HEIGHT = 180
const AVEE_WAVE_RATIO = 0.32
const MIN_AVEE_WAVE_HEIGHT = 220

function clampDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.max(16, Math.round(value))
}

function waveHeight(height: number, ratio: number, floor: number): number {
  return Math.max(floor, Math.round(height * ratio))
}

/**
 * Build the FFmpeg lavfi visualiser chain for a Song Nhạc style.
 *
 * Pure and dependency-free so the mapping can be unit tested and reused by any
 * export path; keep it in sync with the canvas/Three.js preview styles.
 */
export function buildSongNhacVisualFilter({ style, width, height }: SongNhacVisualFilterOptions): string {
  const safeWidth = clampDimension(width, 1280)
  const safeHeight = clampDimension(height, 720)

  switch (style) {
    case 'orbit-spectrum':
      return `showfreqs=s=${safeWidth}x${waveHeight(safeHeight, DEFAULT_WAVE_RATIO, MIN_WAVE_HEIGHT)}:mode=bar:colors=0xd946ef|0x22d3ee`
    case 'pulse-grid':
      return `showwaves=s=${safeWidth}x${waveHeight(safeHeight, DEFAULT_WAVE_RATIO, MIN_WAVE_HEIGHT)}:mode=cline:colors=0xd946ef`
    case 'avee-circle':
      return `showwaves=s=${safeWidth}x${waveHeight(safeHeight, AVEE_WAVE_RATIO, MIN_AVEE_WAVE_HEIGHT)}:mode=cline:colors=0x00f2fe|0xfe0979`
    default:
      return `showwaves=s=${safeWidth}x${waveHeight(safeHeight, DEFAULT_WAVE_RATIO, MIN_WAVE_HEIGHT)}:mode=line:colors=0x22d3ee`
  }
}

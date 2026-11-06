export type SongNhacStyle = 'avee-circle' | 'neon-tunnel' | 'orbit-spectrum' | 'pulse-grid'
export type SongNhacQuality = 'low' | 'balanced' | 'full'

export interface SongNhacRenderConfig {
  style: SongNhacStyle
  quality: SongNhacQuality
  intensity: number
  seed: number
}

export interface SongNhacAudioFrame {
  timeSec: number
  frequencyData: Uint8Array
  waveformData: Uint8Array
  bass: number
  mid: number
  treble: number
  rms: number
  beat: number
}

export const SONG_NHAC_STYLES: Array<{ id: SongNhacStyle; label: string; hint: string }> = [
  { id: 'avee-circle', label: 'Avee Player (Sóng tròn + Logo beat)', hint: 'Sóng tròn, logo đập nhịp và hạt bay phong cách Avee Player' },
  { id: 'neon-tunnel', label: 'Neon Tunnel', hint: 'Ống neon pseudo-3D' },
  { id: 'orbit-spectrum', label: 'Orbit Spectrum', hint: 'Quỹ đạo phổ âm thanh' },
  { id: 'pulse-grid', label: 'Pulse Grid', hint: 'Lưới nhịp phát sáng' },
]

export function clampRenderConfig(config: Partial<SongNhacRenderConfig>): SongNhacRenderConfig {
  const style = config.style === 'neon-tunnel' || config.style === 'orbit-spectrum' || config.style === 'pulse-grid'
    ? config.style
    : 'avee-circle'
  const quality = config.quality === 'low' || config.quality === 'full'
    ? config.quality
    : 'balanced'
  const intensity = Number.isFinite(config.intensity)
    ? Math.max(0, Math.min(2, config.intensity!))
    : 1
  const seed = Number.isFinite(config.seed) ? Math.trunc(config.seed!) : 93

  return { style, quality, intensity, seed }
}

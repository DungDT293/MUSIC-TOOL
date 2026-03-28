/**
 * Built-in Visualizer Presets — Các preset sóng nhạc có sẵn.
 * User có thể chọn ngay thay vì tự tạo từ đầu.
 */

import type { SongNhacLayer } from '../types/layerTypes'

export interface BuiltInPreset {
  id: string
  name: string
  description: string
  category: 'neon' | 'minimal' | 'retro' | 'artistic' | 'classic'
  layers: SongNhacLayer[]
}

let idCounter = 0
function uid(prefix: string): string {
  return `preset_${prefix}_${++idCounter}`
}

export const BUILT_IN_PRESETS: BuiltInPreset[] = [
  {
    id: 'preset_neon_circle',
    name: 'Neon Circle',
    description: 'Tia tròn neon phát sáng',
    category: 'neon',
    layers: [
      {
        id: uid('viz'), type: 'visualizer', name: 'Neon Circle',
        visible: true, waveStyle: 'circlebars',
        colorMode: 'gradient', color1: '#00ffcc', color2: '#ff00ff',
        barCount: 128, speed: 1.2, opacity: 1, glowEnabled: true, glowIntensity: 0.8,
        sensitivity: 1.2, mirror: false,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      } as any,
    ],
  },
  {
    id: 'preset_fire_bars',
    name: 'Fire Bars',
    description: 'Thanh lửa năng động',
    category: 'neon',
    layers: [
      {
        id: uid('viz'), type: 'visualizer', name: 'Fire Bars',
        visible: true, waveStyle: 'fire',
        colorMode: 'gradient', color1: '#ff4400', color2: '#ffcc00',
        barCount: 64, speed: 1.5, opacity: 1, glowEnabled: true, glowIntensity: 0.7,
        sensitivity: 1.3, mirror: false,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      } as any,
    ],
  },
  {
    id: 'preset_minimal_line',
    name: 'Minimal Line',
    description: 'Đường viền sóng tối giản',
    category: 'minimal',
    layers: [
      {
        id: uid('viz'), type: 'visualizer', name: 'Minimal Line',
        visible: true, waveStyle: 'line',
        colorMode: 'solid', color1: '#ffffff',
        barCount: 64, speed: 0.8, opacity: 0.8, glowEnabled: false,
        sensitivity: 1.0, mirror: false,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      } as any,
    ],
  },
  {
    id: 'preset_retro_bars',
    name: 'Retro Spectrum',
    description: 'Phổ tần kinh điển retro',
    category: 'retro',
    layers: [
      {
        id: uid('viz'), type: 'visualizer', name: 'Retro Bars',
        visible: true, waveStyle: 'bars',
        colorMode: 'gradient', color1: '#00ff00', color2: '#ff0000',
        barCount: 64, speed: 0.5, opacity: 1, glowEnabled: true, glowIntensity: 0.4,
        sensitivity: 1.0, mirror: true,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      } as any,
    ],
  },
  {
    id: 'preset_galaxy_spin',
    name: 'Galaxy Spin',
    description: 'Thiên hà xoay theo nhạc',
    category: 'artistic',
    layers: [
      {
        id: uid('viz'), type: 'visualizer', name: 'Galaxy',
        visible: true, waveStyle: 'galaxy',
        colorMode: 'rainbow',
        barCount: 96, speed: 1.0, opacity: 1, glowEnabled: true, glowIntensity: 0.6,
        sensitivity: 1.1, mirror: false,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      } as any,
    ],
  },
  {
    id: 'preset_plasma_ring',
    name: 'Plasma Ring',
    description: 'Vòng plasma năng lượng',
    category: 'artistic',
    layers: [
      {
        id: uid('viz'), type: 'visualizer', name: 'Plasma Ring',
        visible: true, waveStyle: 'plasma',
        colorMode: 'gradient', color1: '#6600ff', color2: '#00ccff',
        barCount: 128, speed: 1.3, opacity: 1, glowEnabled: true, glowIntensity: 0.9,
        sensitivity: 1.2, mirror: false,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      } as any,
    ],
  },
  {
    id: 'preset_cyan_wave',
    name: 'Cyan Waveform',
    description: 'Sóng âm thanh cyan hiện đại',
    category: 'minimal',
    layers: [
      {
        id: uid('viz'), type: 'visualizer', name: 'Cyan Wave',
        visible: true, waveStyle: 'waveform',
        colorMode: 'solid', color1: '#00e5ff',
        barCount: 128, speed: 1.0, opacity: 0.9, glowEnabled: true, glowIntensity: 0.5,
        sensitivity: 1.0, mirror: false,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      } as any,
    ],
  },
  {
    id: 'preset_electric_dots',
    name: 'Electric Dots',
    description: 'Chấm điện tử phản ứng nhạc',
    category: 'neon',
    layers: [
      {
        id: uid('viz'), type: 'visualizer', name: 'Electric Dots',
        visible: true, waveStyle: 'dots',
        colorMode: 'gradient', color1: '#ffff00', color2: '#ff0088',
        barCount: 96, speed: 1.1, opacity: 1, glowEnabled: true, glowIntensity: 0.7,
        sensitivity: 1.5, mirror: false,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      } as any,
    ],
  },
  {
    id: 'preset_lightning_storm',
    name: 'Lightning Storm',
    description: 'Sét dữ dội theo beat',
    category: 'artistic',
    layers: [
      {
        id: uid('viz'), type: 'visualizer', name: 'Lightning',
        visible: true, waveStyle: 'lightning',
        colorMode: 'gradient', color1: '#ffffff', color2: '#00aaff',
        barCount: 48, speed: 2.0, opacity: 1, glowEnabled: true, glowIntensity: 1.0,
        sensitivity: 1.8, mirror: false,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      } as any,
    ],
  },
  {
    id: 'preset_avee_classic',
    name: 'Avee Classic',
    description: 'Phong cách Avee Player kinh điển',
    category: 'classic',
    layers: [
      {
        id: uid('viz'), type: 'visualizer', name: 'Avee Circle',
        visible: true, waveStyle: 'circlebars',
        colorMode: 'rainbow',
        barCount: 128, speed: 1.0, opacity: 1, glowEnabled: true, glowIntensity: 0.5,
        sensitivity: 1.0, mirror: false,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      } as any,
    ],
  },
]

/** Lấy danh sách categories duy nhất. */
export function getPresetCategories(): string[] {
  const cats = new Set(BUILT_IN_PRESETS.map((p) => p.category))
  return Array.from(cats)
}

/**
 * Chức năng 13 — UI state cho Sóng nhạc.
 * Chỉ quality + fpsText + autoPlay + aspectRatio; không FFT/currentTime/waveform.
 * Runtime ref không lưu ở đây (runtime lifecycle trong PreviewViewport).
 */

import { create } from 'zustand'
import type { PreviewQuality } from '../runtime/types'
import type { EngineType } from '../runtime/engine/types'
import type { ThreeJsPresetId } from '../runtime/engine/threejs/threejsPresets'

export type AspectRatioId = '16:9' | '4:3' | '1:1' | '9:16' | '4:5' | '2.35:1' | '2:1' | '1.85:1' | '3:4' | '5.8-inch'
export type VisualizerLayoutId = 'circular' | 'horizontal' | 'mirror'

const AUTO_PLAY_KEY = 'songNhac.autoPlayWhenSelected'
const ASPECT_RATIO_KEY = 'songNhac.aspectRatio'

function loadAutoPlay(): boolean {
  try {
    const v = localStorage.getItem(AUTO_PLAY_KEY)
    return v !== 'false'
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[song-nhac][persist] failed to load autoPlay preference', err)
    }
    return true
  }
}

function loadAspectRatio(): AspectRatioId {
  try {
    const v = localStorage.getItem(ASPECT_RATIO_KEY) as AspectRatioId | null
    const valid: AspectRatioId[] = ['16:9', '4:3', '1:1', '9:16', '4:5', '2.35:1', '2:1', '1.85:1', '3:4', '5.8-inch']
    return v && valid.includes(v) ? v : '16:9'
  } catch {
    return '16:9'
  }
}

interface SongNhacRuntimeState {
  quality: PreviewQuality
  setQuality: (q: PreviewQuality) => void
  fpsText: string
  setFpsText: (t: string) => void
  /** Tự phát khi chọn track (default ON). */
  autoPlayWhenSelected: boolean
  setAutoPlayWhenSelected: (v: boolean) => void
  /** Tỉ lệ khung: Preview và Export dùng chung. */
  aspectRatio: AspectRatioId
  setAspectRatio: (r: AspectRatioId) => void
  /** Zoom preview canvas (0.25–2, 1 = 100%). */
  previewZoom: number
  setPreviewZoom: (z: number) => void
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  /** Hiển thị grid trên canvas. */
  showGrid: boolean
  setShowGrid: (v: boolean) => void
  /** Hiển thị rulers (thước đo) quanh canvas. */
  showRulers: boolean
  setShowRulers: (v: boolean) => void
  /** Hiệu ứng: ảnh phóng theo beat (bật/tắt + cường độ). */
  imageBeatEnabled: boolean
  setImageBeatEnabled: (v: boolean) => void
  /** 0–0.5: biên độ scale thêm so với 1.0. */
  imageBeatIntensity: number
  setImageBeatIntensity: (v: number) => void
  /** Sóng bao quanh ảnh: bật toàn cục (mặc định tắt). */
  waveAroundImageEnabled: boolean
  setWaveAroundImageEnabled: (v: boolean) => void
  /** 0–1: cường độ sóng (độ dài thanh). */
  waveAroundIntensity: number
  setWaveAroundIntensity: (v: number) => void
  /** Kiểu sóng quanh ảnh. */
  waveAroundStyle: 'bars' | 'line' | 'ring' | 'dots' | 'waveform' | 'circlebars' | 'plasma' | 'lightning' | 'galaxy' | 'fire' | 'neonbars' | 'crystalring' | 'nebula'
  setWaveAroundStyle: (v: 'bars' | 'line' | 'ring' | 'dots' | 'waveform' | 'circlebars' | 'plasma' | 'lightning' | 'galaxy' | 'fire' | 'neonbars' | 'crystalring' | 'nebula') => void
  /** Visualizer layout: circular | horizontal | mirror. */
  visualizerLayout: VisualizerLayoutId
  setVisualizerLayout: (v: VisualizerLayoutId) => void
  /** Bloom strength (0–5). */
  bloomStrength: number
  setBloomStrength: (v: number) => void
  /** Bloom radius (0–2). */
  bloomRadius: number
  setBloomRadius: (v: number) => void
  /** Bloom threshold (0–1). */
  bloomThreshold: number
  setBloomThreshold: (v: number) => void
  /** Số thanh visualizer (bar count). */
  barCount: number
  setBarCount: (v: number) => void
  /** Engine nền: threejs | butterchurn | audiomotion | wavejs | vanta | wave2d. */
  bgEngine: EngineType
  setBgEngine: (v: EngineType) => void
  /** Butterchurn: tên preset đang chạy. */
  butterchurnPreset: string
  setButterchurnPreset: (v: string) => void
  /** AudioMotion: mode (0–10). */
  audiomotionMode: number
  setAudiomotionMode: (v: number) => void
  /** AudioMotion: gradient. */
  audiomotionGradient: string
  setAudiomotionGradient: (v: string) => void
  /** AudioMotion: radial. */
  audiomotionRadial: boolean
  setAudiomotionRadial: (v: boolean) => void
  /** AudioMotion: LED bars. */
  audiomotionLedBars: boolean
  setAudiomotionLedBars: (v: boolean) => void
  /** Wave.js: animation type. */
  wavejsAnimation: string
  setWavejsAnimation: (v: string) => void
  /** Vanta: effect type. */
  vantaEffect: string
  setVantaEffect: (v: string) => void
  /** Background mode: dark | blur | gradient. */
  bgMode: 'dark' | 'blur' | 'gradient'
  setBgMode: (v: 'dark' | 'blur' | 'gradient') => void
  /** ThreeJS visual preset. */
  threejsPreset: ThreeJsPresetId
  setThreejsPreset: (v: ThreeJsPresetId) => void
}

const ZOOM_MIN = 0.25
const ZOOM_MAX = 2
const ZOOM_STEP = 0.25

function clampZoom(z: number): number {
  if (!Number.isFinite(z) || z <= 0) return 1
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))
}

export const useSongNhacRuntimeStore = create<SongNhacRuntimeState>((set, get) => ({
  quality: 'full',
  setQuality: (q) => set({ quality: q }),
  fpsText: '— fps',
  setFpsText: (t) => set({ fpsText: t }),
  autoPlayWhenSelected: loadAutoPlay(),
  aspectRatio: loadAspectRatio(),
  setAspectRatio: (r) => {
    try {
      localStorage.setItem(ASPECT_RATIO_KEY, r)
    } catch {}
    set({ aspectRatio: r })
  },
  previewZoom: 1,
  setPreviewZoom: (z) => set({ previewZoom: clampZoom(z) }),
  zoomIn: () =>
    set((s) => ({ previewZoom: clampZoom(s.previewZoom + ZOOM_STEP) })),
  zoomOut: () =>
    set((s) => ({ previewZoom: clampZoom(s.previewZoom - ZOOM_STEP) })),
  zoomReset: () => set({ previewZoom: 1 }),
  showGrid: false,
  setShowGrid: (v) => set({ showGrid: v }),
  showRulers: false,
  setShowRulers: (v) => set({ showRulers: v }),
  imageBeatEnabled: true,
  setImageBeatEnabled: (v) => set({ imageBeatEnabled: v }),
  imageBeatIntensity: 0.8,
  setImageBeatIntensity: (v) => {
    const clamped = Number.isFinite(v) ? Math.max(0, Math.min(1.5, v)) : 0
    set({ imageBeatIntensity: clamped })
  },
  waveAroundImageEnabled: true,
  setWaveAroundImageEnabled: (v) => set({ waveAroundImageEnabled: v }),
  waveAroundIntensity: 0.5,
  setWaveAroundIntensity: (v) => {
    const clamped = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0
    set({ waveAroundIntensity: clamped })
  },
  waveAroundStyle: 'line',
  setWaveAroundStyle: (v) => set({ waveAroundStyle: v }),
  visualizerLayout: 'circular',
  setVisualizerLayout: (v) => set({ visualizerLayout: v }),
  bloomStrength: 1.5,
  setBloomStrength: (v) => {
    const clamped = Number.isFinite(v) ? Math.max(0, Math.min(5, v)) : 1.5
    set({ bloomStrength: clamped })
  },
  bloomRadius: 0.4,
  setBloomRadius: (v) => {
    const clamped = Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : 0.4
    set({ bloomRadius: clamped })
  },
  bloomThreshold: 0.1,
  setBloomThreshold: (v) => {
    const clamped = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.1
    set({ bloomThreshold: clamped })
  },
  barCount: 128,
  setBarCount: (v) => {
    const clamped = Number.isFinite(v) ? Math.max(8, Math.min(512, Math.round(v))) : 128
    set({ barCount: clamped })
  },
  bgEngine: 'none' as EngineType,
  setBgEngine: (v) => set({ bgEngine: v }),
  butterchurnPreset: '',
  setButterchurnPreset: (v) => set({ butterchurnPreset: v }),
  audiomotionMode: 3,
  setAudiomotionMode: (v) => set({ audiomotionMode: v }),
  audiomotionGradient: 'prism',
  setAudiomotionGradient: (v) => set({ audiomotionGradient: v }),
  audiomotionRadial: false,
  setAudiomotionRadial: (v) => set({ audiomotionRadial: v }),
  audiomotionLedBars: false,
  setAudiomotionLedBars: (v) => set({ audiomotionLedBars: v }),
  wavejsAnimation: 'shine rings',
  setWavejsAnimation: (v) => set({ wavejsAnimation: v }),
  vantaEffect: 'waves',
  setVantaEffect: (v) => set({ vantaEffect: v }),
  bgMode: 'dark' as 'dark' | 'blur' | 'gradient',
  setBgMode: (v) => set({ bgMode: v }),
  threejsPreset: 'neon-cyberpunk' as ThreeJsPresetId,
  setThreejsPreset: (v) => set({ threejsPreset: v }),
  setAutoPlayWhenSelected: (v) => {
    try {
      localStorage.setItem(AUTO_PLAY_KEY, String(v))
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[song-nhac][persist] failed to save autoPlay preference', err)
      }
    }
    set({ autoPlayWhenSelected: v })
  },
}))

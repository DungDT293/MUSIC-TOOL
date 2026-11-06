import { AveeVisualizerEngine } from '../three/AveeVisualizerEngine'
import type { AveeColorTheme } from '../three/AveeVisualizerEngine'
import { createVisualizerLayer } from './layerTypes'
import { WAVE_PRESETS, type WavePreset } from './builtInPresets'

const CACHE_PREFIX = 'song-nhac.preset-thumbs.v2'
const THUMB_WIDTH = 192
const THUMB_HEIGHT = 108

/** Synthetic frame so a preview looks alive without audio. */
function previewFrame(timeSec: number) {
  const bins = 128
  const frequencyData = new Uint8Array(bins)
  for (let i = 0; i < bins; i += 1) {
    const low = Math.exp(-i / 26)
    const wobble = 0.55 + 0.45 * Math.sin(timeSec * 2.2 + i * 0.35)
    frequencyData[i] = Math.min(255, Math.round(255 * low * wobble))
  }
  const waveformData = new Uint8Array(256)
  for (let i = 0; i < waveformData.length; i += 1) {
    waveformData[i] = Math.round(128 + Math.sin((i / waveformData.length) * Math.PI * 8 + timeSec * 4) * 60)
  }
  return { timeSec, frequencyData, waveformData, bass: 0.75, mid: 0.5, treble: 0.3, rms: 0.5, beat: 0.6 }
}

/**
 * Renders one small real frame per preset so the picker shows the actual look instead of
 * a colour swatch.
 *
 * A single off-screen engine is reused for every preset: creating one WebGL context per
 * thumbnail exhausts the browser's context budget and kills the live preview canvas.
 */
interface ThumbnailEntry {
  id: string
  visualizer: Record<string, unknown>
}

/**
 * Renders one small frame per entry, reusing a single off-screen engine.
 *
 * Creating one WebGL context per thumbnail exhausts the browser's context budget and
 * kills the live preview canvas, so every entry goes through the same engine.
 */
async function renderThumbnailsFor(
  entries: ThumbnailEntry[],
  theme: AveeColorTheme,
  cachePrefix: string,
  limit: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, string>> {
  const key = `${cachePrefix}.${theme}`
  let cached: Record<string, string> = {}
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string>
      if (parsed && typeof parsed === 'object') cached = parsed
    }
  } catch {
    cached = {}
  }

  const missing = entries.filter((entry) => !cached[entry.id])
  if (!missing.length) return cached

  const result: Record<string, string> = { ...cached }
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_WIDTH
  canvas.height = THUMB_HEIGHT
  canvas.style.position = 'fixed'
  canvas.style.left = '-9999px'
  canvas.style.top = '0'
  document.body.appendChild(canvas)

  let engine: AveeVisualizerEngine | null = null
  try {
    engine = new AveeVisualizerEngine(canvas, {
      theme,
      intensity: 1,
      showParticles: false,
      showLogo: true,
      showBars: true,
      showRing: true,
      quality: 'balanced',
      seed: 93,
      preserveDrawingBuffer: true,
    })

    for (let index = 0; index < missing.length; index += 1) {
      const entry = missing[index]
      const layer = createVisualizerLayer('preset')
      Object.assign(layer, entry.visualizer)
      engine.setLayers([layer])
      engine.render(previewFrame(1.2))
      engine.render(previewFrame(1.35))
      try {
        result[entry.id] = canvas.toDataURL('image/png')
      } catch {
        // Ignore a single failed frame; the swatch stays as a gradient.
      }
      onProgress?.(index + 1, missing.length)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  } finally {
    engine?.dispose()
    canvas.remove()
  }

  const trimmed: Record<string, string> = {}
  for (const entry of entries.slice(0, limit)) {
    if (result[entry.id]) trimmed[entry.id] = result[entry.id]
  }
  try {
    localStorage.setItem(key, JSON.stringify(trimmed))
  } catch {
    // Thumbnails are nice-to-have; quota failures only cost a re-render next time.
  }
  return trimmed
}

/** Rendered previews for the built-in preset library. */
export async function renderPresetThumbnails(
  theme: AveeColorTheme,
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, string>> {
  return renderThumbnailsFor(
    WAVE_PRESETS.map((preset: WavePreset) => ({
      id: preset.id,
      visualizer: preset.visualizer as Record<string, unknown>,
    })),
    theme,
    `${CACHE_PREFIX}.builtin`,
    15,
    onProgress,
  )
}

/** Rendered previews for presets the user saved. */
export async function renderUserPresetThumbnails(
  presets: Array<{ id: string; visualizer: Record<string, unknown> }>,
  theme: AveeColorTheme,
): Promise<Record<string, string>> {
  return renderThumbnailsFor(presets, theme, `${CACHE_PREFIX}.user`, 40)
}

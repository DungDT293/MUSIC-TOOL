import type { AveeColorTheme, AveeQuality } from '../three/AveeVisualizerEngine'
import { AveeVisualizerEngine } from '../three/AveeVisualizerEngine'
import type { StudioAnyLayer } from '../studio/layerTypes'
import { analyzeAudioBuffer } from './spectrumAnalyzer'
import { renderSongNhacVideo, suggestBitrate } from './renderSongNhacVideo'
import type { SongNhacFramesResult } from '../../../../shared/songNhacChannels'

export interface ExportSongNhacFramesOptions {
  /** Caller-owned id so the UI can cancel the right job. */
  requestId?: string
  audioPath: string
  outputPath: string
  width: number
  height: number
  fps: number
  theme: AveeColorTheme
  intensity: number
  quality: AveeQuality
  seed?: number
  /** Layer stack to render. Without it the exported video loses every image/text layer. */
  layers?: StudioAnyLayer[]
  /** Optional trim, in seconds. Absent = whole audio. */
  rangeStartSec?: number
  rangeEndSec?: number
  /** avc = widest compatibility, hevc = ~35% smaller (needs hardware support). */
  codec?: 'h264' | 'hevc'
  /** Bitrate tier: high = 1.0x of the suggestion, balanced = 0.75x, light = 0.55x. */
  bitrateTier?: 'high' | 'balanced' | 'light'
  signal?: AbortSignal
  onProgress?: (percent: number, renderedFrames: number, totalFrames: number) => void
}

const BITRATE_TIERS = { high: 1, balanced: 0.8, light: 0.55 } as const

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/**
 * Frame-accurate Sóng nhạc export: decode the audio once, pre-compute the spectrum
 * for every frame, render those exact frames with the Three.js engine and stream the
 * encoded H.264 to the main process for muxing. What the preview shows is what ships.
 */
export async function exportSongNhacFrames(options: ExportSongNhacFramesOptions): Promise<SongNhacFramesResult> {
  const requestId = options.requestId?.trim() || `songnhac-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const api = window.api.songNhac

  try {
    const file = await window.api.readFileAsBase64?.(options.audioPath)
    if (!file?.ok || !file.base64) {
      throw new Error(file?.error || 'Không đọc được file audio (readFileAsBase64).')
    }
    const audioBytes = decodeBase64(file.base64)
    const analysisContext = new OfflineAudioContext(1, 1, 48000)
    const audioBuffer = await analysisContext.decodeAudioData(audioBytes.slice(0))

    const allFrames = analyzeAudioBuffer(audioBuffer, { fps: options.fps })
    if (!allFrames.length) throw new Error('Không đọc được dữ liệu âm thanh.')

    const rangeStart = Math.max(0, options.rangeStartSec ?? 0)
    const rangeEnd = Math.min(audioBuffer.duration, options.rangeEndSec ?? audioBuffer.duration)
    const frames = rangeEnd > rangeStart
      ? allFrames.filter((frame) => frame.timeSec >= rangeStart && frame.timeSec < rangeEnd)
      : allFrames
    if (!frames.length) throw new Error('Khoảng thời gian đã chọn không có frame nào.')

    const begin = await api.framesBegin({
      requestId,
      audioPath: options.audioPath,
      outputPath: options.outputPath,
      width: options.width,
      height: options.height,
      fps: options.fps,
      totalFrames: frames.length,
      startSec: rangeStart > 0 ? rangeStart : undefined,
      durationSec: frames.length / options.fps,
      codec: options.codec ?? 'h264',
    })
    if (!begin.success) return begin

    const canvas = document.createElement('canvas')
    canvas.width = options.width
    canvas.height = options.height
    const engine = new AveeVisualizerEngine(canvas, {
      theme: options.theme,
      intensity: options.intensity,
      quality: options.quality,
      seed: options.seed ?? 93,
    })
    if (options.layers?.length) {
      engine.setLayers(options.layers)
      // Give image layers a moment to decode before the first frame is encoded.
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    const queue: Uint8Array[] = []
    const flushQueue = async () => {
      if (!queue.length) return
      const pending = queue.splice(0, queue.length)
      for (const chunk of pending) api.framesChunk(requestId, chunk)
      await api.framesFlush(requestId)
    }

    try {
      await renderSongNhacVideo({
        canvas,
        engine,
        frames,
        fps: options.fps,
        bitrate: Math.round(suggestBitrate(options.width, options.height, options.fps) * BITRATE_TIERS[options.bitrateTier ?? 'balanced']),
        codec: options.codec ?? 'h264',
        signal: options.signal,
        onChunk: (chunk) => queue.push(chunk),
        onProgress: async (rendered, total) => {
          await flushQueue()
          options.onProgress?.(Math.min(99, Math.round((rendered / total) * 100)), rendered, total)
        },
      })
      await flushQueue()
    } finally {
      engine.dispose()
    }

    return await api.framesEnd(requestId)
  } catch (error) {
    await api.framesCancel(requestId).catch(() => undefined)
    return {
      success: false,
      requestId,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

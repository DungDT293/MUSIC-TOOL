import { analyzeAudioBuffer } from '../../src/features/song-nhac/export/spectrumAnalyzer'
import { renderSongNhacVideo, suggestBitrate } from '../../src/features/song-nhac/export/renderSongNhacVideo'
import { AveeVisualizerEngine } from '../../src/features/song-nhac/three/AveeVisualizerEngine'

function makeBuffer(seconds: number, sampleRate: number): AudioBuffer {
  const context = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate)
  const buffer = context.createBuffer(1, Math.ceil(seconds * sampleRate), sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sampleRate
    const kick = Math.exp(-((t % 0.5) * 6)) * Math.sin(2 * Math.PI * 55 * t)
    const pad = 0.25 * Math.sin(2 * Math.PI * 220 * t)
    const hat = ((t % 0.25) < 0.02 ? 1 : 0) * (Math.random() * 2 - 1) * 0.15
    data[i] = kick * 0.6 + pad + hat
  }
  return buffer
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)) as unknown as number[])
  }
  return btoa(binary)
}

;(window as unknown as Record<string, unknown>).runExport = async () => {
  const width = 640
  const height = 360
  const fps = 30
  const canvas = document.getElementById('stage') as HTMLCanvasElement
  canvas.width = width
  canvas.height = height

  const buffer = makeBuffer(4, 48000)
  const frames = analyzeAudioBuffer(buffer, { fps, bins: 96 })

  const engine = new AveeVisualizerEngine(canvas, {
    theme: 'cyberpunk',
    quality: 'balanced',
    intensity: 1,
    seed: 93,
  })

  const chunks: Uint8Array[] = []
  await renderSongNhacVideo({
    canvas,
    engine,
    frames,
    fps,
    bitrate: suggestBitrate(width, height, fps),
    onChunk: (chunk) => chunks.push(chunk),
  })

  let total = 0
  for (const chunk of chunks) total += chunk.length
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return { base64: toBase64(merged), frames: frames.length, bytes: total }
}

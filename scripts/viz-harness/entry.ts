import { AveeVisualizerEngine } from '../../src/features/song-nhac/three/AveeVisualizerEngine'

interface HarnessOptions {
  width?: number
  height?: number
  theme?: string
  quality?: 'low' | 'balanced' | 'full'
  intensity?: number
  time?: number
  bins?: number
  seed?: number
  showParticles?: boolean
  showBars?: boolean
  showLogo?: boolean
}

function syntheticSpectrum(bins: number, time: number): Uint8Array {
  const data = new Uint8Array(bins)
  for (let i = 0; i < bins; i += 1) {
    const t = i / bins
    const lowEnergy = Math.pow(1 - t, 1.6)
    const wobble = 0.55 + 0.45 * Math.sin(time * 2.1 + t * 12.4)
    const sparkle = 0.75 + 0.25 * Math.sin(time * 7.3 + i * 1.7)
    data[i] = Math.max(0, Math.min(255, Math.round(255 * lowEnergy * wobble * sparkle)))
  }
  return data
}

;(window as unknown as Record<string, unknown>).renderViz = (options: HarnessOptions = {}) => {
  const width = options.width ?? 1280
  const height = options.height ?? 720
  const canvas = document.getElementById('stage') as HTMLCanvasElement
  canvas.width = width
  canvas.height = height

  const engine = new AveeVisualizerEngine(canvas, {
    theme: (options.theme ?? 'cyberpunk') as never,
    quality: options.quality ?? 'balanced',
    intensity: options.intensity ?? 1,
    seed: options.seed ?? 93,
    showParticles: options.showParticles ?? true,
    showBars: options.showBars ?? true,
    showLogo: options.showLogo ?? true,
  })

  const bins = options.bins ?? 128
  const spectrum = syntheticSpectrum(bins, options.time ?? 3.2)
  const frame = {
    timeSec: options.time ?? 3.2,
    frequencyData: spectrum,
    waveformData: new Uint8Array(0),
    bass: 0.72,
    mid: 0.45,
    treble: 0.3,
    rms: 0.4,
    beat: 0.6,
  }
  // Two frames: the first settles the smoothing, the second is captured.
  engine.render({ ...frame, timeSec: (options.time ?? 3.2) - 0.05 })
  engine.render(frame)
  return true
}

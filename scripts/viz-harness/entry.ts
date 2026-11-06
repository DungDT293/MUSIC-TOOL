import { AveeVisualizerEngine } from '../../src/features/song-nhac/three/AveeVisualizerEngine'

interface HarnessOptions {
  width?: number
  height?: number
  theme?: string
  themeAfter?: string
  quality?: 'low' | 'balanced' | 'full'
  intensity?: number
  time?: number
  bins?: number
  seed?: number
  simulateLogo?: boolean
  showParticles?: boolean
  showBars?: boolean
  showLogo?: boolean
}

function makeBrightLogoDataUrl(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 0, 256, 256)
  gradient.addColorStop(0, '#ff9a3c')
  gradient.addColorStop(0.5, '#ffd166')
  gradient.addColorStop(1, '#ff5f6d')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 256, 256)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.beginPath()
  ctx.arc(128, 110, 52, 0, Math.PI * 2)
  ctx.fill()
  return canvas.toDataURL('image/png')
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
    logoUrl: options.simulateLogo ? makeBrightLogoDataUrl() : null,
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
  if (options.themeAfter) {
    engine.setOptions({ theme: options.themeAfter as never })
    engine.render({ ...frame, timeSec: (options.time ?? 3.2) + 0.05 })
    engine.render({ ...frame, timeSec: (options.time ?? 3.2) + 0.1 })
  }
  return true
}

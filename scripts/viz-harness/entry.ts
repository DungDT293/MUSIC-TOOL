import { AveeVisualizerEngine } from '../../src/features/song-nhac/three/AveeVisualizerEngine'
import {
  createImageLayer,
  createTextLayer,
  createVideoLayer,
  createVisualizerLayer,
} from '../../src/features/song-nhac/studio/layerTypes'

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
  withLayers?: boolean
  waveStyle?: string
  videoSrc?: string
}

function makeBrightLogoDataUrl(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx) {
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
  }
  return canvas.toDataURL('image/png')
}

function syntheticSpectrum(bins: number, time: number): Uint8Array {
  const data = new Uint8Array(bins)
  for (let i = 0; i < bins; i += 1) {
    const t = i / bins
    const lowEnergy = Math.pow(1 - t, 1.6)
    const wobble = 0.55 + 0.45 * Math.sin(time * 2.1 + t * 12.4)
    data[i] = Math.max(0, Math.min(255, Math.round(255 * lowEnergy * wobble)))
  }
  return data
}

;(window as unknown as Record<string, unknown>).renderViz = async (options: HarnessOptions = {}) => {
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
    logoUrl: options.simulateLogo ? makeBrightLogoDataUrl() : null,
  })

  if (options.withLayers && options.videoSrc) {
    const videoLayer = createVideoLayer(options.videoSrc, 'Video nen')
    videoLayer.fitMode = 'cover'
    videoLayer.filter = { ...videoLayer.filter, grayscale: 1, contrast: 1.2 }
    engine.setLayers([videoLayer, createVisualizerLayer(), createTextLayer('Video filter test')])
  } else if (options.withLayers) {
    const imageLayer = createImageLayer(makeBrightLogoDataUrl(), 'Anh nen')
    imageLayer.fitMode = 'cover'
    imageLayer.waveAroundEnabled = options.waveStyle === 'wavearound'
    imageLayer.transform = { ...imageLayer.transform, scaleX: 0.6, scaleY: 0.6 }

    const vizLayer = createVisualizerLayer()
    vizLayer.waveStyle = options.waveStyle ?? 'circlebars'

    const textLayer = createTextLayer('Ten bai hat')

    if (options.waveStyle === 'double') {
      const second = createVisualizerLayer('Song 2')
      second.waveStyle = 'dots'
      second.transform = { ...second.transform, x: 620, y: -240, scaleX: 0.45, scaleY: 0.45 }
      second.colorMode = 'solid'
      second.color1 = '#facc15'
      second.barCount = 64
      engine.setLayers([imageLayer, vizLayer, second, textLayer])
    } else {
      engine.setLayers([imageLayer, vizLayer, textLayer])
    }
    engine.setSelectedLayer(textLayer.id)
  }

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

  engine.render({ ...frame, timeSec: (options.time ?? 3.2) - 0.05 })
  engine.render(frame)

  if (options.withLayers) {
    // Async layers (images, video) resolve after mount; give them a beat and redraw.
    await new Promise((resolve) => setTimeout(resolve, 900))
    engine.render({ ...frame, timeSec: (options.time ?? 3.2) + 0.1 })
  }

  if (options.themeAfter) {
    engine.setOptions({ theme: options.themeAfter as never })
    engine.render({ ...frame, timeSec: (options.time ?? 3.2) + 0.2 })
  }

  ;(window as unknown as Record<string, unknown>).__layerDebug = engine.debugLayers()
  return true
}

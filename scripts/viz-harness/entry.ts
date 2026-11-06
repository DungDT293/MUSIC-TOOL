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
  skipImage?: boolean
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

function syntheticWaveform(time: number): Uint8Array {
  const data = new Uint8Array(128)
  for (let i = 0; i < data.length; i += 1) {
    const t = i / data.length
    const value = Math.sin(t * Math.PI * 6 + time * 2.2) * 0.55 + Math.sin(t * Math.PI * 17 + time * 4.1) * 0.25
    data[i] = Math.max(0, Math.min(255, Math.round(value * 110 + 128)))
  }
  return data
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
    imageLayer.visible = !options.skipImage
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
    waveformData: syntheticWaveform(options.time ?? 3.2),
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
  ;(window as unknown as Record<string, unknown>).__engine = engine
  return true
}

/**
 * Renders N frames with the engine and reports the cost per frame.
 * Used with Electron (hardware GL) so the numbers reflect the real app.
 */
;(window as unknown as Record<string, unknown>).benchViz = async (options: HarnessOptions & { frames?: number } = {}) => {
  const width = options.width ?? 1920
  const height = options.height ?? 1080
  const frames = options.frames ?? 60
  const canvas = document.getElementById('stage') as HTMLCanvasElement
  canvas.width = width
  canvas.height = height

  const engine = new AveeVisualizerEngine(canvas, {
    theme: (options.theme ?? 'cyberpunk') as never,
    quality: options.quality ?? 'balanced',
    intensity: 1,
    seed: 93,
    logoUrl: makeBrightLogoDataUrl(),
  })
  const viz = createVisualizerLayer()
  viz.waveStyle = options.waveStyle ?? 'circlebars'
  viz.colorMode = 'gradient'
  engine.setLayers([viz, createTextLayer('Bench')])

  const context = (engine as unknown as { renderer?: { getContext?: () => WebGLRenderingContext } }).renderer?.getContext?.()
  const pixel = new Uint8Array(4)
  const samples: number[] = []
  // Warm up: the first frames compile shaders and allocate bloom buffers, which would
  // otherwise dominate the average.
  for (let i = 0; i < 10; i += 1) {
    engine.render({
      timeSec: 0,
      frequencyData: syntheticSpectrum(128, 0),
      waveformData: syntheticWaveform(0),
      bass: 0.5, mid: 0.4, treble: 0.3, rms: 0.4, beat: 0.4,
    })
  }
  context?.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel)
  for (let i = 0; i < frames; i += 1) {
    const time = i / 30
    const frame = {
      timeSec: time,
      frequencyData: syntheticSpectrum(options.bins ?? 128, time),
      waveformData: syntheticWaveform(time),
      bass: 0.6,
      mid: 0.4,
      treble: 0.3,
      rms: 0.4,
      beat: 0.5,
    }
    const start = performance.now()
    engine.render(frame)
    // readPixels forces the driver to finish the frame; gl.finish() is a no-op in Chromium
    // and would report only command submission time.
    context?.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel)
    samples.push(performance.now() - start)
  }
  engine.dispose()

  const sorted = [...samples].sort((a, b) => a - b)
  const average = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length)
  return {
    style: options.waveStyle ?? 'circlebars',
    size: `${width}x${height}`,
    frames,
    avgMs: Number(average.toFixed(2)),
    p95Ms: Number((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0).toFixed(2)),
    minMs: Number((sorted[0] ?? 0).toFixed(2)),
    maxMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
    fps: Number((1000 / Math.max(0.01, average)).toFixed(1)),
  }
}

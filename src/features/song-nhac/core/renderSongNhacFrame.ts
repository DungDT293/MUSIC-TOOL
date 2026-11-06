import type { SongNhacAudioFrame, SongNhacRenderConfig } from './types'

const QUALITY_COUNTS = { low: 10, balanced: 18, full: 28 } as const

function fract(value: number): number {
  return value - Math.floor(value)
}

function seeded(index: number, seed: number): number {
  return fract(Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453)
}

function spectrumAt(data: Uint8Array, index: number, total: number): number {
  if (!data.length) return 0
  return (data[Math.min(data.length - 1, Math.floor((index / total) * data.length))] ?? 0) / 255
}

export function renderSongNhacFrame(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: SongNhacAudioFrame,
  config: SongNhacRenderConfig,
): void {
  const centerX = width / 2
  const centerY = height / 2
  const minSize = Math.max(1, Math.min(width, height))
  const intensity = config.intensity
  const cyan = `hsl(${188 + Math.round(frame.treble * 45)} 100% 62%)`
  const magenta = `hsl(${282 + Math.round(frame.mid * 45)} 100% 65%)`
  const count = QUALITY_COUNTS[config.quality]

  const background = context.createRadialGradient(centerX, centerY, minSize * 0.04, centerX, centerY, minSize * 0.85)
  background.addColorStop(0, '#101a47')
  background.addColorStop(0.45, '#050817')
  background.addColorStop(1, '#01030a')
  context.fillStyle = background
  context.fillRect(0, 0, width, height)

  context.save()
  context.globalCompositeOperation = 'lighter'
  context.lineWidth = Math.max(1, minSize / 540)
  context.shadowBlur = minSize / 44
  context.shadowColor = cyan

  if (config.style === 'neon-tunnel') {
    for (let index = 0; index < count; index += 1) {
      const depth = (index / count + frame.timeSec * 0.12) % 1
      const audio = spectrumAt(frame.frequencyData, index, count)
      const radius = minSize * (0.05 + depth * 0.78) * (1 + (frame.bass + audio) * 0.17 * intensity)
      context.globalAlpha = (1 - depth * 0.82) * (0.45 + audio * 0.55)
      context.strokeStyle = index % 2 ? cyan : magenta
      context.beginPath()
      context.ellipse(centerX, centerY, radius, radius * 0.54, frame.timeSec * 0.17, 0, Math.PI * 2)
      context.stroke()
    }
    context.globalAlpha = 0.2 + frame.beat * 0.55
    context.strokeStyle = magenta
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + frame.timeSec * 0.1
      context.beginPath()
      context.moveTo(centerX, centerY)
      context.lineTo(centerX + Math.cos(angle) * minSize, centerY + Math.sin(angle) * minSize)
      context.stroke()
    }
  } else if (config.style === 'orbit-spectrum') {
    const radius = minSize * (0.22 + frame.bass * 0.05 * intensity)
    for (let index = 0; index < count * 4; index += 1) {
      const value = spectrumAt(frame.frequencyData, index, count * 4)
      const angle = (index / (count * 4)) * Math.PI * 2 + frame.timeSec * 0.25
      const length = minSize * (0.025 + value * 0.22 * intensity)
      context.globalAlpha = 0.35 + value * 0.65
      context.strokeStyle = index % 2 ? cyan : magenta
      context.beginPath()
      context.moveTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius)
      context.lineTo(centerX + Math.cos(angle) * (radius + length), centerY + Math.sin(angle) * (radius + length))
      context.stroke()
    }
    context.globalAlpha = 0.75
    context.strokeStyle = cyan
    context.beginPath()
    context.arc(centerX, centerY, radius, 0, Math.PI * 2)
    context.stroke()
  } else if (config.style === 'avee-circle') {
    // GPU-free fallback for the Avee Player look: mirrored radial spectrum around a
    // pulsing disc. The Three.js engine draws a richer version of this; this branch
    // keeps the preview and the export path usable when WebGL is unavailable.
    const bars = Math.max(24, count * 2)
    const half = Math.max(8, Math.floor(bars / 2))
    const discRadius = minSize * (0.2 + frame.bass * 0.05 * intensity)
    const barBase = discRadius * 1.06
    const dataLength = Math.min(frame.frequencyData.length, 180)

    const disc = context.createRadialGradient(centerX, centerY, discRadius * 0.08, centerX, centerY, discRadius)
    disc.addColorStop(0, 'rgba(18,30,58,0.96)')
    disc.addColorStop(0.75, 'rgba(6,10,22,0.92)')
    disc.addColorStop(1, 'rgba(2,4,10,0.88)')
    // The shared glow shadow would turn this fill into a bright blob; fill the plate flat.
    context.shadowBlur = 0
    context.globalAlpha = 1
    context.fillStyle = disc
    context.beginPath()
    context.arc(centerX, centerY, discRadius, 0, Math.PI * 2)
    context.fill()
    context.shadowBlur = minSize / 64

    context.lineWidth = Math.max(1, (Math.PI * barBase) / bars * 0.62)
    for (let index = 0; index < half; index += 1) {
      const normalized = Math.pow(index / half, 1.45)
      const value = dataLength > 0
        ? (frame.frequencyData[Math.min(dataLength - 1, Math.floor(normalized * dataLength))] ?? 0) / 255
        : 0
      const barLength = minSize * (0.012 + value * 0.17 * intensity)
      context.globalAlpha = 0.45 + value * 0.55
      context.strokeStyle = index % 2 ? cyan : magenta
      for (const side of [-1, 1]) {
        const angle = -Math.PI / 2 + side * (index / half) * Math.PI
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        context.beginPath()
        context.moveTo(centerX + cos * barBase, centerY + sin * barBase)
        context.lineTo(centerX + cos * (barBase + barLength), centerY + sin * (barBase + barLength))
        context.stroke()
      }
    }

    context.globalAlpha = 0.9
    context.strokeStyle = cyan
    context.beginPath()
    context.arc(centerX, centerY, discRadius, 0, Math.PI * 2)
    context.stroke()

    context.globalAlpha = 0.45
    context.strokeStyle = magenta
    const outerRadius = barBase + minSize * 0.02
    for (let index = 0; index < 24; index += 1) {
      const start = (index / 24) * Math.PI * 2 + frame.timeSec * 0.35
      context.beginPath()
      context.arc(centerX, centerY, outerRadius, start, start + Math.PI / 36)
      context.stroke()
    }
  } else {
    const horizon = centerY - minSize * 0.12
    const spacing = Math.max(18, minSize / 16)
    context.strokeStyle = cyan
    for (let y = horizon; y < height; y += spacing) {
      const depth = (y - horizon) / Math.max(1, height - horizon)
      context.globalAlpha = 0.2 + depth * 0.55
      const wave = Math.sin(frame.timeSec * 2.3 + y * 0.035) * frame.bass * spacing * 2 * intensity
      context.beginPath()
      context.moveTo(0, y + wave)
      context.lineTo(width, y + wave)
      context.stroke()
    }
    context.strokeStyle = magenta
    context.globalAlpha = 0.55
    for (let x = -width; x < width * 2; x += spacing) {
      context.beginPath()
      context.moveTo(centerX, horizon)
      context.lineTo(x, height)
      context.stroke()
    }
  }

  context.shadowBlur = minSize / 64
  for (let index = 0; index < count; index += 1) {
    const x = seeded(index, config.seed) * width
    const y = seeded(index + 71, config.seed) * height
    const phase = frame.timeSec * (0.3 + seeded(index + 137, config.seed)) + seeded(index + 211, config.seed) * Math.PI * 2
    const alpha = 0.08 + Math.max(0, Math.sin(phase)) * (0.12 + frame.beat * 0.4)
    context.fillStyle = index % 2 ? cyan : magenta
    context.globalAlpha = alpha
    context.beginPath()
    context.arc(x, y, Math.max(1, minSize * (0.001 + seeded(index + 17, config.seed) * 0.003)), 0, Math.PI * 2)
    context.fill()
  }

  context.restore()
  const vignette = context.createRadialGradient(centerX, centerY, minSize * 0.22, centerX, centerY, minSize * 0.78)
  vignette.addColorStop(0.6, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.65)')
  context.fillStyle = vignette
  context.fillRect(0, 0, width, height)
}

export type SongNhacStyle = 'avee-circle' | 'neon-tunnel' | 'orbit-spectrum' | 'pulse-grid'

export interface SongNhacFrameOptions {
  style: SongNhacStyle
  width: number
  height: number
  timeSec: number
  spectrum: ArrayLike<number>
}


export function songNhacEnergy(spectrum: ArrayLike<number>): number {
  if (spectrum.length === 0) return 0
  let total = 0
  for (let index = 0; index < spectrum.length; index += 1) total += spectrum[index] || 0
  return Math.max(0, Math.min(1, total / spectrum.length / 255))
}

export function renderSongNhacFrame(
  context: CanvasRenderingContext2D,
  { style, width, height, timeSec, spectrum }: SongNhacFrameOptions,
): void {
  const energy = songNhacEnergy(spectrum)
  const centerX = width / 2
  const centerY = height / 2
  const minSize = Math.min(width, height)
  const cyan = `hsl(${190 + Math.round(energy * 80)} 100% 62%)`
  const magenta = `hsl(${285 + Math.round(energy * 50)} 100% 62%)`

  context.fillStyle = '#030712'
  context.fillRect(0, 0, width, height)
  context.save()
  context.globalCompositeOperation = 'lighter'
  context.lineWidth = Math.max(1, minSize / 540)
  context.shadowBlur = minSize / 48
  context.shadowColor = cyan

  if (style === 'neon-tunnel') {
    for (let ring = 0; ring < 15; ring += 1) {
      const depth = ((ring / 15 + timeSec * 0.11) % 1)
      const radius = minSize * (0.06 + depth * 0.76) * (1 + energy * 0.18)
      context.strokeStyle = ring % 2 ? cyan : magenta
      context.globalAlpha = 1 - depth * 0.8
      context.beginPath()
      context.ellipse(centerX, centerY, radius, radius * 0.55, timeSec * 0.18, 0, Math.PI * 2)
      context.stroke()
    }
    context.globalAlpha = 0.7
    context.strokeStyle = magenta
    for (let spoke = 0; spoke < 22; spoke += 1) {
      const angle = (spoke / 22) * Math.PI * 2 + timeSec * 0.12
      context.beginPath()
      context.moveTo(centerX, centerY)
      context.lineTo(centerX + Math.cos(angle) * minSize, centerY + Math.sin(angle) * minSize)
      context.stroke()
    }
  } else if (style === 'orbit-spectrum') {
    const bars = Math.min(128, Math.max(24, spectrum.length))
    const radius = minSize * 0.22
    for (let bar = 0; bar < bars; bar += 1) {
      const value = spectrum[Math.floor((bar / bars) * spectrum.length)] || 0
      const angle = (bar / bars) * Math.PI * 2 + timeSec * 0.32
      const length = minSize * (0.035 + (value / 255) * 0.2)
      context.strokeStyle = bar % 2 ? cyan : magenta
      context.globalAlpha = 0.45 + value / 510
      context.beginPath()
      context.moveTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius)
      context.lineTo(centerX + Math.cos(angle) * (radius + length), centerY + Math.sin(angle) * (radius + length))
      context.stroke()
    }
    context.globalAlpha = 0.9
    context.strokeStyle = cyan
    context.beginPath()
    context.arc(centerX, centerY, radius * (1 + energy * 0.35), 0, Math.PI * 2)
    context.stroke()
  } else {
    const spacing = Math.max(20, minSize / 16)
    const horizon = centerY - minSize * 0.12
    context.strokeStyle = cyan
    context.globalAlpha = 0.7
    for (let y = horizon; y < height; y += spacing) {
      const perspective = (y - horizon) / Math.max(1, height - horizon)
      const wave = Math.sin(timeSec * 2.5 + y * 0.035) * energy * spacing * 1.8
      context.beginPath()
      context.moveTo(0, y + wave)
      context.lineTo(width, y + wave)
      context.stroke()
      context.globalAlpha = 0.25 + perspective * 0.5
    }
    context.strokeStyle = magenta
    context.globalAlpha = 0.65
    for (let x = -width; x < width * 2; x += spacing) {
      context.beginPath()
      context.moveTo(centerX, horizon)
      context.lineTo(x, height)
      context.stroke()
    }
    context.fillStyle = cyan
    context.globalAlpha = 0.35 + energy * 0.65
    context.beginPath()
    context.arc(centerX, horizon, minSize * (0.035 + energy * 0.09), 0, Math.PI * 2)
    context.fill()
  }

  context.restore()
}

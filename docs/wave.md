1. AlbumArtPulseVisualizer.tsx
typescriptimport { useEffect, useRef } from 'react'
import { BaseVisualizerProps } from '../types'
import type { LayerTransform } from '../config/ProjectConfig'
import { createAnalyser, getFrequencyData, releaseAudioContext, sharedAudioContext } from '../AudioAnalyzer'
import { useCanvasResize } from '../useCanvasResize'

type Props = BaseVisualizerProps & { 
  transform?: LayerTransform
  albumArtSrc?: string
}

interface Ripple {
  x: number
  y: number
  radius: number
  maxRadius: number
  opacity: number
  speed: number
}

export default function AlbumArtPulseVisualizer({ audioRef, configRef, isPlaying, transform, albumArtSrc }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>()
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataRef = useRef<Uint8Array | null>(null)
  
  // Album art image
  const imageRef = useRef<HTMLImageElement | null>(null)
  const imageLoadedRef = useRef<boolean>(false)
  
  // Smooth values
  const smoothBassRef = useRef<number>(0)
  const smoothEnergyRef = useRef<number>(0)
  const currentScaleRef = useRef<number>(1)
  
  // Ripples
  const ripplesRef = useRef<Ripple[]>([])
  const lastBeatTimeRef = useRef<number>(0)
  const beatThresholdRef = useRef<number>(0.6)

  useCanvasResize(canvasRef)

  // Load album art image
  useEffect(() => {
    if (albumArtSrc) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        imageRef.current = img
        imageLoadedRef.current = true
      }
      img.onerror = () => {
        console.error('[AlbumArtPulse] Failed to load image:', albumArtSrc)
        imageLoadedRef.current = false
      }
      img.src = albumArtSrc
    }
  }, [albumArtSrc])

  useEffect(() => {
    const canvas = canvasRef.current
    const audio = audioRef.current
    if (!canvas || !audio) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    try {
      const { analyser, dataArray } = createAnalyser(null, audio, 256, 0.7)
      audioContextRef.current = sharedAudioContext
      analyserRef.current = analyser
      dataRef.current = dataArray
    } catch (e) {
      console.error('[AlbumArtPulseVisualizer] audio init failed', e)
    }

    const draw = () => {
      const now = performance.now()

      const parent = canvas.parentElement
      if (parent) {
        const newWidth = parent.clientWidth || 640
        const newHeight = parent.clientHeight || 360
        if (canvas.width !== newWidth || canvas.height !== newHeight) {
          canvas.width = newWidth
          canvas.height = newHeight
        }
      }

      const w = canvas.width || 640
      const h = canvas.height || 360
      const cfg = configRef.current

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = cfg.colors.background || '#0a1628'
      ctx.fillRect(0, 0, w, h)

      // Lấy FFT data
      let arr: Uint8Array
      if (isPlaying && analyserRef.current && dataRef.current) {
        arr = getFrequencyData(analyserRef.current, dataRef.current)
      } else {
        arr = new Uint8Array(128)
        const phase = (now / 1000) * 2
        for (let i = 0; i < 128; i++) {
          const wave = Math.sin((i / 128) * Math.PI * 4 + phase) * 0.3 + 0.4
          arr[i] = Math.floor(wave * 200)
        }
      }

      // Tính bass và energy
      let bass = 0, energy = 0
      const bassEnd = Math.floor(arr.length * 0.12)
      for (let i = 0; i < bassEnd; i++) bass += arr[i]
      for (let i = 0; i < arr.length; i++) energy += arr[i]
      bass = bass / bassEnd / 255
      energy = energy / arr.length / 255

      // Smooth values
      const bassSmooth = 0.25
      const energySmooth = 0.15
      smoothBassRef.current += (bass - smoothBassRef.current) * bassSmooth
      smoothEnergyRef.current += (energy - smoothEnergyRef.current) * energySmooth

      const smoothBass = smoothBassRef.current
      const smoothEnergy = smoothEnergyRef.current

      // Beat detection - tạo ripple khi bass spike
      if (bass > beatThresholdRef.current && now - lastBeatTimeRef.current > 150) {
        lastBeatTimeRef.current = now
        // Tạo ripple mới
        const minDim = Math.min(w, h)
        ripplesRef.current.push({
          x: w * 0.35,
          y: h * 0.45,
          radius: minDim * 0.12,
          maxRadius: minDim * 0.6,
          opacity: 0.6,
          speed: 2 + bass * 3
        })
      }

      // Transform
      const tx = transform?.position ? (transform.position.x / 100) * w : w * 0.35
      const ty = transform?.position ? (transform.position.y / 100) * h : h * 0.4
      const baseScale = transform?.scale?.x ?? 1
      const rot = (transform?.rotation ?? 0) * (Math.PI / 180)
      const alpha = typeof transform?.opacity === 'number' ? transform.opacity : 1

      const primary = cfg.colors.primary || '#00d4ff'
      const secondary = cfg.colors.secondary || '#0066ff'
      const sensitivity = cfg.sensitivity || 1

      const minDim = Math.min(w, h)
      const albumSize = minDim * 0.28 * baseScale

      // Scale pulse theo bass
      const targetScale = 1 + smoothBass * 0.12 * sensitivity
      currentScaleRef.current += (targetScale - currentScaleRef.current) * 0.3
      const pulseScale = currentScaleRef.current

      ctx.save()
      ctx.globalAlpha = alpha

      // ========== VẼ RIPPLES (sóng nước) ==========
      const ripples = ripplesRef.current
      for (let i = ripples.length - 1; i >= 0; i--) {
        const ripple = ripples[i]
        
        // Update ripple
        ripple.radius += ripple.speed
        ripple.opacity -= 0.008

        // Remove dead ripples
        if (ripple.opacity <= 0 || ripple.radius > ripple.maxRadius) {
          ripples.splice(i, 1)
          continue
        }

        // Draw ripple
        ctx.beginPath()
        ctx.ellipse(ripple.x, h * 0.75, ripple.radius, ripple.radius * 0.3, 0, 0, Math.PI * 2)
        ctx.strokeStyle = `${primary}${Math.floor(ripple.opacity * 255).toString(16).padStart(2, '0')}`
        ctx.lineWidth = 2
        ctx.shadowColor = primary
        ctx.shadowBlur = 10
        ctx.stroke()
      }

      // ========== VẼ REFLECTION (phản chiếu) ==========
      const reflectionY = ty + albumSize * pulseScale * 0.5 + 10
      const reflectionHeight = albumSize * pulseScale * 0.6

      ctx.save()
      ctx.globalAlpha = 0.3 * alpha

      // Gradient fade cho reflection
      const reflectGrad = ctx.createLinearGradient(tx, reflectionY, tx, reflectionY + reflectionHeight)
      reflectGrad.addColorStop(0, 'rgba(255,255,255,0.4)')
      reflectGrad.addColorStop(1, 'transparent')

      ctx.translate(tx, reflectionY)
      ctx.scale(pulseScale, -pulseScale * 0.5) // Flip vertical + squash
      if (rot) ctx.rotate(-rot)

      if (imageRef.current && imageLoadedRef.current) {
        // Vẽ reflection của ảnh
        ctx.drawImage(
          imageRef.current,
          -albumSize / 2,
          -albumSize / 2,
          albumSize,
          albumSize
        )
      } else {
        // Placeholder reflection
        ctx.fillStyle = '#1a3a5c'
        ctx.fillRect(-albumSize / 2, -albumSize / 2, albumSize, albumSize)
      }

      ctx.restore()

      // Overlay gradient fade cho reflection
      ctx.save()
      const fadeGrad = ctx.createLinearGradient(tx, reflectionY, tx, reflectionY + reflectionHeight)
      fadeGrad.addColorStop(0, 'transparent')
      fadeGrad.addColorStop(0.5, cfg.colors.background || '#0a1628')
      fadeGrad.addColorStop(1, cfg.colors.background || '#0a1628')
      ctx.fillStyle = fadeGrad
      ctx.fillRect(tx - albumSize, reflectionY, albumSize * 2, reflectionHeight + 20)
      ctx.restore()

      // ========== VẼ WATER LINE (đường nước) ==========
      const waterY = reflectionY - 5
      const waterWidth = w * 0.9

      // Vẽ nhiều đường sóng nước
      for (let line = 0; line < 3; line++) {
        ctx.beginPath()
        const lineY = waterY + line * 8
        const waveAmp = 3 + smoothEnergy * 5
        const waveFreq = 0.02 + line * 0.01
        const wavePhase = now / 1000 * (1 + line * 0.3)

        ctx.moveTo(0, lineY)
        for (let x = 0; x <= w; x += 5) {
          const y = lineY + Math.sin(x * waveFreq + wavePhase) * waveAmp
          ctx.lineTo(x, y)
        }

        ctx.strokeStyle = `${primary}${Math.floor((0.3 - line * 0.08) * 255).toString(16).padStart(2, '0')}`
        ctx.lineWidth = 1.5 - line * 0.3
        ctx.shadowColor = primary
        ctx.shadowBlur = 5
        ctx.stroke()
      }

      // ========== VẼ ALBUM ART CHÍNH ==========
      ctx.save()
      ctx.translate(tx, ty)
      ctx.scale(pulseScale, pulseScale)
      if (rot) ctx.rotate(rot)

      const cornerRadius = albumSize * 0.05

      // Outer glow
      ctx.shadowColor = primary
      ctx.shadowBlur = 30 + smoothBass * 40
      ctx.fillStyle = 'transparent'
      ctx.beginPath()
      ctx.roundRect(-albumSize / 2 - 3, -albumSize / 2 - 3, albumSize + 6, albumSize + 6, cornerRadius + 3)
      ctx.fill()

      // Border glow
      ctx.beginPath()
      ctx.roundRect(-albumSize / 2 - 2, -albumSize / 2 - 2, albumSize + 4, albumSize + 4, cornerRadius + 2)
      const borderGrad = ctx.createLinearGradient(-albumSize / 2, -albumSize / 2, albumSize / 2, albumSize / 2)
      borderGrad.addColorStop(0, primary)
      borderGrad.addColorStop(0.5, secondary)
      borderGrad.addColorStop(1, primary)
      ctx.strokeStyle = borderGrad
      ctx.lineWidth = 3 + smoothBass * 2
      ctx.shadowBlur = 20 + smoothBass * 30
      ctx.stroke()

      // Clip rounded rect
      ctx.beginPath()
      ctx.roundRect(-albumSize / 2, -albumSize / 2, albumSize, albumSize, cornerRadius)
      ctx.clip()

      if (imageRef.current && imageLoadedRef.current) {
        // Vẽ album art
        ctx.drawImage(
          imageRef.current,
          -albumSize / 2,
          -albumSize / 2,
          albumSize,
          albumSize
        )
      } else {
        // Placeholder
        ctx.fillStyle = '#1a3a5c'
        ctx.fillRect(-albumSize / 2, -albumSize / 2, albumSize, albumSize)
        
        // Placeholder icon
        ctx.fillStyle = primary + '60'
        ctx.font = `${albumSize * 0.3}px Arial`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('♪', 0, 0)
      }

      // Inner highlight
      ctx.beginPath()
      ctx.roundRect(-albumSize / 2, -albumSize / 2, albumSize, albumSize, cornerRadius)
      ctx.strokeStyle = `rgba(255,255,255,${0.1 + smoothBass * 0.2})`
      ctx.lineWidth = 2
      ctx.shadowBlur = 0
      ctx.stroke()

      ctx.restore()

      // ========== VẼ PARTICLES xung quanh (optional) ==========
      const particleCount = 12
      const particleOrbitRadius = albumSize * 0.7 * pulseScale
      const particlePhase = now / 2000

      for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * Math.PI * 2 + particlePhase
        const specIdx = Math.floor((i / particleCount) * arr.length)
        const intensity = arr[specIdx] / 255

        const orbitRadius = particleOrbitRadius * (0.9 + intensity * 0.2)
        const px = tx + Math.cos(angle) * orbitRadius
        const py = ty + Math.sin(angle) * orbitRadius * 0.6 // Ellipse for perspective

        const particleSize = 2 + intensity * 4

        ctx.beginPath()
        ctx.arc(px, py, particleSize, 0, Math.PI * 2)
        ctx.fillStyle = i % 2 === 0 ? primary : secondary
        ctx.shadowColor = i % 2 === 0 ? primary : secondary
        ctx.shadowBlur = 10 + intensity * 15
        ctx.globalAlpha = 0.4 + intensity * 0.6
        ctx.fill()
      }

      ctx.restore()
      rafRef.current = requestAnimationFrame(draw)
    }

    const startAnimation = () => {
      if (canvas.width > 0 && canvas.height > 0) {
        rafRef.current = requestAnimationFrame(draw)
      } else {
        setTimeout(startAnimation, 100)
      }
    }
    startAnimation()

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      releaseAudioContext()
    }
  }, [audioRef, configRef, isPlaying, transform, albumArtSrc])

  useEffect(() => {
    if (isPlaying && audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {})
    }
  }, [isPlaying])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}

2. DNAHelixVisualizer.tsx
typescriptimport { useEffect, useRef } from 'react'
import { BaseVisualizerProps } from '../types'
import type { LayerTransform } from '../config/ProjectConfig'
import { createAnalyser, getFrequencyData, releaseAudioContext, sharedAudioContext } from '../AudioAnalyzer'
import { useCanvasResize } from '../useCanvasResize'

type Props = BaseVisualizerProps & { transform?: LayerTransform }

export default function DNAHelixVisualizer({ audioRef, configRef, isPlaying, transform }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>()
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataRef = useRef<Uint8Array | null>(null)
  const timeRef = useRef<number>(0)

  useCanvasResize(canvasRef)

  useEffect(() => {
    const canvas = canvasRef.current
    const audio = audioRef.current
    if (!canvas || !audio) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    try {
      const { analyser, dataArray } = createAnalyser(null, audio, 256, 0.7)
      audioContextRef.current = sharedAudioContext
      analyserRef.current = analyser
      dataRef.current = dataArray
    } catch (e) {
      console.error('[DNAHelixVisualizer] audio init failed', e)
    }

    const draw = () => {
      const now = performance.now()
      timeRef.current = now

      const parent = canvas.parentElement
      if (parent) {
        const newWidth = parent.clientWidth || 640
        const newHeight = parent.clientHeight || 360
        if (canvas.width !== newWidth || canvas.height !== newHeight) {
          canvas.width = newWidth
          canvas.height = newHeight
        }
      }

      const w = canvas.width || 640
      const h = canvas.height || 360
      const cfg = configRef.current

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = cfg.colors.background || '#000'
      ctx.fillRect(0, 0, w, h)

      // Lấy FFT data
      let arr: Uint8Array
      if (isPlaying && analyserRef.current && dataRef.current) {
        arr = getFrequencyData(analyserRef.current, dataRef.current)
      } else {
        arr = new Uint8Array(128)
        const phase = (now / 1000) * 2.2
        for (let i = 0; i < 128; i++) {
          const wave = Math.sin((i / 128) * Math.PI * 6 + phase) * 0.5 + 0.5
          arr[i] = Math.floor(80 + 80 * wave)
        }
      }

      // Tính bass
      const bassBins = Math.max(4, Math.floor(arr.length * 0.12))
      let bass = 0
      for (let i = 0; i < bassBins; i++) bass += arr[i]
      bass = bass / bassBins / 255

      // Transform
      const tx = transform?.position ? (transform.position.x / 100) * w : w * 0.5
      const ty = transform?.position ? (transform.position.y / 100) * h : h * 0.5
      const sx = transform?.scale?.x ?? 1
      const sy = transform?.scale?.y ?? 1
      const rot = (transform?.rotation ?? 0) * (Math.PI / 180)
      const alpha = typeof transform?.opacity === 'number' ? transform.opacity : 1

      const primary = cfg.colors.primary || '#00ffcc'
      const secondary = cfg.colors.secondary || '#ff00aa'
      const sensitivity = cfg.sensitivity || 1

      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(tx, ty)
      ctx.rotate(rot)
      ctx.scale(sx, sy)

      const points = 60
      const helixWidth = w * 0.8
      const helixHeight = h * 0.3 * sensitivity
      const timeOffset = now / 1000

      // Vẽ 2 strand của DNA
      for (let strand = 0; strand < 2; strand++) {
        const phaseOffset = strand * Math.PI

        ctx.beginPath()
        ctx.shadowColor = strand === 0 ? primary : secondary
        ctx.shadowBlur = 25 + bass * 20
        ctx.strokeStyle = strand === 0 ? primary : secondary
        ctx.lineWidth = 3 + bass * 2

        for (let i = 0; i <= points; i++) {
          const t = i / points
          const x = (t - 0.5) * helixWidth
          
          // Lấy spectrum value cho điểm này
          const specIdx = Math.floor(t * (arr.length - 1))
          const specValue = arr[specIdx] / 255
          
          // Tính y với xoắn + audio reactive
          const twist = Math.sin(t * Math.PI * 4 + timeOffset * 2 + phaseOffset)
          const y = twist * helixHeight * (0.5 + specValue * 0.5)

          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }

      // Vẽ các thanh nối giữa 2 strand (base pairs)
      const barCount = 20
      for (let i = 0; i < barCount; i++) {
        const t = (i + 0.5) / barCount
        const x = (t - 0.5) * helixWidth
        
        const specIdx = Math.floor(t * (arr.length - 1))
        const specValue = arr[specIdx] / 255
        
        const twist1 = Math.sin(t * Math.PI * 4 + timeOffset * 2)
        const twist2 = Math.sin(t * Math.PI * 4 + timeOffset * 2 + Math.PI)
        
        const y1 = twist1 * helixHeight * (0.5 + specValue * 0.5)
        const y2 = twist2 * helixHeight * (0.5 + specValue * 0.5)

        // Gradient cho base pair
        const grad = ctx.createLinearGradient(x, y1, x, y2)
        grad.addColorStop(0, primary)
        grad.addColorStop(0.5, '#ffffff')
        grad.addColorStop(1, secondary)

        ctx.beginPath()
        ctx.strokeStyle = grad
        ctx.lineWidth = 2 + specValue * 3
        ctx.shadowBlur = 10 + specValue * 15
        ctx.shadowColor = '#ffffff'
        ctx.moveTo(x, y1)
        ctx.lineTo(x, y2)
        ctx.stroke()

        // Dots ở 2 đầu
        const dotRadius = 3 + specValue * 4
        
        ctx.beginPath()
        ctx.fillStyle = primary
        ctx.shadowColor = primary
        ctx.shadowBlur = 15
        ctx.arc(x, y1, dotRadius, 0, Math.PI * 2)
        ctx.fill()

        ctx.beginPath()
        ctx.fillStyle = secondary
        ctx.shadowColor = secondary
        ctx.arc(x, y2, dotRadius, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.restore()
      rafRef.current = requestAnimationFrame(draw)
    }

    const startAnimation = () => {
      if (canvas.width > 0 && canvas.height > 0) {
        rafRef.current = requestAnimationFrame(draw)
      } else {
        setTimeout(startAnimation, 100)
      }
    }
    startAnimation()

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      releaseAudioContext()
    }
  }, [audioRef, configRef, isPlaying, transform])

  useEffect(() => {
    if (isPlaying && audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {})
    }
  }, [isPlaying])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}

3. CircularBarsVisualizer.tsx
typescriptimport { useEffect, useRef } from 'react'
import { BaseVisualizerProps } from '../types'
import type { LayerTransform } from '../config/ProjectConfig'
import { createAnalyser, getFrequencyData, releaseAudioContext, sharedAudioContext } from '../AudioAnalyzer'
import { useCanvasResize } from '../useCanvasResize'

type Props = BaseVisualizerProps & { transform?: LayerTransform }

export default function CircularBarsVisualizer({ audioRef, configRef, isPlaying, transform }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>()
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataRef = useRef<Uint8Array | null>(null)
  const smoothRef = useRef<Float32Array | null>(null)

  useCanvasResize(canvasRef)

  useEffect(() => {
    const canvas = canvasRef.current
    const audio = audioRef.current
    if (!canvas || !audio) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const barCount = 64

    try {
      const { analyser, dataArray } = createAnalyser(null, audio, 256, 0.75)
      audioContextRef.current = sharedAudioContext
      analyserRef.current = analyser
      dataRef.current = dataArray
      smoothRef.current = new Float32Array(barCount)
    } catch (e) {
      console.error('[CircularBarsVisualizer] audio init failed', e)
    }

    const draw = () => {
      const now = performance.now()

      const parent = canvas.parentElement
      if (parent) {
        const newWidth = parent.clientWidth || 640
        const newHeight = parent.clientHeight || 360
        if (canvas.width !== newWidth || canvas.height !== newHeight) {
          canvas.width = newWidth
          canvas.height = newHeight
        }
      }

      const w = canvas.width || 640
      const h = canvas.height || 360
      const cfg = configRef.current

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = cfg.colors.background || '#000'
      ctx.fillRect(0, 0, w, h)

      // Lấy FFT data
      let arr: Uint8Array
      if (isPlaying && analyserRef.current && dataRef.current) {
        arr = getFrequencyData(analyserRef.current, dataRef.current)
      } else {
        arr = new Uint8Array(128)
        const phase = (now / 1000) * 2.5
        for (let i = 0; i < 128; i++) {
          const wave = Math.sin((i / 128) * Math.PI * 8 + phase) * 0.4 + 0.5
          arr[i] = Math.floor(wave * 200)
        }
      }

      // Tính bass cho pulse
      const bassBins = Math.max(4, Math.floor(arr.length * 0.1))
      let bass = 0
      for (let i = 0; i < bassBins; i++) bass += arr[i]
      bass = bass / bassBins / 255

      // Smoothing
      if (!smoothRef.current) smoothRef.current = new Float32Array(barCount)
      const smoothRate = 0.25
      for (let i = 0; i < barCount; i++) {
        const specIdx = Math.floor((i / barCount) * arr.length)
        const v = arr[specIdx] / 255
        smoothRef.current[i] += (v - smoothRef.current[i]) * smoothRate
      }

      // Transform
      const tx = transform?.position ? (transform.position.x / 100) * w : w * 0.5
      const ty = transform?.position ? (transform.position.y / 100) * h : h * 0.5
      const sx = transform?.scale?.x ?? 1
      const sy = transform?.scale?.y ?? 1
      const rot = (transform?.rotation ?? 0) * (Math.PI / 180)
      const alpha = typeof transform?.opacity === 'number' ? transform.opacity : 1

      const primary = cfg.colors.primary || '#00d4ff'
      const secondary = cfg.colors.secondary || '#ff0080'
      const sensitivity = cfg.sensitivity || 1

      const minDim = Math.min(w, h)
      const baseRadius = minDim * 0.15
      const maxBarHeight = minDim * 0.25 * sensitivity
      const barWidth = (Math.PI * 2 * baseRadius) / barCount * 0.6
      const pulse = 1 + bass * 0.1

      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(tx, ty)
      ctx.rotate(rot)
      ctx.scale(sx * pulse, sy * pulse)

      // Vẽ bars
      for (let i = 0; i < barCount; i++) {
        const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2
        const value = smoothRef.current[i]
        const barHeight = value * maxBarHeight

        const x1 = Math.cos(angle) * baseRadius
        const y1 = Math.sin(angle) * baseRadius
        const x2 = Math.cos(angle) * (baseRadius + barHeight)
        const y2 = Math.sin(angle) * (baseRadius + barHeight)

        // Gradient màu theo vị trí + intensity
        const hue = (i / barCount) * 60 + 180 // cyan -> magenta range
        const saturation = 80 + value * 20
        const lightness = 50 + value * 30

        // Outer glow
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.strokeStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, 0.3)`
        ctx.lineWidth = barWidth + 4
        ctx.lineCap = 'round'
        ctx.shadowColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`
        ctx.shadowBlur = 15 + value * 20
        ctx.stroke()

        // Main bar
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.strokeStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`
        ctx.lineWidth = barWidth
        ctx.shadowBlur = 8 + value * 10
        ctx.stroke()

        // Inner highlight
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.strokeStyle = `hsla(${hue}, 100%, 80%, ${0.5 + value * 0.5})`
        ctx.lineWidth = barWidth * 0.4
        ctx.shadowBlur = 5
        ctx.stroke()
      }

      // Center circle glow
      ctx.beginPath()
      ctx.arc(0, 0, baseRadius * 0.3, 0, Math.PI * 2)
      ctx.fillStyle = primary + '40'
      ctx.shadowColor = primary
      ctx.shadowBlur = 30 + bass * 30
      ctx.fill()

      ctx.restore()
      rafRef.current = requestAnimationFrame(draw)
    }

    const startAnimation = () => {
      if (canvas.width > 0 && canvas.height > 0) {
        rafRef.current = requestAnimationFrame(draw)
      } else {
        setTimeout(startAnimation, 100)
      }
    }
    startAnimation()

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      releaseAudioContext()
    }
  }, [audioRef, configRef, isPlaying, transform])

  useEffect(() => {
    if (isPlaying && audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {})
    }
  }, [isPlaying])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}

4. ParticleWaveVisualizer.tsx
typescriptimport { useEffect, useRef } from 'react'
import { BaseVisualizerProps } from '../types'
import type { LayerTransform } from '../config/ProjectConfig'
import { createAnalyser, getFrequencyData, releaseAudioContext, sharedAudioContext } from '../AudioAnalyzer'
import { useCanvasResize } from '../useCanvasResize'

type Props = BaseVisualizerProps & { transform?: LayerTransform }

interface Particle {
  x: number
  y: number
  baseY: number
  size: number
  speed: number
  hue: number
  phase: number
}

export default function ParticleWaveVisualizer({ audioRef, configRef, isPlaying, transform }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>()
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataRef = useRef<Uint8Array | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const timeRef = useRef<number>(0)

  useCanvasResize(canvasRef)

  useEffect(() => {
    const canvas = canvasRef.current
    const audio = audioRef.current
    if (!canvas || !audio) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    try {
      const { analyser, dataArray } = createAnalyser(null, audio, 256, 0.7)
      audioContextRef.current = sharedAudioContext
      analyserRef.current = analyser
      dataRef.current = dataArray
    } catch (e) {
      console.error('[ParticleWaveVisualizer] audio init failed', e)
    }

    // Khởi tạo particles
    const initParticles = (w: number, h: number) => {
      const count = 80
      particlesRef.current = []
      for (let i = 0; i < count; i++) {
        particlesRef.current.push({
          x: (i / count) * w,
          y: h * 0.5,
          baseY: h * 0.5,
          size: 3 + Math.random() * 4,
          speed: 0.5 + Math.random() * 1.5,
          hue: (i / count) * 60 + 180,
          phase: Math.random() * Math.PI * 2
        })
      }
    }

    const draw = () => {
      const now = performance.now()
      const dt = timeRef.current ? (now - timeRef.current) / 1000 : 0
      timeRef.current = now

      const parent = canvas.parentElement
      if (parent) {
        const newWidth = parent.clientWidth || 640
        const newHeight = parent.clientHeight || 360
        if (canvas.width !== newWidth || canvas.height !== newHeight) {
          canvas.width = newWidth
          canvas.height = newHeight
          initParticles(newWidth, newHeight)
        }
      }

      const w = canvas.width || 640
      const h = canvas.height || 360
      const cfg = configRef.current

      if (particlesRef.current.length === 0) {
        initParticles(w, h)
      }

      // Semi-transparent clear for trail effect
      ctx.fillStyle = (cfg.colors.background || '#000') + 'e0'
      ctx.fillRect(0, 0, w, h)

      // Lấy FFT data
      let arr: Uint8Array
      if (isPlaying && analyserRef.current && dataRef.current) {
        arr = getFrequencyData(analyserRef.current, dataRef.current)
      } else {
        arr = new Uint8Array(128)
        const phase = (now / 1000) * 2
        for (let i = 0; i < 128; i++) {
          const wave = Math.sin((i / 128) * Math.PI * 4 + phase) * 0.4 + 0.5
          arr[i] = Math.floor(wave * 180)
        }
      }

      // Tính bass và mid
      let bass = 0, mid = 0
      const bassEnd = Math.floor(arr.length * 0.15)
      const midEnd = Math.floor(arr.length * 0.5)
      for (let i = 0; i < bassEnd; i++) bass += arr[i]
      for (let i = bassEnd; i < midEnd; i++) mid += arr[i]
      bass = bass / bassEnd / 255
      mid = mid / (midEnd - bassEnd) / 255

      // Transform
      const tx = transform?.position ? (transform.position.x / 100) * w : w * 0.5
      const ty = transform?.position ? (transform.position.y / 100) * h : h * 0.5
      const sx = transform?.scale?.x ?? 1
      const sy = transform?.scale?.y ?? 1
      const rot = (transform?.rotation ?? 0) * (Math.PI / 180)
      const alpha = typeof transform?.opacity === 'number' ? transform.opacity : 1

      const primary = cfg.colors.primary || '#00ffff'
      const secondary = cfg.colors.secondary || '#ff00ff'
      const sensitivity = cfg.sensitivity || 1

      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(tx, ty)
      ctx.rotate(rot)
      ctx.scale(sx, sy)
      ctx.translate(-tx, -ty)

      const particles = particlesRef.current
      const waveAmp = h * 0.2 * sensitivity

      // Update và vẽ particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        const normalizedX = p.x / w
        const specIdx = Math.floor(normalizedX * (arr.length - 1))
        const specValue = arr[specIdx] / 255

        // Wave movement
        p.phase += p.speed * dt * (1 + bass * 2)
        const waveOffset = Math.sin(normalizedX * Math.PI * 3 + now / 500) * waveAmp * specValue
        p.y = p.baseY + waveOffset

        // Size pulse với bass
        const currentSize = p.size * (1 + bass * 1.5 + specValue * 0.5)

        // Color
        const hue = p.hue + specValue * 30
        const saturation = 80 + specValue * 20
        const lightness = 50 + specValue * 30

        // Glow
        ctx.beginPath()
        ctx.arc(p.x, p.y, currentSize * 2, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, 0.2)`
        ctx.shadowColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`
        ctx.shadowBlur = 20 + specValue * 30
        ctx.fill()

        // Main particle
        ctx.beginPath()
        ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2)
        ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`
        ctx.shadowBlur = 10 + specValue * 15
        ctx.fill()

        // Core highlight
        ctx.beginPath()
        ctx.arc(p.x, p.y, currentSize * 0.4, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${hue}, 100%, 90%, ${0.6 + specValue * 0.4})`
        ctx.shadowBlur = 5
        ctx.fill()
      }

      // Vẽ connecting lines giữa các particles gần nhau
      ctx.strokeStyle = primary + '30'
      ctx.lineWidth = 1
      ctx.shadowBlur = 0
      for (let i = 0; i < particles.length - 1; i++) {
        const p1 = particles[i]
        const p2 = particles[i + 1]
        const dist = Math.abs(p1.y - p2.y)
        
        if (dist < 50) {
          const alpha = 1 - dist / 50
          ctx.beginPath()
          ctx.strokeStyle = `${primary}${Math.floor(alpha * 40).toString(16).padStart(2, '0')}`
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.stroke()
        }
      }

      ctx.restore()
      rafRef.current = requestAnimationFrame(draw)
    }

    const startAnimation = () => {
      if (canvas.width > 0 && canvas.height > 0) {
        initParticles(canvas.width, canvas.height)
        rafRef.current = requestAnimationFrame(draw)
      } else {
        setTimeout(startAnimation, 100)
      }
    }
    startAnimation()

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      releaseAudioContext()
    }
  }, [audioRef, configRef, isPlaying, transform])

  useEffect(() => {
    if (isPlaying && audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {})
    }
  }, [isPlaying])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}

5. SpectrumMountainVisualizer.tsx
typescriptimport { useEffect, useRef } from 'react'
import { BaseVisualizerProps } from '../types'
import type { LayerTransform } from '../config/ProjectConfig'
import { createAnalyser, getFrequencyData, releaseAudioContext, sharedAudioContext } from '../AudioAnalyzer'
import { useCanvasResize } from '../useCanvasResize'

type Props = BaseVisualizerProps & { transform?: LayerTransform }

export default function SpectrumMountainVisualizer({ audioRef, configRef, isPlaying, transform }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>()
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataRef = useRef<Uint8Array | null>(null)
  const smoothRef = useRef<Float32Array | null>(null)

  useCanvasResize(canvasRef)

  useEffect(() => {
    const canvas = canvasRef.current
    const audio = audioRef.current
    if (!canvas || !audio) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const barCount = 128

    try {
      const { analyser, dataArray } = createAnalyser(null, audio, 512, 0.8)
      audioContextRef.current = sharedAudioContext
      analyserRef.current = analyser
      dataRef.current = dataArray
      smoothRef.current = new Float32Array(barCount)
    } catch (e) {
      console.error('[SpectrumMountainVisualizer] audio init failed', e)
    }

    const draw = () => {
      const now = performance.now()

      const parent = canvas.parentElement
      if (parent) {
        const newWidth = parent.clientWidth || 640
        const newHeight = parent.clientHeight || 360
        if (canvas.width !== newWidth || canvas.height !== newHeight) {
          canvas.width = newWidth
          canvas.height = newHeight
        }
      }

      const w = canvas.width || 640
      const h = canvas.height || 360
      const cfg = configRef.current

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = cfg.colors.background || '#000'
      ctx.fillRect(0, 0, w, h)

      // Lấy FFT data
      let arr: Uint8Array
      if (isPlaying && analyserRef.current && dataRef.current) {
        arr = getFrequencyData(analyserRef.current, dataRef.current)
      } else {
        arr = new Uint8Array(256)
        const phase = (now / 1000) * 1.5
        for (let i = 0; i < 256; i++) {
          const wave1 = Math.sin((i / 256) * Math.PI * 6 + phase) * 0.3
          const wave2 = Math.sin((i / 256) * Math.PI * 10 + phase * 1.3) * 0.2
          arr[i] = Math.floor((0.4 + wave1 + wave2) * 200)
        }
      }

      // Smoothing
      if (!smoothRef.current) smoothRef.current = new Float32Array(barCount)
      const smoothRate = 0.2
      for (let i = 0; i < barCount; i++) {
        const specIdx = Math.floor((i / barCount) * arr.length)
        const v = arr[specIdx] / 255
        smoothRef.current[i] += (v - smoothRef.current[i]) * smoothRate
      }

      // Transform
      const tx = transform?.position ? (transform.position.x / 100) * w : w * 0.5
      const ty = transform?.position ? (transform.position.y / 100) * h : h * 0.85
      const sx = transform?.scale?.x ?? 1
      const sy = transform?.scale?.y ?? 1
      const rot = (transform?.rotation ?? 0) * (Math.PI / 180)
      const alpha = typeof transform?.opacity === 'number' ? transform.opacity : 1

      const primary = cfg.colors.primary || '#00d4ff'
      const secondary = cfg.colors.secondary || '#a855f7'
      const sensitivity = cfg.sensitivity || 1

      const maxHeight = h * 0.6 * sensitivity
      const baseY = ty

      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(tx, ty)
      ctx.rotate(rot)
      ctx.scale(sx, sy)
      ctx.translate(-tx, -ty)

      // Vẽ 3 layers với độ cao và màu khác nhau
      const layers = [
        { heightMult: 0.6, color: secondary + '40', blur: 30, offset: 0 },
        { heightMult: 0.8, color: secondary + '80', blur: 20, offset: 0 },
        { heightMult: 1.0, color: primary, blur: 15, offset: 0 },
      ]

      layers.forEach((layer, layerIdx) => {
        ctx.beginPath()
        ctx.moveTo(0, baseY)

        // Vẽ đường cong smooth qua các điểm
        for (let i = 0; i <= barCount; i++) {
          const x = (i / barCount) * w
          const idx = Math.min(i, barCount - 1)
          const value = smoothRef.current[idx]
          const height = value * maxHeight * layer.heightMult
          const y = baseY - height

          if (i === 0) {
            ctx.lineTo(x, y)
          } else {
            // Bezier curve cho smooth
            const prevX = ((i - 1) / barCount) * w
            const prevIdx = Math.max(0, idx - 1)
            const prevValue = smoothRef.current[prevIdx]
            const prevHeight = prevValue * maxHeight * layer.heightMult
            const prevY = baseY - prevHeight

            const cpX = (prevX + x) / 2
            ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2)
          }
        }

        ctx.lineTo(w, baseY)
        ctx.closePath()

        // Fill gradient
        const grad = ctx.createLinearGradient(0, baseY - maxHeight, 0, baseY)
        if (layerIdx === layers.length - 1) {
          grad.addColorStop(0, primary)
          grad.addColorStop(0.5, secondary)
          grad.addColorStop(1, secondary + '20')
        } else {
          grad.addColorStop(0, layer.color)
          grad.addColorStop(1, 'transparent')
        }

        ctx.fillStyle = grad
        ctx.shadowColor = layerIdx === layers.length - 1 ? primary : secondary
        ctx.shadowBlur = layer.blur
        ctx.fill()
      })

      // Top glow line
      ctx.beginPath()
      for (let i = 0; i <= barCount; i++) {
        const x = (i / barCount) * w
        const idx = Math.min(i, barCount - 1)
        const value = smoothRef.current[idx]
        const height = value * maxHeight
        const y = baseY - height

        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          const prevX = ((i - 1) / barCount) * w
          const prevIdx = Math.max(0, idx - 1)
          const prevValue = smoothRef.current[prevIdx]
          const prevHeight = prevValue * maxHeight
          const prevY = baseY - prevHeight

          const cpX = (prevX + x) / 2
          ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2)
        }
      }

      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.shadowColor = '#ffffff'
      ctx.shadowBlur = 15
      ctx.stroke()

      // Reflection (mirror)
      ctx.save()
      ctx.globalAlpha = 0.2
      ctx.scale(1, -0.3)
      ctx.translate(0, -baseY * 2 - baseY * 0.3)

      ctx.beginPath()
      ctx.moveTo(0, baseY)
      for (let i = 0; i <= barCount; i++) {
        const x = (i / barCount) * w
        const idx = Math.min(i, barCount - 1)
        const value = smoothRef.current[idx]
        const height = value * maxHeight
        const y = baseY - height

        if (i === 0) {
          ctx.lineTo(x, y)
        } else {
          const prevX = ((i - 1) / barCount) * w
          const prevIdx = Math.max(0, idx - 1)
          const prevValue = smoothRef.current[prevIdx]
          const prevHeight = prevValue * maxHeight
          const prevY = baseY - prevHeight

          const cpX = (prevX + x) / 2
          ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2)
        }
      }
      ctx.lineTo(w, baseY)
      ctx.closePath()

      const reflectGrad = ctx.createLinearGradient(0, baseY - maxHeight, 0, baseY)
      reflectGrad.addColorStop(0, primary + '60')
      reflectGrad.addColorStop(1, 'transparent')
      ctx.fillStyle = reflectGrad
      ctx.shadowBlur = 0
      ctx.fill()
      ctx.restore()

      ctx.restore()
      rafRef.current = requestAnimationFrame(draw)
    }

    const startAnimation = () => {
      if (canvas.width > 0 && canvas.height > 0) {
        rafRef.current = requestAnimationFrame(draw)
      } else {
        setTimeout(startAnimation, 100)
      }
    }
    startAnimation()

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      releaseAudioContext()
    }
  }, [audioRef, configRef, isPlaying, transform])

  useEffect(() => {
    if (isPlaying && audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {})
    }
  }, [isPlaying])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}

6. NeonPulseRingVisualizer.tsx
typescriptimport { useEffect, useRef } from 'react'
import { BaseVisualizerProps } from '../types'
import type { LayerTransform } from '../config/ProjectConfig'
import { createAnalyser, getFrequencyData, releaseAudioContext, sharedAudioContext } from '../AudioAnalyzer'
import { useCanvasResize } from '../useCanvasResize'

type Props = BaseVisualizerProps & { transform?: LayerTransform }

export default function NeonPulseRingVisualizer({ audioRef, configRef, isPlaying, transform }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>()
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataRef = useRef<Uint8Array | null>(null)
  const smoothBassRef = useRef<number>(0)
  const ringPhasesRef = useRef<number[]>([0, 0, 0])

  useCanvasResize(canvasRef)

  useEffect(() => {
    const canvas = canvasRef.current
    const audio = audioRef.current
    if (!canvas || !audio) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    try {
      const { analyser, dataArray } = createAnalyser(null, audio, 256, 0.75)
      audioContextRef.current = sharedAudioContext
      analyserRef.current = analyser
      dataRef.current = dataArray
    } catch (e) {
      console.error('[NeonPulseRingVisualizer] audio init failed', e)
    }

    const draw = () => {
      const now = performance.now()

      const parent = canvas.parentElement
      if (parent) {
        const newWidth = parent.clientWidth || 640
        const newHeight = parent.clientHeight || 360
        if (canvas.width !== newWidth || canvas.height !== newHeight) {
          canvas.width = newWidth
          canvas.height = newHeight
        }
      }

      const w = canvas.width || 640
      const h = canvas.height || 360
      const cfg = configRef.current

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = cfg.colors.background || '#000'
      ctx.fillRect(0, 0, w, h)

      // Lấy FFT data
      let arr: Uint8Array
      if (isPlaying && analyserRef.current && dataRef.current) {
        arr = getFrequencyData(analyserRef.current, dataRef.current)
      } else {
        arr = new Uint8Array(128)
        const phase = (now / 1000) * 2
        for (let i = 0; i < 128; i++) {
          const wave = Math.sin((i / 128) * Math.PI * 4 + phase) * 0.4 + 0.5
          arr[i] = Math.floor(wave * 200)
        }
      }

      // Tính bass, mid, treble
      let bass = 0, mid = 0, treble = 0
      const bassEnd = Math.floor(arr.length * 0.15)
      const midEnd = Math.floor(arr.length * 0.5)
      
      for (let i = 0; i < bassEnd; i++) bass += arr[i]
      for (let i = bassEnd; i < midEnd; i++) mid += arr[i]
      for (let i = midEnd; i < arr.length; i++) treble += arr[i]
      
      bass = bass / bassEnd / 255
      mid = mid / (midEnd - bassEnd) / 255
      treble = treble / (arr.length - midEnd) / 255

      // Smooth bass cho pulse
      smoothBassRef.current += (bass - smoothBassRef.current) * 0.3

      // Transform
      const tx = transform?.position ? (transform.position.x / 100) * w : w * 0.5
      const ty = transform?.position ? (transform.position.y / 100) * h : h * 0.5
      const sx = transform?.scale?.x ?? 1
      const sy = transform?.scale?.y ?? 1
      const rot = (transform?.rotation ?? 0) * (Math.PI / 180)
      const alpha = typeof transform?.opacity === 'number' ? transform.opacity : 1

      const primary = cfg.colors.primary || '#ff0080'
      const secondary = cfg.colors.secondary || '#00ffff'
      const sensitivity = cfg.sensitivity || 1

      const minDim = Math.min(w, h)
      const smoothBass = smoothBassRef.current

      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(tx, ty)
      ctx.rotate(rot)
      ctx.scale(sx, sy)

      // 3 rings với tần số khác nhau
      const rings = [
        { radius: minDim * 0.12, width: 4, color: primary, freq: bass, speed: 1.2, segments: 60 },
        { radius: minDim * 0.18, width: 3, color: secondary, freq: mid, speed: -0.8, segments: 80 },
        { radius: minDim * 0.24, width: 2, color: primary, freq: treble, speed: 1.5, segments: 100 },
      ]

      rings.forEach((ring, ringIdx) => {
        ringPhasesRef.current[ringIdx] += ring.speed * 0.02 * (1 + ring.freq)
        const phase = ringPhasesRef.current[ringIdx]

        const pulse = 1 + ring.freq * 0.3 * sensitivity
        const currentRadius = ring.radius * pulse

        // Outer glow
        ctx.beginPath()
        ctx.arc(0, 0, currentRadius, 0, Math.PI * 2)
        ctx.strokeStyle = ring.color + '30'
        ctx.lineWidth = ring.width + 8
        ctx.shadowColor = ring.color
        ctx.shadowBlur = 30 + ring.freq * 30
        ctx.stroke()

        // Segmented ring với gaps
        const gapAngle = 0.05
        const segmentAngle = (Math.PI * 2) / ring.segments

        for (let i = 0; i < ring.segments; i++) {
          const startAngle = i * segmentAngle + phase
          const endAngle = startAngle + segmentAngle - gapAngle

          // Intensity variation theo spectrum
          const specIdx = Math.floor((i / ring.segments) * arr.length)
          const intensity = arr[specIdx] / 255

          ctx.beginPath()
          ctx.arc(0, 0, currentRadius, startAngle, endAngle)
          
          // Gradient màu theo intensity
          const hue = ringIdx === 1 ? 180 : 330 // cyan vs magenta
          const lightness = 50 + intensity * 40
          ctx.strokeStyle = `hsl(${hue}, 100%, ${lightness}%)`
          ctx.lineWidth = ring.width + intensity * 3
          ctx.shadowBlur = 15 + intensity * 25
          ctx.stroke()
        }

        // Inner ring highlight
        ctx.beginPath()
        ctx.arc(0, 0, currentRadius, 0, Math.PI * 2)
        ctx.strokeStyle = '#ffffff40'
        ctx.lineWidth = 1
        ctx.shadowBlur = 5
        ctx.stroke()
      })

      // Center pulse
      const centerPulse = minDim * 0.06 * (1 + smoothBass * 0.5)
      
      // Outer glow
      ctx.beginPath()
      ctx.arc(0, 0, centerPulse * 1.5, 0, Math.PI * 2)
      const centerGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, centerPulse * 1.5)
      centerGrad.addColorStop(0, primary + '80')
      centerGrad.addColorStop(0.5, secondary + '40')
      centerGrad.addColorStop(1, 'transparent')
      ctx.fillStyle = centerGrad
      ctx.shadowColor = primary
      ctx.shadowBlur = 40 + smoothBass * 40
      ctx.fill()

      // Core
      ctx.beginPath()
      ctx.arc(0, 0, centerPulse * 0.5, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = '#ffffff'
      ctx.shadowBlur = 20
      ctx.fill()

      // Rotating dots around center
      const dotCount = 8
      const dotRadius = minDim * 0.08 * (1 + smoothBass * 0.2)
      const dotPhase = now / 1000

      for (let i = 0; i < dotCount; i++) {
        const angle = (i / dotCount) * Math.PI * 2 + dotPhase
        const x = Math.cos(angle) * dotRadius
        const y = Math.sin(angle) * dotRadius
        
        const specIdx = Math.floor((i / dotCount) * arr.length)
        const intensity = arr[specIdx] / 255
        const dotSize = 2 + intensity * 4

        ctx.beginPath()
        ctx.arc(x, y, dotSize, 0, Math.PI * 2)
        ctx.fillStyle = i % 2 === 0 ? primary : secondary
        ctx.shadowColor = i % 2 === 0 ? primary : secondary
        ctx.shadowBlur = 10 + intensity * 15
        ctx.fill()
      }

      ctx.restore()
      rafRef.current = requestAnimationFrame(draw)
    }

    const startAnimation = () => {
      if (canvas.width > 0 && canvas.height > 0) {
        rafRef.current = requestAnimationFrame(draw)
      } else {
        setTimeout(startAnimation, 100)
      }
    }
    startAnimation()

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      releaseAudioContext()
    }
  }, [audioRef, configRef, isPlaying, transform])

  useEffect(() => {
    if (isPlaying && audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {})
    }
  }, [isPlaying])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}

7. Oscilloscope3DVisualizer.tsx
typescriptimport { useEffect, useRef } from 'react'
import { BaseVisualizerProps } from '../types'
import type { LayerTransform } from '../config/ProjectConfig'
import { createAnalyser, getTimeDomainData, releaseAudioContext, sharedAudioContext } from '../AudioAnalyzer'
import { useCanvasResize } from '../useCanvasResize'

type Props = BaseVisualizerProps & { transform?: LayerTransform }

export default function Oscilloscope3DVisualizer({ audioRef, configRef, isPlaying, transform }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>()
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataRef = useRef<Uint8Array | null>(null)
  const historyRef = useRef<Float32Array[]>([])
  const rotationRef = useRef<number>(0)

  useCanvasResize(canvasRef)

  useEffect(() => {
    const canvas = canvasRef.current
    const audio = audioRef.current
    if (!canvas || !audio) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const historyLength = 30
    const sampleCount = 128

    try {
      const { analyser, dataArray } = createAnalyser(null, audio, 1024, 0.5)
      audioContextRef.current = sharedAudioContext
      analyserRef.current = analyser
      dataRef.current = dataArray
      
      // Init history buffer
      historyRef.current = []
      for (let i = 0; i < historyLength; i++) {
        historyRef.current.push(new Float32Array(sampleCount))
      }
    } catch (e) {
      console.error('[Oscilloscope3DVisualizer] audio init failed', e)
    }

    const draw = () => {
      const now = performance.now()
      rotationRef.current += 0.005

      const parent = canvas.parentElement
      if (parent) {
        const newWidth = parent.clientWidth || 640
        const newHeight = parent.clientHeight || 360
        if (canvas.width !== newWidth || canvas.height !== newHeight) {
          canvas.width = newWidth
          canvas.height = newHeight
        }
      }

      const w = canvas.width || 640
      const h = canvas.height || 360
      const cfg = configRef.current

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = cfg.colors.background || '#000'
      ctx.fillRect(0, 0, w, h)

      // Lấy time domain data
      let arr: Uint8Array
      if (isPlaying && analyserRef.current && dataRef.current) {
        arr = getTimeDomainData(analyserRef.current, dataRef.current)
      } else {
        arr = new Uint8Array(512)
        const phase = (now / 1000) * 3
        for (let i = 0; i < 512; i++) {
          const wave = Math.sin((i / 512) * Math.PI * 8 + phase) * 0.3 + 0.5
          arr[i] = Math.floor(wave * 255)
        }
      }

      // Downsample và add to history
      const currentWave = new Float32Array(sampleCount)
      for (let i = 0; i < sampleCount; i++) {
        const idx = Math.floor((i / sampleCount) * arr.length)
        currentWave[i] = (arr[idx] - 128) / 128
      }

      // Shift history và add new
      historyRef.current.pop()
      historyRef.current.unshift(currentWave)

      // Transform
      const tx = transform?.position ? (transform.position.x / 100) * w : w * 0.5
      const ty = transform?.position ? (transform.position.y / 100) * h : h * 0.5
      const sx = transform?.scale?.x ?? 1
      const sy = transform?.scale?.y ?? 1
      const rot = (transform?.rotation ?? 0) * (Math.PI / 180)
      const alpha = typeof transform?.opacity === 'number' ? transform.opacity : 1

      const primary = cfg.colors.primary || '#00ff88'
      const secondary = cfg.colors.secondary || '#0088ff'
      const sensitivity = cfg.sensitivity || 1

      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(tx, ty)
      ctx.rotate(rot)
      ctx.scale(sx, sy)

      const gridWidth = w * 0.6
      const gridDepth = h * 0.4
      const waveHeight = h * 0.15 * sensitivity
      const rotation = rotationRef.current

      // 3D projection helpers
      const project = (x: number, y: number, z: number) => {
        const cosR = Math.cos(rotation)
        const sinR = Math.sin(rotation)
        
        // Rotate around Y axis
        const rx = x * cosR - z * sinR
        const rz = x * sinR + z * cosR

        // Simple perspective
        const perspective = 1 + rz * 0.001
        const px = rx / perspective
        const py = y / perspective

        return { x: px, y: py, z: rz }
      }

      // Vẽ từ sau ra trước (painter's algorithm)
      for (let zi = historyRef.current.length - 1; zi >= 0; zi--) {
        const wave = historyRef.current[zi]
        const zPos = (zi / historyRef.current.length - 0.5) * gridDepth

        // Depth-based alpha và color
        const depthFactor = 1 - zi / historyRef.current.length
        const lineAlpha = 0.3 + depthFactor * 0.7

        ctx.beginPath()

        for (let xi = 0; xi < wave.length; xi++) {
          const xPos = (xi / wave.length - 0.5) * gridWidth
          const yPos = -wave[xi] * waveHeight

          const projected = project(xPos, yPos, zPos)

          if (xi === 0) {
            ctx.moveTo(projected.x, projected.y)
          } else {
            ctx.lineTo(projected.x, projected.y)
          }
        }

        // Gradient color based on depth
        const hue = 120 + (1 - depthFactor) * 60 // green to cyan
        ctx.strokeStyle = `hsla(${hue}, 100%, ${50 + depthFactor * 30}%, ${lineAlpha})`
        ctx.lineWidth = 1 + depthFactor * 2
        ctx.shadowColor = `hsl(${hue}, 100%, 60%)`
        ctx.shadowBlur = depthFactor * 15
        ctx.stroke()
      }

      // Front wave với extra glow
      if (historyRef.current.length > 0) {
        const frontWave = historyRef.current[0]
        const zPos = -gridDepth * 0.5

        // Glow layer
        ctx.beginPath()
        for (let xi = 0; xi < frontWave.length; xi++) {
          const xPos = (xi / frontWave.length - 0.5) * gridWidth
          const yPos = -frontWave[xi] * waveHeight
          const projected = project(xPos, yPos, zPos)

          if (xi === 0) ctx.moveTo(projected.x, projected.y)
          else ctx.lineTo(projected.x, projected.y)
        }
        ctx.strokeStyle = primary + '60'
        ctx.lineWidth = 6
        ctx.shadowColor = primary
        ctx.shadowBlur = 25
        ctx.stroke()

        // Main line
        ctx.beginPath()
        for (let xi = 0; xi < frontWave.length; xi++) {
          const xPos = (xi / frontWave.length - 0.5) * gridWidth
          const yPos = -frontWave[xi] * waveHeight
          const projected = project(xPos, yPos, zPos)

          if (xi === 0) ctx.moveTo(projected.x, projected.y)
          else ctx.lineTo(projected.x, projected.y)
        }
        ctx.strokeStyle = primary
        ctx.lineWidth = 2.5
        ctx.shadowBlur = 15
        ctx.stroke()

        // Highlight
        ctx.beginPath()
        for (let xi = 0; xi < frontWave.length; xi++) {
          const xPos = (xi / frontWave.length - 0.5) * gridWidth
          const yPos = -frontWave[xi] * waveHeight
          const projected = project(xPos, yPos, zPos)

          if (xi === 0) ctx.moveTo(projected.x, projected.y)
          else ctx.lineTo(projected.x, projected.y)
        }
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1
        ctx.shadowBlur = 5
        ctx.stroke()
      }

      // Grid lines (optional decorative)
      ctx.strokeStyle = primary + '15'
      ctx.lineWidth = 0.5
      ctx.shadowBlur = 0

      // Horizontal grid
      for (let i = 0; i < 5; i++) {
        const y = (i / 4 - 0.5) * waveHeight * 2
        ctx.beginPath()
        const p1 = project(-gridWidth / 2, y, -gridDepth / 2)
        const p2 = project(gridWidth / 2, y, -gridDepth / 2)
        ctx.moveTo(p1.x, p1.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.stroke()
      }

      ctx.restore()
      rafRef.current = requestAnimationFrame(draw)
    }

    const startAnimation = () => {
      if (canvas.width > 0 && canvas.height > 0) {
        rafRef.current = requestAnimationFrame(draw)
      } else {
        setTimeout(startAnimation, 100)
      }
    }
    startAnimation()

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      releaseAudioContext()
    }
  }, [audioRef, configRef, isPlaying, transform])

  useEffect(() => {
    if (isPlaying && audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {})
    }
  }, [isPlaying])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}

Cách thêm vào Switch Case
typescript// Import
import AlbumArtPulseVisualizer from '../visualizers/AlbumArtPulseVisualizer'
import DNAHelixVisualizer from '../visualizers/DNAHelixVisualizer'
import CircularBarsVisualizer from '../visualizers/CircularBarsVisualizer'
import ParticleWaveVisualizer from '../visualizers/ParticleWaveVisualizer'
import SpectrumMountainVisualizer from '../visualizers/SpectrumMountainVisualizer'
import NeonPulseRingVisualizer from '../visualizers/NeonPulseRingVisualizer'
import Oscilloscope3DVisualizer from '../visualizers/Oscilloscope3DVisualizer'

// Trong switch case
case 'album-art-pulse':
  return <AlbumArtPulseVisualizer {...commonProps} transform={visualizerLayer} albumArtSrc={albumArtSrc} />

case 'dna-helix':
  return <DNAHelixVisualizer {...commonProps} transform={visualizerLayer} />

case 'circular-bars':
  return <CircularBarsVisualizer {...commonProps} transform={visualizerLayer} />

case 'particle-wave':
  return <ParticleWaveVisualizer {...commonProps} transform={visualizerLayer} />

case 'spectrum-mountain':
  return <SpectrumMountainVisualizer {...commonProps} transform={visualizerLayer} />

case 'neon-pulse-ring':
  return <NeonPulseRingVisualizer {...commonProps} transform={visualizerLayer} />

case 'oscilloscope-3d':
  return <Oscilloscope3DVisualizer {...commonProps} transform={visualizerLayer} />
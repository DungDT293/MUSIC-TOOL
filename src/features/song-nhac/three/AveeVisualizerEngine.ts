import * as THREE from 'three'
import type { SongNhacAudioFrame } from '../core/types'

export type AveeColorTheme = 'cyberpunk' | 'emerald' | 'gold' | 'ocean'

export interface AveeVisualizerOptions {
  theme?: AveeColorTheme
  logoUrl?: string | null
  intensity?: number
  showParticles?: boolean
  showBars?: boolean
  showLogo?: boolean
}

export const AVEE_THEMES: Record<
  AveeColorTheme,
  {
    name: string
    primary: number
    secondary: number
    particles: number
    ring: number
    bg: string
  }
> = {
  cyberpunk: {
    name: 'Cyberpunk (Xanh - Hồng)',
    primary: 0x00f2fe,
    secondary: 0xfe0979,
    particles: 0x4facfe,
    ring: 0x00f2fe,
    bg: '#040714',
  },
  emerald: {
    name: 'Emerald (Xanh ngọc)',
    primary: 0x00f5a0,
    secondary: 0x00d9f5,
    particles: 0x70f5b0,
    ring: 0x00f5a0,
    bg: '#030f0a',
  },
  gold: {
    name: 'Gold (Vàng kim)',
    primary: 0xffd200,
    secondary: 0xf7971e,
    particles: 0xffe680,
    ring: 0xffd200,
    bg: '#0f0b03',
  },
  ocean: {
    name: 'Ocean (Xanh dương)',
    primary: 0x2193b0,
    secondary: 0x6dd5ed,
    particles: 0x9be2f5,
    ring: 0x2193b0,
    bg: '#020b14',
  },
}

function createDefaultLogoTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  const cx = 256
  const cy = 256
  const r = 240

  // Background gradient disc
  const bgGrad = ctx.createRadialGradient(cx, cy, 30, cx, cy, r)
  bgGrad.addColorStop(0, '#0f172a')
  bgGrad.addColorStop(0.7, '#070b14')
  bgGrad.addColorStop(1, '#020408')
  ctx.fillStyle = bgGrad
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()

  // Inner rings
  ctx.lineWidth = 4
  ctx.strokeStyle = '#00f2fe'
  ctx.beginPath()
  ctx.arc(cx, cy, r - 12, 0, Math.PI * 2)
  ctx.stroke()

  ctx.lineWidth = 2
  ctx.strokeStyle = '#fe0979'
  ctx.beginPath()
  ctx.arc(cx, cy, r - 22, 0, Math.PI * 2)
  ctx.stroke()

  // Accent arc dots
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2
    const dotX = cx + Math.cos(angle) * (r - 17)
    const dotY = cy + Math.sin(angle) * (r - 17)
    ctx.beginPath()
    ctx.arc(dotX, dotY, 3, 0, Math.PI * 2)
    ctx.fill()
  }

  // Typography "93"
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '900 130px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  const textGrad = ctx.createLinearGradient(cx - 100, cy - 50, cx + 100, cy + 50)
  textGrad.addColorStop(0, '#00f2fe')
  textGrad.addColorStop(0.5, '#ffffff')
  textGrad.addColorStop(1, '#fe0979')
  ctx.fillStyle = textGrad
  ctx.fillText('93', cx, cy - 20)

  // Typography "MEDIA"
  ctx.font = '700 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  ctx.fillStyle = '#94a3b8'
  ctx.letterSpacing = '10px'
  ctx.fillText('M E D I A', cx + 5, cy + 65)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export class AveeVisualizerEngine {
  private canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera

  private logoMesh: THREE.Mesh
  private logoMaterial: THREE.MeshBasicMaterial
  private innerRing: THREE.Mesh
  private outerRing: THREE.LineLoop
  private barsGroup: THREE.Group
  private barMeshes: THREE.Mesh[] = []
  private particles: THREE.Points
  private particlePositions: Float32Array
  private particleVelocities: Float32Array

  private defaultTexture: THREE.CanvasTexture
  private customTexture: THREE.Texture | null = null

  private options: Required<AveeVisualizerOptions>
  private barCount = 96
  private baseRadius = 1.35
  private currentLogoScale = 1.0
  private currentCameraZ = 6.2
  private isDisposed = false

  constructor(canvas: HTMLCanvasElement, options: AveeVisualizerOptions = {}) {
    this.canvas = canvas
    this.options = {
      theme: options.theme || 'cyberpunk',
      logoUrl: options.logoUrl || null,
      intensity: options.intensity ?? 1.0,
      showParticles: options.showParticles ?? true,
      showBars: options.showBars ?? true,
      showLogo: options.showLogo ?? true,
    }

    const width = canvas.width || 960
    const height = canvas.height || 540

    // Setup Scene & Camera
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100)
    this.camera.position.set(0, 0, this.currentCameraZ)

    // WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setSize(width, height, false)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

    // Default Texture
    this.defaultTexture = createDefaultLogoTexture()

    // 1. Logo Mesh
    const logoGeometry = new THREE.CircleGeometry(this.baseRadius, 64)
    this.logoMaterial = new THREE.MeshBasicMaterial({
      map: this.defaultTexture,
      transparent: true,
      side: THREE.DoubleSide,
    })
    this.logoMesh = new THREE.Mesh(logoGeometry, this.logoMaterial)
    this.scene.add(this.logoMesh)

    // 2. Rings
    const currentTheme = AVEE_THEMES[this.options.theme]
    const ringGeo = new THREE.RingGeometry(this.baseRadius + 0.02, this.baseRadius + 0.05, 64)
    const ringMat = new THREE.MeshBasicMaterial({
      color: currentTheme.ring,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    })
    this.innerRing = new THREE.Mesh(ringGeo, ringMat)
    this.scene.add(this.innerRing)

    // Outer subtle dashed ring
    const outerRingPoints: THREE.Vector3[] = []
    const outerRadius = this.baseRadius + 0.12
    for (let i = 0; i <= 64; i += 1) {
      const a = (i / 64) * Math.PI * 2
      outerRingPoints.push(new THREE.Vector3(Math.cos(a) * outerRadius, Math.sin(a) * outerRadius, 0))
    }
    const outerRingGeo = new THREE.BufferGeometry().setFromPoints(outerRingPoints)
    const outerRingMat = new THREE.LineBasicMaterial({
      color: currentTheme.secondary,
      transparent: true,
      opacity: 0.45,
    })
    this.outerRing = new THREE.LineLoop(outerRingGeo, outerRingMat)
    this.scene.add(this.outerRing)

    // 3. Circular Spectrum Bars
    this.barsGroup = new THREE.Group()
    this.scene.add(this.barsGroup)
    this.initSpectrumBars()

    // 4. Stardust Particles
    const particleCount = 450
    const particleGeo = new THREE.BufferGeometry()
    this.particlePositions = new Float32Array(particleCount * 3)
    this.particleVelocities = new Float32Array(particleCount * 3)

    for (let i = 0; i < particleCount; i += 1) {
      const idx = i * 3
      const rad = 1.5 + Math.random() * 8.0
      const theta = Math.random() * Math.PI * 2
      this.particlePositions[idx] = Math.cos(theta) * rad
      this.particlePositions[idx + 1] = Math.sin(theta) * rad
      this.particlePositions[idx + 2] = (Math.random() - 0.5) * 6.0

      this.particleVelocities[idx] = (Math.random() - 0.5) * 0.008
      this.particleVelocities[idx + 1] = (Math.random() - 0.5) * 0.008
      this.particleVelocities[idx + 2] = 0.01 + Math.random() * 0.02
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3))

    const particleMat = new THREE.PointsMaterial({
      size: 0.05,
      color: currentTheme.particles,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    })
    this.particles = new THREE.Points(particleGeo, particleMat)
    this.scene.add(this.particles)

    // Load custom logo if provided
    if (this.options.logoUrl) {
      this.loadLogo(this.options.logoUrl)
    }
  }

  private initSpectrumBars(): void {
    const theme = AVEE_THEMES[this.options.theme]
    const barWidth = 0.038
    const baseUnitHeight = 1.0

    // Single unit box geometry with bottom pivot
    const barGeo = new THREE.BoxGeometry(barWidth, baseUnitHeight, 0.02)
    barGeo.translate(0, 0.5, 0) // Shift origin to base so scaleY grows outward

    const col1 = new THREE.Color(theme.primary)
    const col2 = new THREE.Color(theme.secondary)

    for (let i = 0; i < this.barCount; i += 1) {
      // Color interpolation around circle
      const t = Math.sin((i / this.barCount) * Math.PI)
      const barColor = col1.clone().lerp(col2, t)

      const mat = new THREE.MeshBasicMaterial({
        color: barColor,
        transparent: true,
        opacity: 0.9,
      })
      const mesh = new THREE.Mesh(barGeo, mat)

      const angle = (i / this.barCount) * Math.PI * 2 - Math.PI / 2
      mesh.position.x = Math.cos(angle) * (this.baseRadius + 0.16)
      mesh.position.y = Math.sin(angle) * (this.baseRadius + 0.16)
      mesh.rotation.z = angle - Math.PI / 2
      mesh.scale.set(1, 0.04, 1)

      this.barsGroup.add(mesh)
      this.barMeshes.push(mesh)
    }
  }

  public setOptions(options: Partial<AveeVisualizerOptions>): void {
    if (options.theme && options.theme !== this.options.theme) {
      this.options.theme = options.theme
      this.updateThemeColors()
    }
    if (options.intensity !== undefined) {
      this.options.intensity = Math.max(0.1, Math.min(3.0, options.intensity))
    }
    if (options.logoUrl !== undefined && options.logoUrl !== this.options.logoUrl) {
      this.options.logoUrl = options.logoUrl
      if (options.logoUrl) {
        this.loadLogo(options.logoUrl)
      } else {
        this.resetDefaultLogo()
      }
    }
    if (options.showParticles !== undefined) {
      this.options.showParticles = options.showParticles
      this.particles.visible = options.showParticles
    }
    if (options.showBars !== undefined) {
      this.options.showBars = options.showBars
      this.barsGroup.visible = options.showBars
    }
    if (options.showLogo !== undefined) {
      this.options.showLogo = options.showLogo
      this.logoMesh.visible = options.showLogo
      this.innerRing.visible = options.showLogo
      this.outerRing.visible = options.showLogo
    }
  }

  private updateThemeColors(): void {
    const theme = AVEE_THEMES[this.options.theme]
    ;(this.innerRing.material as THREE.MeshBasicMaterial).color.setHex(theme.ring)
    ;(this.outerRing.material as THREE.LineBasicMaterial).color.setHex(theme.secondary)
    ;(this.particles.material as THREE.PointsMaterial).color.setHex(theme.particles)

    const col1 = new THREE.Color(theme.primary)
    const col2 = new THREE.Color(theme.secondary)

    for (let i = 0; i < this.barMeshes.length; i += 1) {
      const t = Math.sin((i / this.barMeshes.length) * Math.PI)
      const barColor = col1.clone().lerp(col2, t)
      ;(this.barMeshes[i].material as THREE.MeshBasicMaterial).color.copy(barColor)
    }
  }

  public loadLogo(url: string): void {
    const loader = new THREE.TextureLoader()
    loader.load(
      url,
      (texture) => {
        if (this.isDisposed) return
        this.customTexture = texture
        this.logoMaterial.map = texture
        this.logoMaterial.needsUpdate = true
      },
      undefined,
      (err) => {
        console.warn('Không tải được ảnh logo, dùng logo mặc định:', err)
        this.resetDefaultLogo()
      },
    )
  }

  public resetDefaultLogo(): void {
    this.customTexture = null
    this.logoMaterial.map = this.defaultTexture
    this.logoMaterial.needsUpdate = true
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  public render(frame: SongNhacAudioFrame): void {
    if (this.isDisposed) return

    const { bass, beat, frequencyData, timeSec } = frame
    const intensity = this.options.intensity

    // 1. Logo Beat Zoom In / Zoom Out (Pulse)
    const targetScale = 1.0 + (bass * 0.32 + beat * 0.16) * intensity
    this.currentLogoScale += (targetScale - this.currentLogoScale) * 0.22
    this.logoMesh.scale.set(this.currentLogoScale, this.currentLogoScale, 1)
    this.innerRing.scale.set(this.currentLogoScale, this.currentLogoScale, 1)

    // 2. Camera Beat Breathing (Zoom in on kick, spring back)
    const targetCameraZ = 6.2 - (bass * 0.75 + beat * 0.35) * intensity
    this.currentCameraZ += (targetCameraZ - this.currentCameraZ) * 0.14
    this.camera.position.z = this.currentCameraZ

    // Subtle rotational shake on beat
    const targetRotZ = Math.sin(timeSec * 16) * beat * 0.018 * intensity
    this.camera.rotation.z += (targetRotZ - this.camera.rotation.z) * 0.2

    // Ring slow idle rotation
    this.outerRing.rotation.z -= 0.004

    // 3. Update Circular Spectrum Bars
    if (this.options.showBars && frequencyData.length > 0) {
      const halfCount = this.barCount / 2
      const dataLen = Math.min(frequencyData.length, 180)

      for (let i = 0; i < halfCount; i += 1) {
        // Map bar index to frequency curve (exponential for better bass/mid distribution)
        const normalizedIdx = Math.pow(i / halfCount, 1.45)
        const freqIdx = Math.min(dataLen - 1, Math.floor(normalizedIdx * dataLen))
        const val = frequencyData[freqIdx] || 0

        // Bar height: min 0.05, max ~ 1.8
        const rawHeight = 0.04 + (val / 255) * 1.65 * intensity

        // Left mirror
        const leftIdx = halfCount - 1 - i
        const rightIdx = halfCount + i

        const meshLeft = this.barMeshes[leftIdx]
        const meshRight = this.barMeshes[rightIdx]

        if (meshLeft) {
          const currentY = meshLeft.scale.y
          meshLeft.scale.y = currentY + (rawHeight - currentY) * 0.4
        }
        if (meshRight) {
          const currentY = meshRight.scale.y
          meshRight.scale.y = currentY + (rawHeight - currentY) * 0.4
        }
      }
    }

    // 4. Update Stardust Particles
    if (this.options.showParticles) {
      const posAttr = this.particles.geometry.attributes.position as THREE.BufferAttribute
      const positions = posAttr.array as Float32Array
      const beatSpeedMultiplier = 1.0 + beat * 3.5 * intensity

      for (let i = 0; i < positions.length / 3; i += 1) {
        const idx = i * 3
        positions[idx] += this.particleVelocities[idx] * beatSpeedMultiplier
        positions[idx + 1] += this.particleVelocities[idx + 1] * beatSpeedMultiplier
        positions[idx + 2] += this.particleVelocities[idx + 2] * beatSpeedMultiplier

        // Reset if particle moves past camera
        if (positions[idx + 2] > 5.0) {
          const rad = 1.5 + Math.random() * 8.0
          const theta = Math.random() * Math.PI * 2
          positions[idx] = Math.cos(theta) * rad
          positions[idx + 1] = Math.sin(theta) * rad
          positions[idx + 2] = -4.0 - Math.random() * 3.0
        }
      }
      posAttr.needsUpdate = true
    }

    // Render frame
    this.renderer.render(this.scene, this.camera)
  }

  public dispose(): void {
    this.isDisposed = true
    this.scene.clear()
    this.renderer.dispose()
    this.defaultTexture.dispose()
    if (this.customTexture) this.customTexture.dispose()
  }
}


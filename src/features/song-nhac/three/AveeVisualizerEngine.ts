import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { FinishPass } from './finishPass'
import { BlurPass } from './blurPass'
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import type { SongNhacAudioFrame } from '../core/types'
import { SpectrumRing } from './SpectrumRing'
import { activeLyricIndex } from '../studio/lyrics'
import { createFxStyle, isFxStyle, type WaveStyleObject } from './waveStyles'
import { ShaderScene, isShaderScene } from './shaderScene'
import { DEFAULT_EFFECTS, type CompositionEffects } from '../studio/effectsStore'
import {
  buildCssFilter,
  hasColorFilter,
  fitSize,
  getLayerTimeOpacity,
  type StudioAnyLayer,
  type StudioLayer,
  type VisualizerLayer,
  type ImageLayer,
  type ParticlesLayer,
  type LyricsLayer,
  type StudioAnalyzer,
  DEFAULT_ANALYZER,
  evaluateAutomation,
} from '../studio/layerTypes'

interface LayerNode {
  object: THREE.Object3D
  key: string
  baseWidth: number
  baseHeight: number
  lastTransform?: StudioLayer['transform']
  depthFactor: number
  layer?: StudioLayer
  /** Per-frame work (video filter baking). */
  tick?: () => void
  dispose: () => void
}

export type AveeColorTheme = 'cyberpunk' | 'emerald' | 'gold' | 'ocean' | 'sunset' | 'mono'
export type AveeQuality = 'low' | 'balanced' | 'full'

export interface AveeVisualizerOptions {
  theme?: AveeColorTheme
  logoUrl?: string | null
  intensity?: number
  showParticles?: boolean
  showBars?: boolean
  showLogo?: boolean
  showRing?: boolean
  quality?: AveeQuality
  /** Seed for every pseudo-random element so exports are reproducible. */
  seed?: number
  /** Called when the GPU drops the WebGL context (driver reset, out of memory). */
  onContextLost?: () => void
  /** Keep the drawing buffer so the canvas can be read with toDataURL() (thumbnails). */
  preserveDrawingBuffer?: boolean
}

interface ThemePalette {
  name: string
  primary: number
  secondary: number
  accent: number
  particles: number
  ring: number
  background: [string, string, string]
  bloom: number
}

export const AVEE_THEMES: Record<AveeColorTheme, ThemePalette> = {
  cyberpunk: {
    name: 'Cyberpunk',
    primary: 0x00f2fe,
    secondary: 0xfe0979,
    accent: 0x7c3aed,
    particles: 0x4facfe,
    ring: 0x00f2fe,
    background: ['#0a1030', '#050818', '#01030a'],
    bloom: 1.0,
  },
  emerald: {
    name: 'Emerald',
    primary: 0x00f5a0,
    secondary: 0x00d9f5,
    accent: 0x22c55e,
    particles: 0x70f5b0,
    ring: 0x00f5a0,
    background: ['#04160f', '#02100a', '#010604'],
    bloom: 0.95,
  },
  gold: {
    name: 'Gold',
    primary: 0xffd200,
    secondary: 0xf7971e,
    accent: 0xff7b00,
    particles: 0xffe680,
    ring: 0xffd200,
    background: ['#1a1204', '#0f0b03', '#070501'],
    bloom: 1.05,
  },
  ocean: {
    name: 'Ocean',
    primary: 0x2193b0,
    secondary: 0x6dd5ed,
    accent: 0x1e3a8a,
    particles: 0x9be2f5,
    ring: 0x2193b0,
    background: ['#03182b', '#020d18', '#01060c'],
    bloom: 0.9,
  },
  sunset: {
    name: 'Sunset',
    primary: 0xff7e5f,
    secondary: 0xfeb47b,
    accent: 0xb91c5b,
    particles: 0xffd6a5,
    ring: 0xff7e5f,
    background: ['#1c0d16', '#120710', '#08030a'],
    bloom: 1.0,
  },
  mono: {
    name: 'Mono',
    primary: 0xffffff,
    secondary: 0xa1a1aa,
    accent: 0x52525b,
    particles: 0xe4e4e7,
    ring: 0xffffff,
    background: ['#101014', '#0a0a0d', '#040405'],
    bloom: 0.8,
  },
}

export const AVEE_THEME_LIST = (Object.keys(AVEE_THEMES) as AveeColorTheme[]).map((id) => ({
  id,
  label: AVEE_THEMES[id].name,
}))

const QUALITY_PRESETS = {
  low: { bars: 96, particles: 260, bloom: 0.5, pixelRatio: 1 },
  balanced: { bars: 160, particles: 520, bloom: 0.7, pixelRatio: 1 },
  full: { bars: 224, particles: 900, bloom: 1, pixelRatio: 1.5 },
} as const

const BAR_BASE_RADIUS = 1.32
const DEFAULT_RADIUS = 1.18

function fract(value: number): number {
  return value - Math.floor(value)
}

/** Deterministic hash-based pseudo random in [0, 1). */
function hash(index: number, seed: number): number {
  return fract(Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453)
}

function createGlowTexture(inner: string, outer: string): THREE.Texture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, inner)
  gradient.addColorStop(0.45, outer)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function createSoftDotTexture(): THREE.Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.65)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function createDefaultLogoTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  const cx = 256
  const cy = 256
  const r = 248

  const bgGrad = ctx.createRadialGradient(cx, cy, 20, cx, cy, r)
  bgGrad.addColorStop(0, '#0b1224')
  bgGrad.addColorStop(0.65, '#05080f')
  bgGrad.addColorStop(1, '#010204')
  ctx.fillStyle = bgGrad
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()

  ctx.lineWidth = 6
  ctx.strokeStyle = '#00f2fe'
  ctx.beginPath()
  ctx.arc(cx, cy, r - 14, 0, Math.PI * 2)
  ctx.stroke()

  ctx.lineWidth = 2
  ctx.strokeStyle = '#fe0979'
  ctx.beginPath()
  ctx.arc(cx, cy, r - 26, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(cx + Math.cos(angle) * (r - 19), cy + Math.sin(angle) * (r - 19), 3, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '900 140px "Segoe UI", Roboto, sans-serif'
  const textGrad = ctx.createLinearGradient(cx - 110, cy - 60, cx + 110, cy + 60)
  textGrad.addColorStop(0, '#0891b2')
  textGrad.addColorStop(0.5, '#67e8f9')
  textGrad.addColorStop(1, '#db2777')
  ctx.fillStyle = textGrad
  ctx.fillText('93', cx, cy - 22)

  ctx.font = '700 28px "Segoe UI", Roboto, sans-serif'
  ctx.fillStyle = '#64748b'
  ctx.fillText('M E D I A', cx + 4, cy + 66)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

const BACKGROUND_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const BACKGROUND_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uInner;
  uniform vec3 uMid;
  uniform vec3 uOuter;
  uniform vec3 uAccent;
  uniform float uPulse;
  uniform float uAspect;

  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    float d = length(p);
    float glow = smoothstep(0.85, 0.0, d);
    vec3 col = mix(uOuter, uMid, smoothstep(0.0, 0.55, glow));
    col = mix(col, uInner, smoothstep(0.35, 1.0, glow));
    // accent halo that breathes with the kick drum
    float halo = smoothstep(0.45, 0.0, abs(d - 0.18 - uPulse * 0.05));
    col += uAccent * halo * (0.12 + uPulse * 0.25);
    // subtle vignette
    col *= 1.0 - smoothstep(0.55, 1.15, d) * 0.55;
    gl_FragColor = vec4(col, 1.0);
  }
`

const PARTICLE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  uniform float uPixelRatio;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio * (18.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`

const PARTICLE_FRAG = /* glsl */ `
  varying float vAlpha;
  uniform vec3 uColor;
  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`

export class AveeVisualizerEngine {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private composer: EffectComposer
  private bloomPass: UnrealBloomPass
  /** Bloom level from the theme/layer, modulated per frame by the beat. */
  private baseBloom = 0.55
  private finishPass!: FinishPass
  private blurPassH!: BlurPass
  private blurPassV!: BlurPass
  private fxaaPass!: ShaderPass

  private backgroundMesh: THREE.Mesh
  private backgroundMaterial: THREE.ShaderMaterial

  private barsMesh!: THREE.InstancedMesh
  private barsInner!: THREE.InstancedMesh
  private barColors!: Float32Array
  private barHeights!: Float32Array
  private barCount = 0

  private logoMesh: THREE.Mesh
  private logoBackdrop: THREE.Mesh
  private logoMaterial: THREE.MeshBasicMaterial
  private logoGlow: THREE.Sprite
  private innerRing: THREE.Mesh
  private outerRing: THREE.LineLoop
  private particlePoints: THREE.Points
  private particlePositions: Float32Array
  private particleSeeds: Float32Array

  private defaultTexture: THREE.CanvasTexture
  private customTexture: THREE.Texture | null = null
  private glowTexture: THREE.Texture
  private dotTexture: THREE.Texture

  private options: Required<AveeVisualizerOptions>
  private currentLogoScale = 1
  private currentCameraZ = 7
  private lastTimeSec = -1
  private isDisposed = false
  private logoLoadToken = 0

  private visualizerGroup = new THREE.Group()
  private layerNodes = new Map<string, LayerNode>()
  private extraVisualizers = new Map<string, { ring: SpectrumRing; layer: VisualizerLayer }>()
  private waveRings = new Map<string, { ring: SpectrumRing; layer: ImageLayer }>()
  private fxStyle: WaveStyleObject | null = null
  private fxStyleKey = ''
  private fxColorA = 0x00f2fe
  private fxColorB = 0xfe0979
  private shaderScene: ShaderScene | null = null
  private shaderSceneKey = ''
  private currentVisualizerLayer: StudioLayer | null = null
  private selectionFrame!: THREE.LineLoop
  private selectedLayerId: string | null = null
  private contextLost = false
  private lastFrame: SongNhacAudioFrame | null = null
  private lastDelta = 1 / 60
  private effects: CompositionEffects = { ...DEFAULT_EFFECTS }
  private visualizerSensitivity = 1
  private visualizerSpeed = 1
  private stageWidth = 10
  private stageHeight = 6

  constructor(canvas: HTMLCanvasElement, options: AveeVisualizerOptions = {}) {
    this.options = {
      theme: options.theme ?? 'cyberpunk',
      logoUrl: options.logoUrl ?? null,
      intensity: options.intensity ?? 1,
      showParticles: options.showParticles ?? true,
      showBars: options.showBars ?? true,
      showLogo: options.showLogo ?? true,
      showRing: options.showRing ?? true,
      quality: options.quality ?? 'balanced',
      seed: options.seed ?? 93,
      onContextLost: options.onContextLost ?? (() => undefined),
      preserveDrawingBuffer: options.preserveDrawingBuffer === true,
    }

    // A lost GPU context freezes the canvas and kills WebCodecs hardware encoding, so
    // surface it instead of letting the next export fail with a vague encoder error.
    canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault()
        this.contextLost = true
        this.options.onContextLost?.()
      },
      false,
    )
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false
    })

    const width = canvas.width || 1280
    const height = canvas.height || 720

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 100)
    this.camera.position.set(0, 0, this.currentCameraZ)
    this.scene.add(this.visualizerGroup)
    this.updateStageSize()

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      // Only thumbnail rendering needs the buffer kept so toDataURL() works.
      preserveDrawingBuffer: options.preserveDrawingBuffer === true,
    })
    this.renderer.setPixelRatio(this.resolvePixelRatio())
    this.renderer.setSize(width, height, false)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.defaultTexture = createDefaultLogoTexture()
    this.glowTexture = createGlowTexture('rgba(255,255,255,0.95)', 'rgba(120,180,255,0.18)')
    this.dotTexture = createSoftDotTexture()

    // Ã¢â€â‚¬Ã¢â€â‚¬ Background Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    this.backgroundMaterial = new THREE.ShaderMaterial({
      vertexShader: BACKGROUND_VERT,
      fragmentShader: BACKGROUND_FRAG,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uInner: { value: new THREE.Color() },
        uMid: { value: new THREE.Color() },
        uOuter: { value: new THREE.Color() },
        uAccent: { value: new THREE.Color() },
        uPulse: { value: 0 },
        uAspect: { value: width / height },
      },
    })
    this.backgroundMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.backgroundMaterial)
    this.backgroundMesh.position.z = -20
    this.backgroundMesh.frustumCulled = false
    this.updateBackgroundScale()
    this.scene.add(this.backgroundMesh)

    // Ã¢â€â‚¬Ã¢â€â‚¬ Logo disc Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    // Opaque backing plate: the logo texture may still be loading (or may fail for a
    // file the app:// protocol refuses). Without it the additive halo behind shows
    // through and the whole disc reads as a washed-out glow blob.
    this.logoBackdrop = new THREE.Mesh(
      new THREE.CircleGeometry(DEFAULT_RADIUS, 96),
      new THREE.MeshBasicMaterial({ color: 0x04060c, depthWrite: true }),
    )
    this.logoBackdrop.position.z = -0.02
    this.visualizerGroup.add(this.logoBackdrop)

    this.logoMaterial = new THREE.MeshBasicMaterial({
      map: this.defaultTexture,
      transparent: true,
      depthWrite: false,
    })
    this.logoMesh = new THREE.Mesh(new THREE.CircleGeometry(DEFAULT_RADIUS, 96), this.logoMaterial)
    this.visualizerGroup.add(this.logoMesh)

    this.logoGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        opacity: 0.22,
      }),
    )
    this.logoGlow.position.z = -0.25
    this.logoGlow.scale.setScalar(DEFAULT_RADIUS * 2.3)
    this.visualizerGroup.add(this.logoGlow)

    // Ã¢â€â‚¬Ã¢â€â‚¬ Rings Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    const ringGeometry = new THREE.RingGeometry(DEFAULT_RADIUS + 0.015, DEFAULT_RADIUS + 0.055, 128)
    this.innerRing = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    this.visualizerGroup.add(this.innerRing)

    const outerPoints: THREE.Vector3[] = []
    const outerRadius = DEFAULT_RADIUS + 0.16
    for (let i = 0; i <= 96; i += 1) {
      const angle = (i / 96) * Math.PI * 2
      outerPoints.push(new THREE.Vector3(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius, 0))
    }
    this.outerRing = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(outerPoints),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 }),
    )
    this.visualizerGroup.add(this.outerRing)

    // Ã¢â€â‚¬Ã¢â€â‚¬ Spectrum bars Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    const preset = QUALITY_PRESETS[this.options.quality]
    this.buildBarMeshes(preset.bars)

    // Ã¢â€â‚¬Ã¢â€â‚¬ Particles Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    const particleCount = preset.particles
    this.particlePositions = new Float32Array(particleCount * 3)
    this.particleSeeds = new Float32Array(particleCount * 4)
    for (let i = 0; i < particleCount; i += 1) {
      this.particleSeeds[i * 4 + 0] = hash(i + 1, this.options.seed) * Math.PI * 2
      this.particleSeeds[i * 4 + 1] = 1.6 + hash(i + 101, this.options.seed) * 7.4
      this.particleSeeds[i * 4 + 2] = 0.15 + hash(i + 211, this.options.seed) * 0.75
      this.particleSeeds[i * 4 + 3] = hash(i + 307, this.options.seed)
    }
    const particleGeometry = new THREE.BufferGeometry()
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3))
    const alphas = new Float32Array(particleCount)
    const sizes = new Float32Array(particleCount)
    for (let i = 0; i < particleCount; i += 1) {
      alphas[i] = 0.25 + this.particleSeeds[i * 4 + 3] * 0.55
      sizes[i] = 0.5 + this.particleSeeds[i * 4 + 2] * 1.6
    }
    particleGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))
    particleGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))

    const particleMaterial = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uPixelRatio: { value: this.resolvePixelRatio() },
      },
    })
    this.particlePoints = new THREE.Points(particleGeometry, particleMaterial)
    this.visualizerGroup.add(this.particlePoints)

    // Ã¢â€â‚¬Ã¢â€â‚¬ Post processing Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    this.composer = new EffectComposer(this.renderer)
    this.composer.setPixelRatio(this.resolvePixelRatio())
    this.composer.setSize(width, height)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.55, 0.45, 0.85)
    this.composer.addPass(this.bloomPass)
    // Optional two-pass separable blur, then the grade, then FXAA, then output.
    this.blurPassH = new BlurPass()
    this.blurPassV = new BlurPass()
    this.blurPassH.direction = new THREE.Vector2(1, 0)
    this.blurPassV.direction = new THREE.Vector2(0, 1)
    this.blurPassH.enabled = false
    this.blurPassV.enabled = false
    this.composer.addPass(this.blurPassH)
    this.composer.addPass(this.blurPassV)
    this.finishPass = new FinishPass()
    this.composer.addPass(this.finishPass)
    const fxaa = new ShaderPass(FXAAShader)
    fxaa.material.uniforms.resolution = { value: new THREE.Vector2(1 / width, 1 / height) }
    this.fxaaPass = fxaa
    this.composer.addPass(fxaa)
    this.composer.addPass(new OutputPass())

    this.buildSelectionFrame()
    this.applyTheme(this.options.theme)
    this.applyVisibility()
    this.positionParticles(0)

    if (this.options.logoUrl) this.loadLogo(this.options.logoUrl)
    this.updateBackgroundScale()
  }

  private resolvePixelRatio(): number {
    const base = QUALITY_PRESETS[this.options.quality].bloom
    const device = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    return Math.min(device, 1.25 + base * 0.25)
  }

  private updateBackgroundScale(): void {
    const distance = this.camera.position.z - this.backgroundMesh.position.z
    const height = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * distance
    const width = height * this.camera.aspect
    this.backgroundMesh.scale.set(width / 2, height / 2, 1)
    this.backgroundMaterial.uniforms.uAspect.value = this.camera.aspect
  }

  private applyTheme(theme: AveeColorTheme): void {
    const palette = AVEE_THEMES[theme] ?? AVEE_THEMES.cyberpunk
    this.backgroundMaterial.uniforms.uInner.value.set(palette.background[0])
    this.backgroundMaterial.uniforms.uMid.value.set(palette.background[1])
    this.backgroundMaterial.uniforms.uOuter.value.set(palette.background[2])
    this.backgroundMaterial.uniforms.uAccent.value.set(palette.accent)
    ;(this.innerRing.material as THREE.MeshBasicMaterial).color.setHex(palette.primary)
    ;(this.outerRing.material as THREE.LineBasicMaterial).color.setHex(palette.secondary)
    ;(this.particlePoints.material as THREE.ShaderMaterial).uniforms.uColor.value.setHex(palette.particles)
    ;(this.logoGlow.material as THREE.SpriteMaterial).color.setHex(palette.primary)
    this.baseBloom = palette.bloom * 0.55
    this.bloomPass.strength = this.baseBloom
    // A layer with custom colours keeps them when the page theme changes.
    const viz = this.currentVisualizerLayer
    if (!viz || viz.type !== 'visualizer' || viz.colorMode === 'rainbow') {
      this.writeBarColors(palette.primary, palette.secondary, palette.accent)
    }
  }

  private writeBarColors(primary: number, secondary: number, accent: number): void {
    const colorA = new THREE.Color(primary)
    const colorB = new THREE.Color(secondary)
    const colorC = new THREE.Color(accent)
    const innerAttr = this.barsInner?.instanceColor
    for (let i = 0; i < this.barCount; i += 1) {
      const t = i / Math.max(1, this.barCount - 1)
      // mirror the palette around the vertical axis so both halves match
      const mirrored = t <= 0.5 ? t * 2 : (1 - t) * 2
      const color = colorA.clone().lerp(colorB, mirrored)
      if (mirrored > 0.85) color.lerp(colorC, (mirrored - 0.85) / 0.15 * 0.5)
      this.barColors[i * 3 + 0] = color.r
      this.barColors[i * 3 + 1] = color.g
      this.barColors[i * 3 + 2] = color.b
      if (innerAttr) {
        innerAttr.setXYZ(i, color.r * 0.8, color.g * 0.8, color.b * 0.8)
      }
    }
    if (this.barsMesh.instanceColor) this.barsMesh.instanceColor.needsUpdate = true
    if (innerAttr) innerAttr.needsUpdate = true
  }

  private applyVisibility(): void {
    this.particlePoints.visible = this.options.showParticles
    this.barsMesh.visible = this.options.showBars
    this.barsInner.visible = this.options.showBars
    this.logoMesh.visible = this.options.showLogo
    this.logoBackdrop.visible = this.options.showLogo
    this.logoGlow.visible = this.options.showLogo
    this.innerRing.visible = this.options.showLogo && this.options.showRing
    this.outerRing.visible = this.options.showLogo && this.options.showRing
  }

  public setOptions(options: Partial<AveeVisualizerOptions>): void {
    if (options.theme && options.theme !== this.options.theme) {
      this.options.theme = options.theme
      this.applyTheme(options.theme)
    }
    if (options.intensity !== undefined) {
      this.options.intensity = Math.max(0.1, Math.min(3, options.intensity))
    }
    if (options.logoUrl !== undefined && options.logoUrl !== this.options.logoUrl) {
      this.options.logoUrl = options.logoUrl
      if (options.logoUrl) this.loadLogo(options.logoUrl)
      else this.resetDefaultLogo()
    }
    if (options.showParticles !== undefined) this.options.showParticles = options.showParticles
    if (options.showBars !== undefined) this.options.showBars = options.showBars
    if (options.showLogo !== undefined) this.options.showLogo = options.showLogo
    if (options.showRing !== undefined) this.options.showRing = options.showRing
    this.applyVisibility()
  }

  public loadLogo(url: string): void {
    const token = ++this.logoLoadToken
    // A texture that never resolves would leave the disc empty (the additive halo shows
    // through). Fall back to the built-in logo if the image is not ready in time.
    const timer = setTimeout(() => {
      if (token === this.logoLoadToken && !this.isDisposed) this.resetDefaultLogo()
    }, 2500)
    const loader = new THREE.TextureLoader()
    loader.load(
      url,
      (texture) => {
        clearTimeout(timer)
        if (this.isDisposed || token !== this.logoLoadToken) {
          texture.dispose()
          return
        }
        texture.colorSpace = THREE.SRGBColorSpace
        this.customTexture = texture
        this.logoMaterial.map = texture
        this.logoMaterial.needsUpdate = true
      },
      undefined,
      () => {
        clearTimeout(timer)
        if (token !== this.logoLoadToken) return
        this.resetDefaultLogo()
      },
    )
  }

  public resetDefaultLogo(): void {
    this.logoLoadToken += 1
    this.customTexture = null
    this.logoMaterial.map = this.defaultTexture
    this.logoMaterial.needsUpdate = true
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.updateStageSize()
    this.renderer.setPixelRatio(this.resolvePixelRatio())
    this.renderer.setSize(width, height, false)
    this.composer.setPixelRatio(this.resolvePixelRatio())
    this.composer.setSize(width, height)
    this.bloomPass.setSize(width, height)
    this.updateBackgroundScale()
  }

  private positionParticles(timeSec: number): void {
    const count = this.particlePositions.length / 3
    const spread = 9
    for (let i = 0; i < count; i += 1) {
      const angle = this.particleSeeds[i * 4 + 0] + timeSec * 0.06 * (0.4 + this.particleSeeds[i * 4 + 3])
      const radius = this.particleSeeds[i * 4 + 1]
      const speed = 0.25 + this.particleSeeds[i * 4 + 2]
      const z = ((this.particleSeeds[i * 4 + 3] * spread + timeSec * speed) % spread) - spread / 2
      this.particlePositions[i * 3 + 0] = Math.cos(angle) * radius
      this.particlePositions[i * 3 + 1] = Math.sin(angle) * radius
      this.particlePositions[i * 3 + 2] = z
    }
    const attr = this.particlePoints.geometry.getAttribute('position') as THREE.BufferAttribute
    attr.needsUpdate = true
  }

  /** Spectrum window + response configured for a layer. */
  private analyzerOf(layer?: { analyzer?: StudioAnalyzer } | null): StudioAnalyzer {
    return layer?.analyzer ?? DEFAULT_ANALYZER
  }

  /** Slice of the spectrum that the layer's analyzer listens to. */
  private bandData(frame: SongNhacAudioFrame, analyzer: StudioAnalyzer): Uint8Array {
    const data = frame.frequencyData
    const start = Math.max(0, Math.min(data.length - 1, Math.floor(analyzer.bandStart * data.length)))
    const end = Math.max(start + 1, Math.min(data.length, Math.ceil(analyzer.bandEnd * data.length)))
    return data.subarray(start, end)
  }

  /** 0..1 energy of the band, used by particles and other beat-driven layers. */
  private bandEnergy(frame: SongNhacAudioFrame, analyzer: StudioAnalyzer): number {
    const band = this.bandData(frame, analyzer)
    let sum = 0
    for (let i = 0; i < band.length; i += 1) sum += band[i]
    return Math.min(1, (sum / Math.max(1, band.length) / 255) * analyzer.sensitivity)
  }

  private updateBars(frame: SongNhacAudioFrame): void {
    const style = this.currentVisualizerLayer?.type === 'visualizer' ? this.currentVisualizerLayer.waveStyle : 'circlebars'
    if (style === 'bars') {
      this.updateBottomBars(frame)
      return
    }
    if (style === 'dots') {
      this.updateRingDots(frame)
      return
    }
    const intensity = this.options.intensity
    const analyzer = this.analyzerOf(this.currentVisualizerLayer)
    const data = this.bandData(frame, analyzer)
    const dataLength = Math.min(data.length, 180)
    const half = Math.floor(this.barCount / 2)
    const dummy = new THREE.Object3D()
    const barWidth = (2 * Math.PI * BAR_BASE_RADIUS) / this.barCount * 0.82
    const innerRadius = BAR_BASE_RADIUS - 0.1

    // Auto-gain: without it a quiet mix leaves half the ring at zero and the visual
    // looks broken. Normalising to the loudest bin keeps every bar alive.
    let peak = 0
    for (let i = 0; i < dataLength; i += 1) {
      if (data[i] > peak) peak = data[i]
    }
    const gain = peak > 8 ? 255 / peak : 1

    for (let i = 0; i < this.barCount; i += 1) {
      // index mirrored across the vertical axis: left half rises, right half mirrors
      const mirrored = i < half ? half - 1 - i : i - half
      const normalized = Math.pow(mirrored / Math.max(1, half - 1), 1.2)
      const freqIndex = dataLength > 0 ? Math.min(dataLength - 1, Math.floor(normalized * dataLength)) : -1
      const raw = freqIndex >= 0 ? Math.min(1, ((data[freqIndex] ?? 0) * gain) / 255) : 0
      // gamma 0.65 lifts the quiet bins so the ring stays continuous
      const target = 0.06 + Math.pow(raw, 0.65) * 1.15 * intensity * this.visualizerSensitivity
      this.barHeights[i] += (target - this.barHeights[i]) * 0.35
      const height = Math.max(0.02, this.barHeights[i])

      const angle = (i / this.barCount) * Math.PI * 2 - Math.PI / 2
      dummy.position.set(Math.cos(angle) * BAR_BASE_RADIUS, Math.sin(angle) * BAR_BASE_RADIUS, 0)
      dummy.rotation.set(0, 0, angle - Math.PI / 2)
      dummy.scale.set(barWidth, height, 0.06)
      dummy.updateMatrix()
      this.barsMesh.setMatrixAt(i, dummy.matrix)

      // Secondary echo ring, offset by half a step so the two layers interleave.
      const innerAngle = angle + Math.PI / this.barCount
      dummy.position.set(Math.cos(innerAngle) * innerRadius, Math.sin(innerAngle) * innerRadius, -0.02)
      dummy.rotation.set(0, 0, innerAngle - Math.PI / 2)
      dummy.scale.set(barWidth * 0.58, Math.max(0.015, height * 0.42), 0.04)
      dummy.updateMatrix()
      this.barsInner.setMatrixAt(i, dummy.matrix)
    }
    this.barsMesh.instanceMatrix.needsUpdate = true
    this.barsInner.instanceMatrix.needsUpdate = true
  }

  /**
   * Render a single frame. Deterministic for a given frame payload, which is what
   * the export pipeline relies on to produce exactly what the preview shows.
   */
  private buildBarMeshes(count: number): void {
    this.barCount = count
    // Rounded caps read as "designed" instead of "debug lines".
    const barGeometry = new RoundedBoxGeometry(1, 1, 0.36, 2, 0.18)
    barGeometry.translate(0, 0.5, 0)
    this.barsMesh = new THREE.InstancedMesh(
      barGeometry,
      new THREE.MeshBasicMaterial({ vertexColors: false, toneMapped: false }),
      count,
    )
    this.barsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.barColors = new Float32Array(count * 3)
    this.barHeights = new Float32Array(count).fill(0.06)
    this.barsMesh.instanceColor = new THREE.InstancedBufferAttribute(this.barColors, 3)
    this.barsMesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    this.barsMesh.instanceMatrix.needsUpdate = true
    this.visualizerGroup.add(this.barsMesh)

    // Inner "echo" layer: shorter, additive bars offset by half a step.
    const innerGeometry = new RoundedBoxGeometry(1, 1, 0.3, 2, 0.15)
    innerGeometry.translate(0, 0.5, 0)
    this.barsInner = new THREE.InstancedMesh(
      innerGeometry,
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      count,
    )
    this.barsInner.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.barsInner.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    this.barsInner.instanceColor.setUsage(THREE.DynamicDrawUsage)
    this.visualizerGroup.add(this.barsInner)

    const palette = AVEE_THEMES[this.options.theme]
    this.writeBarColors(palette.primary, palette.secondary, palette.accent)
  }

  private rebuildBars(count: number): void {
    this.visualizerGroup.remove(this.barsMesh)
    this.visualizerGroup.remove(this.barsInner)
    this.barsMesh.geometry.dispose()
    ;(this.barsMesh.material as THREE.Material).dispose()
    this.barsInner.geometry.dispose()
    ;(this.barsInner.material as THREE.Material).dispose()
    this.buildBarMeshes(count)
  }

  /** Outline drawn around the selected layer (CapCut-style selection). */
  private buildSelectionFrame(): void {
    const points = [new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0), new THREE.Vector3(-0.5, 0.5, 0)]
    this.selectionFrame = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }),
    )
    this.selectionFrame.visible = false
    this.selectionFrame.renderOrder = 999
    this.visualizerGroup.parent?.add(this.selectionFrame)
  }

  /** Composition-level effects coming from the Effects panel. */
  public setEffects(effects: Partial<CompositionEffects>): void {
    this.effects = { ...this.effects, ...effects }
  }

  public setSelectedLayer(id: string | null): void {
    this.selectedLayerId = id
    this.updateSelectionFrame()
  }

  private updateSelectionFrame(): void {
    if (!this.selectionFrame) return
    const id = this.selectedLayerId
    const node = id ? this.layerNodes.get(id) : null
    let layer = node?.layer
    // The primary visualizer has no layer node; use the current one when selected.
    if (!layer && this.currentVisualizerLayer?.id === id) layer = this.currentVisualizerLayer
    if (!layer) {
      this.selectionFrame.visible = false
      return
    }
    const t = layer.transform
    this.selectionFrame.visible = true
    if (layer.type === 'visualizer') {
      const sizeWorld = 1.45 * 2
      this.selectionFrame.position.set(t.x * this.unit, -t.y * this.unit, this.visualizerGroup.position.z + 0.01)
      this.selectionFrame.scale.set(sizeWorld * Math.abs(t.scaleX), sizeWorld * Math.abs(t.scaleY), 1)
      this.selectionFrame.rotation.z = (t.rotation * Math.PI) / 180
      return
    }
    if (!node) {
      this.selectionFrame.visible = false
      return
    }
    this.selectionFrame.position.set(t.x * this.unit, -t.y * this.unit, node.object.position.z + 0.01)
    this.selectionFrame.scale.set(node.baseWidth * node.depthFactor * Math.abs(t.scaleX), node.baseHeight * node.depthFactor * Math.abs(t.scaleY), 1)
    this.selectionFrame.rotation.z = (t.rotation * Math.PI) / 180
  }

  private updateStageSize(): void {
    // Stage is measured at the rest distance so breathing never changes layer sizes.
    const distance = 7
    const height = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * distance
    this.stageHeight = height
    this.stageWidth = height * this.camera.aspect
    if (this.shaderScene) {
      this.shaderScene.resize(this.stageWidth * 1.35, this.stageHeight * 1.35)
    }
  }

  /** px of the 1080-high reference stage → world units. */
  private get unit(): number {
    return this.stageHeight / 1080
  }

  public setLayers(layers: StudioAnyLayer[]): void {
    const seen = new Set<string>()
    const seenVisualizers = new Set<string>()
    const renderable = layers.filter((layer): layer is StudioLayer => layer.type !== 'group')
    let visualizerIndex = 0
    renderable.forEach((layer, index) => {
      if (layer.type === 'visualizer') {
        seenVisualizers.add(layer.id)
        // The first visualizer owns the rich scene (logo, rings, particles); any
        // additional ones get their own lightweight spectrum ring.
        if (visualizerIndex === 0) this.applyVisualizerLayer(layer, index)
        else this.applyExtraVisualizer(layer, index)
        visualizerIndex += 1
        return
      }
      seen.add(layer.id)
      const key = this.layerKey(layer)
      let node: LayerNode | null | undefined = this.layerNodes.get(layer.id)
      if (node && node.key !== key) {
        this.disposeLayer(layer.id)
        node = undefined
      }
      if (!node) {
        node = this.createLayerNode(layer)
        if (!node) return
        this.layerNodes.set(layer.id, node)
      }
      node.layer = layer
      this.applyLayerTransform(node, layer, index)
      if (layer.type === 'image' && layer.waveAroundEnabled) this.ensureWaveRing(layer)
      else this.disposeWaveRing(layer.id)
    })
    for (const id of Array.from(this.layerNodes.keys())) {
      if (!seen.has(id)) this.disposeLayer(id)
    }
    for (const [id, entry] of Array.from(this.extraVisualizers.entries())) {
      if (seenVisualizers.has(id)) continue
      this.scene.remove(entry.ring.group)
      entry.ring.dispose()
      this.extraVisualizers.delete(id)
    }
    this.refreshLayerOpacity(this.lastTimeSec < 0 ? 0 : this.lastTimeSec)
  }

  /** 'Wave around image': a spectrum ring hugging an image layer. */
  private ensureWaveRing(layer: ImageLayer): void {
    let entry = this.waveRings.get(layer.id)
    if (!entry) {
      const ring = new SpectrumRing({ count: 96, radius: 1, colorA: 0x00f2fe, colorB: 0xfe0979 })
      entry = { ring, layer }
      this.waveRings.set(layer.id, entry)
      this.scene.add(ring.group)
    }
    entry.layer = layer
    const t = layer.transform
    const unit = this.unit
    entry.ring.group.position.set(t.x * unit, -t.y * unit, -2.3)
    entry.ring.group.rotation.z = (t.rotation * Math.PI) / 180
    entry.ring.group.visible = layer.visible
  }

  private disposeWaveRing(id: string): void {
    const entry = this.waveRings.get(id)
    if (!entry) return
    this.scene.remove(entry.ring.group)
    entry.ring.dispose()
    this.waveRings.delete(id)
  }

  private applyExtraVisualizer(layer: VisualizerLayer, index: number): void {
    const hex = (value: string): number => new THREE.Color(value).getHex()
    let entry = this.extraVisualizers.get(layer.id)
    if (!entry || entry.ring.count !== layer.barCount) {
      if (entry) {
        this.scene.remove(entry.ring.group)
        entry.ring.dispose()
      }
      const ring = new SpectrumRing({
        count: layer.barCount,
        radius: 1.15,
        colorA: hex(layer.color1),
        colorB: layer.colorMode === 'gradient' ? hex(layer.color2) : hex(layer.color1),
      })
      entry = { ring, layer }
      this.extraVisualizers.set(layer.id, entry)
      this.scene.add(ring.group)
    }
    entry.layer = layer
    entry.ring.setColors(hex(layer.color1), layer.colorMode === 'gradient' ? hex(layer.color2) : hex(layer.color1))
    const t = layer.transform
    const unit = this.unit
    entry.ring.group.position.set(t.x * unit, -t.y * unit, -2.2 + index * 0.02)
    entry.ring.group.scale.set(t.scaleX * (t.flipX ? -1 : 1), t.scaleY * (t.flipY ? -1 : 1), 1)
    entry.ring.group.rotation.z = (t.rotation * Math.PI) / 180
    entry.ring.group.visible = layer.visible
  }

  private layerKey(layer: Exclude<StudioLayer, { type: 'visualizer' }>): string {
    // Colour filters are baked into the texture, so a change has to rebuild the node.
    const filterKey = `${layer.filter.brightness}|${layer.filter.contrast}|${layer.filter.saturation}|${layer.filter.hue}|${layer.filter.grayscale}|${layer.filter.sepia}|${layer.filter.blur}`
    if (layer.type === 'particles') {
      return `particles:${layer.amount}:${layer.shape}:${layer.color}:${layer.sizeMin}:${layer.sizeMax}`
    }
    if (layer.type === 'text') {
      return `text:${layer.text}|${layer.fontSize}|${layer.color}|${layer.strokeColor}|${layer.strokeWidth}|${layer.fontWeight}|${layer.italic}|${layer.fontFamily}|${layer.textShadowBlur}|${layer.textShadowColor}|${layer.textShadowOffsetX}|${layer.textShadowOffsetY}|${filterKey}`
    }
    if (layer.type === 'lyrics') {
      return `lyrics:${layer.fontSize}:${layer.color}:${layer.showNeighbours}:${layer.lines.map((line) => `${line.timeSec}|${line.text}`).join('~')}`
    }
    const plate = layer.plate
    const plateKey = plate
      ? `${plate.cornerRadius}|${plate.borderWidth}|${plate.borderColor}|${plate.shadowBlur}|${plate.shadowColor}|${plate.shadowOffsetX}|${plate.shadowOffsetY}`
      : ''
    return `${layer.type}:${layer.src}:${layer.fitMode}|${filterKey}|${plateKey}`
  }

  private applyVisualizerLayer(layer: StudioLayer, index: number): void {
    if (layer.type !== 'visualizer') return
    this.currentVisualizerLayer = layer
    if (layer.barCount !== this.barCount) this.rebuildBars(layer.barCount)
    this.visualizerSensitivity = layer.sensitivity
    this.visualizerSpeed = layer.speed
    this.baseBloom = layer.glowEnabled ? 0.22 + layer.glowIntensity * 0.55 : 0.12
    this.bloomPass.strength = this.baseBloom
    let primaryColor = 0x00f2fe
    let secondaryColor = 0xfe0979
    if (layer.colorMode === 'rainbow') {
      const palette = AVEE_THEMES[this.options.theme]
      primaryColor = palette.primary
      secondaryColor = palette.secondary
      this.writeBarColors(palette.primary, palette.secondary, palette.accent)
    } else {
      const primary = new THREE.Color(layer.color1).getHex()
      const secondary = layer.colorMode === 'gradient' ? new THREE.Color(layer.color2).getHex() : primary
      primaryColor = primary
      secondaryColor = secondary
      this.writeBarColors(primary, secondary, primary)
    }
    const shaderActive = this.ensureShaderScene(layer.waveStyle, primaryColor, secondaryColor, AVEE_THEMES[this.options.theme]?.accent ?? 0xffffff)
    this.ensureFxStyle(shaderActive ? '' : layer.waveStyle, primaryColor, secondaryColor)
    const t = layer.transform
    const unit = this.unit
    this.visualizerGroup.position.set(t.x * unit, -t.y * unit, -2.2 + index * 0.02)
    this.visualizerGroup.scale.set(t.scaleX * (t.flipX ? -1 : 1), t.scaleY * (t.flipY ? -1 : 1), 1)
    this.visualizerGroup.rotation.z = (t.rotation * Math.PI) / 180
    this.visualizerGroup.visible = layer.visible
  }

  /** Full-frame shader scenes (grid / polar) drawn behind every layer. */
  private ensureShaderScene(style: string, colorA: number, colorB: number, accent: number): boolean {
    if (!isShaderScene(style)) {
      if (this.shaderScene) {
        this.visualizerGroup.remove(this.shaderScene.object)
        this.shaderScene.dispose()
        this.shaderScene = null
        this.shaderSceneKey = ''
      }
      return false
    }
    const key = `${style}:${colorA}:${colorB}:${accent}`
    if (this.shaderScene && this.shaderSceneKey === key) {
      if (this.barsMesh) this.barsMesh.visible = false
      if (this.barsInner) this.barsInner.visible = false
      return true
    }
    if (this.shaderScene) {
      this.visualizerGroup.remove(this.shaderScene.object)
      this.shaderScene.dispose()
    }
    this.shaderScene = new ShaderScene(style, colorA, colorB, accent)
    this.shaderScene.object.position.set(0, 0, 0)
    this.shaderScene.resize(this.stageWidth * 1.35, this.stageHeight * 1.35)
    this.shaderSceneKey = key
    this.visualizerGroup.add(this.shaderScene.object)
    return true
  }

  /**
   * The "fx" wave styles (waveform/tunnel/orbit/pulse/mirror) are standalone scene
   * objects. The ring styles keep using the instanced bars, so only one path is ever
   * visible at a time.
   */
  private ensureFxStyle(style: string, colorA: number, colorB: number): void {
    const wanted = isFxStyle(style) ? style : null
    if (!wanted) {
      if (this.fxStyle) {
        this.visualizerGroup.remove(this.fxStyle.object)
        this.fxStyle.dispose()
        this.fxStyle = null
        this.fxStyleKey = ''
      }
      if (this.barsMesh) this.barsMesh.visible = !this.shaderScene
      if (this.barsInner) this.barsInner.visible = !this.shaderScene
      return
    }
    if (this.barsMesh) this.barsMesh.visible = false
    if (this.barsInner) this.barsInner.visible = false
    this.fxColorA = colorA
    this.fxColorB = colorB
    const key = `${wanted}:${colorA}:${colorB}`
    if (this.fxStyle && this.fxStyleKey === key) return
    if (this.fxStyle) {
      this.visualizerGroup.remove(this.fxStyle.object)
      this.fxStyle.dispose()
    }
    this.fxStyle = createFxStyle(wanted, colorA, colorB)
    this.fxStyleKey = key
    this.visualizerGroup.add(this.fxStyle.object)
  }

  private applyLayerTransform(node: LayerNode, layer: Exclude<StudioLayer, { type: 'visualizer' }>, index: number): void {
    const t = layer.transform
    const unit = this.unit
    node.lastTransform = t
    // Array order is the stacking order: index 0 sits at the bottom.
    const z = -2.2 + index * 0.02
    node.depthFactor = (7 - z) / 7
    node.object.position.set(t.x * unit, -t.y * unit, z)
    node.object.scale.set(
      node.baseWidth * node.depthFactor * t.scaleX * (t.flipX ? -1 : 1),
      node.baseHeight * node.depthFactor * t.scaleY * (t.flipY ? -1 : 1),
      1,
    )
    node.object.rotation.z = (t.rotation * Math.PI) / 180
    node.object.visible = layer.visible
    // Anchor decides which point of the plate sits on transform.x/y.
    const anchor = (layer as { plate?: { anchor?: string } }).plate?.anchor
    if (anchor && anchor !== 'center') {
      const ax = anchor.includes('left') ? -0.5 : anchor.includes('right') ? 0.5 : 0
      const ay = anchor.startsWith('top') ? 0.5 : anchor.startsWith('bottom') ? -0.5 : 0
      const widthWorld = node.baseWidth * node.depthFactor * Math.abs(t.scaleX)
      const heightWorld = node.baseHeight * node.depthFactor * Math.abs(t.scaleY)
      node.object.position.x += ax * widthWorld
      node.object.position.y += ay * heightWorld
    }
    // Particles use a ShaderMaterial without a `color` uniform exposed as Material.color,
    // so only tint materials that actually have one.
    const material = (node.object as THREE.Mesh).material as THREE.MeshBasicMaterial | THREE.ShaderMaterial | undefined
    if (material) {
      material.opacity = layer.filter.opacity
      // Media plates sit under a global bloom pass; full brightness washes the frame out.
      // Colour filters are baked into the texture already, so only dim here.
      const dim = layer.type === 'image' || layer.type === 'video' ? 0.65 : 1
      const color = (material as THREE.MeshBasicMaterial).color
      if (color && typeof color.setScalar === 'function') color.setScalar(dim)
    }
  }

  /** Flat spectrum along the bottom of the frame. */
  private updateBottomBars(frame: SongNhacAudioFrame): void {
    const data = frame.frequencyData
    const dataLength = Math.min(data.length, 180)
    const dummy = new THREE.Object3D()
    const usableWidth = this.stageWidth * 0.82
    const barWidth = (usableWidth / this.barCount) * 0.72
    let peak = 0
    for (let i = 0; i < dataLength; i += 1) if (data[i] > peak) peak = data[i]
    const gain = peak > 8 ? 255 / peak : 1
    for (let i = 0; i < this.barCount; i += 1) {
      const t = i / Math.max(1, this.barCount - 1)
      const freqIndex = Math.min(dataLength - 1, Math.floor(t * dataLength))
      const raw = Math.min(1, ((data[freqIndex] ?? 0) * gain) / 255)
      const target = 0.05 + Math.pow(raw, 0.65) * this.stageHeight * 0.42 * this.visualizerSensitivity
      this.barHeights[i] += (target - this.barHeights[i]) * 0.35
      const x = -usableWidth / 2 + t * usableWidth
      dummy.position.set(x, -this.stageHeight * 0.46, 0)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(barWidth, Math.max(0.02, this.barHeights[i]), 0.06)
      dummy.updateMatrix()
      this.barsMesh.setMatrixAt(i, dummy.matrix)
      dummy.scale.set(barWidth * 0.5, Math.max(0.015, this.barHeights[i] * 0.42), 0.04)
      dummy.updateMatrix()
      this.barsInner.setMatrixAt(i, dummy.matrix)
    }
    this.barsMesh.instanceMatrix.needsUpdate = true
    this.barsInner.instanceMatrix.needsUpdate = true
  }

  /** Ring of dots whose brightness follows the spectrum. */
  private updateRingDots(frame: SongNhacAudioFrame): void {
    const data = frame.frequencyData
    const dataLength = Math.min(data.length, 180)
    const half = Math.floor(this.barCount / 2)
    const dummy = new THREE.Object3D()
    let peak = 0
    for (let i = 0; i < dataLength; i += 1) if (data[i] > peak) peak = data[i]
    const gain = peak > 8 ? 255 / peak : 1
    for (let i = 0; i < this.barCount; i += 1) {
      const mirrored = i < half ? half - 1 - i : i - half
      const normalized = Math.pow(mirrored / Math.max(1, half - 1), 1.2)
      const freqIndex = dataLength > 0 ? Math.min(dataLength - 1, Math.floor(normalized * dataLength)) : -1
      const raw = freqIndex >= 0 ? Math.min(1, ((data[freqIndex] ?? 0) * gain) / 255) : 0
      const size = 0.045 + Math.pow(raw, 0.8) * 0.16 * this.visualizerSensitivity
      const angle = (i / this.barCount) * Math.PI * 2 - Math.PI / 2
      dummy.position.set(Math.cos(angle) * BAR_BASE_RADIUS, Math.sin(angle) * BAR_BASE_RADIUS, 0)
      dummy.rotation.set(0, 0, angle - Math.PI / 2)
      dummy.scale.set(size, size, size)
      dummy.updateMatrix()
      this.barsMesh.setMatrixAt(i, dummy.matrix)
      dummy.scale.set(size * 0.5, size * 0.5, size * 0.5)
      dummy.updateMatrix()
      this.barsInner.setMatrixAt(i, dummy.matrix)
    }
    this.barsMesh.instanceMatrix.needsUpdate = true
    this.barsInner.instanceMatrix.needsUpdate = true
  }

  /** Image plates can breathe with the kick drum. */
  private applyBeatPulse(frame: SongNhacAudioFrame): void {
    const bass = Math.max(0, Math.min(1, frame.bass))
    for (const node of this.layerNodes.values()) {
      const layer = node.layer
      if (!layer || layer.type !== 'image' || !layer.beatPulse) continue
      const t = layer.transform
      const pulse = 1 + bass * layer.beatIntensity * 0.25
      node.object.scale.set(
        node.baseWidth * node.depthFactor * t.scaleX * pulse * (t.flipX ? -1 : 1),
        node.baseHeight * node.depthFactor * t.scaleY * pulse * (t.flipY ? -1 : 1),
        1,
      )
    }
  }

  /** Keyframe automations override transform/opacity for the current time. */
  private applyAutomations(timeSec: number): void {
    for (const node of this.layerNodes.values()) {
      const layer = node.layer
      const automations = layer?.automations
      if (!layer || !automations || !automations.length) continue
      const value = (property: string): number | null => {
        const automation = automations.find((item) => item.property === property)
        return automation ? evaluateAutomation(automation, timeSec) : null
      }
      const scaleX = value('scaleX')
      const scaleY = value('scaleY')
      const posX = value('x')
      const posY = value('y')
      const rotation = value('rotation')
      const t = layer.transform
      const unit = this.unit
      if (posX !== null || posY !== null) {
        node.object.position.x = (posX !== null ? posX : t.x) * unit
        node.object.position.y = -(posY !== null ? posY : t.y) * unit
      }
      if (scaleX !== null || scaleY !== null) {
        node.object.scale.set(
          node.baseWidth * node.depthFactor * (scaleX !== null ? scaleX : t.scaleX) * (t.flipX ? -1 : 1),
          node.baseHeight * node.depthFactor * (scaleY !== null ? scaleY : t.scaleY) * (t.flipY ? -1 : 1),
          1,
        )
      }
      if (rotation !== null) node.object.rotation.z = (rotation * Math.PI) / 180
      const opacity = value('opacity')
      if (opacity !== null) {
        const material = (node.object as THREE.Mesh).material as THREE.Material | undefined
        // refreshLayerOpacity already set the base value for this frame, so scale it.
        if (material) material.opacity *= Math.max(0, Math.min(1, opacity))
      }
    }
  }
  /** Per-frame time fade + filter opacity; called from render(). */
  private refreshLayerOpacity(timeSec: number): void {
    for (const node of this.layerNodes.values()) {
      const layer = node.layer
      if (!layer) continue
      const fade = getLayerTimeOpacity(layer, timeSec)
      const material = (node.object as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined
      node.object.visible = layer.visible && fade >= 0
      if (material) {
        const base = layer.type === 'visualizer' ? (layer as VisualizerLayer).opacity : 1
        material.opacity = Math.max(0, Math.min(1, (fade < 0 ? 0 : fade) * layer.filter.opacity * base))
      }
    }
    const viz = this.currentVisualizerLayer
    if (viz) {
      const fade = getLayerTimeOpacity(viz, timeSec)
      this.visualizerGroup.visible = viz.visible && fade >= 0
    }
  }

  private createLayerNode(layer: Exclude<StudioLayer, { type: 'visualizer' }>): LayerNode | null {
    if (layer.type === 'text') return this.createTextNode(layer)
    if (layer.type === 'particles') return this.createParticlesNode(layer)
    if (layer.type === 'lyrics') return this.createLyricsNode(layer)

    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
    const node: LayerNode = {
      object: mesh,
      key: this.layerKey(layer),
      baseWidth: this.stageWidth,
      baseHeight: this.stageHeight,
      depthFactor: (7 + 2) / 7,
      layer,
      dispose: () => {
        const map = material.map
        material.dispose()
        mesh.geometry.dispose()
        if (map) map.dispose()
      },
    }

    if (layer.type === 'image') {
      // fetch + createImageBitmap works for http(s) and the app:// protocol, but the CSP
      // blocks data: URLs in connect-src, so those go through an <img> element instead.
      const source: Promise<ImageBitmap> = layer.src.startsWith('data:')
        ? new Promise<ImageBitmap>((resolve, reject) => {
            const image = new Image()
            image.onload = () => {
              createImageBitmap(image).then(resolve).catch(reject)
            }
            image.onerror = () => reject(new Error('Không đọc được ảnh stock.'))
            image.src = layer.src
          })
        : fetch(layer.src)
            .then((response) => response.blob())
            .then((blob) => createImageBitmap(blob))
      source
        .then((bitmap) => {
          if (this.isDisposed) {
            bitmap.close()
            return
          }
          // Bake brightness/contrast/saturation/hue/grayscale/sepia/blur into the bitmap:
          // MeshBasicMaterial has no CSS filter, and doing it here keeps the shader cheap.
          const plate = layer.plate
          const blur = Math.max(0, plate?.shadowBlur ?? 0)
          const border = Math.max(0, plate?.borderWidth ?? 0)
          const pad =
            Math.ceil(blur + border + Math.abs(plate?.shadowOffsetX ?? 0) + Math.abs(plate?.shadowOffsetY ?? 0)) + 2
          // Bake the colour filter plus the plate chrome (rounded corners, border, drop
          // shadow) once, so the material stays a plain textured quad.
          const baked = document.createElement('canvas')
          baked.width = bitmap.width + pad * 2
          baked.height = bitmap.height + pad * 2
          const bakedCtx = baked.getContext('2d')
          let textureSource: HTMLCanvasElement | ImageBitmap = bitmap
          if (bakedCtx) {
            const radius = Math.min(Math.max(0, plate?.cornerRadius ?? 0), Math.min(bitmap.width, bitmap.height) / 2)
            const path = new Path2D()
            const x0 = pad
            const y0 = pad
            const w0 = bitmap.width
            const h0 = bitmap.height
            path.moveTo(x0 + radius, y0)
            path.lineTo(x0 + w0 - radius, y0)
            path.quadraticCurveTo(x0 + w0, y0, x0 + w0, y0 + radius)
            path.lineTo(x0 + w0, y0 + h0 - radius)
            path.quadraticCurveTo(x0 + w0, y0 + h0, x0 + w0 - radius, y0 + h0)
            path.lineTo(x0 + radius, y0 + h0)
            path.quadraticCurveTo(x0, y0 + h0, x0, y0 + h0 - radius)
            path.lineTo(x0, y0 + radius)
            path.quadraticCurveTo(x0, y0, x0 + radius, y0)
            path.closePath()

            if (blur > 0) {
              bakedCtx.save()
              bakedCtx.shadowColor = plate?.shadowColor ?? '#000000'
              bakedCtx.shadowBlur = blur
              bakedCtx.shadowOffsetX = plate?.shadowOffsetX ?? 0
              bakedCtx.shadowOffsetY = plate?.shadowOffsetY ?? 0
              bakedCtx.fillStyle = '#000000'
              bakedCtx.fill(path)
              bakedCtx.restore()
            }

            bakedCtx.save()
            bakedCtx.clip(path)
            bakedCtx.filter = buildCssFilter(layer.filter)
            bakedCtx.drawImage(bitmap, x0, y0)
            bakedCtx.restore()

            if (border > 0) {
              bakedCtx.save()
              bakedCtx.lineWidth = border
              bakedCtx.strokeStyle = plate?.borderColor ?? '#ffffff'
              bakedCtx.stroke(path)
              bakedCtx.restore()
            }
            textureSource = baked
          }
          const texture = new THREE.Texture(textureSource as unknown as HTMLCanvasElement)
          texture.colorSpace = THREE.SRGBColorSpace
          texture.needsUpdate = true
          material.map = texture
          material.needsUpdate = true
          const fitted = fitSize(bitmap.width, bitmap.height, this.stageWidth / this.unit, this.stageHeight / this.unit, layer.fitMode)
          node.baseWidth = fitted.width * this.unit
          node.baseHeight = fitted.height * this.unit
          const lt = node.lastTransform
          mesh.scale.set(
            node.baseWidth * node.depthFactor * (lt?.scaleX ?? 1) * (lt?.flipX ? -1 : 1),
            node.baseHeight * node.depthFactor * (lt?.scaleY ?? 1) * (lt?.flipY ? -1 : 1),
            1,
          )
          node.layer = { ...layer, naturalWidth: bitmap.width, naturalHeight: bitmap.height }
        })
        .catch(() => {
          material.color.set('#111827')
        })
    } else {
      const video = document.createElement('video')
      video.src = layer.src
      video.muted = layer.muted
      video.loop = layer.loop
      video.volume = layer.volume
      video.playsInline = true
      video.crossOrigin = 'anonymous'
      void video.play().catch(() => undefined)

      if (hasColorFilter(layer.filter)) {
        // MeshBasicMaterial has no CSS filter; draw the video through a filtered canvas
        // once per frame. Capped at 1080p so a 4K source cannot stall the loop.
        const bakeCanvas = document.createElement('canvas')
        const bakeCtx = bakeCanvas.getContext('2d')
        const bakeTexture = new THREE.Texture(bakeCanvas)
        bakeTexture.colorSpace = THREE.SRGBColorSpace
        material.map = bakeTexture
        node.tick = () => {
          if (!bakeCtx || video.readyState < 2) return
          const width = Math.min(1920, video.videoWidth || 1920)
          const height = Math.round((width / Math.max(1, video.videoWidth || 16)) * (video.videoHeight || 9))
          if (bakeCanvas.width !== width || bakeCanvas.height !== height) {
            bakeCanvas.width = width
            bakeCanvas.height = height
          }
          bakeCtx.filter = buildCssFilter(layer.filter)
          bakeCtx.drawImage(video, 0, 0, width, height)
          bakeTexture.needsUpdate = true
        }
        const previousDispose = node.dispose
        node.dispose = () => {
          video.pause()
          video.src = ''
          bakeTexture.dispose()
          previousDispose()
        }
        this.scene.add(mesh)
        return node
      }

      const texture = new THREE.VideoTexture(video)
      texture.colorSpace = THREE.SRGBColorSpace
      material.map = texture
      const previousDispose = node.dispose
      node.dispose = () => {
        video.pause()
        video.src = ''
        previousDispose()
      }
    }

    this.scene.add(mesh)
    return node
  }

  /**
   * Lyric overlay: re-bakes its canvas only when the active line changes, so a pasted
   * lyric costs one draw call per line instead of one per frame.
   */
  private createLyricsNode(layer: LyricsLayer): LayerNode {
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 360
    const ctx = canvas.getContext('2d')
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    // Lyrics are an overlay: draw last and ignore depth, otherwise the ring and the
    // logo plate would cover them.
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
    mesh.renderOrder = 999
    this.scene.add(mesh)
    let lastIndex = -2
    const baseWidth = this.stageWidth * 0.92
    const node: LayerNode = {
      object: mesh,
      key: this.layerKey(layer),
      baseWidth,
      baseHeight: (baseWidth * canvas.height) / canvas.width,
      depthFactor: 1,
      layer,
      tick: () => {
        const index = activeLyricIndex(layer.lines, this.lastTimeSec)
        if (index === lastIndex) return
        lastIndex = index
        this.drawLyricsCanvas(ctx, layer, index)
        texture.needsUpdate = true
      },
      dispose: () => {
        texture.dispose()
        material.dispose()
        mesh.geometry.dispose()
      },
    }
    this.drawLyricsCanvas(ctx, layer, -1)
    return node
  }

  private drawLyricsCanvas(ctx: CanvasRenderingContext2D | null, layer: LyricsLayer, index: number): void {
    if (!ctx) return
    const { width, height } = ctx.canvas
    ctx.clearRect(0, 0, width, height)
    const current = layer.lines[index]
    if (!current) return
    const scale = width / 1280
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)'
    ctx.shadowBlur = 18
    ctx.fillStyle = layer.color
    ctx.font = `${Math.max(10, Math.round(layer.fontSize * scale))}px system-ui, sans-serif`
    ctx.fillText(current.text, width / 2, height / 2)
    if (layer.showNeighbours) {
      ctx.fillStyle = `${layer.color}99`
      ctx.font = `${Math.max(8, Math.round(layer.fontSize * 0.6 * scale))}px system-ui, sans-serif`
      const previous = layer.lines[index - 1]
      const next = layer.lines[index + 1]
      if (previous) ctx.fillText(previous.text, width / 2, height / 2 - layer.fontSize * 1.2 * scale)
      if (next) ctx.fillText(next.text, width / 2, height / 2 + layer.fontSize * 1.2 * scale)
    }
  }

  /**
   * Particle field owned by a layer: the panel exposes amount, shape, size/opacity
   * ranges, drift, spread and a kick-drum boost, so it behaves like the reference
   * editor's Particles object instead of a fixed background effect.
   */
  private createParticlesNode(layer: ParticlesLayer): LayerNode {
    const amount = Math.max(20, Math.min(4000, Math.round(layer.amount)))
    const positions = new Float32Array(amount * 3)
    const seeds = new Float32Array(amount)
    const sizes = new Float32Array(amount)
    const alphas = new Float32Array(amount)
    const spread = Math.max(0.5, layer.spread)
    for (let i = 0; i < amount; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * spread
      positions[i * 3 + 1] = (Math.random() - 0.5) * 3.2
      positions[i * 3 + 2] = (Math.random() - 0.5) * 1.2
      seeds[i] = Math.random() * Math.PI * 2
      sizes[i] = layer.sizeMin + Math.random() * Math.max(0, layer.sizeMax - layer.sizeMin)
      alphas[i] = layer.opacityMin + Math.random() * Math.max(0, layer.opacityMax - layer.opacityMin)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(layer.color) },
        uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
        uShape: { value: layer.shape === 'square' ? 1 : layer.shape === 'star' ? 2 : 0 },
        uMirror: { value: layer.mirror ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(26.0, aSize * uPixelRatio * (60.0 / max(1.0, -mv.z)));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColor;
        uniform float uShape;
        uniform float uMirror;
        varying float vAlpha;
        void main() {
          vec2 coord = gl_PointCoord - 0.5;
          float dist = length(coord);
          float mask = smoothstep(0.5, 0.1, dist);
          if (uShape > 1.5) {
            // star: four soft spikes
            float star = max(0.0, 1.0 - min(abs(coord.x) * 6.0, abs(coord.y) * 6.0));
            mask = max(mask * 0.35, star * 0.9);
          } else if (uShape > 0.5) {
            mask = step(max(abs(coord.x), abs(coord.y)), 0.35);
          }
          if (mask <= 0.001) discard;
          gl_FragColor = vec4(uColor, mask * vAlpha);
        }
      `,
    })

    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    const node: LayerNode = {
      object: points,
      key: `particles:${amount}:${layer.shape}:${layer.color}`,
      baseWidth: spread,
      baseHeight: 3.2,
      depthFactor: 1,
      layer,
      tick: () => {
        const frame = this.lastFrame
        const beat = frame ? this.bandEnergy(frame, this.analyzerOf(layer)) : 0
        const dt = this.lastDelta
        const position = geometry.getAttribute('position') as THREE.BufferAttribute
        const data = position.array as Float32Array
        const drift = layer.speed * dt
        for (let i = 0; i < amount; i += 1) {
          const yIndex = i * 3 + 1
          data[yIndex] -= drift + layer.gravity * dt
          data[i * 3] += Math.sin(seeds[i] + this.lastTimeSec * 0.8) * 0.0025
          if (data[yIndex] < -1.9) data[yIndex] = 1.9
          if (data[yIndex] > 1.9) data[yIndex] = -1.9
        }
        position.needsUpdate = true
        material.uniforms.uMirror.value = layer.mirror ? 1 : 0
        const boost = 1 + beat * layer.beatBoost
        material.uniforms.uPixelRatio.value = Math.min(2, window.devicePixelRatio || 1) * boost
      },
      dispose: () => {
        geometry.dispose()
        material.dispose()
      },
    }
    return node
  }

  private createTextNode(layer: Extract<StudioLayer, { type: 'text' }>): LayerNode {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const style = layer.italic ? 'italic' : 'normal'
    const font = `${style} ${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`
    const padding = Math.ceil(layer.fontSize * 0.5)
    let width = 512
    let height = Math.ceil(layer.fontSize * 1.6)

    if (ctx) {
      ctx.font = font
      width = Math.ceil(ctx.measureText(layer.text || ' ').width + padding * 2)
      canvas.width = width
      canvas.height = height
      ctx.clearRect(0, 0, width, height)
      ctx.filter = buildCssFilter(layer.filter)
      ctx.font = font
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      if (layer.textShadowBlur > 0) {
        ctx.shadowColor = layer.textShadowColor
        ctx.shadowBlur = layer.textShadowBlur
        ctx.shadowOffsetX = layer.textShadowOffsetX
        ctx.shadowOffsetY = layer.textShadowOffsetY
      }
      if (layer.strokeWidth > 0) {
        ctx.lineWidth = layer.strokeWidth
        ctx.strokeStyle = layer.strokeColor
        ctx.strokeText(layer.text, width / 2, height / 2)
      }
      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, width / 2, height / 2)
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)

    // Canvas pixels are authored at 1080p scale, matching the transform unit.
    const baseWidth = width * this.unit
    const baseHeight = height * this.unit
    mesh.scale.set(baseWidth, baseHeight, 1)

    const node: LayerNode = {
      object: mesh,
      key: this.layerKey(layer),
      baseWidth,
      baseHeight,
      depthFactor: (7 - 1.5) / 7,
      layer,
      dispose: () => {
        texture.dispose()
        material.dispose()
        mesh.geometry.dispose()
      },
    }
    this.scene.add(mesh)
    return node
  }

  private disposeLayer(id: string): void {
    const node = this.layerNodes.get(id)
    if (!node) return
    this.scene.remove(node.object)
    node.dispose()
    this.layerNodes.delete(id)
  }

  /** Diagnostic snapshot of the layer graph (used by the preview harness). */
  /**
   * Bounding box of a layer in the 1080-high reference space (same units as
   * transform.x/y), so the DOM gizmo can draw handles over the canvas.
   */
  public getLayerBoundsPx(id: string): { x: number; y: number; width: number; height: number; rotation: number } | null {
    const node = this.layerNodes.get(id)
    const layer = node?.layer
    if (!node || !layer || layer.type === 'visualizer') return null
    const t = layer.transform
    const unit = this.unit
    const width = (node.baseWidth * node.depthFactor * Math.abs(t.scaleX)) / unit
    const height = (node.baseHeight * node.depthFactor * Math.abs(t.scaleY)) / unit
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
    return { x: t.x - width / 2, y: t.y - height / 2, width, height, rotation: t.rotation }
  }

  public debugLayers(): Array<{ id: string; type: string; visible: boolean; z: number; sx: number; sy: number; hasMap: boolean }> {
    return Array.from(this.layerNodes.entries()).map(([id, node]) => {
      const mesh = node.object as THREE.Mesh
      const material = mesh.material as THREE.MeshBasicMaterial
      const map = material?.map as THREE.Texture | null
      return {
        id,
        type: material ? 'mesh' : 'unknown',
        visible: node.object.visible,
        z: Number(node.object.position.z.toFixed(2)),
        sx: Number(node.object.scale.x.toFixed(2)),
        sy: Number(node.object.scale.y.toFixed(2)),
        hasMap: Boolean(map && (map.image as { width?: number } | undefined)?.width),
      }
    })
  }

  public render(frame: SongNhacAudioFrame): void {
    if (this.isDisposed) return
    // Drawing into a lost context only spams GL errors; wait for `webglcontextrestored`.
    if (this.contextLost) return
    this.lastFrame = frame
    const timeSec = Number.isFinite(frame.timeSec) ? frame.timeSec : 0
    const dt = this.lastTimeSec < 0 ? 1 / 60 : Math.max(0, Math.min(0.25, timeSec - this.lastTimeSec))
    this.lastTimeSec = timeSec
    this.lastDelta = dt

    const intensity = this.options.intensity
    const bass = Math.max(0, Math.min(1, frame.bass))
    const beat = Math.max(0, Math.min(1, frame.beat))

    // Logo pulse
    const targetScale = 1 + (bass * 0.28 + beat * 0.14) * intensity
    this.currentLogoScale += (targetScale - this.currentLogoScale) * Math.min(1, dt * 14)
    this.logoMesh.scale.setScalar(this.currentLogoScale)
    this.logoBackdrop.scale.setScalar(this.currentLogoScale)
    this.innerRing.scale.setScalar(this.currentLogoScale)
    this.logoGlow.scale.setScalar(DEFAULT_RADIUS * 2.6 * this.currentLogoScale)
    ;(this.logoGlow.material as THREE.SpriteMaterial).opacity = 0.16 + bass * 0.3

    // Camera breathing
    const targetZ = 7 - (bass * 0.7 + beat * 0.3) * intensity
    this.currentCameraZ += (targetZ - this.currentCameraZ) * Math.min(1, dt * 10)
    this.camera.position.z = this.currentCameraZ
    this.camera.rotation.z = Math.sin(timeSec * 9) * beat * 0.01 * intensity
    const shake = this.effects.shake * beat
    this.camera.position.x = Math.sin(timeSec * 47) * 0.06 * shake
    this.camera.position.y = Math.cos(timeSec * 41) * 0.06 * shake

    this.outerRing.rotation.z = timeSec * this.visualizerSpeed * 0.18
    this.backgroundMaterial.uniforms.uPulse.value = bass * intensity
    // Beat grade: bloom swells on the kick, the outer ring nudges outward and the
    // whole ring set gets a slow drift so a still frame never looks frozen.
    this.bloomPass.strength = this.baseBloom * (1 + beat * 0.35 * intensity)
    this.outerRing.scale.setScalar(1 + bass * 0.05 * intensity)
    this.barsMesh.rotation.z = Math.sin(timeSec * 0.15) * 0.015 + beat * 0.008
    if (this.finishPass) {
      this.finishPass.time = timeSec
      // The grade breathes with the kick drum, just enough to feel alive.
      this.finishPass.aberration = 0.0005 + bass * 0.0012 * intensity
      this.finishPass.blur = this.effects.blur
      this.finishPass.alpha = this.effects.alpha
      this.finishPass.tint = this.effects.tint
      this.finishPass.tintStrength = this.effects.tintStrength
      this.finishPass.mirror = this.effects.mirror
      this.finishPass.zoom = this.effects.zoom
      // Blur can run either inside the grade (single 9-tap) or as two separable passes.
      const twoPass = this.effects.blurMode === 'two-pass' && this.effects.blur > 0.001
      this.finishPass.blur = twoPass ? 0 : this.effects.blur
      if (this.blurPassH && this.blurPassV) {
        this.blurPassH.enabled = twoPass
        this.blurPassV.enabled = twoPass
        if (twoPass) {
          const radius = Math.max(0.5, this.effects.blur * 6)
          this.blurPassH.radius = radius
          this.blurPassV.radius = radius
          const blurSize = this.renderer.getSize(new THREE.Vector2())
          this.blurPassH.width = blurSize.x
          this.blurPassH.height = blurSize.y
          this.blurPassV.width = blurSize.x
          this.blurPassV.height = blurSize.y
        }
      }
      if (this.fxaaPass) {
        this.fxaaPass.enabled = this.effects.fxaa
        const resolution = this.fxaaPass.material.uniforms.resolution
        const fxaaSize = this.renderer.getSize(new THREE.Vector2())
        if (resolution) resolution.value.set(1 / Math.max(1, fxaaSize.x), 1 / Math.max(1, fxaaSize.y))
      }
    }

    // timeRange fade + filter opacity are per-frame values, not layout state.
    this.refreshLayerOpacity(timeSec)
    this.applyAutomations(timeSec)
    this.applyBeatPulse(frame)
    this.updateSelectionFrame()

    for (const node of this.layerNodes.values()) node.tick?.()
    for (const entry of this.extraVisualizers.values()) {
      if (entry.layer.visible) entry.ring.update(frame, entry.layer.sensitivity)
    }
    for (const [id, entry] of this.waveRings.entries()) {
      const node = this.layerNodes.get(id)
      const layer = node?.layer
      if (!node || !layer || layer.type !== 'image') continue
      const t = layer.transform
      // Hug the *displayed* image size, not the raw fitted size.
      const radius = Math.max(node.baseWidth * Math.abs(t.scaleX), node.baseHeight * Math.abs(t.scaleY)) * 0.55
      entry.ring.setRadius(radius)
      entry.ring.group.position.set(t.x * this.unit, -t.y * this.unit, node.object.position.z + 0.02)
      entry.ring.group.rotation.z = (t.rotation * Math.PI) / 180
      entry.ring.update(frame, 1)
    }
    if (this.shaderScene) {
      this.shaderScene.update(
        frame,
        { colorA: this.fxColorA, colorB: this.fxColorB, intensity, speed: this.visualizerSpeed },
        timeSec,
      )
    }
    if (this.fxStyle) {
      this.fxStyle.update(
        frame,
        {
          colorA: this.fxColorA,
          colorB: this.fxColorB,
          sensitivity: this.visualizerSensitivity,
          speed: this.visualizerSpeed,
          intensity,
        },
        dt,
      )
    } else if (this.options.showBars) {
      this.updateBars(frame)
    }
    if (this.options.showParticles) this.positionParticles(timeSec)

    this.composer.render()
  }

  public dispose(): void {
    this.isDisposed = true
    for (const id of Array.from(this.layerNodes.keys())) this.disposeLayer(id)
    for (const entry of this.extraVisualizers.values()) {
      this.scene.remove(entry.ring.group)
      entry.ring.dispose()
    }
    this.extraVisualizers.clear()
    for (const entry of this.waveRings.values()) {
      this.scene.remove(entry.ring.group)
      entry.ring.dispose()
    }
    this.waveRings.clear()
    this.scene.clear()
    this.composer.dispose()
    this.renderer.dispose()
    this.defaultTexture.dispose()
    this.glowTexture.dispose()
    this.dotTexture.dispose()
    if (this.customTexture) this.customTexture.dispose()
  }
}

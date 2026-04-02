/**
 * Three.js Visualizer Engine — Professional 3D Audio Visualizer.
 *
 * Architecture:
 * - PerspectiveCamera with slow orbit animation for true 3D depth
 * - CylinderGeometry bars with rounded caps (Avee Player quality)
 * - InstancedMesh for all bars (1 draw call, GPU-instanced)
 * - Reflective ground plane with fading mirror effect
 * - Audio-reactive particle system (floating embers)
 * - DataTexture for FFT data upload (zero-copy to GPU)
 * - EffectComposer: RenderPass → UnrealBloomPass → OutputPass
 * - ACESFilmic tone mapping for cinematic HDR look
 * - AudioSmoother for asymmetric attack/decay + log frequency mapping
 *
 * Implements the same VisualizerEngine interface as WaveBarsEngine
 * so it can be swapped in via EngineHost.
 */

// Three.js and postprocessing lazy-loaded to avoid bundling ~800KB
import type * as THREEType from 'three'
import type { EffectComposer as EffectComposerType } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import type { UnrealBloomPass as UnrealBloomPassType } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { AudioSmoother } from './audioSmoothing'
import type { Size, EngineRenderFrame } from '../types'
import { THREEJS_PRESETS, DEFAULT_THREEJS_PRESET, type ThreeJsPresetId, type ThreeJsPreset } from './threejsPresets'

// Cache to avoid re-importing
let _THREE: typeof THREEType | null = null
let _EffectComposer: typeof EffectComposerType | null = null

async function getThree() {
  if (!_THREE) {
    _THREE = await import('three')
  }
  return _THREE
}

async function getPostprocessing() {
  const [THREE, ecMod, rpMod, ubpMod, opMod] = await Promise.all([
    getThree(),
    import('three/examples/jsm/postprocessing/EffectComposer.js'),
    import('three/examples/jsm/postprocessing/RenderPass.js'),
    import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
    import('three/examples/jsm/postprocessing/OutputPass.js'),
  ])
  return {
    THREE,
    EffectComposer: ecMod.EffectComposer,
    RenderPass: rpMod.RenderPass,
    UnrealBloomPass: ubpMod.UnrealBloomPass,
    OutputPass: opMod.OutputPass,
  }
}

// ─── GLSL Shaders ───────────────────────────────────────────────────────────

const barVertShader = /* glsl */ `
varying float vInstanceId;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;

void main() {
  vInstanceId = float(gl_InstanceID);
  vNormal = normalize(normalMatrix * normal);

  vec4 worldPos = instanceMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;

  // Extract Y scale from instance matrix (bar height)
  vHeight = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));

  gl_Position = projectionMatrix * modelViewMatrix * worldPos;
}
`

const barFragShader = /* glsl */ `
uniform float uBarCount;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform sampler2D uFreqTexture;
uniform float uPeak;

varying float vInstanceId;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;

// IQ's cosine palette — vibrant version
vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  float t = vInstanceId / uBarCount;
  float freq = texture2D(uFreqTexture, vec2(t, 0.0)).r;

  // Dynamic hue shift driven by time + bass + mid
  float hueShift = uTime * 0.05 + uBass * 0.2 + uMid * 0.08;

  // Three-palette blend for ultra-rich colors
  vec3 palette1 = cosinePalette(
    t + hueShift,
    vec3(0.5, 0.5, 0.5),
    vec3(0.5, 0.5, 0.5),
    vec3(1.0, 1.0, 0.5),
    vec3(0.00, 0.10, 0.20)
  );

  vec3 palette2 = cosinePalette(
    t + hueShift + 0.33,
    vec3(0.5, 0.5, 0.5),
    vec3(0.5, 0.5, 0.5),
    vec3(2.0, 1.0, 0.0),
    vec3(0.50, 0.20, 0.25)
  );

  vec3 palette3 = cosinePalette(
    t + hueShift + 0.66,
    vec3(0.5, 0.5, 0.5),
    vec3(0.5, 0.5, 0.5),
    vec3(1.0, 0.7, 0.4),
    vec3(0.80, 0.90, 0.30)
  );

  // Triple-blend based on frequency + treble + mid
  vec3 color = mix(palette1, palette2, freq * 0.6 + uTreble * 0.3);
  color = mix(color, palette3, uMid * 0.3 + freq * 0.2);

  // Height gradient: bottom deep, top brilliant glow
  float heightFactor = smoothstep(0.0, 1.0, vWorldPos.y / max(vHeight, 0.01));
  color *= 0.4 + heightFactor * 1.0;

  // Top cap glow: bright emissive tip at the very top of tall bars
  float topGlow = smoothstep(0.85, 1.0, heightFactor) * freq;
  color += topGlow * vec3(1.0, 0.95, 0.85) * 2.0;

  // Enhanced Fresnel rim lighting with view-dependent iridescence
  vec3 viewDir = normalize(vec3(sin(uTime * 0.1) * 0.3, 0.2, 1.0));
  float rim = 1.0 - abs(dot(normalize(vNormal), viewDir));
  rim = pow(rim, 2.5);
  vec3 rimColor = cosinePalette(t + uTime * 0.03, vec3(0.5), vec3(0.5), vec3(1.0, 0.8, 0.6), vec3(0.0, 0.33, 0.67));
  color += rim * 0.6 * rimColor;

  // Emissive boost — wider dynamic range
  float brightness = 0.6 + freq * 1.2;
  float emissive = 1.0 + uBass * 2.5 + freq * 2.0 + uPeak * 0.8;
  color *= brightness * emissive;

  // Bass pulse: expansion flash on bass hits
  float bassPulse = smoothstep(0.4, 0.8, uBass) * sin(uTime * 8.0 + t * 3.14) * 0.15;
  color += bassPulse * color;

  // Multi-frequency sparkle at peaks
  float sparkle1 = step(0.82, freq) * sin(uTime * 15.0 + vInstanceId * 7.3) * 0.25;
  float sparkle2 = step(0.90, freq) * sin(uTime * 23.0 + vInstanceId * 13.7) * 0.35;
  float sparkle3 = step(0.95, freq) * cos(uTime * 31.0 + vInstanceId * 3.1) * 0.5;
  color += sparkle1 + sparkle2 + sparkle3;

  // Inner glow: bars emit soft light based on their energy
  float innerGlow = freq * freq * 0.3;
  color += innerGlow * palette1;

  gl_FragColor = vec4(color, 1.0);
}
`

// Reflective ground plane shader
const groundVertShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const groundFragShader = /* glsl */ `
uniform float uTime;
uniform float uBass;
uniform float uPeak;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  // Distance from center for fade
  float dist = length(vUv - 0.5) * 2.0;

  // Enhanced grid pattern with bass-reactive brightness
  float gridX = smoothstep(0.96, 1.0, abs(sin(vWorldPos.x * 3.14159 * 2.0)));
  float gridZ = smoothstep(0.96, 1.0, abs(sin(vWorldPos.z * 3.14159 * 2.0)));
  float grid = max(gridX, gridZ) * (0.07 + uBass * 0.04);

  // Audio-reactive subtle pulse
  float pulse = 0.02 + uBass * 0.05;

  // Color: dark with slight blue tint
  vec3 color = vec3(0.02, 0.025, 0.05) + grid + pulse;

  // Expanding energy ripple rings from center
  float ringDist = length(vWorldPos.xz);
  float ringPhase1 = fract(uTime * 0.35) * 22.0;
  float ringPhase2 = fract(uTime * 0.35 + 0.5) * 22.0;
  float ring1 = smoothstep(0.25, 0.0, abs(ringDist - ringPhase1)) * smoothstep(22.0, 10.0, ringPhase1);
  float ring2 = smoothstep(0.25, 0.0, abs(ringDist - ringPhase2)) * smoothstep(22.0, 10.0, ringPhase2);
  color += vec3(0.15, 0.25, 0.5) * (ring1 + ring2) * 0.08 * (0.5 + uBass * 0.8);

  // Subtle caustic patterns
  float caustic = sin(vWorldPos.x * 3.5 + uTime * 0.9) * cos(vWorldPos.z * 3.0 - uTime * 0.7);
  caustic = max(0.0, caustic) * 0.025 * (0.4 + uBass * 0.3);
  color += vec3(0.1, 0.15, 0.35) * caustic;

  // Radial fade to black at edges
  float alpha = smoothstep(1.0, 0.15, dist) * 0.75;

  // Extra glow near center when bass hits
  float centerGlow = (1.0 - dist) * uBass * 0.12;
  color += vec3(0.06, 0.1, 0.2) * centerGlow;

  gl_FragColor = vec4(color, alpha);
}
`

// Particle shader — enhanced with pulsing glow and soft falloff
const particleVertShader = /* glsl */ `
attribute float aSize;
attribute float aLife;
attribute vec3 aColor;

varying float vLife;
varying vec3 vColor;

uniform float uTime;
uniform float uBass;

void main() {
  vLife = aLife;
  vColor = aColor;

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

  // Size varies by life, bass, and subtle breathing pulse
  float breathe = 1.0 + sin(uTime * 3.0 + aSize * 5.0) * 0.15;
  float size = aSize * (0.5 + aLife * 0.5) * (1.0 + uBass * 0.8) * breathe;
  gl_PointSize = size * (350.0 / -mvPosition.z);

  gl_Position = projectionMatrix * mvPosition;
}
`

const particleFragShader = /* glsl */ `
varying float vLife;
varying vec3 vColor;

void main() {
  // Soft radial gradient with bright core
  vec2 center = gl_PointCoord - 0.5;
  float dist = length(center);
  if (dist > 0.5) discard;

  // Multi-layer alpha: bright core + soft outer halo
  float core = smoothstep(0.5, 0.0, dist);
  float halo = smoothstep(0.5, 0.15, dist);
  float alpha = (core * 0.5 + halo * 0.4) * vLife;

  // Color with life-based brightness boost and warm core
  vec3 color = vColor * (1.0 + vLife * 0.8);
  // Bright white core for star-like appearance
  color += vec3(0.3, 0.3, 0.2) * core * core * vLife;

  gl_FragColor = vec4(color, alpha);
}
`

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_BAR_COUNT = 128
const BAR_MAX_HEIGHT = 6.0
const RADIUS = 5.0
const PARTICLE_COUNT = 350
const CAMERA_ORBIT_RADIUS = 14
const CAMERA_HEIGHT = 5.5
const CAMERA_ORBIT_SPEED = 0.08  // radians per second

export interface ThreeJsEngineConfig {
  barCount?: number
  bloomStrength?: number
  bloomRadius?: number
  bloomThreshold?: number
  layout?: 'circular' | 'horizontal' | 'mirror'
  preset?: ThreeJsPresetId
}

interface Particle {
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  life: number; maxLife: number
  size: number
  color: [number, number, number]
}

export class ThreeJsEngine {
  private renderer: THREEType.WebGLRenderer | null = null
  private scene: THREEType.Scene | null = null
  private camera: THREEType.PerspectiveCamera | null = null
  private composer: EffectComposerType | null = null
  private bloomPass: UnrealBloomPassType | null = null

  // Bars
  private barMesh: THREEType.InstancedMesh | null = null
  private barCount: number
  private dummy: THREEType.Object3D | null = null
  private barHeights: Float32Array

  // Reflection (mirror bars below ground)
  private reflectionMesh: THREEType.InstancedMesh | null = null

  // Ground plane
  private groundMesh: THREEType.Mesh | null = null

  // Particles
  private particleGeometry: THREEType.BufferGeometry | null = null
  private particleMaterial: THREEType.ShaderMaterial | null = null
  private particlePoints: THREEType.Points | null = null
  private particles: Particle[] = []
  private particlePositions: Float32Array | null = null
  private particleSizes: Float32Array | null = null
  private particleLives: Float32Array | null = null
  private particleColors: Float32Array | null = null

  // Audio processing
  private smoother: AudioSmoother
  private freqTexture: THREEType.DataTexture | null = null
  private freqTextureData: Uint8Array

  // Config
  private config: ThreeJsEngineConfig
  private size: Size = { width: 0, height: 0 }
  private inited = false
  private layout: 'circular' | 'horizontal' | 'mirror'
  private cameraAngle = 0
  private lastBass = 0
  private lastPeak = 0
  private currentPreset: ThreeJsPreset

  constructor(config: ThreeJsEngineConfig = {}) {
    this.config = config
    this.barCount = config.barCount ?? DEFAULT_BAR_COUNT
    this.layout = config.layout ?? 'circular'
    this.barHeights = new Float32Array(this.barCount).fill(0.01)
    this.smoother = new AudioSmoother(this.barCount, 0.35, 0.08)
    this.freqTextureData = new Uint8Array(this.barCount)
    this.currentPreset = THREEJS_PRESETS[config.preset ?? DEFAULT_THREEJS_PRESET]
  }

  /**
   * Initialize with the "webgl" canvas from CanvasHost.
   * Called once; canvas must NOT be used by any other WebGL context.
   */
  async initWithCanvas(canvas: HTMLCanvasElement, size: Size): Promise<void> {
    if (this.inited) return
    this.size = size

    const { THREE, EffectComposer, RenderPass, UnrealBloomPass, OutputPass } = await getPostprocessing()

    this.dummy = new THREE.Object3D()

    // ═══ Renderer ═══
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
      alpha: false,
    })
    this.renderer.setSize(size.width, size.height, false)
    this.renderer.setPixelRatio(1)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = this.currentPreset.toneMappingExposure
    this.renderer.setClearColor(this.currentPreset.clearColor, 1)
    this.renderer.shadowMap.enabled = false

    // ═══ Scene ═══
    this.scene = new THREE.Scene()

    // Subtle fog for depth (preset-driven)
    this.scene.fog = new THREE.FogExp2(this.currentPreset.fogColor, this.currentPreset.fogDensity)

    // ═══ Camera — PerspectiveCamera for true 3D ═══
    const aspect = size.width / size.height
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100)
    this.camera.position.set(0, this.currentPreset.cameraHeightBase, CAMERA_ORBIT_RADIUS)
    this.camera.lookAt(0, 1.5, 0)

    // ═══ Ambient light (preset-driven) ═══
    const ambientLight = new THREE.AmbientLight(this.currentPreset.ambientLightColor, this.currentPreset.ambientLightIntensity)
    this.scene.add(ambientLight)

    // ═══ Point light from above (preset-driven) ═══
    const pointLight = new THREE.PointLight(this.currentPreset.pointLightColor, this.currentPreset.pointLightIntensity, 30)
    pointLight.position.set(0, 10, 0)
    this.scene.add(pointLight)

    // ═══ Frequency DataTexture ═══
    this.freqTexture = new THREE.DataTexture(
      this.freqTextureData,
      this.barCount,
      1,
      THREE.RedFormat,
      THREE.UnsignedByteType
    )
    this.freqTexture.needsUpdate = true

    // ═══ Bar Geometry — CylinderGeometry with rounded caps ═══
    const barGeo = new THREE.CylinderGeometry(0.12, 0.14, 1, 8, 1, false)
    // Shift pivot to bottom so bars grow upward from Y=0
    barGeo.translate(0, 0.5, 0)

    // ═══ Bar Material (preset-driven GLSL shader) ═══
    const barMat = new THREE.ShaderMaterial({
      uniforms: {
        uBarCount: { value: this.barCount },
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uPeak: { value: 0 },
        uFreqTexture: { value: this.freqTexture },
      },
      vertexShader: barVertShader,
      fragmentShader: this.currentPreset.barFragShader,
      transparent: false,
      depthTest: true,
      depthWrite: true,
    })

    // ═══ Main Bars — InstancedMesh ═══
    this.barMesh = new THREE.InstancedMesh(barGeo, barMat, this.barCount)
    this.barMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.barMesh.frustumCulled = false
    this.scene.add(this.barMesh)

    // ═══ Reflection Bars — same geometry, semi-transparent, flipped ═══
    const reflectionMat = new THREE.ShaderMaterial({
      uniforms: {
        uBarCount: { value: this.barCount },
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uPeak: { value: 0 },
        uFreqTexture: { value: this.freqTexture },
      },
      vertexShader: barVertShader,
      fragmentShader: this.currentPreset.barFragShader,  // will be overridden below
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.FrontSide,
    })
    // Override fragment to add opacity fade (preset-driven reflection)
    const p = this.currentPreset
    reflectionMat.fragmentShader = this.currentPreset.barFragShader.replace(
      'gl_FragColor = vec4(color, 1.0);',
      `float reflFade = smoothstep(0.0, ${p.reflectionFadeRange.toFixed(1)}, vWorldPos.y) * ${p.reflectionOpacity.toFixed(2)};
       gl_FragColor = vec4(color * ${p.reflectionColorMul.toFixed(1)}, reflFade);`
    )

    this.reflectionMesh = new THREE.InstancedMesh(barGeo, reflectionMat, this.barCount)
    this.reflectionMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.reflectionMesh.frustumCulled = false
    this.scene.add(this.reflectionMesh)

    // ═══ Ground Plane ═══
    const groundGeo = new THREE.PlaneGeometry(40, 40)
    const groundMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uPeak: { value: 0 },
      },
      vertexShader: groundVertShader,
      fragmentShader: this.currentPreset.groundFragShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.groundMesh = new THREE.Mesh(groundGeo, groundMat)
    this.groundMesh.rotation.x = -Math.PI / 2
    this.groundMesh.position.y = -0.01
    this.scene.add(this.groundMesh)

    // ═══ Particle System ═══
    this.initParticles(THREE)

    // Initialize bar positions
    this.updateBarPositions()

    // ═══ Post-processing ═══
    this.composer = new EffectComposer(this.renderer)
    this.composer.setSize(size.width, size.height)

    const renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(renderPass)

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      this.config.bloomStrength ?? this.currentPreset.bloomStrength,
      this.config.bloomRadius ?? this.currentPreset.bloomRadius,
      this.config.bloomThreshold ?? this.currentPreset.bloomThreshold
    )
    this.composer.addPass(this.bloomPass)

    this.composer.addPass(new OutputPass())

    this.inited = true
  }

  /**
   * Initialize particle system.
   */
  private initParticles(THREE: typeof THREEType): void {
    this.particles = []
    this.particlePositions = new Float32Array(PARTICLE_COUNT * 3)
    this.particleSizes = new Float32Array(PARTICLE_COUNT)
    this.particleLives = new Float32Array(PARTICLE_COUNT)
    this.particleColors = new Float32Array(PARTICLE_COUNT * 3)

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.particles.push(this.createParticle())
    }
    this.syncParticleBuffers()

    this.particleGeometry = new THREE.BufferGeometry()
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3))
    this.particleGeometry.setAttribute('aSize', new THREE.BufferAttribute(this.particleSizes, 1))
    this.particleGeometry.setAttribute('aLife', new THREE.BufferAttribute(this.particleLives, 1))
    this.particleGeometry.setAttribute('aColor', new THREE.BufferAttribute(this.particleColors, 3))

    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
      },
      vertexShader: particleVertShader,
      fragmentShader: particleFragShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    this.particlePoints = new THREE.Points(this.particleGeometry, this.particleMaterial)
    this.particlePoints.frustumCulled = false
    this.scene!.add(this.particlePoints)
  }

  private createParticle(): Particle {
    const spread = this.layout === 'circular' ? RADIUS * 2 : 10
    const speedMul = this.currentPreset.particleSpeedMultiplier
    const sizeMul = this.currentPreset.particleSizeMultiplier
    // Pick a random color from preset palette
    const palette = this.currentPreset.particleColors
    const pColor = palette[Math.floor(Math.random() * palette.length)]!
    return {
      x: (Math.random() - 0.5) * spread * 2,
      y: Math.random() * 8 + 0.5,
      z: (Math.random() - 0.5) * spread * 2,
      vx: (Math.random() - 0.5) * 0.02 * speedMul,
      vy: (Math.random() * 0.03 + 0.01) * speedMul,
      vz: (Math.random() - 0.5) * 0.02 * speedMul,
      life: Math.random(),
      maxLife: 2 + Math.random() * 4,
      size: (0.5 + Math.random() * 1.5) * sizeMul,
      color: [
        pColor[0] * (0.8 + Math.random() * 0.2),
        pColor[1] * (0.8 + Math.random() * 0.2),
        pColor[2] * (0.8 + Math.random() * 0.2),
      ],
    }
  }

  private syncParticleBuffers(): void {
    if (!this.particlePositions || !this.particleSizes || !this.particleLives || !this.particleColors) return

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this.particles[i]!
      this.particlePositions[i * 3] = p.x
      this.particlePositions[i * 3 + 1] = p.y
      this.particlePositions[i * 3 + 2] = p.z
      this.particleSizes[i] = p.size
      this.particleLives[i] = p.life
      this.particleColors[i * 3] = p.color[0]
      this.particleColors[i * 3 + 1] = p.color[1]
      this.particleColors[i * 3 + 2] = p.color[2]
    }
  }

  private updateParticles(dt: number, bass: number, peak: number): void {
    const speedMul = this.currentPreset.particleSpeedMultiplier

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this.particles[i]!

      // Orbital motion: particles slowly orbit around center
      const dist = Math.sqrt(p.x * p.x + p.z * p.z)
      const orbitSpeed = 0.003 * speedMul / Math.max(dist, 1)
      const angle = Math.atan2(p.z, p.x) + orbitSpeed
      const targetX = Math.cos(angle) * dist
      const targetZ = Math.sin(angle) * dist

      // Blend orbital + linear drift + organic wobble
      p.x = targetX + p.vx * speedMul + Math.sin(p.y * 0.3 + p.x * 0.2) * 0.006
      p.y += p.vy * (1 + bass * 2.5) * speedMul
      p.z = targetZ + p.vz * speedMul + Math.cos(p.y * 0.2 + p.z * 0.3) * 0.006

      // Bass-reactive size pulsing
      p.size += (bass - 0.3) * 0.02

      // Age
      p.life -= dt / p.maxLife

      // Respawn when dead or too high
      if (p.life <= 0 || p.y > 14) {
        const newP = this.createParticle()
        newP.y = 0.1 + Math.random() * 0.5
        newP.life = 1.0
        // Boost spawn on bass hits: bigger, faster, more colorful
        if (bass > 0.4) {
          newP.vy *= 1.5 + bass * 1.5
          newP.size *= 1.2 + bass * 0.8
          // Spawn near bar positions for connection effect
          if (this.layout === 'circular' && Math.random() > 0.5) {
            const barAngle = Math.random() * Math.PI * 2
            newP.x = Math.cos(barAngle) * RADIUS * (0.8 + Math.random() * 0.4)
            newP.z = Math.sin(barAngle) * RADIUS * (0.8 + Math.random() * 0.4)
          }
        }
        this.particles[i] = newP
      }
    }

    this.syncParticleBuffers()

    if (this.particleGeometry) {
      const posAttr = this.particleGeometry.getAttribute('position') as THREEType.BufferAttribute
      posAttr.needsUpdate = true
      const sizeAttr = this.particleGeometry.getAttribute('aSize') as THREEType.BufferAttribute
      sizeAttr.needsUpdate = true
      const lifeAttr = this.particleGeometry.getAttribute('aLife') as THREEType.BufferAttribute
      lifeAttr.needsUpdate = true
      const colorAttr = this.particleGeometry.getAttribute('aColor') as THREEType.BufferAttribute
      colorAttr.needsUpdate = true
    }
  }

  /**
   * Compatibility wrapper for VisualizerEngine interface.
   */
  init(ctx: CanvasRenderingContext2D, size: Size): void {
    console.warn('[ThreeJsEngine] init() called with 2D context — use initWithCanvas() instead')
  }

  isInited(): boolean {
    return this.inited
  }

  resize(size: Size): void {
    if (!this.inited || !this.renderer || !this.camera || !this.composer) return
    if (size.width === this.size.width && size.height === this.size.height) return

    this.size = size
    this.renderer.setSize(size.width, size.height, false)
    this.composer.setSize(size.width, size.height)

    // Update PerspectiveCamera aspect
    this.camera.aspect = size.width / size.height
    this.camera.updateProjectionMatrix()

    // Update bloom pass resolution
    if (this.bloomPass) {
      this.bloomPass.resolution.set(size.width, size.height)
    }

    this.updateBarPositions()
  }

  /**
   * Render one frame. Called every RAF tick.
   */
  render(frame: EngineRenderFrame): void {
    if (!this.inited || !this.composer || !this.barMesh || !this.freqTexture || !this.camera) return

    const { frequencyData, timeSec } = frame
    const dt = 1 / 60  // approximate delta

    // 1. Smooth FFT data
    const smoothed = this.smoother.update(frequencyData)

    // 2. Upload smoothed data to GPU
    for (let i = 0; i < this.barCount; i++) {
      this.freqTextureData[i] = Math.round(smoothed[i]! * 255)
    }
    this.freqTexture.needsUpdate = true

    // 3. Band energies
    const bands = this.smoother.getBandEnergies()
    this.lastBass = bands.bass
    this.lastPeak = bands.peak

    // 4. Update shader uniforms (main bars)
    const mat = this.barMesh.material as THREEType.ShaderMaterial
    mat.uniforms.uTime!.value = timeSec
    mat.uniforms.uBass!.value = bands.bass
    mat.uniforms.uMid!.value = bands.mid
    mat.uniforms.uTreble!.value = bands.treble
    mat.uniforms.uPeak!.value = bands.peak

    // 4b. Update reflection material uniforms
    if (this.reflectionMesh) {
      const rMat = this.reflectionMesh.material as THREEType.ShaderMaterial
      rMat.uniforms.uTime!.value = timeSec
      rMat.uniforms.uBass!.value = bands.bass
      rMat.uniforms.uMid!.value = bands.mid
      rMat.uniforms.uTreble!.value = bands.treble
      rMat.uniforms.uPeak!.value = bands.peak
    }

    // 4c. Update ground material
    if (this.groundMesh) {
      const gMat = this.groundMesh.material as THREEType.ShaderMaterial
      gMat.uniforms.uTime!.value = timeSec
      gMat.uniforms.uBass!.value = bands.bass
      gMat.uniforms.uPeak!.value = bands.peak
    }

    // 4d. Update particle material
    if (this.particleMaterial) {
      this.particleMaterial.uniforms.uTime!.value = timeSec
      this.particleMaterial.uniforms.uBass!.value = bands.bass
    }

    // 5. Update bar heights
    this.updateBarHeights(smoothed)

    // 6. Update particles
    this.updateParticles(dt, bands.bass, bands.peak)

    // 7. Camera orbit animation (preset-driven) with bass shake & smooth easing
    this.cameraAngle += this.currentPreset.cameraOrbitSpeed * dt

    // Dynamic orbit radius: breathes + contracts slightly on bass hits
    const breathe = Math.sin(timeSec * 0.15) * 2
    const bassContract = bands.bass * -1.5  // camera pulls in on bass
    const orbitRadius = CAMERA_ORBIT_RADIUS + breathe + bassContract

    // Camera height with multi-frequency modulation
    const heightWave1 = Math.sin(timeSec * 0.1) * 1.0
    const heightWave2 = Math.sin(timeSec * 0.23) * 0.4  // secondary wobble
    const cameraHeight = this.currentPreset.cameraHeightBase + heightWave1 + heightWave2 + bands.bass * this.currentPreset.cameraBassLift

    // Base orbit position
    let camX = Math.sin(this.cameraAngle) * orbitRadius
    let camZ = Math.cos(this.cameraAngle) * orbitRadius
    let camY = cameraHeight

    // Bass shake: high-frequency micro-shake on strong bass hits
    if (bands.bass > 0.3) {
      const shakeIntensity = (bands.bass - 0.3) * 0.15
      camX += Math.sin(timeSec * 47) * shakeIntensity
      camY += Math.cos(timeSec * 53) * shakeIntensity * 0.5
      camZ += Math.sin(timeSec * 41) * shakeIntensity
    }

    // Peak impact: subtle zoom-in jolt on peak transients
    if (bands.peak > 0.7) {
      const peakJolt = (bands.peak - 0.7) * 0.8
      camX *= 1 - peakJolt * 0.03
      camZ *= 1 - peakJolt * 0.03
    }

    this.camera.position.x = camX
    this.camera.position.z = camZ
    this.camera.position.y = camY

    // Dynamic lookAt: gently follows bass energy up/down
    const lookY = 1.0 + bands.peak * 0.5 + bands.bass * 0.3
    this.camera.lookAt(0, lookY, 0)

    // 8. Drive bloom with audio (preset-driven reactivity)
    if (this.bloomPass) {
      const baseStrength = this.config.bloomStrength ?? this.currentPreset.bloomStrength
      const baseRadius = this.config.bloomRadius ?? this.currentPreset.bloomRadius
      this.bloomPass.strength = baseStrength + bands.bass * this.currentPreset.bloomBassMultiplier + bands.peak * this.currentPreset.bloomPeakMultiplier
      this.bloomPass.radius = baseRadius + bands.mid * 0.25
    }

    // 9. Render
    this.composer.render()
  }

  /**
   * Update bar instance matrices based on smoothed FFT heights.
   */
  private updateBarHeights(smoothed: Float32Array): void {
    if (!this.barMesh || !this.dummy) return

    for (let i = 0; i < this.barCount; i++) {
      const value = smoothed[i]!
      const targetH = Math.max(0.03, value * BAR_MAX_HEIGHT)

      // Smooth height interpolation
      this.barHeights[i] = this.barHeights[i]! + (targetH - this.barHeights[i]!) * 0.3

      const h = this.barHeights[i]!

      if (this.layout === 'circular') {
        const angle = (i / this.barCount) * Math.PI * 2
        const x = Math.cos(angle) * RADIUS
        const z = Math.sin(angle) * RADIUS

        this.dummy.position.set(x, 0, z)
        this.dummy.rotation.set(0, -angle + Math.PI / 2, 0)
        this.dummy.scale.set(1, h, 1)
      } else if (this.layout === 'mirror') {
        // Mirror: bars from center going left and right
        const half = Math.floor(this.barCount / 2)
        const totalWidth = 12
        const barSpacing = totalWidth / half
        let x: number

        if (i < half) {
          // Left side (mirrored)
          x = -(i * barSpacing + barSpacing / 2)
        } else {
          // Right side
          x = (i - half) * barSpacing + barSpacing / 2
        }

        this.dummy.position.set(x, 0, 0)
        this.dummy.rotation.set(0, 0, 0)
        this.dummy.scale.set(1, h, 1)
      } else {
        // Horizontal layout
        const totalWidth = 14
        const barSpacing = totalWidth / this.barCount
        const x = -totalWidth / 2 + i * barSpacing + barSpacing / 2

        this.dummy.position.set(x, 0, 0)
        this.dummy.rotation.set(0, 0, 0)
        this.dummy.scale.set(1, h, 1)
      }

      this.dummy.updateMatrix()
      this.barMesh.setMatrixAt(i, this.dummy.matrix)

      // Update reflection (flipped Y, below ground)
      if (this.reflectionMesh && this.dummy) {
        const pos = this.dummy.position.clone()
        pos.y = 0
        this.dummy.position.copy(pos)
        this.dummy.scale.set(1, -h * 0.5, 1) // shorter reflection
        this.dummy.updateMatrix()
        this.reflectionMesh.setMatrixAt(i, this.dummy.matrix)
      }
    }

    this.barMesh.instanceMatrix.needsUpdate = true
    if (this.reflectionMesh) {
      this.reflectionMesh.instanceMatrix.needsUpdate = true
    }
  }

  /**
   * Compute initial bar positions based on layout.
   */
  private updateBarPositions(): void {
    if (!this.barMesh || !this.dummy) return

    for (let i = 0; i < this.barCount; i++) {
      if (this.layout === 'circular') {
        const angle = (i / this.barCount) * Math.PI * 2
        const x = Math.cos(angle) * RADIUS
        const z = Math.sin(angle) * RADIUS
        this.dummy.position.set(x, 0, z)
        this.dummy.rotation.set(0, -angle + Math.PI / 2, 0)
      } else if (this.layout === 'mirror') {
        const half = Math.floor(this.barCount / 2)
        const totalWidth = 12
        const barSpacing = totalWidth / half
        let x: number
        if (i < half) {
          x = -(i * barSpacing + barSpacing / 2)
        } else {
          x = (i - half) * barSpacing + barSpacing / 2
        }
        this.dummy.position.set(x, 0, 0)
        this.dummy.rotation.set(0, 0, 0)
      } else {
        const totalWidth = 14
        const barSpacing = totalWidth / this.barCount
        const x = -totalWidth / 2 + i * barSpacing + barSpacing / 2
        this.dummy.position.set(x, 0, 0)
        this.dummy.rotation.set(0, 0, 0)
      }
      this.dummy.scale.set(1, 0.03, 1)
      this.dummy.updateMatrix()
      this.barMesh.setMatrixAt(i, this.dummy.matrix)

      // Reflection initial position
      if (this.reflectionMesh) {
        this.dummy.scale.set(1, -0.015, 1)
        this.dummy.updateMatrix()
        this.reflectionMesh.setMatrixAt(i, this.dummy.matrix)
      }
    }
    this.barMesh.instanceMatrix.needsUpdate = true
    if (this.reflectionMesh) {
      this.reflectionMesh.instanceMatrix.needsUpdate = true
    }
  }

  /**
   * Change layout at runtime.
   */
  setLayout(layout: 'circular' | 'horizontal' | 'mirror'): void {
    this.layout = layout
    this.updateBarPositions()
  }

  /**
   * Update bloom parameters at runtime.
   */
  setBloomParams(strength?: number, radius?: number, threshold?: number): void {
    if (strength !== undefined) this.config.bloomStrength = strength
    if (radius !== undefined) this.config.bloomRadius = radius
    if (threshold !== undefined) {
      this.config.bloomThreshold = threshold
      if (this.bloomPass) this.bloomPass.threshold = threshold
    }
  }

  /**
   * Switch preset at runtime — rebuilds shaders, updates scene atmosphere,
   * lighting, fog, bloom defaults, and particle palette.
   *
   * This is a "hot swap" — the scene, camera, and renderer stay alive,
   * only materials/uniforms/colors change.
   */
  setPreset(presetId: ThreeJsPresetId): void {
    const preset = THREEJS_PRESETS[presetId]
    if (!preset) return
    this.currentPreset = preset

    if (!this.inited || !this.renderer || !this.scene || !this.camera) return

    // ── Scene atmosphere ──
    this.renderer.setClearColor(preset.clearColor, 1)
    this.renderer.toneMappingExposure = preset.toneMappingExposure

    if (this.scene.fog && 'color' in this.scene.fog) {
      ;(this.scene.fog as any).color.setHex(preset.fogColor)
      ;(this.scene.fog as any).density = preset.fogDensity
    }

    // ── Lighting ──
    this.scene.traverse((child) => {
      if ((child as any).isAmbientLight) {
        ;(child as any).color.setHex(preset.ambientLightColor)
        ;(child as any).intensity = preset.ambientLightIntensity
      }
      if ((child as any).isPointLight) {
        ;(child as any).color.setHex(preset.pointLightColor)
        ;(child as any).intensity = preset.pointLightIntensity
      }
    })

    // ── Bar shader ──
    if (this.barMesh) {
      const mat = this.barMesh.material as THREEType.ShaderMaterial
      mat.fragmentShader = preset.barFragShader
      mat.needsUpdate = true
    }

    // ── Reflection shader ──
    if (this.reflectionMesh) {
      const rMat = this.reflectionMesh.material as THREEType.ShaderMaterial
      rMat.fragmentShader = preset.barFragShader.replace(
        'gl_FragColor = vec4(color, 1.0);',
        `float reflFade = smoothstep(0.0, ${preset.reflectionFadeRange.toFixed(1)}, vWorldPos.y) * ${preset.reflectionOpacity.toFixed(2)};
         gl_FragColor = vec4(color * ${preset.reflectionColorMul.toFixed(1)}, reflFade);`
      )
      rMat.needsUpdate = true
    }

    // ── Ground shader ──
    if (this.groundMesh) {
      const gMat = this.groundMesh.material as THREEType.ShaderMaterial
      gMat.fragmentShader = preset.groundFragShader
      gMat.needsUpdate = true
    }

    // ── Bloom defaults (unless user has overridden) ──
    if (this.bloomPass) {
      if (this.config.bloomStrength === undefined) {
        this.bloomPass.strength = preset.bloomStrength
      }
      if (this.config.bloomRadius === undefined) {
        this.bloomPass.radius = preset.bloomRadius
      }
      if (this.config.bloomThreshold === undefined) {
        this.bloomPass.threshold = preset.bloomThreshold
      }
    }

    // ── Respawn particles with new palette ──
    for (let i = 0; i < this.particles.length; i++) {
      const newP = this.createParticle()
      newP.life = this.particles[i]!.life  // keep current life so transition is smooth
      this.particles[i] = newP
    }
    this.syncParticleBuffers()

    console.log(`[ThreeJsEngine] Switched to preset: ${preset.label}`)
  }

  /**
   * Get current preset ID.
   */
  getPresetId(): ThreeJsPresetId {
    return this.currentPreset.id
  }

  /**
   * Get the WebGL canvas for compositing.
   */
  getCanvas(): HTMLCanvasElement | null {
    return this.renderer?.domElement ?? null
  }

  destroy(): void {
    // Bars
    if (this.barMesh) {
      this.barMesh.geometry.dispose()
      ;(this.barMesh.material as THREEType.ShaderMaterial).dispose()
      this.barMesh = null
    }

    // Reflection
    if (this.reflectionMesh) {
      this.reflectionMesh.geometry.dispose()
      ;(this.reflectionMesh.material as THREEType.ShaderMaterial).dispose()
      this.reflectionMesh = null
    }

    // Ground
    if (this.groundMesh) {
      this.groundMesh.geometry.dispose()
      ;(this.groundMesh.material as THREEType.ShaderMaterial).dispose()
      this.groundMesh = null
    }

    // Particles
    if (this.particlePoints) {
      this.particleGeometry?.dispose()
      this.particleMaterial?.dispose()
      this.particlePoints = null
      this.particleGeometry = null
      this.particleMaterial = null
    }

    // Freq texture
    if (this.freqTexture) {
      this.freqTexture.dispose()
      this.freqTexture = null
    }

    // Composer
    if (this.composer) {
      this.composer = null
    }

    // Renderer
    if (this.renderer) {
      this.renderer.dispose()
      this.renderer = null
    }

    this.scene = null
    this.camera = null
    this.bloomPass = null
    this.particles = []
    this.particlePositions = null
    this.particleSizes = null
    this.particleLives = null
    this.particleColors = null
    this.smoother.reset()
    this.inited = false
  }
}

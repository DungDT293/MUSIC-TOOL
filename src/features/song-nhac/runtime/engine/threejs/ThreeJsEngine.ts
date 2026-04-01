/**
 * Three.js Visualizer Engine — Avee Player-quality rendering.
 *
 * Architecture:
 * - InstancedMesh for all bars (1 draw call, GPU-instanced)
 * - DataTexture for FFT data upload (zero-copy to GPU)
 * - EffectComposer: RenderPass → UnrealBloomPass → OutputPass
 * - ACESFilmic tone mapping for cinematic HDR look
 * - AudioSmoother for asymmetric attack/decay + log frequency mapping
 *
 * Implements the same VisualizerEngine interface as WaveBarsEngine
 * so it can be swapped in via EngineHost.
 */

// Three.js và postprocessing được lazy-load khi engine thực sự được khởi tạo
// để tránh bundle ~800KB cho tất cả user dù không chọn ThreeJS engine
import type * as THREEType from 'three'
import type { EffectComposer as EffectComposerType } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import type { UnrealBloomPass as UnrealBloomPassType } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { AudioSmoother } from './audioSmoothing'
import type { Size, EngineRenderFrame } from '../types'

// Cache để tránh re-import nhiều lần
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

// Inline GLSL shaders (avoids vite-plugin-glsl compatibility issues with electron-vite)
const barVertShader = /* glsl */ `
varying float vInstanceId;
varying vec3 vWorldPos;
void main() {
  vInstanceId = float(gl_InstanceID);
  vec4 worldPos = instanceMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
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
varying float vInstanceId;
varying vec3 vWorldPos;

vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  float t = vInstanceId / uBarCount;
  float freq = texture2D(uFreqTexture, vec2(t, 0.0)).r;
  float hueShift = uTime * 0.03;
  vec3 color = cosinePalette(
    t + hueShift,
    vec3(0.5, 0.5, 0.5),
    vec3(0.5, 0.5, 0.5),
    vec3(1.0, 1.0, 1.0),
    vec3(0.00, 0.33, 0.67)
  );
  float brightness = 0.6 + freq * 0.8;
  color *= brightness;
  float emissive = 1.0 + uBass * 2.5 + freq * 1.5;
  color *= emissive;
  gl_FragColor = vec4(color, 1.0);
}
`

const BAR_COUNT = 128
const BAR_MAX_HEIGHT = 5.0
const RADIUS = 4.5

export interface ThreeJsEngineConfig {
  barCount?: number
  bloomStrength?: number
  bloomRadius?: number
  bloomThreshold?: number
  layout?: 'circular' | 'horizontal' | 'mirror'
}

export class ThreeJsEngine {
  private renderer: THREEType.WebGLRenderer | null = null
  private scene: THREEType.Scene | null = null
  private camera: THREEType.OrthographicCamera | null = null
  private composer: EffectComposerType | null = null
  private bloomPass: UnrealBloomPassType | null = null

  // Bars
  private barMesh: THREEType.InstancedMesh | null = null
  private barCount: number
  private dummy: THREEType.Object3D | null = null  // lazy-init khi THREE được load
  private barHeights: Float32Array

  // Audio processing
  private smoother: AudioSmoother
  private freqTexture: THREEType.DataTexture | null = null
  private freqTextureData: Uint8Array

  // Config
  private config: ThreeJsEngineConfig
  private size: Size = { width: 0, height: 0 }
  private inited = false
  private layout: 'circular' | 'horizontal' | 'mirror'

  constructor(config: ThreeJsEngineConfig = {}) {
    this.config = config
    this.barCount = config.barCount ?? BAR_COUNT
    this.layout = config.layout ?? 'circular'
    this.barHeights = new Float32Array(this.barCount).fill(0.01)
    this.smoother = new AudioSmoother(this.barCount, 0.35, 0.08)
    this.freqTextureData = new Uint8Array(this.barCount)
  }

  /**
   * Initialize with the "webgl" canvas from CanvasHost.
   * Called once; canvas must NOT be used by any other WebGL context.
   */
  async initWithCanvas(canvas: HTMLCanvasElement, size: Size): Promise<void> {
    if (this.inited) return
    this.size = size

    // Lazy-load Three.js và postprocessing (tránh bundle 800KB khi không dùng engine này)
    const { THREE, EffectComposer, RenderPass, UnrealBloomPass, OutputPass } = await getPostprocessing()

    // Khởi tạo dummy Object3D sau khi THREE đã load
    this.dummy = new THREE.Object3D()

    // === Renderer ===
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,           // SMAA/FXAA handles this in post
      preserveDrawingBuffer: true, // Required for gl.readPixels (export)
      powerPreference: 'high-performance',
      alpha: false,
    })
    this.renderer.setSize(size.width, size.height, false)
    this.renderer.setPixelRatio(1) // Canvas already DPR-scaled by CanvasHost
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.setClearColor(0x0d0d14, 1)

    // === Scene ===
    this.scene = new THREE.Scene()

    // === Camera ===
    // Orthographic camera for 2D-style visualization
    const aspect = size.width / size.height
    const frustumSize = 8
    this.camera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      100
    )
    this.camera.position.set(0, 0, 10)
    this.camera.lookAt(0, 0, 0)

    // === Frequency DataTexture (1D, Red channel, GPU upload) ===
    this.freqTexture = new THREE.DataTexture(
      this.freqTextureData,
      this.barCount,
      1,
      THREE.RedFormat,
      THREE.UnsignedByteType
    )
    this.freqTexture.needsUpdate = true

    // === Bar Geometry (pivot at bottom for upward growth) ===
    const barGeo = new THREE.BoxGeometry(0.08, 1, 0.08)
    barGeo.translate(0, 0.5, 0) // Pivot shift: grows upward from Y=0

    // === Bar Material (custom shader) ===
    const barMat = new THREE.ShaderMaterial({
      uniforms: {
        uBarCount: { value: this.barCount },
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uFreqTexture: { value: this.freqTexture },
      },
      vertexShader: barVertShader,
      fragmentShader: barFragShader,
      transparent: false,
      depthTest: false,
      depthWrite: false,
    })

    // === InstancedMesh (1 draw call for all bars!) ===
    this.barMesh = new THREE.InstancedMesh(barGeo, barMat, this.barCount)
    this.barMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.barMesh.frustumCulled = false
    this.scene.add(this.barMesh)

    // Initialize bar positions based on layout
    this.updateBarPositions()

    // === Post-processing: RenderPass → UnrealBloomPass → OutputPass ===
    this.composer = new EffectComposer(this.renderer)
    this.composer.setSize(size.width, size.height)

    const renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(renderPass)

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      this.config.bloomStrength ?? 1.5,   // strength
      this.config.bloomRadius ?? 0.4,     // radius
      this.config.bloomThreshold ?? 0.1   // threshold (low = everything glows)
    )
    this.composer.addPass(this.bloomPass)

    this.composer.addPass(new OutputPass())

    this.inited = true
  }

  /**
   * Compatibility wrapper for VisualizerEngine interface.
   * CanvasHost will call this with a 2D context — we ignore it and use initWithCanvas instead.
   */
  init(ctx: CanvasRenderingContext2D, size: Size): void {
    // ThreeJsEngine needs a raw canvas, not a 2D context.
    // initWithCanvas() should be called directly by VisualizerRuntime.
    // This is a no-op fallback for interface compatibility.
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

    // Update camera aspect
    const aspect = size.width / size.height
    const frustumSize = 8
    this.camera.left = -frustumSize * aspect / 2
    this.camera.right = frustumSize * aspect / 2
    this.camera.top = frustumSize / 2
    this.camera.bottom = -frustumSize / 2
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
    if (!this.inited || !this.composer || !this.barMesh || !this.freqTexture) return

    const { frequencyData } = frame

    // 1. Smooth FFT data (asymmetric attack/decay + log mapping)
    const smoothed = this.smoother.update(frequencyData)

    // 2. Upload smoothed data to GPU texture
    for (let i = 0; i < this.barCount; i++) {
      this.freqTextureData[i] = Math.round(smoothed[i]! * 255)
    }
    this.freqTexture.needsUpdate = true

    // 3. Get band energies for bloom driving
    const bands = this.smoother.getBandEnergies()

    // 4. Update shader uniforms
    const mat = this.barMesh.material as THREEType.ShaderMaterial
    mat.uniforms.uTime!.value = frame.timeSec
    mat.uniforms.uBass!.value = bands.bass
    mat.uniforms.uMid!.value = bands.mid
    mat.uniforms.uTreble!.value = bands.treble

    // 5. Update bar heights via InstancedMesh matrices
    this.updateBarHeights(smoothed)

    // 6. Drive bloom with audio (the Avee Player "pump" effect)
    if (this.bloomPass) {
      this.bloomPass.strength = 1.2 + bands.bass * 3.0
      this.bloomPass.radius = 0.3 + bands.mid * 0.3
    }

    // 7. Render through post-processing chain
    this.composer.render()
  }

  /**
   * Update bar instance matrices based on smoothed FFT heights.
   */
  private updateBarHeights(smoothed: Float32Array): void {
    if (!this.barMesh) return

    for (let i = 0; i < this.barCount; i++) {
      const value = smoothed[i]!
      const targetH = Math.max(0.02, value * BAR_MAX_HEIGHT)

      // Additional smoothing on the height for extra-smooth motion
      this.barHeights[i] = this.barHeights[i]! + (targetH - this.barHeights[i]!) * 0.25

      if (this.layout === 'circular') {
        const angle = (i / this.barCount) * Math.PI * 2
        const x = Math.cos(angle) * RADIUS
        const y = Math.sin(angle) * RADIUS

        this.dummy.position.set(x, y, 0)
        this.dummy.rotation.set(0, 0, angle - Math.PI / 2) // Point outward
        this.dummy.scale.set(1, this.barHeights[i]!, 1)
      } else if (this.layout === 'mirror') {
        const totalWidth = this.size.width > 0 ? 7 * (this.size.width / this.size.height) : 7
        const barSpacing = totalWidth / this.barCount
        const x = -totalWidth / 2 + i * barSpacing + barSpacing / 2

        // Top half
        this.dummy.position.set(x, 0, 0)
        this.dummy.rotation.set(0, 0, 0)
        this.dummy.scale.set(1, this.barHeights[i]!, 1)
      } else {
        // Horizontal layout
        const totalWidth = this.size.width > 0 ? 7 * (this.size.width / this.size.height) : 7
        const barSpacing = totalWidth / this.barCount
        const x = -totalWidth / 2 + i * barSpacing + barSpacing / 2
        const bottom = -3

        this.dummy.position.set(x, bottom, 0)
        this.dummy.rotation.set(0, 0, 0)
        this.dummy.scale.set(1, this.barHeights[i]!, 1)
      }

      this.dummy.updateMatrix()
      this.barMesh.setMatrixAt(i, this.dummy.matrix)
    }

    this.barMesh.instanceMatrix.needsUpdate = true
  }

  /**
   * Compute initial bar positions based on layout.
   */
  private updateBarPositions(): void {
    if (!this.barMesh) return

    for (let i = 0; i < this.barCount; i++) {
      if (this.layout === 'circular') {
        const angle = (i / this.barCount) * Math.PI * 2
        const x = Math.cos(angle) * RADIUS
        const y = Math.sin(angle) * RADIUS
        this.dummy.position.set(x, y, 0)
        this.dummy.rotation.set(0, 0, angle - Math.PI / 2)
      } else if (this.layout === 'mirror') {
        const totalWidth = this.size.width > 0 ? 7 * (this.size.width / this.size.height) : 7
        const barSpacing = totalWidth / this.barCount
        const x = -totalWidth / 2 + i * barSpacing + barSpacing / 2
        this.dummy.position.set(x, 0, 0)
        this.dummy.rotation.set(0, 0, 0)
      } else {
        const totalWidth = this.size.width > 0 ? 7 * (this.size.width / this.size.height) : 7
        const barSpacing = totalWidth / this.barCount
        const x = -totalWidth / 2 + i * barSpacing + barSpacing / 2
        this.dummy.position.set(x, -3, 0)
        this.dummy.rotation.set(0, 0, 0)
      }
      this.dummy.scale.set(1, 0.02, 1)
      this.dummy.updateMatrix()
      this.barMesh.setMatrixAt(i, this.dummy.matrix)
    }
    this.barMesh.instanceMatrix.needsUpdate = true
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
    if (!this.bloomPass) return
    if (strength !== undefined) this.config.bloomStrength = strength
    if (radius !== undefined) this.config.bloomRadius = radius
    if (threshold !== undefined) this.config.bloomThreshold = threshold
  }

  /**
   * Get the WebGL canvas for compositing.
   */
  getCanvas(): HTMLCanvasElement | null {
    return this.renderer?.domElement ?? null
  }

  destroy(): void {
    if (this.barMesh) {
      this.barMesh.geometry.dispose()
      ;(this.barMesh.material as THREEType.ShaderMaterial).dispose()
      this.barMesh = null
    }
    if (this.freqTexture) {
      this.freqTexture.dispose()
      this.freqTexture = null
    }
    if (this.composer) {
      // EffectComposer disposes its render targets
      this.composer = null
    }
    if (this.renderer) {
      this.renderer.dispose()
      this.renderer = null
    }
    this.scene = null
    this.camera = null
    this.bloomPass = null
    this.smoother.reset()
    this.inited = false
  }
}

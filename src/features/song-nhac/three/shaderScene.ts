import * as THREE from 'three'
import type { SongNhacAudioFrame } from '../core/types'

export type ShaderSceneMode = 'grid' | 'polar' | 'orb' | 'warp'

export interface ShaderSceneParams {
  colorA: number
  colorB: number
  intensity: number
  speed: number
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * Audio-terrain shader: rows of glowing lines whose height comes from the spectrum.
 *
 * The whole scene is one full-frame quad, so it costs one draw call and no geometry
 * updates per frame — the approach Vizzy-style visualizers use for their mesh grids.
 */
const FRAGMENT = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uBass;
uniform float uBeat;
uniform float uIntensity;
uniform float uSpeed;
uniform float uAspect;
uniform sampler2D uSpectrum;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uAccent;
varying vec2 vUv;

float spectrumAt(float x) {
  return texture2D(uSpectrum, vec2(clamp(x, 0.0, 1.0), 0.5)).r;
}

void main() {
  vec2 p = vUv;
  // Horizon sits high; rows below it recede toward the viewer.
  float horizon = 0.62;
  float depth = clamp((horizon - p.y) / horizon, 0.0, 1.0);

  // Perspective: near rows are spaced far apart, far rows bunch up.
  float perspective = pow(depth, 1.9);
  float worldX = (p.x - 0.5) * (0.6 + perspective * 2.4);

  float energy = spectrumAt(p.x);
  float mirror = spectrumAt(abs(p.x - 0.5) * 2.0);
  float height = (energy * 0.75 + mirror * 0.25) * (0.12 + perspective * 0.55) * (1.0 + uBass * 0.9);

  // Horizontal rows, displaced by the spectrum and scrolling toward the camera.
  float rowCount = 22.0;
  float scroll = uTime * 0.35 * uSpeed;
  float rowCoord = p.y * rowCount - scroll;
  float row = floor(rowCoord);
  float rowFrac = fract(rowCoord);
  float rowDepth = clamp(1.0 - row / rowCount, 0.0, 1.0);
  float rowEnergy = spectrumAt(fract(row * 0.137) * 0.9 + 0.05);
  float wave = sin(p.x * 9.0 + uTime * 1.6 * uSpeed + row * 0.6) * 0.02 * rowEnergy;
  float displaced = p.y + height * 0.35 + wave;
  float rowLine = smoothstep(0.42, 0.5, abs(fract(displaced * rowCount - scroll) - 0.5));

  // Vertical column lines, brighter where the spectrum is loud.
  float colCount = 26.0;
  float colLine = smoothstep(0.46, 0.5, abs(fract(worldX * colCount + 0.5) - 0.5));

  float lines = max(rowLine * 0.9, colLine * 0.55);
  // Fade with distance and toward the horizon.
  float fade = smoothstep(0.0, 0.35, depth) * (1.0 - smoothstep(0.55, 1.0, depth) * 0.15);

  vec3 base = mix(uColorA, uColorB, clamp(p.x * 1.15, 0.0, 1.0));
  vec3 color = base * lines * (0.55 + energy * 1.4) * fade;
  color += uAccent * pow(energy, 2.2) * 0.6 * fade;
  color *= 0.55 + uIntensity * 0.75;
  color += base * height * 0.15;

  // Vignette so the middle of the frame stays readable.
  float vignette = smoothstep(1.25, 0.25, length(p - 0.5) * 1.35);
  color *= 0.35 + vignette * 0.85;

  gl_FragColor = vec4(color, 1.0);
}
`

/** Polar rings: a portal of light pulsing with the bass. */
const POLAR_FRAGMENT = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uBass;
uniform float uBeat;
uniform float uIntensity;
uniform float uSpeed;
uniform float uAspect;
uniform sampler2D uSpectrum;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uAccent;
varying vec2 vUv;

void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  float radius = length(p) * 2.0;
  float angle = atan(p.y, p.x) / 6.2831853 + 0.5;
  // Mirror around the vertical axis: atan wraps at -PI, which used to show up as a
  // hard seam on the left of the frame.
  float mirrored = abs(fract(angle + 0.5) - 0.5) * 2.0;

  float energy = texture2D(uSpectrum, vec2(mirrored, 0.5)).r;
  float ringCoord = radius * 9.0 - uTime * 0.55 * uSpeed;
  float ring = smoothstep(0.62, 0.94, abs(fract(ringCoord) - 0.5));
  float fineRing = smoothstep(0.72, 0.98, abs(fract(ringCoord * 2.0 + 0.25) - 0.5));

  float glow = exp(-abs(radius - 0.55) * 7.0) * (0.25 + energy * 0.9);
  float core = exp(-radius * 6.5) * (0.35 + uBass * 0.8);

  vec3 base = mix(uColorA, uColorB, mirrored);
  vec3 color = base * (ring * 0.55 + fineRing * 0.25) * (0.35 + energy * 1.3);
  color += uAccent * glow * 0.9;
  color += base * core;
  color *= 0.5 + uIntensity * 0.8;

  float vignette = smoothstep(1.4, 0.2, radius);
  color *= 0.25 + vignette * 0.9;
  gl_FragColor = vec4(color, 1.0);
}
`

/** Energy orb: sphere displaced by the spectrum, fresnel rim, additive glow. */
const ORB_VERTEX = /* glsl */ `
attribute float aEnergy;
uniform float uTime;
uniform float uSpeed;
uniform float uIntensity;
varying float vEnergy;
varying vec3 vNormal;
varying vec3 vViewPos;

void main() {
  vEnergy = aEnergy;
  float ripple = sin(position.y * 7.0 + uTime * 2.2 * uSpeed) * 0.03;
  float displacement = (aEnergy * 0.42 + ripple) * uIntensity;
  vec3 displaced = position + normalize(position) * displacement;
  vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`

const ORB_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uAccent;
uniform float uIntensity;
varying float vEnergy;
varying vec3 vNormal;
varying vec3 vViewPos;

void main() {
  vec3 viewDir = normalize(-vViewPos);
  float fresnel = pow(1.0 - clamp(abs(dot(normalize(vNormal), viewDir)), 0.0, 1.0), 3.1);
  vec3 base = mix(uColorA, uColorB, clamp(vEnergy * 1.6, 0.0, 1.0));
  vec3 color = base * (fresnel * (0.55 + vEnergy * 1.1) + 0.008);
  color += uAccent * fresnel * 0.12;
  gl_FragColor = vec4(color * (0.5 + uIntensity * 0.5), 1.0);
}
`
/** Hyperspace tunnel: rings and spokes rushing at the camera. */
const WARP_FRAGMENT = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uBass;
uniform float uIntensity;
uniform float uSpeed;
uniform float uAspect;
uniform sampler2D uSpectrum;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uAccent;
varying vec2 vUv;

void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  float r = length(p);
  float angle = atan(p.y, p.x) / 6.2831853 + 0.5;
  float mirrored = abs(fract(angle + 0.5) - 0.5) * 2.0;
  float energy = texture2D(uSpectrum, vec2(mirrored, 0.5)).r;

  // Depth grows toward the centre, so rings accelerate as they approach.
  float depth = 1.0 / max(r, 0.05);
  float scroll = depth * 1.35 + uTime * 1.15 * uSpeed;
  float band = fract(scroll);
  float ringMask = smoothstep(0.0, 0.12, band) * smoothstep(0.5, 0.18, band);

  float spokes = smoothstep(0.44, 0.5, abs(fract(angle * 36.0) - 0.5)) * (0.1 + energy * 0.35);

  vec3 base = mix(uColorA, uColorB, mirrored);
  float fade = smoothstep(0.02, 0.22, r) * smoothstep(0.95, 0.35, r);
  vec3 color = base * ringMask * (0.35 + energy * 1.4) * fade;
  color += base * spokes * fade;
  color += uAccent * exp(-r * 5.0) * (0.25 + uBass * 0.75);
  color *= 0.45 + uIntensity * 0.75;

  gl_FragColor = vec4(color, 1.0);
}
`
export class ShaderScene {
  readonly object: THREE.Mesh
  private readonly material: THREE.ShaderMaterial
  private readonly spectrumData: Uint8Array
  private readonly spectrumTexture: THREE.DataTexture
  private mode: ShaderSceneMode = 'grid'
  private orbEnergy: Float32Array | null = null
  private orbLon: Float32Array | null = null
  private orbGeometry: THREE.SphereGeometry | null = null

  constructor(mode: ShaderSceneMode, colorA: number, colorB: number, accent: number) {
    this.mode = mode
    const bins = 256
    this.spectrumData = new Uint8Array(bins * 4)
    this.spectrumTexture = new THREE.DataTexture(this.spectrumData, bins, 1, THREE.RGBAFormat)
    this.spectrumTexture.minFilter = THREE.LinearFilter
    this.spectrumTexture.magFilter = THREE.LinearFilter
    this.spectrumTexture.wrapS = THREE.ClampToEdgeWrapping
    this.spectrumTexture.needsUpdate = true

    const isOrb = mode === 'orb'
    this.material = new THREE.ShaderMaterial({
      vertexShader: isOrb ? ORB_VERTEX : VERTEX,
      fragmentShader: isOrb ? ORB_FRAGMENT : mode === 'polar' ? POLAR_FRAGMENT : mode === 'warp' ? WARP_FRAGMENT : FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uBeat: { value: 0 },
        uIntensity: { value: 1 },
        uSpeed: { value: 1 },
        uAspect: { value: 16 / 9 },
        uSpectrum: { value: this.spectrumTexture },
        uColorA: { value: new THREE.Color(colorA) },
        uColorB: { value: new THREE.Color(colorB) },
        uAccent: { value: new THREE.Color(accent) },
      },
      depthWrite: !isOrb,
      depthTest: true,
      transparent: isOrb,
      blending: isOrb ? THREE.AdditiveBlending : THREE.NormalBlending,
    })

    this.object = new THREE.Mesh(isOrb ? new THREE.SphereGeometry(1.6, 160, 110) : new THREE.PlaneGeometry(1, 1), this.material)
    this.object.frustumCulled = false
    this.object.renderOrder = 0

    if (isOrb) {
      const geometry = this.object.geometry as THREE.SphereGeometry
      this.orbGeometry = geometry
      const position = geometry.getAttribute('position')
      const count = position.count
      this.orbEnergy = new Float32Array(count)
      this.orbLon = new Float32Array(count)
      for (let i = 0; i < count; i += 1) {
        const x = position.getX(i)
        const z = position.getZ(i)
        this.orbLon[i] = Math.atan2(z, x) / (Math.PI * 2) + 0.5
      }
      geometry.setAttribute('aEnergy', new THREE.BufferAttribute(this.orbEnergy, 1))
    }
  }

  get modeId(): ShaderSceneMode {
    return this.mode
  }

  /** Scales the quad to cover the visible stage at its depth. */
  resize(width: number, height: number): void {
    if (this.mode === 'orb') {
      this.object.scale.setScalar(Math.max(0.6, Math.min(1.6, height / 2.2)))
      this.material.uniforms.uAspect.value = width / Math.max(0.001, height)
      return
    }
    this.object.scale.set(width, height, 1)
    this.material.uniforms.uAspect.value = width / Math.max(0.001, height)
  }

  update(frame: SongNhacAudioFrame, params: ShaderSceneParams, timeSec: number): void {
    const data = frame.frequencyData
    const bins = 256
    for (let i = 0; i < bins; i += 1) {
      const source = data.length ? data[Math.min(data.length - 1, Math.floor((i / bins) * data.length))] : 0
      this.spectrumData[i * 4] = source
      this.spectrumData[i * 4 + 1] = source
      this.spectrumData[i * 4 + 2] = source
      this.spectrumData[i * 4 + 3] = 255
    }
    this.spectrumTexture.needsUpdate = true
    if (this.mode === 'orb' && this.orbEnergy && this.orbLon && this.orbGeometry) {
      // Sphere vertices sample the spectrum by longitude; CPU-side keeps the vertex
      // shader free of texture fetches (WebGL1-safe).
      const count = this.orbEnergy.length
      for (let i = 0; i < count; i += 1) {
        const bin = Math.min(bins - 1, Math.floor(this.orbLon[i] * bins))
        this.orbEnergy[i] = this.spectrumData[bin * 4] / 255
      }
      const attribute = this.orbGeometry.getAttribute('aEnergy') as THREE.BufferAttribute
      attribute.needsUpdate = true
    }
    const uniforms = this.material.uniforms
    uniforms.uTime.value = timeSec
    uniforms.uBass.value = Math.max(0, Math.min(1, frame.bass))
    uniforms.uBeat.value = Math.max(0, Math.min(1, frame.beat))
    uniforms.uIntensity.value = params.intensity
    uniforms.uSpeed.value = params.speed
  }

  dispose(): void {
    this.object.geometry.dispose()
    this.material.dispose()
    this.spectrumTexture.dispose()
  }
}

export function isShaderScene(style: string): style is 'grid' | 'polar' | 'orb' | 'warp' {
  return style === 'grid' || style === 'polar' || style === 'orb' || style === 'warp'
}

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { SongNhacAudioFrame } from '../core/types'

export interface WaveParams {
  colorA: number
  colorB: number
  sensitivity: number
  speed: number
  /** Global visual intensity multiplier (0..2). */
  intensity: number
}

export interface WaveStyleObject {
  object: THREE.Object3D
  update(frame: SongNhacAudioFrame, params: WaveParams, dt: number): void
  dispose(): void
}

const TWO_PI = Math.PI * 2

function gradientColors(count: number, colorA: number, colorB: number): Float32Array {
  const a = new THREE.Color(colorA)
  const b = new THREE.Color(colorB)
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    const t = i / Math.max(1, count - 1)
    const color = a.clone().lerp(b, t <= 0.5 ? t * 2 : (1 - t) * 2)
    out[i * 3] = color.r
    out[i * 3 + 1] = color.g
    out[i * 3 + 2] = color.b
  }
  return out
}

/**
 * Smooth mirrored waveform line, the "signature" look of most music channel
 * visualizers: one continuous curve plus a dimmer reflection below it.
 */
export class WaveformStyle implements WaveStyleObject {
  readonly object = new THREE.Group()
  private readonly points: number
  private readonly top: THREE.Mesh
  private readonly echo: THREE.Mesh
  private readonly topGeometry = new THREE.BufferGeometry()
  private readonly echoGeometry = new THREE.BufferGeometry()
  private readonly topPositions: Float32Array
  private readonly echoPositions: Float32Array
  private readonly display: Float32Array
  private readonly width = 7.4
  private readonly amplitude = 0.6
  private readonly thickness = 0.07

  constructor(points = 160, colorA = 0x00f2fe, colorB = 0xfe0979) {
    this.points = points
    this.topPositions = new Float32Array(points * 2 * 3)
    this.echoPositions = new Float32Array(points * 2 * 3)
    this.display = new Float32Array(points)
    const colors = new Float32Array(points * 2 * 3)
    const gradient = gradientColors(points, colorA, colorB)
    const indices: number[] = []
    for (let i = 0; i < points; i += 1) {
      colors[i * 6] = gradient[i * 3]
      colors[i * 6 + 1] = gradient[i * 3 + 1]
      colors[i * 6 + 2] = gradient[i * 3 + 2]
      colors[i * 6 + 3] = gradient[i * 3]
      colors[i * 6 + 4] = gradient[i * 3 + 1]
      colors[i * 6 + 5] = gradient[i * 3 + 2]
      if (i < points - 1) {
        const a = i * 2
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const index = new THREE.BufferAttribute(new Uint16Array(indices), 1)
    this.topGeometry.setAttribute('position', new THREE.BufferAttribute(this.topPositions, 3))
    this.topGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.topGeometry.setIndex(index)
    this.echoGeometry.setAttribute('position', new THREE.BufferAttribute(this.echoPositions, 3))
    this.echoGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.echoGeometry.setIndex(index.clone())

    // A real ribbon instead of a Line: WebGL ignores linewidth, and thick glowing
    // strokes are what make the reference visualizers read as "designed".
    this.top = new THREE.Mesh(
      this.topGeometry,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, side: THREE.DoubleSide, toneMapped: false }),
    )
    this.echo = new THREE.Mesh(
      this.echoGeometry,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    )
    this.top.renderOrder = 2
    this.echo.renderOrder = 1
    this.object.position.y = -1.45
    this.object.add(this.echo, this.top)
  }

  update(frame: SongNhacAudioFrame, params: WaveParams): void {
    const data = frame.waveformData
    const length = data.length
    if (!length) return
    const half = (this.thickness * (0.75 + Math.min(1, frame.bass) * 0.6)) / 2
    for (let i = 0; i < this.points; i += 1) {
      const t = i / (this.points - 1)
      const sample = data[Math.min(length - 1, Math.floor(t * length))] ?? 128
      const target = ((sample - 128) / 128) * this.amplitude * params.sensitivity
      this.display[i] += (target - this.display[i]) * 0.35
      const x = -this.width / 2 + t * this.width
      const y = this.display[i] * params.intensity
      const top = i * 6
      this.topPositions[top] = x
      this.topPositions[top + 1] = y + half
      this.topPositions[top + 2] = 0
      this.topPositions[top + 3] = x
      this.topPositions[top + 4] = y - half
      this.topPositions[top + 5] = 0
      this.echoPositions[top] = x
      this.echoPositions[top + 1] = -y * 0.5 - 0.03 + half * 0.5
      this.echoPositions[top + 2] = -0.01
      this.echoPositions[top + 3] = x
      this.echoPositions[top + 4] = -y * 0.5 - 0.03 - half * 0.5
      this.echoPositions[top + 5] = -0.01
    }
    ;(this.topGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.echoGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }

  dispose(): void {
    this.topGeometry.dispose()
    this.echoGeometry.dispose()
    ;(this.top.material as THREE.Material).dispose()
    ;(this.echo.material as THREE.Material).dispose()
  }
}
/** Rings flying toward the camera, the classic neon tunnel. */
export class TunnelStyle implements WaveStyleObject {
  readonly object = new THREE.Group()
  private readonly rings: THREE.LineLoop[] = []
  private readonly speeds: number[] = []
  private readonly count = 18
  private readonly depth = 22

  constructor(colorA = 0x00f2fe, colorB = 0xfe0979) {
    const segments = 96
    for (let i = 0; i < this.count; i += 1) {
      const points: THREE.Vector3[] = []
      for (let s = 0; s < segments; s += 1) {
        const angle = (s / segments) * TWO_PI
        points.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0))
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const t = i / this.count
      const color = new THREE.Color(colorA).lerp(new THREE.Color(colorB), t)
      const ring = new THREE.LineLoop(
        geometry,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      )
      ring.position.z = -t * this.depth
      this.rings.push(ring)
      this.speeds.push(1 + (i % 3) * 0.08)
      this.object.add(ring)
    }
  }

  update(frame: SongNhacAudioFrame, params: WaveParams, dt: number): void {
    const bass = Math.max(0, Math.min(1, frame.bass))
    const travel = (2.6 + bass * 3.2) * params.speed * dt
    for (let i = 0; i < this.rings.length; i += 1) {
      const ring = this.rings[i]
      ring.position.z += travel * this.speeds[i]
      if (ring.position.z > 2.5) ring.position.z -= this.depth
      const depth = Math.max(0.001, 2.5 - ring.position.z)
      const scale = (0.55 + depth * 0.16) * (1 + bass * 0.22 * params.sensitivity)
      ring.scale.setScalar(scale)
      const material = ring.material as THREE.LineBasicMaterial
      material.opacity = Math.max(0.05, Math.min(0.85, 1.25 - depth / this.depth)) * (0.5 + params.intensity * 0.5)
      ring.rotation.z += dt * 0.12 * params.speed
    }
  }

  dispose(): void {
    for (const ring of this.rings) {
      ring.geometry.dispose()
      ;(ring.material as THREE.Material).dispose()
    }
  }
}

/** Spectrum-driven dots orbiting a sphere: "orbit" style. */
export class OrbitStyle implements WaveStyleObject {
  readonly object = new THREE.Group()
  private readonly mesh: THREE.InstancedMesh
  private readonly count = 220
  private readonly dummy = new THREE.Object3D()
  private readonly phase: Float32Array
  private readonly radiusSeed: Float32Array

  constructor(colorA = 0x00f2fe, colorB = 0xfe0979) {
    const geometry = new THREE.SphereGeometry(0.035, 8, 8)
    const material = new THREE.MeshBasicMaterial({ toneMapped: false })
    this.mesh = new THREE.InstancedMesh(geometry, material, this.count)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(gradientColors(this.count, colorA, colorB), 3)
    this.phase = new Float32Array(this.count)
    this.radiusSeed = new Float32Array(this.count)
    for (let i = 0; i < this.count; i += 1) {
      this.phase[i] = (i / this.count) * TWO_PI
      this.radiusSeed[i] = 1.35 + ((i * 37) % 100) / 100 * 0.5
    }
    this.object.add(this.mesh)
  }

  update(frame: SongNhacAudioFrame, params: WaveParams, dt: number): void {
    const data = frame.frequencyData
    const length = data.length
    const time = frame.timeSec * params.speed
    for (let i = 0; i < this.count; i += 1) {
      const normalized = i / this.count
      const freq = data[Math.min(length - 1, Math.floor(normalized * length))] ?? 0
      const energy = (freq / 255) * params.sensitivity
      const angle = this.phase[i] + time * 0.35
      const radius = this.radiusSeed[i] + energy * 0.7
      const y = Math.sin(time * 1.2 + i * 0.7) * 0.35 + (energy - 0.4) * 0.5
      this.dummy.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
      const scale = 0.7 + energy * 1.8
      this.dummy.scale.setScalar(scale * (0.6 + params.intensity * 0.4))
      this.dummy.rotation.set(angle, time, 0)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.rotation.y += dt * 0.08
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}

/** Big glowing ring + soft core: minimal "pulse" style. */
export class PulseStyle implements WaveStyleObject {
  readonly object = new THREE.Group()
  private readonly ring: THREE.Mesh
  private readonly inner: THREE.Mesh
  private readonly core: THREE.Mesh
  private currentScale = 1

  constructor(colorA = 0x00f2fe, colorB = 0xfe0979) {
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.035, 24, 128),
      new THREE.MeshBasicMaterial({ color: colorA, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    )
    this.inner = new THREE.Mesh(
      new THREE.TorusGeometry(1.18, 0.012, 16, 96),
      new THREE.MeshBasicMaterial({ color: colorB, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    )
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(0.92, 48, 32),
      new THREE.MeshBasicMaterial({ color: colorA, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    )
    this.object.add(this.ring, this.inner, this.core)
  }

  update(frame: SongNhacAudioFrame, params: WaveParams, dt: number): void {
    const bass = Math.max(0, Math.min(1, frame.bass))
    const target = 1 + bass * 0.22 * params.sensitivity
    this.currentScale += (target - this.currentScale) * Math.min(1, dt * 12)
    this.ring.scale.setScalar(this.currentScale)
    this.inner.scale.setScalar(1 + bass * 0.1)
    this.core.scale.setScalar(0.92 + bass * 0.1)
    this.ring.rotation.z += dt * 0.25 * params.speed
    this.inner.rotation.z -= dt * 0.4 * params.speed
    ;(this.core.material as THREE.MeshBasicMaterial).opacity = 0.08 + bass * 0.16 * params.intensity
  }

  dispose(): void {
    this.ring.geometry.dispose()
    this.inner.geometry.dispose()
    this.core.geometry.dispose()
    ;(this.ring.material as THREE.Material).dispose()
    ;(this.inner.material as THREE.Material).dispose()
    ;(this.core.material as THREE.Material).dispose()
  }
}

/** Rounded pills mirrored around the centre line. */
export class MirrorStyle implements WaveStyleObject {
  readonly object = new THREE.Group()
  private readonly mesh: THREE.InstancedMesh
  private readonly count: number
  private readonly heights: Float32Array
  private readonly dummy = new THREE.Object3D()
  private readonly width = 7.2

  constructor(count = 96, colorA = 0x00f2fe, colorB = 0xfe0979) {
    this.count = count
    const geometry = new RoundedBoxGeometry(1, 1, 0.4, 2, 0.2)
    geometry.translate(0, 0.5, 0)
    // Two instances per bar: one up, one mirrored down.
    this.mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ toneMapped: false }), count * 2)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(gradientColors(count * 2, colorA, colorB), 3)
    this.heights = new Float32Array(count).fill(0.04)
    this.object.position.y = -1.35
    this.object.add(this.mesh)
  }

  update(frame: SongNhacAudioFrame, params: WaveParams): void {
    const data = frame.frequencyData
    const length = data.length
    const half = Math.ceil(this.count / 2)
    const step = this.width / this.count
    const barWidth = step * 0.62
    for (let i = 0; i < this.count; i += 1) {
      const mirrored = i < half ? half - 1 - i : i - half
      const t = mirrored / Math.max(1, half - 1)
      const freq = data[Math.min(length - 1, Math.floor(Math.pow(t, 1.15) * length))] ?? 0
      const raw = Math.min(1, (freq / 255) * params.sensitivity)
      const target = 0.05 + Math.pow(raw, 0.7) * 1.6
      this.heights[i] += (target - this.heights[i]) * 0.32
      const x = -this.width / 2 + i * step
      const up = Math.max(0.03, this.heights[i] * (0.5 + params.intensity * 0.5))
      this.dummy.position.set(x, 0, 0)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.scale.set(barWidth, up, 1)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
      this.dummy.rotation.set(Math.PI, 0, 0)
      this.dummy.scale.set(barWidth, up * 0.5, 1)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(this.count + i, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
export type WaveStyleId = 'circlebars' | 'bars' | 'dots' | 'waveform' | 'tunnel' | 'orbit' | 'pulse' | 'mirror'

export function isFxStyle(style: string): style is 'waveform' | 'tunnel' | 'orbit' | 'pulse' | 'mirror' {
  return style === 'waveform' || style === 'tunnel' || style === 'orbit' || style === 'pulse' || style === 'mirror'
}

export function createFxStyle(style: 'waveform' | 'tunnel' | 'orbit' | 'pulse' | 'mirror', colorA: number, colorB: number): WaveStyleObject {
  switch (style) {
    case 'waveform':
      return new WaveformStyle(160, colorA, colorB)
    case 'tunnel':
      return new TunnelStyle(colorA, colorB)
    case 'orbit':
      return new OrbitStyle(colorA, colorB)
    case 'pulse':
      return new PulseStyle(colorA, colorB)
    case 'mirror':
    default:
      return new MirrorStyle(96, colorA, colorB)
  }
}

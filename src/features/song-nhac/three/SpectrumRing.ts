import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { SongNhacAudioFrame } from '../core/types'

export interface SpectrumRingOptions {
  count: number
  radius: number
  colorA: number
  colorB: number
}

/**
 * A standalone ring of spectrum bars.
 *
 * Used for every visualizer layer after the first one, and available for effects
 * that need bars without the full engine scene (logo, rings, particles).
 */
export class SpectrumRing {
  readonly group = new THREE.Group()
  private mesh: THREE.InstancedMesh
  private heights: Float32Array
  private colors: Float32Array
  private barCount: number
  private radius: number
  private tmpObject = new THREE.Object3D()

  constructor(options: SpectrumRingOptions) {
    this.barCount = Math.max(16, Math.min(256, Math.round(options.count)))
    this.radius = options.radius

    const geometry = new RoundedBoxGeometry(1, 1, 0.36, 2, 0.18)
    geometry.translate(0, 0.5, 0)
    const material = new THREE.MeshBasicMaterial({ toneMapped: false })
    this.mesh = new THREE.InstancedMesh(geometry, material, this.barCount)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.colors = new Float32Array(this.barCount * 3)
    this.heights = new Float32Array(this.barCount).fill(0.05)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3)
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    this.group.add(this.mesh)
    this.setColors(options.colorA, options.colorB)
  }

  get count(): number {
    return this.barCount
  }

  public setRadius(radius: number): void {
    this.radius = radius
  }

  public setColors(colorA: number, colorB: number): void {
    const a = new THREE.Color(colorA)
    const b = new THREE.Color(colorB)
    for (let i = 0; i < this.barCount; i += 1) {
      const t = i / Math.max(1, this.barCount - 1)
      const color = a.clone().lerp(b, t <= 0.5 ? t * 2 : (1 - t) * 2)
      this.colors[i * 3] = color.r
      this.colors[i * 3 + 1] = color.g
      this.colors[i * 3 + 2] = color.b
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  public update(frame: SongNhacAudioFrame, sensitivity = 1): void {
    const data = frame.frequencyData
    const dataLength = Math.min(data.length, 180)
    let peak = 0
    for (let i = 0; i < dataLength; i += 1) if (data[i] > peak) peak = data[i]
    const gain = peak > 8 ? 255 / peak : 1
    const half = Math.floor(this.barCount / 2)
    const arc = (2 * Math.PI * this.radius) / this.barCount

    for (let i = 0; i < this.barCount; i += 1) {
      const mirrored = i < half ? half - 1 - i : i - half
      const normalized = Math.pow(mirrored / Math.max(1, half - 1), 1.2)
      const freqIndex = dataLength > 0 ? Math.min(dataLength - 1, Math.floor(normalized * dataLength)) : -1
      const raw = freqIndex >= 0 ? Math.min(1, ((data[freqIndex] ?? 0) * gain) / 255) : 0
      const target = 0.04 + Math.pow(raw, 0.65) * 0.95 * sensitivity
      this.heights[i] += (target - this.heights[i]) * 0.35

      const angle = (i / this.barCount) * Math.PI * 2 - Math.PI / 2
      this.tmpObject.position.set(Math.cos(angle) * this.radius, Math.sin(angle) * this.radius, 0)
      this.tmpObject.rotation.set(0, 0, angle - Math.PI / 2)
      this.tmpObject.scale.set(Math.max(0.01, arc * 0.72), Math.max(0.02, this.heights[i]), 0.05)
      this.tmpObject.updateMatrix()
      this.mesh.setMatrixAt(i, this.tmpObject.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  public dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}

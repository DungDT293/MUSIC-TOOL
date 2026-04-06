/**
 * Chức năng 13 — Dual-canvas + composite host.
 * Tạo 3 canvas (webgl, overlay2d, composite); chỉ composite append vào DOM.
 * ResizeObserver trong runtime; resize chỉ khi container đổi.
 *
 * V2: replaceWebglCanvas() — tạo canvas mới khi switch engine (WebGL → 2D).
 * Một canvas chỉ có 1 context type. Khi ThreeJS đã lấy WebGL context,
 * phải tạo canvas mới hoàn toàn để có 2D context.
 *
 * V3 audit fixes:
 * - replaceWebglCanvas() resizes all 3 canvases (not just webgl)
 * - resize() deduplicates calls when dimensions haven't changed
 * - unmount() releases WebGL context and nulls canvas references
 * - replaceWebglCanvas() tracks whether old canvas had WebGL before trying to release
 */

import { createCanvas } from './createCanvas'
import { resizeCanvasToContainer } from './resizeCanvasToContainer'
import type { PreviewQuality } from '../types'
import { QUALITY_SCALE } from '../types'

export interface CanvasHostOptions {
  quality: PreviewQuality
  devicePixelRatio?: number
}

export interface CanvasSet {
  webglCanvas: HTMLCanvasElement
  overlay2dCanvas: HTMLCanvasElement
  compositeCanvas: HTMLCanvasElement
  displayWidth: number
  displayHeight: number
}

export type RenderCallback = (set: CanvasSet) => void

export class CanvasHost {
  private container: HTMLElement | null = null
  private opts: CanvasHostOptions
  private webglCanvas: HTMLCanvasElement
  private overlay2dCanvas: HTMLCanvasElement
  private compositeCanvas: HTMLCanvasElement
  private ro: ResizeObserver | null = null
  private lastRect: { width: number; height: number } = { width: 0, height: 0 }
  private onRender: RenderCallback
  /** Track whether webglCanvas has ever been given a WebGL context. */
  private webglCanvasHasGLContext = false

  constructor(onRender: RenderCallback, options: CanvasHostOptions) {
    this.onRender = onRender
    this.opts = options
    this.webglCanvas = createCanvas('sn-webgl')
    this.overlay2dCanvas = createCanvas('sn-overlay2d')
    this.compositeCanvas = createCanvas('sn-composite')
    this.webglCanvas.style.background = '#0d0d14'
    this.overlay2dCanvas.style.background = 'transparent'
    this.compositeCanvas.style.background = '#0d0d14'
  }

  mount(container: HTMLElement): void {
    if (this.container) return
    this.container = container
    container.appendChild(this.compositeCanvas)
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
  }

  unmount(): void {
    if (this.ro && this.container) {
      this.ro.disconnect()
      this.ro = null
    }
    if (this.compositeCanvas.parentNode) {
      this.compositeCanvas.parentNode.removeChild(this.compositeCanvas)
    }
    // Release WebGL context on webglCanvas to free GPU resources
    this.releaseWebGLContext(this.webglCanvas)
    this.webglCanvasHasGLContext = false
    this.container = null
  }

  /** Safely release a WebGL context if one exists on the canvas. */
  private releaseWebGLContext(canvas: HTMLCanvasElement): void {
    // Only attempt to release if we know this canvas was given a WebGL context.
    // Calling getContext('webgl') on a 2D-only canvas would CREATE a new context
    // and waste a slot from the browser's limited WebGL context pool.
    if (!this.webglCanvasHasGLContext) return
    try {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      if (gl) {
        const ext = gl.getExtension('WEBGL_lose_context')
        ext?.loseContext()
      }
    } catch {}
  }

  /**
   * Thay thế webglCanvas bằng canvas mới hoàn toàn.
   * CẦN THIẾT khi switch từ WebGL engine (ThreeJS) sang 2D engine hoặc "none".
   * Một canvas đã có getContext('webgl') không thể getContext('2d') được nữa.
   * Trả về canvas mới + fire resize callback.
   */
  replaceWebglCanvas(): HTMLCanvasElement {
    // Release WebGL context on old canvas only if it actually had one
    this.releaseWebGLContext(this.webglCanvas)

    const newCanvas = createCanvas('sn-webgl')
    newCanvas.style.background = '#0d0d14'
    this.webglCanvas = newCanvas
    this.webglCanvasHasGLContext = false

    // Resize ALL canvases (not just webgl) to ensure dimensions stay consistent
    if (this.lastRect.width > 0) {
      const dpr = this.opts.devicePixelRatio ?? Math.min(2, window.devicePixelRatio || 1)
      const scale = QUALITY_SCALE[this.opts.quality]
      resizeCanvasToContainer(this.webglCanvas, this.lastRect, dpr, scale)
      resizeCanvasToContainer(this.overlay2dCanvas, this.lastRect, dpr, scale)
      resizeCanvasToContainer(this.compositeCanvas, this.lastRect, dpr, scale)
    }
    // Fire render callback để runtime biết canvas mới
    this.fireRender()
    return newCanvas
  }

  /** Mark that the current webglCanvas has been given a WebGL context externally. */
  markWebGLContextCreated(): void {
    this.webglCanvasHasGLContext = true
  }

  getWebglCanvas(): HTMLCanvasElement {
    return this.webglCanvas
  }

  setQuality(quality: PreviewQuality): void {
    this.opts = { ...this.opts, quality }
    this.resize()
  }

  resize(): void {
    const el = this.container
    if (!el) return
    const rawW = el.offsetWidth || el.clientWidth
    const rawH = el.offsetHeight || el.clientHeight
    // Degenerate container (display:none, hidden) — skip resize
    if (!rawW || !rawH) return
    const w = Math.max(1, Math.floor(rawW))
    const h = Math.max(1, Math.floor(rawH))

    // Deduplicate: skip if dimensions haven't changed (avoids clearing canvases)
    if (w === this.lastRect.width && h === this.lastRect.height) return

    const dpr = this.opts.devicePixelRatio ?? Math.min(2, window.devicePixelRatio || 1)
    const scale = QUALITY_SCALE[this.opts.quality]

    resizeCanvasToContainer(this.webglCanvas, { width: w, height: h }, dpr, scale)
    resizeCanvasToContainer(this.overlay2dCanvas, { width: w, height: h }, dpr, scale)
    resizeCanvasToContainer(this.compositeCanvas, { width: w, height: h }, dpr, scale)

    this.lastRect = { width: w, height: h }
    this.fireRender()
  }

  private fireRender(): void {
    this.onRender({
      webglCanvas: this.webglCanvas,
      overlay2dCanvas: this.overlay2dCanvas,
      compositeCanvas: this.compositeCanvas,
      displayWidth: this.lastRect.width,
      displayHeight: this.lastRect.height,
    })
  }
}

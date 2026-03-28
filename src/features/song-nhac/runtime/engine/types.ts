/**
 * Chức năng 13 — Engine interface.
 * Engine không biết React / Zustand / Export; chỉ time + FFT → vẽ.
 *
 * EngineType: loại engine background visualizer.
 * - 'threejs'     : Three.js bars + bloom (mặc định)
 * - 'butterchurn' : MilkDrop presets (WebGL)
 * - 'audiomotion' : Spectrum analyzer pro (Canvas 2D)
 * - 'wavejs'      : Wave.js multi-style (Canvas 2D)
 * - 'vanta'       : Vanta.js 3D backgrounds (Three.js/WebGL)
 * - 'wave2d'      : Simple canvas bars (fallback)
 */

export type EngineType = 'none' | 'threejs' | 'butterchurn' | 'audiomotion' | 'wavejs' | 'vanta' | 'wave2d'

export interface Size {
  width: number
  height: number
}

export interface EngineRenderFrame {
  timeSec: number
  frequencyData: Uint8Array
  waveformData: Uint8Array
}

/** Engine Canvas 2D — render lên CanvasRenderingContext2D. */
export interface VisualizerEngine {
  init(ctx: CanvasRenderingContext2D, size: Size): void
  resize(size: Size): void
  render(frame: EngineRenderFrame): void
  destroy(): void
}

/** Engine WebGL — render lên HTMLCanvasElement (WebGL context tự quản lý). */
export interface WebGLVisualizerEngine {
  initWithCanvas(canvas: HTMLCanvasElement, size: Size): void
  resize(size: Size): void
  render(frame: EngineRenderFrame): void
  destroy(): void
  /** Nếu engine cần AudioContext (Butterchurn, AudioMotion). */
  attachAudioSource?(source: MediaElementAudioSourceNode, audioContext: AudioContext): void
}

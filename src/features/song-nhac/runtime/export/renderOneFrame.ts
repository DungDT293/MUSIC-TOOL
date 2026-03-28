/**
 * Chức năng 13 — Bước 5. Render-core: một frame từ timeSec + FFT.
 * Preview và Export gọi chung; không RAF, không store.
 * Phase 3: tham số tùy chọn layers — vẽ lên overlay2d sau engine.
 *
 * V2: Khi engineHost === null, ThreeJsEngine đã render trực tiếp lên webglCanvas
 *     (WebGL + Bloom). renderOneFrame chỉ render overlay layers + composite.
 */

import type { CanvasSet } from '../canvas/CanvasHost'
import type { EngineHost } from '../engine/EngineHost'
import type { EngineRenderFrame } from '../engine/types'
import { renderWebglLane, renderOverlayTestPattern, renderComposite } from '../render/renderTestPattern'
import { drawLayers, type DrawableLayer, type WaveOptions } from '../render/drawLayers'
import { useSongNhacRuntimeStore } from '../../store/songNhacRuntimeStore'

// ── Beat state (ported from Tab 10: VisualizerTab.tsx) ──
let beatLevel = 0         // smoothed beat value (0–1)
let lastBeatTime = 0      // last recognized beat timestamp
let energyAvg = 0         // running average baseline

/**
 * Reset beat detection state between tracks.
 * Prevents stale beat values bleeding from one track into the next.
 */
export function resetBeatState(): void {
  beatLevel = 0
  lastBeatTime = 0
  energyAvg = 0
}

/**
 * Beat detection — ported from Tab 10 (VisualizerTab.tsx).
 * Simple, proven: bass EMA → delta → boost × 3 → peak/decay.
 * Returns 0–1 beat intensity.
 */
function computeBeat(frequencyData: Uint8Array): number {
  const len = frequencyData.length
  if (len === 0) { beatLevel *= 0.95; return beatLevel }

  // Quick check — skip all-zeros (EMPTY_FREQ fallback)
  let quickSum = 0
  const checkEnd = Math.min(32, len)
  for (let i = 0; i < checkEnd; i++) quickSum += frequencyData[i]!
  if (quickSum === 0) { beatLevel *= 0.95; return beatLevel }

  // ── Bass energy: first 40 bins (~0–200Hz), simple average ──
  const bassBins = Math.min(40, len)
  let sum = 0
  for (let i = 0; i < bassBins; i++) sum += frequencyData[i]!
  const bassNorm = (bassBins > 0 ? sum / bassBins : 0) / 255

  // ── Running average baseline (EMA α = 0.1) ──
  energyAvg = energyAvg * 0.9 + bassNorm * 0.1

  // ── Delta from baseline, normalized ──
  const delta = bassNorm - energyAvg
  const denom = Math.max(0.05, energyAvg)
  const normalizedBeat = Math.max(0, Math.min(1, delta / denom))
  const boostedBeat = Math.max(0, Math.min(1, normalizedBeat * 3))

  // ── Peak detection with min interval ──
  const now = performance.now()
  const peakThreshold = 0.12
  const minIntervalMs = 120

  if (boostedBeat > peakThreshold && now - lastBeatTime > minIntervalMs) {
    beatLevel = Math.max(beatLevel * 0.6, boostedBeat) // fast attack
    lastBeatTime = now
  } else {
    beatLevel = beatLevel * 0.92 + boostedBeat * 0.2   // smooth decay
  }

  return Math.max(0, Math.min(1, beatLevel))
}

let frameCounter = 0

export function renderOneFrame(
  set: CanvasSet,
  engineHost: EngineHost | null,
  frame: EngineRenderFrame,
  layers?: DrawableLayer[]
): void {
  if (!set) return
  frameCounter++

  // When engineHost is null, ThreeJsEngine has already rendered to webglCanvas
  // (GPU: bars + bloom). We only need to handle overlay + composite.
  // When engineHost is provided, use the old Canvas 2D engine path.
  if (engineHost) {
    // Old path: Canvas 2D engine renders background + bars
    renderWebglLane(set)

    // Clear overlay before engine draws to it — prevents layer ghosting/accumulation
    const overlayCtx = set.overlay2dCanvas.getContext('2d')
    if (overlayCtx) {
      overlayCtx.clearRect(0, 0, set.overlay2dCanvas.width, set.overlay2dCanvas.height)
    }

    if (!engineHost.isInited()) {
      const ctx = set.overlay2dCanvas.getContext('2d')
      if (ctx) {
        engineHost.init(ctx, {
          width: set.overlay2dCanvas.width,
          height: set.overlay2dCanvas.height,
        })
      }
    }
    if (engineHost.isInited()) {
      engineHost.resize({
        width: set.overlay2dCanvas.width,
        height: set.overlay2dCanvas.height,
      })
      engineHost.render(frame)
    } else {
      renderOverlayTestPattern(set, frame.frequencyData, frame.waveformData)
    }
  } else {
    // New path: ThreeJsEngine already rendered to webglCanvas.
    // Clear overlay for fresh layer drawing.
    const overlayCtx = set.overlay2dCanvas.getContext('2d')
    if (overlayCtx) {
      overlayCtx.clearRect(0, 0, set.overlay2dCanvas.width, set.overlay2dCanvas.height)
    }
  }

  // ─── Single beat computation (Tab 10 approach: compute once per frame) ──
  const beat = (layers && layers.length > 0)
    ? computeBeat(frame.frequencyData)
    : 0

  // ─── Beat scaling for image layers ────────────────────────────────────
  let layersToDraw: DrawableLayer[] | undefined = layers

  if (layers && layers.length > 0) {
    const { imageBeatEnabled, imageBeatIntensity } = useSongNhacRuntimeStore.getState()

    // Tab 10 scale formula: power curve × strength (default 0.8)
    let beatScale = 1
    if (imageBeatEnabled && imageBeatIntensity > 0 && beat > 0.01) {
      const strength = imageBeatIntensity  // 0–1.5 from slider
      beatScale = 1 + Math.pow(beat, 0.7) * strength
    }

    if (beatScale !== 1) {
      layersToDraw = layers.map((layer) => {
        if (layer.type !== 'image') return layer
        // Skip watermark/logo layers — they should not pulse with beat
        if (layer.role === 'watermark') return layer
        const t = layer.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }
        return {
          ...layer,
          transform: {
            ...t,
            scaleX: t.scaleX * beatScale,
            scaleY: t.scaleY * beatScale,
          },
        }
      })
    }
  }

  // ─── Draw layers (image/text + wave-around + glow) ────────────────────
  if (layersToDraw && layersToDraw.length > 0) {
    const ctx = set.overlay2dCanvas.getContext('2d')
    if (ctx) {
      let waveOptions: WaveOptions | undefined
      const { waveAroundImageEnabled, waveAroundIntensity, waveAroundStyle } = useSongNhacRuntimeStore.getState()
      if (waveAroundImageEnabled && waveAroundIntensity > 0 && layersToDraw.some((l) => l.type === 'image' && l.waveAroundEnabled)) {
        // Sub-sample time-domain waveform (shape fallback)
        const samples: number[] = []
        const wf = frame.waveformData
        const segs = 32
        const step = wf.length > 0 ? Math.max(1, Math.floor(wf.length / segs)) : 1
        for (let i = 0; i < segs; i++) {
          const idx = Math.min(i * step, wf.length - 1)
          samples.push(wf[idx] ?? 128)
        }

        // Sub-sample frequency spectrum (Tab 10: drives bar height directly)
        const freqData = frame.frequencyData
        const spectrum: number[] = []
        const specSegs = 64
        const freqStep = freqData.length > 0 ? Math.max(1, Math.floor(freqData.length / specSegs)) : 1
        for (let i = 0; i < specSegs; i++) {
          const fIdx = Math.min(i * freqStep, freqData.length - 1)
          spectrum.push(freqData[fIdx] ?? 0)
        }

        // Pre-compute band energies (bass / mid / treble)
        const bassEnd = Math.max(1, Math.floor(freqData.length * 0.08))
        const midEnd  = Math.max(2, Math.floor(freqData.length * 0.25))
        let bassSum = 0, midSum = 0, trebleSum = 0
        for (let i = 0; i < freqData.length; i++) {
          const v = freqData[i] ?? 0
          if (i < bassEnd) bassSum += v
          else if (i < midEnd) midSum += v
          else trebleSum += v
        }
        const bands = {
          bass:   Math.min(1, bassSum   / (bassEnd * 200)),
          mid:    Math.min(1, midSum    / ((midEnd - bassEnd) * 180)),
          treble: Math.min(1, trebleSum / ((freqData.length - midEnd) * 150)),
        }

        // Tab 10 approach: bars always visible when audio plays
        // Frequency spectrum drives bar height; amplitude is a scale factor
        const avgEnergy = (bands.bass * 2 + bands.mid + bands.treble) / 4
        const baseAmplitude = Math.max(0.4, avgEnergy * 2)
        // Beat adds extra punch (like Tab 10's beat glow scaling)
        const beatBoost = 1 + beat * 0.6
        const amplitude = Math.min(2.5, baseAmplitude * beatBoost) * waveAroundIntensity

        waveOptions = { amplitude, samples, style: waveAroundStyle, spectrum, bands, beat }
      }
      drawLayers(ctx, layersToDraw, set.overlay2dCanvas.width, set.overlay2dCanvas.height, waveOptions, beat, frame.timeSec)
    }
  }

  renderComposite(set)
}

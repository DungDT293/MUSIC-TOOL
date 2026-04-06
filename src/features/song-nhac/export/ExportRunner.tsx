/**
 * Chức năng 13 — Backend wiring. Chạy trong offscreen (hash #export).
 * Không UI; lắng config → runExportRuntime → sendExportFrame / sendExportDone.
 *
 * v2: WebCodecs H.264 GPU encoding — skip JPEG entirely when available.
 *     Fallback to JPEG pipeline nếu WebCodecs không hỗ trợ.
 */

import { useEffect, useRef } from 'react'
import {
  runExportRuntime,
  createAudioSourceIpc,
  createAudioSourcePrecomputed,
  type ExportConfig,
} from '../runtime/export'
import { resetBeatState } from '../runtime/export/renderOneFrame'
import { createIpcFrameSink } from './IpcFrameSink'
import { createWebCodecsFrameSink, isWebCodecsH264Available } from './WebCodecsFrameSink'
import { songNhacLayersToDrawable } from '../runtime/render/songNhacLayersToDrawable'
import { useSongNhacRuntimeStore } from '../store/songNhacRuntimeStore'
import type { SongNhacLayer } from '../types/layerTypes'
import type { DrawableLayer } from '../runtime/render/drawLayers'

export interface ExportConfigFromMain extends ExportConfig {
  jobId: string
  audioFileUrl: string
  outputPath?: string
  layers?: SongNhacLayer[]
  runtimeSettings?: Record<string, unknown>
  /** Main process has pre-decoded PCM in memory; offscreen will request samples via IPC. */
  pcmReady?: boolean
  pcmSampleRate?: number
  pcmDuration?: number
  /** Encoder quality preset from main process. */
  encoderQuality?: string
  /** Video bitrate in kbps — forwarded from main process for WebCodecs. */
  videoBitrateKbps?: number
}

declare const window: Window & {
  api?: {
    songNhac?: {
      sendExportReady: (opts?: { webcodecs?: boolean }) => void
      sendExportConfigAck: (jobId: string) => void
      onExportConfig: (cb: (config: ExportConfigFromMain) => void) => () => void
      onExportCancel: (cb: () => void) => () => void
      sendExportFrame: (payload: { jobId: string; frameIndex: number; width: number; height: number; buffer: ArrayBuffer }) => void
      sendExportProgress: (payload: { jobId: string; frameIndex: number; totalFrames: number }) => void
      sendExportEnd: (jobId: string) => void
      sendExportDone: (payload?: { ok?: boolean; error?: string; framesWritten?: number }) => void
      /** Back-pressure: invoke-based wait for main process queue to drain. */
      waitForDrain?: (jobId: string) => Promise<void>
      /** Request 2048 PCM samples for a given time from main process. */
      getPcmSamples?: (jobId: string, timeSec: number) => Promise<Float32Array>
    }
  }
}

export default function ExportRunner() {
  const runningRef = useRef(false)
  const cancelledRef = useRef(false)

  useEffect(() => {
    const api = window.api?.songNhac
    if (!api) {
      console.error('[ExportRunner] window.api.songNhac not available')
      return
    }

    // Detect WebCodecs H.264 support before signaling ready
    let webCodecsAvailable = false
    isWebCodecsH264Available(1920, 1080).then(ok => {
      webCodecsAvailable = ok
      console.log(`[ExportRunner] WebCodecs H.264: ${ok ? 'AVAILABLE ✓' : 'not available ✗'}`)
      api.sendExportReady({ webcodecs: ok })
    }).catch(() => {
      api.sendExportReady({ webcodecs: false })
    })

    const unsubCancel = api.onExportCancel?.(() => { cancelledRef.current = true }) ?? (() => {})

    const unsub = api.onExportConfig((config: ExportConfigFromMain) => {
      if (runningRef.current) return
      runningRef.current = true
      cancelledRef.current = false
      const { jobId, width, height, fps, durationSec, audioFileUrl, devicePixelRatio = 1, layers: rawLayers, runtimeSettings } = config
      const startSec = (config as any).startSec ?? 0
      const forceSoftwareRenderer = (config as any).forceSoftwareRenderer === true
      console.log('[ExportRunner] received config', { jobId, width, height, fps, durationSec, layerCount: rawLayers?.length ?? 0, forceSoftwareRenderer, webCodecsAvailable })
      api.sendExportConfigAck?.(jobId)

      // Hydrate runtime store with wave/beat settings from main window
      if (runtimeSettings) {
        const store = useSongNhacRuntimeStore.getState()
        if (typeof runtimeSettings.imageBeatEnabled === 'boolean') store.setImageBeatEnabled(runtimeSettings.imageBeatEnabled)
        if (typeof runtimeSettings.imageBeatIntensity === 'number') store.setImageBeatIntensity(runtimeSettings.imageBeatIntensity)
        if (typeof runtimeSettings.waveAroundImageEnabled === 'boolean') store.setWaveAroundImageEnabled(runtimeSettings.waveAroundImageEnabled)
        if (typeof runtimeSettings.waveAroundIntensity === 'number') store.setWaveAroundIntensity(runtimeSettings.waveAroundIntensity)
        if (typeof runtimeSettings.waveAroundStyle === 'string') store.setWaveAroundStyle(runtimeSettings.waveAroundStyle as any)
        if (typeof runtimeSettings.bgEngine === 'string') store.setBgEngine(runtimeSettings.bgEngine as any)
        if (typeof runtimeSettings.bgMode === 'string') store.setBgMode(runtimeSettings.bgMode as any)
        if (typeof runtimeSettings.visualizerLayout === 'string') store.setVisualizerLayout(runtimeSettings.visualizerLayout as any)
        if (runtimeSettings.threejsPreset != null) store.setThreejsPreset(runtimeSettings.threejsPreset as any)
        if (typeof runtimeSettings.bloomStrength === 'number') store.setBloomStrength(runtimeSettings.bloomStrength)
        if (typeof runtimeSettings.bloomRadius === 'number') store.setBloomRadius(runtimeSettings.bloomRadius)
        if (typeof runtimeSettings.bloomThreshold === 'number') store.setBloomThreshold(runtimeSettings.bloomThreshold)
        if (typeof runtimeSettings.barCount === 'number') store.setBarCount(runtimeSettings.barCount)
        if (runtimeSettings.audiomotionMode != null) store.setAudiomotionMode(runtimeSettings.audiomotionMode as any)
        if (typeof runtimeSettings.audiomotionGradient === 'string') store.setAudiomotionGradient(runtimeSettings.audiomotionGradient)
        if (typeof runtimeSettings.audiomotionRadial === 'boolean') store.setAudiomotionRadial(runtimeSettings.audiomotionRadial)
        if (typeof runtimeSettings.audiomotionLedBars === 'boolean') store.setAudiomotionLedBars(runtimeSettings.audiomotionLedBars)
        if (typeof runtimeSettings.wavejsAnimation === 'string') store.setWavejsAnimation(runtimeSettings.wavejsAnimation)
        if (typeof runtimeSettings.vantaEffect === 'string') store.setVantaEffect(runtimeSettings.vantaEffect)
        if (typeof runtimeSettings.butterchurnPreset === 'string') store.setButterchurnPreset(runtimeSettings.butterchurnPreset)
      }

      // Convert layers to DrawableLayer[] (once, reused every frame)
      let drawableLayers: DrawableLayer[] = []
      if (rawLayers && rawLayers.length > 0) {
        drawableLayers = songNhacLayersToDrawable(rawLayers)
      }

      const run = async () => {
        try {
          resetBeatState()

          let audioSource: Awaited<ReturnType<typeof createAudioSourcePrecomputed>>['source']
          let decodedDuration: number

          const pcmReady = (config as ExportConfigFromMain).pcmReady
          const pcmSR = (config as ExportConfigFromMain).pcmSampleRate
          const pcmDur = (config as ExportConfigFromMain).pcmDuration

          if (pcmReady && pcmSR && pcmDur && api.getPcmSamples) {
            console.log('[ExportRunner] Fast path: IPC per-frame PCM. sampleRate=', pcmSR, 'duration=', pcmDur.toFixed(1))
            const fetchSamples = (timeSec: number) => api.getPcmSamples!(jobId, timeSec)
            const result = createAudioSourceIpc(pcmSR, pcmDur, fetchSamples)
            audioSource = result.source
            decodedDuration = result.duration
          } else {
            console.log('[ExportRunner] Fallback: Web Audio decode...', audioFileUrl.slice(0, 80))
            const result = await createAudioSourcePrecomputed(audioFileUrl)
            audioSource = result.source
            decodedDuration = result.duration
          }

          const duration = Math.min(decodedDuration, durationSec)
          const totalFrames = Math.max(1, Math.floor(duration * fps))
          console.log('[ExportRunner] Decoded OK. duration=', duration.toFixed(1), 'totalFrames=', totalFrames)

          const exportConfig: ExportConfig = {
            width,
            height,
            fps,
            durationSec: duration,
            devicePixelRatio,
            startSec: startSec > 0 ? startSec : undefined,
            forceSoftwareRenderer: forceSoftwareRenderer || undefined,
          }

          // ── Try WebCodecs first, fallback to JPEG ──
          const ipcOpts = {
            jobId,
            width,
            height,
            sendFrame: (p: any) => api.sendExportFrame(p),
            sendProgress: (p: any) => api.sendExportProgress(p),
            sendEnd: (jid: string) => api.sendExportEnd(jid),
            waitForDrain: api.waitForDrain ? (jid: string) => api.waitForDrain!(jid) : undefined,
          }

          let useWebCodecs = false
          let frameSink: any
          let webCodecsSink: Awaited<ReturnType<typeof createWebCodecsFrameSink>> = null

          if (webCodecsAvailable && !forceSoftwareRenderer) {
            // Use bitrate from main process (based on user's quality selection)
            // Fallback: estimate from resolution if not provided
            const bitrateKbps = (config as ExportConfigFromMain).videoBitrateKbps
              ?? (width >= 1920 ? 15000 : width >= 1280 ? 10000 : 8000)
            webCodecsSink = await createWebCodecsFrameSink(totalFrames, {
              ...ipcOpts,
              fps,
              bitrateKbps,
            })
          }

          if (webCodecsSink) {
            frameSink = webCodecsSink
            useWebCodecs = true
            console.log('[ExportRunner] ★ Using WebCodecs H.264 GPU encoding')
          } else {
            frameSink = createIpcFrameSink(totalFrames, ipcOpts)
            console.log('[ExportRunner] Using JPEG → NVENC/libx264 pipeline')
          }

          await runExportRuntime({
            config: exportConfig,
            audioSource,
            frameSink,
            onProgress: undefined,
            isCancelled: () => cancelledRef.current,
            skipYield: true,
            getLayers: drawableLayers.length > 0 ? () => drawableLayers : undefined,
            useWebCodecs,
            // Bind canvasSet to WebCodecs sink when canvas is ready
            onCanvasReady: webCodecsSink ? (set) => webCodecsSink!.setCanvasSet(set) : undefined,
          })
          if (!cancelledRef.current) api.sendExportDone({ ok: true, framesWritten: totalFrames })
          else api.sendExportDone({ ok: false, error: 'Cancelled' })
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e)
          console.error('[ExportRunner] error', errMsg)
          api.sendExportDone({ ok: false, error: errMsg })
        } finally {
          runningRef.current = false
        }
      }

      run()
    })

    return () => {
      cancelledRef.current = true
      unsub()
      unsubCancel()
    }
  }, [])

  return null
}

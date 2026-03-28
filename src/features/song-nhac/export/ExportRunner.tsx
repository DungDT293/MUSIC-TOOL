/**
 * Chức năng 13 — Backend wiring. Chạy trong offscreen (hash #export).
 * Không UI; lắng config → runExportRuntime → sendExportFrame / sendExportDone.
 */

import { useEffect, useRef } from 'react'
import {
  runExportRuntime,
  createAudioSourceIpc,
  createAudioSourcePrecomputed,
  type ExportConfig,
} from '../runtime/export'
import { createIpcFrameSink } from './IpcFrameSink'
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
}

declare const window: Window & {
  api?: {
    songNhac?: {
      sendExportReady: () => void
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

    api.sendExportReady()
    const unsubCancel = api.onExportCancel?.(() => { cancelledRef.current = true }) ?? (() => {})

    const unsub = api.onExportConfig((config: ExportConfigFromMain) => {
      if (runningRef.current) return
      runningRef.current = true
      cancelledRef.current = false
      const { jobId, width, height, fps, durationSec, audioFileUrl, devicePixelRatio = 1, layers: rawLayers, runtimeSettings } = config
      // startSec: offset vào trong track khi export từ range (e.g. inSec)
      const startSec = (config as any).startSec ?? 0
      console.log('[ExportRunner] received config', { jobId, width, height, fps, durationSec, layerCount: rawLayers?.length ?? 0 })
      api.sendExportConfigAck?.(jobId)

      // Hydrate runtime store with wave/beat settings from main window
      if (runtimeSettings) {
        const store = useSongNhacRuntimeStore.getState()
        if (typeof runtimeSettings.imageBeatEnabled === 'boolean') store.setImageBeatEnabled(runtimeSettings.imageBeatEnabled)
        if (typeof runtimeSettings.imageBeatIntensity === 'number') store.setImageBeatIntensity(runtimeSettings.imageBeatIntensity)
        if (typeof runtimeSettings.waveAroundImageEnabled === 'boolean') store.setWaveAroundImageEnabled(runtimeSettings.waveAroundImageEnabled)
        if (typeof runtimeSettings.waveAroundIntensity === 'number') store.setWaveAroundIntensity(runtimeSettings.waveAroundIntensity)
        if (typeof runtimeSettings.waveAroundStyle === 'string') store.setWaveAroundStyle(runtimeSettings.waveAroundStyle as any)
      }

      // Convert layers to DrawableLayer[] (once, reused every frame)
      let drawableLayers: DrawableLayer[] = []
      if (rawLayers && rawLayers.length > 0) {
        drawableLayers = songNhacLayersToDrawable(rawLayers)
      }

      const run = async () => {
        try {
          // Fast path: main process pre-decoded audio via FFmpeg → temp raw PCM file on disk
          // Offscreen fetches the raw file (no decode needed) → ~1-3s instead of 10+ minutes
          let audioSource: Awaited<ReturnType<typeof createAudioSourcePrecomputed>>['source']
          let decodedDuration: number

          const pcmReady = (config as ExportConfigFromMain).pcmReady
          const pcmSR = (config as ExportConfigFromMain).pcmSampleRate
          const pcmDur = (config as ExportConfigFromMain).pcmDuration

          if (pcmReady && pcmSR && pcmDur && api.getPcmSamples) {
            // Fast path: PCM is in main process memory. Request 2048 samples per frame via IPC (~8KB each).
            console.log('[ExportRunner] Fast path: IPC per-frame PCM. sampleRate=', pcmSR, 'duration=', pcmDur.toFixed(1))
            const fetchSamples = (timeSec: number) => api.getPcmSamples!(jobId, timeSec)
            const result = createAudioSourceIpc(pcmSR, pcmDur, fetchSamples)
            audioSource = result.source
            decodedDuration = result.duration
          } else {
            // Fallback: old Web Audio API decode path (slow for large files)
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
          }
          const frameSink = createIpcFrameSink(totalFrames, {
            jobId,
            width,
            height,
            sendFrame: (p) => api.sendExportFrame(p),
            sendProgress: (p) => api.sendExportProgress(p),
            sendEnd: (jid) => api.sendExportEnd(jid),
            waitForDrain: api.waitForDrain ? (jid) => api.waitForDrain!(jid) : undefined,
          })

          await runExportRuntime({
            config: exportConfig,
            audioSource,
            frameSink,
            onProgress: undefined,
            isCancelled: () => cancelledRef.current,
            skipYield: true,
            getLayers: drawableLayers.length > 0 ? () => drawableLayers : undefined,
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
      unsub()
      unsubCancel()
    }
  }, [])

  return null
}

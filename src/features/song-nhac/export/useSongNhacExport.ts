/**
 * Chức năng 13 — Bước 5. Hook khởi chạy export (in-window test hoặc sau này offscreen).
 * Không block UI (yield mỗi frame); progress + cancel từ store.
 */

import { useCallback } from 'react'
import {
  runExportRuntime,
  createAudioSourceExport,
  createBufferFrameSink,
  type ExportConfig,
} from '../runtime/export'
import { useSongNhacExportStore } from '../store/songNhacExportStore'

const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 180
const DEFAULT_FPS = 60
const DEFAULT_DURATION_SEC = 10

export interface StartExportInWindowOptions {
  audioUrl: string
  width?: number
  height?: number
  fps?: number
  durationSec?: number
}

export function useSongNhacExport() {
  const setExporting = useSongNhacExportStore((s) => s.setExporting)
  const setProgress = useSongNhacExportStore((s) => s.setProgress)
  const setError = useSongNhacExportStore((s) => s.setError)
  const cancelRequested = useSongNhacExportStore((s) => s.cancelRequested)
  const clearCancel = useSongNhacExportStore((s) => s.clearCancel)

  const startExportInWindow = useCallback(
    async (options: StartExportInWindowOptions) => {
      const {
        audioUrl,
        width = DEFAULT_WIDTH,
        height = DEFAULT_HEIGHT,
        fps = DEFAULT_FPS,
        durationSec = DEFAULT_DURATION_SEC,
      } = options

      clearCancel()
      setError(null)
      setExporting(true)

      const audio = document.createElement('audio')
      audio.crossOrigin = 'anonymous'
      audio.preload = 'auto'

      await new Promise<void>((resolve, reject) => {
        audio.addEventListener('canplaythrough', () => resolve(), { once: true })
        audio.addEventListener('error', () => reject(new Error('Audio load failed')), { once: true })
        audio.src = audioUrl
      })

      const duration = Math.min(audio.duration, durationSec)
      const config: ExportConfig = { width, height, fps, durationSec: duration, devicePixelRatio: 1 }
      const audioSource = createAudioSourceExport(audio)
      const frameSink = createBufferFrameSink()

      try {
        await runExportRuntime({
          config,
          audioSource,
          frameSink,
          onProgress: setProgress,
          isCancelled: () => useSongNhacExportStore.getState().cancelRequested,
        })
        const frames = frameSink.getFrames()
        setProgress({ frameIndex: frames.length - 1, totalFrames: frames.length, timeSec: duration })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setExporting(false)
      }
    },
    [setExporting, setProgress, setError, clearCancel]
  )

  return { startExportInWindow }
}

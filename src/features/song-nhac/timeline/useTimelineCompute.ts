/**
 * Chức năng 13 — Bước 4. Hook khởi chạy Timeline Worker.
 * Main thread decode xong → gọi startCompute(channelData, sampleRate, duration).
 * Không import runtime/audio/engine.
 */

import { useRef, useCallback, useEffect } from 'react'
import { useSongNhacTimelineStore } from '../store/songNhacTimelineStore'
import type { TimelineData } from './types'
import type { TimelineWorkerInput } from './types'

type WorkerMessage = { type: 'result'; data: TimelineData } | { type: 'error'; message: string }

export function useTimelineCompute() {
  const workerRef = useRef<Worker | null>(null)
  const setTimelineData = useSongNhacTimelineStore((s) => s.setTimelineData)
  const setLoadingTimeline = useSongNhacTimelineStore((s) => s.setLoadingTimeline)

  const startCompute = useCallback(
    (channelData: Float32Array, sampleRate: number, duration: number, resolution?: number) => {
      // Terminate any existing worker to clear all stale listeners before starting fresh.
      // Without this, rapid calls accumulate multiple message/error listeners on the same
      // worker, causing stale handlers to fire on a later response.
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
      workerRef.current = new Worker(
        new URL('./worker/timelineWorker.ts', import.meta.url),
        { type: 'module' }
      )
      const worker = workerRef.current
      setLoadingTimeline(true)
      setTimelineData(null)

      const onMessage = (e: MessageEvent<WorkerMessage>) => {
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
        setLoadingTimeline(false)
        if (e.data.type === 'result') {
          setTimelineData(e.data.data)
        }
      }
      const onError = () => {
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
        setLoadingTimeline(false)
      }

      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)

      // Tránh OOM: giới hạn số sample gửi vào worker (downsample nếu quá dài)
      const MAX_SAMPLES = 44100 * 60 * 15 // ~15 phút ở 44.1kHz
      let dataToSend: Float32Array = channelData
      if (channelData.length > MAX_SAMPLES) {
        const step = Math.ceil(channelData.length / MAX_SAMPLES)
        const len = Math.ceil(channelData.length / step)
        dataToSend = new Float32Array(len)
        for (let i = 0; i < len; i++) dataToSend[i] = channelData[i * step] ?? 0
      } else {
        dataToSend = channelData.slice(0)
      }

      const input: TimelineWorkerInput = {
        channelData: dataToSend,
        sampleRate,
        duration,
        resolution,
      }
      worker.postMessage(input)
    },
    [setTimelineData, setLoadingTimeline]
  )

  // Bug #1 fix: terminate worker on unmount to prevent zombie thread
  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  return { startCompute }
}

/**
 * Chức năng 13 — Bước 4. Timeline Web Worker.
 * Nhận channelData + sampleRate + duration → compute peaks + beats → post TimelineData.
 * Không import runtime/audio/engine.
 */

import type { TimelineData, TimelineWorkerInput } from '../types'
import { computeWaveformPeaks } from './computeWaveformPeaks'
import { computeBeats } from './computeBeats'

self.onmessage = (e: MessageEvent<TimelineWorkerInput>) => {
  const { channelData, sampleRate, duration, resolution = 1000 } = e.data
  if (!channelData || !sampleRate || duration == null) {
    self.postMessage({ type: 'error', message: 'Missing channelData/sampleRate/duration' })
    return
  }

  try {
    const peaks = computeWaveformPeaks(channelData, duration, resolution)
    const beats = computeBeats(channelData, sampleRate, duration)
    const data: TimelineData = { duration, peaks, beats }
    self.postMessage({ type: 'result', data })
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

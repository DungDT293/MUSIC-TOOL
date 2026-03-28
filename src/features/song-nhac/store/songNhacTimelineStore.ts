/**
 * Chức năng 13 — Bước 4. Timeline UI state (data + zoom + scroll + playhead).
 * Không FFT, không RAF. Timeline chỉ subscribe data/zoom/scroll; playhead cập nhật chậm.
 */

import { create } from 'zustand'
import type { TimelineData } from '../timeline/types'

interface SongNhacTimelineState {
  timelineData: TimelineData | null
  setTimelineData: (data: TimelineData | null) => void
  zoom: number
  scrollPx: number
  playheadTimeSec: number
  setZoom: (z: number) => void
  setScrollPx: (px: number) => void
  setPlayheadTimeSec: (t: number) => void
  isLoadingTimeline: boolean
  setLoadingTimeline: (v: boolean) => void
}

export const useSongNhacTimelineStore = create<SongNhacTimelineState>((set) => ({
  timelineData: null,
  setTimelineData: (data) => set({ timelineData: data }),
  zoom: 1,
  scrollPx: 0,
  playheadTimeSec: 0,
  setZoom: (z) => set({ zoom: Math.max(0.25, Math.min(8, z)) }),
  setScrollPx: (px) => set({ scrollPx: Math.max(0, px) }),
  setPlayheadTimeSec: (t) => set({ playheadTimeSec: t }),
  isLoadingTimeline: false,
  setLoadingTimeline: (v) => set({ isLoadingTimeline: v }),
}))

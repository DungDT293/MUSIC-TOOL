/**
 * Bước 6 — Audio Input & Binding.
 * Store nhẹ: chỉ audioFileUrl, durationSec, displayName (string/number).
 * Không lưu FFT, buffer, HTMLAudioElement.
 */

import { create } from 'zustand'
import type { SongNhacAudioSource } from '../types/AudioSourceState'
import { EMPTY_AUDIO_SOURCE } from '../types/AudioSourceState'

interface SongNhacAudioState extends SongNhacAudioSource {
  setAudioSource: (src: SongNhacAudioSource) => void
  setDurationSec: (sec: number) => void
  clearAudioSource: () => void
}

export const useSongNhacAudioStore = create<SongNhacAudioState>((set) => ({
  ...EMPTY_AUDIO_SOURCE,
  setAudioSource: (src) => set(src),
  setDurationSec: (sec) => set({ durationSec: sec }),
  clearAudioSource: () => set(EMPTY_AUDIO_SOURCE),
}))

/**
 * Bước 6 — Audio Input & Binding.
 * State gọn (UI-only); không lưu audio element, buffer, FFT.
 */

export interface SongNhacAudioSource {
  audioFileUrl: string | null
  durationSec: number | null
  displayName: string | null
}

export const EMPTY_AUDIO_SOURCE: SongNhacAudioSource = {
  audioFileUrl: null,
  durationSec: null,
  displayName: null,
}

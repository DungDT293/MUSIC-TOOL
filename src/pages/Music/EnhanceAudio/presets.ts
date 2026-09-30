/**
 * presets.ts — Professional mastering presets per genre/platform
 * Based on industry-standard settings from professional DAWs and streaming platforms.
 */
import type {
  EQSettings, CompressorSettings, LoudnormSettings, StereoSettings,
  NoiseGateSettings, LimiterSettings, ExciterSettings, NoiseReductionSettings,
} from '../../../types/ipc'

export interface EnhanceAudioSettings {
  eq: EQSettings
  compressor: CompressorSettings
  loudnorm: LoudnormSettings
  stereo: StereoSettings
  noiseGate: NoiseGateSettings
  limiter: LimiterSettings
  exciter: ExciterSettings
  noiseReduction: NoiseReductionSettings
}

export interface EnhanceAudioPresetSettings {
  eq?: Partial<EQSettings>
  compressor?: Partial<CompressorSettings>
  loudnorm?: Partial<LoudnormSettings>
  stereo?: Partial<StereoSettings>
  noiseGate?: Partial<NoiseGateSettings>
  limiter?: Partial<LimiterSettings>
  exciter?: Partial<ExciterSettings>
  noiseReduction?: Partial<NoiseReductionSettings>
}

export function applyPresetDefaults(
  partial: EnhanceAudioPresetSettings,
  defaults: EnhanceAudioSettings,
): EnhanceAudioSettings {
  return {
    eq: { ...defaults.eq, ...(partial.eq ?? {}) },
    compressor: { ...defaults.compressor, ...(partial.compressor ?? {}) },
    loudnorm: { ...defaults.loudnorm, ...(partial.loudnorm ?? {}) },
    stereo: { ...defaults.stereo, ...(partial.stereo ?? {}) },
    noiseGate: { ...defaults.noiseGate, ...(partial.noiseGate ?? {}) },
    limiter: { ...defaults.limiter, ...(partial.limiter ?? {}) },
    exciter: { ...defaults.exciter, ...(partial.exciter ?? {}) },
    noiseReduction: { ...defaults.noiseReduction, ...(partial.noiseReduction ?? {}) },
  }
}

export interface MasterPreset {
  name: string
  description: string
  category: 'genre' | 'platform' | 'voice' | 'utility'
  eq: Partial<EQSettings>
  compressor: Partial<CompressorSettings>
  loudnorm: Partial<LoudnormSettings>
  stereo: Partial<StereoSettings>
  noiseGate?: Partial<NoiseGateSettings>
  limiter?: Partial<LimiterSettings>
  exciter?: Partial<ExciterSettings>
  noiseReduction?: Partial<NoiseReductionSettings>
}

export const MASTER_PRESETS: MasterPreset[] = [
  // ── Platform targets ──────────────────────────────────────────────────────
  {
    name: 'YouTube / Spotify',
    description: 'Chuẩn -14 LUFS cho streaming — nhạc không bị giảm âm lượng khi tải lên',
    category: 'platform',
    eq: { enabled: false, highpassHz: 20, lowpassHz: 22050, bassGainDb: 0, band1Gain: 0, midGainDb: 0, band2Gain: 0, trebleGainDb: 0 },
    compressor: { enabled: true, thresholdDb: -20, ratio: 3, attackMs: 8, releaseMs: 100, makeupGainDb: 2, knee: 3, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -14, truePeakDbtp: -1, lra: 11 },
    stereo: { enabled: false, amount: 1 },
    limiter: { enabled: true, thresholdDbtp: -1, attackMs: 1, releaseMs: 50 },
  },
  {
    name: 'Apple Music',
    description: 'Chuẩn -16 LUFS — nhiều headroom hơn, chất lượng cao hơn',
    category: 'platform',
    eq: { enabled: false, highpassHz: 20, lowpassHz: 22050, bassGainDb: 0, band1Gain: 0, midGainDb: 0, band2Gain: 0, trebleGainDb: 0 },
    compressor: { enabled: true, thresholdDb: -22, ratio: 2.5, attackMs: 10, releaseMs: 120, makeupGainDb: 2, knee: 4, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -16, truePeakDbtp: -1, lra: 11 },
    stereo: { enabled: false, amount: 1 },
    limiter: { enabled: true, thresholdDbtp: -1, attackMs: 1, releaseMs: 80 },
  },
  {
    name: 'Broadcast (EBU R128)',
    description: 'Tiêu chuẩn truyền hình/phát thanh quốc tế -23 LUFS',
    category: 'platform',
    eq: { enabled: false, highpassHz: 40, lowpassHz: 22050, bassGainDb: 0, band1Gain: 0, midGainDb: 0, band2Gain: 0, trebleGainDb: 0 },
    compressor: { enabled: true, thresholdDb: -28, ratio: 1.5, attackMs: 30, releaseMs: 300, makeupGainDb: 1, knee: 6, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -23, truePeakDbtp: -1, lra: 18 },
    stereo: { enabled: false, amount: 1 },
    limiter: { enabled: true, thresholdDbtp: -1, attackMs: 2, releaseMs: 100 },
  },
  {
    name: 'SoundCloud / DJ',
    description: 'Chuẩn -8 LUFS — to nhất có thể cho các nền tảng không normalize',
    category: 'platform',
    eq: { enabled: true, highpassHz: 30, lowpassHz: 22050, bassGainDb: 2, band1Gain: -2, midGainDb: 0, band2Gain: 2, trebleGainDb: 3 },
    compressor: { enabled: true, thresholdDb: -16, ratio: 4, attackMs: 5, releaseMs: 60, makeupGainDb: 5, knee: 2, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -8, truePeakDbtp: -0.5, lra: 5 },
    stereo: { enabled: true, amount: 1.8 },
    limiter: { enabled: true, thresholdDbtp: -0.5, attackMs: 1, releaseMs: 30 },
  },
  // ── Genre presets ─────────────────────────────────────────────────────────
  {
    name: 'Pop',
    description: 'Cân bằng, rõ giọng, radio-ready — phù hợp nhạc pop thương mại',
    category: 'genre',
    eq: { enabled: true, highpassHz: 40, lowpassHz: 22050, bassGainDb: 2, band1Gain: -2, midGainDb: 1, band2Gain: 2.5, trebleGainDb: 2 },
    compressor: { enabled: true, thresholdDb: -20, ratio: 3, attackMs: 8, releaseMs: 100, makeupGainDb: 3, knee: 3, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -10, truePeakDbtp: -1, lra: 8 },
    stereo: { enabled: true, amount: 1.3 },
    exciter: { enabled: true, freq: 7500, amount: 20, drive: 4, blend: 2 },
    limiter: { enabled: true, thresholdDbtp: -1, attackMs: 1, releaseMs: 80 },
  },
  {
    name: 'EDM / Electronic',
    description: 'Mạnh, to, stereo rộng — sub punch mạnh, highs sáng',
    category: 'genre',
    eq: { enabled: true, highpassHz: 30, lowpassHz: 22050, bassGainDb: 4, band1Gain: -3, midGainDb: -1.5, band2Gain: 2, trebleGainDb: 4 },
    compressor: { enabled: true, thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 70, makeupGainDb: 4, knee: 2, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -7, truePeakDbtp: -1, lra: 6 },
    stereo: { enabled: true, amount: 2 },
    exciter: { enabled: true, freq: 6000, amount: 30, drive: 5, blend: 3 },
    limiter: { enabled: true, thresholdDbtp: -0.5, attackMs: 1, releaseMs: 40 },
  },
  {
    name: 'Hip-Hop / Rap',
    description: 'Sub bass sâu, kick punch, giọng rap rõ ràng',
    category: 'genre',
    eq: { enabled: true, highpassHz: 25, lowpassHz: 22050, bassGainDb: 5, band1Gain: -3.5, midGainDb: -2, band2Gain: 2, trebleGainDb: 2 },
    compressor: { enabled: true, thresholdDb: -16, ratio: 5, attackMs: 5, releaseMs: 60, makeupGainDb: 5, knee: 2, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -9, truePeakDbtp: -1, lra: 7 },
    stereo: { enabled: true, amount: 1.5 },
    limiter: { enabled: true, thresholdDbtp: -1, attackMs: 1, releaseMs: 40 },
  },
  {
    name: 'Rock',
    description: 'Guitar nặng, trống punch, dynamic tự nhiên',
    category: 'genre',
    eq: { enabled: true, highpassHz: 50, lowpassHz: 22050, bassGainDb: 2, band1Gain: -2, midGainDb: 1.5, band2Gain: 2.5, trebleGainDb: 2 },
    compressor: { enabled: true, thresholdDb: -22, ratio: 3.5, attackMs: 15, releaseMs: 120, makeupGainDb: 3, knee: 3, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -12, truePeakDbtp: -1.5, lra: 10 },
    stereo: { enabled: true, amount: 1.4 },
    exciter: { enabled: true, freq: 5000, amount: 25, drive: 6, blend: 2 },
    limiter: { enabled: true, thresholdDbtp: -1.5, attackMs: 2, releaseMs: 80 },
  },
  {
    name: 'R&B / Soul',
    description: 'Ấm áp, smooth, silky — bass ấm, giọng hát nổi bật',
    category: 'genre',
    eq: { enabled: true, highpassHz: 35, lowpassHz: 22050, bassGainDb: 3, band1Gain: -1, midGainDb: 0, band2Gain: 1.5, trebleGainDb: 2 },
    compressor: { enabled: true, thresholdDb: -24, ratio: 2.5, attackMs: 12, releaseMs: 150, makeupGainDb: 2, knee: 4, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -11, truePeakDbtp: -1.5, lra: 9 },
    stereo: { enabled: true, amount: 1.4 },
    exciter: { enabled: true, freq: 7000, amount: 15, drive: 4, blend: 2 },
    limiter: { enabled: true, thresholdDbtp: -1, attackMs: 1, releaseMs: 80 },
  },
  {
    name: 'Classical / Orchestral',
    description: 'Trong sáng, tự nhiên, giữ nguyên dynamic toàn bộ',
    category: 'genre',
    eq: { enabled: true, highpassHz: 20, lowpassHz: 22050, bassGainDb: 0, band1Gain: -1, midGainDb: 0, band2Gain: 1, trebleGainDb: 0.5 },
    compressor: { enabled: true, thresholdDb: -30, ratio: 1.5, attackMs: 50, releaseMs: 500, makeupGainDb: 1, knee: 6, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -23, truePeakDbtp: -1, lra: 20 },
    stereo: { enabled: false, amount: 1 },
    limiter: { enabled: true, thresholdDbtp: -1, attackMs: 3, releaseMs: 200 },
  },
  {
    name: 'Jazz',
    description: 'Ấm áp, trong suốt, nhiều dynamic — giữ phong cách cổ điển',
    category: 'genre',
    eq: { enabled: true, highpassHz: 30, lowpassHz: 22050, bassGainDb: 1.5, band1Gain: -0.5, midGainDb: 0, band2Gain: 0.5, trebleGainDb: 1 },
    compressor: { enabled: true, thresholdDb: -28, ratio: 1.8, attackMs: 30, releaseMs: 300, makeupGainDb: 1, knee: 5, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -17, truePeakDbtp: -1, lra: 14 },
    stereo: { enabled: false, amount: 1 },
    limiter: { enabled: true, thresholdDbtp: -1, attackMs: 2, releaseMs: 150 },
  },
  {
    name: 'Metal / Heavy',
    description: 'Aggressive, dày đặc, tight low-end — dành cho nhạc nặng',
    category: 'genre',
    eq: { enabled: true, highpassHz: 60, lowpassHz: 22050, bassGainDb: 3, band1Gain: -3, midGainDb: -2, band2Gain: 3, trebleGainDb: 2.5 },
    compressor: { enabled: true, thresholdDb: -14, ratio: 6, attackMs: 3, releaseMs: 40, makeupGainDb: 6, knee: 2, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -9, truePeakDbtp: -1, lra: 6 },
    stereo: { enabled: true, amount: 1.5 },
    exciter: { enabled: true, freq: 5000, amount: 30, drive: 7, blend: 2 },
    limiter: { enabled: true, thresholdDbtp: -1, attackMs: 1, releaseMs: 30 },
  },
  {
    name: 'Ambient / Lo-fi',
    description: 'Không gian rộng, nhiều dynamic, êm ắt — phù hợp nhạc nền',
    category: 'genre',
    eq: { enabled: true, highpassHz: 20, lowpassHz: 16000, bassGainDb: 1, band1Gain: 0, midGainDb: 0, band2Gain: 0, trebleGainDb: -1 },
    compressor: { enabled: true, thresholdDb: -30, ratio: 1.5, attackMs: 100, releaseMs: 800, makeupGainDb: 1, knee: 6, mix: 0.7 },
    loudnorm: { enabled: true, integratedLufs: -20, truePeakDbtp: -1, lra: 16 },
    stereo: { enabled: true, amount: 1.6 },
    limiter: { enabled: true, thresholdDbtp: -1, attackMs: 5, releaseMs: 200 },
  },
  // ── Voice presets ─────────────────────────────────────────────────────────
  {
    name: 'Podcast / Giọng nói',
    description: 'Lọc âm nền, cắt mud, giữ giọng rõ ràng — chuẩn cho podcast',
    category: 'voice',
    eq: { enabled: true, highpassHz: 100, lowpassHz: 12000, bassGainDb: -1, band1Gain: -3, midGainDb: 2, band2Gain: 1.5, trebleGainDb: 0 },
    compressor: { enabled: true, thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 50, makeupGainDb: 4, knee: 3, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -16, truePeakDbtp: -1.5, lra: 11 },
    stereo: { enabled: false, amount: 1 },
    noiseGate: { enabled: true, thresholdDb: -45, ratio: 6, attackMs: 5, releaseMs: 200, rangeDb: -30 },
    limiter: { enabled: true, thresholdDbtp: -1.5, attackMs: 1, releaseMs: 50 },
  },
  {
    name: 'Giọng hát (Vocal)',
    description: 'Làm nổi bật giọng hát, cắt bỏ âm nền, thêm độ sáng',
    category: 'voice',
    eq: { enabled: true, highpassHz: 80, lowpassHz: 18000, bassGainDb: -2, band1Gain: -3, midGainDb: 1.5, band2Gain: 2, trebleGainDb: 2 },
    compressor: { enabled: true, thresholdDb: -20, ratio: 3, attackMs: 8, releaseMs: 120, makeupGainDb: 3, knee: 3, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -14, truePeakDbtp: -1, lra: 10 },
    stereo: { enabled: false, amount: 1 },
    noiseGate: { enabled: true, thresholdDb: -50, ratio: 4, attackMs: 5, releaseMs: 150, rangeDb: -24 },
    exciter: { enabled: true, freq: 7000, amount: 25, drive: 4, blend: 3 },
    limiter: { enabled: true, thresholdDbtp: -1, attackMs: 1, releaseMs: 60 },
  },
  // ── Utility presets ───────────────────────────────────────────────────────
  {
    name: 'Khử nhiễu (Noise Cleanup)',
    description: 'Chỉ khử nhiễu — phục hồi bản ghi có tiếng ồn nền',
    category: 'utility',
    eq: { enabled: false, highpassHz: 20, lowpassHz: 22050, bassGainDb: 0, band1Gain: 0, midGainDb: 0, band2Gain: 0, trebleGainDb: 0 },
    compressor: { enabled: false, thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 50, makeupGainDb: 2, knee: 3, mix: 1 },
    loudnorm: { enabled: false, integratedLufs: -14, truePeakDbtp: -1, lra: 11 },
    stereo: { enabled: false, amount: 1 },
    noiseReduction: { enabled: true, noiseReducDb: 20, noiseFloorDb: -50 },
    noiseGate: { enabled: true, thresholdDb: -50, ratio: 6, attackMs: 5, releaseMs: 200, rangeDb: -30 },
  },
  {
    name: 'Nâng âm lượng (Volume Boost)',
    description: 'Chỉ chuẩn hóa âm lượng, không thay đổi tone',
    category: 'utility',
    eq: { enabled: false, highpassHz: 20, lowpassHz: 22050, bassGainDb: 0, band1Gain: 0, midGainDb: 0, band2Gain: 0, trebleGainDb: 0 },
    compressor: { enabled: false, thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 50, makeupGainDb: 2, knee: 3, mix: 1 },
    loudnorm: { enabled: true, integratedLufs: -14, truePeakDbtp: -1, lra: 11 },
    stereo: { enabled: false, amount: 1 },
    limiter: { enabled: true, thresholdDbtp: -1, attackMs: 1, releaseMs: 50 },
  },
]

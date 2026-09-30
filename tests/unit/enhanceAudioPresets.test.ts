import { describe, expect, it } from 'vitest'
import { applyPresetDefaults, type EnhanceAudioSettings } from '../../src/pages/Music/EnhanceAudio/presets'

const defaults: EnhanceAudioSettings = {
  eq: { enabled: false, highpassHz: 20, lowpassHz: 22050, bassGainDb: 0, band1Gain: 0, midGainDb: 0, band2Gain: 0, trebleGainDb: 0 },
  compressor: { enabled: false, thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 50, makeupGainDb: 2, knee: 2.83, mix: 1 },
  loudnorm: { enabled: false, integratedLufs: -14, truePeakDbtp: -1, lra: 11 },
  stereo: { enabled: false, amount: 1 },
  noiseGate: { enabled: false, thresholdDb: -40, ratio: 6, attackMs: 5, releaseMs: 200, rangeDb: -24 },
  limiter: { enabled: false, thresholdDbtp: -0.5, attackMs: 1, releaseMs: 50 },
  exciter: { enabled: false, freq: 7500, amount: 20, drive: 5, blend: 2 },
  noiseReduction: { enabled: false, noiseReducDb: 15, noiseFloorDb: -50 },
}

describe('applyPresetDefaults', () => {
  it('clears omitted effects when switching presets', () => {
    const first = applyPresetDefaults({
      noiseGate: { enabled: true, thresholdDb: -50, ratio: 6, attackMs: 5, releaseMs: 200, rangeDb: -30 },
      noiseReduction: { enabled: true, noiseReducDb: 20, noiseFloorDb: -50 },
    }, defaults)

    expect(first.noiseGate.enabled).toBe(true)
    expect(first.noiseReduction.enabled).toBe(true)

    const next = applyPresetDefaults({
      compressor: { enabled: true, ratio: 7 },
    }, defaults)

    expect(next.noiseGate.enabled).toBe(false)
    expect(next.noiseReduction.enabled).toBe(false)
    expect(next.compressor.enabled).toBe(true)
    expect(next.compressor.ratio).toBe(7)
    expect(next.compressor.thresholdDb).toBe(-18)
  })
})

import { describe, expect, it } from 'vitest'
import { audioFrameFromAnalyser, emptyAudioFrame } from '../../src/features/song-nhac/core/audioBands'
import { clampRenderConfig } from '../../src/features/song-nhac/core/types'

describe('Song Nhạc audio frame helpers', () => {
  it('maps silence to bounded zero energies', () => {
    const frame = emptyAudioFrame(1.25)
    expect(frame.timeSec).toBe(1.25)
    expect(frame.bass).toBe(0)
    expect(frame.mid).toBe(0)
    expect(frame.treble).toBe(0)
    expect(frame.rms).toBe(0)
    expect(frame.beat).toBe(0)
  })

  it('maps distinct FFT bands and keeps beat bounded', () => {
    const frequency = new Uint8Array(128)
    frequency.fill(255, 0, 10)
    frequency.fill(128, 10, 32)
    frequency.fill(64, 32)
    const waveform = new Uint8Array(128).fill(255)
    const frame = audioFrameFromAnalyser(2, frequency, waveform, 0)
    expect(frame.bass).toBeGreaterThan(frame.mid)
    expect(frame.mid).toBeGreaterThan(frame.treble)
    expect(frame.rms).toBeGreaterThan(0)
    expect(frame.beat).toBeGreaterThanOrEqual(0)
    expect(frame.beat).toBeLessThanOrEqual(1)
  })

  it('clamps render settings at trust boundary', () => {
    expect(clampRenderConfig({ style: 'pulse-grid', quality: 'full', intensity: 99, seed: 4.8 })).toEqual({
      style: 'pulse-grid', quality: 'full', intensity: 2, seed: 4,
    })
    expect(clampRenderConfig({ style: 'invalid' as never, quality: 'bad' as never, intensity: Number.NaN })).toEqual({
      style: 'avee-circle', quality: 'balanced', intensity: 1, seed: 93,
    })
  })
})

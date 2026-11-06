import { describe, expect, it } from 'vitest'
import { analyzeAudioBuffer, fftInPlace } from '../../src/features/song-nhac/export/spectrumAnalyzer'

function makeSineBuffer(frequency: number, seconds: number, sampleRate = 48000): AudioBuffer {
  const length = Math.ceil(seconds * sampleRate)
  const data = new Float32Array(length)
  for (let i = 0; i < length; i += 1) data[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate)
  return {
    numberOfChannels: 1,
    length,
    sampleRate,
    duration: seconds,
    getChannelData: () => data,
  } as unknown as AudioBuffer
}

describe('Song Nhạc spectrum analyzer', () => {
  it('fft places a pure tone in the expected bin', () => {
    const size = 1024
    const bin = 32
    const real = new Float32Array(size)
    const imag = new Float32Array(size)
    for (let i = 0; i < size; i += 1) real[i] = Math.cos((2 * Math.PI * bin * i) / size)
    fftInPlace(real, imag)
    let peak = 0
    let peakIndex = 0
    for (let i = 1; i < size / 2; i += 1) {
      const magnitude = Math.hypot(real[i], imag[i])
      if (magnitude > peak) {
        peak = magnitude
        peakIndex = i
      }
    }
    expect(peakIndex).toBe(bin)
  })

  it('produces one frame per video frame with bounded values', () => {
    const buffer = makeSineBuffer(100, 0.5)
    const frames = analyzeAudioBuffer(buffer, { fps: 30 })
    expect(frames.length).toBe(15)
    for (const frame of frames) {
      expect(frame.frequencyData.length).toBeGreaterThan(0)
      expect(frame.bass).toBeGreaterThanOrEqual(0)
      expect(frame.bass).toBeLessThanOrEqual(1)
      expect(frame.beat).toBeGreaterThanOrEqual(0)
      expect(frame.beat).toBeLessThanOrEqual(1)
      expect(frame.timeSec).toBeGreaterThanOrEqual(0)
    }
  })

  it('puts energy in the bass range for a low tone', () => {
    const low = analyzeAudioBuffer(makeSineBuffer(60, 0.4), { fps: 30 })[5]
    const high = analyzeAudioBuffer(makeSineBuffer(6000, 0.4), { fps: 30 })[5]
    expect(low.bass).toBeGreaterThan(low.treble)
    expect(high.treble).toBeGreaterThan(high.bass)
  })

  it('is deterministic for the same input', () => {
    const buffer = makeSineBuffer(220, 0.3)
    const first = analyzeAudioBuffer(buffer, { fps: 24 })
    const second = analyzeAudioBuffer(buffer, { fps: 24 })
    expect(second.map((frame) => frame.bass)).toEqual(first.map((frame) => frame.bass))
  })
})

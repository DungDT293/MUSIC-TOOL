import { describe, expect, it } from 'vitest'
import { emptyAudioFrame } from '../../src/features/song-nhac/core/audioBands'
import { renderSongNhacFrame } from '../../src/features/song-nhac/core/renderSongNhacFrame'
import { clampRenderConfig } from '../../src/features/song-nhac/core/types'

describe('Song Nhạc render core', () => {
  it('uses deterministic frame inputs without wall-clock state', () => {
    const operations: string[] = []
    const gradient = { addColorStop: () => {} }
    const context = {
      createRadialGradient: () => gradient,
      fillStyle: '',
      fillRect: () => operations.push('fill'),
      save: () => {},
      restore: () => {},
      globalCompositeOperation: 'source-over',
      lineWidth: 1,
      shadowBlur: 0,
      shadowColor: '',
      globalAlpha: 1,
      strokeStyle: '',
      fill: () => operations.push('fillPath'),
      stroke: () => operations.push('stroke'),
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      ellipse: () => {},
      arc: () => {},
    } as unknown as CanvasRenderingContext2D
    const frame = emptyAudioFrame(3.5)
    const config = clampRenderConfig({ style: 'neon-tunnel', quality: 'low', seed: 42 })
    renderSongNhacFrame(context, 320, 180, frame, config)
    const first = [...operations]
    operations.length = 0
    renderSongNhacFrame(context, 320, 180, frame, config)
    expect(operations).toEqual(first)
    expect(operations.length).toBeGreaterThan(0)
  })

  it('renders the avee-circle fallback deterministically without WebGL', () => {
    const operations: string[] = []
    const gradient = { addColorStop: () => {} }
    const context = {
      createRadialGradient: () => gradient,
      fillStyle: '',
      fillRect: () => operations.push('fill'),
      save: () => {},
      restore: () => {},
      globalCompositeOperation: 'source-over',
      lineWidth: 1,
      shadowBlur: 0,
      shadowColor: '',
      globalAlpha: 1,
      strokeStyle: '',
      fill: () => operations.push('fillPath'),
      stroke: () => operations.push('stroke'),
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      ellipse: () => {},
      arc: () => {},
    } as unknown as CanvasRenderingContext2D

    const spectrum = new Uint8Array(64).fill(180)
    const frame = { ...emptyAudioFrame(2.1), frequencyData: spectrum, bass: 0.6, beat: 0.4 }
    const config = clampRenderConfig({ style: 'avee-circle', quality: 'balanced', seed: 7 })

    renderSongNhacFrame(context, 480, 270, frame, config)
    const first = [...operations]
    operations.length = 0
    renderSongNhacFrame(context, 480, 270, frame, config)

    expect(operations).toEqual(first)
    // disc fill + mirrored bars + rings
    expect(operations.filter((op) => op === 'stroke').length).toBeGreaterThan(20)
  })
})

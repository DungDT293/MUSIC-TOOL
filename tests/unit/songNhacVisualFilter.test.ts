import { describe, expect, it } from 'vitest'
import { buildSongNhacVisualFilter } from '../../backend/video/songNhacVisualFilter'

describe('Song Nhạc visual filter builder', () => {
  it('maps orbit-spectrum to a bar spectrum sized to the request', () => {
    const filter = buildSongNhacVisualFilter({ style: 'orbit-spectrum', width: 1920, height: 1080 })
    expect(filter).toBe('showfreqs=s=1920x302:mode=bar:colors=0xd946ef|0x22d3ee')
  })

  it('maps pulse-grid to a centred waveform', () => {
    const filter = buildSongNhacVisualFilter({ style: 'pulse-grid', width: 1280, height: 720 })
    expect(filter).toBe('showwaves=s=1280x202:mode=cline:colors=0xd946ef')
  })

  it('keeps the Avee circle wave tall enough to stay visible', () => {
    const filter = buildSongNhacVisualFilter({ style: 'avee-circle', width: 1280, height: 480 })
    // 480 * 0.32 = 154, below the 220 floor
    expect(filter).toContain('s=1280x220')
    expect(filter).toContain('mode=cline')
    expect(filter).toContain('0x00f2fe|0xfe0979')
  })

  it('falls back to a plain waveform for unknown styles', () => {
    const filter = buildSongNhacVisualFilter({ style: 'neon-tunnel' as never, width: 1280, height: 720 })
    expect(filter).toContain('showwaves')
    expect(filter).toContain('mode=line')
  })

  it('clamps unusable dimensions instead of emitting NaN', () => {
    const filter = buildSongNhacVisualFilter({
      style: 'pulse-grid',
      width: Number.NaN,
      height: 0,
    })
    expect(filter).not.toContain('NaN')
    expect(filter).toBe('showwaves=s=1280x202:mode=cline:colors=0xd946ef')
  })

  it('is pure — same input yields the same string', () => {
    const first = buildSongNhacVisualFilter({ style: 'avee-circle', width: 1920, height: 1080 })
    const second = buildSongNhacVisualFilter({ style: 'avee-circle', width: 1920, height: 1080 })
    expect(second).toBe(first)
  })
})

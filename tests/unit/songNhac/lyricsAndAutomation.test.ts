import { describe, expect, it } from 'vitest'
import { activeLyricIndex, parseLyrics } from '../../../src/features/song-nhac/studio/lyrics'
import { evaluateAutomation } from '../../../src/features/song-nhac/studio/layerTypes'

describe('parseLyrics', () => {
  it('parses LRC timestamps in order', () => {
    const lines = parseLyrics('[00:12.50] Câu hai\n[00:05.00] Câu một', 180)
    expect(lines.map((line) => line.text)).toEqual(['Câu một', 'Câu hai'])
    expect(lines[0].timeSec).toBeCloseTo(5, 2)
    expect(lines[1].timeSec).toBeCloseTo(12.5, 2)
  })

  it('keeps multiple timestamps on one row', () => {
    const lines = parseLyrics('[00:01.00][00:07.00] Chorus', 60)
    expect(lines).toHaveLength(2)
    expect(lines.map((line) => line.timeSec)).toEqual([1, 7])
  })

  it('spreads plain text evenly across the track', () => {
    const lines = parseLyrics('một\nhai\nba\nbốn', 12)
    expect(lines).toHaveLength(4)
    expect(lines[0].timeSec).toBe(0)
    expect(lines[3].timeSec).toBeCloseTo(9, 1)
    for (let i = 1; i < lines.length; i += 1) {
      expect(lines[i].timeSec).toBeGreaterThan(lines[i - 1].timeSec)
    }
  })

  it('ignores blank lines and empty input', () => {
    expect(parseLyrics('   \n\n', 30)).toEqual([])
  })
})

describe('activeLyricIndex', () => {
  const lines = [
    { timeSec: 0, text: 'a' },
    { timeSec: 4, text: 'b' },
    { timeSec: 8, text: 'c' },
  ]

  it('returns -1 before the first line', () => {
    expect(activeLyricIndex([{ timeSec: 2, text: 'x' }], 1)).toBe(-1)
  })

  it('holds the last line until the next timestamp', () => {
    expect(activeLyricIndex(lines, 3.9)).toBe(0)
    expect(activeLyricIndex(lines, 4)).toBe(1)
    expect(activeLyricIndex(lines, 99)).toBe(2)
  })
})

describe('evaluateAutomation', () => {
  it('interpolates linearly between keyframes', () => {
    const automation = {
      property: 'opacity' as const,
      keyframes: [
        { timeSec: 0, value: 1 },
        { timeSec: 4, value: 0.2 },
      ],
    }
    expect(evaluateAutomation(automation, 0)).toBeCloseTo(1, 3)
    expect(evaluateAutomation(automation, 2)).toBeCloseTo(0.6, 3)
    expect(evaluateAutomation(automation, 4)).toBeCloseTo(0.2, 3)
  })

  it('clamps outside the keyframe range', () => {
    const automation = {
      property: 'scaleX' as const,
      keyframes: [
        { timeSec: 2, value: 1.5 },
        { timeSec: 5, value: 3 },
      ],
    }
    expect(evaluateAutomation(automation, 0)).toBe(1.5)
    expect(evaluateAutomation(automation, 10)).toBe(3)
  })

  it('returns null when there are no keyframes', () => {
    expect(evaluateAutomation({ property: 'x', keyframes: [] }, 3)).toBeNull()
  })
})

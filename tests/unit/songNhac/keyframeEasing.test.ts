import { describe, expect, it } from 'vitest'
import { applyEasing, evaluateAutomation } from '../../../src/features/song-nhac/studio/layerTypes'

describe('keyframe easing', () => {
  it('maps progress for each curve', () => {
    expect(applyEasing(0.5, 'linear')).toBeCloseTo(0.5, 3)
    expect(applyEasing(0.5, 'easeIn')).toBeCloseTo(0.25, 3)
    expect(applyEasing(0.5, 'easeOut')).toBeCloseTo(0.75, 3)
    expect(applyEasing(0.5, 'easeInOut')).toBeCloseTo(0.5, 3)
    expect(applyEasing(0.25, 'easeInOut')).toBeCloseTo(0.125, 3)
  })

  it('clamps outside 0..1', () => {
    expect(applyEasing(-1, 'easeIn')).toBe(0)
    expect(applyEasing(2, 'easeOut')).toBe(1)
  })

  it('uses the previous keyframe easing while interpolating', () => {
    const automation = {
      property: 'opacity' as const,
      keyframes: [
        { timeSec: 0, value: 0, easing: 'easeIn' as const },
        { timeSec: 4, value: 1 },
      ],
    }
    expect(evaluateAutomation(automation, 2)).toBeCloseTo(0.25, 3)
    expect(evaluateAutomation(automation, 4)).toBeCloseTo(1, 3)
  })

  it('defaults to linear when easing is missing', () => {
    const automation = {
      property: 'scaleX' as const,
      keyframes: [
        { timeSec: 0, value: 1 },
        { timeSec: 4, value: 3 },
      ],
    }
    expect(evaluateAutomation(automation, 2)).toBeCloseTo(2, 3)
  })
})

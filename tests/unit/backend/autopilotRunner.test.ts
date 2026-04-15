import { beforeEach, describe, expect, it } from 'vitest'
import {
  __autopilotTestUtils,
  getRecentAutopilotLogs,
  validateDateCode,
} from '../../../backend/autopilot/autopilotRunner'

describe('autopilotRunner.validateDateCode', () => {
  it('accepts leap day even when current year is not leap year', () => {
    expect(validateDateCode('2902')).toBe(true)
  })

  it('rejects impossible calendar dates', () => {
    expect(validateDateCode('3104')).toBe(false)
    expect(validateDateCode('3212')).toBe(false)
    expect(validateDateCode('0012')).toBe(false)
  })
})

describe('autopilotRunner.getRecentAutopilotLogs', () => {
  beforeEach(() => {
    __autopilotTestUtils.resetRecentLogs()
  })

  it('returns only the newest log entries up to the buffer limit', () => {
    __autopilotTestUtils.seedRecentLogs(
      Array.from({ length: 510 }, (_, index) => ({
        seq: index + 1,
        timestamp: `10:00:${String(index % 60).padStart(2, '0')}`,
        level: 'info' as const,
        message: `log-${index + 1}`,
        verbosity: 'normal' as const,
      })),
    )

    const recent = getRecentAutopilotLogs()

    expect(recent).toHaveLength(500)
    expect(recent[0]?.message).toBe('log-11')
    expect(recent[499]?.message).toBe('log-510')
  })

  it('applies an explicit limit on top of the in-memory buffer', () => {
    __autopilotTestUtils.seedRecentLogs([
      { seq: 1, timestamp: '10:00:01', level: 'info', message: 'a', verbosity: 'normal' },
      { seq: 2, timestamp: '10:00:02', level: 'warn', message: 'b', verbosity: 'verbose' },
      { seq: 3, timestamp: '10:00:03', level: 'error', message: 'c', verbosity: 'normal' },
    ])

    expect(getRecentAutopilotLogs(2).map((entry) => entry.message)).toEqual(['b', 'c'])
    expect(getRecentAutopilotLogs(0)).toEqual([])
  })

  it('keeps verbose logs in the replay buffer even when live verbosity is normal', () => {
    __autopilotTestUtils.setLogVerbosity('normal')
    __autopilotTestUtils.emitLogForTest('info', 'normal-log')
    __autopilotTestUtils.emitLogForTest('info', 'verbose-log', 'verbose')

    expect(
      getRecentAutopilotLogs().map((entry) => ({
        seq: entry.seq,
        message: entry.message,
        verbosity: entry.verbosity,
      })),
    ).toEqual([
      { seq: 1, message: 'normal-log', verbosity: 'normal' },
      { seq: 2, message: 'verbose-log', verbosity: 'verbose' },
    ])
  })
})

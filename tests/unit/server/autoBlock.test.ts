import { describe, expect, it, vi } from 'vitest'

import { checkAndAutoBlock } from '../../../server/auto-block'

describe('checkAndAutoBlock', () => {
  it('stays in warning-only mode and does not query DB when no matching rule exists', async () => {
    const prepare = vi.fn()
    const env = {
      DB: { prepare },
    }

    const result = await checkAndAutoBlock(
      {
        event: 'UNKNOWN_EVENT',
        severity: 'low',
        message: 'unknown',
        machineId: 'machine-1',
        timestamp: Date.now(),
      },
      env as any,
    )

    expect(result).toEqual({ blocked: false })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('returns a warning result and never blocks even when threshold is hit', async () => {
    const countQuery = {
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ count: 1 }),
      }),
    }
    const prepare = vi.fn().mockReturnValue(countQuery)

    const env = {
      DB: { prepare },
    }

    const result = await checkAndAutoBlock(
      {
        event: 'NONCE_REUSED',
        severity: 'critical',
        message: 'nonce replay',
        machineId: 'machine-2',
        timestamp: Date.now(),
      },
      env as any,
    )

    expect(result.blocked).toBe(false)
    expect(result.action).toBe('warn')
    expect(result.reason).toContain('Warning only')
    expect(prepare).toHaveBeenCalledOnce()
  })
})

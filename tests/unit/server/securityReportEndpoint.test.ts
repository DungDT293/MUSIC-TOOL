import { beforeEach, describe, expect, it, vi } from 'vitest'

const checkAndAutoBlock = vi.fn()

vi.mock('../../../server/auto-block', () => ({
  checkAndAutoBlock,
}))

import { handleSecurityReport } from '../../../server/security-report-endpoint'

describe('handleSecurityReport', () => {
  beforeEach(() => {
    checkAndAutoBlock.mockReset()
  })

  it('does not auto-block untrusted client-reported events', async () => {
    checkAndAutoBlock.mockResolvedValue({ blocked: true, reason: 'should not be used' })

    const dbRun = vi.fn().mockResolvedValue(undefined)
    const env = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            run: dbRun,
          }),
        }),
      },
    }

    const response = await handleSecurityReport(
      new Request('https://license-server.dungdong333.workers.dev/api/security/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'FILE_INTEGRITY_FAILED',
          severity: 'critical',
          message: 'client-side integrity mismatch',
          machineId: 'machine-client-1',
          timestamp: Date.now(),
        }),
      }),
      env as any,
    )

    const body = await response.json()
    expect(checkAndAutoBlock).not.toHaveBeenCalled()
    expect(body.ok).toBe(true)
    expect(body.source).toBe('client')
    expect(body.autoBlocked).toBe(false)
    expect(dbRun).toHaveBeenCalledOnce()
  })

  it('still evaluates trusted server-detected events but only returns a warning result', async () => {
    checkAndAutoBlock.mockResolvedValue({ blocked: false, reason: 'warning only', action: 'warn' })

    const env = {}

    const response = await handleSecurityReport(
      new Request('https://license-server.dungdong333.workers.dev/api/security/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'SIGNATURE_INVALID',
          severity: 'high',
          message: 'invalid signed request',
          machineId: 'machine-server-1',
          timestamp: Date.now(),
        }),
      }),
      env as any,
      { trustedSource: true },
    )

    const body = await response.json()
    expect(checkAndAutoBlock).toHaveBeenCalledOnce()
    expect(body.ok).toBe(true)
    expect(body.source).toBe('server')
    expect(body.autoBlocked).toBe(false)
  })
})

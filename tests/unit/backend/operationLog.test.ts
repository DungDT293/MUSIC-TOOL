import { describe, expect, it, vi } from 'vitest'
import { hashOperationPath, writeOperationLog } from '../../../backend/utils/operationLog'

describe('operationLog', () => {
  it('hashes paths without exposing them', () => {
    expect(hashOperationPath('E:/secret music/file.m4a')).toHaveLength(12)
  })

  it('writes bounded structured metadata', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    writeOperationLog({
      scope: 'music',
      operation: 'export',
      status: 'failure',
      requestId: 'request-1',
      metadata: { stderr: 'x'.repeat(300) },
    })
    const output = String(spy.mock.calls[0]?.[0])
    expect(output).toContain('"scope":"music"')
    expect(output).toContain('"requestId":"request-1"')
    expect(output).not.toContain('x'.repeat(300))
    spy.mockRestore()
  })
})

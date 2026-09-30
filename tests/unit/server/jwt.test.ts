import { describe, expect, it } from 'vitest'

import { generateToken, verifyToken } from '../../../server/utils/jwt'

const payload = {
  sub: 'test-user',
  machine_id: 'machine-1',
  type: 'device' as const,
}

const validEnv = { JWT_SECRET: 'test-secret-that-is-long-enough' }

describe('JWT secret enforcement', () => {
  it('rejects token generation when secret is missing or placeholder', async () => {
    await expect(generateToken(payload, 60, {})).rejects.toThrow('JWT_SECRET_NOT_CONFIGURED')
    await expect(generateToken(payload, 60, { JWT_SECRET: '  ' })).rejects.toThrow('JWT_SECRET_NOT_CONFIGURED')
    await expect(generateToken(payload, 60, {
      JWT_SECRET: 'CHANGE_ME_IN_PRODUCTION_JWT_SECRET',
    })).rejects.toThrow('JWT_SECRET_NOT_CONFIGURED')
  })

  it('returns configuration failure instead of verifying with fallback secret', async () => {
    await expect(verifyToken('not-a-token', {})).resolves.toEqual({
      valid: false,
      error: 'JWT_SECRET_NOT_CONFIGURED',
    })
  })

  it('signs and verifies with configured secret', async () => {
    const token = await generateToken(payload, 60, validEnv)
    const result = await verifyToken(token, validEnv)

    expect(result.valid).toBe(true)
    expect(result.payload?.sub).toBe(payload.sub)
    expect(result.payload?.machine_id).toBe(payload.machine_id)
  })

  it('rejects a token verified with another secret', async () => {
    const token = await generateToken(payload, 60, validEnv)
    const result = await verifyToken(token, { JWT_SECRET: 'another-test-secret' })

    expect(result).toEqual({ valid: false, error: 'Invalid signature' })
  })

  it('rejects expired tokens', async () => {
    const token = await generateToken(payload, -1, validEnv)
    const result = await verifyToken(token, validEnv)

    expect(result).toEqual({ valid: false, error: 'Token expired' })
  })
})

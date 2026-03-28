import crypto from 'node:crypto'

export function normalizeMachineIdentifier(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase()
}

export function hashMachineIdentifier(raw: string): string {
  const normalized = normalizeMachineIdentifier(raw)
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

export function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodePayload<T>(payload: string): T {
  const json = Buffer.from(payload, 'base64url').toString('utf8')
  return JSON.parse(json) as T
}




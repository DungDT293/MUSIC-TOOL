export const LEGACY_LICENSE_SERVER_BASE = 'https://license-server.dungdong333.workers.dev'
export const PLANNED_LICENSE_SERVER_BASE = 'https://admin93media.xyz'

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/\/+$/, '')
}

export function getLicenseServerBase(): string {
  return (
    normalizeBaseUrl(process.env.LICENSE_SERVER_BASE) ||
    normalizeBaseUrl(process.env.AUTH_BASE) ||
    LEGACY_LICENSE_SERVER_BASE
  )
}

export function getAuthServerBase(): string {
  return (
    normalizeBaseUrl(process.env.AUTH_BASE) ||
    normalizeBaseUrl(process.env.LICENSE_SERVER_BASE) ||
    LEGACY_LICENSE_SERVER_BASE
  )
}

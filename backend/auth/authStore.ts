import fs from 'node:fs'
import path from 'node:path'
import type { SessionInfo } from './sessionManager'

const AUTH_FILE_NAME = 'authState.json'

function resolveStoragePath(): string {
  // Security: only allow env var override in development (prevents production path hijack)
  const isDev = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL
  if (isDev && process.env.AUTH_STATE_PATH) {
    return process.env.AUTH_STATE_PATH
  }
  const commonAppData = process.env.PROGRAMDATA || path.join(process.env.SystemDrive || 'C:', 'ProgramData')
  const dir = path.join(commonAppData, '93MediaToolMixNhac')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return path.join(dir, AUTH_FILE_NAME)
}

export interface StoredAuthState {
  status: 'unregistered' | 'pending' | 'allowed' | 'blocked' | 'error'
  username?: string
  password?: string
  machineId: string
  activationKey?: string
  token?: string
  deviceToken?: string
  refreshToken?: string
  tokenExpiresAt?: number
  message?: string
  latestVersion?: string
  downloadUrl?: string
  remember?: boolean
  sessionInfo?: SessionInfo
}

export function readStoredAuthState(): StoredAuthState | null {
  try {
    const file = resolveStoragePath()
    if (!fs.existsSync(file)) return null
    const raw = fs.readFileSync(file, 'utf8')
    return JSON.parse(raw) as StoredAuthState
  } catch (error) {
    console.warn('[auth] Failed to read stored auth state:', error)
    return null
  }
}

export function writeStoredAuthState(state: StoredAuthState): void {
  try {
    const file = resolveStoragePath()
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8')
  } catch (error) {
    console.error('[auth] Failed to persist auth state:', error)
  }
}

export function clearStoredAuthState(): void {
  try {
    const file = resolveStoragePath()
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
    }
  } catch (error) {
    console.error('[auth] Failed to clear auth state:', error)
  }
}





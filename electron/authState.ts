/**
 * authState.ts
 * Quản lý trạng thái auth nội bộ của Electron main process.
 * Tách từ main.ts để dễ maintain và import theo nhóm handler.
 */

import path from 'node:path'
import { getDecryptedString } from '../backend/security/stringEncryption'
import { createSignedHeaders } from '../backend/security/apiSigning'
import { getMachineHash } from '../backend/license/machineId'
import {
  readEncryptedAuthState,
  writeEncryptedAuthState,
  migrateFromPlaintext,
} from '../backend/auth/encryptedAuthStore'

// =========================
// AUTH CONFIG (ONLINE)
// =========================

// Sử dụng encrypted strings (chỉ decrypt khi cần)
// Fallback về plaintext nếu encryption fail (dev mode)
let AUTH_BASE: string
try {
  AUTH_BASE = getDecryptedString('AUTH_BASE')
} catch {
  AUTH_BASE = process.env.AUTH_BASE || 'https://license-server.dungdong333.workers.dev'
}

export const AUTH_REQUEST_TIMEOUT_MS = 10_000

// Đọc version từ package.json
import { readFileSync } from 'node:fs'
let APP_VERSION = '1.0.9' // Fallback
try {
  const pkgPath = path.join(__dirname, '../../package.json')
  const packageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  APP_VERSION = packageJson.version || APP_VERSION
} catch {
  // Fallback nếu không đọc được
}
export { APP_VERSION, AUTH_BASE }

// ─── Path validation helper ────────────────────────────────────────────────
/**
 * Kiểm tra filePath/folderPath có hợp lệ không để tránh path traversal.
 */
export function isValidAbsolutePath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.includes('\0')) return false
  const resolved = path.resolve(p)
  if (!path.isAbsolute(resolved)) return false
  return true
}

// ─── Friendly error messages ───────────────────────────────────────────────
export function getFriendlyAuthError(rawError: any, fallback: string): string {
  const msg = rawError?.message || String(rawError) || ''
  if (
    msg.includes('AUTH_NETWORK_TIMEOUT') ||
    msg.includes('The operation was aborted') ||
    msg.includes('network error') ||
    msg.includes('Failed to fetch')
  ) {
    return 'Không kết nối được server, vui lòng kiểm tra mạng và thử lại.'
  }
  if (msg.startsWith('HTTP_ERROR: ')) {
    return msg.slice('HTTP_ERROR: '.length)
  }
  return fallback || msg || 'Đã xảy ra lỗi không xác định.'
}

// ─── HTTP helper ───────────────────────────────────────────────────────────
export async function postJson<T>(
  apiPath: string,
  body: any,
  headers: Record<string, string> = {}
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS)
  try {
    const signedHeaders = await createSignedHeaders('POST', apiPath, body)
    const res = await fetch(`${AUTH_BASE}${apiPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...signedHeaders,
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      let serverMessage = ''
      try {
        const data = await res.json()
        serverMessage = data?.reason || data?.error || ''
      } catch {
        serverMessage = await res.text()
      }
      throw new Error(`HTTP_ERROR: ${serverMessage || `HTTP ${res.status}`}`)
    }

    return (await res.json()) as T
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('AUTH_NETWORK_TIMEOUT')
    }
    if (err?.message && (err.message.includes('network') || err.message.includes('fetch'))) {
      throw new Error('AUTH_NETWORK_TIMEOUT')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

// ─── Auth State ────────────────────────────────────────────────────────────
export type InternalAuthStatus = 'unregistered' | 'pending' | 'allowed' | 'blocked' | 'error'

export interface InternalAuthState {
  status: InternalAuthStatus
  username?: string
  password?: string
  machineId: string
  activationKey?: string
  message?: string
  refreshCount?: number
  latestVersion?: string
  downloadUrl?: string
}

export let authState: InternalAuthState | null = null
let _authStateInitPromise: Promise<InternalAuthState> | null = null

export function setAuthState(state: InternalAuthState | null) {
  authState = state
}

export async function getOrInitAuthState(): Promise<InternalAuthState> {
  if (authState) return authState
  if (_authStateInitPromise) return _authStateInitPromise
  _authStateInitPromise = (async () => {
    try {
      const currentMachineId = await getMachineHash()

      try {
        await migrateFromPlaintext()
      } catch (err) {
        console.warn('[auth] Migration from plaintext failed:', err)
      }

      const stored = await readEncryptedAuthState()
      if (stored && stored.remember && stored.status === 'allowed' && stored.username && stored.password) {
        authState = {
          status: stored.status,
          username: stored.username,
          password: stored.password,
          machineId: currentMachineId,
          activationKey: stored.activationKey,
          message: stored.message,
          latestVersion: stored.latestVersion,
          downloadUrl: stored.downloadUrl,
        }
        return authState
      }

      authState = {
        status: 'unregistered',
        machineId: currentMachineId,
        message: 'Máy này chưa đăng ký tài khoản sử dụng.',
      }
      return authState
    } finally {
      _authStateInitPromise = null
    }
  })()
  return _authStateInitPromise
}

export { writeEncryptedAuthState }

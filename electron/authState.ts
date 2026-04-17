/**
 * authState.ts
 * Quản lý trạng thái auth nội bộ của Electron main process.
 * Tách từ main.ts để dễ maintain và import theo nhóm handler.
 */

import path from 'node:path'
import { getDecryptedString } from '../backend/security/stringEncryption'
import { createSignedHeaders } from '../backend/security/apiSigning'
import { getMachineHash, hasMachineHashCacheFootprint } from '../backend/license/machineId'
import {
  readEncryptedAuthState,
  writeEncryptedAuthState,
  migrateFromPlaintext,
  hasEncryptedAuthFile,
  hasAuthStorageFootprint,
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

function hasPriorInstallationMarkers(): boolean {
  return hasAuthStorageFootprint() || hasMachineHashCacheFootprint()
}

// ─── Path validation helper ────────────────────────────────────────────────
/**
 * Kiểm tra filePath/folderPath có hợp lệ không để tránh path traversal.
 * Hỗ trợ cả local paths (E:\Videos) và UNC/network paths (\\server\share\folder).
 */
export function isValidAbsolutePath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.includes('\0')) return false

  // UNC / network paths: \\server\share\... hoặc //server/share/...
  // path.resolve() trên Windows sẽ mangle UNC path (bỏ \\ prefix),
  // nên cần check riêng trước.
  if (p.startsWith('\\\\') || p.startsWith('//')) {
    // UNC path phải có ít nhất \\host\share (4+ chars after prefix)
    const withoutPrefix = p.startsWith('\\\\') ? p.slice(2) : p.slice(2)
    // Phải có ít nhất 1 separator sau hostname
    const sepIdx = withoutPrefix.search(/[/\\]/)
    if (sepIdx < 1) return false // \\\ hoặc \\x (thiếu share name)
    return true
  }

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
  preferredView?: 'register' | 'login'
  refreshCount?: number
  latestVersion?: string
  downloadUrl?: string
}

export let authState: InternalAuthState | null = null
let _authStateInitPromise: Promise<InternalAuthState> | null = null

// FIX H6: Simple async mutex via promise chain.
// Serializes all setAuthState calls so concurrent handlers cannot interleave writes.
// This prevents race conditions where a login handler and a license-refresh handler
// both try to update authState simultaneously, with one overwriting the other's result.
let _authStateMutexChain: Promise<void> = Promise.resolve()

export function setAuthState(state: InternalAuthState | null) {
  // FIX H6: Queue the write behind the current chain — serialized, not concurrent.
  _authStateMutexChain = _authStateMutexChain.then(() => {
    authState = state
  }).catch(() => {
    // Swallow errors from previous chain links — they are independent operations
    authState = state
  })
}

/**
 * Async version of setAuthState for handlers that need to await completion.
 * Ensures the write is fully serialized before the caller proceeds.
 */
export async function setAuthStateAsync(state: InternalAuthState | null): Promise<void> {
  return new Promise<void>((resolve) => {
    _authStateMutexChain = _authStateMutexChain.then(() => {
      authState = state
      resolve()
    }).catch(() => {
      authState = state
      resolve()
    })
  })
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
      const hasStoredAllowedCredential = !!(stored?.password || stored?.token || stored?.deviceToken)
      if (stored && stored.remember && stored.status === 'allowed' && stored.username && hasStoredAllowedCredential) {
        authState = {
          status: stored.status,
          username: stored.username,
          password: stored.password,
          machineId: currentMachineId,
          activationKey: stored.activationKey,
          message: stored.message,
          preferredView: 'login',
          latestVersion: stored.latestVersion,
          downloadUrl: stored.downloadUrl,
        }
        return authState
      }

      if (stored?.status === 'pending' && stored.username) {
        authState = {
          status: 'pending',
          username: stored.username,
          password: stored.password,
          machineId: currentMachineId,
          activationKey: stored.activationKey,
          message: stored.message || 'Tài khoản đang chờ admin phê duyệt.',
          preferredView: 'login',
          latestVersion: stored.latestVersion,
          downloadUrl: stored.downloadUrl,
        }
        return authState
      }

      if (stored?.status === 'blocked' && stored.username) {
        authState = {
          status: 'blocked',
          username: stored.username,
          machineId: currentMachineId,
          activationKey: stored.activationKey,
          message: stored.message || 'Tài khoản đã bị khóa.',
          preferredView: 'login',
          latestVersion: stored.latestVersion,
          downloadUrl: stored.downloadUrl,
        }
        return authState
      }

      // Phân biệt 2 trường hợp:
      // 1. File .enc tồn tại nhưng decrypt fail (machineId đổi do VPN/cleanup/Win11)
      //    → status: 'unregistered' với message hướng dẫn đăng NHẬP lại
      // 2. Chưa có file .enc → thực sự chưa đăng ký lần nào
      const fileExists = hasEncryptedAuthFile()
      const returningUser = hasPriorInstallationMarkers()
      authState = {
        status: 'unregistered',
        machineId: currentMachineId,
        preferredView: fileExists || returningUser ? 'login' : 'register',
        message: fileExists
          ? 'Phiên đăng nhập đã hết hạn hoặc thông tin máy thay đổi. Vui lòng đăng nhập lại.'
          : returningUser
          ? 'Máy này đã từng dùng app nhưng không còn phiên đăng nhập cũ. Nếu đã đăng ký rồi, hãy chuyển sang tab Đăng nhập để vào lại.'
          : 'Máy này chưa đăng ký tài khoản sử dụng.',
      }
      return authState
    } catch (err) {
      // FIX H6: On error, clear the cached promise so a retry is possible,
      // but don't clear it on success — initialization should only run once.
      _authStateInitPromise = null
      throw err
    }
  })()
  return _authStateInitPromise
}

export { writeEncryptedAuthState }

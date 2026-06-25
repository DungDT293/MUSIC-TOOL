import { app } from 'electron'
import { getMachineHash } from './machineId'
import { readStoredTicket, writeStoredTicket, clearStoredTicket } from './ticketStore'
import { getDecryptedString } from '../security/stringEncryption'
import { createSignedHeaders } from '../security/apiSigning'
import { getLicenseServerBase, LEGACY_LICENSE_SERVER_BASE } from '../licenseServerConfig'

// Ưu tiên process.env (inject tại CI/build time).
// Nếu không có env var → throw để phát hiện sớm khi thiếu cấu hình.
// Xem .env.production.example để biết các biến cần set.
let DEFAULT_BASE: string
let DEFAULT_INSTALLER_KEY: string
try {
  DEFAULT_BASE = process.env.LICENSE_SERVER_BASE || getDecryptedString('LICENSE_BASE')
  if (!process.env.LICENSE_INSTALLER_KEY) {
    throw new Error('LICENSE_INSTALLER_KEY env var is required. Xem .env.production.example')
  }
  DEFAULT_INSTALLER_KEY = process.env.LICENSE_INSTALLER_KEY
} catch (err) {
  // Chỉ fallback URL public (không nhạy cảm), KHÔNG fallback secret key
  DEFAULT_BASE = LEGACY_LICENSE_SERVER_BASE
  // FIX H5: NEVER fall back to empty string — empty key would allow unauthenticated registration.
  // Try env var one more time; if still missing, use a sentinel that the server will reject.
  DEFAULT_INSTALLER_KEY = process.env.LICENSE_INSTALLER_KEY || ''
  if (!DEFAULT_INSTALLER_KEY) {
    console.error('[License] FATAL: LICENSE_INSTALLER_KEY chưa được set. App sẽ không thể xác thực license.')
    // FIX H5: Set a clearly-invalid sentinel so the header is present but always rejected server-side.
    // This prevents silent pass-through of empty string authorization.
    DEFAULT_INSTALLER_KEY = '__MISSING_INSTALLER_KEY__'
  }
}

const API_BASE = process.env.LICENSE_SERVER_BASE ? getLicenseServerBase() : DEFAULT_BASE
const INSTALLER_KEY = process.env.LICENSE_INSTALLER_KEY ?? DEFAULT_INSTALLER_KEY
const REQUEST_TIMEOUT_MS = 8000
const OFFLINE_TTL_MS = 24 * 60 * 60 * 1000

export type LicenseStatus = 'checking' | 'needsRegistration' | 'pending' | 'ok' | 'offline' | 'denied'

export interface LicenseState {
  status: LicenseStatus
  machineHash: string
  message?: string
  lastSuccessAt?: number
  ticket?: string
  requestId?: string
  note?: string
}

type RegisterResponse =
  | {
      status: 'pending'
      requestId: string
      message?: string
    }
  | {
      status: 'approved'
      ticket: string
    }

type PollResponse =
  | {
      status: 'pending'
      message?: string
    }
  | {
    status: 'approved'
    ticket: string
  }
  | {
      status: 'denied'
      reason?: string
    }

async function postJson<T>(
  path: string,
  body: Record<string, any>,
  headers: Record<string, string> = {}
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    // Thêm signed headers để chống replay attack và tampering
    const signedHeaders = await createSignedHeaders('POST', path, body)
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...signedHeaders,
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`HTTP ${response.status}: ${text}`)
    }
    return (await response.json()) as T
  } finally {
    clearTimeout(timeout)
  }
}

export async function submitLicenseRequest(note?: string): Promise<{ success: boolean; state: LicenseState; error?: string }> {
  const machineHash = await getMachineHash()
  const version = app.getVersion()

  // FIX H5: Reject early if installer key is missing/sentinel — never send empty auth header
  if (!INSTALLER_KEY || INSTALLER_KEY === '__MISSING_INSTALLER_KEY__') {
    return {
      success: false,
      error: 'App chưa được cấu hình installer key. Liên hệ nhà phát triển.',
      state: {
        status: 'needsRegistration',
        machineHash,
        message: 'Thiếu cấu hình xác thực. Vui lòng cài lại app hoặc liên hệ hỗ trợ.',
      },
    }
  }

  try {
    const stored = readStoredTicket()
    if (stored?.requestId) {
      return {
        success: true,
        state: {
          status: 'pending',
          machineHash,
          requestId: stored.requestId,
          note: stored.note,
          message: 'Yêu cầu kích hoạt đã được gửi trước đó, đang chờ admin phê duyệt.',
        },
      }
    }

    const payload = await postJson<RegisterResponse>(
      '/api/licenses/register',
      {
        machineId: machineHash,
        version,
        note,
      },
      { 'x-installer-key': INSTALLER_KEY }
    )

    if (payload.status === 'approved') {
      const ticket = payload.ticket
      const state: LicenseState = {
        status: 'ok',
        machineHash,
        ticket,
        lastSuccessAt: Date.now(),
      }
      writeStoredTicket({
        ticket,
        lastSuccessAt: state.lastSuccessAt,
      })
      return { success: true, state }
    }

    writeStoredTicket({
      requestId: payload.requestId,
      note,
    })

    return {
      success: true,
      state: {
        status: 'pending',
        machineHash,
        requestId: payload.requestId,
        note,
        message: payload.message ?? 'Yêu cầu kích hoạt đã được gửi. Vui lòng đợi admin phê duyệt.',
      },
    }
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || String(error),
      state: {
        status: 'needsRegistration',
        machineHash,
        message: error?.message || 'Không thể gửi yêu cầu kích hoạt.',
      },
    }
  }
}

async function pollApproval(requestId: string, machineHash: string): Promise<LicenseState> {
  try {
    const result = await postJson<PollResponse>('/api/licenses/poll', {
      requestId,
      machineId: machineHash,
    })

    if (result.status === 'approved') {
      const ticket = result.ticket
      const lastSuccessAt = Date.now()
      writeStoredTicket({
        ticket,
        lastSuccessAt,
      })
      return {
        status: 'ok',
        machineHash,
        ticket,
        lastSuccessAt,
        message: 'Yêu cầu đã được phê duyệt.',
      }
    }

    if (result.status === 'denied') {
      clearStoredTicket()
      return {
        status: 'denied',
        machineHash,
        message: result.reason ?? 'Yêu cầu bị từ chối. Gửi lại yêu cầu mới.',
      }
    }

    const stored = readStoredTicket()
    return {
      status: 'pending',
      machineHash,
      requestId: stored?.requestId ?? requestId,
      note: stored?.note,
      message: result.message ?? 'Đang chờ admin phê duyệt...',
    }
  } catch (error: any) {
    return {
      status: 'pending',
      machineHash,
      requestId,
      message: error?.message || 'Không thể kiểm tra trạng thái. Thử lại sau.',
    }
  }
}

export async function clearLicense(): Promise<void> {
  clearStoredTicket()
}

export async function evaluateLicenseState(forceRemote = false): Promise<LicenseState> {
  const machineHash = await getMachineHash()
  const stored = readStoredTicket()

  if (!stored || (!stored.ticket && !stored.requestId)) {
    return {
      status: 'needsRegistration',
      machineHash,
      message: 'Chưa gửi yêu cầu kích hoạt. Nhấn “Gửi yêu cầu” để bắt đầu.',
    }
  }

  if (!stored.ticket && stored.requestId) {
    return await pollApproval(stored.requestId, machineHash)
  }

  if (!stored.ticket) {
    return {
      status: 'needsRegistration',
      machineHash,
      message: 'Thiếu ticket license, vui lòng gửi lại yêu cầu.',
    }
  }

  const version = app.getVersion()
  try {
    if (!forceRemote) {
      const age = stored.lastSuccessAt ? Date.now() - stored.lastSuccessAt : Infinity
      if (age < 5_000) {
        return {
          status: 'ok',
          machineHash,
        ticket: stored.ticket,
        lastSuccessAt: stored.lastSuccessAt,
        }
      }
    }

    const result = await postJson<{ allow: boolean; reason?: string }>(
      '/api/licenses/check',
      {
        ticket: stored.ticket,
        machineId: machineHash,
        version,
      }
    )

    if (result.allow) {
      const lastSuccessAt = Date.now()
      writeStoredTicket({
        ...stored,
        lastSuccessAt,
      })
      return {
        status: 'ok',
        machineHash,
        ticket: stored.ticket,
        lastSuccessAt,
      }
    }

    return {
      status: 'denied',
      machineHash,
      ticket: stored.ticket,
      message: result.reason ?? 'License bị từ chối bởi server',
    }
  } catch (error: any) {
    // FIX M25: Defend against system clock rollback attacks.
    // If Date.now() is earlier than stored.lastSuccessAt, the user rolled their clock backward
    // to keep the offline grace period valid indefinitely.
    // Also cap maximum offline window to prevent editing the JSON to a future timestamp.
    const now = Date.now()
    let canUseOffline = false
    if (stored.lastSuccessAt) {
      const age = now - stored.lastSuccessAt
      // Clock rollback detection: if age is negative, the system clock is behind the stored timestamp.
      // This means either (1) clock was rolled back, or (2) JSON was edited with a future timestamp.
      // Either way, deny offline access.
      if (age >= 0 && age < OFFLINE_TTL_MS) {
        canUseOffline = true
      } else if (age < 0) {
        console.warn('[License] Clock rollback detected: stored.lastSuccessAt is in the future. Denying offline grace.')
      }
    }

    if (canUseOffline) {
      return {
        status: 'offline',
        machineHash,
        ticket: stored.ticket,
        lastSuccessAt: stored.lastSuccessAt,
        message: 'Không thể kết nối tới license server, tạm thời cho phép chạy offline.',
      }
    }

    return {
      status: 'denied',
      machineHash,
      ticket: stored.ticket,
      message: error?.message || 'Không thể kiểm tra license.',
    }
  }
}


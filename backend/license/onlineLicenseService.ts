import { app } from 'electron'
import { getMachineHash } from './machineId'
import { readStoredTicket, writeStoredTicket, clearStoredTicket } from './ticketStore'
import { getDecryptedString } from '../security/stringEncryption'
import { createSignedHeaders } from '../security/apiSigning'

// Fallback về plaintext nếu encryption fail
// ⚠️ SECURITY: Ưu tiên process.env.LICENSE_INSTALLER_KEY (set tại build/deploy time).
// Chỉ dùng getDecryptedString() làm fallback cuối cùng khi không có env var.
let DEFAULT_BASE: string
let DEFAULT_INSTALLER_KEY: string
try {
  DEFAULT_BASE = process.env.LICENSE_SERVER_BASE || getDecryptedString('LICENSE_BASE')
  DEFAULT_INSTALLER_KEY = process.env.LICENSE_INSTALLER_KEY || getDecryptedString('INSTALLER_KEY')
} catch {
  DEFAULT_BASE = 'https://license-server.dungdong333.workers.dev'
  DEFAULT_INSTALLER_KEY = 'Ins$2025!LEONYG'
}

const API_BASE = process.env.LICENSE_SERVER_BASE ?? DEFAULT_BASE
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
    const canUseOffline =
      stored.lastSuccessAt && Date.now() - stored.lastSuccessAt < OFFLINE_TTL_MS
        ? true
        : false

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


/**
 * License Check Helper
 * Kiểm tra license trước khi thực hiện actions quan trọng
 */

import { evaluateLicenseState, type LicenseState } from '../license/onlineLicenseService'
import { reportLicenseCheckFailed } from './securityMonitoring'

// Track license check failures
const licenseCheckFailures: Map<string, number> = new Map()
const FAILURE_WINDOW_MS = 60 * 1000 // 1 phút

/**
 * Check license và throw error nếu không hợp lệ
 */
export async function requireValidLicense(): Promise<void> {
  const state = await evaluateLicenseState(false) // Không force remote để nhanh hơn

  if (state.status !== 'ok') {
    // Track failures
    const machineId = state.machineHash
    const failures = (licenseCheckFailures.get(machineId) || 0) + 1
    licenseCheckFailures.set(machineId, failures)

    // Cleanup old failures
    setTimeout(() => {
      licenseCheckFailures.delete(machineId)
    }, FAILURE_WINDOW_MS)

    // Report nếu nhiều failures
    if (failures >= 3) {
      await reportLicenseCheckFailed({
        reason: state.message || 'License check failed',
        status: state.status,
        attemptCount: failures,
      })
    }

    let message = 'License không hợp lệ. '
    switch (state.status) {
      case 'needsRegistration':
        message += 'Vui lòng đăng ký license.'
        break
      case 'pending':
        message += 'License đang chờ admin duyệt.'
        break
      case 'denied':
        message += state.message || 'License bị từ chối.'
        break
      case 'offline':
        message += 'Không thể kiểm tra license (offline mode).'
        break
      default:
        message += 'Trạng thái license không xác định.'
    }
    throw new Error(message)
  }

  // Reset failure count nếu license OK
  const machineId = state.machineHash
  licenseCheckFailures.delete(machineId)
}

/**
 * Check license và return boolean (không throw)
 */
export async function hasValidLicense(): Promise<boolean> {
  try {
    await requireValidLicense()
    return true
  } catch {
    return false
  }
}

/**
 * Get current license state
 */
export async function getLicenseState(): Promise<LicenseState> {
  return await evaluateLicenseState(false)
}


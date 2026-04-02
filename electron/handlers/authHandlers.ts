/**
 * authHandlers.ts
 * IPC handlers: auth:*, license:*, app:*, policy:*
 */

import { app, ipcMain } from 'electron'
import {
  authState,
  setAuthState,
  getOrInitAuthState,
  getFriendlyAuthError,
  postJson,
  APP_VERSION,
  writeEncryptedAuthState,
} from '../authState'
import {
  evaluateLicenseState,
  submitLicenseRequest,
  clearLicense,
  type LicenseState,
} from '../../backend/license/licenseManager'
import {
  readEncryptedAuthState,
  clearEncryptedAuthState,
} from '../../backend/auth/encryptedAuthStore'
import { loginRateLimiter, LOGIN_RATE_LIMIT_CONFIG } from '../../backend/security/rateLimiter'

// Chia sẻ licenseState với main.ts
let licenseState: LicenseState = { status: 'checking', machineHash: '' }

export function getLicenseState() { return licenseState }
export function setLicenseState(state: LicenseState) { licenseState = state }

export async function refreshLicenseState(forceRemote = false): Promise<LicenseState> {
  try {
    licenseState = await evaluateLicenseState(forceRemote)
  } catch (error) {
    console.error('[license] Failed to evaluate license state:', error)
    licenseState = {
      status: 'denied',
      machineHash: licenseState.machineHash,
      message: error instanceof Error ? error.message : String(error),
    }
  }
  return licenseState
}

export function registerAuthHandlers() {
  // ===== License IPC =====
  ipcMain.handle('license:getState', async () => {
    if (licenseState.status === 'checking') await refreshLicenseState()
    return licenseState
  })

  ipcMain.handle('license:register', async (_event, payload: { note?: string }) => {
    const result = await submitLicenseRequest(payload?.note)
    licenseState = result.state
    return result
  })

  ipcMain.handle('license:retry', async () => {
    await refreshLicenseState(true)
    return licenseState
  })

  ipcMain.handle('license:clear', async () => {
    await clearLicense()
    await refreshLicenseState(false)
    return licenseState
  })

  // ===== Auth IPC =====
  ipcMain.handle('auth:getState', async () => getOrInitAuthState())

  ipcMain.handle('auth:register', async (_event, payload: { username: string; password: string }) => {
    const base = await getOrInitAuthState()
    try {
      await postJson('/api/auth/register', {
        tai_khoan: payload.username,
        mat_khau: payload.password,
        ma_may: base.machineId,
        version: APP_VERSION,
      })

      const newState = {
        status: 'pending' as const,
        username: payload.username,
        password: payload.password,
        machineId: base.machineId,
        activationKey: undefined,
        message: 'Yêu cầu đăng ký đã được gửi lên server. Nhấn "Kiểm tra lại" sau khi admin cấp quyền.',
        refreshCount: 0,
      }
      setAuthState(newState)

      await writeEncryptedAuthState({
        status: newState.status,
        username: newState.username,
        password: newState.password,
        machineId: newState.machineId,
        message: newState.message,
        remember: false,
      })
    } catch (err: any) {
      console.error('[auth:register] error', err)
      setAuthState({
        status: 'error',
        machineId: base.machineId,
        message: getFriendlyAuthError(err, 'Không gửi được yêu cầu đăng ký.'),
      })
    }
    return authState
  })

  ipcMain.handle('auth:login', async (
    _event,
    payload: { username: string; password: string; remember?: boolean }
  ) => {
    const base = await getOrInitAuthState()

    // Rate limit check — chỉ tính khi thực sự đăng nhập sai password
    const rateKey = `login:${payload.username}`
    const rateLimitResult = loginRateLimiter.check(rateKey, LOGIN_RATE_LIMIT_CONFIG)
    if (!rateLimitResult.allowed) {
      const waitSec = Math.ceil(((rateLimitResult.resetAt ?? Date.now()) - Date.now()) / 1000)
      setAuthState({
        status: 'error',
        machineId: base.machineId,
        message: `Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau ${waitSec} giây.`,
      })
      return authState
    }

    try {
      // Server V2 trả { ok: true/false, device_token, refresh_token, error, action }
      // Server V1 trả { status: 'CHO_PHEP'|'allowed'|... , message, token, ... }
      type LoginResponse = {
        // V2 format
        ok?: boolean
        device_token?: string
        refresh_token?: string
        expires_at?: number
        error?: string
        action?: string
        // V1 format (legacy fallback)
        status?: string
        message?: string
        token?: string
        refreshToken?: string
        activationKey?: string
        latestVersion?: string
        downloadUrl?: string
        username?: string
      }
      const res = await postJson<LoginResponse>('/api/auth/login', {
        tai_khoan: payload.username,
        mat_khau: payload.password,
        ma_may: base.machineId,
        version: APP_VERSION,
      })

      // Normalize: server V2 dùng ok=true, V1 dùng status='CHO_PHEP'/'allowed'
      const isSuccess = res.ok === true || res.status === 'CHO_PHEP' || res.status === 'allowed'
      const isPending = res.status === 'PENDING' || res.status === 'pending'
      const isBlocked = res.status === 'BI_CHAN' || res.status === 'blocked'
        || res.action === 'BLOCKED'
      const errorMsg = res.error || res.message

      if (isSuccess) {
        // Đăng nhập thành công → reset rate limit
        loginRateLimiter.reset(rateKey)
        const newState = {
          status: 'allowed' as const,
          username: payload.username,
          password: payload.password,
          machineId: base.machineId,
          activationKey: res.activationKey,
          message: errorMsg || 'Đăng nhập thành công.',
          latestVersion: res.latestVersion,
          downloadUrl: res.downloadUrl,
        }
        setAuthState(newState)

        if (payload.remember !== false) {
          await writeEncryptedAuthState({
            status: newState.status,
            username: newState.username,
            password: newState.password,
            machineId: newState.machineId,
            activationKey: newState.activationKey,
            message: newState.message,
            latestVersion: newState.latestVersion,
            downloadUrl: newState.downloadUrl,
            // V2: device_token / refresh_token, V1: token / refreshToken
            token: res.device_token || res.token,
            refreshToken: res.refresh_token || res.refreshToken,
            remember: true,
          })
        } else {
          // remember=false → xóa .enc cũ để không auto-login lần sau
          clearEncryptedAuthState()
        }
      } else if (isPending) {
        // PENDING = chưa được duyệt, KHÔNG phải sai password → reset rate limit
        loginRateLimiter.reset(rateKey)
        setAuthState({
          status: 'pending',
          username: payload.username,
          password: payload.password,
          machineId: base.machineId,
          message: errorMsg || 'Tài khoản đang chờ admin phê duyệt.',
        })
      } else if (isBlocked) {
        // Bị khóa bởi admin hoặc tamper detection → reset rate limit
        loginRateLimiter.reset(rateKey)
        clearEncryptedAuthState()
        setAuthState({
          status: 'blocked',
          username: payload.username,
          machineId: base.machineId,
          message: errorMsg || 'Tài khoản đã bị khóa.',
        })
      } else {
        // Trường hợp khác (sai password, lỗi khác)
        setAuthState({
          status: 'error',
          machineId: base.machineId,
          message: errorMsg || 'Đăng nhập thất bại.',
        })
      }
    } catch (err: any) {
      console.error('[auth:login] error', err)
      // Lỗi mạng → rate limit đã được tính bởi check() ở trên
      setAuthState({
        status: 'error',
        machineId: base.machineId,
        message: getFriendlyAuthError(err, 'Đăng nhập thất bại.'),
      })
    }
    // Trả về object có ok field để frontend kiểm tra
    const finalState = authState
    return {
      ...finalState,
      ok: finalState?.status === 'allowed',
    }
  })

  ipcMain.handle('auth:refresh', async () => {
    const base = await getOrInitAuthState()
    if (!base.username || !base.password) return base

    try {
      // Server V2 trả { ok: true/false, device_token, refresh_token, error }
      // Server V1 trả { status: 'CHO_PHEP'|... , message, token, ... }
      type RefreshResponse = {
        // V2 format
        ok?: boolean
        device_token?: string
        refresh_token?: string
        expires_at?: number
        error?: string
        action?: string
        // V1 format (legacy)
        status?: string
        message?: string
        token?: string
        refreshToken?: string
        activationKey?: string
        latestVersion?: string
        downloadUrl?: string
      }
      const res = await postJson<RefreshResponse>('/api/auth/login', {
        tai_khoan: base.username,
        mat_khau: base.password,
        ma_may: base.machineId,
        version: APP_VERSION,
      })

      // Normalize: server V2 dùng ok=true, V1 dùng status='CHO_PHEP'/'allowed'
      const isSuccess = res.ok === true || res.status === 'CHO_PHEP' || res.status === 'allowed'
      const isPending = res.status === 'PENDING' || res.status === 'pending'
      const isBlocked = res.status === 'BI_CHAN' || res.status === 'blocked'
        || res.action === 'BLOCKED'
      const errorMsg = res.error || res.message

      if (isSuccess) {
        const newState = {
          ...base,
          status: 'allowed' as const,
          activationKey: res.activationKey ?? base.activationKey,
          message: errorMsg || 'Đã làm mới phiên đăng nhập.',
          latestVersion: res.latestVersion ?? base.latestVersion,
          downloadUrl: res.downloadUrl ?? base.downloadUrl,
          refreshCount: (base.refreshCount ?? 0) + 1,
        }
        setAuthState(newState)

        const stored = await readEncryptedAuthState()
        if (stored?.remember) {
          await writeEncryptedAuthState({
            ...newState,
            token: res.device_token || res.token,
            refreshToken: res.refresh_token || res.refreshToken,
            remember: true,
          })
        }
      } else if (isPending) {
        setAuthState({ ...base, status: 'pending', message: errorMsg || 'Tài khoản đang chờ phê duyệt.' })
      } else if (isBlocked) {
        // Bị block → clear .enc để không tự động login nữa
        clearEncryptedAuthState()
        setAuthState({ ...base, status: 'blocked', message: errorMsg || 'Tài khoản đã bị khóa.' })
      } else {
        // Server trả response không mong đợi (ok=false, sai password, v.v.)
        // Nếu đang allowed → giữ nguyên, không phá hủy phiên hợp lệ
        if (base.status === 'allowed') {
          console.warn('[auth:refresh] Server returned non-success, keeping allowed state:', errorMsg)
        } else {
          setAuthState({ ...base, status: 'error', message: errorMsg || 'Làm mới thất bại.' })
        }
      }
    } catch (err: any) {
      console.error('[auth:refresh] error', err)
      // Lỗi mạng / timeout — KHÔNG ghi đè trạng thái allowed hiện tại
      // Chỉ set error nếu trước đó chưa đăng nhập thành công
      if (base.status === 'allowed') {
        console.warn('[auth:refresh] Network error during refresh, keeping current allowed state')
        // Giữ nguyên state, chỉ trả về base (vẫn allowed)
      } else {
        setAuthState({
          ...base,
          status: 'error',
          message: getFriendlyAuthError(err, 'Không thể làm mới phiên đăng nhập.'),
        })
      }
    }
    return authState
  })

  ipcMain.handle('auth:clear', async () => {
    try {
      await clearEncryptedAuthState()
    } catch (err) {
      console.warn('[auth:clear] Failed to clear encrypted auth state:', err)
    }
    const { getMachineHash } = await import('../../backend/license/machineId')
    const currentMachineId = await getMachineHash()
    setAuthState({
      status: 'unregistered',
      machineId: currentMachineId,
      message: 'Đã đăng xuất.',
    })
    return authState
  })

  ipcMain.handle('auth:checkStatus', async (_event, data: { username: string }) => {
    const base = await getOrInitAuthState()
    try {
      type CheckStatusResponse = {
        status: string
        message?: string
        activationKey?: string
        latestVersion?: string
        downloadUrl?: string
      }
      const res = await postJson<CheckStatusResponse>('/api/auth/check-status', {
        tai_khoan: data.username,
        ma_may: base.machineId,
        version: APP_VERSION,
      })

      if (res.status === 'CHO_PHEP' || res.status === 'allowed') {
        const newState = {
          ...base,
          status: 'allowed' as const,
          username: data.username,
          activationKey: res.activationKey ?? base.activationKey,
          message: res.message || 'Tài khoản đã được phê duyệt.',
          latestVersion: res.latestVersion ?? base.latestVersion,
          downloadUrl: res.downloadUrl ?? base.downloadUrl,
        }
        setAuthState(newState)
      } else if (res.status === 'BI_CHAN' || res.status === 'blocked') {
        setAuthState({ ...base, status: 'blocked', message: res.message || 'Tài khoản đã bị khóa.' })
      } else {
        setAuthState({ ...base, status: 'pending', message: res.message || 'Tài khoản vẫn đang chờ phê duyệt.' })
      }
    } catch (err: any) {
      console.error('[auth:checkStatus] error', err)
      setAuthState({ ...base, status: 'error', message: getFriendlyAuthError(err, 'Không thể kiểm tra trạng thái tài khoản.') })
    }
    return authState
  })

  ipcMain.handle('auth:validateKey', async (_event, data: { username: string; key: string }) => {
    const base = await getOrInitAuthState()
    try {
      type ValidateKeyResponse = {
        valid: boolean
        device_token?: string
        refresh_token?: string
        expires_at?: number
        message?: string
        locked?: boolean
        attempts?: number
        action?: string
        tamperCount?: number
      }
      const res = await postJson<ValidateKeyResponse>('/api/auth/validate-key', {
        tai_khoan: data.username,
        key_kich_hoat: data.key,
        ma_may: base.machineId,
        version: APP_VERSION,
      })

      if (res.valid === true) {
        const newState = {
          ...base,
          status: 'allowed' as const,
          username: data.username,
          activationKey: data.key,
          deviceToken: res.device_token,
          refreshToken: res.refresh_token,
          tokenExpiresAt: res.expires_at,
          message: 'Kích hoạt thành công.',
        }
        setAuthState(newState)
        await writeEncryptedAuthState({
          status: newState.status,
          username: newState.username,
          password: base.password,
          machineId: newState.machineId,
          activationKey: newState.activationKey,
          deviceToken: res.device_token,
          refreshToken: res.refresh_token,
          tokenExpiresAt: res.expires_at,
          message: newState.message,
          remember: true,
        })
        // Return server response directly so frontend can check valid + device_token
        return { ...res, message: 'Kích hoạt thành công.' }
      } else {
        const msg = res.message || (res.locked ? 'Key đã bị khóa.' : 'Mã kích hoạt không hợp lệ.')
        setAuthState({ ...base, status: 'error', message: msg })
        return { valid: false, message: msg, locked: res.locked, attempts: res.attempts, action: res.action, tamperCount: res.tamperCount }
      }
    } catch (err: any) {
      console.error('[auth:validateKey] error', err)
      const msg = getFriendlyAuthError(err, 'Không thể kích hoạt.')
      setAuthState({ ...base, status: 'error', message: msg })
      return { valid: false, message: msg }
    }
  })

  ipcMain.handle('auth:validateToken', async () => {
    const base = await getOrInitAuthState()
    if (base.status !== 'allowed' || !base.username) {
      return { valid: false, status: base.status }
    }
    try {
      const stored = await readEncryptedAuthState()
      if (!stored?.token) return { valid: false, status: 'no_token' }

      type ValidateTokenResponse = { valid: boolean; status?: string; message?: string }
      const res = await postJson<ValidateTokenResponse>('/api/auth/validate-token', {
        token: stored.token,
        ma_may: base.machineId,
        version: APP_VERSION,
      })
      return res
    } catch (err: any) {
      console.error('[auth:validateToken] error', err)
      return { valid: false, status: 'error', message: getFriendlyAuthError(err, 'Không thể xác thực token.') }
    }
  })

  // ===== App / updater handlers =====
  ipcMain.handle('app:getVersion', async () => app.getVersion())

  ipcMain.handle('app:checkUpdate', async () => {
    try {
      const { autoUpdater } = await import('electron-updater')
      const result = await autoUpdater.checkForUpdates()
      return { updateAvailable: !!result?.updateInfo, version: result?.updateInfo?.version }
    } catch (err) {
      console.warn('[app:checkUpdate] Failed:', (err as any)?.message)
      return { updateAvailable: false }
    }
  })

  ipcMain.handle('app:installUpdate', async () => {
    try {
      const { autoUpdater } = await import('electron-updater')
      autoUpdater.quitAndInstall()
      return { ok: true }
    } catch (err) {
      console.warn('[app:installUpdate] Failed:', (err as any)?.message)
      return { ok: false, error: (err as any)?.message }
    }
  })

  ipcMain.handle('app:getUpdateChannel', async () => {
    try {
      const { autoUpdater } = await import('electron-updater')
      const raw = autoUpdater.channel || 'latest'
      return { ok: true, channel: raw === 'latest' ? 'stable' : raw as 'stable' | 'beta' }
    } catch {
      return { ok: true, channel: 'stable' as const }
    }
  })

  ipcMain.handle('app:setUpdateChannel', async (_event, channel: string) => {
    try {
      const { autoUpdater } = await import('electron-updater')
      autoUpdater.channel = channel === 'stable' ? 'latest' : channel
      autoUpdater.checkForUpdates().catch(() => {})
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as any)?.message }
    }
  })

  ipcMain.handle('policy:get', async () => ({
    latest_version: app.getVersion(),
    min_supported_version: '3.6.0',
    blocked_versions: [],
    recommended_version: app.getVersion(),
    force_update: false,
    message: null,
  }))
}

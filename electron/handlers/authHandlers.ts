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
import { clearGpuCache } from '../../backend/utils/gpuDetection'
import {
  getGpuFfmpegProfileSetting,
  getLegacyGpuFfmpegPathSetting,
  setGpuFfmpegProfileSetting,
  setLegacyGpuFfmpegPathSetting,
  type AppGpuFfmpegProfile,
} from '../../backend/app/appSettings'
import { hasActiveExport, setHasActiveExport } from '../main'

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
          const persistedToken = res.device_token || res.token
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
            token: persistedToken,
            deviceToken: persistedToken,
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
          const persistedToken = res.device_token || res.token
          await writeEncryptedAuthState({
            ...newState,
            token: persistedToken,
            deviceToken: persistedToken,
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

      if (res.status === 'approved' || res.status === 'CHO_PHEP' || res.status === 'allowed') {
        setAuthState({
          ...base,
          status: 'pending',
          username: data.username,
          activationKey: res.activationKey ?? base.activationKey,
          message: res.message || 'Tài khoản đã được phê duyệt. Vui lòng nhập key kích hoạt.',
          latestVersion: res.latestVersion ?? base.latestVersion,
          downloadUrl: res.downloadUrl ?? base.downloadUrl,
        })
        return {
          status: 'approved' as const,
          message: res.message || 'Tài khoản đã được phê duyệt. Vui lòng nhập key kích hoạt.',
        }
      }

      if (res.status === 'BI_CHAN' || res.status === 'blocked') {
        setAuthState({ ...base, status: 'blocked', message: res.message || 'Tài khoản đã bị khóa.' })
        return {
          status: 'blocked' as const,
          message: res.message || 'Tài khoản đã bị khóa.',
        }
      }

      if (res.status === 'locked') {
        setAuthState({ ...base, status: 'pending', username: data.username, message: res.message || 'Key đã bị khóa.' })
        return {
          status: 'locked' as const,
          message: res.message || 'Key đã bị khóa.',
        }
      }

      if (res.status === 'revoked') {
        setAuthState({ ...base, status: 'pending', username: data.username, message: res.message || 'Key đã bị thu hồi.' })
        return {
          status: 'revoked' as const,
          message: res.message || 'Key đã bị thu hồi.',
        }
      }

      if (res.status === 'not_found') {
        setAuthState({ ...base, status: 'error', message: res.message || 'Không tìm thấy tài khoản.' })
        return {
          status: 'not_found' as const,
          message: res.message || 'Không tìm thấy tài khoản.',
        }
      }

      setAuthState({ ...base, status: 'pending', username: data.username, message: res.message || 'Tài khoản vẫn đang chờ phê duyệt.' })
      return {
        status: 'pending' as const,
        message: res.message || 'Tài khoản vẫn đang chờ phê duyệt.',
      }
    } catch (err: any) {
      console.error('[auth:checkStatus] error', err)
      setAuthState({ ...base, status: 'error', message: getFriendlyAuthError(err, 'Không thể kiểm tra trạng thái tài khoản.') })
      return {
        status: 'error' as const,
        message: getFriendlyAuthError(err, 'Không thể kiểm tra trạng thái tài khoản.'),
      }
    }
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
          token: res.device_token,
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
        setAuthState({
          ...base,
          status: 'pending',
          username: data.username,
          message: msg,
        })
        return { valid: false, message: msg, locked: res.locked, attempts: res.attempts, action: res.action, tamperCount: res.tamperCount }
      }
    } catch (err: any) {
      console.error('[auth:validateKey] error', err)
      const msg = getFriendlyAuthError(err, 'Không thể kích hoạt.')
      setAuthState({
        ...base,
        status: 'pending',
        username: data.username,
        message: msg,
      })
      return { valid: false, message: msg }
    }
  })

  ipcMain.handle('auth:validateToken', async () => {
    const base = await getOrInitAuthState()
    try {
      const stored = await readEncryptedAuthState()
      const persistedToken = stored?.token ?? stored?.deviceToken
      if (!stored || !persistedToken) {
        return { valid: false, status: 'no_token' }
      }

      type ValidateTokenResponse = {
        valid: boolean
        status?: string
        message?: string
        error?: string
        username?: string
        expires_at?: number
        action?: string
      }
      const res = await postJson<ValidateTokenResponse>('/api/auth/validate-token', {
        device_token: persistedToken,
        machine_id: base.machineId,
      })

      if (res.valid) {
        const restoredState = {
          status: 'allowed' as const,
          username: res.username ?? stored.username ?? base.username,
          password: stored.password,
          machineId: base.machineId,
          activationKey: stored.activationKey,
          message: res.message || stored.message || 'Đăng nhập thành công.',
          preferredView: 'login' as const,
          latestVersion: stored.latestVersion,
          downloadUrl: stored.downloadUrl,
        }
        setAuthState(restoredState)
        return {
          ...res,
          status: 'allowed',
          username: restoredState.username,
        }
      }

      if (res.action === 'BLOCKED' || res.status === 'blocked') {
        clearEncryptedAuthState()
        setAuthState({
          status: 'blocked',
          username: stored.username ?? base.username,
          machineId: base.machineId,
          activationKey: stored.activationKey,
          message: res.message || res.error || 'Tài khoản đã bị khóa.',
          preferredView: 'login',
          latestVersion: stored.latestVersion,
          downloadUrl: stored.downloadUrl,
        })
      } else {
        setAuthState({
          status: 'unregistered',
          username: stored.username ?? base.username,
          machineId: base.machineId,
          activationKey: stored.activationKey,
          message: res.message || res.error || 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
          preferredView: 'login',
          latestVersion: stored.latestVersion,
          downloadUrl: stored.downloadUrl,
        })
      }

      return {
        ...res,
        message: res.message || res.error,
      }
    } catch (err: any) {
      console.error('[auth:validateToken] error', err)
      return { valid: false, status: 'error', message: getFriendlyAuthError(err, 'Không thể xác thực token.') }
    }
  })

  // ===== App / updater handlers =====
  ipcMain.handle('app:getVersion', async () => app.getVersion())

  // FIX 1.1: IPC channel for renderer to sync export activity state to main process.
  // The renderer's exportActivityStore calls this whenever activeExports changes.
  ipcMain.handle('app:setExportActive', async (_event, isActive: boolean) => {
    setHasActiveExport(!!isActive)
    return { ok: true }
  })

  // FIX 4.1: 10-second debounce on check-for-updates to prevent IPC spam
  let lastCheckTimestamp = 0
  const CHECK_DEBOUNCE_MS = 10_000

  ipcMain.handle('app:checkUpdate', async () => {
    const now = Date.now()
    if (now - lastCheckTimestamp < CHECK_DEBOUNCE_MS) {
      console.log('[app:checkUpdate] Debounced — last check was', now - lastCheckTimestamp, 'ms ago')
      return { updateAvailable: false, debounced: true }
    }
    lastCheckTimestamp = now

    try {
      const { autoUpdater } = await import('electron-updater')
      const result = await autoUpdater.checkForUpdates()
      return { updateAvailable: !!result?.updateInfo, version: result?.updateInfo?.version }
    } catch (err) {
      console.warn('[app:checkUpdate] Failed:', (err as any)?.message)
      return { updateAvailable: false }
    }
  })

  // FIX 1.3: New handler — user explicitly requests download (autoDownload is now false)
  ipcMain.handle('app:downloadUpdate', async () => {
    try {
      const { autoUpdater } = await import('electron-updater')
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (err) {
      console.warn('[app:downloadUpdate] Failed:', (err as any)?.message)
      return { ok: false, error: (err as any)?.message }
    }
  })

  // FIX 1.1: Guard quitAndInstall behind active export check
  ipcMain.handle('app:installUpdate', async () => {
    // Check if any export is currently running (synced from renderer)
    if (hasActiveExport()) {
      console.warn('[app:installUpdate] BLOCKED — an export is currently active')
      return {
        ok: false,
        error: 'Đang có export đang chạy. Vui lòng đợi export hoàn tất trước khi cài đặt bản cập nhật.',
        blocked: true,
      }
    }

    try {
      const { autoUpdater } = await import('electron-updater')
      // isSilent=false so user sees the installer; isForceRunAfter=true to restart after install
      autoUpdater.quitAndInstall(false, true)
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

  ipcMain.handle('app:getGpuFfmpegProfile', async () => {
    try {
      return { ok: true, profile: getGpuFfmpegProfileSetting() }
    } catch (err) {
      return {
        ok: false,
        profile: 'auto' as const,
        error: (err as any)?.message || 'Failed to read GPU FFmpeg profile',
      }
    }
  })

  ipcMain.handle('app:setGpuFfmpegProfile', async (_event, profile: AppGpuFfmpegProfile) => {
    try {
      const savedProfile = setGpuFfmpegProfileSetting(profile)
      clearGpuCache()
      return { ok: true, profile: savedProfile }
    } catch (err) {
      return {
        ok: false,
        profile: 'auto' as const,
        error: (err as any)?.message || 'Failed to save GPU FFmpeg profile',
      }
    }
  })

  ipcMain.handle('app:getLegacyGpuFfmpegPath', async () => {
    try {
      return { ok: true, path: getLegacyGpuFfmpegPathSetting() ?? null }
    } catch (err) {
      return {
        ok: false,
        path: null,
        error: (err as any)?.message || 'Failed to read legacy GPU FFmpeg path',
      }
    }
  })

  ipcMain.handle('app:setLegacyGpuFfmpegPath', async (_event, binaryPath: string | null) => {
    try {
      const savedPath = setLegacyGpuFfmpegPathSetting(binaryPath)
      clearGpuCache()
      return { ok: true, path: savedPath ?? null }
    } catch (err) {
      return {
        ok: false,
        path: null,
        error: (err as any)?.message || 'Failed to save legacy GPU FFmpeg path',
      }
    }
  })

  ipcMain.handle('policy:get', async () => {
    const version = app.getVersion()
    return {
      latest_version: version,
      min_supported_version: version,
      blocked_versions: [],
      recommended_version: version,
      force_update: false,
      message: null,
    }
  })
}

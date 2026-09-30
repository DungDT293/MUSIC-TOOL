/**
 * electron/main.ts
 * Entry point của Electron main process.
 *
 * File này chỉ chứa:
 *  - App lifecycle (whenReady, window-all-closed, before-quit)
 *  - Khởi tạo window và đăng ký IPC handlers (qua module riêng)
 *  - Background tasks (disk info, license check, security checks)
 *  - Auto-updater setup
 *
 * Logic chi tiết được tách vào:
 *  - electron/authState.ts         — auth state, postJson, helpers
 *  - electron/windowManager.ts     — createWindow, CSP, error page
 *  - electron/handlers/index.ts    — tất cả IPC handlers (70+ channels)
 */

import { app, BrowserWindow, protocol, net } from 'electron'
import * as fs from 'fs'
import { getAutoUpdater } from './autoUpdaterSingleton'
import { getFfmpegPaths } from '../backend/ffmpeg/config'
import { runFfprobe } from '../backend/ffmpeg/wrapper'
import { getMachineHash } from '../backend/license/machineId'
import { checkAndCleanCacheOnUpdate, cleanupStaleScratchDirs } from '../backend/utils/cacheCleanup'
import { initTamperDetection, checkTampering } from '../backend/security/tamperDetection'
import { initSecurityMonitoring } from '../backend/security/securityMonitoring'
import { getAuthServerBase } from '../backend/licenseServerConfig'
import { cleanupYouTubeHandlers } from './youtube/youtubeHandlers'
import { videoJobManager } from '../backend/video/videoJobManager'
import { jobQueue } from '../backend/jobQueue/jobQueue'
import { isValidAbsolutePath } from './authState'
import * as windowManager from './windowManager'
import { createWindow, loadErrorPage, requestAppExit, clearForcedAppExit } from './windowManager'
import {
  registerAllHandlers,
  refreshLicenseState,
  refreshDiskInfoAndBroadcast,
} from './handlers/index'

// Helper để lấy mainWindow instance mới nhất (live binding từ windowManager module)
function getMainWindow() { return windowManager.mainWindow }

// ─── Biến interval ──────────────────────────────────────────────────────────
let diskInfoRefreshInterval: NodeJS.Timeout | null = null
let licenseCheckInterval: NodeJS.Timeout | null = null
const DISK_INFO_REFRESH_INTERVAL_MS = 30 * 60 * 1000

// ─── Đăng ký app:// scheme là privileged (PHẢI gọi trước app.whenReady) ─────
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: false,
    },
  },
])

// ─── Helper: log FFmpeg info ────────────────────────────────────────────────
async function logFfmpegInfo() {
  try {
    const paths = getFfmpegPaths()
    console.log('[FFmpeg] using ffmpeg at:', paths.ffmpeg)
    console.log('[FFmpeg] using ffprobe at:', paths.ffprobe)
    const versionOutput = await runFfprobe(['-version'])
    const firstLine = versionOutput.split(/\r?\n/)[0]
    console.log('[FFmpeg] ffprobe version:', firstLine)
  } catch (err) {
    console.warn('[FFmpeg] ffprobe check failed:', err)
  }
}

// ─── Global error handlers ───────────────────────────────────────────────────
process.on('uncaughtException', (error) => {
  console.error('[App] UNCAUGHT EXCEPTION:', error)
  console.error('[App] Stack:', error.stack)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[App] UNHANDLED REJECTION:', reason)
  console.error('[App] Promise:', promise)
})

// ─── Export Activity Tracking (synced from renderer) ─────────────────────────
// FIX 1.1 + 1.2: The renderer's exportActivityStore syncs its state here
// via IPC so that main-process code (updater, before-quit) can guard against
// killing the app while an export is in progress.
let _hasActiveExport = false
export function hasActiveExport(): boolean { return _hasActiveExport }
export function setHasActiveExport(value: boolean): void { _hasActiveExport = value }

// ─── Version Gate (real policy check) ────────────────────────────────────────
// FIX 2.1 + 2.3 + 2.4: Actually fetch the version policy from the Cloudflare
// Worker and evaluate blocked_versions, min_supported_version, force_update.

import type { VersionGateResult } from '../src/types/ipc'

const VERSION_GATE_TIMEOUT_MS = 12_000

/**
 * Compare two semver strings. Returns:
 *  -1 if a < b, 0 if a == b, 1 if a > b.
 * Handles standard x.y.z format. Non-parseable versions are treated as 0.0.0.
 */
function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) => {
    const parts = v.replace(/^v/, '').split('.').map(Number)
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0] as const
  }
  const [aMaj, aMin, aPat] = parse(a)
  const [bMaj, bMin, bPat] = parse(b)
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1
  if (aMin !== bMin) return aMin < bMin ? -1 : 1
  if (aPat !== bPat) return aPat < bPat ? -1 : 1
  return 0
}

async function checkVersionGate(): Promise<VersionGateResult> {
  try {
    const appVersion = app.getVersion()
    const serverUrl = getAuthServerBase()
    const url = `${serverUrl}/api/version-policy`

    console.log(`[VersionGate] Checking policy at ${url} for v${appVersion}`)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), VERSION_GATE_TIMEOUT_MS)

    let response: Response
    try {
      response = await net.fetch(url, { signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      console.warn(`[VersionGate] Server returned ${response.status}, fail-open → allow`)
      return { status: 'allow' }
    }

    const policy = await response.json() as {
      latest_version?: string
      min_supported_version?: string
      blocked_versions?: string[]
      recommended_version?: string
      recommended_installer_url?: string
      force_update?: boolean
      message?: string
    }

    console.log('[VersionGate] Policy received:', JSON.stringify({
      latest: policy.latest_version,
      min: policy.min_supported_version,
      blocked: policy.blocked_versions?.length ?? 0,
      force: policy.force_update,
    }))

    // ── Rule 1: blocked_versions — specific version blacklist ──
    if (Array.isArray(policy.blocked_versions) && policy.blocked_versions.includes(appVersion)) {
      console.warn(`[VersionGate] Version ${appVersion} is BLOCKED by policy`)
      return {
        status: 'block-version',
        policy: {
          min_supported_version: policy.min_supported_version || '0.0.0',
          recommended_version: policy.recommended_version || policy.latest_version || appVersion,
          recommended_installer_url: policy.recommended_installer_url,
          message: policy.message || `Phiên bản ${appVersion} đã bị chặn. Vui lòng cập nhật.`,
        },
      }
    }

    // ── Rule 2: min_supported_version — version too old ──
    if (policy.min_supported_version && compareSemver(appVersion, policy.min_supported_version) < 0) {
      console.warn(`[VersionGate] Version ${appVersion} < min ${policy.min_supported_version} → block-old`)
      return {
        status: 'block-old',
        policy: {
          min_supported_version: policy.min_supported_version,
          recommended_version: policy.recommended_version || policy.latest_version || policy.min_supported_version,
          recommended_installer_url: policy.recommended_installer_url,
          message: policy.message || `Phiên bản ${appVersion} quá cũ. Vui lòng cập nhật lên ${policy.min_supported_version} trở lên.`,
        },
      }
    }

    // ── Rule 3: force_update — force update to latest ──
    if (
      policy.force_update === true &&
      policy.latest_version &&
      compareSemver(appVersion, policy.latest_version) < 0
    ) {
      console.warn(`[VersionGate] force_update=true, ${appVersion} < ${policy.latest_version} → block-old`)
      return {
        status: 'block-old',
        policy: {
          min_supported_version: policy.min_supported_version || '0.0.0',
          recommended_version: policy.latest_version,
          recommended_installer_url: policy.recommended_installer_url,
          message: policy.message || `Có bản cập nhật bắt buộc lên ${policy.latest_version}.`,
        },
      }
    }

    // ── All checks passed ──
    console.log(`[VersionGate] Version ${appVersion} is allowed`)
    return { status: 'allow' }
  } catch (err: any) {
    // Network error, timeout, parse error → fail-open for offline users
    console.warn('[VersionGate] Check failed (fail-open → allow):', err?.message || err)
    return { status: 'allow' }
  }
}

// ─── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady()
  .then(async () => {
    console.log('[App] Starting initialization...')

    // ── Đăng ký app:// protocol — phục vụ file local cho <audio>/<video>/<img> ──
    // Chromium chặn file:// trong sandboxed renderer → dùng app://local-file/?path=...
    try {
      protocol.handle('app', (request) => {
        try {
          const url = new URL(request.url)
          // app://local-file/?path=<encoded-path>
          if (url.hostname === 'local-file') {
            const filePath = url.searchParams.get('path')
            if (!filePath) {
              console.warn('[Protocol] Missing path parameter in URL:', request.url.slice(0, 100))
              return new Response('Missing path parameter', { status: 400 })
            }
            // URLSearchParams.get() already percent-decodes query values.
            const decodedPath = filePath
            if (!isValidAbsolutePath(decodedPath)) {
              return new Response('Invalid file path', { status: 400 })
            }
            // Security: chỉ cho phép đọc file thực sự tồn tại
            let stat: fs.Stats | null = null
            try {
              stat = fs.statSync(decodedPath)
            } catch {}
            if (!stat?.isFile()) {
              const isUNC = decodedPath.startsWith('\\\\') || decodedPath.startsWith('//')
              console.warn(`[Protocol] File not found${isUNC ? ' (network path)' : ''}:`, decodedPath)
              return new Response(
                isUNC
                  ? `Network file not accessible: ${decodedPath}. Kiểm tra kết nối mạng hoặc chọn lại thư mục nhạc.`
                  : `File not found: ${decodedPath}`,
                { status: 404 }
              )
            }
            // Dùng net.fetch với file:// URL để Electron đọc file an toàn
            // UNC paths: \\server\share\file → file://server/share/file (server = authority)
            // Local paths: E:\folder\file → file:///E:/folder/file (3 slashes, empty authority)
            const normalized = decodedPath.replace(/\\/g, '/')
            let fileUrl: string
            if (normalized.startsWith('//')) {
              // UNC path: //server/share/... → file://server/share/...
              // RFC 8089: UNC path uses server as authority in file:// URL
              fileUrl = `file:${normalized}`
            } else {
              fileUrl = `file:///${normalized.replace(/^\/+/, '')}`
            }
            console.log('[Protocol] Serving:', decodedPath.slice(0, 80), '→', fileUrl.slice(0, 80))
            return net.fetch(fileUrl)
          }
          // Fallback: không xử lý hostname khác
          return new Response('Unknown app:// host', { status: 404 })
        } catch (err: any) {
          console.error('[Protocol] app:// handler error:', err)
          return new Response(`Protocol error: ${err?.message}`, { status: 500 })
        }
      })
      console.log('[App] app:// protocol handler registered')
    } catch (err: any) {
      console.error('[App] Failed to register app:// protocol (critical):', err?.message || err)
    }

    // Đăng ký IPC handlers trước khi tạo window
    try {
      registerAllHandlers(null, getMainWindow)
      console.log('[App] IPC handlers registered')
    } catch (err: any) {
      console.error('[App] Failed to register IPC handlers (critical):', err?.message || err)
    }

    // Tạo window chính
    try {
      createWindow()
      console.log('[App] Window created')

      // Version gate: fetch real policy from Cloudflare Worker, then emit result
      const mw = getMainWindow()
      if (mw && !mw.isDestroyed()) {
        mw.webContents.once('did-finish-load', async () => {
          const gateResult = await checkVersionGate()
          getMainWindow()?.webContents.send('version-gate-result', gateResult)
        })
      }
    } catch (err: any) {
      console.error('[App] Failed to create window (critical):', err?.message || err)
      try {
        const fallback = new BrowserWindow({
          width: 1280, height: 720, show: true,
          webPreferences: { nodeIntegration: false, contextIsolation: true },
        })
        loadErrorPage(fallback, `Lỗi khởi động ứng dụng:\n${err?.message || String(err)}\n\nVui lòng chạy diagnostic script để kiểm tra.`)
      } catch (fallbackErr: any) {
        console.error('[App] Failed to create fallback window:', fallbackErr)
        app.quit()
        return
      }
    }

    // ── Background tasks (không block window) ──────────────────────────────

    // Cache cleanup khi cài version mới
    try {
      await checkAndCleanCacheOnUpdate()
      console.log('[App] Cache cleanup completed')
    } catch (err: any) {
      console.error('[App] Cache cleanup failed (non-critical):', err?.message || err)
    }

    // FIX H-03: Clean up stale scratch dirs left by crashed/killed exports
    try {
      await cleanupStaleScratchDirs()
    } catch (err: any) {
      console.warn('[App] Stale scratch cleanup failed (non-critical):', err?.message || err)
    }

    // Security monitoring
    try {
      initSecurityMonitoring()
      console.log('[App] Security monitoring initialized')
    } catch (err: any) {
      console.error('[App] Security monitoring init failed (non-critical):', err?.message || err)
    }

    // Tamper detection (production only)
    try {
      initTamperDetection()
      console.log('[App] Tamper detection initialized')
    } catch (err: any) {
      console.error('[App] Tamper detection init failed (non-critical):', err?.message || err)
    }

    // VM/Sandbox environment check
    ;(async () => {
      try {
        const { isSafeEnvironment } = await import('../backend/security/environmentDetection')
        const envCheck = await isSafeEnvironment()
        if (!envCheck.safe) {
          console.warn('[Security] Unsafe environment detected:', envCheck.reason)
          try {
            const { reportSecurityEvent } = await import('../backend/security/securityMonitoring')
            const machineId = await getMachineHash()
            await reportSecurityEvent({
              type: 'UNSAFE_ENVIRONMENT',
              severity: 'high',
              message: `Unsafe environment detected: ${envCheck.reason}`,
              details: { detected: envCheck.detected },
              timestamp: Date.now(),
              machineId,
            }).catch(() => {})
          } catch (reportErr) {
            console.warn('[Security] Failed to report unsafe environment:', reportErr)
          }
        }
      } catch (err: any) {
        console.error('[App] Environment check failed (non-critical):', err?.message || err)
      }
    })()

    // Tamper check on startup
    ;(async () => {
      try {
        const tamperCheck = await checkTampering()
        if (tamperCheck.isTampered) {
          console.error('[Security] Tampering detected on startup:', tamperCheck.reasons)
        }
      } catch (err: any) {
        console.error('[App] Tamper check failed (non-critical):', err?.message || err)
      }
    })()

    // License check (async, không block)
    ;(async () => {
      try {
        await refreshLicenseState(true)
        console.log('[App] License state refreshed')
      } catch (err: any) {
        console.error('[App] License refresh failed (non-critical):', err?.message || err)
      }
    })()

    // FFmpeg info (async, không block)
    logFfmpegInfo().catch((err) => {
      console.warn('[FFmpeg] Failed to log FFmpeg info (non-critical):', err)
    })

    // Disk info (async, không block)
    refreshDiskInfoAndBroadcast().catch((err) =>
      console.error('[system] Initial disk info scan failed (non-critical):', err)
    )

    // Refresh disk info định kỳ mỗi 30 phút
    diskInfoRefreshInterval = setInterval(() => {
      refreshDiskInfoAndBroadcast().catch((err) =>
        console.error('[system] Periodic disk info refresh failed:', err)
      )
    }, DISK_INFO_REFRESH_INTERVAL_MS)

    // License check định kỳ mỗi 30 phút
    licenseCheckInterval = setInterval(async () => {
      try {
        const currentState = await refreshLicenseState(true)
        if (currentState.status !== 'ok') {
          console.warn('[Security] License check failed during periodic check:', currentState.status)
        }
      } catch (error) {
        console.warn('[Security] Periodic license check failed:', error)
      }
    }, 30 * 60 * 1000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })

    console.log('[App] Initialization completed (window should be visible)')
  })
  .catch((err) => {
    console.error('[App] CRITICAL: Failed to initialize:', err)
    console.error('[App] Error stack:', err?.stack)
    try {
      if (!getMainWindow() || getMainWindow()!.isDestroyed()) createWindow()
      const mwErr = getMainWindow()
      if (mwErr && !mwErr.isDestroyed()) {
        mwErr.show()
        loadErrorPage(mwErr, `Lỗi khởi động ứng dụng:\n${err?.message || String(err)}\n\nVui lòng chạy diagnostic script để kiểm tra.`)
      }
    } catch (windowErr) {
      console.error('[App] Failed to create error window:', windowErr)
      app.quit()
    }
  })

// ─── Cleanup khi đóng tất cả window ─────────────────────────────────────────
app.on('window-all-closed', () => {
  cleanupYouTubeHandlers()

  if (diskInfoRefreshInterval) {
    clearInterval(diskInfoRefreshInterval)
    diskInfoRefreshInterval = null
  }
  if (licenseCheckInterval) {
    clearInterval(licenseCheckInterval)
    licenseCheckInterval = null
  }

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ─── Graceful shutdown ────────────────────────────────────────────────────────
app.on('before-quit', () => {
  // Never await or prevent quit here. Async shutdown hooks can leave Electron stuck.
  if (_hasActiveExport) console.warn('[App] before-quit: cancelling active export jobs')

  if (diskInfoRefreshInterval) clearInterval(diskInfoRefreshInterval)
  if (licenseCheckInterval) clearInterval(licenseCheckInterval)

  try {
    for (const job of jobQueue.getJobs()) {
      if (job.status === 'pending' || job.status === 'running') void jobQueue.cancelJob(job.id)
    }
    videoJobManager.cancelAll()
  } catch (error) {
    console.warn('[App] Failed to cancel queued jobs during shutdown:', error)
  }

  import('../backend/autopilot/autopilotRunner')
    .then(({ cancelAutopilot }) => cancelAutopilot?.())
    .catch(() => {})
})

process.on('SIGTERM', () => requestAppExit())
process.on('SIGINT', () => requestAppExit())

app.on('will-quit', () => {
  clearForcedAppExit()
})

// ─── Auto-updater ─────────────────────────────────────────────────────────────
;(() => {
  try {
    if (!app.isPackaged) {
      console.log('[Updater] Skipping autoUpdater setup in development mode')
      return
    }
    const autoUpdater = getAutoUpdater()
    if (!autoUpdater) {
      console.warn('[Updater] electron-updater did not expose autoUpdater')
      return
    }
    autoUpdater.logger = null

    // FIX 1.2 + 1.3: Disable silent auto-download and auto-install-on-quit.
    // Downloads are initiated only when the user explicitly confirms (via Settings UI).
    // Install-on-quit is disabled to prevent data loss when exports are active.
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    const sendStatus = (payload: Record<string, unknown>) => {
      const mw = getMainWindow()
      if (mw && !mw.isDestroyed()) {
        mw.webContents.send('updater:status', payload)
      }
    }

    autoUpdater.on('checking-for-update', () => sendStatus({ state: 'checking' }))
    autoUpdater.on('update-available', (info) => sendStatus({ state: 'available', version: info.version }))
    autoUpdater.on('update-not-available', () => sendStatus({ state: 'not-available' }))
    autoUpdater.on('download-progress', (progress) => sendStatus({
      state: 'downloading',
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      },
    }))
    autoUpdater.on('update-downloaded', (info) => sendStatus({ state: 'downloaded', version: info.version }))
    autoUpdater.on('error', (err) => sendStatus({ state: 'error', message: err?.message || String(err) }))

    // Auto-check sau 10 giây (chỉ check, KHÔNG auto-download)
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn('[Updater] Startup check failed (non-critical):', err?.message)
      })
    }, 10_000)
  } catch (err) {
    console.warn('[Updater] Failed to setup autoUpdater (non-critical):', (err as any)?.message)
  }
})()

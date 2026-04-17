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
import * as path from 'path'
import * as fs from 'fs'
import { getFfmpegPaths } from '../backend/ffmpeg/config'
import { runFfprobe } from '../backend/ffmpeg/wrapper'
import { getMachineHash } from '../backend/license/machineId'
import { checkAndCleanCacheOnUpdate, cleanupStaleScratchDirs } from '../backend/utils/cacheCleanup'
import { initTamperDetection, checkTampering } from '../backend/security/tamperDetection'
import { initSecurityMonitoring } from '../backend/security/securityMonitoring'
import { cleanupYouTubeHandlers } from './youtube/youtubeHandlers'
import * as windowManager from './windowManager'
import { createWindow, loadErrorPage } from './windowManager'
import {
  registerAllHandlers,
  refreshLicenseState,
  refreshDiskInfoAndBroadcast,
  activeSongNhacExports,
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
            const decodedPath = decodeURIComponent(filePath)
            // Security: chỉ cho phép đọc file thực sự tồn tại
            if (!fs.existsSync(decodedPath)) {
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

      // Version gate: emit kết quả sau khi window load xong
      const mw = getMainWindow()
      if (mw && !mw.isDestroyed()) {
        mw.webContents.once('did-finish-load', () => {
          getMainWindow()?.webContents.send('version-gate-result', { status: 'allow' })
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
app.on('before-quit', async () => {
  // Kill active Song Nhạc FFmpeg exports
  for (const [, proc] of activeSongNhacExports) {
    try { if (!proc.killed) proc.kill('SIGTERM') } catch (_) {}
  }
  activeSongNhacExports.clear()

  // Cancel autopilot
  try {
    const { cancelAutopilot } = await import('../backend/autopilot/autopilotRunner')
    cancelAutopilot?.()
  } catch (_) {}
})

// ─── Auto-updater ─────────────────────────────────────────────────────────────
;(async () => {
  try {
    if (!app.isPackaged) {
      console.log('[Updater] Skipping autoUpdater setup in development mode')
      return
    }
    const { autoUpdater } = await import('electron-updater')
    if (!autoUpdater) {
      console.warn('[Updater] electron-updater did not expose autoUpdater')
      return
    }
    autoUpdater.logger = null
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

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

    // Auto-check sau 10 giây
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.warn('[Updater] Startup check failed (non-critical):', err?.message)
      })
    }, 10_000)
  } catch (err) {
    console.warn('[Updater] Failed to setup autoUpdater (non-critical):', (err as any)?.message)
  }
})()

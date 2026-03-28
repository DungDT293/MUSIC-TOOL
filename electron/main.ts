import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getFfmpegPaths } from '../backend/ffmpeg/config'
import { runFfprobe } from '../backend/ffmpeg/wrapper'
// Lazy import probeFile để tránh lỗi khi load module
let probeFile: any = null
import { getSystemInfo } from '../backend/system/sysinfo'
import { getRealtimeStats } from '../backend/system/realtime'
import { getDiskInfo, type DiskInfoSummary } from '../backend/system/diskInfo'
import { getDiskSpace, checkMinimumSpace, formatBytes } from '../backend/utils/diskSpace'
import { jobQueue } from '../backend/jobQueue/jobQueue'
import { scanMusicFolders } from '../backend/music/scanMusic'
import { loadScanResult } from '../backend/music/scanStore'
import {
  buildPlaylists,
  savePlaylists,
  getPlaylists,
  clearPlaylists,
  type BuildPlaylistsOptions,
} from '../backend/music/playlistEngine'
import {
  exportPlaylistToFile,
  validatePlaylistForCrossfade,
  validatePlaylistsForCrossfade,
  type ExportPlaylistRequest,
  type ExportPlaylistResult,
  type CrossfadePlaylistCheckResult,
  type ValidatePlaylistsForCrossfadeRequest,
  type ValidatePlaylistsForCrossfadeResult,
} from '../backend/music/exportAudio'
import { randomUUID } from 'crypto'
// Video module imports (Simple version)
import { getVideoFileInfo } from '../backend/video/videoInfo'
import { cutVideoIntoSegmentsSimple, type CutSingleSimpleRequest } from '../backend/video/cutSingleSimple'
import { splitManyVideosSimple, type SplitManySimpleRequest } from '../backend/video/splitManySimple'
import { mergeVideosSimple, type MergeVideosSimpleRequest } from '../backend/video/mergeVideosSimple'
import { muteVideoAudio, type MuteVideoAudioRequest } from '../backend/video/muteVideoAudio'
import { exportFinalVideo, scanAudioSource, scanVideoSource, type FinalExportJobRequest } from '../backend/video/finalExport'
import { videoJobManager } from '../backend/video/videoJobManager'
import {
  VIDEO_FINAL_EXPORT_DONE,
  VIDEO_FINAL_EXPORT_ERROR,
  VIDEO_FINAL_EXPORT_PROGRESS,
  VIDEO_FINAL_EXPORT_REQUEST,
  type FinalExportRequestPayload,
  type FinalExportProgressPayload,
  type FinalExportDonePayload,
  type FinalExportErrorPayload,
} from '../shared/videoFinalExportChannels'
import {
  startAutopilot,
  getAutopilotProgress,
  onAutopilotProgress,
  cancelAutopilot,
  onAutopilotLog,
  type AutopilotConfig as AutopilotBackendConfig,
  type AutopilotProgress,
} from '../backend/autopilot/autopilotRunner'
import { setupYouTubeHandlers, cleanupYouTubeHandlers } from './youtube/youtubeHandlers'
import { getRecentHistory } from '../backend/music/exportHistory'
import { applySeoMetadata, type SeoMetadataRequest } from '../backend/video/seoMetadata'
import { normalizeAudio, cancelNormalizeAudio, type NormalizeAudioRequest, type NormalizeAudioProgress } from '../backend/music/normalizeAudio'
import {
  evaluateLicenseState,
  submitLicenseRequest,
  clearLicense,
  type LicenseState,
} from '../backend/license/licenseManager'
import { getMachineHash } from '../backend/license/machineId'
import {
  readEncryptedAuthState,
  writeEncryptedAuthState,
  clearEncryptedAuthState,
  migrateFromPlaintext,
} from '../backend/auth/encryptedAuthStore'
import type { StoredAuthState } from '../backend/auth/authStore'
import { checkAndCleanCacheOnUpdate } from '../backend/utils/cacheCleanup'
import { loginRateLimiter, LOGIN_RATE_LIMIT_CONFIG } from '../backend/security/rateLimiter'
import { createSignedHeaders } from '../backend/security/apiSigning'

// Biến kiểm tra dev mode
const isDev = !!process.env.ELECTRON_RENDERER_URL

// Lưu mainWindow để dùng trong IPC handlers
let mainWindow: BrowserWindow | null = null
let cachedDiskInfo: DiskInfoSummary | null = null
let diskInfoRefreshInterval: NodeJS.Timeout | null = null
let activeMergeRequestId: string | null = null
let licenseState: LicenseState = {
  status: 'checking',
  machineHash: '',
}

// =========================
// AUTH CONFIG (ONLINE)
// =========================
import { getDecryptedString } from '../backend/security/stringEncryption'
import { initTamperDetection, checkTampering } from '../backend/security/tamperDetection'
import { requireValidLicense } from '../backend/security/licenseCheck'
import { initSecurityMonitoring, reportMachineIdMismatch } from '../backend/security/securityMonitoring'

// Sử dụng encrypted strings (chỉ decrypt khi cần)
// Fallback về plaintext nếu encryption fail (dev mode)
let AUTH_BASE: string
let INSTALLER_SECRET: string
try {
  AUTH_BASE = getDecryptedString('AUTH_BASE')
  INSTALLER_SECRET = getDecryptedString('INSTALLER_SECRET')
} catch {
  // Fallback cho dev mode hoặc nếu có lỗi
  AUTH_BASE = 'https://license-server.dungdong333.workers.dev'
  INSTALLER_SECRET = '2025LEONYG280722'
}
const AUTH_REQUEST_TIMEOUT_MS = 10_000
// Đọc version từ package.json
import { readFileSync } from 'node:fs'
let APP_VERSION = '1.0.9' // Fallback
try {
  const packageJson = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'))
  APP_VERSION = packageJson.version || APP_VERSION
} catch {
  // Fallback nếu không đọc được
}

function getFriendlyAuthError(rawError: any, fallback: string): string {
  const msg = rawError?.message || String(rawError) || ''
  // Lỗi timeout / mạng
  if (
    msg.includes('AUTH_NETWORK_TIMEOUT') ||
    msg.includes('The operation was aborted') ||
    msg.includes('network error') ||
    msg.includes('Failed to fetch')
  ) {
    return 'Không kết nối được server, vui lòng kiểm tra mạng và thử lại.'
  }

  // Lỗi HTTP có message từ server: HTTP_ERROR: <message>
  if (msg.startsWith('HTTP_ERROR: ')) {
    return msg.slice('HTTP_ERROR: '.length)
  }

  // Mặc định: dùng fallback nếu có, nếu không thì dùng message gốc
  return fallback || msg || 'Đã xảy ra lỗi không xác định.'
}

async function postJson<T>(
  path: string,
  body: any,
  headers: Record<string, string> = {}
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS)
  try {
    // Sign request với timestamp, nonce, HMAC
    const signedHeaders = await createSignedHeaders('POST', path, body)

    const res = await fetch(`${AUTH_BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...signedHeaders, // Thêm signed headers
        ...headers, // Headers từ caller (có thể override)
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      // Thử đọc JSON { error, reason }
      let serverMessage = ''
      try {
        const data = await res.json()
        serverMessage = data?.reason || data?.error || ''
      } catch {
        // Nếu không phải JSON, fallback sang text
        serverMessage = await res.text()
      }
      throw new Error(`HTTP_ERROR: ${serverMessage || `HTTP ${res.status}`}`)
    }

    return (await res.json()) as T
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      // Timeout
      throw new Error('AUTH_NETWORK_TIMEOUT')
    }
    // Lỗi mạng khác
    if (err?.message && (err.message.includes('network') || err.message.includes('fetch'))) {
      throw new Error('AUTH_NETWORK_TIMEOUT')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

type InternalAuthStatus = 'unregistered' | 'pending' | 'allowed' | 'blocked' | 'error'

interface InternalAuthState {
  status: InternalAuthStatus
  username?: string
  password?: string
  machineId: string
  activationKey?: string
  message?: string
  refreshCount?: number
  latestVersion?: string // Phiên bản mới nhất từ server
  downloadUrl?: string // Link tải bản mới
}

let authState: InternalAuthState | null = null

async function getOrInitAuthState(): Promise<InternalAuthState> {
  if (authState) return authState
  
  // Lấy machineId hiện tại của máy
  const currentMachineId = await getMachineHash()
  
  // Thử migrate từ plaintext format (chỉ chạy một lần)
  try {
    await migrateFromPlaintext()
  } catch (err) {
    console.warn('[auth] Migration from plaintext failed:', err)
  }
  
  // Thử load từ encrypted file nếu có (remember me)
  const stored = await readEncryptedAuthState()
  if (stored && stored.remember && stored.status === 'allowed' && stored.username && stored.password) {
    // MachineId đã được verify trong readEncryptedAuthState()
    // Nếu không khớp, readEncryptedAuthState() sẽ return null
    
    authState = {
      status: stored.status,
      username: stored.username,
      password: stored.password,
      machineId: currentMachineId, // Dùng machineId hiện tại
      activationKey: stored.activationKey,
      message: stored.message,
      latestVersion: stored.latestVersion,
      downloadUrl: stored.downloadUrl,
    }
    return authState
  }
  
  // Nếu không có stored hoặc không remember, khởi tạo mới
  authState = {
    status: 'unregistered',
    machineId: currentMachineId,
    message: 'Máy này chưa đăng ký tài khoản sử dụng.',
  }
  return authState
}

async function refreshLicenseState(forceRemote = false): Promise<LicenseState> {
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

async function refreshDiskInfoAndBroadcast(): Promise<DiskInfoSummary> {
  try {
    const info = await getDiskInfo()
    cachedDiskInfo = info
    broadcastDiskInfo(info)
    return info
  } catch (error) {
    console.error('[system] Failed to get disk info:', error)
    const fallback: DiskInfoSummary = {
      drives: [],
      byType: { ssd: null, hdd: null },
      updatedAt: Date.now(),
    }
    cachedDiskInfo = fallback
    broadcastDiskInfo(fallback)
    return fallback
  }
}

function broadcastDiskInfo(info: DiskInfoSummary) {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('system:disk-info', info)
    }
  }
}

jobQueue.on('update', (job) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('jobQueue:update', job)
  }
})

// Hiển thị dialog lỗi khi không load được
function showLoadErrorDialog(window: BrowserWindow | null, code: string, message: string, error: any) {
  if (!window || window.isDestroyed()) return
  
  const errorDetails = error ? (error.message || String(error)) : ''
  const fullMessage = errorDetails ? `${message}\n\nChi tiết: ${errorDetails}` : message
  
  // Delay một chút để đảm bảo window đã hiển thị
  setTimeout(() => {
    if (window && !window.isDestroyed()) {
      dialog.showMessageBox(window, {
        type: 'error',
        title: 'Lỗi Khởi Động Ứng Dụng',
        message: 'Không thể tải giao diện ứng dụng',
        detail: fullMessage,
        buttons: ['Đóng', 'Mở DevTools'],
        defaultId: 0,
        cancelId: 0,
      }).then((result) => {
        if (result.response === 1) {
          // Mở DevTools để debug
          if (window && !window.isDestroyed()) {
            window.webContents.openDevTools()
          }
        }
      }).catch((err) => {
        console.error('[Window] Failed to show error dialog:', err)
      })
    }
  }, 500)
}

// Load error page HTML
function loadErrorPage(window: BrowserWindow | null, errorMessage: string) {
  if (!window || window.isDestroyed()) return
  
  const errorHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Lỗi Khởi Động Ứng Dụng</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #1e1e1e 0%, #2d2d2d 100%);
      color: #ffffff;
      margin: 0;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      max-width: 600px;
      padding: 40px;
      background: #2a2a2a;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      border: 2px solid #dc2626;
    }
    h1 {
      color: #fca5a5;
      margin-top: 0;
      font-size: 28px;
    }
    .error-message {
      background: #1a1a1a;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #dc2626;
      margin: 20px 0;
      white-space: pre-wrap;
      font-family: 'Courier New', monospace;
      font-size: 14px;
      line-height: 1.6;
    }
    .actions {
      margin-top: 30px;
    }
    .action-item {
      margin: 10px 0;
      padding: 12px;
      background: #3a3a3a;
      border-radius: 6px;
    }
    .action-item strong {
      color: #60a5fa;
    }
    code {
      background: #1a1a1a;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>❌ Lỗi Khởi Động Ứng Dụng</h1>
    <p>Ứng dụng không thể tải giao diện. Vui lòng thực hiện các bước sau:</p>
    <div class="error-message">${errorMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
    <div class="actions">
      <div class="action-item">
        <strong>Bước 1:</strong> Chạy diagnostic script để kiểm tra:<br>
        <code>.\\scripts\\diagnose-app.ps1</code>
      </div>
      <div class="action-item">
        <strong>Bước 2:</strong> Chạy uninstaller để xóa sạch:<br>
        <code>.\\scripts\\uninstall-complete.ps1</code>
      </div>
      <div class="action-item">
        <strong>Bước 3:</strong> Cài đặt lại ứng dụng
      </div>
    </div>
  </div>
</body>
</html>
  `
  
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`).catch((err) => {
    console.error('[Window] Failed to load error page:', err)
  })
}

// Tạo window chính
function createWindow() {
  // Xác định đường dẫn preload đúng cho cả dev và production
  // Trong packaged app (asar):
  // - __dirname = app.asar/dist-electron/main
  // - preload = app.asar/dist-electron/preload/preload.js
  // Trong dev mode:
  // - __dirname = dist-electron/main
  // - preload = dist-electron/preload/preload.js
  // Cả 2 trường hợp đều dùng: ../preload/preload.js
  const preloadPath = path.join(__dirname, '../preload/preload.js')
  
  // Kiểm tra preload file có tồn tại không
  const fs = require('fs')
  if (!fs.existsSync(preloadPath)) {
    console.error('[Window] Preload file not found at:', preloadPath)
    console.error('[Window] __dirname:', __dirname)
    console.error('[Window] app.isPackaged:', app.isPackaged)
  } else {
    console.log('[Window] Preload file found at:', preloadPath)
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    title: '93 Media - Tool Mix Nhạc',
    show: false, // Không hiển thị ngay, chờ load xong
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Cho phép trang http://localhost:5173 load file:// trong DEV
      webSecurity: !isDev,
      allowRunningInsecureContent: isDev,
    },
  })

  // Hiển thị window khi đã sẵn sàng
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
      console.log('[Window] Window shown and focused')
    }
  })
  
  // Fallback: Nếu sau 5 giây mà window chưa show, force show
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn('[Window] Window not visible after 5s, forcing show...')
      mainWindow.show()
      mainWindow.focus()
    }
  }, 5000)

  // Error handling cho webContents
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Window] Failed to load:', {
      errorCode,
      errorDescription,
      validatedURL,
    })
    // Hiển thị window ngay cả khi load fail
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.webContents.send('app:load-error', {
        code: errorCode,
        description: errorDescription,
        url: validatedURL,
      })
      // Load error page
      loadErrorPage(mainWindow, `Lỗi khi tải trang:\nCode: ${errorCode}\nMô tả: ${errorDescription}\nURL: ${validatedURL}`)
    }
  })

  mainWindow.webContents.on('crashed', (event, killed) => {
    console.error('[Window] Renderer process crashed:', { killed })
    // Thử reload window sau khi crash
    if (mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload()
        }
      }, 1000)
    }
  })

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Window] Renderer process became unresponsive')
    // Hiển thị dialog cho user biết
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Ứng Dụng Không Phản Hồi',
        message: 'Ứng dụng đang không phản hồi. Bạn có muốn đợi thêm hoặc đóng lại?',
        buttons: ['Đợi thêm', 'Đóng lại'],
        defaultId: 0,
      }).then((result) => {
        if (result.response === 1) {
          // Đóng lại
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.close()
          }
        }
      }).catch(() => {})
    }
  })

  mainWindow.webContents.on('responsive', () => {
    console.log('[Window] Renderer process became responsive again')
  })

  // CSP headers
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? [
          "default-src 'self' app: http://localhost:*",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: http://localhost:*",
          "style-src 'self' 'unsafe-inline' http://localhost:* https://fonts.googleapis.com",
          "font-src 'self' data: http://localhost:* https://fonts.gstatic.com",
          "img-src 'self' data: blob: http://localhost:* https: app:",
          "media-src 'self' app: blob: data: http://localhost:*",
          "connect-src 'self' http://localhost:* ws://localhost:* https:",
          "worker-src 'self' blob:",
        ].join('; ')
      : [
          "default-src 'self' app:",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: app:",
          "style-src 'self' 'unsafe-inline' app: https://fonts.googleapis.com",
          "font-src 'self' data: app: https://fonts.gstatic.com",
          "img-src 'self' data: blob: https: app:",
          "media-src 'self' app: blob: data:",
          "connect-src 'self' https: app:",
          "worker-src 'self' blob:",
        ].join('; ')

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    // Dev mode: dùng URL của Vite dev server
    console.log('[Window] Loading dev URL:', process.env.ELECTRON_RENDERER_URL)
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL).catch((err) => {
      console.error('[Window] Failed to load dev URL:', err)
      showLoadErrorDialog(mainWindow, 'DEV_URL_ERROR', `Không thể tải URL dev: ${process.env.ELECTRON_RENDERER_URL}`, err)
    })
  } else {
    // Build mode: load file index.html đã build
    // Trong packaged app: __dirname = app.asar/dist-electron/main
    // index.html nằm ở: app.asar/dist/index.html
    // Trong dev: __dirname = dist-electron/main
    // index.html nằm ở: dist/index.html
    let indexPath: string
    if (app.isPackaged) {
      // Packaged: index.html nằm trong asar
      indexPath = path.join(__dirname, '../../dist/index.html')
    } else {
      // Dev: index.html nằm ở dist/
      indexPath = path.join(__dirname, '../../dist/index.html')
    }
    
    console.log('[Window] Loading index.html from:', indexPath)
    console.log('[Window] __dirname:', __dirname)
    console.log('[Window] app.isPackaged:', app.isPackaged)
    
    const fs = require('fs')
    const fileExists = fs.existsSync(indexPath)
    console.log('[Window] File exists:', fileExists)
    
    if (!fileExists) {
      console.error('[Window] index.html NOT FOUND at:', indexPath)
      // Hiển thị window trước để có thể show dialog
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
      }
      // Hiển thị dialog lỗi ngay lập tức
      showLoadErrorDialog(mainWindow, 'FILE_NOT_FOUND', `Không tìm thấy file index.html tại:\n${indexPath}\n\nVui lòng cài đặt lại ứng dụng.`, null)
      // Load error page thay vì return
      loadErrorPage(mainWindow, `File index.html không tồn tại tại:\n${indexPath}\n\nVui lòng chạy diagnostic script để kiểm tra.`)
      return
    }
    
    // Retry logic cho việc load file
    let retryCount = 0
    const maxRetries = 3
    const loadFileWithRetry = async () => {
      try {
        await mainWindow!.loadFile(indexPath)
        console.log('[Window] Successfully loaded index.html')
      } catch (err: any) {
        retryCount++
        console.error(`[Window] Failed to load index.html (attempt ${retryCount}/${maxRetries}):`, err)
        console.error(`[Window] Error details:`, {
          message: err?.message,
          code: err?.code,
          stack: err?.stack,
        })
        
        if (retryCount < maxRetries) {
          // Đợi một chút trước khi retry
          console.log(`[Window] Retrying in ${1000 * retryCount}ms...`)
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount))
          return loadFileWithRetry()
        } else {
          // Đã hết retry, hiển thị lỗi
          console.error('[Window] All retry attempts failed, showing error page')
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show()
            // Đảm bảo window visible
            if (!mainWindow.isVisible()) {
              mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
              mainWindow.show()
            }
          }
          showLoadErrorDialog(mainWindow, 'LOAD_ERROR', `Không thể tải file index.html sau ${maxRetries} lần thử:\n${indexPath}\n\nLỗi: ${err?.message || String(err)}`, err)
          // Load error page
          loadErrorPage(mainWindow, `Lỗi khi tải file index.html sau ${maxRetries} lần thử:\n\nĐường dẫn: ${indexPath}\n\nLỗi: ${err?.message || String(err)}\n\nVui lòng chạy diagnostic script để kiểm tra:\n.\\scripts\\diagnose-app.ps1`)
        }
      }
    }
    
    // Bắt lỗi nếu loadFileWithRetry throw
    loadFileWithRetry().catch((err) => {
      console.error('[Window] loadFileWithRetry threw unhandled error:', err)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        loadErrorPage(mainWindow, `Lỗi nghiêm trọng khi tải ứng dụng:\n${err?.message || String(err)}`)
      }
    })
  }

  // Mở DevTools trong dev mode hoặc nếu có lỗi (để debug)
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools()
  }
  
  // Trong production, mở DevTools nếu có lỗi (tạm thời để debug)
  if (app.isPackaged && process.env.DEBUG === '1') {
    mainWindow.webContents.openDevTools()
  }

  // (Optional) xử lý link mở ngoài
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  
  // Setup YouTube handlers
  if (mainWindow) {
    setupYouTubeHandlers(mainWindow)
  }
}

async function confirmResourcesForVideoJob(kind: 'merge' | 'final-export' | 'mute', targetDir: string): Promise<boolean> {
  try {
    const diskSpace = await getDiskSpace(targetDir)
    // Minimum thresholds per job type (bytes)
    const minRequired: Record<string, number> = {
      'merge': 2 * 1024 * 1024 * 1024,       // 2 GB
      'final-export': 4 * 1024 * 1024 * 1024, // 4 GB
      'mute': 512 * 1024 * 1024,               // 512 MB
    }
    const required = minRequired[kind] ?? 1 * 1024 * 1024 * 1024
    const hasEnough = checkMinimumSpace(diskSpace, required)
    if (!hasEnough) {
      console.warn(
        `[confirmResources] Not enough disk space for ${kind}: ` +
        `available=${formatBytes(diskSpace.free)}, required=${formatBytes(required)}`
      )
    }
    return hasEnough
  } catch (err) {
    // Nếu không lấy được disk info — cho phép tiếp tục (fail open)
    console.warn('[confirmResources] Could not check disk space:', err)
    return true
  }
}

// Log FFmpeg info
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

// Module-scope map: tracks active FFmpeg processes for Song Nhạc export (needed by before-quit handler)
const activeSongNhacExports = new Map<string, import('child_process').ChildProcess>()

// Đăng ký IPC handlers (GIỮ LẠI NHƯ CŨ, CHỈ DI CHUYỂN VÀO SAU createWindow)
function registerIpcHandlers() {
  ipcMain.handle('license:getState', async () => {
    if (licenseState.status === 'checking') {
      await refreshLicenseState()
    }
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
  // ===== AUTH IPC (ONLINE, sử dụng Worker + D1) =====

  ipcMain.handle('auth:getState', async () => {
    const state = await getOrInitAuthState()
    return state
  })

  ipcMain.handle(
    'auth:register',
    async (_event, payload: { username: string; password: string }) => {
      const base = await getOrInitAuthState()
      try {
        await postJson(
          '/api/auth/register',
          {
            tai_khoan: payload.username,
            mat_khau: payload.password,
            ma_may: base.machineId,
            version: APP_VERSION,
          }
          // Bỏ installer key - chưa cần thiết
          // { 'x-installer-key': INSTALLER_SECRET }
        )

        authState = {
          status: 'pending',
          username: payload.username,
          password: payload.password,
          machineId: base.machineId,
          activationKey: undefined,
          message:
            'Yêu cầu đăng ký đã được gửi lên server. Nhấn "Kiểm tra lại" sau khi admin cấp quyền.',
          refreshCount: 0,
        }
        
        // Lưu trạng thái pending (không cần remember vì chưa được duyệt)
        await writeEncryptedAuthState({
          status: authState.status,
          username: authState.username,
          password: authState.password,
          machineId: authState.machineId,
          message: authState.message,
          remember: false,
        })
      } catch (err: any) {
        console.error('[auth:register] error', err)
        authState = {
          status: 'error',
          machineId: base.machineId,
          message: getFriendlyAuthError(err, 'Không gửi được yêu cầu đăng ký.'),
        }
      }
      return authState!
    }
  )

  ipcMain.handle('auth:refresh', async () => {
    const state = await getOrInitAuthState()
    if (!state.username || !state.password) {
      return state
    }
    
    // QUAN TRỌNG: Kiểm tra machineId hiện tại có khớp với stored không
    // Nếu user sửa machineId trong file, phải clear và yêu cầu đăng nhập lại
    const currentMachineId = await getMachineHash()
    if (state.machineId !== currentMachineId) {
      console.warn('[auth:refresh] MachineId mismatch! Stored:', state.machineId, 'Current:', currentMachineId)
      console.warn('[auth:refresh] Clearing auth state - user may have tampered with encrypted auth state')
      clearEncryptedAuthState()
      authState = {
        status: 'unregistered',
        machineId: currentMachineId,
        message: 'Machine ID đã thay đổi. Vui lòng đăng nhập lại.',
      }
      return authState
    }

    // Check session timeout
    const stored = await readEncryptedAuthState()
    if (stored && stored.status === 'allowed' && stored.sessionInfo) {
      const { isSessionValid } = await import('../backend/auth/sessionManager')
      if (!isSessionValid(stored.sessionInfo)) {
        console.warn('[auth:refresh] Session expired, requiring re-login')
        await clearEncryptedAuthState()
        authState = {
          status: 'unregistered',
          machineId: currentMachineId,
          message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
        }
        return authState
      }
    }
    
    try {
      const result = await postJson<{
        allow: boolean
        reason?: string
        key_kich_hoat?: string
        trang_thai?: string
        latestVersion?: string
        downloadUrl?: string
      }>('/api/auth/check', {
        tai_khoan: state.username,
        mat_khau: state.password,
        ma_may: currentMachineId, // Dùng machineId hiện tại
        version: APP_VERSION,
      })

      if (!result.allow) {
        const status =
          result.trang_thai === 'CHAN'
            ? ('blocked' as InternalAuthStatus)
            : ('pending' as InternalAuthStatus)
        authState = {
          ...state,
          status,
          message:
            result.reason ||
            (status === 'blocked'
              ? 'Tài khoản / máy đã bị chặn.'
              : 'Tài khoản đang chờ admin cấp quyền.'),
          latestVersion: result.latestVersion,
          downloadUrl: result.downloadUrl,
        }
      } else {
        authState = {
          ...state,
          status: 'allowed',
          activationKey: result.key_kich_hoat,
          message: 'Admin đã cấp quyền. Bạn có thể đăng nhập.',
          latestVersion: result.latestVersion,
          downloadUrl: result.downloadUrl,
        }
        
        // Cập nhật file nếu đã có stored (remember me)
        const stored = await readEncryptedAuthState()
        if (stored && stored.remember) {
          const { updateSessionActivity, createSession } = await import('../backend/auth/sessionManager')
          const sessionInfo = stored.sessionInfo
            ? updateSessionActivity(stored.sessionInfo)
            : createSession()
          
          await writeEncryptedAuthState({
            ...stored,
            status: authState.status,
            activationKey: authState.activationKey,
            message: authState.message,
            latestVersion: authState.latestVersion,
            downloadUrl: authState.downloadUrl,
            sessionInfo,
          })
        }
      }
    } catch (err: any) {
      console.error('[auth:refresh] error', err)
      authState = {
        ...state,
        status: 'error',
        message: getFriendlyAuthError(err, 'Không kiểm tra được trạng thái từ server.'),
      }
    }
    return authState!
  })

  ipcMain.handle(
    'auth:login',
    async (_event, payload: { username: string; password: string; remember: boolean }) => {
      try {
        // Rate limit: tối đa 5 lần thử trong 15 phút theo username
        const rateKey = `login:${payload.username}`
        const rateResult = loginRateLimiter.check(rateKey, LOGIN_RATE_LIMIT_CONFIG)
        if (!rateResult.allowed) {
          const resetInSec = rateResult.resetAt ? Math.ceil((rateResult.resetAt - Date.now()) / 1000) : 900
          return {
            ok: false,
            message: `Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau ${resetInSec} giây.`,
          }
        }

        const base = await getOrInitAuthState()
        const result = await postJson<{
          allow: boolean
          reason?: string
          key_kich_hoat?: string
          trang_thai?: string
          latestVersion?: string
          downloadUrl?: string
        }>('/api/auth/check', {
          tai_khoan: payload.username,
          mat_khau: payload.password,
          ma_may: base.machineId,
          version: APP_VERSION,
        })

        if (!result.allow) {
          return {
            ok: false,
            message:
              result.reason ||
              (result.trang_thai === 'CHAN'
                ? 'Tài khoản / máy này đã bị chặn.'
                : 'Tài khoản chưa được cấp quyền.'),
          }
        }

        authState = {
          status: 'allowed',
          username: payload.username,
          password: payload.password,
          machineId: base.machineId,
          activationKey: result.key_kich_hoat,
          message: 'Đăng nhập thành công, tài khoản đã được kích hoạt.',
          latestVersion: result.latestVersion,
          downloadUrl: result.downloadUrl,
        }

        // Lưu vào file nếu remember = true
        if (payload.remember) {
          const { createSession } = await import('../backend/auth/sessionManager')
          await writeEncryptedAuthState({
            status: authState.status,
            username: authState.username,
            password: authState.password,
            machineId: authState.machineId,
            activationKey: authState.activationKey,
            message: authState.message,
            latestVersion: authState.latestVersion,
            downloadUrl: authState.downloadUrl,
            remember: true,
            sessionInfo: createSession(),
          })
        } else {
          // Nếu không remember, xóa file cũ
          clearEncryptedAuthState()
        }

        // Login thành công — reset rate limiter
        loginRateLimiter.reset(rateKey)
        return { ok: true }
      } catch (err: any) {
        console.error('[auth:login] error', err)
        return {
          ok: false,
          message: getFriendlyAuthError(err, 'Lỗi khi đăng nhập với server.'),
        }
      }
    }
  )

  ipcMain.handle('auth:clear', async () => {
    const current = await getOrInitAuthState()
    authState = {
      status: 'unregistered',
      machineId: current.machineId,
      message: 'Đăng ký lại với tài khoản mới.',
    }
    // Xóa file stored
    clearEncryptedAuthState()
  })

  ipcMain.handle('auth:checkStatus', async (_event, data: { username: string }) => {
    try {
      const result = await postJson<{
        allow: boolean
        status: string
        latestVersion?: string
        downloadUrl?: string
        message?: string
      }>('/api/auth/check-status', {
        tai_khoan: data.username,
        ma_may: (await getOrInitAuthState()).machineId,
        version: APP_VERSION,
      })
      if (result.allow) {
        authState = {
          ...(authState || {}),
          status: 'allowed',
          username: data.username,
          machineId: (await getOrInitAuthState()).machineId,
          latestVersion: result.latestVersion,
          downloadUrl: result.downloadUrl,
        }
      }
      return result
    } catch (err: any) {
      console.error('[auth:checkStatus] error', err)
      return { allow: false, status: 'error', message: err?.message }
    }
  })

  ipcMain.handle('auth:validateKey', async (_event, data: { username: string; key: string }) => {
    try {
      // Rate limit: tối đa 5 lần thử trong 15 phút theo username
      const rateKey = `validateKey:${data.username}`
      const rateResult = loginRateLimiter.check(rateKey, LOGIN_RATE_LIMIT_CONFIG)
      if (!rateResult.allowed) {
        const resetInSec = rateResult.resetAt ? Math.ceil((rateResult.resetAt - Date.now()) / 1000) : 900
        return { valid: false, message: `Quá nhiều lần thử. Vui lòng thử lại sau ${resetInSec} giây.` }
      }

      const state = await getOrInitAuthState()
      const result = await postJson<{
        valid: boolean
        device_token?: string
        message?: string
      }>('/api/auth/validate-key', {
        tai_khoan: data.username,
        key_kich_hoat: data.key,
        ma_may: state.machineId,
        version: APP_VERSION,
      })
      if (result.valid && result.device_token) {
        const { createSession } = await import('../backend/auth/sessionManager')
        authState = {
          status: 'allowed',
          username: data.username,
          machineId: state.machineId,
          activationKey: data.key,
        }
        // Lưu encrypted auth state
        await writeEncryptedAuthState({
          status: 'allowed',
          username: data.username,
          password: state.password,
          machineId: state.machineId,
          activationKey: data.key,
          remember: true,
          sessionInfo: createSession(),
        })
        // Key hợp lệ — reset rate limiter
        loginRateLimiter.reset(rateKey)
      }
      return result
    } catch (err: any) {
      console.error('[auth:validateKey] error', err)
      return { valid: false, message: err?.message || 'Lỗi xác thực key' }
    }
  })

  ipcMain.handle('auth:validateToken', async () => {
    try {
      const stored = await readEncryptedAuthState()
      if (!stored || !stored.sessionInfo) {
        return { valid: false, action: 'NO_TOKEN' }
      }
      const { isSessionValid } = await import('../backend/auth/sessionManager')
      if (!isSessionValid(stored.sessionInfo)) {
        return { valid: false, action: 'EXPIRED' }
      }
      // Token valid — restore auth state
      authState = {
        status: 'allowed',
        username: stored.username,
        machineId: stored.machineId,
        activationKey: stored.activationKey,
      }
      return { valid: true, username: stored.username }
    } catch (err: any) {
      console.error('[auth:validateToken] error', err)
      return { valid: false, action: 'ERROR', message: err?.message }
    }
  })

  // Các handler đã có trước đó: music:scan, music:createPlaylist, music:preview, music:export,
  // video:cutSingle, video:cutBatch, video:merge, video:finalExport.
  // Nếu hiện tại file main.ts đang có logic nào cho những channel này
  // thì HÃY GIỮ LẠI NGUYÊN VẸN và chỉ đặt chúng trong hàm này.

  // Job queue inspectors
  ipcMain.handle('jobQueue:list', async () => {
    return jobQueue.getJobs()
  })

  ipcMain.handle('jobQueue:get', async (_event, jobId: string) => {
    return jobQueue.getJob(jobId) ?? null
  })

  ipcMain.handle('jobQueue:cancel', async (_event, jobId: string) => {
    await jobQueue.cancelJob(jobId)
    return { success: true }
  })

  // FFprobe IPC
  ipcMain.handle('ffmpeg:probe', async (_event, filePath: string) => {
    if (!probeFile) {
      const probeModule = await import('../backend/ffmpeg/probe')
      probeFile = probeModule.probeFile
    }
    return await probeFile(filePath)
  })

  // System info IPC
  ipcMain.handle('system:info', async () => {
    return await getSystemInfo()
  })

  ipcMain.handle('system:realtime', async () => {
    return await getRealtimeStats()
  })

  ipcMain.handle('system:getDiskInfo', async () => {
    if (cachedDiskInfo) return cachedDiskInfo
    return await refreshDiskInfoAndBroadcast()
  })

  ipcMain.handle('system:refreshDiskInfo', async () => {
    return await refreshDiskInfoAndBroadcast()
  })

  // Dialog IPC
  ipcMain.handle('dialog:openFile', async (_event, options: any) => {
    const properties: ('openFile' | 'multiSelections')[] = ['openFile']
    const result = await dialog.showOpenDialog({
      title: options?.title,
      filters: options?.filters,
      properties,
    })
    return { canceled: result.canceled, filePaths: result.filePaths }
  })

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectVideoFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectVideoFilesMulti', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths
  })

  ipcMain.handle('dialog:selectImageFile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Chọn file ảnh',
        filters: [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      return result.filePaths[0]
    } catch (error) {
      console.error('[IPC] Error selecting image file:', error)
      return null
    }
  })

  ipcMain.handle('dialog:selectAudioFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'flac', 'aac'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectAudioFilesMulti', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'flac', 'aac'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths
  })

  ipcMain.handle('dialog:selectManyVideos', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths
  })

  // System: Create Directory IPC
  ipcMain.handle('system:createDirectory', async (_event, dirPath: string) => {
    try {
      const fs = await import('node:fs')
      await fs.promises.mkdir(dirPath, { recursive: true })
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('video:listVideosInFolder', async (_event, folderPath: string) => {
    try {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const exts = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.avi', '.wmv', '.webm'])
      const entries = fs.readdirSync(folderPath, { withFileTypes: true })
      const files: Array<{ path: string; fileName: string; sizeBytes: number }> = []
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const ext = path.extname(entry.name).toLowerCase()
        if (!exts.has(ext)) continue
        const full = path.join(folderPath, entry.name)
        let sizeBytes = 0
        try {
          sizeBytes = fs.statSync(full).size
        } catch {}
        files.push({ path: full, fileName: entry.name, sizeBytes })
      }
      return files
    } catch (err) {
      console.error('[IPC] video:listVideosInFolder error', err)
      return []
    }
  })

  ipcMain.handle('video:listVideosInFolderSimple', async (_event, folderPath: string) => {
    try {
      console.log('[IPC] video:listVideosInFolderSimple', folderPath)
      // Simple implementation: scan folder and return video files
      const fs = await import('node:fs')
      const path = await import('node:path')
      const exts = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.avi', '.wmv', '.webm'])
      const entries = fs.readdirSync(folderPath, { withFileTypes: true })
      const files: Array<{ path: string; fileName: string; sizeBytes: number }> = []
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const ext = path.extname(entry.name).toLowerCase()
        if (!exts.has(ext)) continue
        const full = path.join(folderPath, entry.name)
        let sizeBytes = 0
        try {
          sizeBytes = fs.statSync(full).size
        } catch {}
        files.push({ path: full, fileName: entry.name, sizeBytes })
      }
      return files
    } catch (err) {
      console.error('[IPC] video:listVideosInFolderSimple error', err)
      return []
    }
  })

  // Ultra Fast Scan (recursive) - DEPRECATED, fallback to simple scan
  ipcMain.handle('video:ultraFastScanFolder', async (_event, folderPath: string) => {
    try {
      console.log('[IPC] video:ultraFastScanFolder', folderPath)
      // Fallback to simple implementation
      const fs = await import('node:fs')
      const path = await import('node:path')
      const exts = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.avi', '.wmv', '.webm'])
      const files: Array<{ path: string; fileName: string; sizeBytes: number; mtimeMs: number }> = []
      
      const scanDir = (dir: string) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              scanDir(fullPath)
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase()
              if (exts.has(ext)) {
                try {
                  const stats = fs.statSync(fullPath)
                  files.push({
                    path: fullPath,
                    fileName: entry.name,
                    sizeBytes: stats.size,
                    mtimeMs: stats.mtimeMs,
                  })
                } catch {}
              }
            }
          }
        } catch {}
      }
      
      scanDir(folderPath)
      return files
    } catch (err) {
      console.error('[IPC] video:ultraFastScanFolder error', err)
      return []
    }
  })

  // Batch Lazy Probe - DEPRECATED, fallback to sequential probe
  ipcMain.handle('video:batchLazyProbe', async (_event, paths: string[], concurrency: number = 5) => {
    try {
      console.log('[IPC] video:batchLazyProbe', paths.length, 'files, concurrency:', concurrency)
      // Fallback: sequential probe using getVideoFileInfo
      const results: Record<string, any> = {}
      const limit = Math.min(concurrency, paths.length)
      const chunks: string[][] = []
      for (let i = 0; i < paths.length; i += limit) {
        chunks.push(paths.slice(i, i + limit))
      }
      
      for (const chunk of chunks) {
        await Promise.all(
          chunk.map(async (p) => {
            try {
              const info = await getVideoFileInfo(p)
              results[p] = info
            } catch (err) {
              console.warn('[batchLazyProbe] Failed to probe', p, err)
            }
          })
        )
      }
      
      return results
    } catch (err) {
      console.error('[IPC] video:batchLazyProbe error', err)
      return {}
    }
  })

  // Music scan IPC
  ipcMain.handle('music:scanFolders', async (_event, payload) => {
    // payload: { priorityFolder: string | null; randomFolder: string | null }
    console.log('[IPC] music:scanFolders', payload)
    
    // Clear playlists khi quét nhạc mới (playlist cũ không còn hợp lệ)
    clearPlaylists()
    console.log('[IPC] Cleared old playlists due to new scan')
    
    const result = await scanMusicFolders(payload)
    return result
  })

  // Create playlists IPC
  ipcMain.handle('music:createPlaylists', async (_event, payload: BuildPlaylistsOptions) => {
    console.log('[IPC] music:createPlaylists', {
      tracks: payload.tracks?.length,
      pinned: payload.pinnedTrackIds?.length,
      playlistCount: payload.playlistCount,
      targetMinutes: payload.targetDurationMinutes,
    })
    const playlists = buildPlaylists(payload)
    savePlaylists(playlists)
    return playlists
  })

  // List playlists IPC
  ipcMain.handle('music:listPlaylists', async () => {
    return getPlaylists()
  })

  ipcMain.handle('music:getLastScan', async () => {
    return loadScanResult()
  })

  // Export history (3 ngày gần nhất)
  ipcMain.handle('music:getExportHistory', async () => {
    try {
      return getRecentHistory()
    } catch (err) {
      console.error('[IPC] music:getExportHistory error', err)
      return []
    }
  })

  // Validate playlists for crossfade (pre-check) - REMOVED: duplicate handler, using the one below

  ipcMain.handle('video:seo:apply', async (_event, payload: SeoMetadataRequest) => {
    try {
      const result = await applySeoMetadata(payload)
      return result
    } catch (err: any) {
      console.error('[IPC] video:seo:apply error', err)
      return { error: err?.message || String(err) }
    }
  })

  // Export playlist IPC
  const EXPORT_PROGRESS_CHANNEL = 'music:exportProgress'
  ipcMain.handle('music:exportPlaylist', async (event, req: ExportPlaylistRequest) => {
    console.log('[IPC] music:exportPlaylist', req)
    
    // Bỏ license check - chưa cần thiết
    // try {
    //   await requireValidLicense()
    // } catch (error: any) {
    //   console.error('[IPC] music:exportPlaylist - License check failed:', error.message)
    //   throw new Error(`Không thể xuất nhạc: ${error.message}`)
    // }
    
    // FIX: Thêm resource check tương tự như video export
    if (mainWindow && !mainWindow.isDestroyed()) {
      const proceed = await confirmResourcesForVideoJob('final-export', req.outputDir)
      if (!proceed) {
        return {
          success: false,
          error: 'Người dùng đã hủy xuất nhạc sau cảnh báo tài nguyên.',
          requestId: '',
        }
      }
    }
    
    const sender = event.sender
    const jobHandle = jobQueue.enqueue<ExportPlaylistResult>({
      type: 'music:export-playlist',
      payload: { 
        playlistId: req.playlistId, 
        outputPath: (req as any)?.outputPath,
        // Lưu thêm metadata để restore UI khi component mount lại
        playlistName: (req as any)?.playlistName,
        currentIndex: (req as any)?.currentIndex,
        totalCount: (req as any)?.totalCount,
      },
      onCancel: (jobId) => {
        // Cancel FFmpeg process trong videoJobManager
        videoJobManager.cancelJob(jobId)
      },
      task: async (ctx) => {
        // Pass requestId và signal vào exportPlaylistToFile
        const result = await exportPlaylistToFile(
          { ...req, requestId: ctx.jobId, signal: ctx.signal } as any,
          (progress) => {
            const progressPercent =
              progress.percent ??
              (progress.totalSec && progress.totalSec > 0
                ? (progress.currentSec / progress.totalSec) * 100
                : undefined)

            ctx.updateProgress(progressPercent, 'Exporting playlist')
            sender.send(EXPORT_PROGRESS_CHANNEL, {
              ...progress,
              requestId: ctx.jobId,
            })
          }
        )
        return result
      },
    })

    try {
      const result = await jobHandle.result
      return {
        ...result,
        requestId: jobHandle.jobId,
      }
    } catch (err: any) {
      console.error('[IPC] music:exportPlaylist error', err)
      return {
        success: false,
        error: err?.message || 'Lỗi không xác định khi xuất playlist.',
        requestId: jobHandle.jobId,
      } satisfies ExportPlaylistResult & { requestId: string }
    }
  })

  // Validate playlists for crossfade IPC
  ipcMain.removeHandler('music:validatePlaylistsForCrossfade') // Remove handler cũ nếu có (tránh lỗi khi hot-reload)
  ipcMain.handle('music:validatePlaylistsForCrossfade', async (_event, req: ValidatePlaylistsForCrossfadeRequest) => {
    try {
      console.log('[IPC] music:validatePlaylistsForCrossfade', req)
      const result = await validatePlaylistsForCrossfade(req)
      return result
    } catch (err: any) {
      console.error('[IPC] music:validatePlaylistsForCrossfade error', err)
      return {
        results: [],
        totalChecked: 0,
        totalWithIssues: 0,
      } satisfies ValidatePlaylistsForCrossfadeResult
    }
  })

  // Normalize audio bitrate IPC
  ipcMain.handle('music:normalizeAudio', async (event, req: NormalizeAudioRequest) => {
    console.log('[IPC] music:normalizeAudio', req)
    
    const sender = event.sender
    const progressChannel = 'music:normalizeAudio:progress'
    
    try {
      const result = await normalizeAudio(req, (progress: NormalizeAudioProgress) => {
        // Gửi progress đến renderer
        sender.send(progressChannel, progress)
      })
      
      return result
    } catch (err: any) {
      console.error('[IPC] music:normalizeAudio error', err)
      return {
        success: false,
        processed: 0,
        failed: 0,
        errors: [{ file: '', error: err?.message || 'Lỗi không xác định' }],
        outputFiles: [],
      }
    }
  })

  ipcMain.handle('music:normalizeAudio:cancel', async () => {
    cancelNormalizeAudio()
    return { ok: true }
  })

  // Cut video segment IPC (DEPRECATED - file cutVideo.ts không tồn tại)
  // ipcMain.handle('video:cutSegment', async (event, req: any) => {
  //   throw new Error('video:cutSegment is deprecated')
  // })

  // Video probe file IPC
  ipcMain.handle('video:probeFile', async (_event, filePath: string) => {
    try {
      console.log('[IPC] video:probeFile', filePath)
      const info = await getVideoFileInfo(filePath)
      return info
    } catch (err) {
      console.error('[IPC] video:probeFile error', err)
      throw err
    }
  })

  // Video split file IPC (DEPRECATED - file splitVideo.ts không tồn tại)
  const VIDEO_PROGRESS_CHANNEL = 'video:progress'
  // ipcMain.handle('video:splitFile', async (event, options: any) => {
  //   throw new Error('video:splitFile is deprecated, use video:splitManySimple')
  // })

  // Video merge file IPC (DEPRECATED - file mergeVideo.ts không tồn tại)
  // ipcMain.handle('video:mergeFile', async (event, options: any) => {
  //   throw new Error('video:mergeFile is deprecated, use video:mergeSimple')
  // })

  // ============================================
  // TURBO ENGINE IPC HANDLERS
  // ============================================

  // Detect disk type (DEPRECATED - không dùng nữa, giữ lại để tránh lỗi)
  // ipcMain.handle('video:detectDiskType', async (_event, filePath: string) => {
  //   return 'UNKNOWN'
  // })

  // Get disk info (DEPRECATED - không dùng nữa, giữ lại để tránh lỗi)
  // ipcMain.handle('video:getDiskInfo', async (_event, filePath: string) => {
  //   return { type: 'UNKNOWN' as const, mount: '', isFast: false }
  // })

  // Open path (folder/file) in system file manager
  ipcMain.handle('system:openPath', async (_event, pathToOpen: string) => {
    try {
      await shell.openPath(pathToOpen)
      return { success: true }
    } catch (err) {
      console.error('[IPC] system:openPath error', err)
      return { success: false, error: String(err) }
    }
  })

  // ========== VIDEO SIMPLE MODULE IPC HANDLERS ==========

  // Get video file info with timeout
  ipcMain.handle('video:getFileInfo', async (_event, filePath: string) => {
    try {
      const timeoutMs = 8000 // 8 seconds timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout: videoGetFileInfo took longer than 8s')), timeoutMs)
      })
      
      const infoPromise = getVideoFileInfo(filePath)
      const result = await Promise.race([infoPromise, timeoutPromise])
      
      return result
    } catch (err: any) {
      console.error('[IPC] video:getFileInfo error', err)
      // Return safe default on timeout or error
      if (err?.message?.includes('Timeout')) {
        console.warn('[IPC] video:getFileInfo timeout, returning default')
        return { durationSec: 0, filePath }
      }
      throw err
    }
  })

  // Cut single video simple
  ipcMain.handle('video:cutSingleSimple', async (event, req: CutSingleSimpleRequest) => {
    const sender = event.sender
    const jobHandle = jobQueue.enqueue({
      type: 'video:cut-single',
      payload: { inputPath: req.inputPath, segmentLengthSec: req.segmentLengthSec },
      onCancel: (jobId) => videoJobManager.cancelJob(jobId),
      task: async (ctx) => {
        const result = await cutVideoIntoSegmentsSimple(
          { ...req, requestId: ctx.jobId },
          (progress) => {
            const percent = progress.percent ?? 0
            ctx.updateProgress(percent, `Cutting video (${percent.toFixed(1)}%)`)
            const payload = {
              ...progress,
              requestId: ctx.jobId,
              mode: 'single-cut' as const,
            }
            console.log('[IPC] video:cutSingleSimple - Sending progress:', payload)
            sender.send(VIDEO_PROGRESS_CHANNEL, payload)
          },
          { signal: ctx.signal } // Pass AbortSignal để có thể cancel
        )

        if (result.success) {
          sender.send(VIDEO_PROGRESS_CHANNEL, {
            requestId: ctx.jobId,
            mode: 'single-cut',
            completed: true,
            outputFiles: result.outputFiles,
            segmentCount: result.segmentCount,
            avgSpeed: result.avgSpeed,
            elapsedMs: result.elapsedMs,
          })
        } else {
          sender.send(VIDEO_PROGRESS_CHANNEL, {
            requestId: ctx.jobId,
            mode: 'single-cut',
            error: result.error,
          })
        }

        return result
      },
    })

    try {
      return await jobHandle.result
    } catch (err) {
      console.error('[IPC] video:cutSingleSimple error', err)
      throw err
    }
  })

  // Split many videos simple
  ipcMain.handle('video:splitManySimple', async (event, req: SplitManySimpleRequest) => {
    const sender = event.sender
    const jobHandle = jobQueue.enqueue({
      type: 'video:split-many',
      payload: { files: req.inputFiles?.length ?? req.inputPaths?.length ?? 0 },
      onCancel: (jobId) => {
        // Cancel parent job và tất cả child jobs
        console.log(`[IPC] Cancelling split-many job ${jobId}`)
        videoJobManager.cancelJob(jobId)
        // Cancel tất cả child jobs (format: ${jobId}-${index})
        // Tìm tất cả jobs có prefix là jobId
        const allJobIds = videoJobManager.getAllJobIds()
        for (const childId of allJobIds) {
          if (childId.startsWith(`${jobId}-`)) {
            console.log(`[IPC] Cancelling child job ${childId}`)
            videoJobManager.cancelJob(childId)
          }
        }
      },
      task: async (ctx) => {
        console.log('[IPC] video:splitManySimple - Starting task with requestId:', ctx.jobId)
        const result = await splitManyVideosSimple(
          { ...req, requestId: ctx.jobId },
          (progress) => {
            const percent = progress.overallPercent ?? progress.percent ?? 0
            ctx.updateProgress(percent, `Splitting videos (${percent.toFixed(1)}%)`)
            const payload = {
              ...progress,
              requestId: ctx.jobId,
              mode: 'multi-cut' as const,
            }
            console.log('[IPC] video:splitManySimple - Sending progress:', payload)
            sender.send(VIDEO_PROGRESS_CHANNEL, payload)
          },
          { signal: ctx.signal }
        )
        console.log('[IPC] video:splitManySimple - Task completed:', {
          success: result.success,
          totalFiles: result.totalFiles,
          successCount: result.successCount,
          failCount: result.failCount,
        })
        return result
      },
    })

    try {
      return await jobHandle.result
    } catch (err) {
      console.error('[IPC] video:splitManySimple error', err)
      throw err
    }
  })

  // Merge videos simple
  ipcMain.handle('video:mergeSimple', async (event, req: MergeVideosSimpleRequest) => {
    const sender = event.sender
    try {
      // Bỏ license check - chưa cần thiết
      // try {
      //   await requireValidLicense()
      // } catch (error: any) {
      //   console.error('[IPC] video:mergeSimple - License check failed:', error.message)
      //   throw new Error(`Không thể ghép video: ${error.message}`)
      // }
      
      const proceed = await confirmResourcesForVideoJob('merge', req.outputDir)
      if (!proceed) {
        return {
          requestId: '',
          outputPaths: [],
          totalDurationSec: 0,
          success: false,
          error: 'Job đã bị hủy sau cảnh báo tài nguyên.',
        }
      }

      // Tạo requestId để có thể cancel
      const requestId = req.requestId || randomUUID()
      activeMergeRequestId = requestId
      try {
        const result = await mergeVideosSimple(
          { ...req, requestId },
          (progress) => {
            sender.send(VIDEO_PROGRESS_CHANNEL, progress)
          }
        )
        return result
      } finally {
        // Only clear if job is no longer tracked
        if (!videoJobManager.hasJob(requestId)) {
          activeMergeRequestId = null
        } else {
          // Delay cleanup until ffmpeg process exits
          const cleanup = () => {
            activeMergeRequestId = null
          }
          const checkInterval = setInterval(() => {
            if (!videoJobManager.hasJob(requestId)) {
              clearInterval(checkInterval)
              cleanup()
            }
          }, 500)
        }
      }
    } catch (err) {
      console.error('[IPC] video:mergeSimple error', err)
      throw err
    }
  })

  // Mute video audio
  let activeMuteRequestId: string | null = null
  ipcMain.handle('video:muteAudio', async (event, req: MuteVideoAudioRequest) => {
    const sender = event.sender
    try {
      const proceed = await confirmResourcesForVideoJob('mute', req.outputDir)
      if (!proceed) {
        return {
          requestId: '',
          outputPaths: [],
          success: false,
          error: 'Job đã bị hủy sau cảnh báo tài nguyên.',
          processed: 0,
          failed: 0,
        }
      }

      // Tạo requestId để có thể cancel
      const requestId = req.requestId || randomUUID()
      activeMuteRequestId = requestId
      try {
        const result = await muteVideoAudio(
          { ...req, requestId },
          (progress) => {
            sender.send(VIDEO_PROGRESS_CHANNEL, {
              ...progress,
              requestId,
              mode: 'mute-audio',
            })
          }
        )
        return result
      } finally {
        // Only clear if job is no longer tracked
        if (!videoJobManager.hasJob(requestId)) {
          activeMuteRequestId = null
        } else {
          // Delay cleanup until ffmpeg process exits
          const cleanup = () => {
            activeMuteRequestId = null
          }
          const checkInterval = setInterval(() => {
            if (!videoJobManager.hasJob(requestId)) {
              clearInterval(checkInterval)
              cleanup()
            }
          }, 500)
        }
      }
    } catch (err: any) {
      console.error('[IPC] video:muteAudio error', err)
      return {
        requestId: req.requestId || randomUUID(),
        outputPaths: [],
        success: false,
        error: err?.message || 'Lỗi không xác định khi tắt âm thanh video',
        processed: 0,
        failed: 0,
      }
    }
  })

  ipcMain.handle('video:getActiveMuteJobId', async () => {
    return activeMuteRequestId
  })

  ipcMain.handle('video:final-export:scan-audio', async (_event, payload) => {
    try {
      return await scanAudioSource(payload)
    } catch (err: any) {
      console.error('[IPC] scan-audio error:', err)
      throw new Error(err?.message || 'Scan audio source failed')
    }
  })

  ipcMain.handle('video:final-export:scan-video', async (_event, payload) => {
    try {
      return await scanVideoSource(payload)
    } catch (err: any) {
      console.error('[IPC] scan-video error:', err)
      throw new Error(err?.message || 'Scan video source failed')
    }
  })

  // Map để lưu jobHandle theo requestId để có thể cancel
  const finalExportJobHandles = new Map<string, { cancel: () => Promise<void> }>()

  // Final export request handler
  ipcMain.on(VIDEO_FINAL_EXPORT_REQUEST, async (_event, payload: FinalExportRequestPayload) => {
    console.log('[IPC] VIDEO_FINAL_EXPORT_REQUEST received:', payload)
    
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.error('[IPC] Main window not available for final export')
      return
    }

    // Bỏ license check - chưa cần thiết
    // try {
    //   await requireValidLicense()
    // } catch (error: any) {
    //   console.error('[IPC] VIDEO_FINAL_EXPORT_REQUEST - License check failed:', error.message)
    //   const sender = mainWindow.webContents
    //   sender.send(VIDEO_FINAL_EXPORT_ERROR, {
    //     requestId: payload.requestId || '',
    //     error: `Không thể xuất video: ${error.message}`,
    //   })
    //   return
    // }

    const sender = mainWindow.webContents
    const requestId = payload.requestId || randomUUID()

    // Kiểm tra xem đã có job video:final-export đang chạy chưa
    const existingJobs = jobQueue.getJobs()
    const runningFinalExport = existingJobs.find(
      (job) => job.type === 'video:final-export' && (job.status === 'running' || job.status === 'pending')
    )
    if (runningFinalExport) {
      console.warn(`[IPC] Rejecting final export request: job ${runningFinalExport.id} is already running`)
      sender.send(VIDEO_FINAL_EXPORT_ERROR, {
        requestId,
        error: 'Đã có một quy trình xuất video đang chạy. Vui lòng đợi hoàn thành hoặc hủy trước khi bắt đầu quy trình mới.',
        message: 'Đã có một quy trình xuất video đang chạy. Vui lòng đợi hoàn thành hoặc hủy trước khi bắt đầu quy trình mới.',
      } satisfies FinalExportErrorPayload)
      return
    }

    const proceed = await confirmResourcesForVideoJob('final-export', payload.outputFolder)
    if (!proceed) {
      sender.send(VIDEO_FINAL_EXPORT_ERROR, {
        requestId,
        error: 'Người dùng đã hủy xuất video sau cảnh báo tài nguyên.',
        message: 'Người dùng đã hủy xuất video sau cảnh báo tài nguyên.',
      } satisfies FinalExportErrorPayload)
      return
    }

    // Helper function to track video export
    async function trackVideoExport(
      status: 'success' | 'failed',
      errorMessage?: string,
      videoFile?: string,
      durationSec?: number
    ) {
      try {
        const authState = await getOrInitAuthState()
        if (!authState.username || !authState.machineId) {
          console.log('[Video Export Tracking] Skipping - user not authenticated')
          return
        }

        const machineId = authState.machineId
        const username = authState.username

        // Get video file info if available
        let fileSize: number | null = null
        let exportFormat: string | null = null
        if (videoFile && fs.existsSync(videoFile)) {
          try {
            const stats = fs.statSync(videoFile)
            fileSize = stats.size
            const ext = path.extname(videoFile).toLowerCase()
            exportFormat = ext ? ext.substring(1) : null // Remove leading dot
          } catch (err) {
            console.warn('[Video Export Tracking] Failed to get file stats:', err)
          }
        }

        // Send tracking request to server
        const trackingPayload = {
          username,
          machine_id: machineId,
          status,
          error_message: errorMessage || null,
          video_duration: durationSec ? Math.round(durationSec) : null,
          file_size: fileSize,
          export_format: exportFormat,
        }

        const LICENSE_SERVER = process.env.LICENSE_SERVER_BASE || 'https://license-server.dungdong333.workers.dev'
        const response = await fetch(`${LICENSE_SERVER}/api/video/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(trackingPayload),
        })

        if (!response.ok) {
          const errorText = await response.text()
          console.warn('[Video Export Tracking] Failed to track export:', response.status, errorText)
        } else {
          console.log('[Video Export Tracking] Successfully tracked video export:', status)
        }
      } catch (error: any) {
        // Don't throw - tracking is non-blocking
        console.warn('[Video Export Tracking] Error:', error.message)
      }
    }

    // Create emitter to send events to renderer
    const emitter = {
      progress: (progressPayload: FinalExportProgressPayload) => {
        sender.send(VIDEO_FINAL_EXPORT_PROGRESS, progressPayload)
      },
      done: async (donePayload: FinalExportDonePayload) => {
        finalExportJobHandles.delete(requestId) // Cleanup khi done
        sender.send(VIDEO_FINAL_EXPORT_DONE, donePayload)
        
        // Track successful exports
        if (donePayload.outputs && donePayload.outputs.length > 0) {
          // Track each output video
          for (const output of donePayload.outputs) {
            await trackVideoExport(
              'success',
              undefined,
              output.videoFile,
              output.durationSec
            )
          }
        }
      },
      error: async (errorPayload: FinalExportErrorPayload) => {
        finalExportJobHandles.delete(requestId) // Cleanup khi error
        sender.send(VIDEO_FINAL_EXPORT_ERROR, errorPayload)
        
        // Track failed export
        await trackVideoExport(
          'failed',
          errorPayload.message || errorPayload.error
        )
      },
    }

    // Enqueue job in job queue
    const jobHandle = jobQueue.enqueue({
      type: 'video:final-export',
      payload: {
        requestId,
        audioCount: payload.audioSource?.type === 'folder' ? 0 : (payload.audioSource?.paths?.length ?? 0),
        videoCount: payload.videoSource?.type === 'folder' ? 0 : (payload.videoSource?.paths?.length ?? 0),
      },
      task: async (ctx) => {
        try {
          await exportFinalVideo(
            {
              ...payload,
              requestId: requestId || ctx.jobId,
            },
            emitter
          )
          return { success: true }
        } catch (error: any) {
          console.error('[IPC] Final export error:', error)
          emitter.error({
            requestId: requestId || ctx.jobId,
            error: error?.message || 'Xuất video thất bại.',
            message: error?.message,
          })
          throw error
        }
      },
    })

    // Lưu jobHandle để có thể cancel sau
    finalExportJobHandles.set(requestId, jobHandle)

    // Start processing (don't await, let it run in background)
    jobHandle.result.catch((err) => {
      console.error('[IPC] Final export job failed:', err)
      finalExportJobHandles.delete(requestId) // Cleanup khi failed
    })
  })

  // Cancel final export handler
  ipcMain.handle('video:final-export:cancel', async (_event, requestId: string) => {
    try {
      const jobHandle = finalExportJobHandles.get(requestId)
      if (jobHandle) {
        await jobHandle.cancel()
        finalExportJobHandles.delete(requestId)
      }
      // Kill tất cả FFmpeg processes đang chạy (vì final export chạy tuần tự, chỉ có 1 job đang chạy tại một thời điểm)
      // Nhưng để chắc chắn, cancel tất cả jobs đang chạy
      videoJobManager.cancelAll()
      // Cũng thử cancel bằng requestId cụ thể (nếu có)
      videoJobManager.cancelJob(requestId)
      return { success: true }
    } catch (err: any) {
      console.error('[IPC] Cancel final export error:', err)
      return { success: false, error: String(err) }
    }
  })

  // ============================================
  // TURBO ENGINE HANDLERS (DEPRECATED - Commented out)
  // ============================================
  // Cut single turbo (DEPRECATED)
  // ipcMain.handle('video:cutSingleTurbo', async (event, req: any) => {
  //   // Handler removed - use video:cutSingleSimple instead
  //   throw new Error('video:cutSingleTurbo is deprecated, use video:cutSingleSimple')
  // })

  // Split many turbo (DEPRECATED)
  // ipcMain.handle('video:splitManyTurbo', async (event, req: any) => {
  //   // Handler removed - use video:splitManySimple instead
  //   throw new Error('video:splitManyTurbo is deprecated, use video:splitManySimple')
  // })

  // Merge turbo (DEPRECATED)
  // ipcMain.handle('video:mergeTurbo', async (event, req: any) => {
  //   // Handler removed - use video:mergeSimple instead
  //   throw new Error('video:mergeTurbo is deprecated, use video:mergeSimple')
  // })

  // Cancel job
  ipcMain.handle('video:cancelJob', async (_event, requestId: string) => {
    try {
      videoJobManager.cancelJob(requestId)
      return { success: true }
    } catch (err) {
      console.error('[IPC] video:cancelJob error', err)
      return { success: false, error: String(err) }
    }
  })

  // Get all active video job IDs (for restore UI state)
  ipcMain.handle('video:getAllJobIds', async () => {
    try {
      return videoJobManager.getAllJobIds()
    } catch (err) {
      console.error('[IPC] video:getAllJobIds error', err)
      return []
    }
  })

  ipcMain.handle('video:getActiveMergeJobId', async () => {
    try {
      if (activeMergeRequestId && videoJobManager.hasJob(activeMergeRequestId)) {
        return activeMergeRequestId
      }
      return null
    } catch (err) {
      console.error('[IPC] video:getActiveMergeJobId error', err)
      return null
    }
  })

  // Check if video job is running
  ipcMain.handle('video:hasJob', async (_event, requestId: string) => {
    try {
      return videoJobManager.hasJob(requestId)
    } catch (err) {
      console.error('[IPC] video:hasJob error', err)
      return false
    }
  })

  // ===== Autopilot IPC =====

  onAutopilotProgress((progress: AutopilotProgress) => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('autopilot:status', progress)
      }
    }
  })

  onAutopilotLog((log) => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('autopilot:log', log)
      }
    }
  })

  ipcMain.handle('autopilot:getStatus', async () => {
    return getAutopilotProgress()
  })

  ipcMain.handle('autopilot:start', async (_event, config: AutopilotBackendConfig) => {
    try {
      await startAutopilot(config)
      return { ok: true }
    } catch (error: any) {
      console.error('[Autopilot] Failed to start:', error)
      return { ok: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('autopilot:cancel', async () => {
    cancelAutopilot()
    return { ok: true }
  })

  // Security monitoring IPC
  ipcMain.handle('security:reportAntiDebug', async (_event, details: { method: string; detected: boolean }) => {
    const { reportAntiDebugTriggered } = await import('../backend/security/securityMonitoring')
    await reportAntiDebugTriggered(details)
    return { ok: true }
  })

  // ===== SONG NHAC (Sóng nhạc) EXPORT IPC =====

  ipcMain.handle('song-nhac:export-video', async (_event, options: any) => {
    const jobId: string = options?.jobId ?? `sn-${Date.now()}`
    let frameHandler: ((_ev: any, _jobIdArg: string, frameData: Buffer) => void) | null = null
    let endHandler: (() => void) | null = null
    try {
      const { startFfmpegPipe } = await import('../backend/video/songNhacFfmpegPipe')
      const { ffmpegProc, waitForExit } = startFfmpegPipe(options)
      activeSongNhacExports.set(jobId, ffmpegProc)

      // Listen for frame data from renderer (channel: song-nhac:frame, args: jobId, buffer)
      frameHandler = (_ev: any, _jobIdArg: string, frameData: Buffer) => {
        if (ffmpegProc.stdin && !ffmpegProc.stdin.destroyed) {
          ffmpegProc.stdin.write(frameData)
        }
      }
      ipcMain.on('song-nhac:frame', frameHandler)

      // Listen for end signal — renderer calls sendExportEnd() after last frame
      const endPromise = new Promise<void>((resolve) => {
        endHandler = () => {
          if (ffmpegProc.stdin && !ffmpegProc.stdin.destroyed) {
            ffmpegProc.stdin.end()
          }
          resolve()
        }
        ipcMain.once('song-nhac:end', endHandler)
      })

      // Wait for either end signal or process exit
      await endPromise
      const result = await waitForExit()

      return { ok: true, outputPath: result.outputPath, code: result.code }
    } catch (error: any) {
      console.error('[SongNhac] Export error:', error)
      return { ok: false, error: error?.message || String(error) }
    } finally {
      // Cleanup — always remove listeners even on error/cancel
      if (frameHandler) {
        ipcMain.removeListener('song-nhac:frame', frameHandler)
      }
      if (endHandler) {
        ipcMain.removeListener('song-nhac:end', endHandler)
      }
      activeSongNhacExports.delete(jobId)
    }
  })

  ipcMain.handle('song-nhac:get-audio-duration', async (_event, filePath: string) => {
    try {
      const { runFfprobe } = await import('../backend/ffmpeg/wrapper')
      const output = await runFfprobe([
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ])
      const duration = parseFloat(output.trim())
      return { ok: true, duration: isNaN(duration) ? 0 : duration }
    } catch (error: any) {
      return { ok: false, error: error?.message }
    }
  })

  ipcMain.handle('song-nhac:read-audio-file', async (_event, filePath: string) => {
    try {
      const buffer = fs.readFileSync(filePath)
      return { ok: true, buffer }
    } catch (error: any) {
      return { ok: false, error: error?.message }
    }
  })

  ipcMain.handle('song-nhac:decode-audio-timeline', async (_event, filePath: string) => {
    try {
      const { runFfprobe } = await import('../backend/ffmpeg/wrapper')
      const output = await runFfprobe([
        '-v', 'error',
        '-show_entries', 'format=duration,bit_rate:stream=sample_rate,channels',
        '-of', 'json',
        filePath,
      ])
      const info = JSON.parse(output)
      return { ok: true, info }
    } catch (error: any) {
      return { ok: false, error: error?.message }
    }
  })

  ipcMain.handle('song-nhac:list-audio-in-folder', async (_event, folderPath: string) => {
    try {
      const audioExts = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma']
      const files = fs.readdirSync(folderPath)
        .filter(f => audioExts.includes(path.extname(f).toLowerCase()))
        .map(f => ({
          name: f,
          path: path.join(folderPath, f),
        }))
      return files
    } catch (error: any) {
      console.error('[SongNhac] listAudioInFolder error:', error)
      return []
    }
  })

  ipcMain.handle('song-nhac:cancel-export', async (_event, jobId?: string) => {
    // Kill the active FFmpeg process if tracked
    if (jobId && activeSongNhacExports.has(jobId)) {
      const proc = activeSongNhacExports.get(jobId)!
      try {
        if (!proc.killed) proc.kill('SIGTERM')
      } catch (_) {}
      activeSongNhacExports.delete(jobId)
    } else if (activeSongNhacExports.size > 0) {
      // Kill the most recent export if no jobId specified
      for (const [id, proc] of activeSongNhacExports) {
        try { if (!proc.killed) proc.kill('SIGTERM') } catch (_) {}
        activeSongNhacExports.delete(id)
        break
      }
    }
    // Also signal renderer to stop sending frames
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('song-nhac:export-cancel')
    }
    return { ok: true }
  })

  // ===== VERSION GATE =====

  ipcMain.handle('app:getVersion', async () => {
    return app.getVersion()
  })

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
      // Normalize 'latest' (electron-updater default) → 'stable' for UI consistency
      const raw = autoUpdater.channel || 'latest'
      return { ok: true, channel: raw === 'latest' ? 'stable' : raw as 'stable' | 'beta' }
    } catch {
      return { ok: true, channel: 'stable' as const }
    }
  })

  ipcMain.handle('app:setUpdateChannel', async (_event, channel: string) => {
    try {
      const { autoUpdater } = await import('electron-updater')
      // Map 'stable' → 'latest' for electron-updater
      autoUpdater.channel = channel === 'stable' ? 'latest' : channel
      // Trigger a fresh check with new channel
      autoUpdater.checkForUpdates().catch(() => {})
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as any)?.message }
    }
  })

  ipcMain.handle('policy:get', async () => {
    // Version policy — trả về default nếu không có remote check
    return {
      latest_version: app.getVersion(),
      min_supported_version: '3.6.0',
      blocked_versions: [],
      recommended_version: app.getVersion(),
      force_update: false,
      message: null,
    }
  })

}

// Global error handlers - Bắt tất cả lỗi uncaught
process.on('uncaughtException', (error) => {
  console.error('[App] UNCAUGHT EXCEPTION:', error)
  console.error('[App] Stack:', error.stack)
  // Không quit app, chỉ log để debug
  // App vẫn tiếp tục chạy để user có thể thấy lỗi
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[App] UNHANDLED REJECTION:', reason)
  console.error('[App] Promise:', promise)
  // Không quit app, chỉ log để debug
})

// Lifecycle chuẩn Electron
app.whenReady()
  .then(async () => {
    console.log('[App] Starting initialization...')
    
    // QUAN TRỌNG: Tạo window TRƯỚC để đảm bảo app luôn hiển thị, ngay cả khi có lỗi
    // Đăng ký IPC handlers trước để window có thể giao tiếp
    try {
      registerIpcHandlers()
      console.log('[App] IPC handlers registered')
    } catch (err: any) {
      console.error('[App] Failed to register IPC handlers (critical):', err?.message || err)
      // Vẫn tiếp tục tạo window
    }
    
    try {
      createWindow()
      console.log('[App] Window created')

      // Version gate: emit result to renderer after window loads
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.once('did-finish-load', () => {
          // Default: allow (no remote version policy check in this build)
          mainWindow?.webContents.send('version-gate-result', {
            status: 'allow',
          })
        })
      }
    } catch (err: any) {
      console.error('[App] Failed to create window (critical):', err?.message || err)
      // Thử tạo window đơn giản hơn
      try {
        mainWindow = new BrowserWindow({
          width: 1280,
          height: 720,
          show: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        })
        loadErrorPage(mainWindow, `Lỗi khởi động ứng dụng:\n${err?.message || String(err)}\n\nVui lòng chạy diagnostic script để kiểm tra.`)
      } catch (fallbackErr: any) {
        console.error('[App] Failed to create fallback window:', fallbackErr)
        // Cuối cùng mới quit
        app.quit()
        return
      }
    }
    
    // Các operations khác chạy trong background, không block window
    // Nếu có lỗi, chỉ log, không quit app
    
    // Kiểm tra và xóa cache khi cài đặt version mới
    try {
      await checkAndCleanCacheOnUpdate()
      console.log('[App] Cache cleanup completed')
    } catch (err: any) {
      console.error('[App] Cache cleanup failed (non-critical):', err?.message || err)
    }
    
    // Initialize security monitoring
    try {
      initSecurityMonitoring()
      console.log('[App] Security monitoring initialized')
    } catch (err: any) {
      console.error('[App] Security monitoring init failed (non-critical):', err?.message || err)
    }
    
    // Initialize tamper detection (chỉ trong production)
    try {
      initTamperDetection()
      console.log('[App] Tamper detection initialized')
    } catch (err: any) {
      console.error('[App] Tamper detection init failed (non-critical):', err?.message || err)
    }
    
    // Check environment (VM/Sandbox detection) - chạy async, không block
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
              details: {
                detected: envCheck.detected,
              },
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
    
    // Check tampering ngay khi start - chạy async, không block
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
    
    // License check - chạy async, không block
    ;(async () => {
      try {
        await refreshLicenseState(true)
        console.log('[App] License state refreshed')
      } catch (err: any) {
        console.error('[App] License refresh failed (non-critical):', err?.message || err)
      }
    })()
    
    // FFmpeg info - chạy async, không block
    logFfmpegInfo().catch((err) => {
      console.warn('[FFmpeg] Failed to log FFmpeg info (non-critical):', err)
    })
    
    // Disk info - chạy async, không block
    refreshDiskInfoAndBroadcast().catch((err) =>
      console.error('[system] Initial disk info scan failed (non-critical):', err)
    )
    
    // Refresh disk info định kỳ mỗi 30 giây
    diskInfoRefreshInterval = setInterval(() => {
      refreshDiskInfoAndBroadcast().catch((err) =>
        console.error('[system] Periodic disk info refresh failed:', err)
      )
    }, 30_000) // 30 giây

    // Periodic license check (mỗi 30 phút)
    setInterval(async () => {
      try {
        const currentState = await refreshLicenseState(true) // Force remote check
        if (currentState.status !== 'ok') {
          console.warn('[Security] License check failed during periodic check:', currentState.status)
        }
      } catch (error) {
        console.warn('[Security] Periodic license check failed:', error)
      }
    }, 30 * 60 * 1000) // 30 phút

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
    
    // Thử tạo window ngay cả khi có lỗi để user thấy được thông báo
    try {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow()
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        loadErrorPage(mainWindow, `Lỗi khởi động ứng dụng:\n${err?.message || String(err)}\n\nVui lòng chạy diagnostic script để kiểm tra.`)
      }
    } catch (windowErr) {
      console.error('[App] Failed to create error window:', windowErr)
      // Chỉ quit nếu không thể tạo window
      app.quit()
    }
  })

app.on('window-all-closed', () => {
  cleanupYouTubeHandlers()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ===== GRACEFUL SHUTDOWN — kill all background processes before quit =====
app.on('before-quit', async () => {
  // Kill any active Song Nhạc FFmpeg exports
  for (const [, proc] of activeSongNhacExports) {
    try { if (!proc.killed) proc.kill('SIGTERM') } catch (_) {}
  }
  activeSongNhacExports.clear()

  // Cancel any active autopilot jobs
  try {
    const { cancelAutopilot } = await import('../backend/autopilot/autopilotRunner')
    cancelAutopilot?.()
  } catch (_) {}
})

// ===== AUTO-UPDATER — setup event listeners once on ready =====
;(async () => {
  try {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.logger = null // Disable built-in logging (we handle it)
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    const sendStatus = (payload: Record<string, unknown>) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:status', payload)
      }
    }

    autoUpdater.on('checking-for-update', () => {
      sendStatus({ state: 'checking' })
    })
    autoUpdater.on('update-available', (info) => {
      sendStatus({ state: 'available', version: info.version })
    })
    autoUpdater.on('update-not-available', () => {
      sendStatus({ state: 'not-available' })
    })
    autoUpdater.on('download-progress', (progress) => {
      sendStatus({
        state: 'downloading',
        progress: {
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond,
        },
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      sendStatus({ state: 'downloaded', version: info.version })
    })
    autoUpdater.on('error', (err) => {
      sendStatus({ state: 'error', message: err?.message || String(err) })
    })

    // Auto-check on startup (delayed to avoid blocking window load)
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.warn('[Updater] Startup check failed (non-critical):', err?.message)
      })
    }, 10_000) // 10 giây sau khi app ready
  } catch (err) {
    console.warn('[Updater] Failed to setup autoUpdater (non-critical):', (err as any)?.message)
  }
})()

/**
 * windowManager.ts
 * Quản lý BrowserWindow chính: tạo, CSP, error page, load retry.
 * Tách từ main.ts để dễ maintain.
 */

import { app, BrowserWindow, dialog, shell } from 'electron'
import path from 'node:path'
import { setupYouTubeHandlers } from './youtube/youtubeHandlers'

const isDev = !!process.env.ELECTRON_RENDERER_URL

// Window instance được export để các handler dùng
export let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null) {
  mainWindow = win
}

let isClosingWindow = false
let forceExitTimer: ReturnType<typeof setTimeout> | null = null
const FORCE_EXIT_TIMEOUT_MS = 8_000

export function requestAppExit(): void {
  if (isClosingWindow) return
  isClosingWindow = true
  app.quit()

  // `before-quit` starts FFmpeg/job cancellation asynchronously. Do not leave
  // Electron and its ASAR locked forever if a native child or quit hook hangs.
  forceExitTimer = setTimeout(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed()) win.destroy()
      } catch {}
    }
    app.exit(0)
  }, FORCE_EXIT_TIMEOUT_MS)
  forceExitTimer.unref()
}

export function clearForcedAppExit(): void {
  if (!forceExitTimer) return
  clearTimeout(forceExitTimer)
  forceExitTimer = null
}

export const __windowManagerTestUtils = {
  resetExitState() {
    clearForcedAppExit()
    isClosingWindow = false
  },
}

// ─── Error page HTML ───────────────────────────────────────────────────────
export function loadErrorPage(window: BrowserWindow | null, errorMessage: string) {
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
    h1 { color: #fca5a5; margin-top: 0; font-size: 28px; }
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
    .actions { margin-top: 30px; }
    .action-item {
      margin: 10px 0;
      padding: 12px;
      background: #3a3a3a;
      border-radius: 6px;
    }
    .action-item strong { color: #60a5fa; }
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

// ─── Error dialog ──────────────────────────────────────────────────────────
export function showLoadErrorDialog(
  window: BrowserWindow | null,
  _code: string,
  message: string,
  error: any
) {
  if (!window || window.isDestroyed()) return

  const errorDetails = error ? (error.message || String(error)) : ''
  const fullMessage = errorDetails ? `${message}\n\nChi tiết: ${errorDetails}` : message

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
        if (result.response === 1 && window && !window.isDestroyed()) {
          window.webContents.openDevTools()
        }
      }).catch((err) => {
        console.error('[Window] Failed to show error dialog:', err)
      })
    }
  }, 500)
}

// ─── CSP builder ──────────────────────────────────────────────────────────
function buildCsp(): string {
  if (isDev) {
    return [
      "default-src 'self' app: http://localhost:*",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: http://localhost:*",
      "style-src 'self' 'unsafe-inline' http://localhost:* https://fonts.googleapis.com",
      "font-src 'self' data: http://localhost:* https://fonts.gstatic.com",
      "img-src 'self' data: blob: http://localhost:* https: app:",
      "media-src 'self' app: blob: data: file: http://localhost:*",
      "connect-src 'self' http://localhost:* ws://localhost:* https:",
      "worker-src 'self' blob:",
    ].join('; ')
  }
  return [
    "default-src 'self' app:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: app:",
    "style-src 'self' 'unsafe-inline' app: https://fonts.googleapis.com",
    "font-src 'self' data: app: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https: app:",
    "media-src 'self' app: blob: data: file:",
    "connect-src 'self' https: app:",
    "worker-src 'self' blob:",
  ].join('; ')
}

// ─── Create main window ────────────────────────────────────────────────────
export function createWindow() {
  const preloadPath = path.join(__dirname, '../preload/preload.js')

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
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: !isDev,
      allowRunningInsecureContent: isDev,
    },
  })

  const showAndFocus = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      // Surface window to the front without keeping it permanently pinned
      mainWindow.setAlwaysOnTop(true)
      mainWindow.focus()
      mainWindow.setAlwaysOnTop(false)
      console.log('[Window] Window shown and focused')
    }
  }

  // Hiển thị window khi đã sẵn sàng
  mainWindow.once('ready-to-show', () => {
    showAndFocus()
  })

  // Fallback: force show sau 2.5s thay vì đợi 5s
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn('[Window] Window not visible after 2.5s, forcing show...')
      showAndFocus()
    }
  }, 2500)

  // Forward renderer console errors to terminal
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error(`[Renderer ERROR] (${sourceId}:${line}) ${message}`)
    } else if (level === 1) {
      console.warn(`[Renderer WARN] ${message}`)
    }
  })

  // Error handling cho webContents
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 = ERR_ABORTED: the navigation was superseded (HMR reload, our own startup
    // reload, or a redirect). It is not a failure the user needs to see, and acting on
    // it dropped the error page on top of a perfectly loaded app.
    if (errorCode === -3 || isMainFrame === false) return
    console.error('[Window] Failed to load:', { errorCode, errorDescription, validatedURL })
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.webContents.send('app:load-error', {
        code: errorCode,
        description: errorDescription,
        url: validatedURL,
      })
      loadErrorPage(
        mainWindow,
        `Lỗi khi tải trang:\nCode: ${errorCode}\nMô tả: ${errorDescription}\nURL: ${validatedURL}`
      )
    }
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Window] Renderer process crashed:', { reason: details.reason, exitCode: details.exitCode })
    if (mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload()
        }
      }, 1000)
    }
  })

  mainWindow.on('close', (event) => {
    if (isClosingWindow) return
    event.preventDefault()
    dialog.showMessageBox(mainWindow!, {
      type: 'question',
      title: 'Thoát ứng dụng',
      message: 'Bạn có muốn thoát 93 Media - Tool Mix Nhạc?',
      detail: 'Nếu đang xuất media, các job đang chạy sẽ bị dừng.',
      buttons: ['Ở lại', 'Dừng export và thoát'],
      defaultId: 0,
      cancelId: 0,
    }).then((result) => {
      if (result.response === 1) requestAppExit()
    }).catch(() => {})
  })

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Window] Renderer process became unresponsive')
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Ứng Dụng Không Phản Hồi',
        message: 'Ứng dụng đang không phản hồi. Bạn có muốn đợi thêm hoặc đóng lại?',
        buttons: ['Đợi thêm', 'Đóng lại'],
        defaultId: 0,
      }).then((result) => {
        if (result.response === 1 && mainWindow && !mainWindow.isDestroyed()) {
          requestAppExit()
        }
      }).catch(() => {})
    }
  })

  mainWindow.webContents.on('responsive', () => {
    console.log('[Window] Renderer process became responsive again')
  })

  // CSP headers
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildCsp()],
      },
    })
  })

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    console.log('[Window] Loading dev URL:', process.env.ELECTRON_RENDERER_URL)
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL).catch((err) => {
      // The renderer reloads itself once on startup (WebCodecs probe) and HMR does the
      // same, which rejects this promise with ERR_ABORTED even though the page loads.
      if (String(err?.message ?? err).includes('ERR_ABORTED')) return
      console.error('[Window] Failed to load dev URL:', err)
      showLoadErrorDialog(
        mainWindow,
        'DEV_URL_ERROR',
        `Không thể tải URL dev: ${process.env.ELECTRON_RENDERER_URL}`,
        err
      )
    })
  } else {
    const indexPath = path.join(__dirname, '../../dist/index.html')

    console.log('[Window] Loading index.html from:', indexPath)
    console.log('[Window] __dirname:', __dirname)
    console.log('[Window] app.isPackaged:', app.isPackaged)

    const fileExists = fs.existsSync(indexPath)
    console.log('[Window] File exists:', fileExists)

    if (!fileExists) {
      console.error('[Window] index.html NOT FOUND at:', indexPath)
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
      showLoadErrorDialog(
        mainWindow,
        'FILE_NOT_FOUND',
        `Không tìm thấy file index.html tại:\n${indexPath}\n\nVui lòng cài đặt lại ứng dụng.`,
        null
      )
      loadErrorPage(
        mainWindow,
        `File index.html không tồn tại tại:\n${indexPath}\n\nVui lòng chạy diagnostic script để kiểm tra.`
      )
      return
    }

    // Retry logic
    let retryCount = 0
    const maxRetries = 3
    const loadFileWithRetry = async () => {
      try {
        await mainWindow!.loadFile(indexPath)
        console.log('[Window] Successfully loaded index.html')
      } catch (err: any) {
        retryCount++
        console.error(`[Window] Failed to load index.html (attempt ${retryCount}/${maxRetries}):`, err)
        if (retryCount < maxRetries) {
          console.log(`[Window] Retrying in ${1000 * retryCount}ms...`)
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount))
          return loadFileWithRetry()
        } else {
          console.error('[Window] All retry attempts failed, showing error page')
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show()
            if (!mainWindow.isVisible()) {
              mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
              mainWindow.show()
            }
          }
          showLoadErrorDialog(
            mainWindow,
            'LOAD_ERROR',
            `Không thể tải file index.html sau ${maxRetries} lần thử:\n${indexPath}\n\nLỗi: ${err?.message || String(err)}`,
            err
          )
          loadErrorPage(
            mainWindow,
            `Lỗi khi tải file index.html sau ${maxRetries} lần thử:\n\nĐường dẫn: ${indexPath}\n\nLỗi: ${err?.message || String(err)}\n\nVui lòng chạy diagnostic script để kiểm tra:\n.\\scripts\\diagnose-app.ps1`
          )
        }
      }
    }

    loadFileWithRetry().catch((err) => {
      console.error('[Window] loadFileWithRetry threw unhandled error:', err)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        loadErrorPage(mainWindow, `Lỗi nghiêm trọng khi tải ứng dụng:\n${err?.message || String(err)}`)
      }
    })
  }

  // DevTools — only in development, NEVER in production
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools()
  }
  // Security: Removed DEBUG=1 env var backdoor that allowed DevTools in production builds

  // Security: validate URL before openExternal
  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(details.url)
      } else {
        console.warn('[main] Blocked shell.openExternal for non-http(s) URL:', details.url)
      }
    } catch {
      console.warn('[main] Blocked shell.openExternal for invalid URL:', details.url)
    }
    return { action: 'deny' }
  })

  // Setup YouTube handlers
  if (mainWindow) {
    setupYouTubeHandlers(mainWindow)
  }
}

import { HashRouter } from 'react-router-dom'
import { useEffect, useState } from 'react'
import AppLayout from './AppLayout'
import Router from './router'
import ExportRunner from './features/song-nhac/export/ExportRunner'
import type { LicenseState, AuthState, VersionPolicy, VersionGateResult } from './types/ipc'
import AuthPage from './pages/Auth/AuthPage'
import { initAntiDebug, checkAntiDebug } from './security/antiDebug'
import VersionBlockingScreen from './components/VersionBlockingScreen'

// Anti-debugging (chỉ trong production)
// FIX: Moved to useEffect with cleanup to prevent memory leak

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [licenseState, setLicenseState] = useState<LicenseState | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for future error display (license UI)
  const [licenseError, setLicenseError] = useState<string | null>(null)
  const [updateInfo, setUpdateInfo] = useState<{ latestVersion: string; downloadUrl: string } | null>(null)
  // loadError is used in render, set via IPC listener from main process
  const [loadError, setLoadError] = useState<{ code: string; description: string; url?: string } | null>(null)
  // blockMessage is used to show an inline banner instead of alert() when account is blocked
  const [blockMessage, setBlockMessage] = useState<string | null>(null)
  
  // Version policy gating
  const [versionGateResult, setVersionGateResult] = useState<'allow' | 'block-old' | 'block-version' | null>(null)
  const [currentVersion, setCurrentVersion] = useState<string>('')
  const [versionPolicy, setVersionPolicy] = useState<VersionPolicy | null>(null)
  
  // FIX: Anti-debugging with cleanup (listeners + interval)
  useEffect(() => {
    if (!import.meta.env.PROD) return () => {} // Skip in dev mode

    const cleanupAntiDebug = initAntiDebug()
    const interval = setInterval(() => {
      const detected = checkAntiDebug()
      if (detected) {
        console.warn('[Security] Debugging detected')
        // Có thể thực hiện action: log, alert, exit, etc.
      }
    }, 5000) // Check mỗi 5 giây

    return () => {
      cleanupAntiDebug()
      clearInterval(interval)
    }
  }, [])

  // Version policy gating (Rule A/B/C) - FIX: Only listen to main process event, no manual check
  useEffect(() => {
    const api = window.api
    if (!api) {
      setCurrentVersion('unknown')
      // Nếu không có api, cho phép app chạy thay vì kẹt mãi
      setVersionGateResult('allow')
      return
    }
    // FIX: Get current version for display only
    api.app?.getVersion?.().then(setCurrentVersion).catch((err: unknown) => {
      console.error('[App] Failed to get version:', err)
      setCurrentVersion('unknown')
    })

    // FIX: Listen for version gate result from main process (SINGLE SOURCE OF TRUTH)
    // Main process already checked policy before creating window
    const unsubscribe = api.on?.('version-gate-result', (result: VersionGateResult) => {
      setVersionGateResult(result.status)
      // Store policy info if provided (for blocking screen)
      if (result.policy) {
        setVersionPolicy({
          latest_version: result.policy.recommended_version,
          min_supported_version: result.policy.min_supported_version,
          blocked_versions: [],
          recommended_version: result.policy.recommended_version,
          recommended_installer_url: result.policy.recommended_installer_url,
          force_update: false,
          message: result.policy.message,
        })
      }
    })

    // FIX: Timeout fallback - nếu sau 8 giây mà không nhận được version-gate-result
    // (do race condition: did-finish-load fire trước khi useEffect đăng ký listener),
    // mặc định cho phép app chạy (fail-open) thay vì kẹt mãi ở "Đang kiểm tra phiên bản..."
    const fallbackTimer = setTimeout(() => {
      setVersionGateResult((prev) => {
        if (prev === null) {
          console.warn('[App] Version gate timeout after 8s, defaulting to allow (fail-open)')
          return 'allow'
        }
        return prev
      })
    }, 8000)

    return () => {
      unsubscribe?.()
      clearTimeout(fallbackTimer)
    }
  }, [])

  // Listen for load errors from main process via IPC
  useEffect(() => {
    const api = window.api
    if (!api?.on) return
    const unsub = api.on('app:load-error', (payload: { code: string; description: string; url?: string }) => {
      setLoadError(payload)
    })
    return () => { unsub?.() }
  }, [])

  useEffect(() => {
    let cancelled = false
    const checkAuth = async () => {
      try {
        if (typeof window === 'undefined' || !window.api?.auth?.getState) {
          setIsAuthenticated(false)
          return
        }

        // V2: Try auto-login with token first
        if (window.api?.auth?.validateToken) {
          try {
            const tokenResult = await window.api.auth.validateToken()
            if (tokenResult.valid && tokenResult.username) {
              if (!cancelled) {
                setIsAuthenticated(true)
                return
              }
            } else if (tokenResult.action === 'BLOCKED') {
              // V2: Account blocked due to tampering
              if (!cancelled) {
                setIsAuthenticated(false)
                return
              }
            } else if (tokenResult.action === 'SUSPICIOUS') {
              // SEC-03 fix: SUSPICIOUS should NOT silently grant access.
              // Deny login and show a warning — do not allow bypass of license protection.
              if (!cancelled) {
                setIsAuthenticated(false)
                return
              }
            }
          } catch (err) {
            // Token validation failed, fall back to state check
            void err
          }
        }

        // Fallback: Check auth state
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Auth check timeout')), 5000)
        })

        const authState: AuthState = await Promise.race([
          window.api.auth.getState(),
          timeoutPromise,
        ])

        if (!cancelled) {
          // Nếu đã đăng nhập và được phép (allowed) → vào app
          setIsAuthenticated(authState.status === 'allowed')
        }
      } catch (err) {
        if (!cancelled) {
          setIsAuthenticated(false)
        }
        void err
      }
    }
    void checkAuth()
    return () => {
      cancelled = true
    }
  }, [])

  // Tự động kiểm tra lại trạng thái tài khoản trong khi đang sử dụng tool.
  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    let timer: any

    const checkAuth = async () => {
      try {
        if (typeof window === 'undefined' || !window.api?.auth?.refresh) return
        const next: AuthState = await window.api.auth.refresh()
        if (cancelled) return
        if (next.status === 'blocked') {
          // Nếu tài khoản / máy bị chặn từ xa → tự logout về màn hình đăng ký / đăng nhập
          // MED-03 fix: replace alert() with inline banner message
          setBlockMessage('Tài khoản hoặc máy này đã bị admin chặn quyền sử dụng. Bạn sẽ được đưa về màn hình đăng ký.')
          setIsAuthenticated(false)
        }
        // Kiểm tra có bản mới không
        if (next.latestVersion && next.downloadUrl) {
          setUpdateInfo({ latestVersion: next.latestVersion, downloadUrl: next.downloadUrl })
        } else {
          setUpdateInfo(null)
        }
      } catch (err) {
        console.warn('[App] auto auth check failed:', err)
      } finally {
        if (!cancelled) {
          timer = setTimeout(checkAuth, 300_000) // kiểm tra lại mỗi 5 phút
        }
      }
    }

    void checkAuth()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [isAuthenticated])

  // Tạm thời vẫn giữ logic load license (phục vụ future), nhưng KHÔNG chặn giao diện đăng ký / đăng nhập.
  useEffect(() => {
    let mounted = true
    const init = async () => {
      if (typeof window === 'undefined') return
      if (!window.api?.license?.getState) return
      try {
        setLicenseError(null)
        const state = await window.api.license.getState()
        if (mounted) {
          setLicenseState(state)
        }
      } catch (error: any) {
        console.error('[App] Failed to load license state:', error)
        if (mounted) {
          setLicenseError(error?.message ?? 'Không thể kiểm tra license')
        }
      }
    }
    void init()
    return () => {
      mounted = false
    }
  }, [])

  // Offscreen export window: chỉ render ExportRunner, không auth/layout
  if (typeof window !== 'undefined' && window.location.hash === '#export') {
    return <ExportRunner />
  }

  // Hiển thị lỗi load nếu có
  if (loadError) {
    return (
      <div style={{ 
        padding: '40px', 
        color: '#ef4444', 
        fontFamily: 'system-ui, sans-serif', 
        backgroundColor: '#1e1e1e',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px'
      }}>
        <h1 style={{ fontSize: '24px', margin: 0 }}>Lỗi khi tải ứng dụng</h1>
        <div style={{ 
          backgroundColor: '#2a2a2a', 
          padding: '20px', 
          borderRadius: '8px',
          maxWidth: '600px',
          width: '100%'
        }}>
          <p><strong>Mã lỗi:</strong> {loadError.code}</p>
          <p><strong>Mô tả:</strong> {loadError.description}</p>
          {loadError.url && <p><strong>URL:</strong> {loadError.url}</p>}
        </div>
        <p style={{ color: '#9ca3af', fontSize: '14px' }}>
          Vui lòng kiểm tra DevTools (F12) để xem chi tiết lỗi hoặc liên hệ admin.
        </p>
      </div>
    )
  }
  
  // Kiểm tra window.api
  if (typeof window !== 'undefined' && !window.api) {
    return (
      <div style={{ 
        padding: '40px', 
        color: '#ef4444', 
        fontFamily: 'system-ui, sans-serif', 
        backgroundColor: '#1e1e1e',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px'
      }}>
        <h1 style={{ fontSize: '24px', margin: 0 }}>Lỗi: window.api không khả dụng</h1>
        <div style={{ 
          backgroundColor: '#2a2a2a', 
          padding: '20px', 
          borderRadius: '8px',
          maxWidth: '600px',
          width: '100%'
        }}>
          <p>Preload script có thể chưa được tải đúng cách.</p>
          <p style={{ marginTop: '10px', color: '#9ca3af' }}>
            Vui lòng kiểm tra DevTools (F12) để xem chi tiết lỗi.
          </p>
        </div>
      </div>
    )
  }

  try {
    // Bước 1: chờ đọc trạng thái đăng nhập từ persistent storage
    if (isAuthenticated === null) {
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            backgroundColor: '#111827',
            color: '#f9fafb',
            fontFamily: '"Segoe UI", sans-serif',
          }}
        >
          <div>Đang khởi tạo...</div>
        </div>
      )
    }

    // Bước 2: nếu chưa authenticated → vào thẳng trang ĐĂNG KÝ / ĐĂNG NHẬP tài khoản
    if (!isAuthenticated) {
      return (
        <>
          {blockMessage && (
            <div style={{
              background: '#ef4444',
              color: '#ffffff',
              padding: '12px 20px',
              textAlign: 'center',
              fontWeight: 600,
              fontSize: 14,
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 9999,
            }}>
              {blockMessage}
              <button
                onClick={() => setBlockMessage(null)}
                style={{ marginLeft: 12, background: 'transparent', border: '1px solid #fff', color: '#fff', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          )}
          <AuthPage
            onLoggedIn={() => {
              setBlockMessage(null)
              setIsAuthenticated(true)
            }}
          />
        </>
      )
    }

    // Version gate check (Rule A/B) - show blocking screen
    if (versionGateResult === 'block-old' || versionGateResult === 'block-version') {
      if (!versionPolicy || !currentVersion) {
        // Still loading policy/version
        return (
          <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#e2e8f0' }}>
            <div>Đang kiểm tra phiên bản...</div>
          </div>
        )
      }
      
      return (
        <VersionBlockingScreen
          rule={versionGateResult}
          currentVersion={currentVersion}
          policy={versionPolicy}
          onUpdate={() => {
            // Update check will be handled by updater
          }}
          onExit={() => {
            window.close()
          }}
        />
      )
    }
    
    // Rule C: Allow app (or still checking)
    if (versionGateResult !== 'allow') {
      // Still checking version gate
      return (
        <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#e2e8f0' }}>
          <div>Đang kiểm tra phiên bản...</div>
        </div>
      )
    }

    // Bước 3: đã authenticated → vào app chính
    return (
      <HashRouter>
        <AppLayout>
          {licenseState?.status === 'offline' && (
            <div
              style={{
                background: '#fbbf24',
                color: '#1f2937',
                padding: '8px 16px',
                textAlign: 'center',
                fontWeight: 600,
              }}
            >
              Đang chạy ở chế độ offline (chưa kiểm tra được license). Hãy kết nối mạng để xác thực lại.
            </div>
          )}
          {updateInfo && updateInfo.downloadUrl && (
            <div
              style={{
                background: '#3b82f6',
                color: '#ffffff',
                padding: '12px 16px',
                textAlign: 'center',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
              }}
            >
              <span>Đã có bản mới {updateInfo.latestVersion}. Vui lòng cập nhật để tiếp tục sử dụng.</span>
              <a
                href={updateInfo.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  background: '#ffffff',
                  color: '#3b82f6',
                  padding: '6px 16px',
                  borderRadius: '4px',
                  textDecoration: 'none',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                onClick={(e) => {
                  e.preventDefault()
                  if (updateInfo.downloadUrl) {
                    window.open(updateInfo.downloadUrl, '_blank')
                  }
                }}
              >
                Tải ngay
              </a>
            </div>
          )}
          {updateInfo && !updateInfo.downloadUrl && (
            <div
              style={{
                background: '#f59e0b',
                color: '#ffffff',
                padding: '12px 16px',
                textAlign: 'center',
                fontWeight: 600,
              }}
            >
              Đã có bản mới {updateInfo.latestVersion}. Vui lòng liên hệ admin để nhận bản cập nhật.
            </div>
          )}
          <Router />
        </AppLayout>
      </HashRouter>
    )
  } catch (error) {
    console.error('[App] Render error:', error)
    return (
      <div style={{ padding: '20px', color: 'red', fontFamily: 'monospace', backgroundColor: '#1e1e1e' }}>
        <h1>Error rendering app</h1>
        <pre>{error instanceof Error ? error.message : String(error)}</pre>
      </div>
    )
  }
}

export default App




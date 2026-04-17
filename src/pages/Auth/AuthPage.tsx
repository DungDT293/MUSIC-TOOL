import React, { useEffect, useState } from 'react'
import type { IPCAPI } from '../../types/ipc'

type AuthStatus = 'unregistered' | 'pending' | 'allowed' | 'blocked' | 'error'

export interface AuthState {
  status: AuthStatus
  username?: string
  machineId: string
  activationKey?: string
  message?: string
  preferredView?: 'register' | 'login'
}

interface RegisterPayload {
  username: string
  password: string
  note?: string
}

interface LoginPayload {
  username: string
  password: string
  remember: boolean
}

declare global {
  interface Window {
    api: IPCAPI
  }
}

interface AuthPageProps {
  onLoggedIn: () => void
}

const AuthPage: React.FC<AuthPageProps> = ({ onLoggedIn }) => {
  const [authState, setAuthState] = useState<AuthState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // form đăng ký
  const [regUsername, setRegUsername] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [showRegPassword, setShowRegPassword] = useState(false)
  const [passwordValidation, setPasswordValidation] = useState<{
    valid: boolean
    strength: 'weak' | 'medium' | 'strong'
    errors: string[]
  } | null>(null)

  // form đăng nhập
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [rememberLogin, setRememberLogin] = useState(true)

  // V2: Key input form
  const [keyInput, setKeyInput] = useState('')
  const [keyAttempts, setKeyAttempts] = useState<number | null>(null)
  const [keyLocked, setKeyLocked] = useState(false)
  const [readyForActivationKey, setReadyForActivationKey] = useState(false)

  // Chế độ hiển thị chính: Đăng ký / Đăng nhập
  const [viewMode, setViewMode] = useState<'register' | 'login'>('register')

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        if (typeof window === 'undefined' || !window.api?.auth) {
          setError('API đăng ký/đăng nhập chưa sẵn sàng.')
          return
        }
        const state: AuthState = await window.api.auth.getState()
        if (!cancelled) {
          setAuthState(state)
          setError(null)
          if (state.username) {
            setLoginUsername((prev) => prev || state.username || '')
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Không lấy được trạng thái đăng ký.')
        }
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [])

  // Tự động chọn tab phù hợp theo trạng thái hiện tại
  useEffect(() => {
    if (!authState) return
    if (authState.preferredView) {
      setViewMode(authState.preferredView)
      return
    }
    if (authState.status === 'allowed') {
      setViewMode('login')
    } else if (authState.status === 'unregistered') {
      setViewMode('register')
    }
    // Khi status là 'pending', giữ nguyên viewMode hiện tại để hiển thị confirmation message
    // Không tự động chuyển sang login
  }, [authState])

  useEffect(() => {
    if (authState?.status !== 'pending' || !authState?.username) {
      setReadyForActivationKey(false)
      setKeyLocked(false)
      setKeyAttempts(null)
    }
  }, [authState?.status, authState?.username])

  // Tự động check status khi vào tab login và status là 'pending'
  useEffect(() => {
    if (viewMode === 'login' && authState?.status === 'pending' && authState?.username) {
      // Tự động check status từ server để phát hiện khi admin approve
      const checkStatus = async () => {
        if (!window.api?.auth?.checkStatus) return
        try {
          const result = await window.api.auth.checkStatus({ username: authState.username! })
          if (result.status === 'approved') {
            setReadyForActivationKey(true)
            setAuthState((prev) => (prev ? { ...prev, status: 'pending' as const, message: result.message } : prev))
          } else {
            setReadyForActivationKey(false)
            if (result.message) {
              setAuthState((prev) => (prev ? { ...prev, message: result.message } : prev))
            }
          }
        } catch (e) {
          // Ignore errors, user can manually refresh
          console.log('[AuthPage] Auto check status failed:', e)
        }
      }
      void checkStatus()
    }
  }, [viewMode, authState?.status, authState?.username])

  const handleRegister = async () => {
    // FIX M-01: Prevent duplicate IPC calls on spam-click (React batching race)
    if (loading) return
    if (!regUsername || !regPassword) {
      setError('Vui lòng nhập đầy đủ tài khoản và mật khẩu.')
      return
    }

    // Validate password strength — import from shared/ (SEC-02: never import backend/ in renderer)
    const { validatePasswordStrength } = await import('../../../shared/passwordValidator')
    const validation = validatePasswordStrength(regPassword)
    setPasswordValidation(validation)
    
    if (!validation.valid) {
      setError('Mật khẩu không đủ mạnh. Vui lòng kiểm tra các yêu cầu bên dưới.')
      return
    }

    if (!window.api?.auth?.register) {
      setError('API đăng ký chưa sẵn sàng.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const state: AuthState = await window.api.auth.register({
        username: regUsername.trim(),
        password: regPassword,
      } as RegisterPayload)
      setAuthState(state)
      setReadyForActivationKey(false)
      
      // Nếu registration thành công (status = 'pending'), giữ lại tài khoản và mật khẩu
      // để sau khi admin duyệt và user nhập đúng key thì điền sẵn vào form đăng nhập
      if (state.status === 'pending') {
        // Không clear regUsername/regPassword — dùng khi user nhập key xong để pre-fill login
        // Giữ nguyên viewMode để hiển thị confirmation message
      }
    } catch (e: any) {
      setError(e?.message || 'Gửi yêu cầu đăng ký thất bại.')
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    if (!window.api?.auth?.refresh) {
      setError('API kiểm tra trạng thái chưa sẵn sàng.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const state: AuthState = await window.api.auth.refresh()
      setAuthState(state)
      if (state.status !== 'pending') {
        setReadyForActivationKey(false)
      }
    } catch (e: any) {
      setError(e?.message || 'Không kiểm tra được trạng thái.')
    } finally {
      setLoading(false)
    }
  }

  // V2: Check registration status
  const handleCheckStatus = async () => {
    if (!authState?.username) {
      setError('Không có tên tài khoản để kiểm tra.')
      return
    }
    if (!window.api?.auth?.checkStatus) {
      setError('API kiểm tra trạng thái chưa sẵn sàng.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.auth.checkStatus({ username: authState.username! })
      if (result.status === 'approved') {
        setReadyForActivationKey(true)
        setAuthState((prev) => 
          prev 
            ? { ...prev, status: 'pending' as const, message: result.message } 
            : prev
        )
      } else {
        setReadyForActivationKey(false)
        setAuthState((prev) => (prev ? { ...prev, message: result.message } : prev))
      }
    } catch (e: any) {
      setError(e?.message || 'Không kiểm tra được trạng thái.')
    } finally {
      setLoading(false)
    }
  }

  // V2: Validate key
  const handleValidateKey = async () => {
    if (!keyInput.trim()) {
      setError('Vui lòng nhập key kích hoạt.')
      return
    }
    if (!readyForActivationKey) {
      setError('Tài khoản chưa được duyệt hoặc app chưa nhận xác nhận mới. Hãy bấm "Kiểm tra lại".')
      return
    }
    if (!authState?.username) {
      setError('Không có tên tài khoản.')
      return
    }
    if (!window.api?.auth?.validateKey) {
      setError('API xác thực key chưa sẵn sàng.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.auth.validateKey({
        username: authState.username!,
        key: keyInput.trim(),
      })

      if (result.valid && result.device_token) {
        // Key validated successfully - tokens are saved automatically
        setAuthState((prev) =>
          prev
            ? {
                ...prev,
                status: 'allowed' as const,
                message: 'Key đã được xác thực thành công. Đã chuyển sang đăng nhập và điền sẵn tài khoản, mật khẩu — bấm Đăng nhập để vào.',
              }
            : prev
        )
        setKeyInput('')
        setKeyAttempts(null)
        setKeyLocked(false)
        setReadyForActivationKey(false)
        // Chuyển sang tab đăng nhập và điền sẵn tài khoản + mật khẩu đã đăng ký
        setLoginUsername(authState.username!)
        setLoginPassword(regPassword)
        setViewMode('login')
        // Clear form đăng ký sau khi đã dùng để pre-fill
        setRegUsername('')
        setRegPassword('')
        setPasswordValidation({ valid: false, strength: 'weak', errors: [] })
      } else {
        // Key validation failed
        // V2: Handle tamper detection response
        if ((result as any).action === 'BLOCKED') {
          setError(
            (result as any).message ||
              'Tài khoản đã bị chặn do phát hiện can thiệp hệ thống. Vui lòng liên hệ admin.'
          )
          setKeyLocked(true)
        } else if ((result as any).action === 'SUSPICIOUS') {
          setError(
            `Cảnh báo: Phát hiện can thiệp hệ thống (${(result as any).tamperCount || 0} lần). ${
              result.message || 'Key chỉ hoạt động trên máy đã đăng ký.'
            }`
          )
        } else {
          setError(result.message || 'Key không đúng.')
        }

        if (result.attempts !== undefined) {
          setKeyAttempts(result.attempts)
        }
        if (result.locked) {
          setKeyLocked(true)
          setError('Key đã bị khóa sau 5 lần thử sai. Vui lòng liên hệ admin để mở khóa.')
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Lỗi khi xác thực key.')
    } finally {
      setLoading(false)
    }
  }

  const handleClear = async () => {
    if (!window.api?.auth?.clear) {
      setError('API xóa đăng ký chưa sẵn sàng.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await window.api.auth.clear()
      setAuthState((prev) =>
        prev
          ? {
              status: 'unregistered',
              machineId: prev.machineId,
              message: 'Đăng ký lại với tài khoản mới.',
            }
          : prev
      )
      setReadyForActivationKey(false)
      setKeyInput('')
      setKeyAttempts(null)
      setKeyLocked(false)
      setRegUsername('')
      setRegPassword('')
    } catch (e: any) {
      setError(e?.message || 'Không xóa được đăng ký hiện tại.')
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async () => {
    // FIX M-01: Prevent duplicate IPC calls on spam-click (React batching race)
    if (loading) return
    if (!loginUsername || !loginPassword) {
      setError('Vui lòng nhập tài khoản và mật khẩu.')
      return
    }
    if (!window.api?.auth?.login) {
      setError('API đăng nhập chưa sẵn sàng.')
      return
    }

    // V2: Rate limiting is handled server-side, no need for client-side check
    setLoading(true)
    setError(null)
    try {
      const res: { ok: boolean; message?: string } = await window.api.auth.login({
        username: loginUsername.trim(),
        password: loginPassword,
        remember: rememberLogin,
      } as LoginPayload)
      if (res.ok) {
        onLoggedIn()
      } else {
        // V2: Handle tamper detection response
        const response = res as any
        if (response.action === 'BLOCKED') {
          setError(
            response.error ||
              'Tài khoản đã bị chặn do phát hiện can thiệp hệ thống. Vui lòng liên hệ admin.'
          )
        } else if (response.action === 'SUSPICIOUS') {
          setError(
            `Cảnh báo: Phát hiện can thiệp hệ thống (${response.tamperCount || 0} lần). ${
              response.error || response.message || 'Đăng nhập thất bại.'
            }`
          )
        } else {
          setError(res.message || 'Đăng nhập thất bại.')
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Lỗi khi đăng nhập.')
    } finally {
      setLoading(false)
    }
  }

  if (!authState) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#020617',
          color: '#e5e7eb',
          fontFamily: '"Segoe UI", system-ui, sans-serif',
        }}
      >
        Đang tải thông tin đăng ký...
      </div>
    )
  }

  const headerAccount =
    authState.status === 'allowed'
      ? `${authState.username || 'Tài khoản'} - ĐÃ KÍCH HOẠT`
      : authState.status === 'pending'
      ? `${authState.username || 'Tài khoản'} - ${readyForActivationKey ? 'CHỜ NHẬP KEY' : 'ĐANG CHỜ DUYỆT'}`
      : authState.status === 'blocked'
      ? `${authState.username || 'Tài khoản'} - BỊ CHẶN`
      : ''

  // V2: Check if user needs to enter key (approved but not activated)
  const needsKeyInput = authState.status === 'pending' && authState.username && readyForActivationKey

  // Cho phép user quay lại tab đăng nhập để thử lại sau khi admin mở khóa/mở lại quyền.
  // Quyền truy cập thực tế vẫn do server kiểm tra ở bước login/validate-token.
  const canLogin = true
  const shouldShowLoginForm =
    viewMode === 'login' &&
    (authState.status === 'allowed' || authState.status === 'unregistered' || authState.status === 'blocked')
  const loginTitle =
    authState.status === 'blocked'
      ? 'Thử đăng nhập lại'
      : authState.status === 'unregistered'
        ? 'Đăng nhập lại'
        : 'Đăng nhập'
  const loginTitleColor = authState.status === 'blocked' ? '#f97373' : authState.status === 'unregistered' ? '#f97316' : '#38bdf8'
  const loginDescription =
    authState.status === 'allowed'
      ? 'Máy và tài khoản này đã được kích hoạt. Vui lòng đăng nhập để sử dụng tool.'
      : authState.status === 'blocked'
        ? 'Nếu admin đã mở lại quyền hoặc bỏ chặn tài khoản, hãy thử đăng nhập lại. Quyền truy cập thực tế sẽ được server kiểm tra khi bạn đăng nhập.'
        : authState.message?.includes('đăng nhập lại') || authState.message?.includes('không còn phiên đăng nhập cũ')
          ? 'Máy này đã từng dùng app nhưng phiên cũ không còn khả dụng. Nếu tài khoản vẫn được admin cho phép, hãy đăng nhập lại để tiếp tục sử dụng.'
          : 'Máy này chưa có phiên đăng nhập khả dụng trên máy hiện tại. Nếu đã được admin duyệt trước đó, hãy thử đăng nhập lại. Nếu chưa có quyền, hãy chuyển sang tab Đăng ký để gửi yêu cầu mới.'
  const loginMessageColor = authState.status === 'blocked' ? '#fecaca' : '#cbd5f5'

  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(135deg, #020617, #0f172a)',
        color: '#e5e7eb',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
      }}
    >
      {/* Thanh tiêu đề trên cùng */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 20px',
          borderBottom: '1px solid rgba(148,163,184,0.35)',
          background: 'rgba(15,23,42,0.9)',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14 }}>93 Media - Tool Mix Nhạc</div>
        {headerAccount && (
          <div style={{ fontSize: 12, textAlign: 'right' }}>
            <div>{headerAccount}</div>
            {/* V2: KHÔNG hiển thị key - chỉ hiển thị trạng thái */}
            {authState.status === 'allowed' && (
              <div style={{ fontSize: 10, color: '#22c55e', marginTop: 2 }}>
                Đã kích hoạt
              </div>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 480,
            background: '#020617',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 20px 80px rgba(15,23,42,0.7)',
            border: '1px solid rgba(148,163,184,0.35)',
          }}
        >
          {/* Tabs Đăng ký / Đăng nhập */}
          <div
            style={{
              display: 'flex',
              marginBottom: 16,
              padding: 4,
              borderRadius: 999,
              background: '#020617',
              border: '1px solid rgba(148,163,184,0.4)',
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode('register')}
              style={{
                flex: 1,
                padding: '8px 0',
                borderRadius: 999,
                border: 'none',
                background: viewMode === 'register' ? '#0ea5e9' : 'transparent',
                color: viewMode === 'register' ? '#0f172a' : '#e5e7eb',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Đăng ký
            </button>
            <button
              type="button"
              disabled={!canLogin}
              title={undefined}
              onClick={async () => {
                if (!canLogin) return
                setViewMode('login')
                // Nếu status là 'pending' và có username, tự động check status từ server
                if (authState?.status === 'pending' && authState?.username && window.api?.auth?.checkStatus) {
                  try {
                    const result = await window.api.auth.checkStatus({ username: authState.username })
                    if (result.status === 'approved') {
                      setReadyForActivationKey(true)
                      setAuthState((prev) => (prev ? { ...prev, status: 'pending' as const, message: result.message } : prev))
                    } else {
                      setReadyForActivationKey(false)
                    }
                  } catch (e) {
                    // Ignore errors
                    console.log('[AuthPage] Check status failed:', e)
                  }
                }
              }}
              style={{
                flex: 1,
                padding: '8px 0',
                borderRadius: 999,
                border: 'none',
                background: viewMode === 'login' ? '#0ea5e9' : 'transparent',
                color: !canLogin
                  ? '#6b7280'
                  : viewMode === 'login'
                    ? '#0f172a'
                    : '#e5e7eb',
                fontSize: 13,
                fontWeight: 600,
                cursor: canLogin ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s',
                opacity: canLogin ? 1 : 0.6,
              }}
            >
              Đã có tài khoản? Đăng nhập
            </button>
          </div>

          {/* NỘI DUNG: ĐĂNG KÝ LẦN ĐẦU */}
          {authState.status === 'unregistered' && viewMode === 'register' && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: '#38bdf8' }}>
                Đăng ký tài khoản lần đầu
              </h2>
              <p style={{ fontSize: 14, color: '#cbd5f5', marginBottom: 16, lineHeight: 1.5 }}>
                Nhập tài khoản và mật khẩu bạn muốn dùng. Yêu cầu sẽ được gửi cho admin để cấp quyền
                sử dụng trên máy này.
              </p>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Tài khoản</label>
                <input
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(148,163,184,0.5)',
                    background: '#020617',
                    color: '#e5e7eb',
                    fontSize: 14,
                  }}
                  value={regUsername}
                  onChange={(e) => setRegUsername(e.target.value)}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Mật khẩu</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type={showRegPassword ? 'text' : 'password'}
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(148,163,184,0.5)',
                      background: '#020617',
                      color: '#e5e7eb',
                      fontSize: 14,
                    }}
                    value={regPassword}
                    onChange={async (e) => {
                      setRegPassword(e.target.value)
                      if (e.target.value) {
                        // FIX M3: Import from shared/ (not backend/) — renderer must NEVER import backend modules.
                        // backend/auth/passwordValidator is a Node.js module that may use crypto, fs, etc.
                        // shared/passwordValidator is the isomorphic version safe for both renderer and backend.
                        const { validatePasswordStrength } = await import('../../../shared/passwordValidator')
                        setPasswordValidation(validatePasswordStrength(e.target.value))
                      } else {
                        setPasswordValidation(null)
                      }
                    }}
                  />
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showRegPassword}
                      onChange={(e) => setShowRegPassword(e.target.checked)}
                    />
                    <span>Hiện</span>
                  </label>
                </div>
                {passwordValidation && (
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    <div style={{ color: passwordValidation.valid ? '#22c55e' : '#f87171', marginBottom: 4 }}>
                      Độ mạnh: {passwordValidation.strength === 'strong' ? 'Mạnh' : passwordValidation.strength === 'medium' ? 'Trung bình' : 'Yếu'}
                    </div>
                    {passwordValidation.errors.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 20, color: '#f87171' }}>
                        {passwordValidation.errors.map((err, idx) => (
                          <li key={idx}>{err}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 12, fontSize: 12, color: '#e5e7eb' }}>
                <div>Mã máy: {authState.machineId}</div>
                <div>Key kích hoạt: Chưa có (sẽ được tạo sau khi admin cấp quyền)</div>
              </div>

              {error && (
                <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>
              )}
              {authState.message && (
                <div style={{ color: '#cbd5f5', fontSize: 12, marginBottom: 8 }}>
                  {authState.message}
                </div>
              )}

              <button
                disabled={loading}
                onClick={handleRegister}
                style={{
                  width: '100%',
                  marginTop: 4,
                  padding: '11px 16px',
                  borderRadius: 10,
                  border: 'none',
                  background: loading ? '#0ea5e999' : '#0ea5e9',
                  color: '#fff',
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Đang gửi...' : 'Gửi yêu cầu đăng ký'}
              </button>
            </>
          )}


          {/* NỘI DUNG: ĐANG CHỜ DUYỆT (không phụ thuộc tab) */}
          {authState.status === 'pending' && !needsKeyInput && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: '#22c55e' }}>
                Đăng ký thành công!
              </h2>
              <p style={{ fontSize: 14, color: '#cbd5f5', marginBottom: 16, lineHeight: 1.5 }}>
                Tài khoản và mã máy của bạn đã được gửi cho admin. Vui lòng chờ phê duyệt để sử dụng
                tool.
              </p>

              <div style={{ 
                marginBottom: 16, 
                padding: 12, 
                borderRadius: 8, 
                background: 'rgba(34, 197, 94, 0.1)', 
                border: '1px solid rgba(34, 197, 94, 0.3)',
                fontSize: 12, 
                color: '#e5e7eb' 
              }}>
                <div style={{ marginBottom: 4, fontWeight: 600, color: '#22c55e' }}>Thông tin đã gửi:</div>
                <div>Tài khoản: <strong>{authState.username || '(chưa rõ)'}</strong></div>
                <div>Mã máy: <strong style={{ fontFamily: 'monospace' }}>{authState.machineId}</strong></div>
              </div>

              {error && (
                <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>
              )}
              {authState.message && (
                <div style={{ 
                  color: '#22c55e', 
                  fontSize: 13, 
                  marginBottom: 12,
                  padding: 10,
                  borderRadius: 8,
                  background: 'rgba(34, 197, 94, 0.1)',
                  border: '1px solid rgba(34, 197, 94, 0.3)'
                }}>
                  {authState.message}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button
                  disabled={loading}
                  onClick={handleCheckStatus}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: 'none',
                    background: loading ? '#0ea5e999' : '#0ea5e9',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loading ? 'Đang kiểm tra...' : 'Kiểm tra lại'}
                </button>
                <button
                  disabled={loading}
                  onClick={handleClear}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(148,163,184,0.6)',
                    background: 'transparent',
                    color: '#e5e7eb',
                    fontSize: 14,
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Đăng ký tài khoản khác
                </button>
              </div>
            </>
          )}

          {/* V2: KEY INPUT VIEW (sau khi được approve) */}
          {authState.status === 'pending' && needsKeyInput && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: '#38bdf8' }}>
                Nhập key kích hoạt
              </h2>
              <p style={{ fontSize: 14, color: '#cbd5f5', marginBottom: 16, lineHeight: 1.5 }}>
                Admin đã duyệt tài khoản của bạn. Vui lòng nhập key kích hoạt (lấy từ admin) để hoàn
                tất kích hoạt.
              </p>

              <div style={{ marginBottom: 12, fontSize: 12, color: '#e5e7eb' }}>
                <div>Tài khoản: {authState.username || '(chưa rõ)'}</div>
                <div>Mã máy: {authState.machineId}</div>
              </div>

              {keyAttempts !== null && keyAttempts > 0 && !keyLocked && (
                <div style={{ marginBottom: 12, fontSize: 12, color: '#fbbf24' }}>
                  Số lần thử: {keyAttempts}/5
                </div>
              )}

              {keyLocked && (
                <div style={{ marginBottom: 12, fontSize: 13, color: '#f87171' }}>
                  Key đã bị khóa sau 5 lần thử sai. Vui lòng liên hệ admin để mở khóa.
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
                  Key kích hoạt
                </label>
                <input
                  disabled={keyLocked || loading}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(148,163,184,0.5)',
                    background: keyLocked ? '#1e293b' : '#020617',
                    color: '#e5e7eb',
                    fontSize: 14,
                    opacity: keyLocked ? 0.6 : 1,
                  }}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !keyLocked && !loading) {
                      handleValidateKey()
                    }
                  }}
                  placeholder="Nhập key từ admin"
                />
              </div>

              {error && (
                <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>
              )}
              {authState.message && (
                <div style={{ color: '#cbd5f5', fontSize: 12, marginBottom: 8 }}>
                  {authState.message}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button
                  disabled={loading || keyLocked}
                  onClick={handleValidateKey}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: 'none',
                    background: loading || keyLocked ? '#0ea5e999' : '#0ea5e9',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: loading || keyLocked ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loading ? 'Đang xác thực...' : 'Xác nhận'}
                </button>
                <button
                  disabled={loading}
                  onClick={handleCheckStatus}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(148,163,184,0.6)',
                    background: 'transparent',
                    color: '#e5e7eb',
                    fontSize: 14,
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Kiểm tra lại
                </button>
              </div>
            </>
          )}

          {/* NỘI DUNG: FORM ĐĂNG NHẬP cho máy đã kích hoạt / mất phiên / vừa được mở lại */}
          {shouldShowLoginForm && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: loginTitleColor }}>
                {loginTitle}
              </h2>
              <p style={{ fontSize: 14, color: '#cbd5f5', marginBottom: 16, lineHeight: 1.5 }}>
                {loginDescription}
              </p>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Tài khoản</label>
                <input
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(148,163,184,0.5)',
                    background: '#020617',
                    color: '#e5e7eb',
                    fontSize: 14,
                  }}
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Mật khẩu</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(148,163,184,0.5)',
                      background: '#020617',
                      color: '#e5e7eb',
                      fontSize: 14,
                    }}
                    type={showLoginPassword ? 'text' : 'password'}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showLoginPassword}
                      onChange={(e) => setShowLoginPassword(e.target.checked)}
                    />
                    <span>Hiện mật khẩu</span>
                  </label>
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    userSelect: 'none',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={rememberLogin}
                    onChange={(e) => setRememberLogin(e.target.checked)}
                  />
                  <span>Lưu đăng nhập cho lần sau</span>
                </label>
              </div>

              <div style={{ marginBottom: 12, fontSize: 12, color: '#e5e7eb' }}>
                {authState.username && <div>Tài khoản hiện tại: {authState.username}</div>}
                <div>Mã máy: {authState.machineId}</div>
              </div>

              {error && (
                <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>
              )}
              {authState.message && (
                <div style={{ color: loginMessageColor, fontSize: 12, marginBottom: 8 }}>
                  {authState.message}
                </div>
              )}

              <button
                disabled={loading}
                onClick={handleLogin}
                style={{
                  width: '100%',
                  marginTop: 4,
                  padding: '11px 16px',
                  borderRadius: 10,
                  border: 'none',
                  background: loading ? '#0ea5e999' : '#0ea5e9',
                  color: '#fff',
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
              </button>
            </>
          )}

          {/* MÁY ĐÃ KÍCH HOẠT nhưng người dùng chọn tab ĐĂNG KÝ */}
          {authState.status === 'allowed' && viewMode === 'register' && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: '#38bdf8' }}>
                Máy đã được kích hoạt
              </h2>
              <p style={{ fontSize: 14, color: '#cbd5f5', marginBottom: 16, lineHeight: 1.5 }}>
                Máy này đã được kích hoạt với tài khoản{' '}
                <strong>{authState.username || '(chưa rõ)'}</strong>. Nếu bạn muốn đăng ký tài khoản khác,
                hãy nhấn nút bên dưới, sau đó chuyển sang tab <strong>Đăng ký</strong> để gửi yêu cầu mới.
              </p>
              <div style={{ marginBottom: 12, fontSize: 12, color: '#e5e7eb' }}>
                <div>Mã máy: {authState.machineId}</div>
                {/* V2: KHÔNG hiển thị key */}
              </div>
              {error && (
                <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>
              )}
              <button
                disabled={loading}
                onClick={handleClear}
                style={{
                  width: '100%',
                  marginTop: 4,
                  padding: '11px 16px',
                  borderRadius: 10,
                  border: '1px solid rgba(148,163,184,0.8)',
                  background: 'transparent',
                  color: '#e5e7eb',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                Đăng ký tài khoản khác
              </button>
            </>
          )}

          {authState.status === 'blocked' && viewMode !== 'login' && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: '#f97373' }}>
                Tài khoản / máy đã bị chặn
              </h2>
              <p style={{ fontSize: 14, color: '#cbd5f5', marginBottom: 16, lineHeight: 1.5 }}>
                Vui lòng liên hệ admin để được hỗ trợ. Nếu admin đã mở lại quyền, bạn có thể chuyển sang tab
                đăng nhập để thử lại. Bạn cũng có thể đăng ký lại với tài khoản khác nếu được cho phép.
              </p>
              <div style={{ marginBottom: 12, fontSize: 12, color: '#e5e7eb' }}>
                <div>Tài khoản: {authState.username || '(chưa rõ)'}</div>
                <div>Mã máy: {authState.machineId}</div>
              </div>
              {error && (
                <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>
              )}
              {authState.message && (
                <div style={{ color: '#fecaca', fontSize: 12, marginBottom: 8 }}>
                  {authState.message}
                </div>
              )}
              <button
                disabled={loading}
                onClick={handleClear}
                style={{
                  width: '100%',
                  marginTop: 4,
                  padding: '11px 16px',
                  borderRadius: 10,
                  border: '1px solid rgba(248,113,113,0.8)',
                  background: 'transparent',
                  color: '#fecaca',
                  fontSize: 14,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                Đăng ký mới
              </button>
            </>
          )}

          {authState.status === 'error' && (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: '#f97373' }}>
                {authState.username ? 'Lỗi kiểm tra trạng thái' : 'Lỗi đăng ký'}
              </h2>
              <p style={{ fontSize: 14, color: '#cbd5f5', marginBottom: 16, lineHeight: 1.5 }}>
                {authState.message || 'Không kết nối được tới server license.'}
              </p>
              {!authState.username && (
                <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
                  Kiểm tra kết nối mạng. Nếu đang mở DevTools (F12), thử đóng lại rồi bấm Thử lại.
                </p>
              )}
              {error && (
                <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>
              )}
              <button
                disabled={loading}
                onClick={handleRefresh}
                style={{
                  width: '100%',
                  marginTop: 4,
                  padding: '11px 16px',
                  borderRadius: 10,
                  border: 'none',
                  background: loading ? '#0ea5e999' : '#0ea5e9',
                  color: '#fff',
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Đang kiểm tra...' : 'Thử lại'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default AuthPage



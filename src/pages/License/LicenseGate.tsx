import { useEffect, useState } from 'react'
import type { LicenseState } from '../../types/ipc'

interface LicenseGateProps {
  state: LicenseState
  onStateChange: (next: LicenseState) => void
}

function formatTime(timestamp?: number): string | undefined {
  if (!timestamp) return undefined
  const date = new Date(timestamp)
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
}

export default function LicenseGate({ state, onStateChange }: LicenseGateProps) {
  const [note, setNote] = useState(state.note ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNote(state.note ?? '')
  }, [state.note])

  const handleSubmit = async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await window.api.license.register(note.trim() || undefined)
      if (!result.success && result.error) {
        setError(result.error)
      }
      onStateChange(result.state)
    } catch (err: any) {
      setError(err?.message ?? 'Không thể gửi yêu cầu kích hoạt')
    } finally {
      setLoading(false)
    }
  }

  const handleRetry = async () => {
    try {
      setError(null)  // MED-10 fix: clear previous error before retrying
      setLoading(true)
      const next = await window.api.license.retry()
      onStateChange(next)
    } catch (err: any) {
      setError(err?.message ?? 'Không thể kiểm tra lại license')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async () => {
    try {
      setLoading(true)
      const next = await window.api.license.clear()
      onStateChange(next)
      setNote('')
      setError(null)
    } catch (err: any) {
      setError(err?.message ?? 'Không thể xoá yêu cầu cũ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a, #1e293b)',
        color: '#e2e8f0',
        fontFamily: '"Segoe UI", sans-serif',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          background: '#0f172a',
          borderRadius: 16,
          padding: 32,
          boxShadow: '0 20px 80px rgba(15,23,42,0.7)',
          border: '1px solid rgba(148,163,184,0.2)',
        }}
      >
        <h1 style={{ marginBottom: 8, fontSize: 24, color: '#38bdf8' }}>Kích hoạt license</h1>
        <p style={{ marginBottom: 16, lineHeight: 1.5, color: '#cbd5f5' }}>
          Máy này chưa được admin phê duyệt. Nhấn “Gửi yêu cầu kích hoạt” để hệ thống tạo yêu cầu và chờ admin bật quyền.
        </p>

        <div
          style={{
            background: '#1e293b',
            borderRadius: 12,
            padding: 16,
            marginBottom: 24,
            border: '1px solid rgba(148,163,184,0.2)',
            fontSize: 14,
            color: '#e2e8f0',
          }}
        >
          <div>
            <strong>Mã máy:</strong> {state.machineHash}
          </div>
          {state.ticket && (
            <div style={{ marginTop: 8, wordBreak: 'break-all', fontSize: 13, color: '#94a3b8' }}>
              Ticket: {state.ticket}
            </div>
          )}
          {state.requestId && (
            <div style={{ marginTop: 8 }}>
              <strong>Request ID:</strong> {state.requestId}
            </div>
          )}
          {state.lastSuccessAt && (
            <div style={{ marginTop: 8 }}>
              <strong>Đã xác thực gần nhất:</strong> {formatTime(state.lastSuccessAt)}
            </div>
          )}
        </div>

        {state.message && (
          <div
            style={{
              marginBottom: 16,
              padding: '12px 16px',
              borderRadius: 8,
              background:
                state.status === 'pending' ? 'rgba(59,130,246,0.15)' : 'rgba(239,68,68,0.15)',
              color: state.status === 'pending' ? '#bfdbfe' : '#fecaca',
              fontSize: 14,
            }}
          >
            {state.message}
          </div>
        )}

        {(state.status === 'needsRegistration' || state.status === 'denied') && (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                Ghi chú cho admin (tuỳ chọn)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="VD: Máy phòng thu số 3"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(148,163,184,0.4)',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  fontSize: 15,
                }}
                disabled={loading}
              />
            </div>
            {error && (
              <div style={{ color: '#f87171', fontSize: 14, marginBottom: 12 }}>
                {error}
              </div>
            )}
            <button
              onClick={handleSubmit}
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: 10,
                border: 'none',
                background: loading ? '#0ea5e9aa' : '#0ea5e9',
                color: '#fff',
                fontSize: 16,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                marginBottom: 12,
              }}
            >
              {loading ? 'Đang gửi yêu cầu...' : 'Gửi yêu cầu kích hoạt'}
            </button>
          </>
        )}

        {state.status === 'pending' && (
          <div style={{ marginBottom: 16, fontSize: 14, color: '#93c5fd' }}>
            Yêu cầu đã tới server và đang chờ admin phê duyệt. Bạn có thể bấm “Kiểm tra lại” để cập nhật
            trạng thái hoặc “Huỷ yêu cầu” để gửi lại.
          </div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={handleRetry}
            disabled={loading}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(148,163,184,0.4)',
              background: 'transparent',
              color: '#e2e8f0',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            Kiểm tra lại
          </button>
          <button
            onClick={handleReset}
            disabled={loading}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(248,113,113,0.5)',
              background: 'transparent',
              color: '#f87171',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            Huỷ yêu cầu
          </button>
        </div>
      </div>
    </div>
  )
}


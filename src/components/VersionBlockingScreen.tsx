/**
 * Version Blocking Screen
 * 
 * Shows blocking screen for Rule A (version too old) or Rule B (version blocked)
 */

import { useState } from 'react'
import type { VersionPolicy } from '../types/ipc'

interface VersionBlockingScreenProps {
  rule: 'block-old' | 'block-version'
  currentVersion: string
  policy: VersionPolicy
  onUpdate?: () => void
  onExit?: () => void
}

export default function VersionBlockingScreen({
  rule,
  currentVersion,
  policy,
  onUpdate,
  onExit,
}: VersionBlockingScreenProps) {
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  // Shown inline instead of confirm() dialog when auto-update fails but manual URL is available
  const [showManualFallback, setShowManualFallback] = useState(false)

  const handleUpdate = async () => {
    if (rule === 'block-version') {
      // Rule B: Open recommended installer URL in external browser
      if (policy.recommended_installer_url) {
        window.open(policy.recommended_installer_url, '_blank')
      } else {
        setUpdateError('Không có link tải bản đề xuất. Vui lòng liên hệ admin.')
      }
      return
    }

    // Rule A: Try auto-update
    setIsUpdating(true)
    setUpdateError(null)
    setShowManualFallback(false)
    try {
      if (!window.api?.updater?.check) {
        throw new Error('Updater không khả dụng')
      }
      const result = await window.api.updater.check()
      if (!result.ok) {
        setUpdateError(result.error || 'Không thể kiểm tra cập nhật')
        // Show inline fallback instead of confirm() dialog
        if (policy.recommended_installer_url) {
          setShowManualFallback(true)
        }
        setIsUpdating(false)
      } else {
        // Update check succeeded — trigger download automatically
        onUpdate?.()
        setIsUpdating(false)
      }
    } catch (err: any) {
      setUpdateError(err.message || 'Lỗi khi kiểm tra cập nhật')
      setIsUpdating(false)
    }
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '40px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          maxWidth: '600px',
          background: '#1e293b',
          border: '2px solid #334155',
          borderRadius: '16px',
          padding: '40px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
        }}
      >
        {rule === 'block-old' ? (
          <>
            <div style={{ fontSize: '64px', marginBottom: '20px' }}>⚠️</div>
            <h1 style={{ fontSize: '28px', fontWeight: '600', marginBottom: '16px', color: '#fbbf24' }}>
              Phiên Bản Quá Cũ
            </h1>
            <p style={{ fontSize: '16px', color: '#94a3b8', marginBottom: '24px', lineHeight: '1.6' }}>
              Phiên bản hiện tại của bạn ({currentVersion}) quá cũ và không còn được hỗ trợ.
              <br />
              Phiên bản tối thiểu yêu cầu: <strong>{policy.min_supported_version}</strong>
            </p>
            {policy.message && (
              <div
                style={{
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '24px',
                  color: '#cbd5e1',
                }}
              >
                {policy.message}
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={handleUpdate}
                disabled={isUpdating}
                style={{
                  padding: '12px 24px',
                  background: isUpdating ? '#475569' : 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'white',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: isUpdating ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {isUpdating ? 'Đang kiểm tra...' : 'Cập Nhật Ngay'}
              </button>
              {onExit && (
                <button
                  onClick={onExit}
                  style={{
                    padding: '12px 24px',
                    background: '#334155',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  Thoát
                </button>
              )}
            </div>
            {updateError && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '12px',
                  background: '#7f1d1d',
                  border: '1px solid #991b1b',
                  borderRadius: '6px',
                  color: '#fca5a5',
                  fontSize: '14px',
                }}
              >
                {updateError}
                {showManualFallback && policy.recommended_installer_url && (
                  <div style={{ marginTop: '10px' }}>
                    <button
                      onClick={() => window.open(policy.recommended_installer_url, '_blank')}
                      style={{
                        background: '#991b1b',
                        border: '1px solid #ef4444',
                        borderRadius: '4px',
                        color: '#fff',
                        padding: '6px 14px',
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      Tải thủ công
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: '64px', marginBottom: '20px' }}>🚫</div>
            <h1 style={{ fontSize: '28px', fontWeight: '600', marginBottom: '16px', color: '#ef4444' }}>
              Phiên Bản Bị Chặn
            </h1>
            <p style={{ fontSize: '16px', color: '#94a3b8', marginBottom: '24px', lineHeight: '1.6' }}>
              Phiên bản hiện tại của bạn ({currentVersion}) đã bị chặn do lỗi nghiêm trọng.
              <br />
              Vui lòng cài đặt phiên bản đề xuất: <strong>{policy.recommended_version}</strong>
            </p>
            {policy.message && (
              <div
                style={{
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '24px',
                  color: '#cbd5e1',
                }}
              >
                {policy.message}
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              {policy.recommended_installer_url && (
                <button
                  onClick={handleUpdate}
                  style={{
                    padding: '12px 24px',
                    background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    color: 'white',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  Tải Bản Đề Xuất
                </button>
              )}
              {onExit && (
                <button
                  onClick={onExit}
                  style={{
                    padding: '12px 24px',
                    background: '#334155',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  Thoát
                </button>
              )}
            </div>
            {updateError && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '12px',
                  background: '#7f1d1d',
                  border: '1px solid #991b1b',
                  borderRadius: '6px',
                  color: '#fca5a5',
                  fontSize: '14px',
                }}
              >
                {updateError}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Settings / About Page
 * 
 * Shows app version, update status, and update controls
 */

import { useEffect, useState } from 'react'
import type { VersionPolicy, UpdaterStatusPayload } from '../types/ipc'

export default function SettingsPage() {
  const [currentVersion, setCurrentVersion] = useState<string>('')
  const [policy, setPolicy] = useState<VersionPolicy | null>(null)
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatusPayload>({ state: 'idle' })
  const [updateChannel, setUpdateChannel] = useState<'stable' | 'beta'>('stable')

  useEffect(() => {
    let isMounted = true
    const loadData = async () => {
      try {
        const version = await window.api.app.getVersion()
        if (!isMounted) return
        setCurrentVersion(version)

        const policyData = await window.api.policy.get()
        if (!isMounted) return
        setPolicy(policyData)

        // Load channel preference
        const channelResult = await window.api.updater.getChannel()
        if (!isMounted) return
        if (channelResult.ok) {
          setUpdateChannel(channelResult.channel)
        }
      } catch (err) {
        // Settings load failure is non-critical — silently ignore
        void err
      }
    }

    loadData()
    return () => { isMounted = false }
  }, [])

  useEffect(() => {
    // Subscribe to updater status
    if (!window.api?.updater?.onStatus) return
    const unsubscribe = window.api.updater.onStatus((status) => {
      setUpdaterStatus(status)
    })

    return unsubscribe
  }, [])

  const handleCheckForUpdates = async () => {
    try {
      setUpdaterStatus({ state: 'checking' })
      if (window.api?.updater?.check) {
        await window.api.updater.check()
      } else if (window.api?.app?.checkUpdate) {
        await window.api.app.checkUpdate()
      }
    } catch (err: any) {
      setUpdaterStatus({
        state: 'error',
        message: err.message || 'Lỗi khi kiểm tra cập nhật',
      })
    }
  }

  const handleRestartToUpdate = async () => {
    try {
      await window.api.updater.install()
    } catch (err: any) {
      setUpdaterStatus({
        state: 'error',
        message: err.message || 'Lỗi khi cài đặt bản cập nhật',
      })
    }
  }

  const handleChannelChange = async (channel: 'stable' | 'beta') => {
    try {
      const result = await window.api.updater.setChannel(channel)
      if (result.ok) {
        setUpdateChannel(channel)
      } else {
        alert(`Không thể đổi kênh: ${result.error || 'Lỗi không xác định'}`)
      }
    } catch (err: any) {
      console.error('[Settings] Failed to change channel:', err)
      alert(`Lỗi khi đổi kênh: ${err.message || 'Lỗi không xác định'}`)
    }
  }

  const getStatusText = (): string => {
    switch (updaterStatus.state) {
      case 'idle':
        return 'Chưa kiểm tra'
      case 'checking':
        return 'Đang kiểm tra...'
      case 'available':
        return `Có bản mới: ${updaterStatus.version || 'N/A'}`
      case 'not-available':
        return 'Bạn đang dùng phiên bản mới nhất'
      case 'downloading':
        return `Đang tải: ${updaterStatus.progress ? Math.round(updaterStatus.progress.percent) : 0}%`
      case 'downloaded':
        return 'Đã tải xong. Khởi động lại để cài đặt.'
      case 'error':
        return updaterStatus.message || 'Lỗi'
      default:
        return 'Unknown'
    }
  }

  const getStatusColor = (): string => {
    switch (updaterStatus.state) {
      case 'available':
      case 'downloaded':
        return '#22c55e'
      case 'downloading':
        return '#0ea5e9'
      case 'error':
        return '#ef4444'
      default:
        return '#94a3b8'
    }
  }

  return (
    <div
      style={{
        padding: '40px',
        maxWidth: '800px',
        margin: '0 auto',
        color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '32px', fontWeight: '600', marginBottom: '32px' }}>⚙️ Cài Đặt</h1>

      {/* About Section */}
      <section
        style={{
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '24px',
        }}
      >
        <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>Thông Tin Ứng Dụng</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <strong>Tên ứng dụng:</strong> 93 Media - Tool Mix Nhạc
          </div>
          <div>
            <strong>Phiên bản hiện tại:</strong>{' '}
            <code style={{ background: '#0f172a', padding: '4px 8px', borderRadius: '4px' }}>
              {currentVersion || 'Đang tải...'}
            </code>
          </div>
          {policy && (
            <>
              <div>
                <strong>Phiên bản mới nhất:</strong>{' '}
                <code style={{ background: '#0f172a', padding: '4px 8px', borderRadius: '4px' }}>
                  {policy.latest_version}
                </code>
              </div>
              <div>
                <strong>Phiên bản tối thiểu:</strong>{' '}
                <code style={{ background: '#0f172a', padding: '4px 8px', borderRadius: '4px' }}>
                  {policy.min_supported_version}
                </code>
              </div>
              {policy.blocked_versions.length > 0 && (
                <div>
                  <strong>Phiên bản bị chặn:</strong>{' '}
                  <code style={{ background: '#7f1d1d', padding: '4px 8px', borderRadius: '4px', color: '#fca5a5' }}>
                    {policy.blocked_versions.join(', ')}
                  </code>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Updates Section */}
      <section
        style={{
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '12px',
          padding: '24px',
        }}
      >
        <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>🔄 Cập Nhật</h2>
        
        {/* Channel Selection */}
        <div style={{ marginBottom: '24px', paddingBottom: '24px', borderBottom: '1px solid #334155' }}>
          <div style={{ marginBottom: '12px', fontWeight: '500' }}>Kênh cập nhật:</div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => handleChannelChange('stable')}
              style={{
                padding: '8px 16px',
                background: updateChannel === 'stable' ? 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)' : '#334155',
                border: '1px solid',
                borderColor: updateChannel === 'stable' ? '#0ea5e9' : '#475569',
                borderRadius: '6px',
                color: 'white',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              Stable
            </button>
            <button
              onClick={() => handleChannelChange('beta')}
              style={{
                padding: '8px 16px',
                background: updateChannel === 'beta' ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : '#334155',
                border: '1px solid',
                borderColor: updateChannel === 'beta' ? '#f59e0b' : '#475569',
                borderRadius: '6px',
                color: 'white',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              Beta
            </button>
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>
            {updateChannel === 'beta' 
              ? '⚠️ Kênh Beta có thể chứa các tính năng thử nghiệm và có thể không ổn định.'
              : 'Kênh Stable cung cấp các bản cập nhật đã được kiểm tra và ổn định.'}
          </div>
          {policy && updateChannel === 'beta' && policy.beta_latest_version && (
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
              Phiên bản Beta mới nhất: <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px' }}>
                {policy.beta_latest_version}
              </code>
            </div>
          )}
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <div style={{ marginBottom: '8px', fontWeight: '500' }}>Trạng thái:</div>
            <div
              style={{
                padding: '12px',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: getStatusColor(),
                fontWeight: '500',
              }}
            >
              {getStatusText()}
            </div>
          </div>

          {updaterStatus.progress && updaterStatus.state === 'downloading' && (
            <div>
              <div style={{ marginBottom: '8px', fontWeight: '500' }}>Tiến trình:</div>
              <div
                style={{
                  width: '100%',
                  height: '8px',
                  background: '#0f172a',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${updaterStatus.progress.percent}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #0ea5e9, #0284c7)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                {Math.round(updaterStatus.progress.transferred / 1024 / 1024)} MB /{' '}
                {Math.round(updaterStatus.progress.total / 1024 / 1024)} MB (
                {Math.round(updaterStatus.progress.bytesPerSecond / 1024)} KB/s)
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleCheckForUpdates}
              disabled={updaterStatus.state === 'checking' || updaterStatus.state === 'downloading'}
              style={{
                padding: '10px 20px',
                background:
                  updaterStatus.state === 'checking' || updaterStatus.state === 'downloading'
                    ? '#475569'
                    : 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
                border: 'none',
                borderRadius: '6px',
                color: 'white',
                fontSize: '14px',
                fontWeight: '600',
                cursor:
                  updaterStatus.state === 'checking' || updaterStatus.state === 'downloading'
                    ? 'not-allowed'
                    : 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {updaterStatus.state === 'checking' ? 'Đang kiểm tra...' : 'Kiểm Tra Cập Nhật'}
            </button>

            {updaterStatus.state === 'downloaded' && (
              <button
                onClick={handleRestartToUpdate}
                style={{
                  padding: '10px 20px',
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                Khởi Động Lại Để Cài Đặt
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

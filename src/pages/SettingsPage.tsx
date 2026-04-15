/**
 * Settings / About Page
 * 
 * Shows app version, update status, and update controls
 */

import { useEffect, useState } from 'react'
import type { GpuFfmpegProfile, VersionPolicy, UpdaterStatusPayload } from '../types/ipc'

export default function SettingsPage() {
  const [currentVersion, setCurrentVersion] = useState<string>('')
  const [policy, setPolicy] = useState<VersionPolicy | null>(null)
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatusPayload>({ state: 'idle' })
  const [updateChannel, setUpdateChannel] = useState<'stable' | 'beta'>('stable')
  const [gpuFfmpegProfile, setGpuFfmpegProfile] = useState<GpuFfmpegProfile>('auto')
  const [legacyGpuFfmpegPath, setLegacyGpuFfmpegPath] = useState<string | null>(null)

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

        if (window.api.app.getGpuFfmpegProfile) {
          const gpuProfileResult = await window.api.app.getGpuFfmpegProfile()
          if (!isMounted) return
          if (gpuProfileResult.ok) {
            setGpuFfmpegProfile(gpuProfileResult.profile)
          }
        }

        if (window.api.app.getLegacyGpuFfmpegPath) {
          const legacyPathResult = await window.api.app.getLegacyGpuFfmpegPath()
          if (!isMounted) return
          if (legacyPathResult.ok) {
            setLegacyGpuFfmpegPath(legacyPathResult.path)
          }
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

  const handleGpuProfileChange = async (profile: GpuFfmpegProfile) => {
    try {
      if (!window.api.app.getGpuFfmpegProfile || !window.api.app.setGpuFfmpegProfile) {
        return
      }
      const result = await window.api.app.setGpuFfmpegProfile(profile)
      if (result.ok) {
        setGpuFfmpegProfile(result.profile)
      } else {
        alert(`Khong the doi GPU FFmpeg profile: ${result.error || 'Loi khong xac dinh'}`)
      }
    } catch (err: any) {
      console.error('[Settings] Failed to change GPU FFmpeg profile:', err)
      alert(`Loi khi doi GPU FFmpeg profile: ${err.message || 'Loi khong xac dinh'}`)
    }
  }

  const handleBrowseLegacyGpuFfmpeg = async () => {
    try {
      if (!window.api.app.setLegacyGpuFfmpegPath) {
        return
      }
      const result = await window.api.dialog.openFile({
        title: 'Chon FFmpeg legacy',
        filters: [
          { name: 'FFmpeg executable', extensions: ['exe'] },
          { name: 'All files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return
      }

      const saved = await window.api.app.setLegacyGpuFfmpegPath(result.filePaths[0] || null)
      if (saved.ok) {
        setLegacyGpuFfmpegPath(saved.path)
      } else {
        alert(`Khong the luu duong dan FFmpeg legacy: ${saved.error || 'Loi khong xac dinh'}`)
      }
    } catch (err: any) {
      console.error('[Settings] Failed to select legacy GPU FFmpeg:', err)
      alert(`Loi khi chon FFmpeg legacy: ${err.message || 'Loi khong xac dinh'}`)
    }
  }

  const handleClearLegacyGpuFfmpeg = async () => {
    try {
      if (!window.api.app.setLegacyGpuFfmpegPath) {
        return
      }
      const saved = await window.api.app.setLegacyGpuFfmpegPath(null)
      if (saved.ok) {
        setLegacyGpuFfmpegPath(saved.path)
      } else {
        alert(`Khong the xoa duong dan FFmpeg legacy: ${saved.error || 'Loi khong xac dinh'}`)
      }
    } catch (err: any) {
      console.error('[Settings] Failed to clear legacy GPU FFmpeg:', err)
      alert(`Loi khi xoa FFmpeg legacy: ${err.message || 'Loi khong xac dinh'}`)
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
      <h1 style={{ fontSize: '32px', fontWeight: '600', marginBottom: '32px' }}>Cài Đặt</h1>

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

      <section
        style={{
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '24px',
        }}
      >
        <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>FFmpeg GPU</h2>
        <div style={{ marginBottom: '12px', fontWeight: '500' }}>GPU FFmpeg profile:</div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleGpuProfileChange('auto')}
            style={{
              padding: '8px 16px',
              background: gpuFfmpegProfile === 'auto' ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' : '#334155',
              border: '1px solid',
              borderColor: gpuFfmpegProfile === 'auto' ? '#22c55e' : '#475569',
              borderRadius: '6px',
              color: 'white',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Auto
          </button>
          <button
            onClick={() => handleGpuProfileChange('modern')}
            style={{
              padding: '8px 16px',
              background: gpuFfmpegProfile === 'modern' ? 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)' : '#334155',
              border: '1px solid',
              borderColor: gpuFfmpegProfile === 'modern' ? '#0ea5e9' : '#475569',
              borderRadius: '6px',
              color: 'white',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Modern
          </button>
          <button
            onClick={() => handleGpuProfileChange('legacy')}
            style={{
              padding: '8px 16px',
              background: gpuFfmpegProfile === 'legacy' ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : '#334155',
              border: '1px solid',
              borderColor: gpuFfmpegProfile === 'legacy' ? '#f59e0b' : '#475569',
              borderRadius: '6px',
              color: 'white',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Legacy
          </button>
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '12px', lineHeight: 1.6 }}>
          Chi ap dung cho cac luong GPU encode. Probe, audio encode va CPU fallback van dung FFmpeg mac dinh cua app.
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '6px', lineHeight: 1.6 }}>
          Auto: thu modern truoc roi fallback sang legacy neu driver NVIDIA cu khong chay duoc NVENC. Modern: ep dung FFmpeg moi. Legacy: ep dung FFmpeg legacy cho cac may GPU cu.
        </div>
        <div style={{ marginTop: '18px', paddingTop: '18px', borderTop: '1px solid #334155' }}>
          <div style={{ marginBottom: '12px', fontWeight: '500' }}>FFmpeg legacy executable:</div>
          <div
            style={{
              padding: '12px',
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '6px',
              color: legacyGpuFfmpegPath ? '#e2e8f0' : '#94a3b8',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: '12px',
              wordBreak: 'break-all',
            }}
          >
            {legacyGpuFfmpegPath || 'Chua cau hinh. App se khong co duong fallback GPU legacy cho may NVIDIA driver cu.'}
          </div>
          <div style={{ display: 'flex', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={handleBrowseLegacyGpuFfmpeg}
              style={{
                padding: '8px 16px',
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                border: '1px solid #f59e0b',
                borderRadius: '6px',
                color: 'white',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Chon FFmpeg Legacy
            </button>
            <button
              onClick={handleClearLegacyGpuFfmpeg}
              disabled={!legacyGpuFfmpegPath}
              style={{
                padding: '8px 16px',
                background: legacyGpuFfmpegPath ? '#334155' : '#1e293b',
                border: '1px solid #475569',
                borderRadius: '6px',
                color: legacyGpuFfmpegPath ? 'white' : '#64748b',
                fontSize: '14px',
                fontWeight: '600',
                cursor: legacyGpuFfmpegPath ? 'pointer' : 'not-allowed',
              }}
            >
              Xoa
            </button>
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '10px', lineHeight: 1.6 }}>
            Chon file <code>ffmpeg.exe</code> cua bo FFmpeg legacy. App se tu dong tim <code>ffprobe.exe</code> cung thu muc.
          </div>
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
        <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>Cập Nhật</h2>
        
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
              ? 'Lưu ý: Kênh Beta có thể chứa các tính năng thử nghiệm và có thể không ổn định.'
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

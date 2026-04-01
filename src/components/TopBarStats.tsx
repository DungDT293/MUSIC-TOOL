import { useEffect, useState } from 'react'

interface RealtimeStats {
  cpuPercent: number | null
  gpuPercent: number | null
  diskThroughputMBps: number | null
  diskReadMBps: number | null
  diskWriteMBps: number | null
}

interface DiskDriveInfo {
  drive: string
  totalBytes: number | null
  freeBytes: number | null
  usedBytes: number | null
  usedPercent: number | null
  diskType?: 'SSD' | 'HDD' | 'UNKNOWN'
}

interface DiskTypeSummary {
  type: 'SSD' | 'HDD' | 'UNKNOWN'
  totalBytes: number
  freeBytes: number
  usedBytes: number
  driveCount: number
}

interface DiskInfoSummary {
  drives: DiskDriveInfo[]
  byType: {
    ssd: DiskTypeSummary | null
    hdd: DiskTypeSummary | null
  }
  updatedAt: number
}

interface SystemInfo {
  gpuModel?: string
}

interface AuthSummary {
  username?: string
  status?: string
  activationKey?: string
}

function formatPercent(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '--%'
  return `${v.toFixed(0)}%`
}

function formatGB(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '-- GB'
  const gb = bytes / (1024 * 1024 * 1024)
  if (!Number.isFinite(gb)) return '-- GB'
  return `${gb.toFixed(1)} GB`
}

function formatMBps(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '--'
  return value.toFixed(1)
}

function getDiskStatus(freeBytes: number | null | undefined): {
  label: string
  color: string
} {
  if (freeBytes == null || !Number.isFinite(freeBytes)) {
    return { label: 'N/A', color: '#9e9e9e' }
  }
  const freeGB = freeBytes / (1024 * 1024 * 1024)
  if (freeGB >= 100) {
    return { label: 'Tốt', color: '#4caf50' }
  }
  if (freeGB >= 50) {
    return { label: 'Bình thường', color: '#ffb74d' }
  }
  return { label: 'Cảnh báo', color: '#f44336' }
}

function TopBarStats() {
  const [stats, setStats] = useState<RealtimeStats | null>(null)
  const [diskInfo, setDiskInfo] = useState<DiskInfoSummary | null>(null)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [authInfo, setAuthInfo] = useState<AuthSummary | null>(null)

  useEffect(() => {
    let isMounted = true
    let timer: any

    const fetchStats = async () => {
      try {
        const data = await window.api.getRealtimeStats?.()
        if (!isMounted) return
        if (data) {
          setStats({
            cpuPercent: typeof data.cpuPercent === 'number' ? data.cpuPercent : null,
            gpuPercent: typeof data.gpuPercent === 'number' ? data.gpuPercent : null,
            diskThroughputMBps:
              typeof data.diskThroughputMBps === 'number' ? data.diskThroughputMBps : null,
            diskReadMBps: typeof data.diskReadMBps === 'number' ? data.diskReadMBps : null,
            diskWriteMBps: typeof data.diskWriteMBps === 'number' ? data.diskWriteMBps : null,
          })
        }
      } catch {
        // ignore
      } finally {
        if (isMounted) {
          timer = setTimeout(fetchStats, 1000)
        }
      }
    }

    fetchStats()

    return () => {
      isMounted = false
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Lấy thông tin tài khoản / trạng thái kích hoạt để hiển thị góc phải.
  useEffect(() => {
    let mounted = true
    let timer: any

    const fetchAuthInfo = async () => {
      try {
        const api = window.api
        if (!api?.auth?.getState) return
        const state = await api.auth.getState()
        if (!mounted || !state) return
        setAuthInfo({
          username: state.username,
          status: state.status,
          // activationKey intentionally omitted — SEC-01 security fix
        })
      } catch (err) {
        // ignore
      } finally {
        if (mounted) {
          timer = setTimeout(fetchAuthInfo, 30_000) // làm tươi 30s một lần
        }
      }
    }

    void fetchAuthInfo()

    return () => {
      mounted = false
      if (timer) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    let unsubscribe: (() => void) | undefined
    let refreshTimer: any

    const fetchDiskInfo = async () => {
      try {
        const data = await window.api?.getDiskInfo?.()
        if (data && isMounted) {
          setDiskInfo(data)
        }
      } catch (err) {
        console.error('[TopBarStats] getDiskInfo error:', err)
      }
    }

    // Fetch ngay khi mount
    fetchDiskInfo()

    // Subscribe để nhận updates từ main process
    if (window.api?.onDiskInfo) {
      unsubscribe = window.api.onDiskInfo((payload: DiskInfoSummary) => {
        if (isMounted) {
          setDiskInfo(payload)
        }
      })
    }

    // Refresh định kỳ mỗi 30 giây để đảm bảo có data
    refreshTimer = setInterval(() => {
      if (isMounted) {
        fetchDiskInfo()
      }
    }, 30_000)

    return () => {
      isMounted = false
      unsubscribe?.()
      if (refreshTimer) clearInterval(refreshTimer)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const fetchSystemInfo = async () => {
      try {
        const info = await window.api?.getSystemInfo?.()
        if (mounted) {
          setSystemInfo(info || null)
        }
      } catch (err) {
        console.error('[TopBarStats] getSystemInfo error:', err)
      }
    }
    fetchSystemInfo()
    return () => {
      mounted = false
    }
  }, [])

  const cpuText = formatPercent(stats?.cpuPercent ?? null)
  const gpuText =
    stats?.gpuPercent != null
      ? formatPercent(stats.gpuPercent)
      : systemInfo?.gpuModel
        ? systemInfo.gpuModel
        : 'N/A'
  const throughputText =
    stats?.diskReadMBps != null || stats?.diskWriteMBps != null
      ? `Ổ C đọc ${formatMBps(stats?.diskReadMBps)} / ghi ${formatMBps(
          stats?.diskWriteMBps
        )} MiB/s`
      : stats?.diskThroughputMBps != null
        ? `${stats.diskThroughputMBps.toFixed(1)} MiB/s`
        : '-- MiB/s'
  // Hiển thị SSD và HDD thay vì từng ổ riêng lẻ
  const driveBadges: Array<{ type: string; text: string; color: string }> = []
  
  if (diskInfo?.byType?.ssd) {
    const ssd = diskInfo.byType.ssd
    const status = getDiskStatus(ssd.freeBytes)
    driveBadges.push({
      type: 'SSD',
      text: `SSD ${formatGB(ssd.freeBytes)} / ${formatGB(ssd.totalBytes)} (${ssd.driveCount} ổ)`,
      color: status.color,
    })
  }
  
  if (diskInfo?.byType?.hdd) {
    const hdd = diskInfo.byType.hdd
    const status = getDiskStatus(hdd.freeBytes)
    driveBadges.push({
      type: 'HDD',
      text: `HDD ${formatGB(hdd.freeBytes)} / ${formatGB(hdd.totalBytes)} (${hdd.driveCount} ổ)`,
      color: status.color,
    })
  }
  
  // Nếu không có SSD hoặc HDD nào được phát hiện nhưng có drives, hiển thị tổng hợp
  if (driveBadges.length === 0 && diskInfo?.drives && diskInfo.drives.length > 0) {
    let totalBytes = 0
    let totalFree = 0
    for (const drive of diskInfo.drives) {
      if (drive.totalBytes != null) totalBytes += drive.totalBytes
      if (drive.freeBytes != null) totalFree += drive.freeBytes
    }
    const status = getDiskStatus(totalFree)
    driveBadges.push({
      type: 'ALL',
      text: `Disk ${formatGB(totalFree)} / ${formatGB(totalBytes)} (${diskInfo.drives.length} ổ)`,
      color: status.color,
    })
  }
  
  // Nếu hoàn toàn không có thông tin, hiển thị đang quét
  if (driveBadges.length === 0) {
    driveBadges.push({
      type: 'N/A',
      text: 'Đang quét...',
      color: '#9e9e9e',
    })
  }

  return (
    <div
      style={{
        height: '50px',
        backgroundColor: '#252526',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: '30px',
        fontSize: '14px',
        color: '#ccc',
      }}
    >
      <div>
        <span style={{ color: '#888' }}>CPU: </span>
        <span>{cpuText}</span>
      </div>
      <div>
        <span style={{ color: '#888' }}>GPU: </span>
        <span>{gpuText}</span>
      </div>
      <div>
        <span style={{ color: '#888' }}>Throughput: </span>
        <span>{throughputText}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ color: '#888' }}>Disk: </span>
        {driveBadges.map((badge) => (
          <span
            key={badge.type}
            style={{
              padding: '2px 8px',
              borderRadius: '12px',
              backgroundColor: '#1c1c1c',
              border: `1px solid ${badge.color}`,
              color: badge.color,
              fontSize: '12px',
            }}
          >
            {badge.text}
          </span>
        ))}
      </div>
      {authInfo?.username && (
        <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: 12 }}>
          <div>
            <span style={{ color: '#888' }}>Tài khoản: </span>
            <span>{authInfo.username}</span>
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>
            <span>Trạng thái: </span>
            <span>
              {authInfo.status === 'allowed'
                ? 'ĐÃ KÍCH HOẠT'
                : authInfo.status === 'pending'
                  ? 'ĐANG CHỜ DUYỆT'
                  : authInfo.status === 'blocked'
                    ? 'BỊ CHẶN'
                    : authInfo.status}
            </span>
            {/* activationKey is intentionally not displayed — SEC-01 security fix */}
          </div>
        </div>
      )}
    </div>
  )
}

export default TopBarStats






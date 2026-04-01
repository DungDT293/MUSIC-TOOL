/**
 * PoolMonitorTab — Theo dõi Video Pool và danh sách Batch Genre
 *
 * Hiển thị:
 * - Video Pool stats (tổng clip, chưa dùng, dùng 24h, 7 ngày, sessions)
 * - Danh sách batch genre đang cấu hình trong BatchModeTab (đọc từ localStorage)
 * - Nút refresh + clear pool
 */

import React, { useEffect, useState, useCallback } from 'react'
import { BATCH_STORAGE_KEY } from './BatchModeTab'

interface PoolStats {
  totalClips: number
  neverUsed: number
  usedInLast24h: number
  usedInLast7d: number
  totalSessions: number
  lastSessionAt: number | null
}

interface BatchGenreSummary {
  id: string
  name: string
  rootVideo: string
  rootAudio: string
  rootFinal: string
  priorityVideoFolder: string
  dateCode: string
  playlistCount: number
  minutesPerPlaylist: number
  status: 'pending' | 'running' | 'completed' | 'error'
}

const cardStyle: React.CSSProperties = {
  background: '#1e1e2e',
  border: '1px solid #333',
  borderRadius: '8px',
  padding: '14px 18px',
  marginBottom: '12px',
}

const labelStyle: React.CSSProperties = {
  color: '#aaa',
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '4px',
}

const valueStyle: React.CSSProperties = {
  color: '#e2e8f0',
  fontSize: '22px',
  fontWeight: 700,
  lineHeight: 1.2,
}

const subValueStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: '12px',
  marginTop: '2px',
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div style={{ ...cardStyle, flex: '1 1 140px', minWidth: 120 }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ ...valueStyle, color: accent || '#e2e8f0' }}>{value}</div>
      {sub && <div style={subValueStyle}>{sub}</div>}
    </div>
  )
}

function formatTime(ts: number | null): string {
  if (!ts) return 'Chưa có'
  const d = new Date(ts)
  return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatPath(p: string): string {
  if (!p) return '—'
  // Show last 2 path segments for readability
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 2) return p
  return '…/' + parts.slice(-2).join('/')
}

function statusColor(s: string): string {
  if (s === 'completed') return '#22c55e'
  if (s === 'running') return '#3b82f6'
  if (s === 'error') return '#ef4444'
  return '#64748b'
}

function statusLabel(s: string): string {
  if (s === 'completed') return 'Xong'
  if (s === 'running') return 'Đang chạy'
  if (s === 'error') return 'Lỗi'
  return 'Chờ'
}

export default function PoolMonitorTab() {
  const [stats, setStats] = useState<PoolStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batches, setBatches] = useState<BatchGenreSummary[]>([])
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const loadStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const s = await window.api?.autopilot?.getVideoPoolStats?.()
      setStats(s ?? null)
      setLastRefresh(new Date())
    } catch (err: any) {
      setError(err?.message || 'Không thể tải stats')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadBatches = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(BATCH_STORAGE_KEY)
      if (!raw) { setBatches([]); return }
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setBatches(parsed.map((b: any) => ({
          id: b.id || '',
          name: b.name || '(chưa đặt tên)',
          rootVideo: b.rootVideo || '',
          rootAudio: b.rootAudio || '',
          rootFinal: b.rootFinal || '',
          priorityVideoFolder: b.priorityVideoFolder || '',
          dateCode: b.dateCode || '',
          playlistCount: b.playlistCount || 0,
          minutesPerPlaylist: b.minutesPerPlaylist || 0,
          status: b.status || 'pending',
        })))
      }
    } catch {
      setBatches([])
    }
  }, [])

  useEffect(() => {
    loadStats()
    loadBatches()
    // Auto-refresh every 30s
    const interval = setInterval(() => {
      loadStats()
      loadBatches()
    }, 30_000)
    return () => clearInterval(interval)
  }, [loadStats, loadBatches])

  const handleClearPool = async () => {
    if (!window.confirm('Xóa toàn bộ Video Pool? Lịch sử sử dụng sẽ bị xóa, các clip sẽ được phân phối lại từ đầu.')) return
    setClearing(true)
    try {
      await window.api?.autopilot?.clearVideoPool?.()
      await loadStats()
    } catch (err: any) {
      setError(err?.message || 'Không thể xóa pool')
    } finally {
      setClearing(false)
    }
  }

  const unusedPct = stats ? Math.round((stats.neverUsed / Math.max(stats.totalClips, 1)) * 100) : 0
  const used24hPct = stats ? Math.round((stats.usedInLast24h / Math.max(stats.totalClips, 1)) * 100) : 0

  return (
    <div style={{ padding: '16px', color: '#e2e8f0', fontFamily: 'sans-serif', minHeight: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f1f5f9' }}>
          Video Pool Monitor
        </h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {lastRefresh && (
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              Cập nhật: {lastRefresh.toLocaleTimeString('vi-VN')}
            </span>
          )}
          <button
            onClick={() => { loadStats(); loadBatches() }}
            disabled={loading}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
              background: loading ? '#374151' : '#2563eb', color: '#fff', fontSize: '12px', fontWeight: 600,
            }}
          >
            {loading ? 'Đang tải...' : 'Refresh'}
          </button>
          <button
            onClick={handleClearPool}
            disabled={clearing || !stats}
            style={{
              padding: '6px 14px', borderRadius: '6px', border: '1px solid #7f1d1d', cursor: 'pointer',
              background: '#450a0a', color: '#fca5a5', fontSize: '12px', fontWeight: 600,
            }}
          >
            {clearing ? 'Đang xóa...' : 'Xóa Pool'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: '6px',
          padding: '10px 14px', marginBottom: '12px', color: '#fca5a5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {/* Pool Stats */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Thống kê Video Pool
        </div>

        {!stats && !loading && (
          <div style={{ color: '#64748b', fontSize: '13px', padding: '20px', textAlign: 'center',
            background: '#1e1e2e', borderRadius: '8px', border: '1px solid #333' }}>
            Chưa có dữ liệu pool. Chạy Autopilot một lần để khởi tạo pool.
          </div>
        )}

        {stats && (
          <>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
              <StatCard label="Tổng clip trong pool" value={stats.totalClips.toLocaleString()} accent="#60a5fa" />
              <StatCard
                label="Chưa bao giờ dùng"
                value={stats.neverUsed.toLocaleString()}
                sub={`${unusedPct}% tổng pool`}
                accent={unusedPct > 50 ? '#22c55e' : '#f59e0b'}
              />
              <StatCard
                label="Dùng trong 24h"
                value={stats.usedInLast24h.toLocaleString()}
                sub={`${used24hPct}% tổng pool`}
                accent="#a78bfa"
              />
              <StatCard label="Dùng trong 7 ngày" value={stats.usedInLast7d.toLocaleString()} accent="#fb923c" />
              <StatCard label="Tổng sessions" value={stats.totalSessions.toLocaleString()} accent="#34d399" />
              <StatCard
                label="Session gần nhất"
                value={formatTime(stats.lastSessionAt)}
                accent="#94a3b8"
              />
            </div>

            {/* Pool usage bar */}
            <div style={{ ...cardStyle, marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>Tỷ lệ clip chưa dùng (xanh = tốt)</span>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>{unusedPct}% fresh</span>
              </div>
              <div style={{ background: '#374151', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                <div style={{
                  width: `${unusedPct}%`, height: '100%', borderRadius: '4px',
                  background: unusedPct > 60 ? '#22c55e' : unusedPct > 30 ? '#f59e0b' : '#ef4444',
                  transition: 'width 0.3s',
                }} />
              </div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                {unusedPct > 60
                  ? 'Pool còn nhiều clip mới, chưa dùng — tốt!'
                  : unusedPct > 30
                  ? 'Cảnh báo: Pool đang cạn clip mới, thêm video để đa dạng hơn'
                  : 'Cảnh báo: Pool hầu hết đã dùng hết — nên thêm clip mới hoặc xóa pool để reset'}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Batch Genre List */}
      <div>
        <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Danh sách Batch Genre ({batches.length} thể loại)
        </div>

        {batches.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: '13px', padding: '20px', textAlign: 'center',
            background: '#1e1e2e', borderRadius: '8px', border: '1px solid #333' }}>
            Chưa có batch genre nào. Thêm thể loại ở tab Batch Mode.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {batches.map((b, idx) => (
              <div key={b.id} style={{
                background: '#1e1e2e', border: `1px solid ${b.status === 'running' ? '#2563eb' : b.status === 'error' ? '#7f1d1d' : '#333'}`,
                borderRadius: '8px', padding: '12px 14px',
                boxShadow: b.status === 'running' ? '0 0 0 2px rgba(37,99,235,0.3)' : 'none',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ color: '#64748b', fontSize: '12px', fontWeight: 600 }}>#{idx + 1}</span>
                    <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '14px' }}>
                      {b.name || '(chưa đặt tên)'}
                    </span>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                      Ngày {b.dateCode} · {b.playlistCount} playlist × {b.minutesPerPlaylist} phút
                    </span>
                  </div>
                  <span style={{
                    fontSize: '11px', fontWeight: 600, padding: '2px 10px', borderRadius: '20px',
                    background: statusColor(b.status) + '22', color: statusColor(b.status),
                    border: `1px solid ${statusColor(b.status)}55`,
                  }}>
                    {statusLabel(b.status)}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 12px', fontSize: '11px' }}>
                  <div>
                    <span style={{ color: '#64748b' }}>Audio: </span>
                    <span style={{ color: '#94a3b8' }} title={b.rootAudio}>{formatPath(b.rootAudio)}</span>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Video: </span>
                    <span style={{ color: '#94a3b8' }} title={b.rootVideo}>{formatPath(b.rootVideo)}</span>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>📂 Xuất: </span>
                    <span style={{ color: '#94a3b8' }} title={b.rootFinal}>{formatPath(b.rootFinal)}</span>
                  </div>
                  {b.priorityVideoFolder && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span style={{ color: '#64748b' }}>Video ưu tiên: </span>
                      <span style={{ color: '#94a3b8' }} title={b.priorityVideoFolder}>{formatPath(b.priorityVideoFolder)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

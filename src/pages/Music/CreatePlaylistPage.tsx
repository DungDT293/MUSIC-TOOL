import { useState, useEffect } from 'react'
import NumericDraftInput from '../../components/NumericDraftInput'
import {
  ScanMusicResult,
  BuildPlaylistsOptions,
  BuildPlaylistsResult,
  BuildPlaylistWarning,
  PlaylistDefinition,
  ScannedTrack,
  MusicPoolStats,
} from '../../types/ipc'

function formatDuration(seconds: number): string {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function formatDurationShort(seconds: number): string {
  const s = Math.floor(seconds)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

const SCAN_RESULT_STORAGE_KEY = 'scanResultV1'

function getActiveTracks(scanResult: ScanMusicResult | null, genreId: string): ScannedTrack[] {
  if (!scanResult) return []
  if (genreId === 'all') return scanResult.tracks
  return scanResult.tracks.filter((track) => track.genreId === genreId)
}

function getAvailableGenres(scanResult: ScanMusicResult | null): Array<{ id: string; name: string; count: number }> {
  if (!scanResult) return []
  const configGenres = scanResult.config?.genres ?? []
  if (configGenres.length > 0) {
    return configGenres.map((genre) => ({
      id: genre.id,
      name: genre.name,
      count: scanResult.tracks.filter((track) => track.genreId === genre.id).length,
    }))
  }

  const byId = new Map<string, { id: string; name: string; count: number }>()
  for (const track of scanResult.tracks) {
    if (!track.genreId) continue
    const current = byId.get(track.genreId) ?? { id: track.genreId, name: track.genreName || track.genreId, count: 0 }
    current.count++
    byId.set(track.genreId, current)
  }
  return Array.from(byId.values())
}

function CreatePlaylistPage() {
  const [scanResult, setScanResult] = useState<ScanMusicResult | null>(null)
  const [pinnedTrackIds, setPinnedTrackIds] = useState<string[]>([])
  const [endingTrackIds, setEndingTrackIds] = useState<string[]>([])
  const [playlistCountInput, setPlaylistCountInput] = useState<string>('5')
  const [targetHoursInput, setTargetHoursInput] = useState<string>('0')
  const [targetMinutesInput, setTargetMinutesInput] = useState<string>('30')
  const [priorityRatioInput, setPriorityRatioInput] = useState<string>('') // % nhạc ưu tiên (để trống = dùng mặc định 65-85%)
  const [playlists, setPlaylists] = useState<PlaylistDefinition[]>([])
  const [warnings, setWarnings] = useState<BuildPlaylistWarning[]>([])
  const [error, setError] = useState<string | null>(null)
  const [poolStats, setPoolStats] = useState<MusicPoolStats | null>(null)
  const [poolLoading, setPoolLoading] = useState(false)
  const [showPoolDetail, setShowPoolDetail] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedGenreId, setSelectedGenreId] = useState('all')
  const [expandedPlaylistId, setExpandedPlaylistId] = useState<string | null>(null)

  // Helper clamp
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

  // Derive numeric values từ string
  const parsedPlaylistCount = parseInt(playlistCountInput || '', 10)
  const parsedTargetHours =
    targetHoursInput === '' ? 0 : parseInt(targetHoursInput, 10)
  const parsedTargetMinutes =
    targetMinutesInput === '' ? 0 : parseInt(targetMinutesInput, 10)
  const parsedPriorityRatio = priorityRatioInput ? parseFloat(priorityRatioInput) : null

  const playlistCount =
    Number.isFinite(parsedPlaylistCount) && parsedPlaylistCount > 0
      ? parsedPlaylistCount // Loại bỏ giới hạn 500
      : 0 // 0 = invalid

  const hoursValid = Number.isFinite(parsedTargetHours) && parsedTargetHours >= 0 && parsedTargetHours <= 24
  const minutesValid = Number.isFinite(parsedTargetMinutes) && parsedTargetMinutes >= 0

  const targetDurationMinutes =
    hoursValid && minutesValid && parsedTargetHours * 60 + parsedTargetMinutes > 0
      ? clamp(parsedTargetHours * 60 + parsedTargetMinutes, 1, 1440) // 1440 phút = 24h
      : 0

  // Priority ratio: Nếu user nhập → dùng giá trị đó, nếu không → mặc định 65-85%
  const priorityRatioMin = parsedPriorityRatio !== null && Number.isFinite(parsedPriorityRatio) && parsedPriorityRatio >= 0 && parsedPriorityRatio <= 100
    ? clamp(parsedPriorityRatio / 100, 0, 1)
    : 0.65 // default min

  const priorityRatioMax = parsedPriorityRatio !== null && Number.isFinite(parsedPriorityRatio) && parsedPriorityRatio >= 0 && parsedPriorityRatio <= 100
    ? clamp(parsedPriorityRatio / 100, 0, 1) // Nếu user chọn → dùng chính xác giá trị đó
    : 0.85 // default max (nếu không chọn, dùng range 65-85%)

  // Tính random ratio để hiển thị (100% - priority)
  const randomRatioPercent = parsedPriorityRatio !== null && Number.isFinite(parsedPriorityRatio)
    ? (100 - parsedPriorityRatio).toFixed(0)
    : '15-35' // Mặc định: 100 - 85 = 15, 100 - 65 = 35

  // Xác định điều kiện invalid
  const invalidConfig =
    playlistCount <= 0 ||
    targetDurationMinutes <= 0 ||
    !Number.isFinite(playlistCount) ||
    !Number.isFinite(targetDurationMinutes)

  // Load scanResult từ backend cache trước, localStorage chỉ fallback khi backend API không có/lỗi.
  useEffect(() => {
    let disposed = false

    const loadSavedScan = async () => {
      const hasBackendCacheApi = typeof window.api.getLastScanResult === 'function'
      try {
        if (hasBackendCacheApi) {
          const saved = await window.api.getLastScanResult()
          if (!disposed && saved?.tracks?.length) {
            setScanResult(saved)
            localStorage.setItem(SCAN_RESULT_STORAGE_KEY, JSON.stringify(saved))
          }
          return
        }
      } catch (e) {
        console.warn('Failed to load getLastScanResult', e)
      }

      const raw = localStorage.getItem(SCAN_RESULT_STORAGE_KEY)
      if (!raw || disposed) {
        setPlaylists([])
        return
      }

      try {
        const parsed: ScanMusicResult = JSON.parse(raw)
        setScanResult(parsed)
      } catch (e) {
        console.error('Failed to parse scanResultV1', e)
        setPlaylists([])
      }
    }

    loadSavedScan()
    return () => { disposed = true }
  }, [])

  const availableGenres = getAvailableGenres(scanResult)
  const activeTracks = getActiveTracks(scanResult, selectedGenreId)

  // Reset playlists khi scanResult/thể loại thay đổi
  useEffect(() => {
    const validGenreIds = availableGenres.map((genre) => genre.id)
    if (selectedGenreId !== 'all' && !validGenreIds.includes(selectedGenreId)) {
      setSelectedGenreId('all')
      return
    }

    setPlaylists([])
    setWarnings([])
    setPinnedTrackIds((ids) => ids.filter((id) => activeTracks.some((track) => track.id === id)))
    setEndingTrackIds((ids) => ids.filter((id) => activeTracks.some((track) => track.id === id)))
    if (scanResult) loadPoolStats(activeTracks)
  }, [scanResult, selectedGenreId])

  // Listen for custom event khi Tab 1 quét nhạc mới (trong cùng window)
  useEffect(() => {
    const handleMusicScanCompleted = (e: CustomEvent<ScanMusicResult>) => {
      // Quét nhạc mới → reset playlists và update scanResult
      setPlaylists([])
      setWarnings([])
      setScanResult(e.detail)
    }

    window.addEventListener('musicScanCompleted', handleMusicScanCompleted as EventListener)
    return () => {
      window.removeEventListener('musicScanCompleted', handleMusicScanCompleted as EventListener)
    }
  }, [])

  const handleTogglePinned = (trackId: string) => {
    setPinnedTrackIds((prev) => {
      if (prev.includes(trackId)) {
        return prev.filter((id) => id !== trackId)
      } else {
        setEndingTrackIds((ids) => ids.filter((id) => id !== trackId))
        return [...prev, trackId]
      }
    })
  }

  const handleToggleEnding = (trackId: string) => {
    setEndingTrackIds((prev) => {
      if (prev.includes(trackId)) {
        return prev.filter((id) => id !== trackId)
      } else {
        setPinnedTrackIds((ids) => ids.filter((id) => id !== trackId))
        return [...prev, trackId]
      }
    })
  }

  const loadPoolStats = async (tracks: ScanMusicResult['tracks']) => {
    if (!window.api?.getMusicPoolStats) return
    setPoolLoading(true)
    try {
      const ids = tracks.map(t => t.id)
      const stats = await window.api.getMusicPoolStats(ids)
      setPoolStats(stats)
    } catch (e) {
      console.warn('Không thể load pool stats:', e)
    } finally {
      setPoolLoading(false)
    }
  }

  const handleClearPool = async () => {
    if (!window.api?.clearMusicPool) return
    if (!confirm('Xoá toàn bộ lịch sử sử dụng nhạc? Pool sẽ reset về trạng thái ban đầu.')) return
    await window.api.clearMusicPool()
    if (scanResult) await loadPoolStats(activeTracks)
  }

  const handleCreatePlaylists = async () => {
    if (!scanResult) return

    if (activeTracks.length === 0) {
      setError('Thể loại đang chọn không có bài nào.')
      return
    }

    if (invalidConfig) {
      setError('Vui lòng nhập số playlist và thời lượng hợp lệ.')
      return
    }

    setError(null)
    setLoading(true)
    setPlaylists([])
    setWarnings([])

    try {
      const endingTracks = endingTrackIds
        .map((id) => activeTracks.find((track) => track.id === id))
        .filter((track): track is ScannedTrack => Boolean(track))
      const options: BuildPlaylistsOptions = {
        tracks: activeTracks,
        pinnedTrackIds: pinnedTrackIds.filter((id) => activeTracks.some((track) => track.id === id)),
        endingTracks,
        playlistCount, // số đã clamp
        targetDurationMinutes, // số đã clamp
        priorityRatioMin, // từ UI (mặc định 0.65)
        priorityRatioMax, // từ UI (mặc định 0.8)
      }

      const result: BuildPlaylistsResult = await window.api.createPlaylists(options)
      setPlaylists(result.playlists)
      setWarnings(result.warnings ?? [])
      setExpandedPlaylistId(result.playlists[0]?.id || null)
      // Load pool stats sau khi tạo xong để cập nhật trạng thái mới
      await loadPoolStats(activeTracks)

      // Reset input về số đã chuẩn hóa sau khi tạo thành công
      if (playlistCount > 0 && targetDurationMinutes > 0) {
        setPlaylistCountInput(playlistCount.toString())
        // Chuyển đổi targetDurationMinutes thành giờ và phút để hiển thị
        const hours = Math.floor(targetDurationMinutes / 60)
        const minutes = targetDurationMinutes % 60
        setTargetHoursInput(hours.toString())
        setTargetMinutesInput(minutes.toString())
      }
    } catch (e: any) {
      setError(e?.message || 'Có lỗi xảy ra khi tạo playlist.')
    } finally {
      setLoading(false)
    }
  }

  if (!scanResult) {
    return (
      <div style={{ padding: '20px' }}>
        <h1 style={{ marginBottom: '20px', fontSize: '32px', fontWeight: 'bold' }}>
          Tạo playlist
        </h1>
        <p style={{ color: '#888', fontSize: '16px', lineHeight: '1.6' }}>
          Chưa có dữ liệu nhạc. Vui lòng vào mục 'Quét nhạc' để quét thư viện trước.
        </p>
      </div>
    )
  }

  // Filter tracks theo thể loại + search query
  const filteredTracks = activeTracks.filter((track) =>
    track.fileName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const endingTracks = endingTrackIds
    .map((id) => activeTracks.find((track) => track.id === id))
    .filter((track): track is ScannedTrack => Boolean(track))
  const endingDurationSec = endingTracks.reduce((sum, track) => sum + track.duration, 0)

  // Tính tổng thời lượng có thể
  const totalAvailableDuration = activeTracks.reduce((sum, track) => sum + track.duration, 0) - endingDurationSec
  const estimatedPlaylistsPossible =
    targetDurationMinutes > 0
      ? Math.floor(totalAvailableDuration / (targetDurationMinutes * 60))
      : 0

  return (
    <div style={{ padding: '20px', display: 'flex', gap: '20px', height: 'calc(100vh - 100px)' }}>
      {/* Bên trái: Danh sách bài hát */}
      <div style={{ flex: '0 0 400px', display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ marginBottom: '15px', fontSize: '20px', fontWeight: 'bold' }}>
          Danh sách bài hát ({activeTracks.length} bài, {pinnedTrackIds.length} ghim, {endingTrackIds.length} nhạc cuối)
        </h2>
        {availableGenres.length > 0 && (
          <select
            value={selectedGenreId}
            onChange={(e) => setSelectedGenreId(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              marginBottom: '10px',
              backgroundColor: '#1e1e1e',
              border: '1px solid #444',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '14px',
            }}
          >
            <option value="all">Tất cả thể loại ({scanResult.tracks.length} bài)</option>
            {availableGenres.map((genre) => (
              <option key={genre.id} value={genre.id}>
                {genre.name} ({genre.count} bài)
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          placeholder="Tìm kiếm theo tên bài..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            marginBottom: '15px',
            backgroundColor: '#1e1e1e',
            border: '1px solid #444',
            borderRadius: '4px',
            color: '#fff',
            fontSize: '14px',
          }}
        />
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            backgroundColor: '#252526',
            borderRadius: '6px',
            padding: '10px',
            border: '1px solid #444',
          }}
        >
          {filteredTracks.length === 0 ? (
            <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
              {searchQuery ? 'Không tìm thấy bài nào.' : 'Không có bài nào.'}
            </div>
          ) : (
            filteredTracks.map((track) => (
              <div
                key={track.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px',
                  borderBottom: '1px solid #333',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', marginRight: '10px', fontSize: '11px', color: '#aaa', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={pinnedTrackIds.includes(track.id)}
                    onChange={() => handleTogglePinned(track.id)}
                    style={{ cursor: 'pointer' }}
                  />
                  Ghim
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', marginRight: '10px', fontSize: '11px', color: '#ffcc88', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={endingTrackIds.includes(track.id)}
                    onChange={() => handleToggleEnding(track.id)}
                    style={{ cursor: 'pointer' }}
                  />
                  Cuối
                </label>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#ccc', fontSize: '14px' }}>{track.fileName}</div>
                  <div style={{ color: '#888', fontSize: '12px', marginTop: '2px' }}>
                    {track.folderType === 'priority' ? 'Ưu tiên' : 'Random'} • {track.genreName || 'Mặc định'} •{' '}
                    {formatDurationShort(track.duration)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pool Monitor — bên trong left panel, dưới danh sách bài */}
        {poolStats && (
          <div style={{ marginTop: '10px', backgroundColor: '#252526', border: '1px solid #444', borderRadius: '6px', padding: '10px', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#ccc' }}>
                Pool nhạc ({poolStats.total} bài)
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  onClick={() => setShowPoolDetail(v => !v)}
                  style={{ fontSize: '11px', padding: '2px 7px', backgroundColor: '#3a3a3a', color: '#aaa', border: '1px solid #555', borderRadius: '3px', cursor: 'pointer' }}
                >
                  {showPoolDetail ? 'Ẩn' : 'Chi tiết'}
                </button>
                <button
                  onClick={handleClearPool}
                  style={{ fontSize: '11px', padding: '2px 7px', backgroundColor: '#3a1f1f', color: '#ff8888', border: '1px solid #662222', borderRadius: '3px', cursor: 'pointer' }}
                >
                  Reset
                </button>
                <button
                  onClick={() => scanResult && loadPoolStats(activeTracks)}
                  disabled={poolLoading}
                  style={{ fontSize: '11px', padding: '2px 7px', backgroundColor: '#2a3a2a', color: '#88cc88', border: '1px solid #446644', borderRadius: '3px', cursor: 'pointer' }}
                >
                  {poolLoading ? '…' : 'R'}
                </button>
              </div>
            </div>
            {/* Tier counters */}
            <div style={{ display: 'flex', gap: '6px', fontSize: '11px' }}>
              <div style={{ flex: 1, backgroundColor: '#1e2e1e', borderRadius: '4px', padding: '5px 6px', textAlign: 'center' }}>
                <div style={{ color: '#66cc66', fontWeight: 'bold', fontSize: '15px' }}>{poolStats.tier0}</div>
                <div style={{ color: '#666', fontSize: '10px' }}>Chưa dùng</div>
              </div>
              <div style={{ flex: 1, backgroundColor: '#2e2e1e', borderRadius: '4px', padding: '5px 6px', textAlign: 'center' }}>
                <div style={{ color: '#ccaa44', fontWeight: 'bold', fontSize: '15px' }}>{poolStats.tier1}</div>
                <div style={{ color: '#666', fontSize: '10px' }}>&gt;7 ngày</div>
              </div>
              <div style={{ flex: 1, backgroundColor: '#2e1e1e', borderRadius: '4px', padding: '5px 6px', textAlign: 'center' }}>
                <div style={{ color: '#cc6644', fontWeight: 'bold', fontSize: '15px' }}>{poolStats.tier2}</div>
                <div style={{ color: '#666', fontSize: '10px' }}>Gần đây</div>
              </div>
            </div>
            {/* Progress bar */}
            {poolStats.total > 0 && (
              <div style={{ marginTop: '6px', height: '4px', borderRadius: '2px', overflow: 'hidden', display: 'flex', backgroundColor: '#333' }}>
                <div style={{ flex: poolStats.tier0, backgroundColor: '#3a6a3a', transition: 'flex 0.3s' }} />
                <div style={{ flex: poolStats.tier1, backgroundColor: '#6a5a1a', transition: 'flex 0.3s' }} />
                <div style={{ flex: poolStats.tier2, backgroundColor: '#6a2a1a', transition: 'flex 0.3s' }} />
              </div>
            )}
            {/* Chi tiết từng bài */}
            {showPoolDetail && poolStats.tracks.length > 0 && (
              <div style={{ marginTop: '8px', maxHeight: '180px', overflowY: 'auto', fontSize: '11px', borderTop: '1px solid #333', paddingTop: '6px' }}>
                {[...poolStats.tracks]
                  .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
                  .map(t => {
                    const color = t.tier === 0 ? '#66cc66' : t.tier === 1 ? '#ccaa44' : '#cc6644'
                    const label = t.tier === 0 ? 'Chưa dùng' : t.daysSinceUsed === 0 ? 'Hôm nay' : `${t.daysSinceUsed}n trước`
                    const track = scanResult?.tracks.find(s => s.id === t.id)
                    return (
                      <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #2a2a2a' }}>
                        <div style={{ color: '#bbb', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {track?.fileName ?? t.id.slice(0, 12) + '…'}
                        </div>
                        <div style={{ color, marginLeft: '8px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {label}{t.useCount > 0 ? ` ×${t.useCount}` : ''}
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bên phải: Cấu hình và preview */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <h1 style={{ marginBottom: '20px', fontSize: '32px', fontWeight: 'bold' }}>
          Tạo playlist
        </h1>

        {/* Cấu hình */}
        <div
          style={{
            padding: '20px',
            backgroundColor: '#252526',
            borderRadius: '6px',
            marginBottom: '20px',
          }}
        >
          <h3 style={{ marginBottom: '15px', fontSize: '18px', fontWeight: 'bold' }}>
            Cấu hình playlist
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', color: '#ccc' }}>
                Số playlist cần tạo
              </label>
              <NumericDraftInput
                min={1}
                integer
                allowBlank
                value={playlistCountInput === '' ? '' : Number(playlistCountInput)}
                onCommit={(value) => setPlaylistCountInput(value === '' ? '' : String(value))}
                style={{
                  width: '200px',
                  padding: '8px 12px',
                  backgroundColor: '#1e1e1e',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '14px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', color: '#ccc' }}>
                Thời lượng mỗi playlist (giờ / phút)
              </label>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <NumericDraftInput
                    min={0}
                    max={24}
                    integer
                    allowBlank
                    value={targetHoursInput === '' ? '' : Number(targetHoursInput)}
                    onCommit={(value) => setTargetHoursInput(value === '' ? '' : String(value))}
                    style={{
                      width: '100px',
                      padding: '8px 12px',
                      backgroundColor: '#1e1e1e',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#fff',
                      fontSize: '14px',
                    }}
                  />
                  <div style={{ color: '#888', fontSize: '12px', marginTop: '4px' }}>Giờ</div>
                </div>
                <div>
                  <NumericDraftInput
                    min={0}
                    integer
                    allowBlank
                    value={targetMinutesInput === '' ? '' : Number(targetMinutesInput)}
                    onCommit={(value) => setTargetMinutesInput(value === '' ? '' : String(value))}
                    style={{
                      width: '100px',
                      padding: '8px 12px',
                      backgroundColor: '#1e1e1e',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#fff',
                      fontSize: '14px',
                    }}
                  />
                  <div style={{ color: '#888', fontSize: '12px', marginTop: '4px' }}>Phút</div>
                </div>
                <div style={{ color: '#888', fontSize: '12px' }}>
                  Tổng: {targetDurationMinutes > 0 ? `${targetDurationMinutes} phút` : 'Nhập thời lượng hợp lệ (tối đa 24 giờ)'}
                </div>
              </div>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', color: '#ccc' }}>
                Tỷ lệ nhạc ưu tiên (%)
              </label>
              <NumericDraftInput
                min={0}
                max={100}
                step={1}
                allowBlank
                value={priorityRatioInput === '' ? '' : Number(priorityRatioInput)}
                onCommit={(value) => setPriorityRatioInput(value === '' ? '' : String(value))}
                placeholder="Để trống = mặc định 65-85%"
                style={{
                  width: '200px',
                  padding: '8px 12px',
                  backgroundColor: '#1e1e1e',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '14px',
                }}
              />
              <div style={{ color: '#888', fontSize: '11px', marginTop: '4px' }}>
                {priorityRatioInput 
                  ? `Nhạc ưu tiên: ${priorityRatioInput}%, Nhạc random: ${randomRatioPercent}%`
                  : 'Mặc định: 65-85% nhạc ưu tiên. Nhạc random sẽ tự động chiếm phần còn lại (15-35%).'}
              </div>
            </div>
            <div style={{ color: '#888', fontSize: '12px', lineHeight: '1.5' }}>
              Logic: bài đã chọn sẽ luôn nằm đầu playlist, sau đó là nhạc ưu tiên ({priorityRatioInput ? `${priorityRatioInput}%` : '65-85%'} thời lượng), cuối cùng là nhạc random ({priorityRatioInput ? `${randomRatioPercent}%` : '15-35%'}). Nhạc cuối nối thêm sau target chính.
            </div>
            {endingTrackIds.length > 0 && (
              <div style={{ color: '#ffcc88', fontSize: '12px' }}>
                Nhạc cuối: {endingTrackIds.length} bài • {formatDuration(endingDurationSec)}. Output dự kiến dài hơn target chính từng playlist.
              </div>
            )}
            {estimatedPlaylistsPossible < playlistCount && (
              <div
                style={{
                  padding: '10px',
                  backgroundColor: '#3a3a1f',
                  border: '1px solid #ffaa00',
                  borderRadius: '4px',
                  color: '#ffcc88',
                  fontSize: '12px',
                }}
              >
                Cảnh báo: Thể loại đang chọn không đủ số bài khác nhau để đạt đúng thời lượng cho tất cả playlist. Một số bài có thể được lặp lại (nhưng sẽ không lặp liên tiếp).
              </div>
            )}
            <button
              onClick={handleCreatePlaylists}
              disabled={loading || invalidConfig}
              style={{
                padding: '12px 24px',
                backgroundColor: loading || invalidConfig ? '#555' : '#007acc',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: loading || invalidConfig ? 'not-allowed' : 'pointer',
                fontSize: '16px',
                fontWeight: 'bold',
                width: '200px',
              }}
            >
              {loading ? 'Đang tạo...' : 'Tạo playlist'}
            </button>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div
            style={{
              padding: '15px',
              backgroundColor: '#3a1f1f',
              border: '1px solid #ff4444',
              borderRadius: '6px',
              color: '#ff8888',
              marginBottom: '20px',
            }}
          >
            {error}
          </div>
        )}

        {/* Warnings từ backend (sau khi tạo playlist) */}
        {warnings.length > 0 && (
          <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {warnings.map((w, i) => (
              <div
                key={i}
                style={{
                  padding: '10px 14px',
                  backgroundColor: w.type === 'insufficient_tracks' ? '#3a1f1f' : '#3a3a1f',
                  border: `1px solid ${w.type === 'insufficient_tracks' ? '#ff6666' : '#ffaa00'}`,
                  borderRadius: '4px',
                  color: w.type === 'insufficient_tracks' ? '#ff9999' : '#ffcc88',
                  fontSize: '12px',
                  lineHeight: '1.5',
                }}
              >
                {w.playlistIndex != null ? `Playlist ${w.playlistIndex + 1}: ` : ''}
                {w.message}
              </div>
            ))}
          </div>
        )}

        {/* Preview kết quả */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {playlists.length > 0 && (
            <div>
              <h2 style={{ marginBottom: '20px', fontSize: '24px', fontWeight: 'bold' }}>
                Kết quả ({playlists.length} playlist)
              </h2>
              {playlists.map((playlist) => {
                const mainDurationSec = Math.max(playlist.totalDurationSec - (playlist.endingDurationSec ?? 0), 0)
                const priorityPercent = mainDurationSec > 0
                  ? ((playlist.priorityDurationSec / mainDurationSec) * 100).toFixed(1)
                  : '0.0'
                const randomPercent = mainDurationSec > 0
                  ? ((playlist.randomDurationSec / mainDurationSec) * 100).toFixed(1)
                  : '0.0'
                const isExpanded = expandedPlaylistId === playlist.id

                return (
                  <div
                    key={playlist.id}
                    style={{
                      marginBottom: '15px',
                      backgroundColor: '#252526',
                      borderRadius: '6px',
                      border: '1px solid #444',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Header */}
                    <div
                      style={{
                        padding: '15px',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        backgroundColor: isExpanded ? '#2d2d2d' : '#252526',
                      }}
                      onClick={() =>
                        setExpandedPlaylistId(isExpanded ? null : playlist.id)
                      }
                    >
                      <div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '5px' }}>
                          {playlist.name}
                        </div>
                        <div style={{ fontSize: '14px', color: '#888' }}>
                          Thời lượng: {formatDuration(playlist.totalDurationSec)} • Main: {formatDuration(mainDurationSec)} • Nhạc cuối: {playlist.endingCount ?? 0} • Số bài:{' '}
                          {playlist.tracks.length} • Ưu tiên: {priorityPercent}%, Random:{' '}
                          {randomPercent}%
                        </div>
                      </div>
                      <div style={{ color: '#888', fontSize: '20px' }}>
                        {isExpanded ? 'v' : '>'}
                      </div>
                    </div>

                    {/* Content */}
                    {isExpanded && (
                      <div style={{ padding: '15px', borderTop: '1px solid #444' }}>
                        <div
                          style={{
                            overflowX: 'auto',
                            backgroundColor: '#1e1e1e',
                            borderRadius: '4px',
                          }}
                        >
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #444', backgroundColor: '#252526' }}>
                                <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>
                                  #
                                </th>
                                <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>
                                  Tên bài
                                </th>
                                <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>
                                  Loại
                                </th>
                                <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>
                                  Thời lượng
                                </th>
                                <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>
                                  Tích lũy
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {playlist.tracks.map((track) => {
                                const isPinned = pinnedTrackIds.includes(track.id)
                                let typeLabel = track.role === 'ending' ? 'Nhạc cuối' : (track.folderType === 'priority' ? 'Ưu tiên' : 'Random')
                                if (isPinned && track.role !== 'ending') {
                                  typeLabel = `Pinned${track.folderType === 'priority' ? ' + Ưu tiên' : ''}`
                                }

                                return (
                                  <tr key={track.id} style={{ borderBottom: '1px solid #333' }}>
                                    <td style={{ padding: '10px', color: '#ccc' }}>
                                      {track.order}
                                    </td>
                                    <td style={{ padding: '10px', color: '#ccc' }}>
                                      {track.fileName}
                                    </td>
                                    <td style={{ padding: '10px', color: '#ccc' }}>{typeLabel}</td>
                                    <td style={{ padding: '10px', color: '#ccc' }}>
                                      {formatDurationShort(track.duration)}
                                    </td>
                                    <td style={{ padding: '10px', color: '#ccc' }}>
                                      {formatDurationShort(track.cumulativeDuration)}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default CreatePlaylistPage

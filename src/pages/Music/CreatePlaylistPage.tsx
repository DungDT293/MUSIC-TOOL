import { useState, useEffect } from 'react'
import {
  ScanMusicResult,
  BuildPlaylistsOptions,
  PlaylistDefinition,
  ScannedTrack,
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

function CreatePlaylistPage() {
  const [scanResult, setScanResult] = useState<ScanMusicResult | null>(null)
  const [pinnedTrackIds, setPinnedTrackIds] = useState<string[]>([])
  const [playlistCountInput, setPlaylistCountInput] = useState<string>('5')
  const [targetHoursInput, setTargetHoursInput] = useState<string>('0')
  const [targetMinutesInput, setTargetMinutesInput] = useState<string>('30')
  const [priorityRatioInput, setPriorityRatioInput] = useState<string>('') // % nhạc ưu tiên (để trống = dùng mặc định 65-85%)
  const [playlists, setPlaylists] = useState<PlaylistDefinition[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
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
  const minutesValid = Number.isFinite(parsedTargetMinutes) && parsedTargetMinutes >= 0 && parsedTargetMinutes <= 59

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

  // Load scanResult từ localStorage
  useEffect(() => {
    const raw = localStorage.getItem('scanResultV1')
    if (!raw) {
      // Không có scanResult → reset playlists
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
  }, [])

  // Reset playlists khi scanResult thay đổi (quét nhạc mới)
  useEffect(() => {
    // Mỗi khi scanResult thay đổi → reset playlists
    // Playlist chỉ được tạo khi user bấm "Tạo playlist"
    setPlaylists([])
  }, [scanResult])

  // Listen for custom event khi Tab 1 quét nhạc mới (trong cùng window)
  useEffect(() => {
    const handleMusicScanCompleted = (e: CustomEvent<ScanMusicResult>) => {
      // Quét nhạc mới → reset playlists và update scanResult
      setPlaylists([])
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
        return [...prev, trackId]
      }
    })
  }

  const handleCreatePlaylists = async () => {
    if (!scanResult) return

    if (invalidConfig) {
      setError('Vui lòng nhập số playlist và thời lượng hợp lệ.')
      return
    }

    setError(null)
    setLoading(true)
    setPlaylists([])

    try {
      const options: BuildPlaylistsOptions = {
        tracks: scanResult.tracks,
        pinnedTrackIds,
        playlistCount, // số đã clamp
        targetDurationMinutes, // số đã clamp
        priorityRatioMin, // từ UI (mặc định 0.65)
        priorityRatioMax, // từ UI (mặc định 0.8)
      }

      const result = await window.api.createPlaylists(options)
      setPlaylists(result)
      setExpandedPlaylistId(result[0]?.id || null)

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

  // Filter tracks theo search query
  const filteredTracks = scanResult.tracks.filter((track) =>
    track.fileName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Tính tổng thời lượng có thể
  const totalAvailableDuration = scanResult.summary.totalDuration
  const estimatedPlaylistsPossible =
    targetDurationMinutes > 0
      ? Math.floor(totalAvailableDuration / (targetDurationMinutes * 60))
      : 0

  return (
    <div style={{ padding: '20px', display: 'flex', gap: '20px', height: 'calc(100vh - 100px)' }}>
      {/* Bên trái: Danh sách bài hát */}
      <div style={{ flex: '0 0 400px', display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ marginBottom: '15px', fontSize: '20px', fontWeight: 'bold' }}>
          Danh sách bài hát ({pinnedTrackIds.length} đã chọn)
        </h2>
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
                <input
                  type="checkbox"
                  checked={pinnedTrackIds.includes(track.id)}
                  onChange={() => handleTogglePinned(track.id)}
                  style={{ marginRight: '10px', cursor: 'pointer' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#ccc', fontSize: '14px' }}>{track.fileName}</div>
                  <div style={{ color: '#888', fontSize: '12px', marginTop: '2px' }}>
                    {track.folderType === 'priority' ? 'Ưu tiên' : 'Random'} •{' '}
                    {formatDurationShort(track.duration)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
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
              <input
                type="number"
                min="1"
                value={playlistCountInput}
                onChange={(e) => {
                  const v = e.target.value
                  // Cho phép rỗng
                  if (v === '') {
                    setPlaylistCountInput('')
                    return
                  }
                  // Chỉ nhận số nguyên dương
                  if (/^\d+$/.test(v)) {
                    setPlaylistCountInput(v)
                  }
                }}
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
                  <input
                    type="number"
                    min="0"
                    max="24"
                    value={targetHoursInput}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === '') {
                        setTargetHoursInput('')
                        return
                      }
                      if (/^\d+$/.test(v)) {
                        const num = parseInt(v, 10)
                        if (num >= 0 && num <= 24) {
                        setTargetHoursInput(v)
                          // KHÔNG tự động thay đổi phút khi nhập giờ
                        }
                      }
                    }}
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
                  <input
                    type="number"
                    min="0"
                    value={targetMinutesInput}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === '') {
                        setTargetMinutesInput('')
                        return
                      }
                      if (/^\d+$/.test(v)) {
                        const num = parseInt(v, 10)
                        if (num >= 0) {
                          // Nếu phút >= 60, tự động convert thành giờ + phút
                          if (num >= 60) {
                            const hours = Math.floor(num / 60)
                            const minutes = num % 60
                            const currentHours = targetHoursInput === '' ? 0 : parseInt(targetHoursInput, 10)
                            const newHours = currentHours + hours
                            
                            // Giới hạn tổng giờ <= 24
                            if (newHours <= 24) {
                              setTargetHoursInput(newHours.toString())
                              setTargetMinutesInput(minutes.toString())
                            } else {
                              // Nếu vượt quá 24 giờ, chỉ set phút tối đa có thể
                              const maxMinutes = (24 - currentHours) * 60 + minutes
                              if (maxMinutes >= 0) {
                                setTargetMinutesInput(Math.min(maxMinutes, 59).toString())
                              }
                            }
                          } else {
                            // Phút < 60, chỉ set phút
                        setTargetMinutesInput(v)
                          }
                        }
                      }
                    }}
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
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={priorityRatioInput}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '') {
                    setPriorityRatioInput('')
                    return
                  }
                  if (/^\d*\.?\d*$/.test(v)) {
                    const num = parseFloat(v)
                    if (num >= 0 && num <= 100) {
                      setPriorityRatioInput(v)
                    }
                  }
                }}
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
              Logic: bài đã chọn sẽ luôn nằm đầu playlist, sau đó là nhạc ưu tiên ({priorityRatioInput ? `${priorityRatioInput}%` : '65-85%'} thời lượng), cuối cùng là nhạc random ({priorityRatioInput ? `${randomRatioPercent}%` : '15-35%'}).
            </div>
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
                Cảnh báo: Không đủ số bài khác nhau để đạt đúng thời lượng cho tất cả playlist. Một số bài có thể được lặp lại (nhưng sẽ không lặp liên tiếp).
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

        {/* Preview kết quả */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {playlists.length > 0 && (
            <div>
              <h2 style={{ marginBottom: '20px', fontSize: '24px', fontWeight: 'bold' }}>
                Kết quả ({playlists.length} playlist)
              </h2>
              {playlists.map((playlist) => {
                const priorityPercent = (
                  (playlist.priorityDurationSec / playlist.totalDurationSec) *
                  100
                ).toFixed(1)
                const randomPercent = (
                  (playlist.randomDurationSec / playlist.totalDurationSec) *
                  100
                ).toFixed(1)
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
                          Thời lượng: {formatDuration(playlist.totalDurationSec)} • Số bài:{' '}
                          {playlist.tracks.length} • Ưu tiên: {priorityPercent}%, Random:{' '}
                          {randomPercent}%
                        </div>
                      </div>
                      <div style={{ color: '#888', fontSize: '20px' }}>
                        {isExpanded ? '▼' : '▶'}
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
                                let typeLabel = track.folderType === 'priority' ? 'Ưu tiên' : 'Random'
                                if (isPinned) {
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

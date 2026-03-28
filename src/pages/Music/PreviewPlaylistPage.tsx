import { useState, useEffect, useRef, useCallback } from 'react'
import { PlaylistDefinition, PlaylistTrack } from '../../types/ipc'

function formatDuration(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDurationShort(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function PreviewPlaylistPage() {
  const [playlists, setPlaylists] = useState<PlaylistDefinition[]>([])
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState<number>(0)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [currentDuration, setCurrentDuration] = useState<number>(0)
  const [audioError, setAudioError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Load playlists từ backend
  useEffect(() => {
    let mounted = true

    window.api
      .listPlaylists()
      .then((data) => {
        if (!mounted) return
        setPlaylists(data || [])
        if (data && data.length > 0 && !selectedPlaylistId) {
          setSelectedPlaylistId(data[0].id)
        }
      })
      .catch((err) => {
        console.error('[PreviewPlaylist] listPlaylists error', err)
      })

    return () => {
      mounted = false
    }
  }, [])

  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId) || null

  // Reset audio khi đổi playlist
  useEffect(() => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.src = ''
    }
    setIsPlaying(false)
    setCurrentTime(0)
    setCurrentDuration(0)
    setCurrentIndex(0)
    setAudioError(null)
  }, [selectedPlaylistId])

  // Helper: convert file path to file:// URL (IPC main process)
  async function getFileUrl(filePath: string): Promise<string> {
    try {
      if (!filePath) return ''

      if (window.api && typeof window.api.toFileUrl === 'function') {
        const viaPreload = await window.api.toFileUrl(filePath)
        if (viaPreload && viaPreload.startsWith('file:')) {
          console.log('[PreviewPlaylist] getFileUrl using IPC', { filePath, url: viaPreload })
          return viaPreload
        }
      }

      const normalized = filePath.replace(/\\/g, '/')
      const encoded = encodeURI(normalized)
      const url = `file:///${encoded}`
      console.log('[PreviewPlaylist] getFileUrl using fallback', { filePath, url })
      return url
    } catch (err) {
      console.error('[PreviewPlaylist] getFileUrl error', filePath, err)
      return ''
    }
  }

  // Play track tại index
  const playTrack = useCallback(
    async (index: number) => {
      if (!selectedPlaylist) return

      const tracks = selectedPlaylist.tracks
      if (index < 0 || index >= tracks.length) return

      const track = tracks[index]
      const audio = audioRef.current
      if (!audio) return

      // Dừng bài cũ trước
      audio.pause()
      audio.currentTime = 0
      setIsPlaying(false)

      const fileUrl = await getFileUrl(track.path)
      if (!fileUrl) {
        console.error('[PreviewPlaylist] Empty fileUrl for path', track.path)
        setAudioError('Không tạo được file URL cho bài hát. Kiểm tra console.')
        setIsPlaying(false)
        return
      }

      console.log('[PreviewPlaylist] playTrack', { index, path: track.path, fileUrl })

      setAudioError(null) // clear lỗi cũ
      audio.src = fileUrl

      // đảm bảo browser/electron load metadata lại
      audio.load()

      const playPromise = audio.play()
      playPromise
        .then(() => {
          setCurrentIndex(index)
          setIsPlaying(true)
          // ưu tiên duration từ track, fallback sang audio.duration nếu có
          const duration =
            typeof track.duration === 'number' && track.duration > 0
              ? track.duration
              : audio.duration && isFinite(audio.duration)
                ? audio.duration
                : 0
          setCurrentDuration(duration)
        })
        .catch((err) => {
          console.error('[PreviewPlaylist] play() error', err)
          setIsPlaying(false)
          setAudioError('Không phát được bài này (xem console để biết chi tiết).')
        })
    },
    [selectedPlaylist]
  )

  // Next track
  const handleNext = useCallback(() => {
    if (!selectedPlaylist) return

    const nextIndex = currentIndex + 1
    if (nextIndex < selectedPlaylist.tracks.length) {
      playTrack(nextIndex)
    } else {
      // Hết playlist → dừng
      setIsPlaying(false)
    }
  }, [selectedPlaylist, currentIndex, playTrack])

  // Prev track
  const handlePrev = useCallback(() => {
    if (!selectedPlaylist) return

    const prevIndex = currentIndex - 1
    if (prevIndex >= 0) {
      playTrack(prevIndex)
    }
  }, [selectedPlaylist, currentIndex, playTrack])

  // Toggle play/pause
  const handleTogglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !selectedPlaylist) return

    if (!isPlaying) {
      setAudioError(null)
      // Nếu chưa có src, play bài currentIndex
      if (!audio.src) {
        playTrack(currentIndex)
      } else {
        audio
          .play()
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.error('[PreviewPlaylist] resume play error', err)
            setAudioError('Không phát được audio, xem console để biết thêm chi tiết.')
            setIsPlaying(false)
          })
      }
    } else {
      audio.pause()
      setIsPlaying(false)
    }
  }, [isPlaying, selectedPlaylist, currentIndex, playTrack])

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0)
      if (!currentDuration && audio.duration && isFinite(audio.duration)) {
        setCurrentDuration(audio.duration)
      }
    }

    const onEnded = () => {
      handleNext()
    }

    const onError = () => {
      const mediaError = audio.error
      console.error('[PreviewPlaylist] audio error', mediaError)
      setAudioError('Lỗi audio (không mở được file hoặc đường dẫn không hợp lệ).')
      setIsPlaying(false)
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [handleNext, currentDuration])

  // Tính tỷ lệ priority/random
  const getPriorityPercent = (playlist: PlaylistDefinition): string => {
    if (playlist.totalDurationSec === 0) return '0.0'
    return ((playlist.priorityDurationSec / playlist.totalDurationSec) * 100).toFixed(1)
  }

  const getRandomPercent = (playlist: PlaylistDefinition): string => {
    if (playlist.totalDurationSec === 0) return '0.0'
    return ((playlist.randomDurationSec / playlist.totalDurationSec) * 100).toFixed(1)
  }

  const currentTrack = selectedPlaylist?.tracks[currentIndex] || null

  return (
    <div style={{ padding: '20px', display: 'flex', gap: '20px', height: 'calc(100vh - 100px)' }}>
      {/* Cột trái: Danh sách playlist */}
      <div style={{ flex: '0 0 350px', display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ marginBottom: '15px', fontSize: '20px', fontWeight: 'bold' }}>
          Danh sách playlist
        </h2>
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
          {playlists.length === 0 ? (
            <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
              Chưa có playlist nào. Vui lòng tạo playlist ở mục "Tạo playlist".
            </div>
          ) : (
            playlists.map((playlist) => {
              const isSelected = playlist.id === selectedPlaylistId
              return (
                <div
                  key={playlist.id}
                  onClick={() => setSelectedPlaylistId(playlist.id)}
                  style={{
                    padding: '15px',
                    marginBottom: '10px',
                    backgroundColor: isSelected ? '#007acc' : '#1e1e1e',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    border: isSelected ? '2px solid #0099ff' : '1px solid #444',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '5px' }}>
                    {playlist.name}
                  </div>
                  <div style={{ fontSize: '12px', color: isSelected ? '#fff' : '#888' }}>
                    Thời lượng: {formatDuration(playlist.totalDurationSec)} • {playlist.tracks.length}{' '}
                    bài • Ưu tiên: {getPriorityPercent(playlist)}%, Random:{' '}
                    {getRandomPercent(playlist)}%
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Cột phải: Chi tiết playlist + Mini player */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <h1 style={{ marginBottom: '20px', fontSize: '32px', fontWeight: 'bold' }}>
          Nghe thử playlist
        </h1>

        {!selectedPlaylist ? (
          <div
            style={{
              padding: '40px',
              textAlign: 'center',
              color: '#888',
              fontSize: '16px',
            }}
          >
            Hãy chọn một playlist ở bên trái để xem chi tiết và nghe thử.
          </div>
        ) : (
          <>
            {/* Header */}
            <div
              style={{
                padding: '20px',
                backgroundColor: '#252526',
                borderRadius: '6px',
                marginBottom: '20px',
              }}
            >
              <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '10px' }}>
                {selectedPlaylist.name}
              </div>
              <div style={{ fontSize: '14px', color: '#888' }}>
                Thời lượng: {formatDuration(selectedPlaylist.totalDurationSec)} • Số bài:{' '}
                {selectedPlaylist.tracks.length} • Ưu tiên: {getPriorityPercent(selectedPlaylist)}%,
                Random: {getRandomPercent(selectedPlaylist)}%
              </div>
            </div>

            {/* Bảng tracks */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                backgroundColor: '#252526',
                borderRadius: '6px',
                padding: '10px',
                marginBottom: '100px', // Space cho mini player
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #444', backgroundColor: '#1e1e1e' }}>
                    <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>#</th>
                    <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>Tên bài</th>
                    <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>Loại</th>
                    <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>Thời lượng</th>
                    <th style={{ padding: '10px', textAlign: 'left', color: '#888' }}>Tích lũy</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPlaylist.tracks.map((track, index) => {
                    const isCurrentTrack = index === currentIndex
                    return (
                      <tr
                        key={track.id}
                        style={{
                          borderBottom: '1px solid #333',
                          backgroundColor: isCurrentTrack ? '#007acc33' : 'transparent',
                          cursor: 'pointer',
                        }}
                        onClick={() => playTrack(index)}
                      >
                        <td style={{ padding: '10px', color: '#ccc' }}>{track.order}</td>
                        <td style={{ padding: '10px', color: '#ccc' }}>{track.fileName}</td>
                        <td style={{ padding: '10px', color: '#ccc' }}>
                          {track.folderType === 'priority' ? 'Ưu tiên' : 'Random'}
                        </td>
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

            {/* Mini Audio Player (fixed ở dưới) */}
            <div
              style={{
                position: 'fixed',
                bottom: 0,
                left: '250px', // Sidebar width
                right: 0,
                height: '100px',
                backgroundColor: '#1e1e1e',
                borderTop: '1px solid #444',
                padding: '15px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: '20px',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', color: '#ccc', marginBottom: '5px' }}>
                  Đang phát:{' '}
                  {currentTrack ? currentTrack.fileName : 'Chưa phát'}
                </div>
                <div style={{ fontSize: '12px', color: '#888' }}>
                  Thời gian: {formatDurationShort(currentTime)} /{' '}
                  {formatDurationShort(currentDuration)}
                </div>
                {audioError && (
                  <div style={{ color: '#ff8888', fontSize: '12px', marginTop: '4px' }}>
                    {audioError}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  onClick={handlePrev}
                  disabled={!selectedPlaylist || currentIndex === 0}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#252526',
                    color: '#fff',
                    border: '1px solid #444',
                    borderRadius: '4px',
                    cursor: !selectedPlaylist || currentIndex === 0 ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    opacity: !selectedPlaylist || currentIndex === 0 ? 0.5 : 1,
                  }}
                >
                  « Trước
                </button>
                <button
                  onClick={handleTogglePlay}
                  disabled={!selectedPlaylist}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#007acc',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: !selectedPlaylist ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    minWidth: '80px',
                  }}
                >
                  {isPlaying ? '❚❚ Tạm dừng' : '▶ Phát'}
                </button>
                <button
                  onClick={handleNext}
                  disabled={
                    !selectedPlaylist ||
                    currentIndex >= selectedPlaylist.tracks.length - 1
                  }
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#252526',
                    color: '#fff',
                    border: '1px solid #444',
                    borderRadius: '4px',
                    cursor:
                      !selectedPlaylist || currentIndex >= selectedPlaylist.tracks.length - 1
                        ? 'not-allowed'
                        : 'pointer',
                    fontSize: '14px',
                    opacity:
                      !selectedPlaylist || currentIndex >= selectedPlaylist.tracks.length - 1
                        ? 0.5
                        : 1,
                  }}
                >
                  » Sau
                </button>
              </div>
            </div>

            {/* Audio element (ẩn) */}
            <audio ref={audioRef} style={{ display: 'none' }} />
          </>
        )}
      </div>
    </div>
  )
}

export default PreviewPlaylistPage

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

const tracksForGenre = getActiveTracks

function getOpeningTracksForGenre(scanResult: ScanMusicResult | null, genreId: string): ScannedTrack[] {
  if (!scanResult) return []
  const genreSpecific = scanResult.tracks.filter(
    (track) => track.folderType === 'opening' && track.genreId === genreId
  )
  if (genreSpecific.length > 0) return genreSpecific
  return scanResult.tracks.filter(
    (track) => track.folderType === 'opening' && (!track.genreId || track.genreId === 'default' || genreId === 'all')
  )
}

function getBackgroundTracksForGenre(scanResult: ScanMusicResult | null, genreId: string): ScannedTrack[] {
  if (!scanResult) return []
  const genreSpecific = scanResult.tracks.filter(
    (track) => track.folderType === 'background' && track.genreId === genreId
  )
  if (genreSpecific.length > 0) return genreSpecific
  return scanResult.tracks.filter(
    (track) => track.folderType === 'background' && (!track.genreId || track.genreId === 'default' || genreId === 'all')
  )
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

interface GenreConfigItem {
  playlistCount: string
  hours: string
  minutes: string
  priority: string
  crossfade: boolean
  crossfadeSeconds: string
  loudnorm: boolean
  pinnedTrackIds: string[]
  endingTrackIds: string[]
  pinnedOpeningTrackIds: string[]
  combineAllPinnedOpenings?: boolean
  selectedBackgroundTrackId?: string
  bgMusicVolumeDb?: number
  mainMusicVolumeDb?: number
}

function CreatePlaylistPage() {
  const [scanResult, setScanResult] = useState<ScanMusicResult | null>(null)
  const [pinnedTrackIds, setPinnedTrackIds] = useState<string[]>([])
  const [endingTrackIds, setEndingTrackIds] = useState<string[]>([])
  const [pinnedOpeningTrackIds, setPinnedOpeningTrackIds] = useState<string[]>([])
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
  const [genrePlaylists, setGenrePlaylists] = useState<Record<string, PlaylistDefinition[]>>({})
  const [genreErrors, setGenreErrors] = useState<Record<string, string>>({})
  const [creatingGenreId, setCreatingGenreId] = useState<string | null>(null)
  const [isCreatingAllGenres, setIsCreatingAllGenres] = useState(false)
  const [settingsSavedAt, setSettingsSavedAt] = useState<string | null>(null)
  const [showPlaylistGuide, setShowPlaylistGuide] = useState(false)
  const [genreConfig, setGenreConfig] = useState<Record<string, GenreConfigItem>>({})
  const [genreOpeningSearch, setGenreOpeningSearch] = useState<Record<string, string>>({})
  const [genrePinnedSearch, setGenrePinnedSearch] = useState<Record<string, string>>({})
  const [genreEndingSearch, setGenreEndingSearch] = useState<Record<string, string>>({})
  const [previewLoadingGenreId, setPreviewLoadingGenreId] = useState<string | null>(null)
  const [previewUrlMap, setPreviewUrlMap] = useState<Record<string, string>>({})
  const [previewErrorMap, setPreviewErrorMap] = useState<Record<string, string>>({})
  const GENRE_WORKSPACE_KEY = 'musicGenreWorkspaceV1'

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
    try {
      const raw = localStorage.getItem(GENRE_WORKSPACE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved?.genrePlaylists) setGenrePlaylists(saved.genrePlaylists)
      if (saved?.genreConfig) setGenreConfig(saved.genreConfig)
    } catch (workspaceError) {
      console.warn('[CreatePlaylist] Failed to load genre workspace:', workspaceError)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(GENRE_WORKSPACE_KEY, JSON.stringify({ genrePlaylists, genreConfig }))
  }, [genrePlaylists, genreConfig])

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
  const openingTracks = activeTracks.filter((track) => track.folderType === 'opening')
  const bodyTracks = activeTracks.filter((track) => track.folderType !== 'opening')

  // Reset playlists khi scanResult/thể loại thay đổi
  useEffect(() => {
    const validGenreIds = availableGenres.map((genre) => genre.id)
    if (selectedGenreId !== 'all' && !validGenreIds.includes(selectedGenreId)) {
      setSelectedGenreId('all')
      return
    }

    setPlaylists([])
    setWarnings([])
    setPinnedTrackIds((ids) => ids.filter((id) => bodyTracks.some((track) => track.id === id)))
    setEndingTrackIds((ids) => ids.filter((id) => bodyTracks.some((track) => track.id === id)))
    setPinnedOpeningTrackIds((ids) => ids.filter((id) => openingTracks.some((track) => track.id === id)))
    if (scanResult) loadPoolStats(bodyTracks)
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
    if (scanResult) await loadPoolStats(bodyTracks)
  }

  const getGenreConfig = (genreId: string): GenreConfigItem => {
    const cfg = genreConfig[genreId]
    return {
      playlistCount: cfg?.playlistCount ?? playlistCountInput,
      hours: cfg?.hours ?? targetHoursInput,
      minutes: cfg?.minutes ?? targetMinutesInput,
      priority: cfg?.priority ?? priorityRatioInput,
      crossfade: cfg?.crossfade ?? false,
      crossfadeSeconds: cfg?.crossfadeSeconds ?? '4',
      loudnorm: cfg?.loudnorm ?? false,
      pinnedTrackIds: cfg?.pinnedTrackIds ?? [],
      endingTrackIds: cfg?.endingTrackIds ?? [],
      pinnedOpeningTrackIds: cfg?.pinnedOpeningTrackIds ?? [],
      combineAllPinnedOpenings: cfg?.combineAllPinnedOpenings ?? false,
      selectedBackgroundTrackId: cfg?.selectedBackgroundTrackId ?? '',
      bgMusicVolumeDb: typeof cfg?.bgMusicVolumeDb === 'number' ? cfg.bgMusicVolumeDb : -4,
      mainMusicVolumeDb: typeof cfg?.mainMusicVolumeDb === 'number' ? cfg.mainMusicVolumeDb : 2,
    }
  }

  const updateGenreConfig = (genreId: string, patch: Partial<ReturnType<typeof getGenreConfig>>) => {
    setGenreConfig((prev) => ({ ...prev, [genreId]: { ...getGenreConfig(genreId), ...patch } }))
  }

  const handlePreviewMix = async (genreId: string) => {
    if (!scanResult) return
    const cfg = getGenreConfig(genreId)
    const genreBgTracks = getBackgroundTracksForGenre(scanResult, genreId)
    if (genreBgTracks.length === 0) return

    const bgTrack = (cfg.selectedBackgroundTrackId
      ? genreBgTracks.find((t) => t.id === cfg.selectedBackgroundTrackId)
      : null) || genreBgTracks[0]

    const genreMainTracks = tracksForGenre(scanResult, genreId).filter((t) => t.folderType !== 'background')
    const sampleMain = (cfg.pinnedTrackIds.length > 0
      ? genreMainTracks.find((t) => cfg.pinnedTrackIds.includes(t.id))
      : null) || genreMainTracks[0]

    if (!sampleMain) {
      setPreviewErrorMap((prev) => ({ ...prev, [genreId]: 'Thể loại này chưa có bài nhạc chính để nghe thử hòa âm.' }))
      return
    }

    if (!bgTrack) {
      setPreviewErrorMap((prev) => ({ ...prev, [genreId]: 'Không tìm thấy file nhạc nền.' }))
      return
    }

    setPreviewLoadingGenreId(genreId)
    setPreviewErrorMap((prev) => ({ ...prev, [genreId]: '' }))

    try {
      if (!window.api?.music?.previewMix) {
        throw new Error('Chức năng nghe thử hòa âm chưa được hỗ trợ trên hệ thống.')
      }
      const res = await window.api.music.previewMix({
        mainTrackPath: sampleMain.path,
        bgTrackPath: bgTrack.path,
        mainVolumeDb: typeof cfg.mainMusicVolumeDb === 'number' ? cfg.mainMusicVolumeDb : 2,
        bgMusicVolumeDb: typeof cfg.bgMusicVolumeDb === 'number' ? cfg.bgMusicVolumeDb : -4,
        durationSec: 20,
      })

      if (res.success && res.previewUrl) {
        setPreviewUrlMap((prev) => ({ ...prev, [genreId]: res.previewUrl! }))
      } else {
        setPreviewErrorMap((prev) => ({ ...prev, [genreId]: res.error || 'Không tạo được đoạn nghe thử.' }))
      }
    } catch (err: any) {
      setPreviewErrorMap((prev) => ({ ...prev, [genreId]: err?.message || String(err) }))
    } finally {
      setPreviewLoadingGenreId(null)
    }
  }

  const handleStopPreview = (genreId: string) => {
    setPreviewUrlMap((prev) => {
      const next = { ...prev }
      delete next[genreId]
      return next
    })
    setPreviewErrorMap((prev) => ({ ...prev, [genreId]: '' }))
  }

  const handleSaveGenreSettings = () => {
    localStorage.setItem(GENRE_WORKSPACE_KEY, JSON.stringify({ genrePlaylists, genreConfig }))
    setSettingsSavedAt(new Date().toLocaleTimeString('vi-VN'))
  }

  const handleRecreateAllGenres = async () => {
    if (isCreatingAllGenres || creatingGenreId || availableGenres.length === 0) return
    setIsCreatingAllGenres(true)
    try {
      for (const genre of availableGenres) {
        await handleCreateGenrePlaylists(genre.id)
      }
    } finally {
      setIsCreatingAllGenres(false)
    }
  }

  const handleCreateGenrePlaylists = async (genreId: string) => {
    if (!scanResult) return
    const genre = availableGenres.find((item) => item.id === genreId)
    if (!genre) return
    const tracks = getActiveTracks(scanResult, genreId)
    const body = tracks.filter((track) => track.folderType !== 'opening' && track.folderType !== 'background')
    if (body.length === 0) {
      setGenreErrors((prev) => ({ ...prev, [genreId]: 'Thể loại này không có bài nhạc chính.' }))
      return
    }
    const config = getGenreConfig(genreId)
    const count = Number(config.playlistCount)
    const minutes = Number(config.hours) * 60 + Number(config.minutes)
    const priority = config.priority ? Number(config.priority) / 100 : undefined
    if (!Number.isInteger(count) || count < 1 || !Number.isFinite(minutes) || minutes <= 0) {
      setGenreErrors((prev) => ({ ...prev, [genreId]: 'Nhập số playlist và thời lượng hợp lệ.' }))
      return
    }

    const genreOpening = getOpeningTracksForGenre(scanResult, genreId)
    const validPinnedOpeningIds = config.pinnedOpeningTrackIds.filter((id) =>
      genreOpening.some((t) => t.id === id)
    )
    const selectedOpeningTracks = validPinnedOpeningIds.length > 0
      ? genreOpening.filter((t) => validPinnedOpeningIds.includes(t.id))
      : genreOpening

    const genreBackground = getBackgroundTracksForGenre(scanResult, genreId)

    setCreatingGenreId(genreId)
    setGenreErrors((prev) => ({ ...prev, [genreId]: '' }))
    try {
      const result = await window.api.createPlaylists({
        tracks: body,
        openingTracks: selectedOpeningTracks,
        pinnedOpeningTrackIds: validPinnedOpeningIds,
        combineAllPinnedOpenings: config.combineAllPinnedOpenings,
        pinnedTrackIds: config.pinnedTrackIds.filter((id) => body.some((track) => track.id === id)),
        endingTracks: config.endingTrackIds
          .map((id) => body.find((track) => track.id === id))
          .filter((track): track is ScannedTrack => !!track),
        backgroundTracks: genreBackground,
        selectedBackgroundTrackId: config.selectedBackgroundTrackId || undefined,
        bgMusicVolumeDb: typeof config.bgMusicVolumeDb === 'number' ? config.bgMusicVolumeDb : -4,
        mainMusicVolumeDb: typeof config.mainMusicVolumeDb === 'number' ? config.mainMusicVolumeDb : 2,
        playlistCount: count,
        targetDurationMinutes: minutes,
        priorityRatioMin: priority,
        priorityRatioMax: priority,
        genreId,
        genreName: genre.name,
        genreSettings: { smoothTransitions: config.crossfade, crossfadeDurationSec: Number(config.crossfadeSeconds) || 4, normalizeLoudness: config.loudnorm },
        replaceExisting: false,
      })
      setGenrePlaylists((previous) => {
        const next = { ...previous, [genreId]: result.playlists }
        localStorage.setItem(GENRE_WORKSPACE_KEY, JSON.stringify({ genrePlaylists: next, genreConfig }))
        return next
      })
    } catch (createError: any) {
      setGenreErrors((prev) => ({ ...prev, [genreId]: createError?.message || 'Không tạo được playlist cho thể loại này.' }))
    } finally {
      setCreatingGenreId(null)
    }
  }

  const handleCreatePlaylists = async () => {
    if (!scanResult) return

    if (bodyTracks.length === 0) {
      setError('Thể loại đang chọn không có bài nhạc chính nào.')
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
      const validPinnedOpeningIds = pinnedOpeningTrackIds.filter((id) =>
        openingTracks.some((t) => t.id === id)
      )
      const selectedOpeningTracks = validPinnedOpeningIds.length > 0
        ? openingTracks.filter((t) => validPinnedOpeningIds.includes(t.id))
        : openingTracks
      const endingTracks = endingTrackIds
        .map((id) => bodyTracks.find((track) => track.id === id))
        .filter((track): track is ScannedTrack => Boolean(track))
      const options: BuildPlaylistsOptions = {
        tracks: bodyTracks,
        openingTracks: selectedOpeningTracks,
        pinnedOpeningTrackIds: validPinnedOpeningIds,
        pinnedTrackIds: pinnedTrackIds.filter((id) => bodyTracks.some((track) => track.id === id)),
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
      await loadPoolStats(bodyTracks)

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
  const filteredTracks = bodyTracks.filter((track) =>
    track.fileName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const endingTracks = endingTrackIds
    .map((id) => bodyTracks.find((track) => track.id === id))
    .filter((track): track is ScannedTrack => Boolean(track))
  const endingDurationSec = endingTracks.reduce((sum, track) => sum + track.duration, 0)
  const openingDurationSec = openingTracks.reduce((sum, track) => sum + track.duration, 0)

  // Tính tổng thời lượng có thể
  const totalAvailableDuration = bodyTracks.reduce((sum, track) => sum + track.duration, 0) - endingDurationSec
  const estimatedPlaylistsPossible =
    targetDurationMinutes > 0
      ? Math.floor(totalAvailableDuration / (targetDurationMinutes * 60))
      : 0

  return (
    <div style={{ padding: '20px', display: 'flex', gap: '20px', height: 'calc(100vh - 100px)' }}>
      {/* Legacy global track panel hidden: selections now live inside each genre card. */}
      <div style={{ display: 'none' }}>
        <h2 style={{ marginBottom: '15px', fontSize: '20px', fontWeight: 'bold' }}>
          Danh sách bài hát
        </h2>
        {availableGenres.length > 0 && (
          <div style={{ marginBottom: '10px', display: 'none', flexDirection: 'column', gap: '8px' }}>
            {availableGenres.map((genre) => {
              const cfg = getGenreConfig(genre.id)
              const generated = genrePlaylists[genre.id] ?? []
              return (
                <div key={genre.id} style={{ padding: '10px', background: '#1e1e1e', border: '1px solid #444', borderRadius: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <strong>{genre.name} ({genre.count} bài)</strong>
                    <button type="button" onClick={() => handleCreateGenrePlaylists(genre.id)} disabled={creatingGenreId !== null} style={{ padding: '5px 8px', background: '#007acc', color: '#fff', border: 0, borderRadius: '4px' }}>
                      {creatingGenreId === genre.id ? 'Đang tạo...' : generated.length > 0 ? 'Tạo lại' : 'Tạo playlist'}
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '70px 60px 60px 70px', gap: '5px', marginTop: '8px' }}>
                    {(['playlistCount', 'hours', 'minutes', 'priority'] as const).map((field) => (
                      <input key={field} value={cfg[field]} placeholder={field === 'priority' ? '%' : field} onChange={(event) => setGenreConfig((prev) => ({ ...prev, [genre.id]: { ...cfg, [field]: event.target.value } }))} style={{ width: '100%', background: '#111', color: '#fff', border: '1px solid #555', padding: '4px' }} />
                    ))}
                  </div>
                  {genreErrors[genre.id] && <div style={{ color: '#fca5a5', fontSize: '12px', marginTop: '6px', whiteSpace: 'pre-wrap' }}>{genreErrors[genre.id]}</div>}
                  {generated.length > 0 && <div style={{ color: '#86efac', fontSize: '12px', marginTop: '6px' }}>{generated.length} playlist đã tạo</div>}
                </div>
              )
            })}
          </div>
        )}
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

      {/* Bên phải: workspace từng thể loại */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: '32px', fontWeight: 'bold' }}>
            Playlist theo thể loại
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {settingsSavedAt && <span style={{ color: '#86efac', fontSize: '12px' }}>Đã lưu {settingsSavedAt}</span>}
            <button type="button" onClick={handleSaveGenreSettings} disabled={creatingGenreId !== null || isCreatingAllGenres} style={{ padding: '8px 11px', background: '#374151', color: '#fff', border: '1px solid #4b5563', borderRadius: '5px', cursor: creatingGenreId !== null || isCreatingAllGenres ? 'not-allowed' : 'pointer' }}>
              Lưu cài đặt
            </button>
            <button type="button" onClick={() => setShowPlaylistGuide((value) => !value)} aria-expanded={showPlaylistGuide} style={{ padding: '8px 11px', background: '#1f4b6e', color: '#fff', border: '1px solid #3979a8', borderRadius: '5px', cursor: 'pointer' }}>
              {showPlaylistGuide ? 'Ẩn hướng dẫn' : 'Hướng dẫn'}
            </button>
            <button type="button" onClick={() => void handleRecreateAllGenres()} disabled={creatingGenreId !== null || isCreatingAllGenres || availableGenres.length === 0} style={{ padding: '8px 11px', background: '#16a34a', color: '#fff', border: 0, borderRadius: '5px', cursor: creatingGenreId !== null || isCreatingAllGenres || availableGenres.length === 0 ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
              {isCreatingAllGenres ? 'Đang tạo toàn bộ...' : 'Tạo lại toàn bộ thể loại'}
            </button>
          </div>
        </div>
        <p style={{ margin: '0 0 16px', color: '#94a3b8', fontSize: '13px' }}>Tạo playlist riêng từng thể loại. Khi đã sẵn sàng, vào Xuất nhạc để chạy tuần tự theo thứ tự card.</p>
        {showPlaylistGuide && (
          <div style={{ marginBottom: '16px', padding: '12px 14px', background: '#172333', border: '1px solid #315a7d', borderRadius: '7px', color: '#dbeafe', fontSize: '12px', lineHeight: 1.6 }}>
            <strong>Hướng dẫn nhanh</strong>
            <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
              <li><b>Crossfade:</b> chồng vài giây cuối bài trước với đầu bài sau để chuyển bài mượt hơn. Bật rồi nhập số giây, thường dùng 3–5 giây.</li>
              <li><b>Loudnorm:</b> cân bằng âm lượng giữa các bài. Bật khi nguồn nhạc to nhỏ không đều; có thể làm xuất nhạc lâu hơn.</li>
              <li><b>Ghim nhạc mở đầu:</b> chọn các bài trong folder opening để làm intro mở đầu playlist (xoay vòng hoặc ghép tất cả). Nếu không chọn, hệ thống tự động xoay vòng toàn bộ bài trong thư mục opening.</li>
              <li><b>Nhạc ghim đứng đầu playlist:</b> mở mục này, tìm theo tên bài, chọn <b>Ghim</b>. Các bài được chọn sẽ ưu tiên đứng đầu phần nhạc chính.</li>
              <li><b>Nhạc cuối playlist:</b> chọn bài nối sau phần nhạc chính. Không chọn cùng bài ở cả hai nhóm.</li>
              <li>Nhập số playlist và thời lượng, sau đó bấm <b>Tạo playlist</b> ở từng thể loại hoặc <b>Tạo lại toàn bộ thể loại</b>.</li>
            </ul>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '12px', marginBottom: '16px' }}>
          {availableGenres.map((genre) => {
            const cfg = getGenreConfig(genre.id)
            const generated = genrePlaylists[genre.id] ?? []
            const genreOpeningTracks = getOpeningTracksForGenre(scanResult, genre.id)
            const openingQuery = (genreOpeningSearch[genre.id] ?? '').trim().toLowerCase()
            const filteredOpeningTracks = genreOpeningTracks.filter((track) =>
              track.fileName.toLowerCase().includes(openingQuery)
            )
            const genreBackgroundTracks = getBackgroundTracksForGenre(scanResult, genre.id)
            const pinnedQuery = (genrePinnedSearch[genre.id] ?? '').trim().toLowerCase()
            const filteredBodyTracks = tracksForGenre(scanResult, genre.id)
              .filter((track) => track.folderType !== 'opening' && track.folderType !== 'background')
              .filter((track) => track.fileName.toLowerCase().includes(pinnedQuery))
            const endingQuery = (genreEndingSearch[genre.id] ?? '').trim().toLowerCase()
            const filteredEndingTracks = tracksForGenre(scanResult, genre.id)
              .filter((track) => track.folderType !== 'opening' && track.folderType !== 'background')
              .filter((track) => track.fileName.toLowerCase().includes(endingQuery))

            return <section key={genre.id} style={{ padding: '14px', background: '#252526', border: `1px solid ${generated.length ? '#166534' : '#444'}`, borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                <div><strong>{genre.name}</strong><div style={{ color: '#94a3b8', fontSize: '12px' }}>{genre.count} bài · {generated.length ? `${generated.length} playlist sẵn sàng` : 'Chưa tạo playlist'}</div></div>
                <button type="button" onClick={() => handleCreateGenrePlaylists(genre.id)} disabled={creatingGenreId !== null} style={{ padding: '7px 10px', background: '#007acc', color: '#fff', border: 0, borderRadius: '5px', cursor: 'pointer' }}>{creatingGenreId === genre.id ? 'Đang tạo...' : generated.length ? 'Tạo lại' : 'Tạo playlist'}</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '6px', marginTop: '12px' }}>
                {([['playlistCount', 'Số playlist'], ['hours', 'Giờ'], ['minutes', 'Phút'], ['priority', '% ưu tiên']] as const).map(([field, label]) => <label key={field} style={{ color: '#9ca3af', fontSize: '11px' }}>{label}<input value={cfg[field]} onChange={(event) => updateGenreConfig(genre.id, { [field]: event.target.value } as any)} placeholder={field === 'priority' ? '65-85' : ''} style={{ marginTop: '3px', width: '100%', boxSizing: 'border-box', background: '#111', color: '#fff', border: '1px solid #555', borderRadius: '4px', padding: '6px' }} /></label>)}
              </div>
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '10px', fontSize: '12px', color: '#cbd5e1' }}>
                <label><input type="checkbox" checked={cfg.crossfade} onChange={(event) => updateGenreConfig(genre.id, { crossfade: event.target.checked })} /> Crossfade</label>
                <label><input type="checkbox" checked={cfg.loudnorm} onChange={(event) => updateGenreConfig(genre.id, { loudnorm: event.target.checked })} /> Loudnorm</label>
                <label>Giây <input value={cfg.crossfadeSeconds} disabled={!cfg.crossfade} onChange={(event) => updateGenreConfig(genre.id, { crossfadeSeconds: event.target.value })} style={{ width: '45px', marginLeft: '4px' }} /></label>
              </div>

              {/* 1. Ghim nhạc mở đầu (folder opening) */}
              <details style={{ marginTop: '10px' }}>
                <summary style={{ cursor: 'pointer', color: '#94a3b8', fontSize: '12px' }}>
                  Ghim nhạc mở đầu (folder opening){' '}
                  {cfg.pinnedOpeningTrackIds.length > 0
                    ? `(Đã ghim: ${cfg.pinnedOpeningTrackIds.length}/${genreOpeningTracks.length} bài - chỉ chọn các bài này)`
                    : genreOpeningTracks.length > 0
                      ? `(Tự động đảo chọn ngẫu nhiên ${genreOpeningTracks.length} bài)`
                      : '(0 bài)'}
                </summary>
                <div style={{ color: '#94a3b8', fontSize: '11px', marginTop: '5px' }}>
                  {cfg.pinnedOpeningTrackIds.length > 0
                    ? `Đang ghim ${cfg.pinnedOpeningTrackIds.length} bài: Playlist sẽ chỉ chọn các bài này.`
                    : 'Chưa ghim bài nào: Hệ thống sẽ tự động đảo chọn ngẫu nhiên các bài trong folder opening như bình thường.'}
                </div>
                <div style={{ marginTop: '6px' }}>
                  <input
                    type="search"
                    value={genreOpeningSearch[genre.id] ?? ''}
                    onChange={(event) =>
                      setGenreOpeningSearch((prev) => ({ ...prev, [genre.id]: event.target.value }))
                    }
                    placeholder="Tìm tên bài mở đầu để ghim..."
                    aria-label={`Tìm bài mở đầu trong thể loại ${genre.name}`}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '6px 8px',
                      background: '#111',
                      color: '#fff',
                      border: '1px solid #374151',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '6px',
                    flexWrap: 'wrap',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() =>
                        updateGenreConfig(genre.id, {
                          pinnedOpeningTrackIds: genreOpeningTracks.map((t) => t.id),
                        })
                      }
                      disabled={genreOpeningTracks.length === 0}
                      style={{
                        padding: '3px 8px',
                        background: '#374151',
                        color: '#fff',
                        border: '1px solid #4b5563',
                        borderRadius: '4px',
                        fontSize: '11px',
                        cursor: genreOpeningTracks.length === 0 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Ghim tất cả
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateGenreConfig(genre.id, {
                          pinnedOpeningTrackIds: [],
                        })
                      }
                      disabled={cfg.pinnedOpeningTrackIds.length === 0}
                      style={{
                        padding: '3px 8px',
                        background: '#374151',
                        color: '#fff',
                        border: '1px solid #4b5563',
                        borderRadius: '4px',
                        fontSize: '11px',
                        cursor: cfg.pinnedOpeningTrackIds.length === 0 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Bỏ ghim tất cả
                    </button>
                  </div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '11px',
                      color: '#cbd5e1',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(cfg.combineAllPinnedOpenings)}
                      onChange={(event) =>
                        updateGenreConfig(genre.id, {
                          combineAllPinnedOpenings: event.target.checked,
                        })
                      }
                    />
                    Ghép tất cả bài mở đầu đã ghim vào đầu mỗi playlist
                  </label>
                </div>
                <div
                  style={{
                    maxHeight: '130px',
                    overflowY: 'auto',
                    marginTop: '6px',
                    border: '1px solid #374151',
                    borderRadius: '4px',
                    padding: '4px',
                  }}
                >
                  {genreOpeningTracks.length === 0 ? (
                    <div style={{ color: '#888', fontSize: '11px', padding: '6px' }}>
                      Chưa có bài nào trong thư mục opening. Vui lòng quét thư mục mở đầu ở tab Quét nhạc.
                    </div>
                  ) : filteredOpeningTracks.length === 0 ? (
                    <div style={{ color: '#888', fontSize: '11px', padding: '6px' }}>
                      Không tìm thấy bài mở đầu phù hợp với từ khóa.
                    </div>
                  ) : (
                    filteredOpeningTracks.map((track) => {
                      const isPinned = cfg.pinnedOpeningTrackIds.includes(track.id)
                      return (
                        <label
                          key={track.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '11px',
                            padding: '4px 6px',
                            borderBottom: '1px solid #2d2d2d',
                            cursor: 'pointer',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              gap: '6px',
                              alignItems: 'center',
                              flex: 1,
                              overflow: 'hidden',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isPinned}
                              onChange={(event) =>
                                updateGenreConfig(genre.id, {
                                  pinnedOpeningTrackIds: event.target.checked
                                    ? [...cfg.pinnedOpeningTrackIds, track.id]
                                    : cfg.pinnedOpeningTrackIds.filter((id) => id !== track.id),
                                })
                              }
                            />
                            <span
                              style={{
                                color: isPinned ? '#86efac' : '#fff',
                                textOverflow: 'ellipsis',
                                overflow: 'hidden',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Ghim {track.fileName}
                            </span>
                          </div>
                          <span
                            style={{
                              color: '#94a3b8',
                              fontSize: '11px',
                              marginLeft: '8px',
                              flexShrink: 0,
                            }}
                          >
                            {formatDurationShort(track.duration)}
                          </span>
                        </label>
                      )
                    })
                  )}
                </div>
              </details>

              {/* 2. Nhạc ghim đứng đầu playlist (ưu tiên & random) */}
              <details style={{ marginTop: '6px' }}>
                <summary style={{ cursor: 'pointer', color: '#94a3b8', fontSize: '12px' }}>
                  Nhạc ghim đứng đầu playlist{' '}
                  {cfg.pinnedTrackIds.length > 0
                    ? `(Đã ghim: ${cfg.pinnedTrackIds.length} bài)`
                    : ''}
                </summary>
                <div style={{ marginTop: '6px' }}>
                  <input
                    type="search"
                    value={genrePinnedSearch[genre.id] ?? ''}
                    onChange={(event) =>
                      setGenrePinnedSearch((prev) => ({ ...prev, [genre.id]: event.target.value }))
                    }
                    placeholder="Tìm tên bài hát để ghim..."
                    aria-label={`Tìm bài hát trong thể loại ${genre.name}`}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '6px 8px',
                      background: '#111',
                      color: '#fff',
                      border: '1px solid #374151',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}
                  />
                </div>
                {cfg.pinnedTrackIds.length > 0 && (
                  <div style={{ marginTop: '6px' }}>
                    <button
                      type="button"
                      onClick={() => updateGenreConfig(genre.id, { pinnedTrackIds: [] })}
                      style={{
                        padding: '3px 8px',
                        background: '#374151',
                        color: '#fff',
                        border: '1px solid #4b5563',
                        borderRadius: '4px',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      Bỏ ghim tất cả
                    </button>
                  </div>
                )}
                <div
                  style={{
                    maxHeight: '130px',
                    overflowY: 'auto',
                    marginTop: '6px',
                    border: '1px solid #374151',
                    borderRadius: '4px',
                    padding: '4px',
                  }}
                >
                  {filteredBodyTracks.length === 0 ? (
                    <div style={{ color: '#888', fontSize: '11px', padding: '6px' }}>
                      Không có bài hát nào phù hợp.
                    </div>
                  ) : (
                    filteredBodyTracks.map((track) => (
                      <label
                        key={track.id}
                        style={{
                          display: 'flex',
                          gap: '5px',
                          alignItems: 'center',
                          fontSize: '11px',
                          padding: '3px',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={cfg.pinnedTrackIds.includes(track.id)}
                          onChange={(event) =>
                            updateGenreConfig(genre.id, {
                              pinnedTrackIds: event.target.checked
                                ? [...cfg.pinnedTrackIds, track.id]
                                : cfg.pinnedTrackIds.filter((id) => id !== track.id),
                            })
                          }
                        />{' '}
                        Ghim {track.fileName}
                      </label>
                    ))
                  )}
                </div>
              </details>

              {/* 3. Nhạc cuối playlist */}
              <details style={{ marginTop: '6px' }}>
                <summary style={{ cursor: 'pointer', color: '#94a3b8', fontSize: '12px' }}>
                  Nhạc cuối playlist{' '}
                  {cfg.endingTrackIds.length > 0
                    ? `(Đã chọn: ${cfg.endingTrackIds.length} bài)`
                    : ''}
                </summary>
                <div style={{ marginTop: '6px' }}>
                  <input
                    type="search"
                    value={genreEndingSearch[genre.id] ?? ''}
                    onChange={(event) =>
                      setGenreEndingSearch((prev) => ({ ...prev, [genre.id]: event.target.value }))
                    }
                    placeholder="Tìm tên bài cuối playlist..."
                    aria-label={`Tìm bài cuối playlist trong thể loại ${genre.name}`}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '6px 8px',
                      background: '#111',
                      color: '#fff',
                      border: '1px solid #374151',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}
                  />
                </div>
                {cfg.endingTrackIds.length > 0 && (
                  <div style={{ marginTop: '6px' }}>
                    <button
                      type="button"
                      onClick={() => updateGenreConfig(genre.id, { endingTrackIds: [] })}
                      style={{
                        padding: '3px 8px',
                        background: '#374151',
                        color: '#fff',
                        border: '1px solid #4b5563',
                        borderRadius: '4px',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      Bỏ chọn tất cả
                    </button>
                  </div>
                )}
                <div
                  style={{
                    maxHeight: '100px',
                    overflowY: 'auto',
                    marginTop: '6px',
                    border: '1px solid #374151',
                    borderRadius: '4px',
                    padding: '4px',
                  }}
                >
                  {filteredEndingTracks.length === 0 ? (
                    <div style={{ color: '#888', fontSize: '11px', padding: '6px' }}>
                      Không có bài hát nào phù hợp.
                    </div>
                  ) : (
                    filteredEndingTracks.map((track) => (
                      <label
                        key={track.id}
                        style={{
                          display: 'flex',
                          gap: '5px',
                          alignItems: 'center',
                          fontSize: '11px',
                          padding: '3px',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={cfg.endingTrackIds.includes(track.id)}
                          onChange={(event) =>
                            updateGenreConfig(genre.id, {
                              endingTrackIds: event.target.checked
                                ? [...cfg.endingTrackIds, track.id]
                                : cfg.endingTrackIds.filter((id) => id !== track.id),
                            })
                          }
                        />{' '}
                        Cuối {track.fileName}
                      </label>
                    ))
                  )}
                </div>
              </details>

              {/* 4. Nhạc nền & Hòa âm âm lượng */}
              {genreBackgroundTracks.length > 0 ? (
                <div
                  style={{
                    marginTop: '10px',
                    padding: '10px 12px',
                    background: '#1e1b4b',
                    border: '1px solid #6366f1',
                    borderRadius: '6px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ color: '#c7d2fe', fontSize: '12px', fontWeight: 700 }}>
                      Nhạc nền ({genreBackgroundTracks.length} bài)
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {previewUrlMap[genre.id] ? (
                        <button
                          type="button"
                          onClick={() => handleStopPreview(genre.id)}
                          style={{
                            padding: '4px 10px',
                            background: '#dc2626',
                            color: '#fff',
                            border: 0,
                            borderRadius: '4px',
                            fontSize: '11px',
                            cursor: 'pointer',
                          }}
                        >
                          Đóng nghe thử
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handlePreviewMix(genre.id)}
                          disabled={previewLoadingGenreId === genre.id}
                          style={{
                            padding: '4px 10px',
                            background: previewLoadingGenreId === genre.id ? '#4b5563' : '#4f46e5',
                            color: '#fff',
                            border: 0,
                            borderRadius: '4px',
                            fontSize: '11px',
                            cursor: previewLoadingGenreId === genre.id ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {previewLoadingGenreId === genre.id ? 'Đang hòa âm...' : 'Nghe thử hòa âm (20s)'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ color: '#a5b4fc', fontSize: '11px', marginTop: '4px', lineHeight: 1.4 }}>
                    Thể loại này có thư mục nhạc nền. Nhạc nền sẽ chạy ngầm song song lặp lại suốt toàn bộ playlist với độ cân bằng âm lượng bên dưới.
                  </div>

                  {/* Chọn bài nhạc nền nếu có từ 2 bài trở lên */}
                  {genreBackgroundTracks.length > 1 && (
                    <div style={{ marginTop: '8px' }}>
                      <label style={{ color: '#c7d2fe', fontSize: '11px', display: 'block', marginBottom: '3px' }}>
                        Chọn bài nhạc nền:
                      </label>
                      <select
                        value={cfg.selectedBackgroundTrackId || ''}
                        onChange={(e) => updateGenreConfig(genre.id, { selectedBackgroundTrackId: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '5px 8px',
                          background: '#0f172a',
                          color: '#fff',
                          border: '1px solid #4338ca',
                          borderRadius: '4px',
                          fontSize: '11px',
                        }}
                      >
                        <option value="">Tự động xoay vòng qua các bài nhạc nền</option>
                        {genreBackgroundTracks.map((bg) => (
                          <option key={bg.id} value={bg.id}>
                            {bg.fileName} ({formatDurationShort(bg.duration)})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Điều chỉnh âm lượng nhạc nền và nhạc ghép */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '12px',
                      marginTop: '10px',
                      padding: '8px',
                      background: '#0f172a',
                      borderRadius: '5px',
                      border: '1px solid #312e81',
                    }}
                  >
                    {/* Nhạc nền: Mặc định -4 dB */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#e0e7ff', fontSize: '11px', fontWeight: 600 }}>
                          Âm lượng nhạc nền:
                        </span>
                        <span style={{ color: '#a5b4fc', fontSize: '11px', fontWeight: 700 }}>
                          {cfg.bgMusicVolumeDb ?? -4} dB
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                        <input
                          type="range"
                          min={-30}
                          max={6}
                          step={1}
                          value={cfg.bgMusicVolumeDb ?? -4}
                          onChange={(e) => updateGenreConfig(genre.id, { bgMusicVolumeDb: Number(e.target.value) })}
                          style={{ flex: 1, cursor: 'pointer' }}
                        />
                        <input
                          type="number"
                          min={-30}
                          max={6}
                          value={cfg.bgMusicVolumeDb ?? -4}
                          onChange={(e) => updateGenreConfig(genre.id, { bgMusicVolumeDb: Number(e.target.value) })}
                          style={{
                            width: '50px',
                            background: '#1e1b4b',
                            color: '#fff',
                            border: '1px solid #4338ca',
                            borderRadius: '4px',
                            padding: '2px 4px',
                            fontSize: '11px',
                            textAlign: 'center',
                          }}
                        />
                      </div>
                      <div style={{ color: '#818cf8', fontSize: '10px', marginTop: '2px' }}>
                        Mặc định: -4 dB (nhỏ hơn nhạc ghép để nghe rõ lời)
                      </div>
                    </div>

                    {/* Nhạc ghép (chính): Mặc định +2 dB */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#e0e7ff', fontSize: '11px', fontWeight: 600 }}>
                          Âm lượng nhạc ghép:
                        </span>
                        <span style={{ color: '#a5b4fc', fontSize: '11px', fontWeight: 700 }}>
                          {((cfg.mainMusicVolumeDb ?? 2) >= 0 ? '+' : '') + (cfg.mainMusicVolumeDb ?? 2)} dB
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                        <input
                          type="range"
                          min={-12}
                          max={12}
                          step={1}
                          value={cfg.mainMusicVolumeDb ?? 2}
                          onChange={(e) => updateGenreConfig(genre.id, { mainMusicVolumeDb: Number(e.target.value) })}
                          style={{ flex: 1, cursor: 'pointer' }}
                        />
                        <input
                          type="number"
                          min={-12}
                          max={12}
                          value={cfg.mainMusicVolumeDb ?? 2}
                          onChange={(e) => updateGenreConfig(genre.id, { mainMusicVolumeDb: Number(e.target.value) })}
                          style={{
                            width: '50px',
                            background: '#1e1b4b',
                            color: '#fff',
                            border: '1px solid #4338ca',
                            borderRadius: '4px',
                            padding: '2px 4px',
                            fontSize: '11px',
                            textAlign: 'center',
                          }}
                        />
                      </div>
                      <div style={{ color: '#818cf8', fontSize: '10px', marginTop: '2px' }}>
                        Mặc định: +2 dB (các bài từ opening, ưu tiên, random)
                      </div>
                    </div>
                  </div>

                  {/* Inline Audio Player nghe thử */}
                  {previewUrlMap[genre.id] && (
                    <div
                      style={{
                        marginTop: '10px',
                        padding: '8px 10px',
                        background: '#172554',
                        border: '1px solid #3b82f6',
                        borderRadius: '5px',
                      }}
                    >
                      <div style={{ color: '#93c5fd', fontSize: '11px', fontWeight: 600, marginBottom: '6px' }}>
                        Đoạn nghe thử hòa âm (20 giây):
                      </div>
                      <audio
                        controls
                        autoPlay
                        src={previewUrlMap[genre.id]}
                        style={{ width: '100%', height: '36px' }}
                      />
                    </div>
                  )}

                  {previewErrorMap[genre.id] && (
                    <div style={{ color: '#fca5a5', fontSize: '11px', marginTop: '6px' }}>
                      {previewErrorMap[genre.id]}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    marginTop: '10px',
                    padding: '8px 12px',
                    background: '#18181b',
                    border: '1px dashed #3f3f46',
                    borderRadius: '6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ color: '#9ca3af', fontSize: '11px' }}>
                    Nhạc nền: Chưa có bài hát (thêm thư mục tại Tab 1 Quét nhạc để kích hoạt hòa âm)
                  </span>
                  <span style={{ color: '#6b7280', fontSize: '10px' }}>
                    Mặc định hòa âm: Nền -4 dB / Ghép +2 dB
                  </span>
                </div>
              )}

              {generated.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <div style={{ color: '#86efac', fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>
                    Kết quả ({generated.length} playlist)
                  </div>
                  {generated.map((playlist) => {
                    const mainDurationSec = Math.max(
                      playlist.totalDurationSec - (playlist.openingDurationSec ?? 0) - (playlist.endingDurationSec ?? 0),
                      0,
                    )
                    const priorityPercent = mainDurationSec > 0
                      ? ((playlist.priorityDurationSec / mainDurationSec) * 100).toFixed(1)
                      : '0.0'
                    const randomPercent = mainDurationSec > 0
                      ? ((playlist.randomDurationSec / mainDurationSec) * 100).toFixed(1)
                      : '0.0'

                    return (
                      <details key={playlist.id} style={{ marginBottom: '10px', background: '#1e1e1e', border: '1px solid #444', borderRadius: '5px', overflow: 'hidden' }}>
                        <summary style={{ cursor: 'pointer', padding: '10px', background: '#252526', color: '#fff', fontSize: '13px', fontWeight: 700 }}>
                          {playlist.name}
                          <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 400, marginTop: '4px' }}>
                            Thời lượng: {formatDuration(playlist.totalDurationSec)} · Main: {formatDuration(mainDurationSec)} · Nhạc cuối: {playlist.endingCount ?? 0} · Số bài: {playlist.tracks.length} · Ưu tiên: {priorityPercent}% · Random: {randomPercent}%
                            {playlist.backgroundTrack && (
                              <span style={{ color: '#c7d2fe' }}>
                                {' '}· Nhạc nền: {playlist.backgroundTrack.fileName} (Nền {playlist.bgMusicVolumeDb ?? -4}dB / Ghép {((playlist.mainMusicVolumeDb ?? 2) >= 0 ? '+' : '') + (playlist.mainMusicVolumeDb ?? 2)}dB)
                              </span>
                            )}
                          </div>
                        </summary>
                        <div style={{ overflowX: 'auto', maxHeight: '260px', overflowY: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #444', background: '#252526' }}>
                                <th style={{ padding: '8px', textAlign: 'left', color: '#888' }}>#</th>
                                <th style={{ padding: '8px', textAlign: 'left', color: '#888' }}>Tên bài</th>
                                <th style={{ padding: '8px', textAlign: 'left', color: '#888' }}>Loại</th>
                                <th style={{ padding: '8px', textAlign: 'left', color: '#888' }}>Thời lượng</th>
                                <th style={{ padding: '8px', textAlign: 'left', color: '#888' }}>Tích lũy</th>
                              </tr>
                            </thead>
                            <tbody>
                              {playlist.tracks.map((track) => {
                                const isPinned = cfg.pinnedTrackIds.includes(track.id)
                                const isOpeningPinned = cfg.pinnedOpeningTrackIds.includes(track.id)
                                let typeLabel = track.role === 'opening'
                                  ? (isOpeningPinned ? 'Nhạc mở đầu (Ghim)' : 'Nhạc mở đầu')
                                  : track.role === 'ending'
                                    ? 'Nhạc cuối'
                                    : track.folderType === 'priority'
                                      ? 'Ưu tiên'
                                      : 'Random'
                                if (isPinned && track.role !== 'ending' && track.role !== 'opening') {
                                  typeLabel = `Pinned${track.folderType === 'priority' ? ' + Ưu tiên' : ''}`
                                }

                                return (
                                  <tr key={`${playlist.id}-${track.id}-${track.order}`} style={{ borderBottom: '1px solid #333' }}>
                                    <td style={{ padding: '8px', color: '#ccc' }}>{track.order}</td>
                                    <td style={{ padding: '8px', color: '#ccc' }}>{track.fileName}</td>
                                    <td style={{ padding: '8px', color: '#ccc' }}>{typeLabel}</td>
                                    <td style={{ padding: '8px', color: '#ccc' }}>{formatDurationShort(track.duration)}</td>
                                    <td style={{ padding: '8px', color: '#ccc' }}>{formatDurationShort(track.cumulativeDuration)}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )
                  })}
                </div>
              )}
              {genreErrors[genre.id] && <div style={{ color: '#fca5a5', fontSize: '12px', marginTop: '8px', whiteSpace: 'pre-wrap' }}>{genreErrors[genre.id]}</div>}
            </section>
          })}
        </div>
        <div style={{ display: 'none' }}>
        <h2 style={{ marginBottom: '20px', fontSize: '20px', fontWeight: 'bold' }}>
          Cấu hình thủ công
        </h2>

        {/* Cấu hình */}
        <div
          style={{
            padding: '12px',
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
              Logic: nhạc mở đầu xoay vòng đứng đầu playlist và không tính vào target chính; sau đó là bài ghim, nhạc ưu tiên ({priorityRatioInput ? `${priorityRatioInput}%` : '65-85%'} thời lượng), nhạc random ({priorityRatioInput ? `${randomRatioPercent}%` : '15-35%'}). Nhạc cuối nối thêm sau target chính.
            </div>
            {openingTracks.length > 0 && (
              <div style={{ color: '#8fd3ff', fontSize: '12px' }}>
                Nhạc mở đầu: {openingTracks.length} bài • {formatDuration(openingDurationSec)} tổng kho • tự xoay vòng theo số playlist.
              </div>
            )}
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
                const mainDurationSec = Math.max(playlist.totalDurationSec - (playlist.openingDurationSec ?? 0) - (playlist.endingDurationSec ?? 0), 0)
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
                                let typeLabel = track.role === 'opening' ? 'Nhạc mở đầu' : track.role === 'ending' ? 'Nhạc cuối' : (track.folderType === 'priority' ? 'Ưu tiên' : 'Random')
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
    </div>
  )
}

export default CreatePlaylistPage

import { useState, useEffect, useRef, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import {
  PlaylistDefinition,
  ExportPlaylistRequest,
  ExportProgressPayload,
} from '../../types/ipc'
import { DiskSpaceErrorModal } from '../../components/DiskSpaceErrorModal'
import NumericDraftInput from '../../components/NumericDraftInput'
import type { ExportHistoryEntry } from '../../types/ipc'

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

/**
 * Format seconds to H:MM:SS or MM:SS
 */
function formatSecondsHMS(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00'
  const total = Math.floor(sec)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatDurationLong(seconds: number | undefined | null): string {
  return formatDuration(seconds)
}

/**
 * Sanitize tên file: bỏ dấu, ký tự đặc biệt, chuyển thành lowercase với underscore
 */
function sanitizeFileName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // bỏ dấu
    .replace(/[^a-zA-Z0-9\-_. ]/g, '') // bỏ ký tự lạ
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase()
}

type AudioQuality = 'mp3_320' | 'aac_384'

function ExportAudioPage() {
  const [playlists, setPlaylists] = useState<PlaylistDefinition[]>([])
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<string[]>([])
  const [outputDir, setOutputDir] = useState<string>('')
  const [fileNamePrefix, setFileNamePrefix] = useState<string>('')
  const [quality, setQuality] = useState<AudioQuality>('aac_384')
  const [smoothTransitions, setSmoothTransitions] = useState<boolean>(false)
  const [crossfadeDuration, setCrossfadeDuration] = useState<string>('') // giây
  const [normalizeLoudness, setNormalizeLoudness] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)
  const [progressText, setProgressText] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [diskSpaceError, setDiskSpaceError] = useState<string | null>(null)
  const [currentProgress, setCurrentProgress] = useState<{
    playlistId: string
    name: string
    currentSec: number
    totalSec: number
    percent: number
  } | null>(null)
  const location = useLocation()
  const [currentExportIndex, setCurrentExportIndex] = useState<number>(0)
  const [totalExportCount, setTotalExportCount] = useState<number>(0)
  const [batchStartTime, setBatchStartTime] = useState<number | null>(null)
  const [currentPlaylistStartTime, setCurrentPlaylistStartTime] = useState<number | null>(null)
  const [currentSpeedX, setCurrentSpeedX] = useState<number | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const [historyVisible, setHistoryVisible] = useState(false)
  const [history, setHistory] = useState<ExportHistoryEntry[]>([])
  const [lastOutputDir, setLastOutputDir] = useState<string | null>(null)
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [claimTime, setClaimTime] = useState<string>('') // mm:ss
  const [claimResult, setClaimResult] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedDatesForDownload, setSelectedDatesForDownload] = useState<Set<string>>(new Set()) // Các ngày đã chọn để tải
  const [isDownloadingPlaylists, setIsDownloadingPlaylists] = useState(false) // Đang tải playlist
  const [historyOutputDir, setHistoryOutputDir] = useState<string>('') // Thư mục xuất lịch sử
  const [currentJobId, setCurrentJobId] = useState<string | null>(null) // Job ID để cancel
  // Cờ huỷ do người dùng bấm nút "Dừng" để tránh loop tiếp tục export các playlist còn lại
  const cancelRequestedRef = useRef(false)
  const [selectedHistoryIdsToDelete, setSelectedHistoryIdsToDelete] = useState<Set<string>>(new Set()) // Các entry được chọn để xóa
  const [isDeletingHistory, setIsDeletingHistory] = useState(false) // Đang xóa lịch sử
  const [validationResults, setValidationResults] = useState<Array<{
    playlistId: string
    playlistName: string
    issues: Array<{ trackPath: string; trackName: string; reason: string }>
  }> | null>(null)
  const [isValidating, setIsValidating] = useState(false)

  // Ref cho checkbox "Chọn tất cả" để set indeterminate
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null)

  // Computed states cho "Chọn tất cả"
  const allSelected = useMemo(() => {
    return playlists.length > 0 && selectedPlaylistIds.length === playlists.length
  }, [playlists.length, selectedPlaylistIds.length])

const partiallySelected = useMemo(() => {
  return selectedPlaylistIds.length > 0 && selectedPlaylistIds.length < playlists.length
}, [selectedPlaylistIds.length, playlists.length])

const historyByDate = useMemo(() => {
  const map = new Map<string, ExportHistoryEntry[]>()
  history.forEach((h) => {
    // Dùng format giống với backend
    const dateStr = new Date(h.exportedAt).toLocaleDateString()
    if (!map.has(dateStr)) map.set(dateStr, [])
    map.get(dateStr)!.push(h)
  })
  console.log('[ExportAudio] History by date:', Array.from(map.keys()))
  return map
}, [history])

const historyDates = useMemo(
  () =>
    Array.from(historyByDate.keys()).sort((a, b) => {
      const da = new Date(a).getTime()
      const db = new Date(b).getTime()
      return db - da
    }),
  [historyByDate]
)

const filteredHistory = useMemo(() => {
  if (!selectedDate) return []
  return historyByDate.get(selectedDate) || []
}, [selectedDate, historyByDate])

  // Set indeterminate state cho checkbox "Chọn tất cả"
  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = partiallySelected
    }
  }, [partiallySelected])

  // Handler cho "Chọn tất cả"
  const handleToggleSelectAll = () => {
    if (allSelected) {
      // Bỏ chọn tất cả
      setSelectedPlaylistIds([])
    } else {
      // Chọn tất cả
      setSelectedPlaylistIds(playlists.map((p) => p.id))
    }
  }

  // Load playlists mỗi lần user mở tab này (keep-alive: page không unmount)
  useEffect(() => {
    let mounted = true

    window.api
      .listPlaylists()
      .then((data) => {
        if (!mounted) return
        setPlaylists(data || [])
        // Giữ selection hiện tại nếu vẫn còn trong list mới
        setSelectedPlaylistIds(prev => {
          if (!prev.length) return []
          const ids = new Set((data || []).map((p: PlaylistDefinition) => p.id))
          return prev.filter(id => ids.has(id))
        })
      })
      .catch((err) => {
        console.error('[ExportAudio] listPlaylists error', err)
        setErrorMessage('Không load được danh sách playlist.')
      })

    return () => {
      mounted = false
    }
  }, [location.pathname])

  // Restore state từ running job khi component mount lại (sau khi chuyển tab)
  useEffect(() => {
    let mounted = true

    const restoreRunningJob = async () => {
      try {
        // Lấy tất cả jobs
        const jobs = await window.api.jobQueue.list()
        
        // Tìm job đang chạy cho music export
        const runningJob = jobs.find(
          (job) =>
            job.type === 'music:export-playlist' &&
            (job.status === 'running' || job.status === 'pending')
        )

        if (runningJob && mounted) {
          console.log('[ExportAudio] Found running job, restoring state:', runningJob.id)
          
          // Restore state từ job
          setCurrentJobId(runningJob.id)
          setLoading(true)
          
          // Restore progress và metadata từ job payload
          const payload = runningJob.payload as any
          const playlistId = payload?.playlistId
          const playlistName = payload?.playlistName
          const currentIndex = payload?.currentIndex ?? 0
          const totalCount = payload?.totalCount ?? 1
          
          if (playlistId) {
            // Tìm playlist từ danh sách
            const playlist = playlists.find((p) => p.id === playlistId)
            if (playlist) {
              const progressPercent = runningJob.progress?.percent ?? 0
              setCurrentProgress({
                playlistId: playlist.id,
                name: playlistName || playlist.name,
                currentSec: (playlist.totalDurationSec ?? 0) * (progressPercent / 100),
                totalSec: playlist.totalDurationSec ?? 0,
                percent: progressPercent,
              })
              setCurrentExportIndex(currentIndex)
              setTotalExportCount(totalCount)
              setProgressText(`Đang xuất playlist ${currentIndex + 1}/${totalCount}: ${playlistName || playlist.name}`)
            }
          }
          
          setProgressText('Đang tiếp tục xuất nhạc...')
        }
      } catch (err) {
        console.error('[ExportAudio] Failed to restore running job:', err)
      }
    }

    // Chỉ restore sau khi playlists đã load
    if (playlists.length > 0) {
      restoreRunningJob()
    }

    return () => {
      mounted = false
    }
  }, [playlists]) // Chạy lại khi playlists thay đổi

  // Lắng nghe jobQueue update để lấy jobId ngay khi export bắt đầu
  useEffect(() => {
    const api = window.api
    if (!api?.jobQueue?.onUpdate) return

    const unsubscribe = api.jobQueue.onUpdate((job: any) => {
      if (!job) return
      if (job.type !== 'music:export-playlist') return

      if (job.status === 'running' || job.status === 'pending') {
        setCurrentJobId((prev) => prev ?? job.id)
      }

      if (
        currentJobId &&
        job.id === currentJobId &&
        (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')
      ) {
        setCurrentJobId(null)
      }
    })

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [currentJobId])

  // Subscribe progress
  useEffect(() => {
    if (!window.api.onExportProgress) return

    const unsubscribe = window.api.onExportProgress((p: ExportProgressPayload) => {
      // chỉ update nếu playlist đang export hiện tại
      setCurrentProgress((prev) => {
        if (!prev || prev.playlistId !== p.playlistId) return prev

        return {
          ...prev,
          currentSec: p.currentSec,
          totalSec: p.totalSec,
          percent: p.percent,
        }
      })

      const processedSec = p.currentSec
      const totalSec = p.totalSec
      const now = Date.now()

      // Tính thời gian thực đã trôi
      if (currentPlaylistStartTime !== null) {
        const elapsedSec = (now - currentPlaylistStartTime) / 1000

        // Tính speedX
        if (elapsedSec > 0 && processedSec > 0) {
          const speedX = Math.min(Math.max(processedSec / elapsedSec, 0.1), 500)
          setCurrentSpeedX(speedX)

          // Tính ETA
          const remainingAudioSec = Math.max(totalSec - processedSec, 0)
          if (speedX > 0 && remainingAudioSec > 0) {
            const etaSec = remainingAudioSec / speedX
            setRemainingSeconds(etaSec)
          } else {
            setRemainingSeconds(null)
          }
        } else {
          setCurrentSpeedX(null)
          setRemainingSeconds(null)
        }
      }
    })

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [currentPlaylistStartTime])

  // Handle select folder
  const handleSelectFolder = async () => {
    try {
      const dir = await window.api.selectFolder()
      if (dir) {
        setOutputDir(dir)
        setErrorMessage(null)
      }
    } catch (err) {
      console.error('[ExportAudio] selectFolder error', err)
      setErrorMessage('Không chọn được thư mục.')
    }
  }

  // Handle select history output directory
  const handleSelectHistoryOutputDir = async () => {
    try {
      const dir = await window.api.selectFolder()
      if (dir) {
        setHistoryOutputDir(dir)
        setErrorMessage(null)
      }
    } catch (err) {
      console.error('[ExportAudio] selectHistoryFolder error', err)
      setErrorMessage('Không chọn được thư mục.')
    }
  }

  // Load history when modal opens
  useEffect(() => {
    if (!historyVisible) return
    let mounted = true
    const api = window.api
    if (api?.music?.getExportHistory) {
      api.music.getExportHistory().then((list: any) => {
      if (!mounted) return
        const sorted = (list || []).sort((a: any, b: any) => b.exportedAt - a.exportedAt)
      setHistory(sorted)
      if (sorted.length > 0) {
        const firstDate = new Date(sorted[0].exportedAt).toLocaleDateString()
        setSelectedDate(firstDate)
      }
      }).catch((err: any) => {
        console.error('[ExportAudio] Failed to load history:', err)
    })
    }
    return () => {
      mounted = false
    }
  }, [historyVisible])

  // Find track at claim time
  const handleFindClaim = () => {
    if (!selectedHistoryId) {
      setClaimResult('Chọn playlist trong lịch sử trước.')
      return
    }
    const entry = history.find((h) => h.id === selectedHistoryId)
    if (!entry) {
      setClaimResult('Không tìm thấy lịch sử tương ứng.')
      return
    }
    const match = claimTime.match(/^(\d+):([0-5]?\d)$/)
    if (!match) {
      setClaimResult('Nhập thời gian dạng mm:ss')
      return
    }
    const minutes = parseInt(match[1], 10)
    const seconds = parseInt(match[2], 10)
    const target = minutes * 60 + seconds
    const track = entry.tracks.find((t) => target >= t.startSec && target < t.startSec + t.durationSec)
    if (!track) {
      setClaimResult('Không xác định được bài hát tại thời điểm này.')
      return
    }
    setClaimResult(`Bài: ${track.name} (file: ${track.path})`)
  }

  // Delete selected history entries (from individual selection or date selection)
  const handleDeleteHistoryEntries = async () => {
    // Nếu có ngày được chọn nhưng không có playlist riêng lẻ, lấy tất cả playlist trong các ngày đó
    let entryIdsToDelete = Array.from(selectedHistoryIdsToDelete)
    
    if (entryIdsToDelete.length === 0 && selectedDatesForDownload.size > 0) {
      // Lấy tất cả playlist trong các ngày đã chọn
      const entriesFromDates: string[] = []
      selectedDatesForDownload.forEach(date => {
        const entriesInDate = historyByDate.get(date) || []
        entriesInDate.forEach(entry => entriesFromDates.push(entry.id))
      })
      entryIdsToDelete = entriesFromDates
    }
    
    if (entryIdsToDelete.length === 0) {
      setErrorMessage('Vui lòng chọn ít nhất một playlist hoặc một ngày để xóa.')
      return
    }

    if (!confirm(`Bạn có chắc muốn xóa ${entryIdsToDelete.length} playlist khỏi lịch sử?`)) {
      return
    }

    setIsDeletingHistory(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      const api = window.api
      if (!api?.music?.deleteExportHistory) {
        throw new Error('Backend chưa sẵn sàng.')
      }

      console.log('[ExportAudio] Deleting history entries:', entryIdsToDelete)
      const result = await api.music.deleteExportHistory(entryIdsToDelete)
      console.log('[ExportAudio] Delete result:', result)

      if (result.success) {
        setSuccessMessage(`Đã xóa ${result.deletedCount} playlist khỏi lịch sử.`)
        setSelectedHistoryIdsToDelete(new Set()) // Reset selection
        setSelectedDatesForDownload(new Set()) // Reset date selection
        setSelectedHistoryId(null) // Clear selected entry
        
        // Reload history
        if (api?.music?.getExportHistory) {
          api.music.getExportHistory().then((list: any) => {
            const sorted = (list || []).sort((a: any, b: any) => b.exportedAt - a.exportedAt)
            setHistory(sorted)
            if (sorted.length > 0) {
              const firstDate = new Date(sorted[0].exportedAt).toLocaleDateString()
              setSelectedDate(firstDate)
            } else {
              setSelectedDate(null)
            }
          }).catch((err: any) => {
            console.error('[ExportAudio] Failed to reload history:', err)
          })
        }
      } else {
        setErrorMessage(result.error || 'Lỗi khi xóa lịch sử.')
      }
    } catch (err: any) {
      console.error('[ExportAudio] Delete history error:', err)
      setErrorMessage(err?.message || 'Lỗi khi xóa lịch sử.')
    } finally {
      setIsDeletingHistory(false)
    }
  }

  // Download playlists for selected dates or individual playlists
  const handleDownloadPlaylists = async () => {
    const entryIdsToDownload = Array.from(selectedHistoryIdsToDelete)
    const datesToDownload = entryIdsToDownload.length > 0 ? [] : Array.from(selectedDatesForDownload)

    if (datesToDownload.length === 0 && entryIdsToDownload.length === 0) {
      setErrorMessage('Vui long chon it nhat mot ngay hoac mot playlist de tai.')
      return
    }

    setIsDownloadingPlaylists(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      const api = window.api
      if (!api?.music?.downloadPlaylistHistory) {
        throw new Error('Backend chua san sang.')
      }

      console.log('[ExportAudio] Downloading playlist history:', {
        entryIds: entryIdsToDownload,
        dates: datesToDownload,
        outputDir: historyOutputDir || undefined,
      })
      const result = await api.music.downloadPlaylistHistory({
        entryIds: entryIdsToDownload,
        dates: datesToDownload,
        outputDir: historyOutputDir || undefined,
      })
      console.log('[ExportAudio] Download result:', result)

      if (result.success) {
        setSuccessMessage(`Da xuat ${result.downloadedCount} file tracklist thanh cong vao thu muc: ${result.outputDir}`)
        setSelectedDatesForDownload(new Set())
        setSelectedHistoryIdsToDelete(new Set())
      } else {
        setErrorMessage(result.error || 'Loi khi tai playlist.')
      }
    } catch (err) {
      console.error('[ExportAudio] Download playlists error:', err)
      setErrorMessage(err instanceof Error ? err.message : 'Loi khi tai playlist.')
    } finally {
      setIsDownloadingPlaylists(false)
    }
  }

  // Toggle date selection for download
  const handleToggleDateForDownload = (date: string) => {
    const newSet = new Set(selectedDatesForDownload)
    const entriesInDate = historyByDate.get(date) || []
    
    if (newSet.has(date)) {
      // Bỏ chọn ngày → bỏ chọn tất cả playlist trong ngày đó
      newSet.delete(date)
      const newDeleteSet = new Set(selectedHistoryIdsToDelete)
      entriesInDate.forEach(entry => newDeleteSet.delete(entry.id))
      setSelectedHistoryIdsToDelete(newDeleteSet)
    } else {
      // Chọn ngày → tự động chọn tất cả playlist trong ngày đó để xóa
      newSet.add(date)
      const newDeleteSet = new Set(selectedHistoryIdsToDelete)
      entriesInDate.forEach(entry => newDeleteSet.add(entry.id))
      setSelectedHistoryIdsToDelete(newDeleteSet)
    }
    setSelectedDatesForDownload(newSet)
  }

  // Handle toggle playlist selection
  const handleTogglePlaylist = (playlistId: string) => {
    setSelectedPlaylistIds((prev) =>
      prev.includes(playlistId)
        ? prev.filter((id) => id !== playlistId)
        : [...prev, playlistId]
    )
  }

  // Handle export (batch)
  const handleExport = async () => {
    setErrorMessage(null)
    setDiskSpaceError(null)
    setSuccessMessage(null)
    setProgressText(null)
    cancelRequestedRef.current = false

    if (selectedPlaylistIds.length === 0) {
      setErrorMessage('Vui lòng chọn ít nhất 1 playlist.')
      return
    }
    if (!outputDir) {
      setErrorMessage('Vui lòng chọn thư mục xuất.')
      return
    }

    setLoading(true)
    // Reset speed/ETA state
    setCurrentSpeedX(null)
    setRemainingSeconds(null)
    // Set batch start time
    setBatchStartTime(Date.now())

    try {
      // Defensive check: đảm bảo playlists là array hợp lệ
      if (!playlists || !Array.isArray(playlists)) {
        console.error('[ExportAudio] playlists is invalid:', {
          playlists,
          isArray: Array.isArray(playlists),
          type: typeof playlists,
        })
        setErrorMessage('Danh sách playlist không hợp lệ.')
        return
      }
      
      const selected = playlists.filter((pl) => selectedPlaylistIds.includes(pl.id))
      if (selected.length === 0) {
        setErrorMessage('Không tìm thấy playlist đã chọn.')
        return
      }

      setTotalExportCount(selected.length)
      const results: string[] = []
      const errors: string[] = []

      for (let i = 0; i < selected.length; i++) {
        if (cancelRequestedRef.current) {
          break
        }
        const pl = selected[i]
        setCurrentExportIndex(i)
        setProgressText(`Đang xuất playlist ${i + 1}/${selected.length}: ${pl.name}`)

        // Set playlist start time và reset speed/ETA cho playlist mới
        setCurrentPlaylistStartTime(Date.now())
        setCurrentSpeedX(null)
        setRemainingSeconds(null)

        // Set progress state trước khi export
        setCurrentProgress({
          playlistId: pl.id,
          name: pl.name,
          currentSec: 0,
          totalSec: pl.totalDurationSec ?? 0,
          percent: 0,
        })

        // Chuẩn hóa tên file
        const baseName =
          (fileNamePrefix?.trim() || '') + sanitizeFileName(pl.name)

        const format =
          quality === 'mp3_320' ? 'mp3' : 'aac'
        const bitrateKbps =
          quality === 'mp3_320' ? 320 : 384

        const req: ExportPlaylistRequest = {
          playlistId: pl.id,
          outputDir,
          fileName: baseName,
          format,
          bitrateKbps,
          smoothTransitions,
          crossfadeDurationSec:
            smoothTransitions && crossfadeDuration.trim()
              ? Math.max(1, Math.min(10, Number(crossfadeDuration) || 0))
              : smoothTransitions
                ? 4 // default 4s nếu bật nhưng không nhập
                : undefined,
          normalizeLoudness,
          loudnessTargetLufs: normalizeLoudness ? -14 : undefined,
        }

        try {
          // Thêm metadata vào request để restore UI khi component mount lại
          const reqWithMetadata = {
            ...req,
            playlistName: pl.name,
            currentIndex: i,
            totalCount: selected.length,
          } as any
          
          const res = await window.api.exportPlaylist(reqWithMetadata)
          
          // Defensive check: đảm bảo response hợp lệ
          if (!res || typeof res !== 'object') {
            console.error('[ExportAudio] Invalid response from exportPlaylist:', res)
            errors.push(`${pl.name}: Response không hợp lệ từ backend`)
            continue
          }
          
          // Lưu jobId để có thể cancel
          if (res.requestId) {
            setCurrentJobId(res.requestId)
          }
          if (res.success && res.outputPath) {
            results.push(res.outputPath)
            // Set progress to 100% khi hoàn thành
            setCurrentProgress((prev) =>
              prev && prev.playlistId === pl.id
                ? { ...prev, percent: 100, currentSec: prev.totalSec }
                : prev
            )
          } else {
            const msg = res.error || 'Không rõ lỗi'
            // Nếu là lỗi dung lượng ổ đĩa → hiển thị modal chi tiết
            if (msg.startsWith('CẢNH BÁO: Dung lượng ổ đĩa không đủ')) {
              setDiskSpaceError(msg)
            } else {
              errors.push(`${pl.name}: ${msg}`)
            }
          }
        } catch (err: any) {
          // Nếu người dùng đã bấm Dừng thì coi là huỷ chủ động, không log thêm lỗi cho các playlist còn lại
          if (cancelRequestedRef.current) {
            break
          }
          console.error('[ExportAudio] exportPlaylist error', err)
          const msg = err?.message || 'Lỗi IPC/exportPlaylist'
          if (msg.startsWith('CẢNH BÁO: Dung lượng ổ đĩa không đủ')) {
            setDiskSpaceError(msg)
          } else {
            errors.push(`${pl.name}: ${msg}`)
          }
        }
      }

      // Clear progress sau khi xong tất cả
      setCurrentProgress(null)
      setProgressText(null)
      setCurrentPlaylistStartTime(null)
      setCurrentSpeedX(null)
      setRemainingSeconds(null)
      setCurrentJobId(null) // Reset jobId khi hoàn thành

      // Tính tổng thời gian batch và summary
      let summaryText = ''
      if (batchStartTime !== null && results.length > 0) {
        const totalElapsedSec = (Date.now() - batchStartTime) / 1000
        const totalAudioSec = selected.reduce((sum, pl) => sum + (pl.totalDurationSec ?? 0), 0)

        if (totalElapsedSec > 0 && totalAudioSec > 0) {
          const batchSpeedX = totalAudioSec / totalElapsedSec
          const elapsedFormatted = formatSecondsHMS(totalElapsedSec)
          summaryText = `\n\nHoàn thành ${results.length} playlist trong ${elapsedFormatted} (≈ ${batchSpeedX.toFixed(1)}× tổng thời lượng nhạc).`
        }
      }

      if (!cancelRequestedRef.current && results.length > 0) {
        setSuccessMessage(`Đã xuất ${results.length} playlist:\n${results.join('\n')}${summaryText}`)
        setLastOutputDir(outputDir)
        
        // Refresh lịch sử nếu modal đang mở
        if (historyVisible) {
          const api = window.api
          if (api?.music?.getExportHistory) {
            api.music.getExportHistory().then((list: any) => {
              const sorted = (list || []).sort((a: any, b: any) => b.exportedAt - a.exportedAt)
              setHistory(sorted)
              if (sorted.length > 0) {
                const firstDate = new Date(sorted[0].exportedAt).toLocaleDateString()
                setSelectedDate(firstDate)
              }
            }).catch((err: any) => {
              console.error('[ExportAudio] Failed to refresh history:', err)
            })
          }
        }
      }
      if (!cancelRequestedRef.current && errors.length > 0) {
        setErrorMessage(`Một số playlist bị lỗi:\n${errors.join('\n')}`)
      }

      // Reset batch start time
      setBatchStartTime(null)
    } finally {
      setLoading(false)
      setCurrentJobId(null) // Reset jobId khi hoàn thành hoặc lỗi
      if (window.api?.refreshDiskInfo) {
        try {
          await window.api.refreshDiskInfo()
        } catch (err) {
          console.error('[ExportAudio] refreshDiskInfo error:', err)
        }
      }
    }
  }

  const invalidConfig = selectedPlaylistIds.length === 0 || !outputDir

  return (
    <div style={{ padding: '24px', height: '100%', display: 'flex', gap: '24px' }}>
      {/* Cột trái: Danh sách playlist */}
      <div style={{ width: '320px', paddingRight: '16px', borderRight: '1px solid #ddd' }}>
        <h3 style={{ marginBottom: '12px', fontSize: '18px', fontWeight: 'bold' }}>
          Danh sách playlist
        </h3>
        <div style={{ marginBottom: '12px', fontSize: '12px', color: '#666' }}>
          Đã chọn: {selectedPlaylistIds.length} playlist
        </div>
        
        {/* Checkbox "Chọn tất cả playlist" */}
        {playlists.length > 0 && (
          <div
            style={{
              marginBottom: '12px',
              padding: '8px 12px',
              borderRadius: '6px',
              backgroundColor: '#f5f5f5',
              border: '1px solid #ddd',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
              }}
            >
              <input
                ref={selectAllCheckboxRef}
                type="checkbox"
                checked={allSelected}
                onChange={handleToggleSelectAll}
                disabled={playlists.length === 0}
                style={{ cursor: playlists.length === 0 ? 'not-allowed' : 'pointer' }}
              />
              <span>Chọn tất cả playlist</span>
            </label>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {playlists.length === 0 ? (
            <p style={{ color: '#888', fontSize: '14px' }}>
              Chưa có playlist nào. Hãy tạo playlist trước.
            </p>
          ) : (
            playlists.map((pl) => {
              const isSelected = selectedPlaylistIds.includes(pl.id)
              const priorityPercent = pl.totalDurationSec > 0
                ? ((pl.priorityDurationSec / pl.totalDurationSec) * 100).toFixed(1)
                : '0.0'
              const randomPercent = pl.totalDurationSec > 0
                ? ((pl.randomDurationSec / pl.totalDurationSec) * 100).toFixed(1)
                : '0.0'

              return (
                <div
                  key={pl.id}
                  onClick={() => handleTogglePlaylist(pl.id)}
                  style={{
                    cursor: 'pointer',
                    padding: '12px',
                    borderRadius: '6px',
                    border: isSelected ? '1px solid #007acc' : '1px solid #ddd',
                    backgroundColor: isSelected ? '#007acc11' : '#fff',
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'flex-start',
                    transition: 'all 0.2s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleTogglePlaylist(pl.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginTop: '2px', cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '600', marginBottom: '4px' }}>{pl.name}</div>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '2px' }}>
                      Thời lượng: {formatDurationLong(pl.totalDurationSec)} • Số bài:{' '}
                      {pl.tracks.length}
                    </div>
                    <div style={{ fontSize: '12px', color: '#999' }}>
                      Ưu tiên: {priorityPercent}% • Random: {randomPercent}%
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Cột phải: Form xuất nhạc */}
      <div style={{ flex: 1, paddingLeft: '24px' }}>
        <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>
          Xuất nhạc
        </h3>

        {/* Thư mục xuất file */}
        <div style={{ marginTop: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
            Thư mục xuất file
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              readOnly
              value={outputDir || 'Chưa chọn thư mục'}
              style={{
                flex: 1,
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                backgroundColor: '#f5f5f5',
                fontSize: '14px',
              }}
            />
            <button
              onClick={handleSelectFolder}
              disabled={loading}
              style={{
                padding: '8px 16px',
                backgroundColor: '#007acc',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                opacity: loading ? 0.6 : 1,
              }}
            >
              Chọn thư mục
            </button>
          </div>
        </div>

        {/* Tiền tố tên file */}
        <div style={{ marginTop: '12px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
            Tiền tố tên file (tùy chọn)
          </label>
          <input
            type="text"
            value={fileNamePrefix}
            onChange={(e) => setFileNamePrefix(e.target.value)}
            placeholder="VD: set_nhac_tet_"
            disabled={loading}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
            }}
          />
          <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
            Nếu bỏ trống, sẽ dùng tên playlist làm tên file
          </div>
        </div>

        {/* Định dạng */}
        <div style={{ marginTop: '12px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
            Định dạng
          </label>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as AudioQuality)}
            disabled={loading}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
            }}
          >
            <option value="mp3_320">MP3 (320 kbps)</option>
            <option value="aac_384">AAC (384 kbps, M4A – khuyến nghị YouTube)</option>
          </select>
          <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
            MP3: Dung lượng nhẹ hơn. AAC (M4A): Phù hợp với YouTube/Spotify, chất lượng cao hơn MP3 cùng bitrate.
          </div>
        </div>

        {/* Chuyển bài mượt (crossfade) */}
        <div style={{ marginTop: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '500' }}>
            <input
              type="checkbox"
              checked={smoothTransitions}
              onChange={(e) => setSmoothTransitions(e.target.checked)}
              disabled={loading}
            />
            <span>Chuyển bài mượt (crossfade)</span>
          </label>
          <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <NumericDraftInput
              min={1}
              max={10}
              step={0.5}
              allowBlank
              disabled={loading || !smoothTransitions}
              value={crossfadeDuration === '' ? '' : Number(crossfadeDuration)}
              onCommit={(value) => setCrossfadeDuration(value === '' ? '' : String(value))}
              placeholder="Thời lượng crossfade (giây, mặc định 4s)"
              style={{
                flex: 1,
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px',
                backgroundColor: smoothTransitions ? '#fff' : '#f5f5f5',
              }}
            />
            <span style={{ fontSize: '12px', color: '#666' }}>1-10s</span>
          </div>
          <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
            Nếu bật, các bài sẽ crossfade mượt mà với nhau. Để trống sẽ dùng mặc định 4s.
          </div>
        </div>

        {/* Cân bằng âm lượng (Loudness Normalization) */}
        <div style={{ marginTop: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '500' }}>
            <input
              type="checkbox"
              checked={normalizeLoudness}
              onChange={(e) => setNormalizeLoudness(e.target.checked)}
              disabled={loading}
            />
            <span>Cân bằng âm lượng giữa các bài (Loudnorm)</span>
          </label>
          <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
            Tự động đồng đều âm lượng giữa tất cả các bài theo chuẩn EBU R128 (-14 LUFS = chuẩn YouTube/Spotify).
            Bài to sẽ được giảm, bài nhỏ sẽ được tăng — đảm bảo không bị chênh lệch khi nghe liên tục.
          </div>
          {normalizeLoudness && (
            <div style={{ marginTop: '4px', fontSize: '12px', color: '#f59e0b', fontStyle: 'italic' }}>
              Lưu ý: Mỗi bài sẽ được xử lý riêng trước khi ghép, nên thời gian xuất sẽ lâu hơn bình thường.
            </div>
          )}
        </div>

        {/* Nút kiểm tra playlist (chỉ hiện khi crossfade bật) */}
        {smoothTransitions && selectedPlaylistIds.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <button
              onClick={async () => {
                setIsValidating(true)
                setValidationResults(null)
                setErrorMessage(null)
                try {
                  const api = window.api
                  if (!api?.music?.validatePlaylistsForCrossfade) {
                    setErrorMessage('API validatePlaylistsForCrossfade chưa sẵn sàng.')
                    return
                  }
                  const crossfadeSec = smoothTransitions && crossfadeDuration.trim()
                    ? Math.max(1, Math.min(10, Number(crossfadeDuration) || 4))
                    : 4
                  const result = await api.music.validatePlaylistsForCrossfade({
                    playlistIds: selectedPlaylistIds,
                    crossfadeDurationSec: crossfadeSec,
                  })
                  setValidationResults(result.results || [])
                  if (result.totalWithIssues > 0) {
                    setErrorMessage(`Phát hiện ${result.totalWithIssues}/${result.totalChecked} playlist có track lỗi. Xem chi tiết bên dưới.`)
                  } else {
                    setSuccessMessage(`Tất cả ${result.totalChecked} playlist đều OK cho crossfade.`)
                  }
                } catch (err: any) {
                  console.error('[ExportAudio] Validate error:', err)
                  setErrorMessage(`Lỗi khi kiểm tra playlist: ${err?.message || 'Lỗi không xác định'}`)
                } finally {
                  setIsValidating(false)
                }
              }}
              disabled={isValidating || loading || selectedPlaylistIds.length === 0}
              style={{
                width: '100%',
                padding: '10px 20px',
                backgroundColor: isValidating || loading || selectedPlaylistIds.length === 0 ? '#ccc' : '#28a745',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: isValidating || loading || selectedPlaylistIds.length === 0 ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
              }}
            >
              {isValidating ? 'Đang kiểm tra...' : `🔍 Kiểm tra ${selectedPlaylistIds.length} playlist`}
            </button>
            <div style={{ marginTop: '6px', fontSize: '12px', color: '#666' }}>
              Kiểm tra các track trong playlist có phù hợp để chạy crossfade không (decode thử 2s đầu mỗi file).
            </div>
          </div>
        )}

        {/* Hiển thị kết quả validation */}
        {validationResults && validationResults.length > 0 && (
          <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px' }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#856404' }}>
              Kết quả kiểm tra playlist:
            </div>
            {validationResults.map((result) => {
              if (result.issues.length === 0) {
                return (
                  <div key={result.playlistId} style={{ marginBottom: '8px', fontSize: '13px', color: '#155724' }}>
                    <strong>{result.playlistName}</strong>: OK
                  </div>
                )
              }
              return (
                <div key={result.playlistId} style={{ marginBottom: '12px', fontSize: '13px' }}>
                  <div style={{ fontWeight: 'bold', color: '#856404', marginBottom: '4px' }}>
                    <strong>{result.playlistName}</strong> ({result.issues.length} track lỗi):
                  </div>
                  <ul style={{ margin: '4px 0', paddingLeft: '20px', color: '#856404' }}>
                    {result.issues.map((issue, idx) => (
                      <li key={idx} style={{ marginBottom: '4px' }}>
                        <strong>{issue.trackName}</strong>
                        <div style={{ fontSize: '11px', color: '#666', marginLeft: '16px', marginTop: '2px' }}>
                          {issue.reason}
                        </div>
                        <div style={{ fontSize: '11px', color: '#999', marginLeft: '16px', fontFamily: 'monospace' }}>
                          {issue.trackPath}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}

        {/* Nút xuất */}
        <div style={{ marginTop: '20px' }}>
          <button
            onClick={handleExport}
            disabled={loading || invalidConfig}
            style={{
              width: '100%',
              padding: '12px 24px',
              backgroundColor: invalidConfig || loading ? '#ccc' : '#007acc',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: invalidConfig || loading ? 'not-allowed' : 'pointer',
              fontSize: '16px',
              fontWeight: 'bold',
            }}
          >
            {loading
              ? 'Đang xuất... (vui lòng chờ)'
              : selectedPlaylistIds.length === 0
                ? 'Xuất nhạc'
                : `Xuất ${selectedPlaylistIds.length} playlist`}
          </button>
          {loading && currentJobId && (
            <button
              onClick={async () => {
                try {
                  cancelRequestedRef.current = true
                  await window.api.jobQueue.cancel(currentJobId)
                  setLoading(false)
                  setCurrentJobId(null)
                  setProgressText('Đã dừng xuất nhạc')
                  setErrorMessage('Người dùng đã dừng xuất nhạc.')
                } catch (err) {
                  console.error('[ExportAudio] Cancel error:', err)
                  setErrorMessage('Không thể dừng xuất nhạc. Vui lòng thử lại.')
                }
              }}
              style={{
                padding: '12px 24px',
                backgroundColor: '#d32f2f',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: 'bold',
                marginLeft: '12px',
              }}
            >
              Dừng xuất nhạc
            </button>
          )}
        </div>

        {/* Progress bar + nút mở thư mục sau khi xuất xong */}
        {loading && currentProgress && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px',
              borderRadius: '4px',
              backgroundColor: '#fffbe6',
              border: '1px solid #ffe58f',
              color: '#614700',
              fontSize: '13px',
            }}
          >
            <div style={{ marginBottom: '8px' }}>
              Đang xuất playlist {currentExportIndex + 1}/{totalExportCount}:{' '}
              <strong>{currentProgress.name}</strong> (
              {formatDuration(currentProgress.currentSec)} /{' '}
              {formatDuration(currentProgress.totalSec)} –{' '}
              {currentProgress.percent.toFixed(1)}%)
              {currentSpeedX !== null && (
                <>
                  {' • Tốc độ: ≈ '}
                  {currentSpeedX.toFixed(1)}×
                </>
              )}
              {remainingSeconds !== null && (
                <>
                  {' • Còn lại: '}
                  {formatSecondsHMS(remainingSeconds)}
                </>
              )}
            </div>
            <div
              style={{
                position: 'relative',
                height: '8px',
                borderRadius: '999px',
                backgroundColor: '#333',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${Math.max(0, Math.min(100, currentProgress.percent))}%`,
                  background: '#40a9ff',
                  transition: 'width 0.2s linear',
                }}
              />
            </div>
          </div>
        )}

        {/* Nút mở thư mục sau khi xuất xong */}
        {!loading && lastOutputDir && (
          <div style={{ marginTop: '12px' }}>
            <button
              onClick={() => window.api.openPath(lastOutputDir!)}
              style={{
                padding: '10px 20px',
                backgroundColor: '#2d2d2d',
                color: '#fff',
                border: '1px solid #444',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
              }}
            >
              Mở thư mục đã xuất
            </button>
          </div>
        )}

        {/* Fallback progress text (nếu không có progress event) */}
        {loading && !currentProgress && progressText && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px',
              backgroundColor: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: '4px',
              color: '#856404',
            }}
          >
            <p style={{ margin: 0, fontSize: '14px', whiteSpace: 'pre-line' }}>
              {progressText}
            </p>
          </div>
        )}

        {/* Success message */}
        {successMessage && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px',
              backgroundColor: '#d4edda',
              border: '1px solid #c3e6cb',
              borderRadius: '4px',
              color: '#155724',
            }}
          >
            <p style={{ margin: 0, fontSize: '14px', whiteSpace: 'pre-line' }}>
              {successMessage}
            </p>
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px',
              backgroundColor: '#f8d7da',
              border: '1px solid #f5c6cb',
              borderRadius: '4px',
              color: '#721c24',
            }}
          >
            <p style={{ margin: 0, fontSize: '14px', whiteSpace: 'pre-line' }}>
              {errorMessage}
            </p>
          </div>
        )}

        <DiskSpaceErrorModal error={diskSpaceError} onClose={() => setDiskSpaceError(null)} />

        {/* Lịch sử export */}
        {historyVisible && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => {
              setHistoryVisible(false)
              setSelectedHistoryIdsToDelete(new Set())
              setSelectedHistoryId(null)
            }}
          >
            <div
              style={{
                background: '#fff',
                padding: '20px',
                borderRadius: '8px',
                width: '700px',
                maxHeight: '80vh',
                overflow: 'auto',
                position: 'relative',
                color: '#000',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ marginTop: 0 }}>Lịch sử playlist đã xuất</h3>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch' }}>
                {/* Cột ngày */}
                <div style={{ width: '180px', borderRight: '1px solid #ddd', paddingRight: '8px', overflowY: 'auto', maxHeight: '60vh' }}>
                  {historyDates.length === 0 && <div>Chưa có lịch sử.</div>}
                  {historyDates.map((d) => (
                    <div
                      key={d}
                      style={{
                        padding: '8px',
                        marginBottom: '6px',
                        borderRadius: '6px',
                        background: selectedDate === d ? '#e6f7ff' : '#f5f5f5',
                        border: '1px solid #ccc',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedDatesForDownload.has(d)}
                        onChange={() => handleToggleDateForDownload(d)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ cursor: 'pointer' }}
                      />
                      <div
                        onClick={() => {
                          setSelectedDate(d)
                          setSelectedHistoryId(null)
                          setClaimResult(null)
                        }}
                        style={{
                          flex: 1,
                          cursor: 'pointer',
                        }}
                      >
                        {d}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Danh sách playlist theo ngày + tra cứu */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ marginBottom: '4px' }}>Nhập thời gian bị claim (mm:ss):</div>
                      <input
                        type="text"
                        value={claimTime}
                        onChange={(e) => setClaimTime(e.target.value)}
                        placeholder="ví dụ: 03:15"
                        style={{ width: '100%', padding: '8px' }}
                      />
                    </div>
                    <button onClick={handleFindClaim} style={{ padding: '8px 12px', marginTop: '20px' }}>
                      Tra cứu
                    </button>
                  </div>
                  {claimResult && (
                    <div style={{ marginTop: '4px', fontWeight: 600, color: '#333' }}>{claimResult}</div>
                  )}

                  <div style={{ marginTop: '12px' }}>
                    {filteredHistory.length > 0 && (
                      <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '14px', color: '#666' }}>
                          {filteredHistory.length} playlist
                        </div>
                        <button
                          onClick={() => {
                            if (selectedHistoryIdsToDelete.size === filteredHistory.length) {
                              // Bỏ chọn tất cả → bỏ chọn ngày
                              setSelectedHistoryIdsToDelete(new Set())
                              if (selectedDate) {
                                const newDateSet = new Set(selectedDatesForDownload)
                                newDateSet.delete(selectedDate)
                                setSelectedDatesForDownload(newDateSet)
                              }
                            } else {
                              // Chọn tất cả → tự động chọn ngày
                              const allIds = new Set(filteredHistory.map(h => h.id))
                              setSelectedHistoryIdsToDelete(allIds)
                              if (selectedDate) {
                                const newDateSet = new Set(selectedDatesForDownload)
                                newDateSet.add(selectedDate)
                                setSelectedDatesForDownload(newDateSet)
                              }
                            }
                          }}
                          style={{
                            padding: '4px 12px',
                            fontSize: '12px',
                            backgroundColor: '#f0f0f0',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                        >
                          {selectedHistoryIdsToDelete.size === filteredHistory.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                        </button>
                      </div>
                    )}
                    <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
                      {filteredHistory.length === 0 && <div>Chọn ngày để xem playlist đã xuất.</div>}
                      {filteredHistory.map((h) => (
                      <div
                        key={h.id}
                        style={{
                          padding: '8px',
                          marginBottom: '6px',
                          border: '1px solid #ccc',
                          borderRadius: '6px',
                          background: selectedHistoryId === h.id ? '#e6f7ff' : '#fafafa',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '8px',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedHistoryIdsToDelete.has(h.id)}
                          onChange={(e) => {
                            e.stopPropagation()
                            const newSet = new Set(selectedHistoryIdsToDelete)
                            const entryDate = new Date(h.exportedAt).toLocaleDateString()
                            
                            if (e.target.checked) {
                              // Chọn playlist → tự động chọn ngày của playlist đó
                              newSet.add(h.id)
                              const newDateSet = new Set(selectedDatesForDownload)
                              newDateSet.add(entryDate)
                              setSelectedDatesForDownload(newDateSet)
                            } else {
                              // Bỏ chọn playlist → bỏ chọn ngày nếu không còn playlist nào trong ngày đó được chọn
                              newSet.delete(h.id)
                              const entriesInDate = historyByDate.get(entryDate) || []
                              const hasOtherSelected = entriesInDate.some(e => e.id !== h.id && newSet.has(e.id))
                              if (!hasOtherSelected) {
                                const newDateSet = new Set(selectedDatesForDownload)
                                newDateSet.delete(entryDate)
                                setSelectedDatesForDownload(newDateSet)
                              }
                            }
                            setSelectedHistoryIdsToDelete(newSet)
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{ cursor: 'pointer', marginTop: '2px', flexShrink: 0 }}
                        />
                        <div
                          onClick={() => setSelectedHistoryId(h.id)}
                          style={{
                            flex: 1,
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{h.playlistName}</div>
                          <div style={{ fontSize: '12px', color: '#666' }}>
                            Xuất lúc: {new Date(h.exportedAt).toLocaleString()}
                          </div>
                          <div style={{ fontSize: '12px', color: '#666' }}>File: {h.outputPath}</div>
                        </div>
                      </div>
                      ))}
                    </div>
                  </div>

                  {selectedHistoryId && (
                    <div style={{ marginTop: '12px', maxHeight: '200px', overflow: 'auto' }}>
                      <div style={{ fontWeight: 600, marginBottom: '6px' }}>Tracklist:</div>
                      {history
                        .find((h) => h.id === selectedHistoryId)
                        ?.tracks.map((t, idx) => (
                          <div key={idx} style={{ fontSize: '12px', marginBottom: '4px' }}>
                            {formatSecondsHMS(t.startSec)} - {t.name}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Chọn thư mục xuất lịch sử */}
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #ddd' }}>
                <div style={{ marginBottom: '8px', fontSize: '14px', fontWeight: '600' }}>
                  Thư mục xuất lịch sử:
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={historyOutputDir}
                    onChange={(e) => setHistoryOutputDir(e.target.value)}
                    placeholder="Để trống sẽ dùng thư mục mặc định"
                    style={{
                      flex: 1,
                      padding: '8px',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      fontSize: '14px',
                    }}
                  />
                  <button
                    onClick={handleSelectHistoryOutputDir}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#007acc',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '600',
                    }}
                  >
                    Chọn thư mục
                  </button>
                </div>
              </div>
              
              {/* Nút xóa và tải playlist */}
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #ddd' }}>
                {/* Nút xóa */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ fontSize: '14px', color: '#666' }}>
                    {selectedHistoryIdsToDelete.size > 0 
                      ? `Đã chọn ${selectedHistoryIdsToDelete.size} playlist để xóa`
                      : selectedDatesForDownload.size > 0
                      ? `Đã chọn ${selectedDatesForDownload.size} ngày để xóa`
                      : 'Chưa chọn playlist hoặc ngày để xóa'}
                  </div>
                  <button
                    onClick={handleDeleteHistoryEntries}
                    disabled={(selectedHistoryIdsToDelete.size === 0 && selectedDatesForDownload.size === 0) || isDeletingHistory}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: (selectedHistoryIdsToDelete.size === 0 && selectedDatesForDownload.size === 0) || isDeletingHistory ? '#ccc' : '#dc3545',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: (selectedHistoryIdsToDelete.size === 0 && selectedDatesForDownload.size === 0) || isDeletingHistory ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: '600',
                    }}
                  >
                    {isDeletingHistory ? 'Đang xóa...' : 'Xóa đã chọn'}
                  </button>
                </div>
                
                {/* Nút tải */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '14px', color: '#666' }}>
                    {selectedDatesForDownload.size > 0
                      ? `Đã chọn ${selectedDatesForDownload.size} ngày`
                      : selectedHistoryIdsToDelete.size > 0
                      ? `Đã chọn ${selectedHistoryIdsToDelete.size} playlist để tải`
                      : 'Chưa chọn ngày hoặc playlist để tải'}
                  </div>
                  <button
                    onClick={handleDownloadPlaylists}
                    disabled={(selectedDatesForDownload.size === 0 && selectedHistoryIdsToDelete.size === 0) || isDownloadingPlaylists}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: (selectedDatesForDownload.size === 0 && selectedHistoryIdsToDelete.size === 0) || isDownloadingPlaylists ? '#ccc' : '#007acc',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: (selectedDatesForDownload.size === 0 && selectedHistoryIdsToDelete.size === 0) || isDownloadingPlaylists ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: '600',
                    }}
                  >
                    {isDownloadingPlaylists ? 'Đang tải...' : 'Tải về'}
                  </button>
                </div>
              </div>
              <button
                onClick={() => {
              setHistoryVisible(false)
              setSelectedHistoryIdsToDelete(new Set())
              setSelectedHistoryId(null)
            }}
                style={{ position: 'absolute', top: 10, right: 10, background: 'transparent', border: 'none' }}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <button
          onClick={() => setHistoryVisible(true)}
          style={{
            position: 'fixed',
            bottom: '16px',
            right: '16px',
            padding: '10px 14px',
            backgroundColor: '#007acc',
            color: '#fff',
            border: 'none',
            borderRadius: '20px',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        >
          Lịch sử playlist đã xuất
        </button>
      </div>
    </div>
  )
}

export default ExportAudioPage

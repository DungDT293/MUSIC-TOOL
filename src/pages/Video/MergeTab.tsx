import { useEffect, useState } from 'react'
import { DiskSpaceErrorModal } from '../../components/DiskSpaceErrorModal'
import { runLimited } from '../../utils/runLimited'

// Helper to extract filename from path (handles Unicode correctly)
function getFileName(filePath: string): string {
  if (!filePath) return ''
  // Handle both / and \ separators, works with Unicode paths
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

interface MergeVideosSimpleRequest {
  inputFiles: string[]
  outputDir: string
  outputFileName: string
  shuffle?: boolean
  mute?: boolean
  targetDurationSec?: number | null
  mergeCount?: number
  repeatCount?: number
  forceReencode?: boolean
  useGpuEncoding?: boolean // true = prefer GPU, false = force CPU, undefined = auto
  priorityPaths?: string[] // Danh sách path video ưu tiên
  unifyFormat?: boolean      // Chuẩn hóa tỉ lệ khung hình + FPS
  targetResolution?: string  // '1920x1080' | '1440x1080' | ... etc.
  targetFps?: string         // '24' | '25' | '30000/1001' | '30' | '50' | '60000/1001' | '60'
}

interface MergeVideosSimpleResult {
  requestId: string
  outputPaths: string[]
  outputPath?: string // Backward compatibility
  totalDurationSec: number
  success: boolean
  error?: string
  avgSpeed?: number
}

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

function formatDurationFromSeconds(sec: number): string {
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

type MergeVideoItem = {
  path: string
  fileName: string
  sizeBytes?: number
  durationSec?: number // Thời lượng video (chỉ load field này, không load full info)
}

function MergeTab() {
  const [videoItems, setVideoItems] = useState<MergeVideoItem[]>([])
  const [outputDir, setOutputDir] = useState<string>('')
  const [outputFileName, setOutputFileName] = useState<string>('merged.mp4')

  const [shuffleOrder, setShuffleOrder] = useState<boolean>(true)
  const [muteAudio, setMuteAudio] = useState<boolean>(false)
  const [forceReencode, setForceReencode] = useState<boolean>(false)
  const [useGpuEncoding, setUseGpuEncoding] = useState<boolean>(false) // false = CPU, true = GPU
  const [unifyFormat, setUnifyFormat] = useState<boolean>(false)
  const [targetResolution, setTargetResolution] = useState<string>('1920x1080')
  const [targetFps, setTargetFps] = useState<string>('30')
  const [mergeCount, setMergeCount] = useState<string>('1')
  const [limitDurationEnabled, setLimitDurationEnabled] = useState<boolean>(false)
  const [limitValue, setLimitValue] = useState<string>('')
  const [limitUnit, setLimitUnit] = useState<'seconds' | 'minutes'>('minutes')

  // Video ưu tiên: luôn đứng đầu khi ghép
  const [usePriorityVideos, setUsePriorityVideos] = useState<boolean>(false)
  const [priorityFolder, setPriorityFolder] = useState<string>('')
  const [priorityVideoPaths, setPriorityVideoPaths] = useState<string[]>([])

  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null)
  const [currentProgress, setCurrentProgress] = useState<{
    timeSec: number
    totalDurationSec: number
    percent: number
    speedX: number | null
    etaSec: number | null
    currentJob?: number
    totalJobs?: number
    currentFile?: string
  } | null>(null)
  const [statusText, setStatusText] = useState<string>('')
  const [performanceWarning, setPerformanceWarning] = useState<string | null>(null)

  const [successData, setSuccessData] = useState<MergeVideosSimpleResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [diskSpaceError, setDiskSpaceError] = useState<string | null>(null)

  const totalVideos = videoItems.length

  // Restore state từ running job khi component mount lại (sau khi chuyển tab)
  useEffect(() => {
    let mounted = true

    const restoreRunningJob = async () => {
      try {
        const activeMergeId = await window.api.videoGetActiveMergeJobId?.()
        if (mounted && activeMergeId) {
          console.log('[MergeTab] Found running merge job, restoring state:', activeMergeId)
          setCurrentRequestId(activeMergeId)
          setIsProcessing(true)
          setStatusText('Đang tiếp tục ghép video...')
        } else if (mounted) {
          setIsProcessing(false)
          setCurrentRequestId(null)
        }
      } catch (err) {
        console.error('[MergeTab] Failed to restore running job:', err)
      }
    }

    restoreRunningJob()

    return () => {
      mounted = false
    }
  }, []) // Chạy một lần khi component mount

  // Subscribe to progress events
  useEffect(() => {
    const unsubscribe = window.api.onVideoProgress((payload: any) => {
      if (payload?.mode !== 'merge') return
      
      // Set requestId từ progress event nếu chưa có
      if (!currentRequestId && payload.requestId) {
        setCurrentRequestId(payload.requestId)
        setIsProcessing(true) // Restore processing state if lost
      }
      
      // Chỉ update progress nếu requestId khớp
      if (!currentRequestId || payload.requestId === currentRequestId) {
        // Tính ETA từ timeSec, totalDurationSec, speedX
        let etaSec: number | null = null
        if (payload.timeSec && payload.totalDurationSec && payload.speedX && payload.speedX > 0) {
          const remainingSec = Math.max(0, payload.totalDurationSec - payload.timeSec)
          etaSec = remainingSec / payload.speedX
        }
        
        setCurrentProgress({
          timeSec: payload.timeSec || 0,
          totalDurationSec: payload.totalDurationSec || 0,
          percent: payload.percent || 0,
          speedX: payload.speedX ?? null,
          etaSec: payload.etaSec ?? etaSec,
          currentJob: payload.currentJob,
          totalJobs: payload.totalJobs,
          currentFile: payload.currentFile,
        })
        
        // Update status text
        if (payload.message) {
          // Check for performance hint
          if (payload.message === 'performanceHint:targetMuchLargerThanInput') {
            setPerformanceWarning(
              'Thời lượng mong muốn lớn hơn nhiều so với video đầu vào. Tool sẽ phải lặp lại video nhiều lần nên thời gian xử lý có thể lâu hơn bình thường.'
            )
          } else if (!payload.message.startsWith('performanceHint:')) {
            setStatusText(payload.message)
          }
        }
        
        // Check for error only (don't handle completed here, let API result handle it)
        if (payload.error) {
          setIsProcessing(false)
          setCurrentProgress(null)
          setErrorMessage(payload.error)
        }
      }
    })

    return unsubscribe
  }, [currentRequestId])

  const handleSelectManyVideos = async () => {
    setErrorMessage(null)
    setSuccessData(null)
    try {
      const paths: string[] | null = await window.api.selectManyVideos?.()
      if (!paths || !paths.length) return

      const existingPaths = new Set(videoItems.map((v) => v.path))
      const newItems: MergeVideoItem[] = paths
        .filter((p) => !existingPaths.has(p))
        .map((p) => ({
          path: p,
          fileName: getFileName(p),
        }))

      if (newItems.length) {
        setVideoItems((prev) => [...prev, ...newItems])
        
        // Load duration only (lightweight, async, không block UI) with concurrency limit
        const MAX_INFO_ITEMS = 200
        const itemsForInfo = newItems.slice(0, MAX_INFO_ITEMS)
        
        runLimited(itemsForInfo, 8, async (item) => {
          try {
            const info = await window.api.videoGetFileInfo(item.path)
            const durationSec = info?.durationSec
            
            if (typeof durationSec === 'number' && durationSec > 0) {
              setVideoItems((prev) => {
                const clone = [...prev]
                const targetIndex = clone.findIndex((v) => v.path === item.path)
                if (targetIndex < 0) return prev // Item không còn trong list
                clone[targetIndex] = { ...clone[targetIndex], durationSec }
                return clone
              })
            }
          } catch (e) {
            console.warn('[MergeTab] Failed to load duration for', item.path, e)
          }
        })
      }
    } catch (err) {
      console.error('[MergeTab] selectManyVideos error', err)
      setErrorMessage('Không chọn được danh sách video.')
    }
  }

  const handleAddFromFolder = async () => {
    setErrorMessage(null)
    setSuccessData(null)
    try {
      const folder = await window.api.selectFolder()
      if (!folder) {
        console.log('[MergeTab] No folder selected')
        return
      }

      console.log('[MergeTab] Selected folder:', folder)
      const files = (await window.api.listVideosInFolderSimple?.(folder)) || []
      console.log('[MergeTab] Found files:', files.length, files)
      
      if (files.length === 0) {
        setErrorMessage('Không tìm thấy video nào trong thư mục này.')
        return
      }

      const existingPaths = new Set(videoItems.map((v) => v.path))
      const newItems: MergeVideoItem[] = files
        .filter((f: any) => f && f.path && !existingPaths.has(f.path))
        .map((f: any) => ({
          path: f.path,
          fileName: f.fileName || getFileName(f.path) || 'Unknown',
          sizeBytes: f.sizeBytes || 0,
        }))

      console.log('[MergeTab] New items to add:', newItems.length)

      if (newItems.length) {
        setVideoItems((prev) => [...prev, ...newItems])
        
        // Load duration only (lightweight, async, không block UI) with concurrency limit
        const MAX_INFO_ITEMS = 200
        const itemsForInfo = newItems.slice(0, MAX_INFO_ITEMS)
        
        runLimited(itemsForInfo, 8, async (item) => {
          try {
            const info = await window.api.videoGetFileInfo(item.path)
            const durationSec = info?.durationSec
            
            if (typeof durationSec === 'number' && durationSec > 0) {
              setVideoItems((prev) => {
                const clone = [...prev]
                const targetIndex = clone.findIndex((v) => v.path === item.path)
                if (targetIndex < 0) return prev // Item không còn trong list
                clone[targetIndex] = { ...clone[targetIndex], durationSec }
                return clone
              })
            }
          } catch (e) {
            console.warn('[MergeTab] Failed to load duration for', item.path, e)
          }
        })
      } else {
        setErrorMessage('Tất cả video trong thư mục đã được thêm vào danh sách.')
      }
    } catch (err) {
      console.error('[MergeTab] addFromFolder error', err)
      setErrorMessage(`Không quét được thư mục video: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSelectPriorityFolder = async () => {
    setErrorMessage(null)
    setSuccessData(null)

    try {
      const folder = await window.api.selectFolder()
      if (!folder) return

      setPriorityFolder(folder)

      const files = (await window.api.listVideosInFolderSimple?.(folder)) || []
      if (!files.length) {
        setErrorMessage('Không tìm thấy video nào trong thư mục ưu tiên.')
        setPriorityVideoPaths([])
        return
      }

      const newPriorityPaths = files.map((f: any) => f.path).filter(Boolean)
      setPriorityVideoPaths(newPriorityPaths)

      // Tự động bổ sung các video ưu tiên vào danh sách chung nếu chưa có và sắp xếp lại
      const existingPaths = new Set(videoItems.map((v) => v.path))
      const newItems: MergeVideoItem[] = files
        .filter((f: any) => f && f.path && !existingPaths.has(f.path))
        .map((f: any) => ({
          path: f.path,
          fileName: f.fileName || getFileName(f.path) || 'Unknown',
          sizeBytes: f.sizeBytes || 0,
        }))

      setVideoItems((prev) => {
        const prioritySet = new Set(newPriorityPaths)
        const priorityItems: MergeVideoItem[] = []
        const normalItems: MergeVideoItem[] = []
        
        // Thêm các video mới vào priority items
        priorityItems.push(...newItems)
        
        // Phân loại các video hiện có
        prev.forEach((item) => {
          if (prioritySet.has(item.path)) {
            priorityItems.push(item)
          } else {
            normalItems.push(item)
          }
        })
        
        return [...priorityItems, ...normalItems]
      })
    } catch (err) {
      console.error('[MergeTab] selectPriorityFolder error', err)
      setErrorMessage('Không chọn được thư mục ưu tiên.')
    }
  }

  const handleSelectPriorityVideos = async () => {
    setErrorMessage(null)
    setSuccessData(null)

    try {
      const paths: string[] | null = await window.api.selectManyVideos?.()
      if (!paths || !paths.length) return

      // Set priority video paths directly
      setPriorityVideoPaths(paths)
      setPriorityFolder('') // Clear folder path when selecting individual videos

      // Tự động bổ sung các video ưu tiên vào danh sách chung nếu chưa có và sắp xếp lại
      const existingPaths = new Set(videoItems.map((v) => v.path))
      const newItems: MergeVideoItem[] = paths
        .filter((p) => !existingPaths.has(p))
        .map((p) => ({
          path: p,
          fileName: getFileName(p),
        }))

      setVideoItems((prev) => {
        const prioritySet = new Set(paths)
        const priorityItems: MergeVideoItem[] = []
        const normalItems: MergeVideoItem[] = []
        
        // Thêm các video mới vào priority items
        priorityItems.push(...newItems)
        
        // Phân loại các video hiện có
        prev.forEach((item) => {
          if (prioritySet.has(item.path)) {
            priorityItems.push(item)
          } else {
            normalItems.push(item)
          }
        })
        
        return [...priorityItems, ...normalItems]
      })
    } catch (err) {
      console.error('[MergeTab] selectPriorityVideos error', err)
      setErrorMessage('Không chọn được video ưu tiên.')
    }
  }

  const handleClearList = () => {
    setVideoItems([])
    setSuccessData(null)
    setErrorMessage(null)
  }

  const handlePickFromPool = async () => {
    try {
      // Tự suy thư mục từ video đang có trong danh sách (không hỏi nếu đã có video)
      let folder: string | null = null
      if (videoItems.length > 0) {
        // Dùng thư mục của video đầu tiên trong danh sách
        const firstPath = videoItems[0].path
        folder = firstPath.replace(/[/\\][^/\\]+$/, '') // dirname
      } else {
        // Chưa có video → mới hỏi thư mục
        folder = await window.api.selectFolder()
      }
      if (!folder) return
      const result = await window.api.videoPoolPickLRU?.(folder, 200)
      if (!result?.ok) {
        setErrorMessage('Không thể truy vấn pool video.')
        return
      }
      if (!result.filePaths?.length) {
        setErrorMessage('Không tìm thấy clip nào trong pool từ thư mục này.')
        return
      }
      const existingPaths = new Set(videoItems.map((v) => v.path))
      const newItems: VideoItem[] = result.filePaths
        .filter((p: string) => !existingPaths.has(p))
        .map((p: string) => ({ path: p, fileName: getFileName(p) }))
      if (newItems.length) {
        setVideoItems((prev) => [...prev, ...newItems])
      }
      const reused = result.reusedCount ?? 0
      const total = result.totalAvailable ?? result.filePaths.length
      console.log(`[MergeTab] Pool pick: ${newItems.length} new clips added (${reused}/${total} reused in pool)`)
    } catch (err) {
      console.error('[MergeTab] handlePickFromPool error', err)
      setErrorMessage('Lỗi khi lấy clip từ pool.')
    }
  }

  const handleSelectOutputDir = async () => {
    const dir = await window.api.selectFolder()
    if (dir) setOutputDir(dir)
  }

  const handleCancel = async () => {
    if (!currentRequestId) return
    try {
      await window.api.videoCancelJob(currentRequestId)
      setIsProcessing(false)
      setCurrentRequestId(null)
      setCurrentProgress(null)
      setErrorMessage('Đã dừng bởi người dùng')
    } catch (e) {
      console.error('[MergeTab] Cancel failed', e)
    }
  }

  const handleMerge = async () => {
    setErrorMessage(null)
    setDiskSpaceError(null)
    setSuccessData(null)
    setCurrentProgress(null)

    if (videoItems.length === 0) {
      setErrorMessage('Hãy chọn ít nhất 1 video.')
      return
    }
    if (!outputDir) {
      setErrorMessage('Hãy chọn thư mục xuất.')
      return
    }

    let targetDurationSec: number | null = null
    if (limitDurationEnabled && limitValue.trim() !== '') {
      const v = parseFloat(limitValue.replace(',', '.').trim())
      if (!isNaN(v) && v > 0 && isFinite(v)) {
        targetDurationSec = limitUnit === 'minutes' ? v * 60 : v
        console.log(`[MergeTab] targetDurationSec calculated: ${targetDurationSec}s (from ${limitValue} ${limitUnit})`)
      } else {
        setErrorMessage('Giá trị thời lượng không hợp lệ. Vui lòng nhập số dương.')
        return
      }
    }
    // UltraFast: Đảm bảo KHÔNG có targetDurationSec khi không tick checkbox
    // (targetDurationSec đã là null nếu không tick, nhưng log để debug)
    const useLimitDuration = limitDurationEnabled && targetDurationSec !== null

    setIsProcessing(true)
    setCurrentProgress(null)
    setStatusText('Đang chuẩn bị...')
    setPerformanceWarning(null) // Clear warning khi bắt đầu job mới

    try {
      // Tách nhóm video ưu tiên / thường
      const allPaths = videoItems.map((v) => v.path)
      const prioritySet =
        usePriorityVideos && priorityVideoPaths.length > 0
          ? new Set(priorityVideoPaths)
          : new Set<string>()

      const priorityList: string[] = []
      const normalList: string[] = []

      for (const p of allPaths) {
        if (prioritySet.has(p)) {
          priorityList.push(p)
        } else {
          normalList.push(p)
        }
      }

      // FIX: Luôn để backend xử lý shuffle để đảm bảo logic nhất quán
      // Backend sẽ shuffle đúng cách cho cả no-target và has-target mode
      const orderedInputFiles = allPaths

      const req: MergeVideosSimpleRequest = {
        inputFiles: orderedInputFiles,
        outputDir,
        outputFileName,
        // FIX: Luôn truyền shuffle từ UI để backend xử lý đúng cách
        // Backend sẽ shuffle với seed unique cho mỗi merge job
        shuffle: shuffleOrder,
        mute: muteAudio,
        forceReencode,
        useGpuEncoding: (forceReencode || unifyFormat) ? useGpuEncoding : undefined,
        mergeCount: mergeCount ? parseInt(mergeCount, 10) : undefined,
        repeatCount: mergeCount ? parseInt(mergeCount, 10) : 1, // Dùng mergeCount như repeatCount khi không có target
        targetDurationSec, // null nếu không tick, number nếu tick
        priorityPaths: priorityList.length > 0 ? priorityList : undefined,
        unifyFormat: unifyFormat || undefined,
        targetResolution: unifyFormat ? targetResolution : undefined,
        targetFps: unifyFormat ? targetFps : undefined,
      }

      // Debug log trước khi gửi IPC
      console.log('[MergeTab] payload', {
        fileCount: req.inputFiles.length,
        shuffle: req.shuffle,
        repeatCount: req.mergeCount,
        useLimitDuration,
        targetDurationSec: req.targetDurationSec,
      })

      const result: MergeVideosSimpleResult = await window.api.videoMergeSimple(req)
      
      // Set requestId ngay khi nhận được từ result
      if (result.requestId) {
        setCurrentRequestId(result.requestId)
      }

      if (result.success) {
        // Mark all input clips as used in pool so Autopilot avoids repeating them
        ;window.api.videoPoolMarkUsed?.(orderedInputFiles).catch(() => {})
        setSuccessData(result)
        setStatusText('Hoàn tất')
        // Delay để user thấy 100% trước khi reset progress
        setTimeout(() => {
          setIsProcessing(false)
          setCurrentProgress(null) // Reset progress bar sau khi hoàn thành
          setCurrentRequestId(null) // Clear requestId
        }, 1000)
      } else {
        const msg = result.error || 'Ghép video thất bại'
        if (msg.startsWith('CẢNH BÁO: Dung lượng ổ đĩa không đủ')) {
          setDiskSpaceError(msg)
        } else {
          setErrorMessage(msg)
        }
        setIsProcessing(false)
        setCurrentProgress(null) // Reset progress bar khi có lỗi
        setCurrentRequestId(null) // Clear requestId
      }
    } catch (err: any) {
      const msg = err?.message || 'Lỗi không xác định khi ghép video'
      if (msg.startsWith('CẢNH BÁO: Dung lượng ổ đĩa không đủ')) {
        setDiskSpaceError(msg)
      } else {
        setErrorMessage(msg)
      }
      setIsProcessing(false)
      setCurrentProgress(null) // Reset progress bar khi có exception
      setCurrentRequestId(null) // Clear requestId
    } finally {
      if (window.api?.refreshDiskInfo) {
        try {
          await window.api.refreshDiskInfo()
        } catch (err) {
          console.error('[MergeTab] refreshDiskInfo error:', err)
        }
      }
    }
  }

  const invalidConfig = !outputDir || !videoItems.length

  return (
    <div style={{ padding: '24px', color: '#e0e0e0', backgroundColor: '#1e1e1e', minHeight: '100%' }}>
      <h3 style={{ marginBottom: '24px', fontSize: '20px', fontWeight: 'bold' }}>Ghép video</h3>

      {/* Danh sách video */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          Danh sách video cần ghép
        </label>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <button
            onClick={handleSelectManyVideos}
            disabled={isProcessing}
            style={{
              padding: '8px 16px',
              backgroundColor: '#007acc',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              fontSize: '14px',
            }}
          >
            Chọn nhiều video...
          </button>
          <button
            onClick={handleAddFromFolder}
            disabled={isProcessing}
            style={{
              padding: '8px 16px',
              backgroundColor: '#007acc',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              fontSize: '14px',
            }}
          >
            Thêm từ thư mục...
          </button>
          <button
            onClick={handlePickFromPool}
            disabled={isProcessing}
            style={{
              padding: '8px 16px',
              backgroundColor: '#5c6bc0',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              fontSize: '14px',
            }}
            title="Tự động chọn clip ít được dùng nhất từ thư mục (tránh lặp lại)"
          >
            Chọn từ Pool
          </button>
          <button
            onClick={handleClearList}
            disabled={isProcessing}
            style={{
              padding: '8px 16px',
              backgroundColor: '#dc3545',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              fontSize: '14px',
            }}
          >
            Xóa danh sách
          </button>
        </div>
        <div style={{ fontSize: '12px', color: '#b0b0b0', marginBottom: '8px' }}>
          Đã chọn: {totalVideos} video
        </div>
        <div
          style={{
            maxHeight: '220px',
            overflow: 'auto',
            border: '1px solid #444',
            borderRadius: '6px',
            padding: '8px',
            backgroundColor: '#2d2d2d',
          }}
        >
          {videoItems.length === 0 ? (
            <div style={{ color: '#888', fontSize: '14px' }}>Chưa có video nào.</div>
          ) : (
            <>
              {videoItems.length > 200 && (
                <div style={{ padding: '8px', fontSize: '12px', color: '#ffa726', fontStyle: 'italic', backgroundColor: '#2d2d2d', borderRadius: '4px', marginBottom: '8px' }}>
                  Đang hiển thị thời lượng cho ~200 video đầu, các video sau vẫn được cắt/ghép bình thường.
                </div>
              )}
              {(() => {
                const prioritySet = new Set(priorityVideoPaths)
                return videoItems.slice(0, 50).map((item, idx) => {
                  const isPriority = prioritySet.has(item.path)
                  const isFirstPriority = idx === 0 && isPriority
                  const prevItem = idx > 0 ? videoItems[idx - 1] : null
                  const showPriorityLabel = isFirstPriority || (isPriority && prevItem && !prioritySet.has(prevItem.path))
                  
                  return (
                    <div key={item.path}>
                      {showPriorityLabel && (
                        <div style={{
                          padding: '4px 8px',
                          backgroundColor: '#3a2a1a',
                          borderLeft: '3px solid #ff9800',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#ffa726',
                          marginTop: idx > 0 ? '4px' : '0',
                        }}>
                          Video ưu tiên
                        </div>
                      )}
                      <div
                        style={{
                          padding: '6px 8px',
                          borderBottom: '1px dashed #444',
                          backgroundColor: isPriority ? '#2a1f1a' : 'transparent',
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: '13px', color: isPriority ? '#ffa726' : '#e0e0e0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {isPriority && <span style={{ fontSize: '10px' }}></span>}
                          {item.fileName}
                        </div>
                        {typeof item.durationSec === 'number' && item.durationSec > 0 && (
                          <div style={{ fontSize: '12px', color: isPriority ? '#ffa726' : '#b0b0b0', opacity: 0.7 }}>
                            {formatDurationFromSeconds(item.durationSec)}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              })()}
              {videoItems.length > 50 && (
                <div style={{ padding: '8px', textAlign: 'center', color: '#888', fontSize: '12px' }}>
                  ... và {videoItems.length - 50} video khác (chỉ hiển thị 50 video đầu)
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Tùy chọn ghép */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          Tùy chọn ghép
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={shuffleOrder}
              onChange={(e) => setShuffleOrder(e.target.checked)}
              disabled={isProcessing}
            />
            <span style={{ fontSize: '14px' }}>Xáo trộn thứ tự video</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={usePriorityVideos}
              onChange={(e) => {
                const checked = e.target.checked
                setUsePriorityVideos(checked)
                if (!checked) {
                  setPriorityFolder('')
                  setPriorityVideoPaths([])
                } else {
                  // Reset khi bật lại
                  setPriorityFolder('')
                  setPriorityVideoPaths([])
                }
              }}
              disabled={isProcessing}
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '14px' }}>Video ưu tiên (luôn xuất hiện trước)</span>
              <span style={{ fontSize: '12px', color: '#b0b0b0' }}>
                Chọn thư mục hoặc video sẽ được ưu tiên xuất hiện đầu tiên khi ghép. Nhóm này cũng được xáo trộn riêng.
              </span>
              {usePriorityVideos && (
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      readOnly
                      value={
                        priorityFolder
                          ? `Thư mục: ${priorityFolder}`
                          : priorityVideoPaths.length > 0
                          ? `Đã chọn ${priorityVideoPaths.length} video`
                          : 'Chưa chọn video ưu tiên'
                      }
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        backgroundColor: '#2d2d2d',
                        color: '#e0e0e0',
                        border: '1px solid #444',
                        borderRadius: '4px',
                        fontSize: '12px',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={handleSelectPriorityFolder}
                      disabled={isProcessing}
                      style={{
                        flex: 1,
                        padding: '6px 12px',
                        backgroundColor: '#007acc',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: isProcessing ? 'not-allowed' : 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Chọn thư mục
                    </button>
                    <button
                      onClick={handleSelectPriorityVideos}
                      disabled={isProcessing}
                      style={{
                        flex: 1,
                        padding: '6px 12px',
                        backgroundColor: '#007acc',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: isProcessing ? 'not-allowed' : 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Chọn video
                    </button>
                    {(priorityFolder || priorityVideoPaths.length > 0) && (
                      <button
                        onClick={() => {
                          setPriorityFolder('')
                          setPriorityVideoPaths([])
                        }}
                        disabled={isProcessing}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#dc3545',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: isProcessing ? 'not-allowed' : 'pointer',
                          fontSize: '12px',
                        }}
                      >
                        Xóa
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={muteAudio}
              onChange={(e) => setMuteAudio(e.target.checked)}
              disabled={isProcessing}
            />
            <span style={{ fontSize: '14px' }}>Tắt âm thanh</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={forceReencode}
              onChange={(e) => setForceReencode(e.target.checked)}
              disabled={isProcessing}
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '14px' }}>Chuẩn hóa video khi ghép</span>
              <span style={{ fontSize: '12px', color: '#b0b0b0' }}>Scale tất cả video về cùng resolution/FPS, tránh xước hình, đen màn hình, lỗi dừng khi ghép. Thời gian xử lý sẽ lâu hơn.</span>
            </div>
          </label>
          {/* GPU Encoding */}
          {(forceReencode || unifyFormat) && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={useGpuEncoding}
                  onChange={(e) => setUseGpuEncoding(e.target.checked)}
                  disabled={isProcessing}
                  style={{ marginTop: '4px' }}
                />
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 500 }}>Sử dụng GPU để mã hóa (nhanh hơn)</div>
                  <div style={{ fontSize: '12px', color: '#b0b0b0', lineHeight: 1.4 }}>
                    Sử dụng GPU (NVIDIA/AMD/Apple) để mã hóa video khi ghép có re-encode / chỉnh lại định dạng.
                    Nếu GPU không khả dụng, hệ thống sẽ tự động chuyển sang CPU.
                  </div>
                </div>
              </label>
            </div>
          )}
          {/* Chỉnh về cùng tỉ lệ khung hình + FPS */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={unifyFormat}
              onChange={(e) => setUnifyFormat(e.target.checked)}
              disabled={isProcessing}
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '14px' }}>Chỉnh lại tất cả video về cùng tỉ lệ khung hình / FPS</span>
              <span style={{ fontSize: '12px', color: '#b0b0b0' }}>Scale + letterbox/pillarbox về cùng resolution và FPS trước khi ghép (tự động bật re-encode).</span>
            </div>
          </label>
          {/* Resolution + FPS dropdowns — hiển thị khi unifyFormat bật */}
          {unifyFormat && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginLeft: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', color: '#ccc', width: '110px' }}>Tỉ lệ khung hình:</span>
                <select
                  value={targetResolution}
                  onChange={(e) => setTargetResolution(e.target.value)}
                  disabled={isProcessing}
                  style={{
                    padding: '5px 10px',
                    backgroundColor: '#2d2d2d',
                    color: '#e0e0e0',
                    border: '1px solid #555',
                    borderRadius: '4px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    minWidth: '260px',
                  }}
                >
                  <option value="1920x1080">16:9 — 1920×1080 (Full HD Ngang)</option>
                  <option value="1440x1080">4:3 — 1440×1080 (Cổ điển)</option>
                  <option value="2560x1080">2.35:1 — 2560×1080 (Cinemascope)</option>
                  <option value="2160x1080">2:1 — 2160×1080 (Univisium)</option>
                  <option value="1998x1080">1.85:1 — 1998×1080 (Widescreen)</option>
                  <option value="1080x1920">9:16 — 1080×1920 (Dọc / Reels / Shorts)</option>
                  <option value="1080x1440">3:4 — 1080×1440 (Dọc cổ điển)</option>
                  <option value="1080x1868">5.8-inch — 1080×1868 (Mobile tall)</option>
                  <option value="1080x1080">1:1 — 1080×1080 (Vuông / Instagram)</option>
                  <option value="3840x2160">16:9 — 3840×2160 (4K UHD)</option>
                  <option value="1280x720">16:9 — 1280×720 (HD 720p)</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', color: '#ccc', width: '110px' }}>FPS:</span>
                <select
                  value={targetFps}
                  onChange={(e) => setTargetFps(e.target.value)}
                  disabled={isProcessing}
                  style={{
                    padding: '5px 10px',
                    backgroundColor: '#2d2d2d',
                    color: '#e0e0e0',
                    border: '1px solid #555',
                    borderRadius: '4px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    minWidth: '260px',
                  }}
                >
                  <option value="24">24.00 fps (Cinema)</option>
                  <option value="25">25.00 fps (PAL / Europe)</option>
                  <option value="30000/1001">29.97 fps (NTSC)</option>
                  <option value="30">30.00 fps (YouTube phổ biến)</option>
                  <option value="50">50.00 fps (PAL HFR)</option>
                  <option value="60000/1001">59.94 fps (NTSC HFR)</option>
                  <option value="60">60.00 fps (Gaming / HFR)</option>
                </select>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '14px', width: '140px' }}>Số lần ghép:</label>
            <input
              type="number"
              min="1"
              step="1"
              value={mergeCount}
              onChange={(e) => {
                const v = e.target.value
                if (v === '' || /^\d+$/.test(v)) {
                  const num = parseInt(v, 10)
                  if (v === '' || (num >= 1)) {
                    setMergeCount(v)
                  }
                }
              }}
              disabled={isProcessing}
              style={{
                width: '120px',
                padding: '6px 10px',
                backgroundColor: '#2d2d2d',
                color: '#e0e0e0',
                border: '1px solid #444',
                borderRadius: '4px',
              }}
            />
            <span style={{ fontSize: '12px', color: '#b0b0b0' }}>(Ví dụ: 5 → ghép 5 lần, xuất 5 video)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={limitDurationEnabled}
                onChange={(e) => setLimitDurationEnabled(e.target.checked)}
                disabled={isProcessing}
              />
              <span style={{ fontSize: '14px', width: '140px' }}>Giới hạn thời lượng</span>
            </label>
            <input
              type="number"
              min="1"
              step="1"
              value={limitValue}
              onChange={(e) => {
                const v = e.target.value
                if (v === '' || /^\d*\.?\d*$/.test(v)) setLimitValue(v)
              }}
              disabled={!limitDurationEnabled || isProcessing}
              style={{
                width: '120px',
                padding: '6px 10px',
                backgroundColor: '#2d2d2d',
                color: '#e0e0e0',
                border: '1px solid #444',
                borderRadius: '4px',
              }}
            />
            <select
              value={limitUnit}
              onChange={(e) => setLimitUnit(e.target.value as 'seconds' | 'minutes')}
              disabled={!limitDurationEnabled || isProcessing}
              style={{
                padding: '6px 10px',
                backgroundColor: '#2d2d2d',
                color: '#e0e0e0',
                border: '1px solid #444',
                borderRadius: '4px',
              }}
            >
              <option value="seconds">Giây</option>
              <option value="minutes">Phút</option>
            </select>
          </div>
          {/* Performance warning */}
          {performanceWarning && (
            <div
              style={{
                marginTop: '8px',
                padding: '8px 12px',
                backgroundColor: '#fff3cd',
                border: '1px solid #ffc107',
                borderRadius: '4px',
                fontSize: '12px',
                color: '#856404',
              }}
            >
              {performanceWarning}
            </div>
          )}
        </div>
      </div>

      {/* Thư mục xuất */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          Thư mục xuất video
        </label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
          <input
            type="text"
            readOnly
            value={outputDir || 'Chưa chọn thư mục'}
            style={{
              flex: 1,
              padding: '8px 12px',
              backgroundColor: '#2d2d2d',
              color: '#e0e0e0',
              border: '1px solid #444',
              borderRadius: '4px',
            }}
          />
          <button
            onClick={handleSelectOutputDir}
            disabled={isProcessing}
            style={{
              padding: '8px 16px',
              backgroundColor: '#007acc',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              fontSize: '14px',
            }}
          >
            Chọn thư mục
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ fontSize: '14px', width: '120px' }}>Tên file output:</label>
          <input
            type="text"
            value={outputFileName}
            onChange={(e) => setOutputFileName(e.target.value)}
            disabled={isProcessing}
            style={{
              flex: 1,
              padding: '8px 12px',
              backgroundColor: '#2d2d2d',
              color: '#e0e0e0',
              border: '1px solid #444',
              borderRadius: '4px',
            }}
          />
        </div>
      </div>

      {/* Progress bar */}
      {isProcessing && (
        <div
          style={{
            marginBottom: '24px',
            padding: '16px',
            backgroundColor: '#2d2d2d',
            borderRadius: '4px',
          }}
        >
          {currentProgress ? (
            <>
              {/* Multi-job status */}
              {currentProgress.totalJobs && currentProgress.totalJobs > 1 && (
                <div style={{ marginBottom: '8px', fontSize: '14px', fontWeight: '500', color: '#e0e0e0' }}>
                  Đang ghép video {currentProgress.currentJob || 1}/{currentProgress.totalJobs}
                  {currentProgress.currentFile && (
                    <span style={{ fontSize: '12px', color: '#b0b0b0', marginLeft: '8px' }}>
                      : {currentProgress.currentFile}
                    </span>
                  )}
                </div>
              )}
              <div style={{ marginBottom: '8px', fontSize: '13px', color: '#b0b0b0' }}>
                {currentProgress.totalJobs && currentProgress.totalJobs > 1 
                  ? `${currentProgress.percent.toFixed(1)}%`
                  : (statusText || 'Đang ghép video...') + ` – ${currentProgress.percent.toFixed(1)}%`
                }
                {currentProgress.timeSec > 0 && currentProgress.totalDurationSec > 0 && (
                  <> • {formatSecondsHMS(currentProgress.timeSec)} / {formatSecondsHMS(currentProgress.totalDurationSec)}</>
                )}
                {currentProgress.speedX !== null && currentProgress.speedX !== undefined && (
                  <> • ~{currentProgress.speedX.toFixed(1)}×</>
                )}
                {currentProgress.etaSec !== null && currentProgress.etaSec !== undefined && currentProgress.etaSec > 0 && (
                  <> • ETA {formatSecondsHMS(currentProgress.etaSec)}</>
                )}
              </div>
              <div
                style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: '#1a1a1a',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, Math.max(0, currentProgress.percent))}%`,
                    height: '100%',
                    backgroundColor: statusText.includes('kiểm tra') ? '#f59e0b' : '#007acc',
                    transition: 'width 0.3s',
                    // Pulsing animation khi đang ở phase verify (không có progress)
                    animation: statusText.includes('kiểm tra') ? 'pulse-bar 1.2s ease-in-out infinite' : 'none',
                  }}
                />
              </div>
              {statusText.includes('kiểm tra') && (
                <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '2px' }}>
                  ⏳ Đang kiểm tra tính toàn vẹn của file xuất ra...
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: '13px', color: '#b0b0b0' }}>
              Đang khởi tạo ghép video...
            </div>
          )}
        </div>
      )}

      {/* Nút ghép */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
        <button
          onClick={handleMerge}
          disabled={isProcessing || invalidConfig}
          style={{
            flex: 1,
            padding: '12px 24px',
            backgroundColor: isProcessing || invalidConfig ? '#444' : '#007acc',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: isProcessing || invalidConfig ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
          }}
        >
          {isProcessing ? 'Đang ghép...' : `GHÉP VIDEO`}
        </button>
        {isProcessing && currentRequestId && (
          <button
            onClick={handleCancel}
            style={{
              padding: '12px 24px',
              backgroundColor: '#d32f2f',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            Dừng ghép video
          </button>
        )}
        {successData && (
          <button
            onClick={() => window.api.openPath(outputDir)}
            style={{
              padding: '12px 24px',
              backgroundColor: '#2d2d2d',
              color: '#fff',
              border: '1px solid #444',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Mở thư mục
          </button>
        )}
      </div>


      {/* Success message */}
      {successData && !isProcessing && (
        <div
          style={{
            padding: '16px',
            backgroundColor: '#1a3a1a',
            border: '1px solid #2a5a2a',
            borderRadius: '4px',
            marginBottom: '16px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#4caf50', marginBottom: '8px' }}>
            {successData.outputPaths && successData.outputPaths.length > 1
              ? `Đã ghép thành công ${successData.outputPaths.length} video:`
              : `Đã ghép thành công, file: ${getFileName(successData.outputPath || successData.outputPaths?.[0] || '')}`}
          </div>
          {successData.outputPaths && successData.outputPaths.length > 1 && (
            <div style={{ fontSize: '12px', color: '#b0b0b0', marginBottom: '8px', maxHeight: '150px', overflow: 'auto' }}>
              {successData.outputPaths.map((path, idx) => (
                <div key={idx} style={{ marginBottom: '4px' }}>
                  {idx + 1}. {getFileName(path)}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: '12px', color: '#b0b0b0' }}>
            {successData.avgSpeed && `Tốc độ trung bình: ~${successData.avgSpeed.toFixed(1)}×`}
          </div>
        </div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div
          style={{
            padding: '16px',
            backgroundColor: '#3a1a1a',
            border: '1px solid #5a2a2a',
            borderRadius: '4px',
            marginBottom: '16px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#f44336', marginBottom: '8px' }}>
            Ghép video thất bại.
          </div>
          <div style={{ fontSize: '12px', color: '#b0b0b0' }}>
            {errorMessage.length > 200 ? errorMessage.slice(0, 200) + '...' : errorMessage}
          </div>
        </div>
      )}

      <DiskSpaceErrorModal error={diskSpaceError} onClose={() => setDiskSpaceError(null)} />
    </div>
  )
}

export default MergeTab


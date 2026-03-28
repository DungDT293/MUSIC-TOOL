import { useEffect, useMemo, useState } from 'react'
import { runLimited } from '../../utils/runLimited'

// Helper to extract filename from path (handles Unicode correctly)
function getFileName(filePath: string): string {
  if (!filePath) return ''
  // Handle both / and \ separators, works with Unicode paths
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

interface VideoFileInfo {
  filePath: string
  durationSec: number | null
  width: number | null
  height: number | null
}

type NormalizeQuality = 'preserve' | '1080p' | '720p' | '1440p'

interface SplitManySimpleRequest {
  inputFiles: string[]
  outputRootDir: string
  segmentLengthSec: number
  format?: 'mp4' | 'mkv'
  normalizeOutput?: boolean
  normalizeQuality?: NormalizeQuality
  useGpuEncoding?: boolean // true = prefer GPU, false = force CPU, undefined = auto
}

interface SplitManySimpleResult {
  requestId: string
  success: boolean
  totalFiles: number
  successCount: number
  failCount: number
  elapsedMs: number
  avgSpeed: number
  results: Array<{
    inputPath: string
    outputDir: string
    segmentCount: number
    expectedSegments?: number // Số đoạn mong đợi
    success: boolean
    error?: string
    warning?: string // Cảnh báo nếu số lượng segment không khớp
  }>
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

function formatDuration(ms: number): string {
  return formatSecondsHMS(ms / 1000)
}

// formatFileSize và sanitizeFileName không dùng trong component này

type VideoListItem = {
  path: string
  fileName: string
  sizeBytes?: number
  info?: VideoFileInfo
  durationSec?: number // Thời lượng video (chỉ load field này, không load full info)
}

function MultiCutTab() {
  const [videoListItems, setVideoListItems] = useState<VideoListItem[]>([])
  const [outputDir, setOutputDir] = useState<string>('')
  const [segmentLengthValue, setSegmentLengthValue] = useState<string>('30')
  const [segmentLengthUnit, setSegmentLengthUnit] = useState<'seconds' | 'minutes'>('seconds')
  const [normalizeOutput, setNormalizeOutput] = useState<boolean>(false)
  const [normalizeQuality, setNormalizeQuality] = useState<NormalizeQuality>('preserve')
  const [useGpuEncoding, setUseGpuEncoding] = useState<boolean>(false) // false = CPU, true = GPU

  const [isProcessing, setIsProcessing] = useState(false)
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null)
  const [currentProgress, setCurrentProgress] = useState<{
    currentFileIndex: number
    totalFiles: number
    currentFilePath: string
    overallPercent: number
    currentFilePercent: number
    currentSegment: number
    totalSegments: number
    speedX: number | null
    etaSec: number | null
    message?: string
  } | null>(null)

  const [successData, setSuccessData] = useState<SplitManySimpleResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const segmentLengthSec = useMemo(() => {
    const raw = Number(segmentLengthValue || 0)
    if (!Number.isFinite(raw) || raw <= 0) return 0
    return raw * (segmentLengthUnit === 'minutes' ? 60 : 1)
  }, [segmentLengthValue, segmentLengthUnit])

  // Restore state từ running job khi component mount lại (sau khi chuyển tab)
  useEffect(() => {
    let mounted = true

    const restoreRunningJob = async () => {
      try {
        const jobs = await (window as any).api.jobQueue.list()
        const runningJob = jobs.find(
          (job: any) =>
            job.type === 'video:split-many' &&
            (job.status === 'running' || job.status === 'pending')
        )

        if (runningJob && mounted) {
          console.log('[MultiCut] Found running job, restoring state:', runningJob.id)
          setCurrentRequestId(runningJob.id)
          setIsProcessing(true)
          
          if (runningJob.progress) {
            const progressPercent = runningJob.progress.percent ?? 0
            setCurrentProgress({
              currentFileIndex: 0,
              totalFiles: videoListItems.length,
              currentFilePath: '',
              overallPercent: progressPercent,
              currentFilePercent: 0,
              currentSegment: 0,
              totalSegments: 0,
              speedX: null,
              etaSec: null,
              message: runningJob.progress.message || 'Đang tiếp tục cắt video...',
            })
          }
        }
      } catch (err) {
        console.error('[MultiCut] Failed to restore running job:', err)
      }
    }

    restoreRunningJob()

    return () => {
      mounted = false
    }
  }, [videoListItems.length]) // Chạy lại khi số lượng video thay đổi

  // Subscribe to progress events
  useEffect(() => {
    const unsubscribe = (window as any).api.onVideoProgress((payload: any) => {
      console.log('[MultiCut] Received progress event:', payload, 'isProcessing:', isProcessing, 'currentRequestId:', currentRequestId)
      // Guard against undefined to prevent "Cannot read properties of undefined (reading 'length')"
      if (payload?.mode !== 'multi-cut') return
      if (!isProcessing) return

      if (!currentRequestId && payload.requestId) {
        console.log('[MultiCut] Setting requestId from first progress event:', payload.requestId)
        setCurrentRequestId(payload.requestId)
      }
      if (!currentRequestId || payload.requestId === currentRequestId) {
        // Ensure all fields have safe defaults
        const totalFiles =
          typeof payload.totalFiles === 'number'
            ? payload.totalFiles
            : videoListItems.length

          setCurrentProgress({
            currentFileIndex: payload.currentFileIndex ?? 0,
            totalFiles,
            currentFilePath: payload.currentFilePath ?? '',
            overallPercent: payload.overallPercent ?? 0,
            currentFilePercent: payload.currentFilePercent ?? 0,
            currentSegment: payload.currentFileSegment ?? 0,
            totalSegments: payload.currentFileTotalSegments ?? 0,
            speedX: payload.currentFileSpeedX ?? null,
            etaSec: payload.currentFileEtaSec ?? null,
            message: payload.message,
          })
      }
      
      // Check for cancelled state (error message contains "hủy")
      if (payload.error && payload.error.includes('hủy')) {
        setIsProcessing(false)
        setCurrentRequestId(null)
        setCurrentProgress(null)
        setErrorMessage('Đã dừng bởi người dùng')
      }
    })

    return unsubscribe
  }, [currentRequestId, isProcessing, videoListItems])

  const handleSelectManyVideos = async () => {
    setErrorMessage(null)
    setSuccessData(null)
    try {
      const paths: string[] | null = await (window as any).api.selectManyVideos?.()
      if (!paths || !paths.length) return

      const existingPaths = new Set(videoListItems.map((v) => v.path))
      const newItems: VideoListItem[] = paths
        .filter((p) => !existingPaths.has(p))
        .map((p) => ({
          path: p,
          fileName: getFileName(p),
        }))

      if (newItems.length) {
        setVideoListItems((prev) => [...prev, ...newItems])
        
        // Load duration only (lightweight, async, không block UI)
        const MAX_INFO_ITEMS = 200
        const itemsForInfo = newItems.slice(0, MAX_INFO_ITEMS)
        
        itemsForInfo.forEach(async (item) => {
          try {
            const info = await (window as any).api.videoGetFileInfo(item.path)
            const durationSec = info?.durationSec
            
            if (typeof durationSec === 'number' && durationSec > 0) {
              setVideoListItems((prev) => {
                const clone = [...prev]
                const targetIndex = clone.findIndex((v) => v.path === item.path)
                if (targetIndex < 0) return prev // Item không còn trong list
                clone[targetIndex] = { ...clone[targetIndex], durationSec }
                return clone
              })
            }
          } catch (e) {
            console.warn('[MultiCut] Failed to load duration for', item.path, e)
          }
        })
      }
    } catch (err) {
      console.error('[MultiCut] selectManyVideos error', err)
      setErrorMessage('Không chọn được danh sách video.')
    }
  }

  const handleAddFromFolder = async () => {
    setErrorMessage(null)
    setSuccessData(null)
    try {
      const folder = await (window as any).api.selectFolder()
      if (!folder) return

      const files = (await (window as any).api.listVideosInFolderSimple?.(folder)) || []
      const existingPaths = new Set(videoListItems.map((v) => v.path))
      const newItems: VideoListItem[] = files
        .filter((f: any) => !existingPaths.has(f.path))
        .map((f: any) => ({
          path: f.path,
          fileName: f.fileName,
          sizeBytes: f.sizeBytes,
        }))

      if (newItems.length) {
        setVideoListItems((prev) => [...prev, ...newItems])
        
        // Load duration only (lightweight, async, không block UI) with concurrency limit
        const MAX_INFO_ITEMS = 200
        const itemsForInfo = newItems.slice(0, MAX_INFO_ITEMS)
        
        runLimited(itemsForInfo, 8, async (item) => {
          try {
            const info = await (window as any).api.videoGetFileInfo(item.path)
            const durationSec = info?.durationSec
            
            if (typeof durationSec === 'number' && durationSec > 0) {
              setVideoListItems((prev) => {
                const clone = [...prev]
                const targetIndex = clone.findIndex((v) => v.path === item.path)
                if (targetIndex < 0) return prev // Item không còn trong list
                clone[targetIndex] = { ...clone[targetIndex], durationSec }
                return clone
              })
            }
          } catch (e) {
            console.warn('[MultiCut] Failed to load duration for', item.path, e)
          }
        })
      }
    } catch (err) {
      console.error('[MultiCut] addFromFolder error', err)
      setErrorMessage(`Lỗi quét folder: ${err}`)
    }
  }

  const handleClearList = () => {
    setVideoListItems([])
    setErrorMessage(null)
    setSuccessData(null)
  }

  const handleSelectOutputDir = async () => {
    const dir = await (window as any).api.selectFolder()
    if (dir) setOutputDir(dir)
  }

  const handleStartBatch = async () => {
    setErrorMessage(null)
    setSuccessData(null)
    setCurrentProgress(null)

    if (videoListItems.length === 0) {
      setErrorMessage('Hãy chọn ít nhất 1 video.')
      return
    }
    if (!outputDir) {
      setErrorMessage('Hãy chọn thư mục xuất video.')
      return
    }
    if (segmentLengthSec <= 0) {
      setErrorMessage('Thời lượng mỗi đoạn phải > 0.')
      return
    }

    setIsProcessing(true)
    setCurrentProgress(null)
    setCurrentRequestId(null) // Reset requestId trước

    try {
      const req: SplitManySimpleRequest = {
        inputFiles: videoListItems.map((v) => v.path),
        outputRootDir: outputDir,
        segmentLengthSec,
        format: 'mp4',
        normalizeOutput,
        normalizeQuality: normalizeOutput ? normalizeQuality : undefined,
        useGpuEncoding: normalizeOutput ? useGpuEncoding : undefined, // Only use GPU encoding if normalizeOutput is enabled
      }

      console.log('[MultiCut] Starting batch cut with', req.inputFiles.length, 'videos')
      const result: SplitManySimpleResult = await (window as any).api.videoSplitManySimple(req)
      console.log('[MultiCut] Got result with requestId:', result.requestId)
      setCurrentRequestId(result.requestId)

      // Guard against undefined arrays to prevent "Cannot read properties of undefined (reading 'length')"
      const results = result.results ?? []
      if (result.successCount > 0) {
        setSuccessData(result)
      } else {
        const firstError = results[0]?.error ?? null
        setErrorMessage(`Không có video nào cắt thành công. ${result.failCount > 0 ? `Lỗi: ${firstError || 'Unknown'}` : ''}`)
      }
    } catch (err: any) {
      const errorMsg = err?.message || 'Lỗi không xác định khi cắt video'
      // Check if cancelled
      if (errorMsg.includes('hủy')) {
        setErrorMessage('Đã dừng bởi người dùng')
      } else {
        setErrorMessage(errorMsg)
      }
    } finally {
      setIsProcessing(false)
      if ((window as any).api?.refreshDiskInfo) {
        try {
          await (window as any).api.refreshDiskInfo()
        } catch (err) {
          console.error('[MultiCut] refreshDiskInfo error:', err)
        }
      }
    }
  }

  const handleCancel = async () => {
    if (!currentRequestId) return
    try {
      await (window as any).api.videoCancelJob(currentRequestId)
      setIsProcessing(false)
      setCurrentRequestId(null)
      setCurrentProgress(null)
      setErrorMessage('Đã dừng bởi người dùng')
    } catch (e) {
      console.error('[MultiCut] Cancel failed', e)
    }
  }

  const invalidConfig = !outputDir || segmentLengthSec <= 0 || videoListItems.length === 0

  // Kiểm tra video có duration < 30s
  const videosTooShort = videoListItems.filter(
    (item) => item.info && item.info.durationSec !== null && item.info.durationSec < 30
  )
  const hasShortVideos = videosTooShort.length > 0

  return (
    <div style={{ padding: '24px', color: '#e0e0e0', backgroundColor: '#1e1e1e', minHeight: '100%' }}>
      <h3 style={{ marginBottom: '24px', fontSize: '20px', fontWeight: 'bold' }}>Cắt nhiều video</h3>
      
      {/* Cảnh báo về video ngắn */}
      {hasShortVideos && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#3a2a1a',
            border: '1px solid #5a4a3a',
            borderRadius: '4px',
            marginBottom: '20px',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#ff9800', marginBottom: '4px' }}>
            ⚠️ Lưu ý: Cắt nhiều chỉ khả dụng với video dài hơn 30 giây
          </div>
          <div style={{ fontSize: '12px', color: '#b0b0b0' }}>
            Có {videosTooShort.length} video ngắn hơn 30s trong danh sách. Video quá ngắn có thể không thể cắt thành nhiều đoạn nhỏ hơn do giới hạn keyframes.
            {videosTooShort.length <= 5 && (
              <div style={{ marginTop: '4px' }}>
                Video ngắn: {videosTooShort.map((v) => v.fileName).join(', ')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Danh sách video */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          Danh sách video cần cắt
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
          Đã chọn: {videoListItems.length} file
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
          {videoListItems.length === 0 ? (
            <div style={{ color: '#888', fontSize: '14px' }}>Chưa có video nào.</div>
          ) : (
            <>
              {videoListItems.length > 200 && (
                <div style={{ padding: '8px', fontSize: '12px', color: '#ffa726', fontStyle: 'italic', backgroundColor: '#2d2d2d', borderRadius: '4px', marginBottom: '8px' }}>
                  ⚠️ Đang hiển thị thời lượng cho ~200 video đầu, các video sau vẫn được cắt/ghép bình thường.
                </div>
              )}
              {videoListItems.map((item, idx) => (
                <div
                  key={item.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '6px 4px',
                    borderBottom: '1px solid #444',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: '#e0e0e0' }}>
                      {item.fileName}
                    </div>
                    {typeof item.durationSec === 'number' && item.durationSec > 0 && (
                      <div style={{ fontSize: '12px', color: '#b0b0b0', opacity: 0.7 }}>
                        {formatDurationFromSeconds(item.durationSec)}
                      </div>
                    )}
                  </div>
                  <div style={{ color: '#999', fontSize: '11px', minWidth: '32px', textAlign: 'right' }}>
                    #{idx + 1}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Tùy chọn cắt */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          Thời lượng mỗi đoạn
        </label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={segmentLengthValue}
            onChange={(e) => {
              const v = e.target.value
              if (v === '' || /^\d*\.?\d*$/.test(v)) setSegmentLengthValue(v)
            }}
            disabled={isProcessing}
            style={{
              width: '120px',
              padding: '8px 12px',
              backgroundColor: '#2d2d2d',
              color: '#e0e0e0',
              border: '1px solid #444',
              borderRadius: '4px',
            }}
          />
          <select
            value={segmentLengthUnit}
            onChange={(e) => setSegmentLengthUnit(e.target.value as 'seconds' | 'minutes')}
            disabled={isProcessing}
            style={{
              padding: '8px 12px',
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
      </div>

      {/* Thư mục xuất */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          Thư mục xuất video
        </label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
      </div>

      {/* Chuẩn hóa khi cắt */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={normalizeOutput}
            onChange={(e) => setNormalizeOutput(e.target.checked)}
            disabled={isProcessing}
            style={{ marginTop: '4px' }}
          />
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Chuẩn hóa toàn bộ đoạn</div>
            <div style={{ fontSize: '12px', color: '#b0b0b0', lineHeight: 1.4 }}>
              Fps 30, yuv420p. Chọn chất lượng bên dưới: giữ nguyên resolution nguồn (2K ra 2K) hoặc đồng nhất 1080p/720p/2K để ghép không chuẩn hóa ổn định.
              Thời gian xử lý sẽ lâu hơn.
            </div>
          </div>
        </label>
      </div>

      {/* Chất lượng chuẩn hóa (chỉ khi bật chuẩn hóa) */}
      {normalizeOutput && (
        <div style={{ marginBottom: '24px', marginLeft: '28px' }}>
          <label style={{ fontSize: '14px', fontWeight: 500, display: 'block', marginBottom: '6px' }}>Chất lượng chuẩn hóa</label>
          <select
            value={normalizeQuality}
            onChange={(e) => setNormalizeQuality(e.target.value as NormalizeQuality)}
            disabled={isProcessing}
            style={{ padding: '6px 10px', borderRadius: '6px', background: '#2d2d2d', color: '#fff', border: '1px solid #555', minWidth: '200px' }}
          >
            <option value="preserve">Giữ nguyên (2K → 2K, 1080p → 1080p)</option>
            <option value="1440p">2K (2560×1440)</option>
            <option value="1080p">1080p (1920×1080)</option>
            <option value="720p">720p (1280×720)</option>
          </select>
          <div style={{ fontSize: '12px', color: '#b0b0b0', marginTop: '4px' }}>
            {normalizeQuality === 'preserve'
              ? 'Giữ resolution nguồn. Ghép không chuẩn hóa có thể dừng hình nếu trộn nhiều resolution.'
              : 'Đồng nhất mọi đoạn → ghép không chuẩn hóa ổn định.'}
          </div>
        </div>
      )}

      {/* GPU Encoding (chỉ hiển thị khi normalizeOutput = true) */}
      {normalizeOutput && (
        <div style={{ marginBottom: '24px' }}>
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
                Sử dụng GPU (NVIDIA/AMD/Apple) để mã hóa video, nhanh hơn nhiều so với CPU. 
                Nếu GPU không khả dụng, hệ thống sẽ tự động chuyển sang CPU.
              </div>
            </div>
          </label>
        </div>
      )}

      {/* Nút cắt */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
        <button
          onClick={handleStartBatch}
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
          {isProcessing
            ? `⏳ Đang cắt ${currentProgress ? Math.round(currentProgress.overallPercent ?? 0) : 0}%...`
            : `🚀 CẮT ${videoListItems.length} VIDEO`}
        </button>
        {isProcessing && currentRequestId && (
          <button
            onClick={handleCancel}
            style={{
              padding: '10px 20px',
              backgroundColor: '#d32f2f',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            ⏹️ Dừng cắt video
          </button>
        )}
        {successData && (
          <button
            onClick={() => (window as any).api.openPath(outputDir)}
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
            Mở thư mục xuất
          </button>
        )}
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
              <div style={{ marginBottom: '8px', fontSize: '13px', color: '#b0b0b0' }}>
                Đang cắt video {currentProgress.currentFileIndex}/{currentProgress.totalFiles} – {(() => {
                  const name = currentProgress.currentFilePath ? getFileName(currentProgress.currentFilePath) : ''
                  return name || ''
                })()} – {((currentProgress.overallPercent ?? 0)).toFixed(1)}%
                {currentProgress.speedX !== null && currentProgress.speedX !== undefined && currentProgress.speedX > 0 && ` • Tốc độ: ~${currentProgress.speedX.toFixed(1)}×`}
                {currentProgress.etaSec !== null && currentProgress.etaSec !== undefined && currentProgress.etaSec > 0 && ` • Còn lại: ${formatSecondsHMS(currentProgress.etaSec)}`}
              </div>
              {currentProgress.message && (
                <div style={{ marginBottom: '8px', fontSize: '12px', color: '#ffa726', fontStyle: 'italic' }}>
                  ⚠️ {currentProgress.message}
                </div>
              )}
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
                    width: `${Math.min(100, Math.max(0, currentProgress.overallPercent ?? 0))}%`,
                    height: '100%',
                    backgroundColor: '#007acc',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </>
          ) : (
            <div style={{ fontSize: '13px', color: '#b0b0b0' }}>
              ⏳ Đang khởi tạo cắt video...
            </div>
          )}
        </div>
      )}

      {/* Success message */}
      {successData && !isProcessing && (
        <>
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
            Đã cắt {successData?.successCount ?? 0}/{successData?.totalFiles ?? 0} video thành công trong {formatDuration(successData?.elapsedMs ?? 0)}
            {successData?.avgSpeed && successData.avgSpeed > 0 && ` với tốc độ trung bình ~${successData.avgSpeed.toFixed(1)}×`}.
          </div>
          <div style={{ fontSize: '12px', color: '#b0b0b0' }}>
            Output trong thư mục: {outputDir}
          </div>
        </div>
          
          {/* Warnings for segment count mismatches (only for successful cuts) */}
          {successData?.results && successData.results.some((r) => r.success && r.warning) && (
            <div
              style={{
                padding: '16px',
                backgroundColor: '#3a2a1a',
                border: '1px solid #5a4a3a',
                borderRadius: '4px',
                marginBottom: '16px',
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#ff9800', marginBottom: '8px' }}>
                ⚠️ Cảnh báo về số lượng đoạn
              </div>
              <div style={{ fontSize: '12px', color: '#b0b0b0', lineHeight: 1.6 }}>
                {successData.results
                  .filter((r) => r.success && r.warning)
                  .map((r, idx) => (
                    <div key={idx} style={{ marginBottom: '8px' }}>
                      <div style={{ fontWeight: 500, color: '#ffa726', marginBottom: '2px' }}>
                        {getFileName(r.inputPath)}
                      </div>
                      <div style={{ marginLeft: '8px' }}>
                        {r.warning}
                        {r.expectedSegments !== undefined && (
                          <span style={{ color: '#999' }}>
                            {' '}(Mong đợi: {r.expectedSegments}, Thực tế: {r.segmentCount})
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
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
            Cắt video thất bại.
          </div>
          <div style={{ fontSize: '12px', color: '#b0b0b0' }}>
            {errorMessage && errorMessage.length > 0
              ? errorMessage.length > 200
                ? errorMessage.slice(0, 200) + '...'
                : errorMessage
              : 'Lỗi không xác định'}
          </div>
        </div>
      )}
    </div>
  )
}

export default MultiCutTab






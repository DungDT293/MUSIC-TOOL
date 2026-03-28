import { useEffect, useState } from 'react'
import { DiskSpaceErrorModal } from '../../components/DiskSpaceErrorModal'
import { runLimited } from '../../utils/runLimited'

// Helper to extract filename from path (handles Unicode correctly)
function getFileName(filePath: string): string {
  if (!filePath) return ''
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

interface NormalizeVideoRequest {
  inputFiles: string[]
  outputDir: string
  useGpu: boolean
}

interface NormalizeVideoResult {
  requestId: string
  outputPaths: string[]
  success: boolean
  error?: string
  processed: number
  failed: number
}

type VideoItem = {
  path: string
  fileName: string
  sizeBytes?: number
  durationSec?: number
}

function NormalizeVideoTab() {
  const [videoItems, setVideoItems] = useState<VideoItem[]>([])
  const [outputDir, setOutputDir] = useState<string>('')
  const [useGpu, setUseGpu] = useState<boolean>(true) // Default: sử dụng GPU

  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null)
  const [currentProgress, setCurrentProgress] = useState<{
    currentFile: string
    currentIndex: number
    totalFiles: number
    percent: number
  } | null>(null)
  const [statusText, setStatusText] = useState<string>('')

  const [successData, setSuccessData] = useState<NormalizeVideoResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [diskSpaceError, setDiskSpaceError] = useState<string | null>(null)

  const totalVideos = videoItems.length

  // Restore state từ running job khi component mount lại
  useEffect(() => {
    let mounted = true

    const restoreRunningJob = async () => {
      try {
        const api = (window as any).api
        if (!api || typeof api.videoGetActiveNormalizeJobId !== 'function') {
          if (mounted) {
            setIsProcessing(false)
            setCurrentRequestId(null)
          }
          return
        }

        const activeJobId = await api.videoGetActiveNormalizeJobId()
        if (mounted && activeJobId) {
          console.log('[NormalizeVideoTab] Found running normalize job, restoring state:', activeJobId)
          setCurrentRequestId(activeJobId)
          setIsProcessing(true)
          setStatusText('Đang tiếp tục chuẩn hóa video...')
        } else if (mounted) {
          setIsProcessing(false)
          setCurrentRequestId(null)
        }
      } catch (err) {
        console.error('[NormalizeVideoTab] restoreRunningJob error', err)
        if (mounted) {
          setIsProcessing(false)
          setCurrentRequestId(null)
        }
      }
    }

    restoreRunningJob()

    return () => {
      mounted = false
    }
  }, [])

  // Subscribe to progress events
  useEffect(() => {
    if (!currentRequestId) return

    const unsubscribe = (window as any).api.onVideoProgress?.((payload: any) => {
      if (payload.requestId === currentRequestId) {
        if (payload.currentFile && payload.currentIndex !== undefined && payload.totalFiles) {
          setCurrentProgress({
            currentFile: payload.currentFile,
            currentIndex: payload.currentIndex,
            totalFiles: payload.totalFiles,
            percent: payload.percent || 0,
          })
          if (payload.message) {
            setStatusText(payload.message)
          }
        }

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
      const paths: string[] | null = await (window as any).api.selectManyVideos?.()
      if (!paths || !paths.length) return

      const existingPaths = new Set(videoItems.map((v) => v.path))
      const newItems: VideoItem[] = paths
        .filter((p) => !existingPaths.has(p))
        .map((p) => ({
          path: p,
          fileName: getFileName(p),
        }))

      if (newItems.length) {
        setVideoItems((prev) => [...prev, ...newItems])

        const MAX_INFO_ITEMS = 200
        const itemsForInfo = newItems.slice(0, MAX_INFO_ITEMS)

        runLimited(itemsForInfo, 8, async (item) => {
          try {
            const info = await (window as any).api.videoGetFileInfo(item.path)
            const durationSec = info?.durationSec

            if (typeof durationSec === 'number' && durationSec > 0) {
              setVideoItems((prev) => {
                const clone = [...prev]
                const targetIndex = clone.findIndex((v) => v.path === item.path)
                if (targetIndex < 0) return prev
                clone[targetIndex] = { ...clone[targetIndex], durationSec }
                return clone
              })
            }
          } catch (e) {
            console.warn('[NormalizeVideoTab] Failed to load duration for', item.path, e)
          }
        })
      }
    } catch (err) {
      console.error('[NormalizeVideoTab] selectManyVideos error', err)
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

      if (files.length === 0) {
        setErrorMessage('Không tìm thấy video nào trong thư mục này.')
        return
      }

      const existingPaths = new Set(videoItems.map((v) => v.path))
      const newItems: VideoItem[] = files
        .filter((f: any) => f && f.path && !existingPaths.has(f.path))
        .map((f: any) => ({
          path: f.path,
          fileName: f.fileName || getFileName(f.path) || 'Unknown',
          sizeBytes: f.sizeBytes || 0,
        }))

      if (newItems.length) {
        setVideoItems((prev) => [...prev, ...newItems])

        const MAX_INFO_ITEMS = 200
        const itemsForInfo = newItems.slice(0, MAX_INFO_ITEMS)

        runLimited(itemsForInfo, 8, async (item) => {
          try {
            const info = await (window as any).api.videoGetFileInfo(item.path)
            const durationSec = info?.durationSec

            if (typeof durationSec === 'number' && durationSec > 0) {
              setVideoItems((prev) => {
                const clone = [...prev]
                const targetIndex = clone.findIndex((v) => v.path === item.path)
                if (targetIndex < 0) return prev
                clone[targetIndex] = { ...clone[targetIndex], durationSec }
                return clone
              })
            }
          } catch (e) {
            console.warn('[NormalizeVideoTab] Failed to load duration for', item.path, e)
          }
        })
      }
    } catch (err) {
      console.error('[NormalizeVideoTab] handleAddFromFolder error', err)
      setErrorMessage('Không thể đọc thư mục.')
    }
  }

  const handleClearList = () => {
    if (isProcessing) return
    setVideoItems([])
    setSuccessData(null)
    setErrorMessage(null)
  }

  const handleSelectOutputDir = async () => {
    try {
      const dir = await (window as any).api.selectFolder()
      if (dir) {
        setOutputDir(dir)
      }
    } catch (err) {
      console.error('[NormalizeVideoTab] selectOutputDir error', err)
      setErrorMessage('Không chọn được thư mục xuất.')
    }
  }

  const handleNormalizeVideo = async () => {
    setErrorMessage(null)
    setSuccessData(null)
    setDiskSpaceError(null)

    if (!outputDir) {
      setErrorMessage('Vui lòng chọn thư mục xuất.')
      return
    }

    if (videoItems.length === 0) {
      setErrorMessage('Vui lòng chọn ít nhất một video.')
      return
    }

    // Generate requestId TRƯỚC để subscribe vào progress events
    const requestId = `normalize-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    setIsProcessing(true)
    setCurrentRequestId(requestId) // Set ngay để useEffect subscribe vào progress
    setStatusText('Đang bắt đầu chuẩn hóa video...')
    setCurrentProgress(null)

    try {
      const request: NormalizeVideoRequest = {
        inputFiles: videoItems.map((v) => v.path),
        outputDir,
        useGpu,
        requestId, // Truyền requestId vào backend
      }

      const api = (window as any).api

      if (!api) {
        setErrorMessage('API chưa sẵn sàng. Vui lòng reload lại ứng dụng (Ctrl+R hoặc F5).')
        setIsProcessing(false)
        setCurrentRequestId(null)
        return
      }

      if (typeof api.videoNormalize !== 'function') {
        setErrorMessage('API videoNormalize chưa sẵn sàng. Vui lòng reload lại ứng dụng (Ctrl+R hoặc F5).')
        setIsProcessing(false)
        setCurrentRequestId(null)
        return
      }

      const result: NormalizeVideoResult = await api.videoNormalize(request)

      if (result.success) {
        setSuccessData(result)
        setStatusText(`Đã chuẩn hóa thành công ${result.processed} video.`)
        if (result.failed > 0) {
          setErrorMessage(`Có ${result.failed} video bị lỗi.`)
        }
      } else {
        const msg = result.error || 'Chuẩn hóa video thất bại.'
        if (msg.includes('dung lượng') || msg.includes('không đủ')) {
          setDiskSpaceError(msg)
        } else {
          setErrorMessage(msg)
        }
      }
    } catch (err: any) {
      console.error('[NormalizeVideoTab] normalizeVideo error', err)
      const msg = err?.message || 'Chuẩn hóa video thất bại.'
      if (msg.includes('dung lượng') || msg.includes('không đủ')) {
        setDiskSpaceError(msg)
      } else {
        setErrorMessage(msg)
      }
    } finally {
      setIsProcessing(false)
      setCurrentRequestId(null)
      setCurrentProgress(null)
      if ((window as any).api?.refreshDiskInfo) {
        try {
          await (window as any).api.refreshDiskInfo()
        } catch (err) {
          console.error('[NormalizeVideoTab] refreshDiskInfo error', err)
        }
      }
    }
  }

  const handleCancelNormalize = async () => {
    if (!currentRequestId) return

    try {
      const api = (window as any).api
      if (api && typeof api.videoCancelJob === 'function') {
        await api.videoCancelJob(currentRequestId)
        setStatusText('Đã gửi lệnh dừng...')
      }
    } catch (err) {
      console.error('[NormalizeVideoTab] handleCancelNormalize error', err)
    }
  }

  const invalidConfig = !outputDir || !videoItems.length

  return (
    <div style={{ padding: '24px', color: '#e0e0e0', backgroundColor: '#1e1e1e', minHeight: '100%' }}>
      <h3 style={{ marginBottom: '8px', fontSize: '20px', fontWeight: 'bold' }}>Chuẩn hóa video</h3>
      <p style={{ fontSize: '13px', color: '#b0b0b0', marginBottom: '24px' }}>
        Xuất H.264/AAC, fps 30, yuv420p — giữ nguyên tỉ lệ khung hình gốc (đồng bộ với Cắt/Ghép/Xuất video hoàn chỉnh — tránh dừng hình, FPS sai).
      </p>

      {/* Danh sách video */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          Danh sách video cần chuẩn hóa
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
              backgroundColor: '#d32f2f',
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
        <div style={{ fontSize: '12px', color: '#999', marginBottom: '8px' }}>
          Đã chọn: {totalVideos} video
        </div>
        <div
          style={{
            minHeight: '120px',
            maxHeight: '300px',
            overflowY: 'auto',
            border: '1px solid #444',
            borderRadius: '4px',
            padding: '12px',
            backgroundColor: '#1a1a1a',
            fontSize: '13px',
          }}
        >
          {videoItems.length === 0 ? (
            <div style={{ color: '#999', fontStyle: 'italic' }}>Chưa có video nào.</div>
          ) : (
            videoItems.map((item, idx) => (
              <div
                key={item.path}
                style={{
                  padding: '8px',
                  marginBottom: '4px',
                  backgroundColor: '#2d2d2d',
                  borderRadius: '4px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {idx + 1}. {item.fileName}
                </span>
                {item.durationSec && (
                  <span style={{ marginLeft: '12px', color: '#999', fontSize: '12px' }}>
                    {Math.floor(item.durationSec / 60)}:{(Math.floor(item.durationSec) % 60).toString().padStart(2, '0')}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Thư mục xuất */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          Thư mục xuất video
        </label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div
            style={{
              flex: 1,
              padding: '8px 12px',
              border: '1px solid #444',
              borderRadius: '4px',
              backgroundColor: '#1a1a1a',
              minHeight: '36px',
              display: 'flex',
              alignItems: 'center',
              fontSize: '13px',
              color: outputDir ? '#e0e0e0' : '#999',
            }}
          >
            {outputDir || 'Chưa chọn thư mục'}
          </div>
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

      {/* GPU Encoding Option */}
      <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#2d2d2d', borderRadius: '4px' }}>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '14px' }}>
          <input
            type="checkbox"
            checked={useGpu}
            onChange={(e) => setUseGpu(e.target.checked)}
            disabled={isProcessing}
            style={{
              marginRight: '12px',
              width: '18px',
              height: '18px',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
            }}
          />
          <div>
            <div style={{ fontWeight: '500', marginBottom: '4px' }}>Sử dụng GPU để mã hóa (nhanh hơn)</div>
            <div style={{ fontSize: '12px', color: '#999' }}>
              Sử dụng GPU (NVIDIA/AMD/Apple) để mã hóa video, nhanh hơn nhiều so với CPU.
              Nếu GPU không khả dụng, hệ thống sẽ tự động chuyển sang CPU.
            </div>
          </div>
        </label>
      </div>

      {/* Progress */}
      {isProcessing && currentProgress && (
        <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#2d2d2d', borderRadius: '4px' }}>
          <div style={{ marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
            Đang xử lý: {currentProgress.currentFile}
          </div>
          <div style={{ marginBottom: '4px', fontSize: '12px', color: '#999' }}>
            {currentProgress.currentIndex} / {currentProgress.totalFiles} video
          </div>
          <div style={{ width: '100%', height: '8px', backgroundColor: '#1a1a1a', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${currentProgress.percent}%`,
                height: '100%',
                backgroundColor: '#007acc',
                transition: 'width 0.3s',
              }}
            />
          </div>
          {statusText && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#999' }}>{statusText}</div>
          )}
        </div>
      )}

      {/* Success message */}
      {successData && !isProcessing && (
        <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#1b5e20', borderRadius: '4px', color: '#fff' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>✓ Chuẩn hóa thành công!</div>
          <div style={{ fontSize: '13px' }}>
            Đã xử lý: {successData.processed} video
            {successData.failed > 0 && <span style={{ color: '#ffccbc' }}> ({successData.failed} lỗi)</span>}
          </div>
          {successData.outputPaths.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#c8e6c9' }}>
              File đã xuất: {successData.outputPaths.length} file
            </div>
          )}
          <button
            onClick={async () => {
              try {
                const api = (window as any).api
                if (api && typeof api.openPath === 'function') {
                  await api.openPath(outputDir)
                }
              } catch (err) {
                console.error('[NormalizeVideoTab] openPath error', err)
              }
            }}
            style={{
              marginTop: '12px',
              padding: '8px 16px',
              backgroundColor: '#4caf50',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            📁 Mở thư mục đã xuất
          </button>
        </div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#c62828', borderRadius: '4px', color: '#fff' }}>
          {errorMessage}
        </div>
      )}

      {/* Action button */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={handleNormalizeVideo}
          disabled={invalidConfig || isProcessing}
          style={{
            flex: 1,
            padding: '12px 24px',
            backgroundColor: invalidConfig || isProcessing ? '#555' : '#007acc',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: invalidConfig || isProcessing ? 'not-allowed' : 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
          }}
        >
          {isProcessing ? 'Đang xử lý...' : 'CHUẨN HÓA TOÀN BỘ'}
        </button>

        {isProcessing && (
          <button
            onClick={handleCancelNormalize}
            style={{
              padding: '12px 24px',
              backgroundColor: '#d32f2f',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 'bold',
            }}
          >
            DỪNG
          </button>
        )}
      </div>

      {/* Disk space error modal */}
      {diskSpaceError && (
        <DiskSpaceErrorModal
          message={diskSpaceError}
          onClose={() => setDiskSpaceError(null)}
        />
      )}
    </div>
  )
}

export default NormalizeVideoTab

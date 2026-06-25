import { useEffect, useState } from 'react'
import { DiskSpaceErrorModal } from '../../components/DiskSpaceErrorModal'
import { runLimited } from '../../utils/runLimited'

// Helper to extract filename from path (handles Unicode correctly)
function getFileName(filePath: string): string {
  if (!filePath) return ''
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

const RESOLUTION_OPTIONS = [
  { label: '16:9 — 1920×1080 (Full HD Ngang)', value: '1920x1080' },
  { label: '4:3 — 1440×1080 (Cổ điển)', value: '1440x1080' },
  { label: '2.35:1 — 2560×1080 (Cinemascope)', value: '2560x1080' },
  { label: '2:1 — 2160×1080 (Univisium)', value: '2160x1080' },
  { label: '1.85:1 — 1998×1080 (Widescreen)', value: '1998x1080' },
  { label: '9:16 — 1080×1920 (Dọc / Reels / Shorts)', value: '1080x1920' },
  { label: '3:4 — 1080×1440 (Dọc cổ điển)', value: '1080x1440' },
  { label: '5.8-inch — 1080×1868 (Mobile tall)', value: '1080x1868' },
  { label: '1:1 — 1080×1080 (Vuông / Instagram)', value: '1080x1080' },
  { label: '16:9 — 3840×2160 (4K UHD)', value: '3840x2160' },
  { label: '16:9 — 1280×720 (HD 720p)', value: '1280x720' },
]

const FPS_OPTIONS = [
  { label: '24.00 fps (Cinema)', value: '24' },
  { label: '25.00 fps (PAL / Europe)', value: '25' },
  { label: '29.97 fps (NTSC)', value: '30000/1001' },
  { label: '30.00 fps (YouTube phổ biến)', value: '30' },
  { label: '50.00 fps (PAL HFR)', value: '50' },
  { label: '59.94 fps (NTSC HFR)', value: '60000/1001' },
  { label: '60.00 fps (Gaming / HFR)', value: '60' },
]

interface NormalizeVideoRequest {
  inputFiles: string[]
  outputDir: string
  useGpu: boolean
  requestId?: string
  targetResolution?: string
  targetFps?: string
  concatSafe?: boolean
  skipExisting?: boolean
  writeManifest?: boolean
  trustInputs?: boolean
}

interface NormalizeVideoResult {
  requestId: string
  outputPaths: string[]
  success: boolean
  error?: string
  processed: number
  failed: number
  skipped?: number
  usedGpu?: boolean
  manifestPath?: string
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
  const [targetResolution, setTargetResolution] = useState<string>('1920x1080')
  const [targetFps, setTargetFps] = useState<string>('30')
  const [concatSafe, setConcatSafe] = useState<boolean>(true)
  const [skipExisting, setSkipExisting] = useState<boolean>(true)
  const [writeManifest, setWriteManifest] = useState<boolean>(true)
  const [trustInputs, setTrustInputs] = useState<boolean>(true)

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
        const api = window.api
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

    const unsubscribe = window.api.onVideoProgress?.((payload: any) => {
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
      const paths: string[] | null = await window.api.selectManyVideos?.()
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
            const info = await window.api.videoGetFileInfo(item.path)
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
      const folder = await window.api.selectFolder()
      if (!folder) return

      const files = (await window.api.listVideosInFolderSimple?.(folder)) || []

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
            const info = await window.api.videoGetFileInfo(item.path)
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
      const dir = await window.api.selectFolder()
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
        targetResolution,
        targetFps,
        concatSafe,
        skipExisting,
        writeManifest,
        trustInputs,
        requestId, // Truyền requestId vào backend
      }

      const api = window.api

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
      if (window.api?.refreshDiskInfo) {
        try {
          await window.api.refreshDiskInfo()
        } catch (err) {
          console.error('[NormalizeVideoTab] refreshDiskInfo error', err)
        }
      }
    }
  }

  const handleCancelNormalize = async () => {
    if (!currentRequestId) return

    try {
      const api = window.api
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
        Xuất H.264/AAC, chuẩn hóa tỉ lệ khung hình + FPS — thêm viền đen nếu cần (letterbox/pillarbox). Tương thích với Cắt/Ghép/Xuất video.
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

      {/* Cài đặt chuẩn hóa */}
      <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#2d2d2d', borderRadius: '4px' }}>
        <div style={{ fontWeight: '600', marginBottom: '12px', fontSize: '14px' }}>Cài đặt chuẩn hóa</div>

        {/* Resolution */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: '#ccc' }}>
            Tỉ lệ khung hình / Độ phân giải mục tiêu
          </label>
          <select
            value={targetResolution}
            onChange={(e) => setTargetResolution(e.target.value)}
            disabled={isProcessing}
            style={{
              width: '100%',
              padding: '8px 12px',
              backgroundColor: '#1a1a1a',
              color: '#e0e0e0',
              border: '1px solid #555',
              borderRadius: '4px',
              fontSize: '13px',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
            }}
          >
            {RESOLUTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* FPS */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: '#ccc' }}>
            FPS mục tiêu
          </label>
          <select
            value={targetFps}
            onChange={(e) => setTargetFps(e.target.value)}
            disabled={isProcessing}
            style={{
              width: '100%',
              padding: '8px 12px',
              backgroundColor: '#1a1a1a',
              color: '#e0e0e0',
              border: '1px solid #555',
              borderRadius: '4px',
              fontSize: '13px',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
            }}
          >
            {FPS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* GPU */}
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
              Ưu tiên GPU (NVIDIA/AMD). Tự động fallback sang CPU nếu GPU không khả dụng.
            </div>
          </div>
        </label>

        <div style={{ marginTop: '16px', display: 'grid', gap: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', cursor: 'pointer', fontSize: '14px' }}>
            <input
              type="checkbox"
              checked={concatSafe}
              onChange={(e) => setConcatSafe(e.target.checked)}
              disabled={isProcessing}
              style={{
                marginRight: '12px',
                marginTop: '2px',
                width: '18px',
                height: '18px',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
              }}
            />
            <div>
              <div style={{ fontWeight: '500', marginBottom: '4px' }}>Kho clip ghép nhanh (concat-safe)</div>
              <div style={{ fontSize: '12px', color: '#999' }}>
                Ép CFR, H.264/yuv420p, timebase 90000 và GOP đều để ghép copy-stream ổn định hơn.
              </div>
            </div>
          </label>

          <label style={{ display: 'flex', alignItems: 'flex-start', cursor: 'pointer', fontSize: '14px' }}>
            <input
              type="checkbox"
              checked={skipExisting}
              onChange={(e) => setSkipExisting(e.target.checked)}
              disabled={isProcessing}
              style={{
                marginRight: '12px',
                marginTop: '2px',
                width: '18px',
                height: '18px',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
              }}
            />
            <div>
              <div style={{ fontWeight: '500', marginBottom: '4px' }}>Bỏ qua file đã chuẩn hóa</div>
              <div style={{ fontSize: '12px', color: '#999' }}>
                Dùng để resume kho lớn, không encode lại file output cùng profile đã tồn tại.
              </div>
            </div>
          </label>

          <label style={{ display: 'flex', alignItems: 'flex-start', cursor: 'pointer', fontSize: '14px' }}>
            <input
              type="checkbox"
              checked={trustInputs}
              onChange={(e) => setTrustInputs(e.target.checked)}
              disabled={isProcessing}
              style={{
                marginRight: '12px',
                marginTop: '2px',
                width: '18px',
                height: '18px',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
              }}
            />
            <div>
              <div style={{ fontWeight: '500', marginBottom: '4px' }}>Không probe toàn bộ trước khi chạy</div>
              <div style={{ fontSize: '12px', color: '#999' }}>
                Nhanh hơn cho 20k clip; file lỗi sẽ bị đánh dấu lỗi trong lúc encode.
              </div>
            </div>
          </label>

          <label style={{ display: 'flex', alignItems: 'flex-start', cursor: 'pointer', fontSize: '14px' }}>
            <input
              type="checkbox"
              checked={writeManifest}
              onChange={(e) => setWriteManifest(e.target.checked)}
              disabled={isProcessing}
              style={{
                marginRight: '12px',
                marginTop: '2px',
                width: '18px',
                height: '18px',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
              }}
            />
            <div>
              <div style={{ fontWeight: '500', marginBottom: '4px' }}>Ghi manifest cho kho nguyên liệu</div>
              <div style={{ fontSize: '12px', color: '#999' }}>
                Tạo clip_pool_manifest.json để các bước ghép sau có thể nhận diện cùng profile.
              </div>
            </div>
          </label>
        </div>
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
          <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Chuẩn hóa thành công!</div>
          <div style={{ fontSize: '13px' }}>
            Đã xử lý: {successData.processed} video
            {successData.failed > 0 && <span style={{ color: '#ffccbc' }}> ({successData.failed} lỗi)</span>}
          </div>
          {successData.outputPaths.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#c8e6c9' }}>
              File đã xuất: {successData.outputPaths.length} file
            </div>
          )}
          {!!successData.skipped && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#c8e6c9' }}>
              Đã bỏ qua do có sẵn: {successData.skipped} file
            </div>
          )}
          {successData.manifestPath && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#c8e6c9' }}>
              Manifest: {successData.manifestPath}
            </div>
          )}
          <button
            onClick={async () => {
              try {
                const api = window.api
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
            Mở thư mục đã xuất
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

import { useEffect, useMemo, useState } from 'react'

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

interface CutSingleSimpleRequest {
  inputPath: string
  outputDir: string
  segmentLengthSec: number
  format?: 'mp4' | 'mkv'
  normalizeOutput?: boolean
  normalizeQuality?: NormalizeQuality
  useGpuEncoding?: boolean // true = prefer GPU, false = force CPU, undefined = auto
}

interface CutSingleSimpleResult {
  requestId: string
  outputFiles: string[]
  segmentCount: number
  expectedSegments?: number
  elapsedMs: number
  avgSpeed: number
  success: boolean
  error?: string
  warning?: string
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

function formatDuration(ms: number): string {
  return formatSecondsHMS(ms / 1000)
}

function SingleCutTabSimple() {
  const [inputVideoPath, setInputVideoPath] = useState<string>('')
  const [outputDir, setOutputDir] = useState<string>('')
  const [segmentLengthInput, setSegmentLengthInput] = useState<string>('5')
  const [segmentUnit, setSegmentUnit] = useState<'seconds' | 'minutes'>('seconds')
  const [normalizeOutput, setNormalizeOutput] = useState<boolean>(false)
  const [normalizeQuality, setNormalizeQuality] = useState<NormalizeQuality>('preserve')
  const [useGpuEncoding, setUseGpuEncoding] = useState<boolean>(false) // false = CPU, true = GPU
  const [targetResolution, setTargetResolution] = useState<string>('1920x1080')
  const [targetFps, setTargetFps] = useState<string>('30')
  const [videoInfo, setVideoInfo] = useState<VideoFileInfo | null>(null)
  const [loadingVideoInfo, setLoadingVideoInfo] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null)
  const [currentProgress, setCurrentProgress] = useState<{
    timeSec: number
    totalDurationSec: number
    percent: number
    currentSegment: number
    totalSegments: number
    speedX: number | null
    etaSec: number | null
  } | null>(null)
  const [successData, setSuccessData] = useState<CutSingleSimpleResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Load video info khi chọn file
  useEffect(() => {
    if (!inputVideoPath) {
      setVideoInfo(null)
      return
    }

    let cancelled = false
    setLoadingVideoInfo(true)
    ;window.api
      .videoGetFileInfo(inputVideoPath)
      .then((info: VideoFileInfo) => {
        if (!cancelled) {
          setVideoInfo(info)
          setLoadingVideoInfo(false)
        }
      })
      .catch((_err: any) => {
        if (!cancelled) {
          setVideoInfo(null)
          setLoadingVideoInfo(false)
        }
      })
    return () => { cancelled = true }
  }, [inputVideoPath])

  // Restore state từ running job khi component mount lại (sau khi chuyển tab)
  useEffect(() => {
    let mounted = true

    const restoreRunningJob = async () => {
      try {
        const jobs = await window.api.jobQueue.list()
        const runningJob = jobs.find(
          (job: any) =>
            job.type === 'video:cut-single' &&
            (job.status === 'running' || job.status === 'pending')
        )

        if (runningJob && mounted) {
          setCurrentRequestId(runningJob.id)
          setIsProcessing(true)
          
          if (runningJob.progress) {
            const progressPercent = runningJob.progress.percent ?? 0
            setCurrentProgress({
              currentSegment: 0,
              totalSegments: 0,
              percent: progressPercent,
              timeSec: 0,
              totalDurationSec: 0,
              speedX: null,
              etaSec: null,
            })
          }
        }
      } catch (err) {
        void err
      }
    }

    restoreRunningJob()

    return () => {
      mounted = false
    }
  }, []) // Chạy một lần khi component mount

  // Subscribe to progress events - listen khi đang processing
  useEffect(() => {
    if (!isProcessing) {
      return
    }

    const unsubscribe = window.api.onVideoProgress((payload: any) => {
      // Nếu có currentRequestId thì match, nếu chưa có thì accept tất cả single-cut events
      if (payload.mode === 'single-cut') {
        // Nếu có requestId và match, hoặc chưa có currentRequestId thì accept
        if ((currentRequestId && payload.requestId === currentRequestId) || !currentRequestId) {
          // Set requestId nếu chưa có
          if (!currentRequestId && payload.requestId) {
            console.log('[SingleCut] Setting requestId from progress:', payload.requestId)
            setCurrentRequestId(payload.requestId)
          }
          
          // Update progress
          const newProgress = {
            timeSec: payload.timeSec ?? 0,
            totalDurationSec: payload.totalDurationSec ?? 0,
            percent: payload.percent ?? 0,
            currentSegment: payload.currentSegment ?? 1,
            totalSegments: payload.totalSegments ?? 1,
            speedX: payload.speedX ?? null,
            etaSec: payload.etaSec ?? null,
          }
          console.log('[SingleCut] Setting progress:', newProgress)
          setCurrentProgress(newProgress)
        } else {
          console.log('[SingleCut] Ignoring progress event - requestId mismatch:', payload.requestId, 'vs', currentRequestId)
        }
      } else {
        console.log('[SingleCut] Ignoring progress event - wrong mode:', payload.mode)
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
  }, [isProcessing, currentRequestId])

  // Clear results when inputs change
  useEffect(() => {
    setSuccessData(null)
    setErrorMessage(null)
    setCurrentProgress(null)
  }, [inputVideoPath, outputDir])

  const handleSelectVideo = async () => {
    const path = await window.api.selectVideoFile()
    if (path) {
      setInputVideoPath(path)
    }
  }

  const handleSelectFolder = async () => {
    const path = await window.api.selectFolder()
    if (path) {
      setOutputDir(path)
    }
  }

  const segmentLengthInSeconds = useMemo(() => {
    if (!segmentLengthInput) return 0
    const numericValue = Number(segmentLengthInput)
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return 0
    }
    return segmentUnit === 'minutes' ? numericValue * 60 : numericValue
  }, [segmentLengthInput, segmentUnit])

  const totalSegments = useMemo(() => {
    if (!videoInfo?.durationSec || segmentLengthInSeconds <= 0) return 0
    return Math.ceil(videoInfo.durationSec / segmentLengthInSeconds)
  }, [videoInfo?.durationSec, segmentLengthInSeconds])

  const handleCut = async () => {
    if (!inputVideoPath || !outputDir || segmentLengthInSeconds <= 0) {
      return
    }

    setIsProcessing(true)
    setCurrentProgress(null)
    setSuccessData(null)
    setErrorMessage(null)
    setCurrentRequestId(null) // Reset để nhận requestId từ progress event đầu tiên

    try {
      const req: CutSingleSimpleRequest = {
        inputPath: inputVideoPath,
        outputDir,
        segmentLengthSec: segmentLengthInSeconds,
        format: 'mp4',
        normalizeOutput,
        normalizeQuality: normalizeOutput ? normalizeQuality : undefined,
        useGpuEncoding: normalizeOutput ? useGpuEncoding : undefined, // Only use GPU encoding if normalizeOutput is enabled
        targetResolution: normalizeOutput ? targetResolution : undefined,
        targetFps: normalizeOutput ? targetFps : undefined,
      }

      console.log('[SingleCut] Starting cut with request:', req)
      const result: CutSingleSimpleResult = await window.api.videoCutSingleSimple(req)
      console.log('[SingleCut] Cut completed with result:', result)
      // Set requestId từ result (fallback nếu progress event không có)
      if (!currentRequestId) {
        console.log('[SingleCut] Setting requestId from result:', result.requestId)
        setCurrentRequestId(result.requestId)
      }

      if (result.success) {
        setSuccessData(result)
      } else {
        setErrorMessage(result.error || 'Cắt video thất bại')
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Lỗi không xác định')
    } finally {
      setIsProcessing(false)
      if (window.api?.refreshDiskInfo) {
        try {
          await window.api.refreshDiskInfo()
        } catch (err) {
          console.error('[SingleCut] refreshDiskInfo error:', err)
        }
      }
    }
  }

  const canCut = inputVideoPath && outputDir && segmentLengthInSeconds > 0 && !isProcessing

  const handleCancel = async () => {
    if (!currentRequestId) return
    try {
      await window.api.videoCancelJob(currentRequestId)
      setIsProcessing(false)
      setCurrentRequestId(null)
      setCurrentProgress(null)
      setErrorMessage('Đã dừng bởi người dùng')
    } catch (e) {
      console.error('Cancel failed', e)
    }
  }

  return (
    <div style={{ padding: '24px', color: '#e0e0e0', backgroundColor: '#1e1e1e', minHeight: '100%' }}>
      <h3 style={{ marginBottom: '24px', fontSize: '20px', fontWeight: 'bold' }}>Cắt đơn video</h3>
      <p style={{ marginBottom: '24px', color: '#b0b0b0', fontSize: '14px' }}>
        Cắt 1 video thành nhiều đoạn đều nhau, giữ nguyên chất lượng.
      </p>

      {/* Chọn video */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          Chọn video gốc
        </label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={handleSelectVideo}
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
            Chọn file
          </button>
          {inputVideoPath && (
            <span style={{ fontSize: '13px', color: '#b0b0b0' }}>
              {getFileName(inputVideoPath)}
            </span>
          )}
        </div>
        {loadingVideoInfo && <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>Đang tải metadata...</div>}
        {videoInfo && videoInfo.durationSec !== null && (
          <div style={{ marginTop: '8px', fontSize: '13px', color: '#b0b0b0' }}>
            Đã chọn: {inputVideoPath.split(/[/\\]/).pop()} • Thời lượng: {formatSecondsHMS(videoInfo.durationSec)}
          </div>
        )}
      </div>

      {/* Thời lượng mỗi đoạn */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          Thời lượng mỗi đoạn
        </label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="number"
            value={segmentLengthInput}
            onChange={(e) => {
              const value = e.target.value
              if (value === '' || /^\d*\.?\d*$/.test(value)) {
                setSegmentLengthInput(value)
              }
            }}
            disabled={isProcessing}
            min="0"
            step="0.1"
            style={{
              padding: '8px 12px',
              backgroundColor: '#2d2d2d',
              color: '#e0e0e0',
              border: '1px solid #444',
              borderRadius: '4px',
              fontSize: '14px',
              width: '120px',
            }}
          />
          <select
            value={segmentUnit}
            onChange={(e) => setSegmentUnit(e.target.value as 'seconds' | 'minutes')}
            disabled={isProcessing}
            style={{
              padding: '8px 12px',
              backgroundColor: '#2d2d2d',
              color: '#e0e0e0',
              border: '1px solid #444',
              borderRadius: '4px',
              fontSize: '14px',
            }}
          >
            <option value="seconds">Giây</option>
            <option value="minutes">Phút</option>
          </select>
        </div>
        {totalSegments > 0 && (
          <div style={{ marginTop: '8px', fontSize: '13px', color: '#b0b0b0' }}>
            Sẽ cắt thành khoảng {totalSegments} đoạn (~{formatSecondsHMS(segmentLengthInSeconds)}/đoạn).
          </div>
        )}
      </div>

      {/* Thư mục xuất */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          Thư mục xuất video
        </label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={handleSelectFolder}
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
          {outputDir && (
            <span style={{ fontSize: '13px', color: '#b0b0b0', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {outputDir.length > 50 ? '...' + outputDir.slice(-50) : outputDir}
            </span>
          )}
        </div>
      </div>

      {/* Chuẩn hóa */}
      <div style={{ marginBottom: '24px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <input
            type="checkbox"
            checked={normalizeOutput}
            onChange={(e) => setNormalizeOutput(e.target.checked)}
            disabled={isProcessing}
            style={{ marginTop: '4px' }}
          />
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Chuẩn hóa toàn bộ đoạn đã cắt</div>
            <div style={{ fontSize: '12px', color: '#b0b0b0', lineHeight: 1.4 }}>
              Fps 30, yuv420p. Chọn chất lượng bên dưới: giữ nguyên resolution nguồn (2K ra 2K) hoặc đồng nhất 1080p/720p/2K để ghép không chuẩn hóa ổn định.
              Thời gian xử lý sẽ lâu hơn.
            </div>
          </div>
        </label>
      </div>

      {/* Tỉ lệ khung hình + FPS (chỉ khi bật chuẩn hóa) */}
      {normalizeOutput && (
        <div style={{ marginBottom: '24px', marginLeft: '28px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', color: '#ccc', width: '120px' }}>Tỉ lệ khung hình:</span>
            <select
              value={targetResolution}
              onChange={(e) => setTargetResolution(e.target.value)}
              disabled={isProcessing}
              style={{ padding: '5px 10px', backgroundColor: '#2d2d2d', color: '#e0e0e0', border: '1px solid #555', borderRadius: '4px', fontSize: '13px', minWidth: '260px' }}
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
            <span style={{ fontSize: '13px', color: '#ccc', width: '120px' }}>FPS:</span>
            <select
              value={targetFps}
              onChange={(e) => setTargetFps(e.target.value)}
              disabled={isProcessing}
              style={{ padding: '5px 10px', backgroundColor: '#2d2d2d', color: '#e0e0e0', border: '1px solid #555', borderRadius: '4px', fontSize: '13px', minWidth: '260px' }}
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

      {/* GPU Encoding (chỉ hiển thị khi normalizeOutput = true) */}
      {normalizeOutput && (
        <div style={{ marginBottom: '24px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
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
      <div style={{ marginBottom: '24px', display: 'flex', gap: '12px' }}>
        <button
          onClick={handleCut}
          disabled={!canCut}
          style={{
            padding: '12px 24px',
            backgroundColor: canCut ? '#007acc' : '#444',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: canCut ? 'pointer' : 'not-allowed',
            fontSize: '14px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          {isProcessing ? (
            <>
              <span className="spinner" style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              Đang cắt...
            </>
          ) : (
            'Cắt video'
          )}
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
            Dừng cắt
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
            Mở thư mục xuất
          </button>
        )}
      </div>

      {/* Progress bar */}
      {isProcessing && (
        <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#2d2d2d', borderRadius: '4px' }}>
          <div style={{ marginBottom: '8px', fontSize: '13px', color: '#b0b0b0' }}>
            {currentProgress ? (
              <>
                Đang cắt: Đoạn {currentProgress.currentSegment}/{currentProgress.totalSegments} • Thời gian:{' '}
                {formatSecondsHMS(currentProgress.timeSec)} / {formatSecondsHMS(currentProgress.totalDurationSec)} ({currentProgress.percent.toFixed(1)}%)
                {currentProgress.speedX !== null && ` • Tốc độ: ~${currentProgress.speedX.toFixed(1)}×`}
                {currentProgress.etaSec !== null && ` • Còn lại: ${formatSecondsHMS(currentProgress.etaSec)}`}
              </>
            ) : (
              'Đang khởi động...'
            )}
          </div>
          {currentProgress && (
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
                  width: `${currentProgress.percent}%`,
                  height: '100%',
                  backgroundColor: '#007acc',
                  transition: 'width 0.3s',
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Success message */}
      {successData && (
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
            Đã cắt thành công {successData.segmentCount} đoạn trong {formatDuration(successData.elapsedMs)} với tốc độ trung bình ~{successData.avgSpeed.toFixed(1)}× (1.mp4 → {successData.segmentCount}.mp4).
              {successData.expectedSegments && successData.expectedSegments !== successData.segmentCount && (
                <span style={{ color: '#ff9800', marginLeft: '8px' }}>
                  (Dự kiến: {successData.expectedSegments} đoạn)
                </span>
              )}
          </div>
          <div style={{ fontSize: '12px', color: '#b0b0b0' }}>
            Các file nằm trong thư mục: {outputDir}
          </div>
        </div>
          
          {/* Warning message nếu có */}
          {successData.warning && (
            <div
              style={{
                padding: '16px',
                backgroundColor: '#3a2a1a',
                border: '1px solid #5a4a2a',
                borderRadius: '4px',
                marginBottom: '16px',
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#ff9800', marginBottom: '8px' }}>
                Cảnh báo
              </div>
              <div style={{ fontSize: '12px', color: '#e0e0e0', lineHeight: 1.6 }}>
                {successData.warning}
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
            {errorMessage.length > 200 ? errorMessage.slice(0, 200) + '...' : errorMessage}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export default SingleCutTabSimple



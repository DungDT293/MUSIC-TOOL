import { useEffect, useMemo, useState, useRef, type CSSProperties } from 'react'
import { DiskSpaceErrorModal } from '../../components/DiskSpaceErrorModal'
import NumericDraftInput from '../../components/NumericDraftInput'
import { useExportActivityStore } from '../../stores/exportActivityStore'
import type {
  FinalExportDonePayload,
  FinalExportErrorPayload,
  FinalExportProgressPayload,
  FinalExportScanItem,
  FinalExportVisualizerPreset,
} from '../../../shared/videoFinalExportChannels'

type SourceType = 'file' | 'folder' | 'files'

interface SelectedSource {
  type: SourceType
  path: string
  paths?: string[]
}

interface ProgressState {
  percent: number
  timeSec?: number
  totalDurationSec?: number
  speedX?: number
  etaSec?: number
  currentIndex?: number
  totalOutputs?: number
  currentOutputFilename?: string
  currentAudioPath?: string
}

function getFileName(filePath?: string | null) {
  if (!filePath) return ''
  const segments = filePath.split(/[/\\]/)
  return segments[segments.length - 1] || filePath
}

function formatSeconds(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return '--:--'
  const total = Math.max(0, Math.floor(value))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

function describeUnknownError(err: any): string {
  if (!err) return 'Không rõ lỗi.'
  const parts = [err?.message || err?.error || String(err)]
  if (err?.code) parts.push(`code=${err.code}`)
  if (err?.errno) parts.push(`errno=${err.errno}`)
  if (err?.syscall) parts.push(`syscall=${err.syscall}`)
  if (err?.path) parts.push(`path=${err.path}`)
  if (err?.cause?.message) parts.push(`cause=${err.cause.message}`)
  return parts.filter(Boolean).join(' | ')
}

function buildFinalExportFixHint(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('enospc') || lower.includes('dung lượng') || lower.includes('no space left') || lower.includes('disk full')) {
    return 'Cách xử lý: giải phóng dung lượng ổ đĩa hoặc chọn thư mục output sang ổ còn trống nhiều hơn.'
  }
  if (lower.includes('eacces') || lower.includes('eperm') || lower.includes('không có quyền') || lower.includes('permission denied') || lower.includes('access is denied')) {
    return 'Cách xử lý: kiểm tra quyền đọc/ghi thư mục, đóng file video/audio/output đang mở, bỏ read-only hoặc chạy app với quyền phù hợp.'
  }
  if (lower.includes('enoent') || lower.includes('không tồn tại') || lower.includes('not found') || lower.includes('no such file')) {
    return 'Cách xử lý: kiểm tra lại file audio/video/ảnh và thư mục output; file có thể đã bị đổi tên, xóa hoặc nằm trong ổ rời chưa mount.'
  }
  if (lower.includes('timeout')) {
    return 'Cách xử lý: thử với ít file hơn, kiểm tra FFmpeg có bị treo, hoặc đổi codec/chuẩn hóa video rồi chạy lại.'
  }
  if (lower.includes('ffmpeg')) {
    return 'Cách xử lý: file media có thể lỗi/codec lạ; thử bật re-encode/chuẩn hóa video, loại file gây lỗi hoặc kiểm tra log FFmpeg ở console.'
  }
  if (lower.includes('sóng nhạc') || lower.includes('showwaves') || lower.includes('showfreqs')) {
    return 'Cách xử lý: thử đổi kiểu sóng nhạc về Bars/Line, giảm chiều cao/độ mịn hoặc tắt sóng nhạc để xác định file nào gây lỗi.'
  }
  return 'Cách xử lý: xem job/audio/output trong phần Chi tiết, kiểm tra input của job đó rồi chạy lại sau khi sửa.'
}

const cardStyle: CSSProperties = {
  backgroundColor: '#2d2d2d',
  borderRadius: '8px',
  border: '1px solid #333',
  padding: '16px',
  marginBottom: '24px',
}

const buttonStyle: CSSProperties = {
  padding: '10px 18px',
  backgroundColor: '#007acc',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 600,
}

const pickerMenuStyle: CSSProperties = {
  marginTop: '8px',
  border: '1px solid #3d3d3d',
  borderRadius: '6px',
  backgroundColor: '#1a1a1a',
  padding: '8px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
}

const AUDIO_PREVIEW_LIMIT = 20
const VIDEO_PREVIEW_LIMIT = 20
const OUTPUT_PREVIEW_LIMIT = 6

const AUDIO_VISUALIZER_PRESETS: Array<{ value: FinalExportVisualizerPreset; label: string; hint: string }> = [
  { value: 'bars-spectrum', label: 'Bars Spectrum', hint: 'Cột phổ nhạc kiểu cũ' },
  { value: 'line-waveform', label: 'Line Waveform', hint: 'Đường sóng ngang sạch, dễ nhìn' },
  { value: 'mirror-waveform', label: 'Mirror Waveform', hint: 'Sóng gương quanh tâm' },
  { value: 'neon-waveform', label: 'Neon Waveform', hint: 'Đường sóng phát sáng' },
]

function FinalExportTab() {
  // MED-14 fix: api stored in ref so it's not re-evaluated on every render
  const apiRef = useRef(window.api)
  // Stable getter — safe to call from any callback or effect
  const api = apiRef.current

  const requestDiskRefresh = () => {
    if (api?.refreshDiskInfo) {
      api
        .refreshDiskInfo()
        .catch((_err: unknown) => { /* disk refresh failure is non-critical */ })
    }
  }

  const [audioSource, setAudioSource] = useState<SelectedSource | null>(null)
  const [videoSource, setVideoSource] = useState<SelectedSource | null>(null)
  const [imageSource, setImageSource] = useState<SelectedSource | null>(null)
  const [outputFolder, setOutputFolder] = useState<string | null>(null)
  const [outputFilename, setOutputFilename] = useState('final_video.mp4')
  const [outputNamesText, setOutputNamesText] = useState<string>('') // nhiều tên, mỗi dòng 1 tên (tùy chọn)
  const [tracklistEnabled, setTracklistEnabled] = useState<boolean>(false)
  const [forceReencode, setForceReencode] = useState<boolean>(false)
  const [normalizeAudio, setNormalizeAudio] = useState<boolean>(false)
  const [useGpuEncoding, setUseGpuEncoding] = useState<'auto' | 'gpu' | 'cpu'>('auto') // Default: auto (backward compatible)
  const [deleteSourceFiles, setDeleteSourceFiles] = useState<boolean>(false) // Xóa file audio/video sau khi xuất xong
  const [audioVisualizerEnabled, setAudioVisualizerEnabled] = useState<boolean>(false)
  const [audioVisualizerPreset, setAudioVisualizerPreset] = useState<FinalExportVisualizerPreset>('neon-waveform')
  const [audioVisualizerPosition, setAudioVisualizerPosition] = useState<'top' | 'center' | 'bottom'>('bottom')
  const [audioVisualizerWidthPercent, setAudioVisualizerWidthPercent] = useState<number>(100)
  const [audioVisualizerHeightPercent, setAudioVisualizerHeightPercent] = useState<number>(30)
  const [audioVisualizerMarginBottomPx, setAudioVisualizerMarginBottomPx] = useState<number>(24)
  const [audioVisualizerPrimaryColor, setAudioVisualizerPrimaryColor] = useState<string>('#00d1ff')
  const [audioVisualizerSecondaryColor, setAudioVisualizerSecondaryColor] = useState<string>('#7c3aed')
  const [audioVisualizerOpacity, setAudioVisualizerOpacity] = useState<number>(0.92)
  const [audioVisualizerBarCount, setAudioVisualizerBarCount] = useState<number>(384)
  const [audioVisualizerSensitivity, setAudioVisualizerSensitivity] = useState<number>(5)
  const [audioVisualizerPreviewUrl, setAudioVisualizerPreviewUrl] = useState<string | null>(null)
  const [audioVisualizerPreviewing, setAudioVisualizerPreviewing] = useState<boolean>(false)

  const [activePicker, setActivePicker] = useState<'audio' | 'video' | 'image' | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const isExportingRef = useRef(false) // Ref để track trạng thái export ngay lập tức (tránh race condition)
  const [exportOutputs, setExportOutputs] = useState<FinalExportDonePayload['outputs'] | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [progressState, setProgressState] = useState<ProgressState | null>(null)
  const [statusText, setStatusText] = useState('Chưa bắt đầu xuất video.')
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [audioFileCount, setAudioFileCount] = useState<number | null>(null)
  const [videoFileCount, setVideoFileCount] = useState<number | null>(null)
  const [audioTotalSec, setAudioTotalSec] = useState<number | null>(null)
  const [videoTotalSec, setVideoTotalSec] = useState<number | null>(null)
  const [usedVideoCount, setUsedVideoCount] = useState<number | null>(null)
  const [concatVideoDurationSec, setConcatVideoDurationSec] = useState<number | null>(null)
  const [audioItems, setAudioItems] = useState<FinalExportScanItem[]>([])
  const [videoItems, setVideoItems] = useState<FinalExportScanItem[]>([])
  const [imageItems, setImageItems] = useState<FinalExportScanItem[]>([])
  const [imageFileCount, setImageFileCount] = useState<number | null>(null)
  const [imageTotalSec, setImageTotalSec] = useState<number | null>(null)
  const [endingAudioPaths, setEndingAudioPaths] = useState<string[]>([])
  const [endingAudioItems, setEndingAudioItems] = useState<FinalExportScanItem[]>([])
  const [endingAudioTotalSec, setEndingAudioTotalSec] = useState<number | null>(null)
  const [diskSpaceError, setDiskSpaceError] = useState<string | null>(null)

  const [usePriorityVideos, setUsePriorityVideos] = useState<boolean>(false)
  const [priorityVideoFolder, setPriorityVideoFolder] = useState<string | null>(null)
  const [priorityVideoPaths, setPriorityVideoPaths] = useState<string[]>([]) // Danh sách video khi chọn trực tiếp
  const [priorityVideoCount, setPriorityVideoCount] = useState<number | null>(null)
  const [priorityVideoTotalSec, setPriorityVideoTotalSec] = useState<number | null>(null)

  // Chroma Key Overlay
  const [chromaKeyEnabled, setChromaKeyEnabled] = useState(false)
  const [chromaKeyVideoPath, setChromaKeyVideoPath] = useState<string | null>(null)
  const [chromaKeyBgType, setChromaKeyBgType] = useState<'green' | 'black'>('green')
  const [chromaKeyColor, setChromaKeyColor] = useState('#00FF00')
  const [chromaKeySimilarity, setChromaKeySimilarity] = useState(0.15)
  const [chromaKeyBlend, setChromaKeyBlend] = useState(0.05)
  const [chromaKeyPosition, setChromaKeyPosition] = useState<'center' | 'bottom'>('center')
  const [chromaKeyScale, setChromaKeyScale] = useState(1.0)
  const [chromaKeyPreviewUrl, setChromaKeyPreviewUrl] = useState<string | null>(null)
  const [chromaKeyPreviewing, setChromaKeyPreviewing] = useState(false)

  // Export Presets (Sprint 3.1)
  const [presets, setPresets] = useState<Array<{ id: string; name: string; settings: any }>>([])
  const [presetName, setPresetName] = useState('')
  const [showPresets, setShowPresets] = useState(false)

  // Slideshow (image source) settings
  const [perImageDurationSec, setPerImageDurationSec] = useState<number>(5)
  const [imageShuffle, setImageShuffle] = useState<boolean>(false)
  const [imageAspectMode, setImageAspectMode] = useState<'letterbox' | 'crop-fill' | 'blur-background'>('letterbox')
  const [imageTransition, setImageTransition] = useState<string>('none')
  const [imageKenBurns, setImageKenBurns] = useState<boolean>(false)

  const loadPresets = async () => {
    const w = window
    if (!w.api?.preset?.list) return
    const res = await w.api.preset.list()
    if (res?.success) setPresets(res.presets ?? [])
  }

  const buildAudioVisualizerOptions = () => ({
    enabled: true,
    preset: audioVisualizerPreset,
    position: audioVisualizerPosition,
    widthPercent: audioVisualizerWidthPercent,
    heightPercent: audioVisualizerHeightPercent,
    marginBottomPx: audioVisualizerMarginBottomPx,
    primaryColor: audioVisualizerPrimaryColor,
    secondaryColor: audioVisualizerSecondaryColor,
    opacity: audioVisualizerOpacity,
    barCount: audioVisualizerBarCount,
    sensitivity: audioVisualizerSensitivity,
  })

  const handlePreviewAudioVisualizer = async () => {
    if (!audioSource || (!videoSource && !imageSource) || audioItems.length === 0 || audioVisualizerPreviewing) return
    const bgPath = videoItems[0]?.path || imageItems[0]?.path || videoSource?.path || imageSource?.path
    const bgKind: 'image' | 'video' = imageSource && !videoSource ? 'image' : 'video'
    const audioPath = audioItems[0]?.path || audioSource.path
    if (!bgPath || !audioPath) {
      setErrorMessage('Cần chọn audio và video/ảnh trước khi xem thử sóng nhạc.')
      return
    }

    setAudioVisualizerPreviewing(true)
    setAudioVisualizerPreviewUrl(null)
    setErrorMessage(null)
    try {
      const result = await api?.barsSpectrumPreview?.({
        bgPath,
        bgKind,
        audioPath,
        audioVisualizer: buildAudioVisualizerOptions(),
      })
      if (result?.ok && result.previewPath) {
        setAudioVisualizerPreviewUrl(`app://local-file/?path=${encodeURIComponent(result.previewPath)}`)
      } else {
        setErrorMessage(result?.error || 'Không tạo được preview sóng nhạc.')
      }
    } catch (err: any) {
      console.error('[AudioVisualizer] Preview error', err)
      const detail = describeUnknownError(err)
      setErrorMessage(`Không tạo được preview sóng nhạc.\n${detail}\n${buildFinalExportFixHint(detail)}`)
    } finally {
      setAudioVisualizerPreviewing(false)
    }
  }

  const handleSavePreset = async () => {
    const w = window
    if (!w.api?.preset?.save) return
    const name = presetName.trim() || `Preset ${new Date().toLocaleString('vi-VN')}`
    const settings = {
      outputFilename, outputNamesText, tracklistEnabled, forceReencode, normalizeAudio,
      endingAudioPaths,
      useGpuEncoding, deleteSourceFiles, audioVisualizerEnabled, audioVisualizerPreset, audioVisualizerPosition,
      audioVisualizerWidthPercent, audioVisualizerHeightPercent, audioVisualizerMarginBottomPx,
      audioVisualizerPrimaryColor, audioVisualizerSecondaryColor, audioVisualizerOpacity,
      audioVisualizerBarCount, audioVisualizerSensitivity, usePriorityVideos,
      priorityVideoFolder: priorityVideoFolder ?? undefined,
    }
    const res = await w.api.preset.save(name, settings)
    if (res?.success) {
      setPresetName('')
      loadPresets()
    }
  }

  const handleApplyPreset = (settings: any) => {
    if (settings.outputFilename !== undefined) setOutputFilename(settings.outputFilename)
    if (settings.outputNamesText !== undefined) setOutputNamesText(settings.outputNamesText)
    if (settings.tracklistEnabled !== undefined) setTracklistEnabled(settings.tracklistEnabled)
    if (settings.forceReencode !== undefined) setForceReencode(settings.forceReencode)
    if (settings.normalizeAudio !== undefined) setNormalizeAudio(settings.normalizeAudio)
    if (settings.useGpuEncoding !== undefined) setUseGpuEncoding(settings.useGpuEncoding)
    if (settings.deleteSourceFiles !== undefined) setDeleteSourceFiles(settings.deleteSourceFiles)
    if (settings.audioVisualizerEnabled !== undefined) setAudioVisualizerEnabled(settings.audioVisualizerEnabled)
    if (settings.audioVisualizerPreset !== undefined) setAudioVisualizerPreset(settings.audioVisualizerPreset)
    if (settings.audioVisualizerPosition !== undefined) setAudioVisualizerPosition(settings.audioVisualizerPosition)
    if (settings.audioVisualizerWidthPercent !== undefined) setAudioVisualizerWidthPercent(settings.audioVisualizerWidthPercent)
    if (settings.audioVisualizerHeightPercent !== undefined) setAudioVisualizerHeightPercent(settings.audioVisualizerHeightPercent)
    if (settings.audioVisualizerMarginBottomPx !== undefined) setAudioVisualizerMarginBottomPx(settings.audioVisualizerMarginBottomPx)
    if (settings.audioVisualizerPrimaryColor !== undefined) setAudioVisualizerPrimaryColor(settings.audioVisualizerPrimaryColor)
    if (settings.audioVisualizerSecondaryColor !== undefined) setAudioVisualizerSecondaryColor(settings.audioVisualizerSecondaryColor)
    if (settings.audioVisualizerOpacity !== undefined) setAudioVisualizerOpacity(settings.audioVisualizerOpacity)
    if (settings.audioVisualizerBarCount !== undefined) setAudioVisualizerBarCount(settings.audioVisualizerBarCount)
    if (settings.audioVisualizerSensitivity !== undefined) setAudioVisualizerSensitivity(settings.audioVisualizerSensitivity)
    if (settings.usePriorityVideos !== undefined) setUsePriorityVideos(settings.usePriorityVideos)
    if (settings.priorityVideoFolder !== undefined) setPriorityVideoFolder(settings.priorityVideoFolder)
    if (Array.isArray(settings.endingAudioPaths)) setEndingAudioPaths(settings.endingAudioPaths)
  }

  const handleDeletePreset = async (id: string) => {
    const w = window
    if (!w.api?.preset?.delete) return
    await w.api.preset.delete(id)
    loadPresets()
  }

  // Restore state từ running job khi component mount lại (sau khi chuyển tab)
  useEffect(() => {
    let mounted = true

    const restoreRunningJob = async () => {
      try {
        const jobs = await window.api.jobQueue.list()
        const runningJob = jobs.find(
          (job: any) =>
            job.type === 'video:final-export' &&
            (job.status === 'running' || job.status === 'pending')
        )

        if (runningJob && mounted) {
          console.log('[FinalExport] Found running job, restoring state:', runningJob.id)
          setActiveRequestId(runningJob.id)
          setIsExporting(true)
          
          if (runningJob.progress) {
            const progressPercent = runningJob.progress.percent ?? 0
            setProgressState({
              percent: progressPercent,
              timeSec: 0,
              totalDurationSec: 0,
            })
            setStatusText(runningJob.progress.message || 'Đang tiếp tục xuất video...')
          }
        }
      } catch (err) {
        console.error('[FinalExport] Failed to restore running job:', err)
      }
    }

    restoreRunningJob()

    return () => {
      mounted = false
    }
  }, []) // Chạy một lần khi component mount

  useEffect(() => {
    if (!api?.videoFinalExport) return undefined

    const unsubscribeProgress = api.videoFinalExport.onProgress((payload: FinalExportProgressPayload) => {
      if (activeRequestId && payload.requestId !== activeRequestId) return
      setIsExporting(true)
      // PHASE 6: Progress theo job - jobIndex/totalJobs
      if (payload.totalOutputs && payload.currentIndex) {
        const currentFile = payload.currentOutputFilename
          ? getFileName(payload.currentOutputFilename)
          : payload.currentAudioPath
          ? getFileName(payload.currentAudioPath)
          : null
        setStatusText(
          `Đang xuất video ${payload.currentIndex}/${payload.totalOutputs}` +
            (currentFile ? `: ${currentFile}` : '')
        )
      } else {
        setStatusText(payload?.status || 'Đang xuất video…')
      }
      if (typeof payload.audioFileCount === 'number') {
        setAudioFileCount(payload.audioFileCount)
      }
      if (typeof payload.videoFileCount === 'number') {
        setVideoFileCount(payload.videoFileCount)
      }
      if (typeof payload.concatVideoDurationSec === 'number') {
        setConcatVideoDurationSec(payload.concatVideoDurationSec)
      }
      if (typeof payload.usedVideoCount === 'number') {
        setUsedVideoCount(payload.usedVideoCount)
      }
      setProgressState({
        percent: typeof payload.percent === 'number' ? payload.percent : 0,
        timeSec: payload.timeSec,
        totalDurationSec: payload.totalDurationSec,
        speedX: payload.speedX,
        etaSec: payload.etaSec,
        currentIndex: payload.currentIndex,
        totalOutputs: payload.totalOutputs,
        currentOutputFilename: payload.currentOutputFilename,
        currentAudioPath: payload.currentAudioPath,
      })
    })

    const unsubscribeDone = api.videoFinalExport.onDone((payload: FinalExportDonePayload) => {
      if (activeRequestId && payload.requestId !== activeRequestId) return
      isExportingRef.current = false
      setIsExporting(false)
      // FIX C-01: Unregister from global export activity store
      useExportActivityStore.getState().unregisterExport(payload.requestId)
      const totalOutputs = payload.outputs?.length ?? 0
      const failedCount = payload.failedJobs?.length ?? 0
      const warningText = payload.warnings?.filter(Boolean).join(' ') || ''

      if (failedCount > 0 && totalOutputs > 0) {
        // Partial success
        const failDetails = payload.failedJobs!
          .map(f => `• Job ${f.jobIndex + 1} (${f.fileName}): ${f.error.slice(0, 300)}`)
          .join('\n')
        setStatusText(
          `⚠️ Đã xuất ${totalOutputs} video thành công, ${failedCount} video thất bại. ${warningText}`.trim()
        )
        setErrorMessage(`Có ${failedCount} video thất bại:\n${failDetails}\n${buildFinalExportFixHint(failDetails)}`)
      } else {
        const baseStatus =
          totalOutputs <= 1
            ? 'Đã xuất video hoàn chỉnh.'
            : `Đã xuất xong ${totalOutputs} video, mỗi video khớp với một audio trong playlist.`
        setStatusText(`${baseStatus} ${warningText}`.trim())
        setErrorMessage(null)
      }

      const lastOutput = payload.outputs?.[payload.outputs.length - 1]
      setProgressState(
        lastOutput
          ? {
              percent: 100,
              timeSec: lastOutput.durationSec,
              totalDurationSec: lastOutput.durationSec,
              speedX: undefined,
              etaSec: 0,
              currentIndex: payload.outputs.length,
              totalOutputs,
              currentOutputFilename: getFileName(lastOutput.videoFile),
              currentAudioPath: lastOutput.audioFile,
            }
          : null
      )
      setExportOutputs(payload.outputs ?? [])
      setActiveRequestId(null)
      requestDiskRefresh()
    })

    const unsubscribeError = api.videoFinalExport.onError((payload: FinalExportErrorPayload) => {
      if (activeRequestId && payload.requestId !== activeRequestId) return
      isExportingRef.current = false
      setIsExporting(false)
      // FIX C-01: Unregister from global export activity store
      useExportActivityStore.getState().unregisterExport(payload.requestId)
      const baseMessage = payload?.message || payload?.error || 'Đã xảy ra lỗi trong quá trình export.'
      const contextParts = [
        payload?.currentIndex ? `job=${payload.currentIndex}` : '',
        payload?.currentAudioPath ? `audio=${getFileName(payload.currentAudioPath)}` : '',
        payload?.requestId ? `requestId=${payload.requestId}` : '',
      ].filter(Boolean)
      const hint = buildFinalExportFixHint(baseMessage)
      const message = contextParts.length > 0
        ? `${baseMessage}\nChi tiết: ${contextParts.join(' | ')}\n${hint}`
        : `${baseMessage}\n${hint}`
      setStatusText(baseMessage)
      if (baseMessage.startsWith('CẢNH BÁO: Dung lượng ổ đĩa không đủ')) {
        setDiskSpaceError(message)
        setErrorMessage(null)
      } else {
        setErrorMessage(message)
      }
      setProgressState(null)
      setExportOutputs(null)
      setActiveRequestId(null)
      requestDiskRefresh()
    })

    return () => {
      unsubscribeProgress?.()
      unsubscribeDone?.()
      unsubscribeError?.()
    }
  }, [api, activeRequestId])


  // Logic: Nếu có nhiều audio/video → disable input "Tên file output" (single)
  // Nếu chỉ có 1 audio và 1 video → disable textarea "Tên file output (mỗi dòng một tên)"
  const multipleAudio = audioItems.length > 1
  const singleAudioVideo = audioItems.length === 1 && videoItems.length === 1
  const endingAudioPerJobSec = endingAudioTotalSec ?? endingAudioItems.reduce((sum, item) => sum + item.durationSec, 0)
  const totalExportAudioSec = audioTotalSec != null
    ? audioTotalSec + (audioFileCount ?? audioItems.length) * endingAudioPerJobSec
    : null

  const parsedOutputNames = useMemo(() => {
    return outputNamesText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
  }, [outputNamesText])

  const nameMismatch =
    parsedOutputNames.length > 0 &&
    audioItems.length > 0 &&
    parsedOutputNames.length !== audioItems.length

  const strictFilesPairingCountMismatch =
    videoSource?.type === 'files' &&
    audioItems.length > 0 &&
    videoItems.length > 0 &&
    audioItems.length !== videoItems.length

  // Slideshow mode: allow export when imageSource is present (videoSource optional)
  const isSlideshowMode = Boolean(imageSource && !videoSource)

  const canExport = useMemo(() => {
    const hasOutputName = multipleAudio ? true : outputFilename.trim().length > 0
    const hasVideoOrImage = Boolean(videoSource || imageSource)
    return Boolean(
      audioSource &&
      hasVideoOrImage &&
      outputFolder &&
      hasOutputName &&
      !isExporting &&
      !nameMismatch &&
      !strictFilesPairingCountMismatch
    )
  }, [
    audioSource,
    videoSource,
    imageSource,
    outputFolder,
    outputFilename,
    isExporting,
    multipleAudio,
    nameMismatch,
    strictFilesPairingCountMismatch,
  ])

  const handlePickSource = async (target: 'audio' | 'video' | 'image', type: 'file' | 'folder' | 'file-single') => {
    setActivePicker(null)
    setExportOutputs(null)
    if (target === 'audio') {
      setAudioItems([])
      setAudioFileCount(null)
      setAudioTotalSec(null)
      setAudioSource(null)
    } else {
      setVideoItems([])
      setVideoFileCount(null)
      setVideoTotalSec(null)
      setVideoSource(null)
    }
    try {
      let source: SelectedSource | null = null
      if (type === 'file-single') {
        // Chọn 1 file video: dùng dialog chọn 1 file để "video đơn lẻ" hoạt động ổn định
        if (target !== 'video') return
        const path: string | null = await api?.selectVideoFile?.()
        if (!path) return
        source = { type: 'file', path }
      } else if (type === 'file') {
        if (target === 'audio') {
          const paths: string[] | null = await api?.selectAudioFilesMulti?.()
          if (!paths || paths.length === 0) return
          source =
            paths.length === 1 ? { type: 'file', path: paths[0] } : { type: 'files', path: paths[0], paths }
        } else if (target === 'image') {
          const paths: string[] | null = await api?.selectImageFilesMulti?.()
          if (!paths || paths.length === 0) return
          source =
            paths.length === 1 ? { type: 'file', path: paths[0] } : { type: 'files', path: paths[0], paths }
          // Chọn ảnh thì bỏ videoSource để bật slideshow mode rõ ràng
          setVideoItems([])
          setVideoFileCount(null)
          setVideoTotalSec(null)
          setVideoSource(null)
        } else {
          const paths: string[] | null = await api?.selectVideoFilesMulti?.()
          if (!paths || paths.length === 0) return
          source =
            paths.length === 1 ? { type: 'file', path: paths[0] } : { type: 'files', path: paths[0], paths }
          // Chọn video thì bỏ imageSource để tránh trộn mode
          setImageItems([])
          setImageFileCount(null)
          setImageTotalSec(null)
          setImageSource(null)
        }
      } else {
        const selectedPath = await api?.selectFolder?.()
        if (!selectedPath) return
        source = { type: 'folder', path: selectedPath }
      }
      if (!source) return
      if (target === 'audio') {
        setAudioSource(source)
        try {
          const scanRes = await api?.videoFinalExport?.scanAudioSource({
            requestId: `scan-audio-${Date.now()}`,
            audioSource: source,
          })
          if (scanRes && scanRes.kind === 'audio') {
            setAudioFileCount(scanRes.fileCount)
            setAudioTotalSec(scanRes.totalDurationSec)
            setAudioItems(scanRes.items || [])
          }
        } catch (err) {
          const detail = describeUnknownError(err)
          console.error('[FinalExportTab] scanAudioSource error', detail, err)
          setErrorMessage(`Không quét được audio nguồn.\n${detail}\n${buildFinalExportFixHint(detail)}`)
        }
      } else if (target === 'video') {
        setVideoSource(source)
        try {
          const scanRes = await api?.videoFinalExport?.scanVideoSource({
            requestId: `scan-video-${Date.now()}`,
            videoSource: source,
          })
          if (scanRes && scanRes.kind === 'video') {
            setVideoFileCount(scanRes.fileCount)
            setVideoTotalSec(scanRes.totalDurationSec)
            setVideoItems(scanRes.items || [])
          }
        } catch (err) {
          const detail = describeUnknownError(err)
          console.error('[FinalExportTab] scanVideoSource error', detail, err)
          setErrorMessage(`Không quét được video nguồn.\n${detail}\n${buildFinalExportFixHint(detail)}`)
        }
      } else if (target === 'image') {
        setImageSource(source)
        try {
          const scanRes = await api?.videoFinalExport?.scanImageSource?.({
            requestId: `scan-image-${Date.now()}`,
            imageSource: source,
            perImageDurationSec,
          })
          if (scanRes && scanRes.kind === 'image') {
            setImageFileCount(scanRes.fileCount)
            setImageTotalSec(scanRes.totalDurationSec)
            setImageItems(scanRes.items || [])
          }
        } catch (err) {
          const detail = describeUnknownError(err)
          console.error('[FinalExportTab] scanImageSource error', detail, err)
          setErrorMessage(`Không quét được ảnh nguồn.\n${detail}\n${buildFinalExportFixHint(detail)}`)
        }
      }
    } catch (error) {
      console.error('[FinalExportTab] handlePickSource error', error)
    }
  }

  const handleSelectOutputFolder = async () => {
    try {
      const folderPath = await api?.selectFolder?.()
      if (folderPath) {
        setOutputFolder(folderPath)
        setExportOutputs(null)
      }
    } catch (error) {
      console.error('[FinalExportTab] select output folder error', error)
    }
  }

  const handlePickEndingAudio = async () => {
    if (isExporting) return
    try {
      const paths: string[] | null = await api?.selectAudioFilesMulti?.()
      if (!paths || paths.length === 0) return
      const uniquePaths = Array.from(new Set(paths.filter(Boolean)))
      if (uniquePaths.length === 0) return
      const scanRes = await api?.videoFinalExport?.scanAudioSource({
        requestId: `scan-ending-audio-${Date.now()}`,
        audioSource: { type: 'files', path: uniquePaths[0], paths: uniquePaths },
      })
      if (scanRes && scanRes.kind === 'audio') {
        setEndingAudioPaths(uniquePaths)
        setEndingAudioItems(scanRes.items || [])
        setEndingAudioTotalSec(scanRes.totalDurationSec)
        setExportOutputs(null)
        setErrorMessage(null)
      }
    } catch (err) {
      const detail = describeUnknownError(err)
      console.error('[FinalExportTab] scan ending audio error', detail, err)
      setErrorMessage(`Không quét được nhạc cuối.\n${detail}\n${buildFinalExportFixHint(detail)}`)
    }
  }

  const clearEndingAudio = () => {
    if (isExporting) return
    setEndingAudioPaths([])
    setEndingAudioItems([])
    setEndingAudioTotalSec(null)
  }

  const handleSelectPriorityVideoFolder = async () => {
    if (isExporting) return
    try {
      const folderPath = await api?.selectFolder?.()
      if (!folderPath) return

      setUsePriorityVideos(true)
      setPriorityVideoFolder(folderPath)
      setPriorityVideoPaths([]) // Clear paths when selecting folder

      // Scan nhanh để hiển thị số lượng và thời lượng tổng
      try {
        const scanRes = await api?.videoFinalExport?.scanVideoSource({
          requestId: `scan-video-priority-${Date.now()}`,
          videoSource: { type: 'folder', path: folderPath },
        })
        if (scanRes && scanRes.kind === 'video') {
          setPriorityVideoCount(scanRes.fileCount)
          setPriorityVideoTotalSec(scanRes.totalDurationSec)
        } else {
          setPriorityVideoCount(null)
          setPriorityVideoTotalSec(null)
        }
      } catch (err) {
        console.error('[FinalExportTab] scan priority video folder error', err)
        setPriorityVideoCount(null)
        setPriorityVideoTotalSec(null)
      }
    } catch (error) {
      console.error('[FinalExportTab] select priority video folder error', error)
    }
  }

  const handleSelectPriorityVideos = async () => {
    if (isExporting) return
    try {
      const paths: string[] | null = await api?.selectManyVideos?.()
      if (!paths || !paths.length) return

      setUsePriorityVideos(true)
      setPriorityVideoPaths(paths)
      setPriorityVideoFolder(null) // Clear folder when selecting individual videos

      // Scan nhanh để hiển thị số lượng và thời lượng tổng
      try {
        const scanRes = await api?.videoFinalExport?.scanVideoSource({
          requestId: `scan-video-priority-${Date.now()}`,
          videoSource: { type: 'files', path: '', paths },
        })
        if (scanRes && scanRes.kind === 'video') {
          setPriorityVideoCount(scanRes.fileCount)
          setPriorityVideoTotalSec(scanRes.totalDurationSec)
        } else {
          setPriorityVideoCount(null)
          setPriorityVideoTotalSec(null)
        }
      } catch (err) {
        console.error('[FinalExportTab] scan priority videos error', err)
        setPriorityVideoCount(null)
        setPriorityVideoTotalSec(null)
      }
    } catch (error) {
      console.error('[FinalExportTab] select priority videos error', error)
    }
  }

  const handleOpenOutputFolder = async () => {
    if (!outputFolder) return
    try {
      await api?.openPath?.(outputFolder)
    } catch (error) {
      console.error('[FinalExportTab] open output folder error', error)
    }
  }

  const handleExport = () => {
    // Kiểm tra ref trước để tránh race condition khi user click nhanh nhiều lần
    if (isExportingRef.current) {
      console.warn('[FinalExportTab] Export đang chạy, bỏ qua request mới')
      return
    }
    if (!canExport || !audioSource || (!videoSource && !imageSource) || !outputFolder) return
    if (nameMismatch) {
      setErrorMessage('Số dòng tên output không khớp số job. Vui lòng nhập đủ hoặc để trống để dùng output_1..N.')
      return
    }
    if (strictFilesPairingCountMismatch) {
      setErrorMessage(
        `Tab 6 ghép cố định audio[i] với video[i]. Hiện có ${audioItems.length} audio và ${videoItems.length} video, cần bằng nhau mới xuất được.`
      )
      return
    }

    const requestId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `final-export-${Date.now()}`

    const payload = {
      requestId,
      audioSource,
      videoSource: videoSource || undefined,
      imageSource: imageSource || undefined,
      outputFolder,
      outputFilename,
      outputNames: parsedOutputNames.length > 0 ? parsedOutputNames : undefined,
      endingAudio: endingAudioPaths.length > 0 ? { paths: endingAudioPaths } : undefined,
      tracklists: undefined,
      tracklistAuto: tracklistEnabled,
      forceReencode,
      normalizeAudio,
      useGpuEncoding: useGpuEncoding !== 'auto' ? useGpuEncoding : undefined, // Only send if not 'auto' (default)
      priorityVideoSource:
        usePriorityVideos && (priorityVideoFolder || priorityVideoPaths.length > 0)
          ? priorityVideoFolder
          ? {
              type: 'folder' as const,
              path: priorityVideoFolder,
            }
            : {
                type: 'files' as const,
                path: '',
                paths: priorityVideoPaths,
              }
          : undefined,
      deleteSourceFiles, // Xóa file audio/video sau khi xuất xong
      chromaKeyOverlay: chromaKeyEnabled && chromaKeyVideoPath ? {
        enabled: true,
        videoPath: chromaKeyVideoPath,
        bgType: chromaKeyBgType,
        keyColor: chromaKeyColor,
        similarity: chromaKeySimilarity,
        blend: chromaKeyBlend,
        position: chromaKeyPosition,
        scale: chromaKeyScale,
      } : undefined,
      audioVisualizer: audioVisualizerEnabled ? buildAudioVisualizerOptions() : undefined,
      // Slideshow fields (only meaningful when imageSource present)
      perImageDurationSec: isSlideshowMode ? perImageDurationSec : undefined,
      imageAspectMode: isSlideshowMode ? imageAspectMode : undefined,
      imageTransition: isSlideshowMode ? imageTransition : undefined,
      imageKenBurns: isSlideshowMode ? imageKenBurns : undefined,
    }

    if (!api?.videoFinalExport?.start) {
      setErrorMessage('Final export backend chưa sẵn sàng.')
      setStatusText('Final export backend chưa sẵn sàng.')
      return
    }

    // Set ref ngay lập tức để tránh race condition
    isExportingRef.current = true
    setActiveRequestId(requestId)
    setIsExporting(true)
    // FIX C-01: Register with global export activity store
    useExportActivityStore.getState().registerExport(requestId, `Final Export: ${outputFilename || 'video'}`)
    setExportOutputs(null)
    setErrorMessage(null)
    setDiskSpaceError(null)
    setStatusText('Đang khởi tạo quy trình xuất video...')
    setUsedVideoCount(null)
    setConcatVideoDurationSec(null)
    setProgressState({
      percent: 0,
      timeSec: 0,
      totalDurationSec: undefined,
      speedX: undefined,
      etaSec: undefined,
      currentIndex: undefined,
      totalOutputs: audioFileCount ?? undefined,
      currentOutputFilename: undefined,
      currentAudioPath: undefined,
    })

    try {
      api.videoFinalExport.start(payload)
    } catch (error) {
      console.error('[FinalExportTab] Không thể gửi yêu cầu final export', error)
      isExportingRef.current = false
      setIsExporting(false)
      // FIX C-01: Unregister on start failure
      useExportActivityStore.getState().unregisterExport(requestId)
      const detail = describeUnknownError(error)
      setStatusText('Không thể khởi tạo job xuất video.')
      setErrorMessage(`Không thể khởi tạo job xuất video.\n${detail}\n${buildFinalExportFixHint(detail)}`)
      setActiveRequestId(null)
    }
  }

  const progressDescription = useMemo(() => {
    if (isExporting && progressState) {
      // PHASE 6: Progress theo job - jobIndex/totalJobs
      const jobIndex = progressState.currentIndex ?? 0
      const totalJobs = progressState.totalOutputs ?? 0
      const currentFile = progressState.currentOutputFilename
        ? getFileName(progressState.currentOutputFilename)
        : progressState.currentAudioPath
        ? getFileName(progressState.currentAudioPath)
        : null

      // Header: "Đang xuất video X/Y: filename"
      const headerParts: string[] = []
      if (totalJobs > 0 && jobIndex > 0) {
        headerParts.push(`Đang xuất video ${jobIndex}/${totalJobs}`)
      }
      if (currentFile) {
        headerParts.push(currentFile)
      }
      const header =
        headerParts.length > 0
          ? `${headerParts.join(': ')} – ${progressState.percent.toFixed(0)}%`
          : `Đang xuất video… ${progressState.percent.toFixed(0)}%`

      // Detail: time, speed, ETA
      const detailParts: string[] = []
      if (
        typeof progressState.timeSec === 'number' &&
        typeof progressState.totalDurationSec === 'number' &&
        progressState.totalDurationSec > 0
      ) {
        detailParts.push(
          `${formatSeconds(progressState.timeSec)} / ${formatSeconds(progressState.totalDurationSec)}`
        )
      } else if (typeof progressState.timeSec === 'number') {
        detailParts.push(`đã chạy: ${formatSeconds(progressState.timeSec)}`)
      }
      if (typeof progressState.speedX === 'number') {
        detailParts.push(`~${progressState.speedX.toFixed(1)}x`)
      }
      if (typeof progressState.etaSec === 'number') {
        detailParts.push(`ETA ${formatSeconds(progressState.etaSec)}`)
      }

      return detailParts.length > 0 ? `${header} • ${detailParts.join(' • ')}` : header
    }
    if (!isExporting && exportOutputs && exportOutputs.length > 0) {
      if (exportOutputs.length === 1) {
        const first = exportOutputs[0]
        return `Đã xuất xong 1 video: ${getFileName(first.outputFile || first.videoFile)} (${formatSeconds(
          first.durationSec
        )}). Video đã được ghép/loop để khớp 100% audio.`
      }
      return `Đã xuất xong ${exportOutputs.length} video (mỗi video khớp với 1 file audio tương ứng).`
    }
    return 'Chưa bắt đầu xuất video.'
  }, [isExporting, progressState, exportOutputs])

  const renderAVRelation = () => {
    if (audioItems.length > 0 && videoItems.length > 0) {
      if (audioItems.length !== videoItems.length) {
        // Chỉ cảnh báo khi ở files mode (strict 1-1) — folder mode cho phép số lượng khác nhau
        if (videoSource?.type === 'files') {
          return (
            <div style={{ color: '#ffaa66' }}>
              Cảnh báo: Số lượng không khớp: {audioItems.length} audio vs {videoItems.length} video.
              Chế độ ghép file yêu cầu số lượng bằng nhau để ghép 1-1.
            </div>
          )
        }
        return (
          <div style={{ color: '#9fcf9f' }}>
            {audioItems.length} audio + {videoItems.length} video — Chế độ thư mục: video sẽ được tự động ghép theo pool.
          </div>
        )
      }
      return (
        <div style={{ color: '#9fcf9f' }}>
          OK: Số lượng khớp: {audioItems.length} audio + {videoItems.length} video → {audioItems.length} videos (1-1 mapping)
        </div>
      )
    }
    return null
  }
  
  const renderSourceStatus = (
    source: SelectedSource | null | undefined,
    emptyText: string,
    count: number | null
  ) => {
    if (source == null) return emptyText
    if (source.type === 'file') {
      const suffix = typeof count === 'number' ? ` (số file: ${count})` : ''
      return `Đã chọn file: ${getFileName(source.path)}${suffix}`
    }
  if (source.type === 'files') {
    const total = (source.paths?.length ?? count ?? 0) || 0
    return `Đã chọn ${total} file (từ hộp thoại).`
  }
    const suffix = typeof count === 'number' ? `(số file: ${count})` : '(số file: —)'
    return `Đã chọn thư mục: ${source.path} ${suffix}`
  }

  const planSummaryText = useMemo(() => {
    // PHASE 6: Summary "N audio → N video" với 1-1 mapping
    if (!audioItems.length || !videoItems.length) {
      return 'Chưa chọn đủ playlist audio và clips video để lập kế hoạch xuất.'
    }

    const endingText = endingAudioPerJobSec > 0
      ? ` + nhạc cuối ${formatSeconds(endingAudioPerJobSec)}/job`
      : ''

    // Chỉ cảnh báo count mismatch khi CÙNG chọn files riêng lẻ (type=files)
    // Khi video source là folder thì backend loop clips — không cần match 1-1
    const videoIsFolder = videoSource?.type === 'folder'
    if (!videoIsFolder && audioItems.length !== videoItems.length) {
      return `Cảnh báo: Số lượng audio (${audioItems.length}) và video (${videoItems.length}) không khớp. Tab 6 yêu cầu số lượng bằng nhau để ghép 1-1.`
    }

    if (audioItems.length === 1) {
      return `Sẽ xuất 1 video: audio[1]${endingText} + video[1] → output.mp4 (1-1 mapping)`
    }
    return `Sẽ xuất ${audioItems.length} video với mapping 1-1: audio[i]${endingText} + video[i] → output_i.mp4`
  }, [audioItems, videoItems, videoSource, endingAudioPerJobSec])

  const renderAudioPreview = () => {
    if (!audioItems.length) return null
    const preview = audioItems.slice(0, AUDIO_PREVIEW_LIMIT)
    return (
      <div style={{ marginTop: '12px', fontSize: '12px', color: '#dcdcdc' }}>
        <div style={{ fontWeight: 600, marginBottom: '6px' }}>
          Các track audio ({audioItems.length} file):
        </div>
        <div
          style={{
            maxHeight: '220px',
            overflowY: 'auto',
            border: '1px solid #333',
            borderRadius: '6px',
            padding: '8px',
            background: '#1b1b1b',
          }}
        >
          {preview.map((item) => (
            <div key={item.path} style={{ marginBottom: '4px' }}>
              {getFileName(item.path)} – {formatSeconds(item.durationSec)}
            </div>
          ))}
          {audioItems.length > preview.length && (
            <div style={{ color: '#9f9f9f', marginTop: '4px' }}>
              … và {audioItems.length - preview.length} file khác
            </div>
          )}
        </div>
        <div style={{ marginTop: '6px', color: '#9f9f9f' }}>
          Tổng: {audioItems.length} files – {audioTotalSec != null ? formatSeconds(audioTotalSec) : '--:--'}
        </div>
      </div>
    )
  }

  const renderVideoPreview = () => {
    if (!videoItems.length) return null
    const preview = videoItems.slice(0, VIDEO_PREVIEW_LIMIT)
    return (
      <div style={{ marginTop: '12px', fontSize: '12px', color: '#dcdcdc' }}>
        <div style={{ fontWeight: 600, marginBottom: '6px' }}>
          Clips video ({videoItems.length} file):
        </div>
        <div
          style={{
            maxHeight: '220px',
            overflowY: 'auto',
            border: '1px solid #333',
            borderRadius: '6px',
            padding: '8px',
            background: '#1b1b1b',
          }}
        >
          {preview.map((item) => (
            <div key={item.path} style={{ marginBottom: '4px' }}>
              {getFileName(item.path)} – {formatSeconds(item.durationSec)}
            </div>
          ))}
          {videoItems.length > preview.length && (
            <div style={{ color: '#9f9f9f', marginTop: '4px' }}>
              … và {videoItems.length - preview.length} clip khác
            </div>
          )}
        </div>
        <div style={{ marginTop: '6px', color: '#9f9f9f' }}>
          Tổng: {videoItems.length} clip – {videoTotalSec != null ? formatSeconds(videoTotalSec) : '--:--'}
        </div>
      </div>
    )
  }

  const renderOutputsPreview = () => {
    if (!exportOutputs || exportOutputs.length === 0) return null
    const preview = exportOutputs.slice(0, OUTPUT_PREVIEW_LIMIT)
    return (
      <div style={{ marginTop: '8px' }}>
        {preview.map((output) => (
          <div key={output.videoFile || output.outputFile} style={{ marginBottom: '4px' }}>
            {getFileName(output.outputFile || output.videoFile)} – {formatSeconds(output.durationSec)}
            {output.tracklistFile && (
              <span style={{ color: '#9f9f9f', marginLeft: '6px', fontSize: '12px' }}>
                (tracklist: {getFileName(output.tracklistFile)})
              </span>
            )}
          </div>
        ))}
        {exportOutputs.length > preview.length && (
          <div style={{ color: '#9f9f9f' }}>… và {exportOutputs.length - preview.length} video khác</div>
        )}
      </div>
    )
  }

  const clearAudioSelection = () => {
    if (isExporting) return
    setAudioSource(null)
    setAudioItems([])
    setAudioFileCount(null)
    setAudioTotalSec(null)
  }

  const clearVideoSelection = () => {
    if (isExporting) return
    setVideoSource(null)
    setVideoItems([])
    setVideoFileCount(null)
    setVideoTotalSec(null)
  }

  return (
    <div style={{ padding: '24px', color: '#e0e0e0', backgroundColor: '#1e1e1e', minHeight: '100%' }}>
      <h2 style={{ marginBottom: '8px', fontSize: '24px', fontWeight: 'bold' }}>Xuất video hoàn chỉnh</h2>
      <p style={{ marginBottom: '24px', color: '#b0b0b0', fontSize: '14px' }}>
        Playlist audio và clips đã có sẵn. Bước này đảm bảo video xuất ra khớp 100% với thời lượng audio.
      </p>

      <div style={{ ...cardStyle, paddingBottom: '8px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '16px' }}>1. Chọn nguồn</h3>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', backgroundColor: '#252525', borderRadius: '8px', padding: '16px', border: '1px solid #333' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>Audio / Playlist đã tạo</div>
            <button
              onClick={() => setActivePicker((prev) => (prev === 'audio' ? null : 'audio'))}
              style={{ ...buttonStyle, width: '100%' }}
              disabled={isExporting}
            >
              Chọn playlist (file hoặc thư mục)
            </button>
            {activePicker === 'audio' && (
              <div style={pickerMenuStyle}>
                <button
                  onClick={() => handlePickSource('audio', 'file')}
                  style={{ ...buttonStyle, backgroundColor: '#005fa3' }}
                >
                  Chọn file audio
                </button>
                <button
                  onClick={() => handlePickSource('audio', 'folder')}
                  style={{ ...buttonStyle, backgroundColor: '#444' }}
                >
                  Chọn thư mục audio
                </button>
              </div>
            )}
            <div style={{ marginTop: '12px', fontSize: '14px', color: audioSource ? '#fff' : '#b0b0b0' }}>
              {renderSourceStatus(audioSource, 'Chưa chọn playlist.', audioFileCount)}
            </div>
            {audioSource && (
              <button
                onClick={clearAudioSelection}
                style={{ marginTop: '8px', ...buttonStyle, backgroundColor: '#444' }}
                disabled={isExporting}
              >
                Xóa danh sách audio
              </button>
            )}
            <div style={{ marginTop: '6px', fontSize: '12px', color: '#9f9f9f' }}>
              {audioTotalSec != null
                ? `Tổng thời lượng audio chính: ${formatSeconds(audioTotalSec)}`
                : 'Thời lượng video xuất ra sẽ khớp 100% với tổng thời lượng audio.'}
            </div>
            {endingAudioPaths.length > 0 && (
              <div style={{ marginTop: '6px', fontSize: '12px', color: '#ffcc88' }}>
                Nhạc cuối: {endingAudioItems.length || endingAudioPaths.length} file • {formatSeconds(endingAudioPerJobSec)}/job
                {totalExportAudioSec != null && ` • tổng dự kiến ${formatSeconds(totalExportAudioSec)}`}
              </div>
            )}
            {renderAudioPreview()}
            <div style={{ marginTop: '10px', padding: '8px', borderRadius: '6px', backgroundColor: '#2b2418', border: '1px solid #5c4520' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#ffcc88', marginBottom: '6px' }}>
                Nhạc nối cuối mỗi video (tùy chọn)
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handlePickEndingAudio}
                  style={{ ...buttonStyle, padding: '6px 10px', fontSize: '12px', backgroundColor: '#9a6a16' }}
                  disabled={isExporting}
                >
                  Chọn file nhạc cuối
                </button>
                {endingAudioPaths.length > 0 && (
                  <button
                    type="button"
                    onClick={clearEndingAudio}
                    style={{ ...buttonStyle, padding: '6px 10px', fontSize: '12px', backgroundColor: '#444' }}
                    disabled={isExporting}
                  >
                    Xóa nhạc cuối
                  </button>
                )}
              </div>
              <div style={{ marginTop: '6px', fontSize: '11px', color: '#c9ad75' }}>
                File này được nối sau từng audio job, không tạo thêm video riêng.
              </div>
              {endingAudioPaths.length > 0 && (
                <div style={{ marginTop: '6px', fontSize: '11px', color: '#d7c39a', wordBreak: 'break-all' }}>
                  {endingAudioPaths.map(getFileName).join(', ')}
                </div>
              )}
            </div>
          </div>

          <div style={{ flex: '1 1 320px', backgroundColor: '#252525', borderRadius: '8px', padding: '16px', border: '1px solid #333' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>Thư mục chứa video clips / ảnh</div>
            <button
              onClick={() => setActivePicker((prev) => (prev === 'video' ? null : 'video'))}
              style={{ ...buttonStyle, width: '100%' }}
              disabled={isExporting}
            >
              Chọn video / ảnh (file hoặc thư mục)
            </button>
            {activePicker === 'video' && (
              <div style={pickerMenuStyle}>
                <button
                  onClick={() => handlePickSource('video', 'file-single')}
                  style={{ ...buttonStyle, backgroundColor: '#005fa3' }}
                >
                  Chọn 1 file video
                </button>
                <button
                  onClick={() => handlePickSource('video', 'file')}
                  style={{ ...buttonStyle, backgroundColor: '#005a9e' }}
                >
                  Chọn nhiều file video
                </button>
                <button
                  onClick={() => handlePickSource('video', 'folder')}
                  style={{ ...buttonStyle, backgroundColor: '#444' }}
                >
                  Chọn thư mục video
                </button>
                <div style={{ height: '1px', backgroundColor: '#3d3d3d', margin: '6px 0' }} />
                <button
                  onClick={() => handlePickSource('image', 'file')}
                  style={{ ...buttonStyle, backgroundColor: '#16a34a' }}
                >
                  Chọn nhiều file ảnh
                </button>
                <button
                  onClick={() => handlePickSource('image', 'folder')}
                  style={{ ...buttonStyle, backgroundColor: '#15803d' }}
                >
                  Chọn thư mục ảnh
                </button>
              </div>
            )}
            <div style={{ marginTop: '12px', fontSize: '14px', color: (videoSource || imageSource) ? '#fff' : '#b0b0b0' }}>
              {videoSource
                ? renderSourceStatus(videoSource, 'Chưa chọn clips.', videoFileCount)
                : imageSource
                ? renderSourceStatus(imageSource, 'Chưa chọn ảnh.', imageFileCount)
                : 'Chưa chọn video hoặc ảnh.'}
            </div>
            {(videoSource || imageSource) && (
              <button
                onClick={() => {
                  if (videoSource) clearVideoSelection()
                  if (imageSource) {
                    setImageSource(null)
                    setImageItems([])
                    setImageFileCount(null)
                    setImageTotalSec(null)
                  }
                }}
                style={{ marginTop: '8px', ...buttonStyle, backgroundColor: '#444' }}
                disabled={isExporting}
              >
                Xóa danh sách
              </button>
            )}
            <div style={{ marginTop: '6px', fontSize: '12px', color: '#9f9f9f' }}>
              {videoTotalSec != null
                ? `Tổng thời lượng video clips: ${formatSeconds(videoTotalSec)}`
                : imageTotalSec != null
                ? `Tổng thời lượng ảnh (ước tính): ${formatSeconds(imageTotalSec)}`
                : 'Chọn video (ghép 1-1) hoặc ảnh (slideshow).'}
            </div>
            {/* Video ưu tiên */}
            <div style={{ marginTop: '10px', padding: '8px', borderRadius: '6px', backgroundColor: '#1f2933', border: '1px solid #374151' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={usePriorityVideos}
                  disabled={isExporting}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setUsePriorityVideos(checked)
                    if (!checked) {
                      setPriorityVideoFolder(null)
                      setPriorityVideoPaths([])
                      setPriorityVideoCount(null)
                      setPriorityVideoTotalSec(null)
                    } else {
                      // Reset khi bật lại
                      setPriorityVideoFolder(null)
                      setPriorityVideoPaths([])
                      setPriorityVideoCount(null)
                      setPriorityVideoTotalSec(null)
                    }
                  }}
                />
                <span>Video ưu tiên (luôn xuất hiện trước)</span>
              </label>
              {usePriorityVideos && (
                <div style={{ marginTop: '6px', fontSize: '12px', color: '#d1d5db' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      readOnly
                        value={
                          priorityVideoFolder
                            ? `Thư mục: ${priorityVideoFolder}`
                            : priorityVideoPaths.length > 0
                            ? `Đã chọn ${priorityVideoPaths.length} video`
                            : 'Chưa chọn video ưu tiên'
                        }
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        backgroundColor: '#111827',
                        borderRadius: '4px',
                        border: '1px solid #374151',
                        color: '#e5e7eb',
                        fontSize: '12px',
                      }}
                    />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={handleSelectPriorityVideoFolder}
                      disabled={isExporting}
                      style={{
                          flex: 1,
                        ...buttonStyle,
                        padding: '6px 10px',
                        fontSize: '12px',
                        backgroundColor: '#2563eb',
                      }}
                    >
                        Chọn thư mục
                    </button>
                      <button
                        onClick={handleSelectPriorityVideos}
                        disabled={isExporting}
                        style={{
                          flex: 1,
                          ...buttonStyle,
                          padding: '6px 10px',
                          fontSize: '12px',
                          backgroundColor: '#2563eb',
                        }}
                      >
                        Chọn video
                      </button>
                      {(priorityVideoFolder || priorityVideoPaths.length > 0) && (
                        <button
                          onClick={() => {
                            setPriorityVideoFolder(null)
                            setPriorityVideoPaths([])
                            setPriorityVideoCount(null)
                            setPriorityVideoTotalSec(null)
                          }}
                          disabled={isExporting}
                          style={{
                            padding: '6px 10px',
                            fontSize: '12px',
                            backgroundColor: '#dc3545',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: isExporting ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Xóa
                        </button>
                      )}
                    </div>
                  </div>
                  {priorityVideoCount != null && (
                    <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                      Đã quét: {priorityVideoCount} clip ưu tiên
                      {priorityVideoTotalSec != null && ` – tổng ${formatSeconds(priorityVideoTotalSec)}`}.
                    </div>
                  )}
                  <div style={{ marginTop: '4px', fontSize: '11px', color: '#9ca3af' }}>
                    Các clip trong thư mục ưu tiên hoặc video đã chọn sẽ luôn được ghép ở phần đầu mỗi video. Phần thời lượng còn lại sẽ được
                    lấp bằng các clip còn lại từ thư mục clips.
                  </div>
                </div>
              )}
            </div>
            {renderVideoPreview()}
          </div>
        </div>
        <div style={{ marginTop: '12px', fontSize: '12px', color: '#b0b0b0' }}>{renderAVRelation()}</div>
        <div style={{ marginTop: '6px', fontSize: '13px', color: '#d0d0d0', lineHeight: 1.5 }}>
          {planSummaryText}
        </div>
        {audioFileCount != null && audioTotalSec != null && (
          <div style={{ marginTop: '4px', fontSize: '12px', color: '#9f9f9f' }}>
            Audio job: {audioFileCount} file, chính {formatSeconds(audioTotalSec)}
            {endingAudioPerJobSec > 0 && ` + nhạc cuối ${formatSeconds(endingAudioPerJobSec)}/job`}
            {totalExportAudioSec != null && ` = tổng ${formatSeconds(totalExportAudioSec)}`}.
          </div>
        )}
        {usedVideoCount != null && concatVideoDurationSec != null && (
          <div style={{ marginTop: '2px', fontSize: '12px', color: '#9f9f9f' }}>
            Video job: dùng {usedVideoCount} clip, tổng {formatSeconds(concatVideoDurationSec)}.
          </div>
        )}
      </div>

      {/* Chroma Key Overlay */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '16px' }}>
          Chroma Key Overlay
        </h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={chromaKeyEnabled}
            onChange={(e) => setChromaKeyEnabled(e.target.checked)}
            disabled={isExporting}
          />{' '}
          Chèn video phông xanh/đen lên video
        </label>
        <div style={{ marginTop: '4px', fontSize: '12px', color: '#9f9f9f' }}>
          Tách nền video phông xanh hoặc đen, đè lên video hoàn chỉnh khi xuất.
        </div>

        {chromaKeyEnabled && (
          <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Chọn video */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button
                style={{ ...buttonStyle, minWidth: '200px' }}
                disabled={isExporting}
                onClick={async () => {
                  const path: string | null = await api?.selectVideoFile?.()
                  if (path) {
                    setChromaKeyVideoPath(path)
                    setChromaKeyPreviewUrl(null)
                  }
                }}
              >
                Chon video overlay
              </button>
              <span style={{ fontSize: '13px', color: chromaKeyVideoPath ? '#aee' : '#888', wordBreak: 'break-all', maxWidth: '350px' }}>
                {chromaKeyVideoPath ? getFileName(chromaKeyVideoPath) : 'Chua chon video'}
              </span>
            </div>

            {/* Loai nen */}
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>Loai nen:</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="chromaKeyBgType"
                  checked={chromaKeyBgType === 'green'}
                  onChange={() => { setChromaKeyBgType('green'); setChromaKeyColor('#00FF00'); setChromaKeyPreviewUrl(null) }}
                  disabled={isExporting}
                />
                <span style={{ color: '#4ade80' }}>Phong xanh</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="chromaKeyBgType"
                  checked={chromaKeyBgType === 'black'}
                  onChange={() => { setChromaKeyBgType('black'); setChromaKeyColor('#000000'); setChromaKeyPreviewUrl(null) }}
                  disabled={isExporting}
                />
                <span style={{ color: '#aaa' }}>Phong den</span>
              </label>
            </div>

            {/* Cai dat tach nen */}
            <div style={{ border: '1px solid #3d3d3d', borderRadius: '6px', padding: '12px', backgroundColor: '#1e1e1e' }}>
              <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '10px' }}>Cai dat tach nen:</div>

              {/* Mau nen */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <span style={{ fontSize: '13px', minWidth: '100px' }}>Mau nen:</span>
                <input
                  type="color"
                  value={chromaKeyColor}
                  onChange={(e) => { setChromaKeyColor(e.target.value); setChromaKeyPreviewUrl(null) }}
                  disabled={isExporting}
                  style={{ width: '36px', height: '28px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer' }}
                />
                <input
                  type="text"
                  value={chromaKeyColor}
                  onChange={(e) => {
                    const v = e.target.value
                    if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) { setChromaKeyColor(v); setChromaKeyPreviewUrl(null) }
                  }}
                  disabled={isExporting}
                  style={{
                    width: '90px', padding: '4px 8px', borderRadius: '4px',
                    border: '1px solid #555', backgroundColor: '#2a2a2a', color: '#fff', fontSize: '13px',
                  }}
                />
              </div>

              {/* Tolerance */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', minWidth: '100px' }}>Tolerance:</span>
                <input
                  type="range" min={0.01} max={1.0} step={0.01}
                  value={chromaKeySimilarity}
                  onChange={(e) => { setChromaKeySimilarity(parseFloat(e.target.value)); setChromaKeyPreviewUrl(null) }}
                  disabled={isExporting} style={{ flex: 1 }}
                />
                <span style={{ fontSize: '13px', color: '#aee', minWidth: '40px', textAlign: 'right' }}>
                  {chromaKeySimilarity.toFixed(2)}
                </span>
              </div>

              {/* Smoothing */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', minWidth: '100px' }}>Smoothing:</span>
                <input
                  type="range" min={0.0} max={1.0} step={0.01}
                  value={chromaKeyBlend}
                  onChange={(e) => { setChromaKeyBlend(parseFloat(e.target.value)); setChromaKeyPreviewUrl(null) }}
                  disabled={isExporting} style={{ flex: 1 }}
                />
                <span style={{ fontSize: '13px', color: '#aee', minWidth: '40px', textAlign: 'right' }}>
                  {chromaKeyBlend.toFixed(2)}
                </span>
              </div>

              {/* Scale */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', minWidth: '100px' }}>Ti le:</span>
                <input
                  type="range" min={0.1} max={2.0} step={0.05}
                  value={chromaKeyScale}
                  onChange={(e) => { setChromaKeyScale(parseFloat(e.target.value)); setChromaKeyPreviewUrl(null) }}
                  disabled={isExporting} style={{ flex: 1 }}
                />
                <span style={{ fontSize: '13px', color: '#aee', minWidth: '55px', textAlign: 'right' }}>
                  {(chromaKeyScale * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            {/* Vi tri: 2 nut */}
            <div>
              <span style={{ fontWeight: 600, fontSize: '13px', marginRight: '12px' }}>Vi tri:</span>
              {(['center', 'bottom'] as const).map((pos) => (
                <button
                  key={pos}
                  onClick={() => { setChromaKeyPosition(pos); setChromaKeyPreviewUrl(null) }}
                  disabled={isExporting}
                  style={{
                    ...buttonStyle,
                    padding: '6px 16px',
                    fontSize: '13px',
                    marginRight: '8px',
                    backgroundColor: chromaKeyPosition === pos ? '#007acc' : '#444',
                    border: chromaKeyPosition === pos ? '2px solid #3ba0e6' : '2px solid transparent',
                  }}
                >
                  {pos === 'center' ? 'Chinh giua' : 'Phia duoi'}
                </button>
              ))}
            </div>

            {/* Preview */}
            <div>
              <button
                style={{
                  ...buttonStyle,
                  backgroundColor: chromaKeyPreviewing ? '#555' : '#1e6b3a',
                  minWidth: '160px',
                }}
                disabled={isExporting || chromaKeyPreviewing || !chromaKeyVideoPath || !videoSource}
                onClick={async () => {
                  if (!chromaKeyVideoPath || !videoSource) return
                  setChromaKeyPreviewing(true)
                  setChromaKeyPreviewUrl(null)
                  try {
                    // Lay 1 video tu nguon lam background
                    let bgPath = ''
                    if (videoSource.type === 'file') {
                      bgPath = videoSource.path
                    } else if (videoSource.type === 'files' && videoSource.paths && videoSource.paths.length > 0) {
                      bgPath = videoSource.paths[0]
                    } else if (videoSource.type === 'folder') {
                      // Lay file dau tien trong folder
                      const items = await api?.listVideosInFolderSimple?.(videoSource.path)
                      if (items && items.length > 0) bgPath = items[0]
                    }
                    if (!bgPath) {
                      setChromaKeyPreviewing(false)
                      return
                    }
                    const result = await api?.chromaKeyPreview?.({
                      bgVideoPath: bgPath,
                      overlayVideoPath: chromaKeyVideoPath,
                      bgType: chromaKeyBgType,
                      keyColor: chromaKeyColor,
                      similarity: chromaKeySimilarity,
                      blend: chromaKeyBlend,
                      position: chromaKeyPosition,
                      scale: chromaKeyScale,
                    })
                    if (result?.ok && result.previewPath) {
                      // Dung app:// protocol de hien thi anh
                      setChromaKeyPreviewUrl(`app://local-file/?path=${encodeURIComponent(result.previewPath)}`)
                    }
                  } catch (err) {
                    console.error('[ChromaKey] Preview error', err)
                  } finally {
                    setChromaKeyPreviewing(false)
                  }
                }}
              >
                {chromaKeyPreviewing ? 'Dang tao preview...' : 'Xem thu (Preview)'}
              </button>
              {!videoSource && chromaKeyVideoPath && (
                <span style={{ fontSize: '12px', color: '#f59e0b', marginLeft: '10px' }}>
                  Chon nguon video truoc de xem preview
                </span>
              )}
            </div>

            {/* Preview image */}
            {chromaKeyPreviewUrl && (
              <div style={{ marginTop: '4px', border: '1px solid #3d3d3d', borderRadius: '6px', overflow: 'hidden', backgroundColor: '#111' }}>
                <img
                  src={chromaKeyPreviewUrl}
                  alt="Chroma Key Preview"
                  style={{ width: '100%', maxHeight: '360px', objectFit: 'contain', display: 'block' }}
                  onError={() => setChromaKeyPreviewUrl(null)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '16px' }}>2. Thư mục & tên file xuất</h3>
        <button
          onClick={handleSelectOutputFolder}
          style={{ ...buttonStyle, minWidth: '220px', marginBottom: '12px' }}
          disabled={isExporting}
        >
          Chọn thư mục xuất...
        </button>
        <div style={{ marginBottom: '16px', fontSize: '14px', color: outputFolder ? '#fff' : '#b0b0b0' }}>
          {outputFolder ? `Thư mục xuất: ${outputFolder}` : 'Chưa chọn thư mục xuất.'}
        </div>
        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}>Tên file output</label>
        <input
          type="text"
          value={outputFilename}
          onChange={(e) => setOutputFilename(e.target.value)}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '6px',
            border: '1px solid #555',
            backgroundColor: '#1a1a1a',
            color: '#e0e0e0',
          }}
          disabled={isExporting || multipleAudio}
        />
        {multipleAudio ? (
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#ffcd7a' }}>
            Đang chọn {audioItems.length} audio ⇒ công cụ sẽ tạo {audioItems.length} video, mỗi video lấy tên theo
            file audio tương ứng (ví dụ: <code>a1.wav</code> → <code>a1.mp4</code>). Ô tên file chỉ áp dụng khi có 1
            audio.
          </div>
        ) : (
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#9f9f9f' }}>
            Khi chỉ có 1 audio, video xuất ra sẽ dùng đúng tên file này.
          </div>
        )}

        {/* Nhiều tên output (tùy chọn) */}
        <div style={{ marginTop: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}>
            Tên file output (mỗi dòng một tên, tùy chọn)
          </label>
          <textarea
            value={outputNamesText}
            onChange={(e) => setOutputNamesText(e.target.value)}
            placeholder="Ví dụ:\nshow_1\nshow_2\nshow_3"
            disabled={isExporting || singleAudioVideo}
            rows={4}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '6px',
              border: '1px solid #555',
              backgroundColor: '#1a1a1a',
              color: '#e0e0e0',
            }}
          />
          <div style={{ marginTop: '6px', fontSize: '12px', color: nameMismatch ? '#ff9b9b' : '#9f9f9f' }}>
            {singleAudioVideo ? (
              <span style={{ color: '#ffcd7a' }}>
                Chỉ có 1 audio và 1 video → dùng tên file ở trên. Ô này chỉ áp dụng khi có nhiều audio/video.
              </span>
            ) : audioItems.length > 0 ? (
              `Đang có ${audioItems.length} job. Nhập đúng ${audioItems.length} dòng (hoặc để trống để dùng output_1..N).`
            ) : (
              'Mỗi dòng sẽ tương ứng 1 video. Để trống để dùng output_1..N.'
            )}
          </div>
          {nameMismatch && (
            <div style={{ marginTop: '4px', fontSize: '12px', color: '#ff9b9b' }}>
              Số dòng không khớp số job. Nhập đủ hoặc xóa nội dung để dùng output_1..N.
            </div>
          )}
        </div>

        {/* Tracklist */}
        <div style={{ marginTop: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={tracklistEnabled}
              onChange={(e) => setTracklistEnabled(e.target.checked)}
              disabled={isExporting}
            />{' '}
            Xuất tracklist tự động (từ audio đã xuất - Tab 4)
          </label>
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#9f9f9f' }}>
            Nếu audio nguồn khớp với file đã export ở Tab 4, tracklist sẽ được tự tạo (mm:ss + tên bài) và lưu cạnh video.
          </div>
        </div>
        <div style={{ marginTop: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={normalizeAudio}
              onChange={(e) => setNormalizeAudio(e.target.checked)}
              disabled={isExporting}
            />{' '}
            Chuẩn hoá âm lượng (audio)
          </label>
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#9f9f9f' }}>
            Tự động cân bằng âm lượng giữa các video để đảm bảo chất lượng âm thanh đồng đều.
            Bật tùy chọn này sẽ làm chậm quá trình xuất video nhưng đảm bảo chất lượng âm thanh tốt hơn.
          </div>
        </div>
        <div style={{ marginTop: '16px', padding: '12px', border: '1px solid #374151', borderRadius: '6px', backgroundColor: '#111827' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={audioVisualizerEnabled}
              onChange={(e) => {
                setAudioVisualizerEnabled(e.target.checked)
                setAudioVisualizerPreviewUrl(null)
              }}
              disabled={isExporting}
            />{' '}
            Hiển thị sóng nhạc
          </label>
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#9f9f9f', lineHeight: 1.5 }}>
            Vẽ phổ hoặc đường sóng nhạc từ audio lên video hoặc slideshow ảnh khi xuất. Khi bật, video sẽ được re-encode nên có thể chậm hơn.
          </div>
          {audioVisualizerEnabled && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={{ fontSize: '12px', color: '#d1d5db', display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '360px' }}>
                Kiểu sóng nhạc
                <select
                  value={audioVisualizerPreset}
                  disabled={isExporting}
                  onChange={(e) => {
                    setAudioVisualizerPreset(e.target.value as FinalExportVisualizerPreset)
                    setAudioVisualizerPreviewUrl(null)
                  }}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #4b5563',
                    backgroundColor: '#1f2937',
                    color: '#f3f4f6',
                    fontSize: '13px',
                  }}
                >
                  {AUDIO_VISUALIZER_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>{preset.label} — {preset.hint}</option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>Vị trí:</span>
                {(['bottom', 'center', 'top'] as const).map((pos) => (
                  <button
                    key={pos}
                    onClick={() => { setAudioVisualizerPosition(pos); setAudioVisualizerPreviewUrl(null) }}
                    disabled={isExporting}
                    style={{
                      ...buttonStyle,
                      padding: '5px 12px',
                      fontSize: '12px',
                      backgroundColor: audioVisualizerPosition === pos ? '#2563eb' : '#374151',
                    }}
                  >
                    {pos === 'bottom' ? 'Dưới' : pos === 'center' ? 'Giữa' : 'Trên'}
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                <label style={{ fontSize: '12px', color: '#d1d5db' }}>
                  Chiều rộng: {audioVisualizerWidthPercent}%
                  <NumericDraftInput
                    min={10}
                    max={100}
                    step={1}
                    integer
                    value={audioVisualizerWidthPercent}
                    disabled={isExporting}
                    onCommit={(value) => { if (typeof value === 'number') { setAudioVisualizerWidthPercent(value); setAudioVisualizerPreviewUrl(null) } }}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #4b5563', backgroundColor: '#1f2937', color: '#f3f4f6' }}
                  />
                </label>
                <label style={{ fontSize: '12px', color: '#d1d5db' }}>
                  Chiều cao: {audioVisualizerHeightPercent}%
                  <NumericDraftInput
                    min={5}
                    max={60}
                    step={1}
                    integer
                    value={audioVisualizerHeightPercent}
                    disabled={isExporting}
                    onCommit={(value) => { if (typeof value === 'number') { setAudioVisualizerHeightPercent(value); setAudioVisualizerPreviewUrl(null) } }}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #4b5563', backgroundColor: '#1f2937', color: '#f3f4f6' }}
                  />
                </label>
                <label style={{ fontSize: '12px', color: '#d1d5db' }}>
                  Cách mép: {audioVisualizerMarginBottomPx}px
                  <NumericDraftInput
                    min={0}
                    max={400}
                    step={4}
                    integer
                    value={audioVisualizerMarginBottomPx}
                    disabled={isExporting}
                    onCommit={(value) => { if (typeof value === 'number') { setAudioVisualizerMarginBottomPx(value); setAudioVisualizerPreviewUrl(null) } }}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #4b5563', backgroundColor: '#1f2937', color: '#f3f4f6' }}
                  />
                </label>
                <label style={{ fontSize: '12px', color: '#d1d5db' }}>
                  Độ trong suốt: {Math.round(audioVisualizerOpacity * 100)}%
                  <NumericDraftInput
                    min={0.1}
                    max={1}
                    step={0.01}
                    value={audioVisualizerOpacity}
                    disabled={isExporting}
                    onCommit={(value) => { if (typeof value === 'number') { setAudioVisualizerOpacity(value); setAudioVisualizerPreviewUrl(null) } }}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #4b5563', backgroundColor: '#1f2937', color: '#f3f4f6' }}
                  />
                </label>
                <label style={{ fontSize: '12px', color: '#d1d5db' }}>
                  Số cột / độ mịn: {audioVisualizerBarCount}
                  <NumericDraftInput
                    min={64}
                    max={1024}
                    step={16}
                    integer
                    value={audioVisualizerBarCount}
                    disabled={isExporting}
                    onCommit={(value) => { if (typeof value === 'number') { setAudioVisualizerBarCount(value); setAudioVisualizerPreviewUrl(null) } }}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #4b5563', backgroundColor: '#1f2937', color: '#f3f4f6' }}
                  />
                </label>
                <label style={{ fontSize: '12px', color: '#d1d5db' }}>
                  Độ nhạy / Beat boost: {audioVisualizerSensitivity.toFixed(1)}x
                  <NumericDraftInput
                    min={1}
                    max={12}
                    step={0.5}
                    value={audioVisualizerSensitivity}
                    disabled={isExporting}
                    onCommit={(value) => { if (typeof value === 'number') { setAudioVisualizerSensitivity(value); setAudioVisualizerPreviewUrl(null) } }}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #4b5563', backgroundColor: '#1f2937', color: '#f3f4f6' }}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <label style={{ fontSize: '12px', color: '#d1d5db', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  Màu chính
                  <input type="color" value={audioVisualizerPrimaryColor} disabled={isExporting}
                    onChange={(e) => { setAudioVisualizerPrimaryColor(e.target.value); setAudioVisualizerPreviewUrl(null) }} />
                </label>
                <label style={{ fontSize: '12px', color: '#d1d5db', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  Màu phụ
                  <input type="color" value={audioVisualizerSecondaryColor} disabled={isExporting}
                    onChange={(e) => { setAudioVisualizerSecondaryColor(e.target.value); setAudioVisualizerPreviewUrl(null) }} />
                </label>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={handlePreviewAudioVisualizer}
                  disabled={isExporting || audioVisualizerPreviewing || !audioSource || (!videoSource && !imageSource)}
                  style={{ ...buttonStyle, backgroundColor: audioVisualizerPreviewing ? '#555' : '#1e6b3a', padding: '8px 14px', fontSize: '13px' }}
                >
                  {audioVisualizerPreviewing ? 'Đang tạo preview 10s...' : 'Xem thử sóng nhạc 10s'}
                </button>
                <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                  Preview tạo video 10 giây từ audio và video/ảnh đầu tiên. Chỉnh xong bấm lại để xem thử, tránh nhấp nháy khi kéo slider.
                </span>
              </div>

              {audioVisualizerPreviewUrl && (
                <div style={{ marginTop: '4px', border: '1px solid #3d3d3d', borderRadius: '6px', overflow: 'hidden', backgroundColor: '#111' }}>
                  <video
                    src={audioVisualizerPreviewUrl}
                    controls
                    autoPlay
                    muted
                    loop
                    style={{ width: '100%', maxHeight: '420px', objectFit: 'contain', display: 'block' }}
                    onError={() => setAudioVisualizerPreviewUrl(null)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ marginTop: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={forceReencode}
              onChange={(e) => setForceReencode(e.target.checked)}
              disabled={isExporting}
            />{' '}
            Chuẩn hóa video khi xuất
          </label>
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#9f9f9f' }}>
            Đảm bảo tất cả video có cùng định dạng, tránh lỗi đứng hình. Thời gian xử lý sẽ lâu hơn nhưng đảm bảo chất lượng ổn định.
          </div>
        </div>

        {/* GPU Encoding Option - chỉ hiển thị khi bật chuẩn hóa video */}
        {forceReencode && (
          <div style={{ marginTop: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
              Mã hóa video
            </label>
            <select
              value={useGpuEncoding}
              onChange={(e) => setUseGpuEncoding(e.target.value as 'auto' | 'gpu' | 'cpu')}
              disabled={isExporting}
              style={{
                padding: '8px 12px',
                backgroundColor: '#2d2d2d',
                color: '#e0e0e0',
                border: '1px solid #444',
                borderRadius: '4px',
                fontSize: '14px',
                width: '100%',
              }}
            >
              <option value="auto">Tự động (khuyến nghị)</option>
              <option value="gpu">Sử dụng GPU (nhanh hơn)</option>
              <option value="cpu">Sử dụng CPU (chất lượng cao hơn)</option>
            </select>
            <div style={{ marginTop: '6px', fontSize: '12px', color: '#9f9f9f' }}>
              Tự động: Sử dụng GPU nếu có, ngược lại dùng CPU. GPU nhanh hơn nhiều nhưng CPU cho chất lượng tốt hơn.
            </div>
          </div>
        )}

        {/* Delete Source Files Option */}
        <div style={{ marginTop: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={deleteSourceFiles}
              onChange={(e) => setDeleteSourceFiles(e.target.checked)}
              disabled={isExporting}
            />{' '}
            Xóa file audio và video sau khi xuất xong
          </label>
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#9f9f9f' }}>
            Nếu bật, tool sẽ xóa các file audio và video đã chọn ở bước 1 sau khi xuất xong.
            Video ưu tiên (nếu chọn riêng) sẽ không bị xóa.
            <strong style={{ color: '#ffaa66' }}> Cảnh báo: Hành động này không thể hoàn tác!</strong>
          </div>
        </div>
      </div>

      {/* Export Presets Panel (Sprint 3.1) */}
      <div style={{ ...cardStyle, marginTop: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '15px' }}>Export Presets</h3>
          <button
            onClick={() => { setShowPresets(p => !p); if (!showPresets) loadPresets(); }}
            style={{ ...buttonStyle, padding: '4px 12px', fontSize: '12px', backgroundColor: '#374151' }}
          >
            {showPresets ? 'Ẩn' : 'Hiện preset'}
          </button>
        </div>

        {/* Save current settings */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            placeholder="Tên preset..."
            style={{
              flex: 1, minWidth: '180px', padding: '6px 10px', borderRadius: '6px',
              border: '1px solid #555', backgroundColor: '#1a1a1a', color: '#e0e0e0', fontSize: '13px',
            }}
          />
          <button
            onClick={handleSavePreset}
            style={{ ...buttonStyle, padding: '6px 14px', fontSize: '12px', backgroundColor: '#1e4d2b' }}
            disabled={isExporting}
          >
            Lưu preset hiện tại
          </button>
        </div>

        {/* Preset list */}
        {showPresets && (
          <div style={{ marginTop: '12px' }}>
            {presets.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#9ca3af' }}>Chưa có preset nào.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {presets.map(p => (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '6px 10px', borderRadius: '6px', backgroundColor: '#252525',
                    border: '1px solid #374151', fontSize: '13px',
                  }}>
                    <span style={{ flex: 1, color: '#e5e7eb' }}>{p.name}</span>
                    <button
                      onClick={() => handleApplyPreset(p.settings)}
                      style={{ ...buttonStyle, padding: '3px 10px', fontSize: '11px', backgroundColor: '#1e3a5f' }}
                    >
                      Áp dụng
                    </button>
                    <button
                      onClick={() => handleDeletePreset(p.id)}
                      style={{ ...buttonStyle, padding: '3px 8px', fontSize: '11px', backgroundColor: '#4a1010' }}
                    >
                      Xóa
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {errorMessage && (
        <div
          style={{
            ...cardStyle,
            borderColor: '#6b2c2c',
            backgroundColor: '#2a1e1e',
            color: '#ff9b9b',
          }}
        >
          {errorMessage}
        </div>
      )}

      <div style={{ ...cardStyle, marginBottom: '12px' }}>
        {/* PHASE 6: Summary "N audio → N video" ngay trên nút */}
        {audioItems.length > 0 && videoItems.length > 0 && (
          <div style={{ marginBottom: '12px', fontSize: '13px', color: '#d0d0d0', lineHeight: 1.5 }}>
            {planSummaryText}
          </div>
        )}
        {isExporting ? (
          <button
            onClick={async () => {
              if (!activeRequestId) return
              const cancellingId = activeRequestId
              try {
                await api.videoFinalExport.cancel(cancellingId)
                setStatusText('Đã hủy xuất video')
                setErrorMessage('Người dùng đã hủy xuất video.')
              } catch (err) {
                console.error('[FinalExportTab] Cancel error:', err)
                setErrorMessage('Không thể hủy xuất video — đã dừng tiến trình.')
              } finally {
                // FIX H-01 + M-03: Always reset state, even if cancel IPC throws.
                // Unregister from global export activity store to prevent auth deferral leak.
                isExportingRef.current = false
                setIsExporting(false)
                useExportActivityStore.getState().unregisterExport(cancellingId)
                setActiveRequestId(null)
              }
            }}
            style={{
              ...buttonStyle,
              padding: '14px 28px',
              fontSize: '16px',
              backgroundColor: '#d32f2f',
              cursor: 'pointer',
              width: '100%',
              marginBottom: '12px',
            }}
          >
            Hủy xuất video
          </button>
        ) : (
          <button
            onClick={handleExport}
            style={{
              ...buttonStyle,
              padding: '14px 28px',
              fontSize: '16px',
              backgroundColor: canExport ? '#00a86b' : '#4b4b4b',
              cursor: canExport ? 'pointer' : 'not-allowed',
              width: '100%',
              marginBottom: '12px',
            }}
            disabled={!canExport}
          >
            Xuất video hoàn chỉnh
          </button>
        )}
        <div style={{ fontSize: '13px', color: '#b0b0b0' }}>{statusText}</div>
      </div>

      <div style={{ ...cardStyle, marginTop: '0' }}>
        <div style={{ marginBottom: '12px', fontWeight: 600 }}>Tiến độ xuất video</div>
        <div
          style={{
            width: '100%',
            height: '10px',
            backgroundColor: '#1a1a1a',
            borderRadius: '4px',
            overflow: 'hidden',
            marginBottom: '8px',
          }}
        >
          <div
            style={{
              width: `${Math.min(100, Math.max(0, progressState?.percent ?? 0))}%`,
              height: '100%',
              backgroundColor: '#007acc',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <div style={{ fontSize: '13px', color: '#b0b0b0' }}>{progressDescription}</div>
      </div>

      {exportOutputs && exportOutputs.length > 0 && (
        <div
          style={{
            ...cardStyle,
            borderColor: '#2f6f4f',
            backgroundColor: '#1f2f28',
            color: '#b5f7d6',
          }}
        >
          <div style={{ marginBottom: '8px', fontWeight: 600 }}>
            Đã xuất thành công {exportOutputs.length} video
          </div>
          <div style={{ marginBottom: '8px', color: '#cfeee0', fontSize: '13px' }}>
            Mỗi video đã được cắt/loop để khớp chính xác với file audio tương ứng.
          </div>
          {renderOutputsPreview()}
          <button
            onClick={handleOpenOutputFolder}
            style={{ ...buttonStyle, backgroundColor: '#00a86b', color: '#fff' }}
            disabled={!outputFolder}
          >
            Mở thư mục xuất
          </button>
        </div>
      )}

      <DiskSpaceErrorModal error={diskSpaceError} onClose={() => setDiskSpaceError(null)} />
    </div>
  )
}

export default FinalExportTab



/**
 * Chức năng 13 — EXPORT VIDEO (UX). Modal: setup | progress | done | error.
 * Build ExportConfig → exportVideo(); Progress + Cancel + Retry CPU (1 lần).
 */

import { useEffect, useRef, useState } from 'react'
import { useSongNhacExportStore } from '../store/songNhacExportStore'
import { useSongNhacTimelineStore } from '../store/songNhacTimelineStore'
import { useSongNhacAudioStore } from '../store/songNhacAudioStore'
import { useSongNhacRuntimeStore } from '../store/songNhacRuntimeStore'
import { useSongNhacLayerStore } from '../store/songNhacLayerStore'
import type { ExportRange, ExportPresetId, EncoderQualityId } from './exportConfigTypes'
import { getDimensionsForPresetAndAspectRatio, ENCODER_QUALITY_OPTIONS, estimateExportFileSize, formatFileSize } from './exportConfigTypes'
import ExportPresetSelector from './ExportPresetSelector'
import ExportRangeSelector from './ExportRangeSelector'
import ExportProgressView from './ExportProgressView'

const MIN_DURATION_SEC = 0.5

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

declare const window: Window & {
  api?: {
    songNhac?: {
      exportVideo: (config: {
        width: number
        height: number
        fps: number
        durationSec: number
        startSec?: number
        audioFileUrl?: string
        outputPath?: string
        forceCpuEncoder?: boolean
        layers?: unknown[]
        runtimeSettings?: Record<string, unknown>
        encoderQuality?: string
        audioDisplayName?: string
        presetId?: string
      }) => Promise<{
        ok: boolean
        outPath?: string
        error?: string
        suggestedRetryWithCpu?: boolean
        retryConfig?: Record<string, unknown>
        summary?: {
          fileSizeBytes?: number
          durationSec?: number
          resolution?: string
          usedEncoder?: string
          avgSpeedFps?: number
          totalTimeSec?: number
          framesWritten?: number
        }
      }>
      cancelExport: (jobId: string) => Promise<{ ok: boolean }>
      onExportStarted: (cb: (p: { jobId: string }) => void) => () => void
      onExportProgress: (cb: (frameIndex: number, totalFrames: number) => void) => () => void
    }
    openPath?: (p: string) => Promise<void>
  }
}

function buildBackendConfig(
  presetId: ExportPresetId,
  width: number,
  height: number,
  fps: number,
  range: ExportRange,
  trackDurationSec: number,
  audioFileUrl: string | undefined,
  forceCpuEncoder?: boolean
): { width: number; height: number; fps: number; durationSec: number; startSec?: number; audioFileUrl?: string; forceCpuEncoder?: boolean } | null {
  const startSec = range.type === 'range' ? range.inSec : 0
  const durationSec =
    range.type === 'full'
      ? Math.max(0, trackDurationSec)
      : range.type === 'range'
        ? Math.max(0, range.outSec - range.inSec)
        : 0
  if (durationSec < MIN_DURATION_SEC) return null
  return {
    width,
    height,
    fps,
    durationSec,
    startSec: startSec > 0 ? startSec : undefined,
    audioFileUrl: audioFileUrl || undefined,
    forceCpuEncoder,
  }
}

export default function ExportDialog() {
  const open = useSongNhacExportStore((s) => s.exportDialogOpen)
  const mode = useSongNhacExportStore((s) => s.exportDialogMode)
  const isExporting = useSongNhacExportStore((s) => s.isExporting)
  const progress = useSongNhacExportStore((s) => s.progress)
  const currentJobId = useSongNhacExportStore((s) => s.currentJobId)
  const error = useSongNhacExportStore((s) => s.error)
  const suggestedRetryWithCpu = useSongNhacExportStore((s) => s.suggestedRetryWithCpu)
  const retryConfig = useSongNhacExportStore((s) => s.retryConfig)
  const closeExportDialog = useSongNhacExportStore((s) => s.closeExportDialog)
  const setExportDialogMode = useSongNhacExportStore((s) => s.setExportDialogMode)
  const setExporting = useSongNhacExportStore((s) => s.setExporting)
  const setError = useSongNhacExportStore((s) => s.setError)
  const setProgress = useSongNhacExportStore((s) => s.setProgress)
  const setCurrentJobId = useSongNhacExportStore((s) => s.setCurrentJobId)
  const setSuggestedRetry = useSongNhacExportStore((s) => s.setSuggestedRetry)

  const timelineDuration = useSongNhacTimelineStore((s) => s.timelineData?.duration ?? 0)
  const audioFileUrl = useSongNhacAudioStore((s) => s.audioFileUrl)
  const audioDurationSec = useSongNhacAudioStore((s) => s.durationSec)
  const audioDisplayName = useSongNhacAudioStore((s) => s.displayName)
  const aspectRatio = useSongNhacRuntimeStore((s) => s.aspectRatio)
  const hasAudio = !!audioFileUrl && (audioDurationSec != null && audioDurationSec > 0)
  const trackDurationSec = timelineDuration > 0 ? timelineDuration : (audioDurationSec ?? 0)

  const [presetId, setPresetId] = useState<ExportPresetId>('medium')
  const [width, setWidth] = useState(1280)
  const [height, setHeight] = useState(720)
  const [fps, setFps] = useState(30)
  const [range, setRange] = useState<ExportRange>({ type: 'full' })
  const [hasRetriedOnce, setHasRetriedOnce] = useState(false)
  const [exportStartedAt, setExportStartedAt] = useState(0)
  const [encoderQuality, setEncoderQuality] = useState<EncoderQualityId>('speed')
  const [forceSoftwareRenderer, setForceSoftwareRenderer] = useState(false)
  const [exportSummary, setExportSummary] = useState<{
    fileSizeBytes?: number; durationSec?: number; resolution?: string
    usedEncoder?: string; avgSpeedFps?: number; totalTimeSec?: number; framesWritten?: number
  } | null>(null)
  const [exportOutPath, setExportOutPath] = useState<string | null>(null)
  const unsubRef = useRef<(() => void)[]>([])

  // Sync width/height khi mở dialog hoặc đổi aspect ratio — đảm bảo export đúng tỉ lệ
  useEffect(() => {
    if (!open) return
    if (presetId !== 'custom') {
      const d = getDimensionsForPresetAndAspectRatio(presetId, aspectRatio)
      setWidth(d.width)
      setHeight(d.height)
    }
  }, [open, presetId, aspectRatio])

  useEffect(() => {
    if (!open) return
    const api = window.api?.songNhac
    if (!api?.onExportStarted || !api?.onExportProgress) return
    const unsubStarted = api.onExportStarted(({ jobId }) => setCurrentJobId(jobId))
    const unsubProgress = api.onExportProgress((frameIndex, totalFrames) =>
      setProgress({ frameIndex, totalFrames, timeSec: 0 })
    )
    unsubRef.current = [unsubStarted, unsubProgress]
    return () => {
      unsubRef.current.forEach((u) => u())
      unsubRef.current = []
    }
  }, [open, setCurrentJobId, setProgress])

  const durationSec =
    range.type === 'full'
      ? trackDurationSec
      : range.type === 'range'
        ? Math.max(0, range.outSec - range.inSec)
        : 0
  const validRange =
    range.type === 'full'
      ? trackDurationSec >= MIN_DURATION_SEC
      : range.type === 'range' && range.inSec < range.outSec && range.outSec - range.inSec >= MIN_DURATION_SEC
  const canStart = hasAudio && validRange && !isExporting
  const durationWarning = durationSec > 0 && durationSec < MIN_DURATION_SEC

  const runExport = async (config: { width: number; height: number; fps: number; durationSec: number; audioFileUrl?: string; forceCpuEncoder?: boolean; encoderQuality?: string; audioDisplayName?: string; presetId?: string }) => {
    const api = window.api?.songNhac
    if (!api?.exportVideo) return
    setError(null)
    setExportSummary(null)
    setExportOutPath(null)
    setExporting(true)
    setExportStartedAt(Date.now())
    setExportDialogMode('progress')
    try {
      const result = await api.exportVideo(config)
      if (result.ok) {
        setExportDialogMode('done')
        if (result.summary) setExportSummary(result.summary)
        if (result.outPath) setExportOutPath(result.outPath)
        if (result.outPath && typeof window.api?.openPath === 'function') {
          try {
            const parentDir = result.outPath.replace(/[/\\][^/\\]*$/, '')
            if (parentDir) await window.api.openPath(parentDir)
          } catch (_) {}
        }
      } else {
        setExportDialogMode('error')
        setError(result.error ?? 'Export failed')
        if (result.suggestedRetryWithCpu && result.retryConfig && typeof result.retryConfig === 'object') {
          setSuggestedRetry(true, result.retryConfig as any)
        }
      }
    } catch (e) {
      setExportDialogMode('error')
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
      setCurrentJobId(null)
    }
  }

  const handleStartExport = () => {
    // Khi chọn "Máy yếu" → tự bật forceCpuEncoder + forceSoftwareRenderer
    const isLowend = encoderQuality === 'lowend'
    const cfg = buildBackendConfig(
      presetId,
      width,
      height,
      isLowend ? Math.min(fps, 30) : fps, // Máy yếu: giới hạn 30fps
      range,
      trackDurationSec,
      audioFileUrl ?? undefined,
      isLowend ? true : undefined // forceCpuEncoder
    )
    if (!cfg) return

    // Snapshot layers + runtime settings for the offscreen export window
    const layers = useSongNhacLayerStore.getState().layers
      .filter((l) => (l.type === 'image' || l.type === 'text') && l.visible)
    const rt = useSongNhacRuntimeStore.getState()
    const runtimeSettings: Record<string, unknown> = {
      imageBeatEnabled: rt.imageBeatEnabled,
      imageBeatIntensity: rt.imageBeatIntensity,
      waveAroundImageEnabled: rt.waveAroundImageEnabled,
      waveAroundIntensity: rt.waveAroundIntensity,
      waveAroundStyle: rt.waveAroundStyle,
    }

    // Map UI quality to backend preset name
    const backendQuality = ENCODER_QUALITY_OPTIONS[encoderQuality].backendPreset

    runExport({
      ...cfg,
      layers: JSON.parse(JSON.stringify(layers)),
      runtimeSettings,
      encoderQuality: backendQuality,
      audioDisplayName: audioDisplayName ?? undefined,
      presetId,
      forceSoftwareRenderer: isLowend || forceSoftwareRenderer,
    } as any)
  }

  const handleRetryCpu = () => {
    if (!retryConfig || hasRetriedOnce) return
    setHasRetriedOnce(true)
    setSuggestedRetry(false, null)
    setError(null)
    const backendQuality = ENCODER_QUALITY_OPTIONS[encoderQuality].backendPreset
    runExport({
      ...retryConfig,
      forceCpuEncoder: true,
      encoderQuality: backendQuality,
      audioDisplayName: audioDisplayName ?? undefined,
      presetId,
    })
  }

  const handleCancel = async () => {
    if (currentJobId && window.api?.songNhac?.cancelExport) {
      await window.api.songNhac.cancelExport(currentJobId)
    }
  }

  const handleClose = () => {
    if (isExporting) {
      if (window.confirm('Cancel export and close?')) {
        handleCancel()
        closeExportDialog()
        setHasRetriedOnce(false)
      }
    } else {
      closeExportDialog()
      setHasRetriedOnce(false)
    }
  }

  if (!open) return null

  const backdropStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  }
  const boxStyle: React.CSSProperties = {
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: 16,
    minWidth: 380,
    maxWidth: 420,
    color: '#e8e8e8',
    fontSize: 12,
  }

  return (
    <div style={backdropStyle} onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div style={boxStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: 14 }}>Export video</strong>
          <button
            type="button"
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {mode === 'setup' && (
          <>
            {hasAudio && (
              <div style={{ marginBottom: 10, color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>
                <div>🎵 {audioDisplayName ?? 'Audio'} · ⏱️ {formatDuration(trackDurationSec)}</div>
                <div style={{ color: 'rgba(255,255,255,0.5)', marginTop: 2, fontSize: 11 }}>
                  Xuất {width}×{height} ({aspectRatio})
                </div>
                {range.type === 'full' && (
                  <div style={{ color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
                    Range: Full track ({formatDuration(trackDurationSec)})
                  </div>
                )}
              </div>
            )}
            <ExportPresetSelector
              presetId={presetId}
              width={width}
              height={height}
              fps={fps}
              aspectRatio={aspectRatio}
              onPresetChange={setPresetId}
              onWidthChange={setWidth}
              onHeightChange={setHeight}
              onFpsChange={setFps}
            />
            <ExportRangeSelector
              range={range}
              trackDurationSec={trackDurationSec}
              onRangeChange={setRange}
            />
            {/* Encoder quality selector */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 4 }}>Chất lượng encode:</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(Object.keys(ENCODER_QUALITY_OPTIONS) as EncoderQualityId[]).map((qid) => {
                  const opt = ENCODER_QUALITY_OPTIONS[qid]
                  const active = encoderQuality === qid
                  return (
                    <button
                      key={qid}
                      type="button"
                      onClick={() => setEncoderQuality(qid)}
                      title={opt.description}
                      style={{
                        padding: '4px 10px',
                        border: `1px solid ${active ? (qid === 'lowend' ? 'rgba(245,158,11,0.7)' : 'rgba(0,122,204,0.7)') : 'rgba(255,255,255,0.15)'}`,
                        borderRadius: 4,
                        background: active ? (qid === 'lowend' ? 'rgba(245,158,11,0.25)' : 'rgba(0,122,204,0.25)') : 'transparent',
                        color: active ? '#fff' : 'rgba(255,255,255,0.6)',
                        cursor: 'pointer',
                        fontSize: 11,
                      }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              {encoderQuality === 'lowend' && (
                <div style={{ marginTop: 6, padding: '6px 8px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4, fontSize: 10 }}>
                  <div style={{ color: 'rgba(245,158,11,0.9)', fontWeight: 600, marginBottom: 2 }}>⚡ Chế độ máy yếu</div>
                  <div style={{ color: 'rgba(255,255,255,0.5)' }}>
                    • Dùng CPU encoder (không cần GPU mạnh)<br />
                    • Canvas 2D renderer (thay vì WebGL)<br />
                    • FFmpeg ultrafast preset + CRF 30<br />
                    • Không B-frames, 1 ref frame → ít RAM<br />
                    • FPS giới hạn 30fps<br />
                    Chất lượng thấp hơn nhưng export được trên mọi máy.
                  </div>
                </div>
              )}
            </div>
            {/* File size estimation */}
            {durationSec >= MIN_DURATION_SEC && (
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginBottom: 8 }}>
                📁 Ước tính dung lượng: ~{formatFileSize(estimateExportFileSize(width, height, fps, durationSec, encoderQuality))}
              </div>
            )}
            {!hasAudio && (
              <div style={{ color: 'rgba(255,180,80,0.9)', marginBottom: 8, fontSize: 11 }}>
                Load audio to export (chọn track từ Audio trong panel trái).
              </div>
            )}
            {durationWarning && (
              <div style={{ color: 'rgba(255,180,80,0.9)', marginBottom: 8, fontSize: 11 }}>
                Duration should be at least {MIN_DURATION_SEC}s.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                disabled={!canStart}
                onClick={handleStartExport}
                style={{
                  padding: '8px 16px',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: 4,
                  background: canStart ? 'rgba(0,122,204,0.5)' : 'rgba(255,255,255,0.08)',
                  color: canStart ? '#fff' : 'rgba(255,255,255,0.5)',
                  cursor: canStart ? 'pointer' : 'not-allowed',
                  fontSize: 12,
                }}
              >
                Start export
              </button>
              <button
                type="button"
                onClick={handleClose}
                style={{
                  padding: '8px 16px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 4,
                  background: 'transparent',
                  color: 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {mode === 'progress' && (
          <ExportProgressView
            frameIndex={progress?.frameIndex ?? 0}
            totalFrames={progress?.totalFrames ?? 0}
            startedAt={exportStartedAt}
            resWidth={width}
            resHeight={height}
            resFps={fps}
            onCancel={handleCancel}
            onRetryCpu={suggestedRetryWithCpu && !hasRetriedOnce ? handleRetryCpu : undefined}
            suggestedRetryWithCpu={suggestedRetryWithCpu && !hasRetriedOnce}
          />
        )}

        {mode === 'done' && (
          <div style={{ marginTop: 8 }}>
            <p style={{ color: 'rgba(120,220,120,0.9)', marginBottom: 8 }}>✅ Export hoàn tất!</p>
            {exportSummary && (
              <div style={{
                background: 'rgba(0,0,0,0.3)',
                borderRadius: 6,
                padding: '8px 10px',
                marginBottom: 10,
                fontSize: 11,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '4px 12px',
              }}>
                {exportSummary.fileSizeBytes != null && exportSummary.fileSizeBytes > 0 && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span style={{ color: 'rgba(255,255,255,0.4)' }}>File size: </span>
                    <span style={{ color: 'rgba(255,255,255,0.8)' }}>{formatFileSize(exportSummary.fileSizeBytes)}</span>
                  </div>
                )}
                {exportSummary.resolution && (
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.4)' }}>Resolution: </span>
                    <span style={{ color: 'rgba(255,255,255,0.7)' }}>{exportSummary.resolution}</span>
                  </div>
                )}
                {exportSummary.usedEncoder && (
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.4)' }}>Encoder: </span>
                    <span style={{ color: 'rgba(255,255,255,0.7)' }}>{exportSummary.usedEncoder}</span>
                  </div>
                )}
                {exportSummary.totalTimeSec != null && exportSummary.totalTimeSec > 0 && (
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.4)' }}>Thời gian: </span>
                    <span style={{ color: 'rgba(255,255,255,0.7)' }}>{formatDuration(exportSummary.totalTimeSec)}</span>
                  </div>
                )}
                {exportSummary.avgSpeedFps != null && exportSummary.avgSpeedFps > 0 && (
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.4)' }}>Tốc độ TB: </span>
                    <span style={{ color: 'rgba(255,255,255,0.7)' }}>{exportSummary.avgSpeedFps} fps</span>
                  </div>
                )}
              </div>
            )}
            {exportOutPath && (
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, marginBottom: 8, wordBreak: 'break-all' }}>
                {exportOutPath}
              </div>
            )}
            <button
              type="button"
              onClick={handleClose}
              style={{
                marginTop: 4,
                padding: '6px 12px',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 4,
                background: 'transparent',
                color: '#e8e8e8',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Close
            </button>
          </div>
        )}

        {mode === 'error' && (
          <div style={{ marginTop: 8 }}>
            <p style={{ color: 'rgba(255,120,120,0.9)' }}>{error ?? 'Export failed'}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {suggestedRetryWithCpu && !hasRetriedOnce && retryConfig && (
                <button
                  type="button"
                  onClick={handleRetryCpu}
                  style={{
                    padding: '6px 12px',
                    border: '1px solid rgba(255,180,80,0.6)',
                    borderRadius: 4,
                    background: 'rgba(255,180,80,0.15)',
                    color: 'rgba(255,200,100,0.95)',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Retry with CPU
                </button>
              )}
              <button
                type="button"
                onClick={handleClose}
                style={{
                  padding: '6px 12px',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: 4,
                  background: 'transparent',
                  color: '#e8e8e8',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

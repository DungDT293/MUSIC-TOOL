/**
 * Chức năng 13 — Toolbar: Play/Pause, Undo/Redo, Copy/Paste, Export, AR, Zoom, Quality.
 * V2: More compact, grouped sections, better visual hierarchy.
 */

import type { PreviewQuality } from '../runtime/types'
import type { PlaybackState } from '../types/PlaybackState'
import type { AspectRatioId } from '../store/songNhacRuntimeStore'
import { useSongNhacRuntimeStore } from '../store/songNhacRuntimeStore'
import { useSongNhacExportStore } from '../store/songNhacExportStore'
import { useSongNhacAudioStore } from '../store/songNhacAudioStore'
import { useSongNhacLayerStore } from '../store/songNhacLayerStore'

const ASPECT_RATIOS: { value: AspectRatioId; label: string }[] = [
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: '2.35:1', label: '2.35:1' },
  { value: '2:1', label: '2:1' },
  { value: '1.85:1', label: '1.85:1' },
  { value: '9:16', label: '9:16' },
  { value: '3:4', label: '3:4' },
  { value: '4:5', label: '4:5' },
  { value: '5.8-inch', label: '5.8"' },
  { value: '1:1', label: '1:1' },
]

const QUALITIES: { value: PreviewQuality; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'full', label: 'Full' },
]

export interface VisualizerToolbarProps {
  playbackState: PlaybackState
  onPlay: () => void
  onPause: () => void
}

function Divider() {
  return <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />
}

function TBtn({
  onClick,
  disabled,
  active,
  title,
  children,
  accent,
}: {
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  title?: string
  children: React.ReactNode
  accent?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: '3px 9px',
        fontSize: 11,
        border: `1px solid ${active ? 'rgba(77,159,255,0.5)' : accent ? 'rgba(77,159,255,0.3)' : 'rgba(255,255,255,0.12)'}`,
        borderRadius: 4,
        background: active
          ? 'rgba(77,159,255,0.2)'
          : accent
            ? 'linear-gradient(135deg, rgba(77,159,255,0.25), rgba(77,159,255,0.1))'
            : 'rgba(255,255,255,0.04)',
        color: disabled ? 'rgba(255,255,255,0.25)' : active ? '#a8d4ff' : 'rgba(255,255,255,0.8)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: active ? 700 : 400,
        whiteSpace: 'nowrap',
        transition: 'all 0.1s',
      }}
    >
      {children}
    </button>
  )
}

export default function VisualizerToolbar({ playbackState, onPlay, onPause }: VisualizerToolbarProps) {
  const quality = useSongNhacRuntimeStore((s) => s.quality)
  const setQuality = useSongNhacRuntimeStore((s) => s.setQuality)
  const aspectRatio = useSongNhacRuntimeStore((s) => s.aspectRatio)
  const setAspectRatio = useSongNhacRuntimeStore((s) => s.setAspectRatio)
  const previewZoom = useSongNhacRuntimeStore((s) => s.previewZoom)
  const zoomIn = useSongNhacRuntimeStore((s) => s.zoomIn)
  const zoomOut = useSongNhacRuntimeStore((s) => s.zoomOut)
  const zoomReset = useSongNhacRuntimeStore((s) => s.zoomReset)
  const showGrid = useSongNhacRuntimeStore((s) => s.showGrid)
  const setShowGrid = useSongNhacRuntimeStore((s) => s.setShowGrid)
  const showRulers = useSongNhacRuntimeStore((s) => s.showRulers)
  const setShowRulers = useSongNhacRuntimeStore((s) => s.setShowRulers)
  const openExportDialog = useSongNhacExportStore((s) => s.openExportDialog)
  const isExporting = useSongNhacExportStore((s) => s.isExporting)
  const hasAudio = !!useSongNhacAudioStore((s) => s.audioFileUrl)
  const undo = useSongNhacLayerStore((s) => s.undo)
  const redo = useSongNhacLayerStore((s) => s.redo)
  const copyLayer = useSongNhacLayerStore((s) => s.copyLayer)
  const pasteLayers = useSongNhacLayerStore((s) => s.pasteLayers)
  const canUndo = useSongNhacLayerStore((s) => s.historyPast.length > 0)
  const canRedo = useSongNhacLayerStore((s) => s.historyFuture.length > 0)
  const selectedLayerId = useSongNhacLayerStore((s) => s.selectedLayerId)
  const canPaste = useSongNhacLayerStore((s) => s.clipboard.length > 0)

  const isPlaying = playbackState === 'playing'
  const playDisabled = !hasAudio

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        background: '#16162a',
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.08)',
        fontSize: 11,
        height: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
        flexWrap: 'nowrap',
      }}
    >
      {/* ── Transport ── */}
      {isPlaying ? (
        <TBtn onClick={onPause} title="Pause (Space)">Pause</TBtn>
      ) : (
        <TBtn onClick={onPlay} disabled={playDisabled} title={playDisabled ? 'Cần chọn file nhạc' : 'Play (Space)'} accent>
          Play
        </TBtn>
      )}

      <Divider />

      {/* ── Edit ── */}
      <TBtn onClick={undo} disabled={!canUndo} title="Hoàn tác (Ctrl+Z)">Undo</TBtn>
      <TBtn onClick={redo} disabled={!canRedo} title="Làm lại (Ctrl+Y)">Redo</TBtn>

      <Divider />

      <TBtn onClick={() => selectedLayerId && copyLayer(selectedLayerId)} disabled={!selectedLayerId} title="Copy (Ctrl+C)">Copy</TBtn>
      <TBtn onClick={pasteLayers} disabled={!canPaste} title="Paste (Ctrl+V)">📄 Paste</TBtn>

      <Divider />

      {/* ── Export ── */}
      <TBtn
        onClick={openExportDialog}
        disabled={isExporting || !hasAudio}
        title={!hasAudio ? 'Cần chọn file nhạc' : 'Xuất video'}
        accent={!isExporting && hasAudio}
      >
        {isExporting ? 'Xuất…' : 'Export'}
      </TBtn>

      <Divider />

      {/* ── Aspect ratio (dropdown) ── */}
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginRight: 2 }}>AR:</span>
      <select
        value={aspectRatio}
        onChange={(e) => setAspectRatio(e.target.value as AspectRatioId)}
        title="Tỉ lệ khung hình"
        style={{
          background: '#2a2a2a',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 4,
          padding: '2px 4px',
          fontSize: 11,
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        {ASPECT_RATIOS.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>

      <Divider />

      {/* ── Zoom ── */}
      <TBtn onClick={zoomOut} title="Thu nhỏ">−</TBtn>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', minWidth: 34, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(previewZoom * 100)}%
      </span>
      <TBtn onClick={zoomIn} title="Phóng to">+</TBtn>
      <TBtn onClick={zoomReset} active={previewZoom === 1} title="Reset 100%">100%</TBtn>

      <Divider />

      {/* ── View helpers ── */}
      <TBtn onClick={() => setShowGrid(!showGrid)} active={showGrid} title="Lưới">Grid</TBtn>
      <TBtn onClick={() => setShowRulers(!showRulers)} active={showRulers} title="Thước">Rulers</TBtn>

      <Divider />

      {/* ── Quality ── */}
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginRight: 2 }}>Preview:</span>
      {QUALITIES.map(({ value, label }) => (
        <TBtn key={value} onClick={() => setQuality(value)} active={quality === value} title={`Preview quality: ${label}`}>
          {label}
        </TBtn>
      ))}
    </div>
  )
}

import { useState } from 'react'
import type { LoudnormSettings } from '../../../types/ipc'

interface Props {
  value: LoudnormSettings
  onChange: (v: LoudnormSettings) => void
  currentLufs?: number       // live LUFS từ Web Audio (approximate)
  selectedFile?: string | null
  disabled?: boolean
  onRequestPreview?: () => void
  previewLoading?: boolean
}

const PRESETS: Array<{ label: string; integratedLufs: number; truePeakDbtp: number; lra: number }> = [
  { label: 'YouTube', integratedLufs: -14, truePeakDbtp: -1, lra: 11 },
  { label: 'Spotify', integratedLufs: -14, truePeakDbtp: -1, lra: 13 },
  { label: 'Broadcast', integratedLufs: -23, truePeakDbtp: -1, lra: 20 },
  { label: 'Club', integratedLufs: -10, truePeakDbtp: -0.5, lra: 7 },
  { label: 'Custom', integratedLufs: -14, truePeakDbtp: -1, lra: 11 },
]

export default function LoudnormPanel({ value, onChange, currentLufs = -Infinity, selectedFile, disabled, onRequestPreview, previewLoading }: Props) {
  const [preset, setPreset] = useState('YouTube')
  const set = (k: keyof LoudnormSettings, v: any) => onChange({ ...value, [k]: v })

  const handlePreset = (p: typeof PRESETS[0]) => {
    setPreset(p.label)
    onChange({ ...value, integratedLufs: p.integratedLufs, truePeakDbtp: p.truePeakDbtp, lra: p.lra })
  }

  const lufsOk = isFinite(currentLufs)
  const lufsColor = !lufsOk ? '#555'
    : currentLufs > -8 ? '#ef4444'
    : currentLufs > -14 ? '#22c55e'
    : currentLufs > -20 ? '#f59e0b'
    : '#888'

  return (
    <div style={{ border: '1px solid #333', borderRadius: '6px', padding: '12px', marginBottom: '10px', backgroundColor: '#1e1e1e' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <input
          type="checkbox" checked={value.enabled}
          onChange={e => set('enabled', e.target.checked)}
          disabled={disabled}
          style={{ cursor: 'pointer', width: '14px', height: '14px' }}
        />
        <span style={{ fontSize: '13px', fontWeight: 'bold', color: value.enabled ? '#fff' : '#888' }}>
          Loudness Normalization (EBU R128)
        </span>
        {lufsOk && (
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: lufsColor, fontWeight: 'bold' }}>
            {currentLufs.toFixed(1)} LUFS
          </span>
        )}
      </div>

      <div style={{ fontSize: '11px', color: '#555', marginBottom: '10px', lineHeight: '1.4' }}>
        Chuẩn hóa âm lượng theo tiêu chuẩn quốc tế — đảm bảo nhạc không quá to hay quá nhỏ khi phát
        trên các nền tảng như YouTube, Spotify, hay phát thanh. Khác với chỉnh volume thông thường,
        công nghệ này phân tích toàn bộ bài nhạc và điều chỉnh chính xác hơn.
      </div>

      <div style={{ opacity: value.enabled ? 1 : 0.4, pointerEvents: value.enabled && !disabled ? 'auto' : 'none' }}>
        {/* Presets */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' }}>
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => handlePreset(p)}
              style={{
                fontSize: '11px', padding: '3px 8px',
                backgroundColor: preset === p.label ? '#1a3a5c' : '#2d2d2d',
                color: preset === p.label ? '#40a9ff' : '#888',
                border: `1px solid ${preset === p.label ? '#40a9ff' : '#444'}`,
                borderRadius: '3px', cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Target LUFS */}
        <div style={{ marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ccc', marginBottom: '2px' }}>
            <span>Target (Integrated LUFS)</span>
            <span style={{ color: '#40a9ff', fontWeight: 'bold' }}>{value.integratedLufs} LUFS</span>
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '5px', lineHeight: '1.4' }}>
            Mức âm lượng trung bình bạn muốn đạt được. -14 LUFS = tiêu chuẩn YouTube/Spotify (khuyên dùng). Số càng gần 0 thì nhạc càng to.
          </div>
          <input type="range" min={-23} max={-6} step={0.5} value={value.integratedLufs}
            onChange={e => { setPreset('Custom'); set('integratedLufs', Number(e.target.value)) }}
            style={{ width: '100%', accentColor: '#40a9ff' }} />
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>True Peak (dBTP)</div>
            <div style={{ fontSize: '10px', color: '#555', marginBottom: '4px', lineHeight: '1.3' }}>
              Giới hạn đỉnh âm tuyệt đối — tránh méo tiếng khi chuyển đổi định dạng
            </div>
            <input type="number" min={-3} max={0} step={0.5} value={value.truePeakDbtp}
              onChange={e => { setPreset('Custom'); set('truePeakDbtp', Number(e.target.value)) }}
              style={{ width: '100%', backgroundColor: '#252526', color: '#ccc', border: '1px solid #444', borderRadius: '3px', padding: '4px 6px', fontSize: '12px' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>LRA (LU)</div>
            <div style={{ fontSize: '10px', color: '#555', marginBottom: '4px', lineHeight: '1.3' }}>
              Độ biến thiên âm lượng — thấp = đều hơn, cao = giữ nhiều cảm xúc gốc hơn
            </div>
            <input type="number" min={1} max={20} step={1} value={value.lra}
              onChange={e => { setPreset('Custom'); set('lra', Number(e.target.value)) }}
              style={{ width: '100%', backgroundColor: '#252526', color: '#ccc', border: '1px solid #444', borderRadius: '3px', padding: '4px 6px', fontSize: '12px' }} />
          </div>
        </div>

        {/* Preview button */}
        <div style={{ padding: '8px', backgroundColor: '#252526', borderRadius: '4px', border: '1px solid #333' }}>
          <div style={{ fontSize: '11px', color: '#f59e0b', marginBottom: '6px' }}>
            Loudnorm cần 2-pass FFmpeg — không thể real-time. Nhấn để render 30s preview.
          </div>
          <button
            onClick={onRequestPreview}
            disabled={!selectedFile || previewLoading}
            style={{
              width: '100%', padding: '6px', fontSize: '12px',
              backgroundColor: selectedFile && !previewLoading ? '#1a3a5c' : '#2d2d2d',
              color: selectedFile && !previewLoading ? '#40a9ff' : '#555',
              border: `1px solid ${selectedFile ? '#40a9ff' : '#444'}`,
              borderRadius: '4px', cursor: selectedFile && !previewLoading ? 'pointer' : 'not-allowed',
            }}
          >
            {previewLoading ? 'Đang render preview...' : 'Render 30s Preview (FFmpeg)'}
          </button>
        </div>
      </div>
    </div>
  )
}

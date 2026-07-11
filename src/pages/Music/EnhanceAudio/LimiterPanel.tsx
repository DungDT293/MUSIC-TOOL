import NumericDraftInput from '../../../components/NumericDraftInput'
import type { LimiterSettings } from '../../../types/ipc'

interface Props {
  value: LimiterSettings
  onChange: (v: LimiterSettings) => void
  disabled?: boolean
}

export default function LimiterPanel({ value, onChange, disabled }: Props) {
  const set = (k: keyof LimiterSettings, v: any) => onChange({ ...value, [k]: v })

  return (
    <div style={{ border: '1px solid #333', borderRadius: '6px', padding: '12px', marginBottom: '10px', backgroundColor: '#1e1e1e' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <input type="checkbox" checked={value.enabled}
          onChange={e => set('enabled', e.target.checked)} disabled={disabled}
          style={{ cursor: 'pointer', width: '14px', height: '14px' }} />
        <span style={{ fontSize: '13px', fontWeight: 'bold', color: value.enabled ? '#fff' : '#888' }}>
          Brick-wall Limiter
        </span>
        {value.enabled && (
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#f59e0b' }}>
            Trần: {value.thresholdDbtp} dBTP
          </span>
        )}
      </div>
      <div style={{ fontSize: '11px', color: '#555', marginBottom: '10px', lineHeight: '1.4' }}>
        Tường bích wall — đảm bảo âm thanh KHÔNG BAO GIỜ vượt qua mức trần này, tránh clip/vỡ tiếng.
        Đặt cuối chuỗi xử lý. True Peak đảm bảo an toàn trên tất cả thiết bị.
      </div>
      <div style={{ opacity: value.enabled ? 1 : 0.4, pointerEvents: value.enabled && !disabled ? 'auto' : 'none' }}>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ccc', marginBottom: '2px' }}>
            <span>Ngưỡng trần (True Peak)</span>
            <span style={{ color: '#40a9ff', fontWeight: 'bold' }}>{value.thresholdDbtp} dBTP</span>
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '5px', lineHeight: '1.4' }}>
            -1 dBTP là chuẩn cho streaming (Spotify, YouTube). -0.5 cho nhạc club. 0 = mức tối đa tuyệt đối.
          </div>
          <input type="range" min={-3} max={0} step={0.1} value={value.thresholdDbtp}
            onChange={e => set('thresholdDbtp', Number(e.target.value))}
            disabled={disabled} style={{ width: '100%', accentColor: '#40a9ff' }} />
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>Attack (ms)</div>
            <div style={{ fontSize: '10px', color: '#555', marginBottom: '4px', lineHeight: '1.3' }}>Tốc độ phản ứng — 1ms là phổ biến</div>
            <NumericDraftInput min={0.1} max={20} step={0.1} value={value.attackMs}
              onCommit={v => { if (typeof v === 'number') set('attackMs', v) }} disabled={disabled}
              style={{ width: '100%', backgroundColor: '#252526', color: '#ccc', border: '1px solid #444', borderRadius: '3px', padding: '4px 6px', fontSize: '12px' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>Release (ms)</div>
            <div style={{ fontSize: '10px', color: '#555', marginBottom: '4px', lineHeight: '1.3' }}>Tốc độ nhả — 50ms là tự nhiên</div>
            <NumericDraftInput min={10} max={500} step={5} value={value.releaseMs}
              onCommit={v => { if (typeof v === 'number') set('releaseMs', v) }} disabled={disabled}
              style={{ width: '100%', backgroundColor: '#252526', color: '#ccc', border: '1px solid #444', borderRadius: '3px', padding: '4px 6px', fontSize: '12px' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

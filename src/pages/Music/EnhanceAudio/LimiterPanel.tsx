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
            Tran: {value.thresholdDbtp} dBTP
          </span>
        )}
      </div>
      <div style={{ fontSize: '11px', color: '#555', marginBottom: '10px', lineHeight: '1.4' }}>
        Tuong bich wall — dam bao am thanh KHONG BAO GIO vuot qua muc tran nay, tranh clip/vo tieng.
        Dat cuoi chuoi xu ly. True Peak dam bao an toan tren tat ca thiet bi.
      </div>
      <div style={{ opacity: value.enabled ? 1 : 0.4, pointerEvents: value.enabled && !disabled ? 'auto' : 'none' }}>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ccc', marginBottom: '2px' }}>
            <span>Nguong tran (True Peak)</span>
            <span style={{ color: '#40a9ff', fontWeight: 'bold' }}>{value.thresholdDbtp} dBTP</span>
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '5px', lineHeight: '1.4' }}>
            -1 dBTP la chuan cho streaming (Spotify, YouTube). -0.5 cho nhac club. 0 = muc toi da tuyet doi.
          </div>
          <input type="range" min={-3} max={0} step={0.1} value={value.thresholdDbtp}
            onChange={e => set('thresholdDbtp', Number(e.target.value))}
            disabled={disabled} style={{ width: '100%', accentColor: '#40a9ff' }} />
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>Attack (ms)</div>
            <div style={{ fontSize: '10px', color: '#555', marginBottom: '4px', lineHeight: '1.3' }}>Toc do phan ung — 1ms la pho bien</div>
            <input type="number" min={0.1} max={20} step={0.1} value={value.attackMs}
              onChange={e => set('attackMs', Number(e.target.value))} disabled={disabled}
              style={{ width: '100%', backgroundColor: '#252526', color: '#ccc', border: '1px solid #444', borderRadius: '3px', padding: '4px 6px', fontSize: '12px' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>Release (ms)</div>
            <div style={{ fontSize: '10px', color: '#555', marginBottom: '4px', lineHeight: '1.3' }}>Toc do nha — 50ms la tu nhien</div>
            <input type="number" min={10} max={500} step={5} value={value.releaseMs}
              onChange={e => set('releaseMs', Number(e.target.value))} disabled={disabled}
              style={{ width: '100%', backgroundColor: '#252526', color: '#ccc', border: '1px solid #444', borderRadius: '3px', padding: '4px 6px', fontSize: '12px' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

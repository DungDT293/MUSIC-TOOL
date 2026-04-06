import type { NoiseReductionSettings } from '../../../types/ipc'

interface Props {
  value: NoiseReductionSettings
  onChange: (v: NoiseReductionSettings) => void
  disabled?: boolean
}

export default function NoiseReductionPanel({ value, onChange, disabled }: Props) {
  const set = (k: keyof NoiseReductionSettings, v: any) => onChange({ ...value, [k]: v })

  return (
    <div style={{ border: '1px solid #333', borderRadius: '6px', padding: '12px', marginBottom: '10px', backgroundColor: '#1e1e1e' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <input type="checkbox" checked={value.enabled}
          onChange={e => set('enabled', e.target.checked)} disabled={disabled}
          style={{ cursor: 'pointer', width: '14px', height: '14px' }} />
        <span style={{ fontSize: '13px', fontWeight: 'bold', color: value.enabled ? '#fff' : '#888' }}>
          Noise Reduction
        </span>
      </div>
      <div style={{ fontSize: '11px', color: '#555', marginBottom: '10px', lineHeight: '1.4' }}>
        Khử nhiễu bằng phổ (FFT denoising) — loại bỏ tiếng hiss, hum, phòng thu ồn và tạp âm nền.
        Dùng đầu tiên trước các xử lý khác. Không nên dùng quá mạnh để tránh artefact.
      </div>
      <div style={{ opacity: value.enabled ? 1 : 0.4, pointerEvents: value.enabled && !disabled ? 'auto' : 'none' }}>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ccc', marginBottom: '2px' }}>
            <span>Mức khử nhiễu (dB)</span>
            <span style={{ color: '#40a9ff', fontWeight: 'bold' }}>{value.noiseReducDb} dB</span>
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '5px', lineHeight: '1.4' }}>
            Giảm bao nhiêu dB tiếng ồn — 10-20dB là an toàn, trên 30dB có thể làm mất tự nhiên âm thanh
          </div>
          <input type="range" min={0} max={80} step={1} value={value.noiseReducDb}
            onChange={e => set('noiseReducDb', Number(e.target.value))}
            disabled={disabled} style={{ width: '100%', accentColor: '#40a9ff' }} />
        </div>
        <div style={{ marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ccc', marginBottom: '2px' }}>
            <span>Sàn nhiễu (Noise Floor dBFS)</span>
            <span style={{ color: '#40a9ff', fontWeight: 'bold' }}>{value.noiseFloorDb} dBFS</span>
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '5px', lineHeight: '1.4' }}>
            Mức âm lượng coi là "tiếng ồn" — -50dBFS là phổ biến. Cao hơn = khử nhiễu nhiều hơn nhưng dễ cắt nhầm tiếng thật
          </div>
          <input type="range" min={-90} max={-20} step={1} value={value.noiseFloorDb}
            onChange={e => set('noiseFloorDb', Number(e.target.value))}
            disabled={disabled} style={{ width: '100%', accentColor: '#40a9ff' }} />
        </div>
        <div style={{ padding: '6px 8px', backgroundColor: '#252526', borderRadius: '4px', fontSize: '11px', color: '#777', lineHeight: '1.4' }}>
          Sử dụng FFmpeg afftdn (FFT Noise Reduction). Chạy trên file xuất, không thể nghe thử real-time.
        </div>
      </div>
    </div>
  )
}

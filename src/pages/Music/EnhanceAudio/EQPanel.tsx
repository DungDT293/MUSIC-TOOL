import type { EQSettings } from '../../../types/ipc'

interface Props {
  value: EQSettings
  onChange: (v: EQSettings) => void
  disabled?: boolean
}

function SliderRow({ label, desc, min, max, step, value, unit, onChange, disabled, color = '#40a9ff' }: {
  label: string; desc: string; min: number; max: number; step: number
  value: number; unit: string; onChange: (v: number) => void; disabled?: boolean; color?: string
}) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ccc', marginBottom: '2px' }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 'bold' }}>{value > 0 && unit === ' dB' ? '+' : ''}{typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(1) : value}{unit}</span>
      </div>
      <div style={{ fontSize: '11px', color: '#666', marginBottom: '5px', lineHeight: '1.4' }}>{desc}</div>
      <input type="range" min={min} max={max} step={step} value={value}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: color }}
      />
    </div>
  )
}

const DEFAULT_EQ: EQSettings = {
  enabled: false,
  highpassHz: 20, lowpassHz: 22050,
  bassGainDb: 0, band1Gain: 0, midGainDb: 0, band2Gain: 0, trebleGainDb: 0,
}

export default function EQPanel({ value, onChange, disabled }: Props) {
  const set = (k: keyof EQSettings, v: any) => onChange({ ...value, [k]: v })

  const handleReset = () => onChange({
    ...value,
    highpassHz: 20, lowpassHz: 22050,
    bassGainDb: 0, band1Gain: 0, midGainDb: 0, band2Gain: 0, trebleGainDb: 0,
  })

  return (
    <div style={{ border: '1px solid #333', borderRadius: '6px', padding: '12px', marginBottom: '10px', backgroundColor: '#1e1e1e' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <input type="checkbox" checked={value.enabled}
          onChange={e => set('enabled', e.target.checked)} disabled={disabled}
          style={{ cursor: 'pointer', width: '14px', height: '14px' }} />
        <span style={{ fontSize: '13px', fontWeight: 'bold', color: value.enabled ? '#fff' : '#888' }}>
          EQ 5-band (Cân bằng âm sắc)
        </span>
        {value.enabled && (
          <button onClick={handleReset} disabled={disabled}
            style={{ marginLeft: 'auto', fontSize: '10px', padding: '2px 6px', backgroundColor: '#333', color: '#aaa', border: '1px solid #444', borderRadius: '3px', cursor: 'pointer' }}>
            Reset
          </button>
        )}
      </div>
      <div style={{ fontSize: '11px', color: '#555', marginBottom: '10px', lineHeight: '1.4' }}>
        Điều chỉnh độ to của từng dải tần số riêng biệt — giúp cân bằng âm thanh, bù thiếu sót của loa/tai nghe, hoặc tạo màu sắc âm thanh theo thể loại nhạc.
      </div>
      <div style={{ opacity: value.enabled ? 1 : 0.4, pointerEvents: value.enabled && !disabled ? 'auto' : 'none' }}>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>Highpass (Hz)</div>
            <div style={{ fontSize: '10px', color: '#555', marginBottom: '4px', lineHeight: '1.3' }}>Cắt tần số thấp hơn giá trị này — loại bỏ tiếng ù, rung microfone, tiếng gió. Nhạc phòng thu thường 80–120Hz</div>
            <input type="range" min={20} max={500} step={5} value={value.highpassHz}
              onChange={e => set('highpassHz', Number(e.target.value))}
              disabled={disabled} style={{ width: '100%', accentColor: '#888' }} />
            <div style={{ textAlign: 'center', fontSize: '11px', color: value.highpassHz > 20 ? '#40a9ff' : '#555', fontWeight: 'bold' }}>
              {value.highpassHz > 20 ? `${value.highpassHz} Hz` : 'Tắt'}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>Lowpass (Hz)</div>
            <div style={{ fontSize: '10px', color: '#555', marginBottom: '4px', lineHeight: '1.3' }}>Cắt tần số cao hơn giá trị này — loại bỏ tiếng rít, nhiễu điện. Lo-fi thường 8000–12000Hz</div>
            <input type="range" min={4000} max={22050} step={50} value={value.lowpassHz}
              onChange={e => set('lowpassHz', Number(e.target.value))}
              disabled={disabled} style={{ width: '100%', accentColor: '#888' }} />
            <div style={{ textAlign: 'center', fontSize: '11px', color: value.lowpassHz < 20000 ? '#40a9ff' : '#555', fontWeight: 'bold' }}>
              {value.lowpassHz < 20000 ? `${value.lowpassHz} Hz` : 'Tắt'}
            </div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: '12px' }}>
          <SliderRow
            label="Bass (110 Hz — Am tram)"
            desc="Am tram — tang de nhac am, manh, nang hon; giam neu nhac bi u hoac qua nang ne"
            min={-12} max={12} step={0.5} value={value.bassGainDb} unit=" dB"
            onChange={v => set('bassGainDb', v)} disabled={disabled}
          />
          <SliderRow
            label="Low-Mid (200 Hz — Mud/Warm)"
            desc="Vung bun — giam de cat am bun, tieng 'hop', giup nhac nghe sach hon; tang de them do am. Hay giam 2-4dB cho nhac co tieng trong qua day"
            min={-12} max={12} step={0.5} value={value.band1Gain} unit=" dB"
            onChange={v => set('band1Gain', v)} disabled={disabled} color="#7c3aed"
          />
          <SliderRow
            label="Mid (1 kHz — Giong hat)"
            desc="Am giua — tang de giong hat va nhac cu ro hon; giam neu nhac nghe cung hoac choi tai"
            min={-12} max={12} step={0.5} value={value.midGainDb} unit=" dB"
            onChange={v => set('midGainDb', v)} disabled={disabled} color="#059669"
          />
          <SliderRow
            label="Presence (4 kHz — Do ro rang)"
            desc="Vung do noi bat — tang de nhac nghe 'cat through' tot hon, giong hat ro hon; giam neu nhac qua gay hoac nghe met tai"
            min={-12} max={12} step={0.5} value={value.band2Gain} unit=" dB"
            onChange={v => set('band2Gain', v)} disabled={disabled} color="#d97706"
          />
          <SliderRow
            label="Treble (10 kHz — Am cao)"
            desc="Am cao (Air) — tang de tieng hi-hat, chuong, violin sac net, nghe 'thoang' hon; giam neu nhac bi rit hoac choi tai"
            min={-12} max={12} step={0.5} value={value.trebleGainDb} unit=" dB"
            onChange={v => set('trebleGainDb', v)} disabled={disabled}
          />
        </div>
      </div>
    </div>
  )
}

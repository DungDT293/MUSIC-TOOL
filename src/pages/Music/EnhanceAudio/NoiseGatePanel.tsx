import type { NoiseGateSettings } from '../../../types/ipc'

interface Props {
  value: NoiseGateSettings
  onChange: (v: NoiseGateSettings) => void
  disabled?: boolean
}

function SliderRow({ label, desc, min, max, step, value, unit, onChange, disabled }: {
  label: string; desc: string; min: number; max: number; step: number
  value: number; unit: string; onChange: (v: number) => void; disabled?: boolean
}) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ccc', marginBottom: '2px' }}>
        <span>{label}</span>
        <span style={{ color: '#40a9ff', fontWeight: 'bold' }}>{value}{unit}</span>
      </div>
      <div style={{ fontSize: '11px', color: '#666', marginBottom: '5px', lineHeight: '1.4' }}>{desc}</div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#40a9ff' }}
      />
    </div>
  )
}

export default function NoiseGatePanel({ value, onChange, disabled }: Props) {
  const set = (k: keyof NoiseGateSettings, v: any) => onChange({ ...value, [k]: v })

  return (
    <div style={{ border: '1px solid #333', borderRadius: '6px', padding: '12px', marginBottom: '10px', backgroundColor: '#1e1e1e' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <input type="checkbox" checked={value.enabled}
          onChange={e => set('enabled', e.target.checked)} disabled={disabled}
          style={{ cursor: 'pointer', width: '14px', height: '14px' }} />
        <span style={{ fontSize: '13px', fontWeight: 'bold', color: value.enabled ? '#fff' : '#888' }}>
          Noise Gate
        </span>
      </div>
      <div style={{ fontSize: '11px', color: '#555', marginBottom: '10px', lineHeight: '1.4' }}>
        Tu dong tat tieng khi khong co am thanh — loai bo tieng on nen, tieng hiss, tieng o khi khong co ai noi/hat.
        Thich hop cho thu am, podcast, nhac cu.
      </div>
      <div style={{ opacity: value.enabled ? 1 : 0.4, pointerEvents: value.enabled && !disabled ? 'auto' : 'none' }}>
        <SliderRow label="Nguong (Threshold)" desc="Am thanh nho hon muc nay se bi tat — keo len neu con nhieu tien on, keo xuong neu cat mat tieng that" min={-80} max={-5} step={1} value={value.thresholdDb} unit=" dB" onChange={v => set('thresholdDb', v)} />
        <SliderRow label="Ti le giam (Ratio)" desc="Muc do tat tieng — 6:1 la pho bien, 20:1 = tat hoan toan" min={2} max={20} step={0.5} value={value.ratio} unit=":1" onChange={v => set('ratio', v)} />
        <SliderRow label="Phan ung (Attack)" desc="Bao lau gate mo ra sau khi co tieng — thap = nhanh, tranh cat mat chu dau" min={0.1} max={50} step={0.1} value={value.attackMs} unit=" ms" onChange={v => set('attackMs', v)} />
        <SliderRow label="Nha (Release)" desc="Bao lau gate dong lai sau khi tieng bien mat — cao = tu nhien hon, thoai mai hon" min={10} max={2000} step={10} value={value.releaseMs} unit=" ms" onChange={v => set('releaseMs', v)} />
        <SliderRow label="Muc giam (Range)" desc="Khi gate dong, giam bao nhieu dB — -24dB = van nghe duoc rat nhe, -60dB = im lang gaan nhu hoan toan" min={-60} max={-6} step={1} value={value.rangeDb} unit=" dB" onChange={v => set('rangeDb', v)} />
      </div>
    </div>
  )
}

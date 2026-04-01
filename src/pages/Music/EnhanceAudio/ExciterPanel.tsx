import type { ExciterSettings } from '../../../types/ipc'

interface Props {
  value: ExciterSettings
  onChange: (v: ExciterSettings) => void
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
      <input type="range" min={min} max={max} step={step} value={value}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#f59e0b' }}
      />
    </div>
  )
}

export default function ExciterPanel({ value, onChange, disabled }: Props) {
  const set = (k: keyof ExciterSettings, v: any) => onChange({ ...value, [k]: v })

  return (
    <div style={{ border: '1px solid #333', borderRadius: '6px', padding: '12px', marginBottom: '10px', backgroundColor: '#1e1e1e' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <input type="checkbox" checked={value.enabled}
          onChange={e => set('enabled', e.target.checked)} disabled={disabled}
          style={{ cursor: 'pointer', width: '14px', height: '14px' }} />
        <span style={{ fontSize: '13px', fontWeight: 'bold', color: value.enabled ? '#fff' : '#888' }}>
          Harmonic Exciter
        </span>
      </div>
      <div style={{ fontSize: '11px', color: '#555', marginBottom: '10px', lineHeight: '1.4' }}>
        Them harmonic (hoa am bac cao) vao vung tan so cao — giup nhac nghe "song", "sang" va "hien dien" hon
        ma khong can tang treble EQ. Phuong phap cua iZotope Ozone va Aphex Aural Exciter.
      </div>
      <div style={{ opacity: value.enabled ? 1 : 0.4, pointerEvents: value.enabled && !disabled ? 'auto' : 'none' }}>
        <SliderRow label="Tan so bat dau (Hz)" desc="Chi xu ly am tren tan so nay — 7500Hz la chuan cho nhac, 5000Hz cho guitar/nhac rock" min={2000} max={12000} step={100} value={value.freq} unit=" Hz" onChange={v => set('freq', v)} />
        <SliderRow label="Cuong do (Amount)" desc="Luong harmonic them vao — tang len thi nghe 'the' hon, nhung qua cao se boc mui mat tu nhien" min={1} max={50} step={1} value={value.amount} unit="%" onChange={v => set('amount', v)} />
        <SliderRow label="Drive" desc="Muc do sat clipping khi tao harmonic — cao = nhieu harmonic bac cao hon, am thanh gay hon" min={1} max={10} step={0.1} value={value.drive} unit="x" onChange={v => set('drive', v)} />
        <SliderRow label="Pha tron (Blend)" desc="Can bang giua harmonic chan/le — so am = am toi, so duong = sang, 0 = trung tinh" min={-10} max={10} step={0.5} value={value.blend} unit="" onChange={v => set('blend', v)} />
      </div>
    </div>
  )
}

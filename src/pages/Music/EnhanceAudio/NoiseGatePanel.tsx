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
        Tự động tắt tiếng khi không có âm thanh — loại bỏ tiếng ồn nền, tiếng hiss, tiếng ồ khi không có ai nói/hát.
        Thích hợp cho thu âm, podcast, nhạc cụ.
      </div>
      <div style={{ opacity: value.enabled ? 1 : 0.4, pointerEvents: value.enabled && !disabled ? 'auto' : 'none' }}>
        <SliderRow label="Ngưỡng (Threshold)" desc="Âm thanh nhỏ hơn mức này sẽ bị tắt — kéo lên nếu còn nhiều tiếng ồn, kéo xuống nếu cắt mất tiếng thật" min={-80} max={-5} step={1} value={value.thresholdDb} unit=" dB" onChange={v => set('thresholdDb', v)} />
        <SliderRow label="Tỉ lệ giảm (Ratio)" desc="Mức độ tắt tiếng — 6:1 là phổ biến, 20:1 = tắt hoàn toàn" min={2} max={20} step={0.5} value={value.ratio} unit=":1" onChange={v => set('ratio', v)} />
        <SliderRow label="Phản ứng (Attack)" desc="Bao lâu gate mở ra sau khi có tiếng — thấp = nhanh, tránh cắt mất chữ đầu" min={0.1} max={50} step={0.1} value={value.attackMs} unit=" ms" onChange={v => set('attackMs', v)} />
        <SliderRow label="Nhả (Release)" desc="Bao lâu gate đóng lại sau khi tiếng biến mất — cao = tự nhiên hơn, thoải mái hơn" min={10} max={2000} step={10} value={value.releaseMs} unit=" ms" onChange={v => set('releaseMs', v)} />
        <SliderRow label="Mức giảm (Range)" desc="Khi gate đóng, giảm bao nhiêu dB — -24dB = vẫn nghe được rất nhẹ, -60dB = im lặng gần như hoàn toàn" min={-60} max={-6} step={1} value={value.rangeDb} unit=" dB" onChange={v => set('rangeDb', v)} />
      </div>
    </div>
  )
}

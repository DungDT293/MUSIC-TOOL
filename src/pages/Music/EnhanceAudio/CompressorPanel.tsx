import type { CompressorSettings } from '../../../types/ipc'

interface Props {
  value: CompressorSettings
  onChange: (v: CompressorSettings) => void
  gainReduction?: number  // live dB từ Web Audio
  disabled?: boolean
}

const PARAM_DESC: Record<string, string> = {
  threshold: 'Ngưỡng âm lượng — âm thanh vượt qua mức này sẽ bị nén lại. Kéo xuống để nén nhiều hơn (phổ biến: -18 đến -12 dB)',
  ratio: 'Tỉ lệ nén — càng cao thì phần âm vượt ngưỡng càng bị kéo xuống mạnh hơn. 2:1 = nhẹ nhàng, 4:1 = phổ biến, 10:1 = aggressive, 20:1 = tương đương limiting',
  attack: 'Thời gian phản ứng — bao lâu compressor bắt đầu nén sau khi âm vượt ngưỡng. Thấp = nhanh (cắt transient), cao = để transient lọt qua (tiếng trống "punch" hơn)',
  release: 'Thời gian nhả — bao lâu compressor dừng nén sau khi âm xuống dưới ngưỡng. Thấp = nhả nhanh (có thể nghe bùm bùm), cao = tự nhiên hơn',
  makeup: 'Bù âm lượng — sau khi nén âm bị nhỏ lại, tăng tham số này để bù lại và giữ nhạc đủ to. Thường tăng bằng lượng compressor đã nén',
  knee: 'Độ mềm của ngưỡng (Soft Knee) — góc nhỏ = nén đột ngột chính xác, góc lớn = chuyển tiếp mềm mại hơn, tự nhiên hơn. 2-4 là phổ biến',
  mix: 'Pha trộn khô/ướt (Parallel Compression) — 1.0 = nén toàn bộ (wet), 0.3-0.5 = pha trộn với tín hiệu gốc (khô), giúp giữ punch và transient tự nhiên trong khi vẫn có độ nén',
}

function ParamRow({ label, descKey, min, max, step, value, unit, onChange, disabled, color = '#40a9ff' }: {
  label: string; descKey: string; min: number; max: number; step: number
  value: number; unit: string; onChange: (v: number) => void; disabled?: boolean; color?: string
}) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ccc', marginBottom: '2px' }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 'bold' }}>{value}{unit}</span>
      </div>
      <div style={{ fontSize: '11px', color: '#666', marginBottom: '5px', lineHeight: '1.4' }}>
        {PARAM_DESC[descKey]}
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: color }}
      />
    </div>
  )
}

export default function CompressorPanel({ value, onChange, gainReduction = 0, disabled }: Props) {
  const set = (k: keyof CompressorSettings, v: any) => onChange({ ...value, [k]: v })

  const grColor = gainReduction < -6 ? '#ef4444' : gainReduction < -2 ? '#f59e0b' : '#22c55e'
  const grBarWidth = Math.min(100, Math.abs(gainReduction) * 5)

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
          Dynamic Compressor
        </span>
        {value.enabled && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: '#888' }}>GR:</span>
            <span style={{ fontSize: '12px', color: grColor, fontWeight: 'bold', minWidth: '36px', textAlign: 'right' }}>
              {gainReduction.toFixed(1)} dB
            </span>
          </div>
        )}
      </div>

      <div style={{ fontSize: '11px', color: '#555', marginBottom: '10px', lineHeight: '1.4' }}>
        Tự động kéo xuống những đoạn quá to và nâng lên những đoạn quá nhỏ — giúp âm lượng đều hơn,
        không bị giật âm hay có đoạn nhỏ tiếng khó nghe. Phổ biến trong nhạc pop, podcast và phát thanh.
      </div>

      {/* Gain reduction meter */}
      {value.enabled && (
        <div style={{ marginBottom: '10px' }}>
          <div style={{ height: '4px', backgroundColor: '#333', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${grBarWidth}%`, backgroundColor: grColor, transition: 'width 0.05s linear, background-color 0.1s' }} />
          </div>
        </div>
      )}

      <div style={{ opacity: value.enabled ? 1 : 0.4, pointerEvents: value.enabled && !disabled ? 'auto' : 'none' }}>
        <ParamRow label="Threshold" descKey="threshold" min={-40} max={0} step={1}
          value={value.thresholdDb} unit=" dB" onChange={v => set('thresholdDb', v)} />
        <ParamRow label="Ratio" descKey="ratio" min={1} max={20} step={0.5}
          value={value.ratio} unit=":1" onChange={v => set('ratio', v)} />
        <ParamRow label="Attack" descKey="attack" min={0.1} max={100} step={0.1}
          value={value.attackMs} unit=" ms" onChange={v => set('attackMs', v)} />
        <ParamRow label="Release" descKey="release" min={10} max={1000} step={10}
          value={value.releaseMs} unit=" ms" onChange={v => set('releaseMs', v)} />
        <ParamRow label="Makeup Gain" descKey="makeup" min={0} max={12} step={0.5}
          value={value.makeupGainDb} unit=" dB" onChange={v => set('makeupGainDb', v)} />

        <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: '10px', marginTop: '4px' }}>
          <ParamRow label="Soft Knee" descKey="knee" min={1} max={8} step={0.1}
            value={value.knee ?? 2.83} unit="" onChange={v => set('knee', v)} color="#7c3aed" />
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ccc', marginBottom: '2px' }}>
              <span>Parallel Mix</span>
              <span style={{ color: '#d97706', fontWeight: 'bold' }}>
                {value.mix != null ? Math.round(value.mix * 100) : 100}%
                {(value.mix ?? 1) < 0.9 && <span style={{ fontSize: '10px', color: '#888', fontWeight: 'normal' }}> (parallel)</span>}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#666', marginBottom: '5px', lineHeight: '1.4' }}>
              {PARAM_DESC.mix}
            </div>
            <input type="range" min={0} max={1} step={0.05} value={value.mix ?? 1}
              disabled={disabled}
              onChange={e => set('mix', Number(e.target.value))}
              style={{ width: '100%', accentColor: '#d97706' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#555' }}>
              <span>0% (dry/gốc)</span><span>50% (blend)</span><span>100% (full wet)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

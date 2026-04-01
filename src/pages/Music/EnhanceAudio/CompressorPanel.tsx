import type { CompressorSettings } from '../../../types/ipc'

interface Props {
  value: CompressorSettings
  onChange: (v: CompressorSettings) => void
  gainReduction?: number  // live dB từ Web Audio
  disabled?: boolean
}

const PARAM_DESC: Record<string, string> = {
  threshold: 'Nguong am luong — am thanh vuot qua muc nay se bi nen lai. Keo xuong de nen nhieu hon (pho bien: -18 den -12 dB)',
  ratio: 'Ti le nen — cang cao thi phan am vuot nguong cang bi keo xuong manh hon. 2:1 = nhe nhang, 4:1 = pho bien, 10:1 = aggressive, 20:1 = tuong duong limiting',
  attack: 'Thoi gian phan ung — bao lau compressor bat dau nen sau khi am vuot nguong. Thap = nhanh (cat transient), cao = de transient lot qua (tieng trong "punch" hon)',
  release: 'Thoi gian nha — bao lau compressor dung nen sau khi am xuong duoi nguong. Thap = nha nhanh (co the nghe bom bom), cao = tu nhien hon',
  makeup: 'Bu am luong — sau khi nen am bi nho lai, tang tham so nay de bu lai va giu nhac du to. Thuong tang bang luong compressor da nen',
  knee: 'Do mem cua nguong (Soft Knee) — goc nho = nen dot ngot chinh xac, goc lon = chuyen tiep mem mai hon, tu nhien hon. 2-4 la pho bien',
  mix: 'Pha tron kho/uot (Parallel Compression) — 1.0 = nen toan bo (wet), 0.3-0.5 = pha tron voi tin hieu goc (kho), giup giu punch va transient tu nhien trong khi van co do nen',
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
        Tu dong keo xuong nhung doan qua to va nang len nhung doan qua nho — giup am luong deu hon,
        khong bi giat am hay co doan nho tieng kho nghe. Pho bien trong nhac pop, podcast va phat thanh.
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
              <span>0% (dry/goc)</span><span>50% (blend)</span><span>100% (full wet)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

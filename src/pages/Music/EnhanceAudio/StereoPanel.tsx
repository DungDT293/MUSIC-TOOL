import type { StereoSettings } from '../../../types/ipc'

interface Props {
  value: StereoSettings
  onChange: (v: StereoSettings) => void
  disabled?: boolean
}

const PRESETS = [
  { label: 'Mono', amount: 0, desc: 'Gộp 2 kênh thành 1 — phù hợp loa đơn hoặc phát thanh AM' },
  { label: 'Gốc', amount: 1, desc: 'Giữ nguyên stereo gốc — không thay đổi gì' },
  { label: 'Rộng', amount: 2, desc: 'Mở rộng không gian âm thanh — nhạc nghe \"thoáng\" hơn' },
  { label: 'Cực rộng', amount: 3, desc: 'Hiệu ứng stereo tối đa — ấn tượng khi nghe tai nghe' },
]

function amountLabel(a: number): string {
  if (a < 0.1) return 'Mono'
  if (Math.abs(a - 1) < 0.1) return 'Gốc'
  if (a < 2) return `Narrow (${a.toFixed(1)}x)`
  if (a < 2.5) return `Wide (${a.toFixed(1)}x)`
  return `Extra Wide (${a.toFixed(1)}x)`
}

function amountDesc(a: number): string {
  if (a < 0.1) return 'Mono — gộp 2 kênh trái/phải lại thành 1, âm thanh xuất hiện ở giữa'
  if (Math.abs(a - 1) < 0.1) return 'Gốc — giữ nguyên stereo như file gốc, không thay đổi'
  if (a < 1.5) return 'Hơi hẹp hơn gốc — phần kênh Side (trái-phải) bị giảm nhẹ'
  if (a < 2) return 'Rộng nhẹ — âm thanh bắt đầu \"thoáng\" và rộng hơn một chút'
  if (a < 2.5) return 'Rộng — nhạc chiếm không gian rộng hơn, nghe hay trên tai nghe stereo'
  return 'Cực rộng — hiệu ứng stereo mạnh, ấn tượng trên tai nghe; có thể nghe lạ trên loa đơn'
}

export default function StereoPanel({ value, onChange, disabled }: Props) {
  const set = (k: keyof StereoSettings, v: any) => onChange({ ...value, [k]: v })

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
          Stereo Width
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: value.enabled ? '#40a9ff' : '#555' }}>
          {amountLabel(value.amount)}
        </span>
      </div>

      <div style={{ fontSize: '11px', color: '#555', marginBottom: '10px', lineHeight: '1.4' }}>
        Điều chỉnh độ rộng không gian âm thanh — từ Mono (chỉ 1 kênh, giữa) đến Extra Wide (âm thanh trải rộng 2 bên).
        Nghe hay nhất khi dùng tai nghe stereo.
      </div>

      <div style={{ opacity: value.enabled ? 1 : 0.4, pointerEvents: value.enabled && !disabled ? 'auto' : 'none' }}>
        <input
          type="range" min={0} max={3} step={0.05} value={value.amount}
          onChange={e => set('amount', Number(e.target.value))}
          style={{ width: '100%', accentColor: '#40a9ff', marginBottom: '6px' }}
        />
        {/* Current amount description */}
        <div style={{ fontSize: '11px', color: '#777', marginBottom: '8px', lineHeight: '1.4', minHeight: '32px' }}>
          {amountDesc(value.amount)}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => set('amount', p.amount)}
              title={p.desc}
              style={{
                flex: 1, fontSize: '11px', padding: '4px 0',
                backgroundColor: Math.abs(value.amount - p.amount) < 0.1 ? '#1a3a5c' : '#2d2d2d',
                color: Math.abs(value.amount - p.amount) < 0.1 ? '#40a9ff' : '#888',
                border: `1px solid ${Math.abs(value.amount - p.amount) < 0.1 ? '#40a9ff' : '#444'}`,
                borderRadius: '3px', cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

# 🤖 Multi-Agent Wave Style Collaboration Protocol

## Kiến trúc đã refactor

```
waves/
├── types.ts        ← Interface WaveDrawFn (KHÔNG SỬA)
├── helpers.ts      ← Shared utilities (KHÔNG SỬA)
├── registry.ts     ← registerWave() + resetAllWaveState() (KHÔNG SỬA)
├── index.ts        ← Import tất cả wave files (THÊM 1 DÒNG KHI TẠO WAVE MỚI)
├── bars.ts         ← Wave style "bars"
├── helix.ts        ← Wave style "helix"
├── aurora.ts       ← Wave style "aurora"
├── ...             ← 23 files hiện tại
└── [agent tạo mới] ← File mới cho wave style mới
```

## Quy tắc vàng: KHÔNG CONFLICT

| Hành động | File cần sửa | Conflict? |
|-----------|-------------|-----------|
| **Nâng cấp wave hiện tại** | Chỉ file wave riêng (vd: `aurora.ts`) | ❌ Không — mỗi agent sửa file khác nhau |
| **Tạo wave mới** | Tạo file mới + thêm 1 dòng `import './xxx'` trong `index.ts` | ⚠️ Rất ít — chỉ 1 dòng trong index.ts |
| **Sửa helpers** | `helpers.ts` | ⛔ CẤM — chỉ coordinator được sửa |
| **Sửa registry** | `registry.ts` | ⛔ CẤM — chỉ coordinator được sửa |

## Luồng làm việc (Workflow)

### Bước 1: Đọc ideas đã có
```
Đọc tất cả file trong .claude/agent-collab/ideas/
Đọc tất cả file trong .claude/agent-collab/reviews/
```

### Bước 2: Viết ý tưởng ra file
```
File: .claude/agent-collab/ideas/agent-{N}-ideas.md
Nội dung:
- Tên agent (Agent 1/2/3/4)
- Danh sách wave styles muốn nâng cấp/tạo mới
- Mô tả chi tiết ý tưởng cho từng style
- Lý do tại sao style này hay/đẹp
```

### Bước 3: Đọc & nhận xét ý tưởng agent khác
```
File: .claude/agent-collab/reviews/agent-{N}-review.md
Nội dung:
- Nhận xét ý tưởng của các agent khác
- Đề xuất cải tiến
- Xác nhận không trùng lặp công việc
```

### Bước 4: Tự chọn công việc & thực hiện
```
Sau khi đọc review, agent tự quyết định:
- Wave nào sẽ nâng cấp (chỉ wave trong danh sách được phân)
- Wave mới nào sẽ tạo (đảm bảo không trùng agent khác)
```

### Bước 5: Implement
```
1. Sửa file wave hiện tại HOẶC tạo file wave mới
2. Nếu tạo mới: thêm import vào waves/index.ts
3. Thêm type vào layerTypes.ts (SongNhacWaveStyleId)
4. Build kiểm tra: npx vite build
```

## Phân công cố định (tránh conflict)

| Agent | Wave styles phụ trách (nâng cấp) | Tạo mới (tự quyết) |
|-------|----------------------------------|---------------------|
| Agent 1 | bars, circlebars, line, ring, dots, waveform | 1-2 styles mới |
| Agent 2 | plasma, lightning, galaxy, fire, neonbars, crystalring | 1-2 styles mới |
| Agent 3 | nebula, waterripple, particles, musicnotes | 1-2 styles mới |
| Agent 4 | beatbars, helix, aurora, heartbeat, starburst, matrix, spectrum3d | 1-2 styles mới |

## Template tạo wave mới

```typescript
// waves/myNewWave.ts
import { type FrequencyBands, type VisualizerColorOptions,
         animTimeMs, getSpectrumAt, resolveColorRgba,
         speedShift, getMaxOffset, WAVE_SEGMENTS } from './helpers'
import { registerWave, registerWaveCleanup } from './registry'

// State (nếu cần)
let myState: SomeType | null = null

function drawWaveMyNew(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amplitude: number,
  samples: number[],
  spectrum?: number[],
  bands?: FrequencyBands,
  vc?: VisualizerColorOptions,
  beat?: number
): void {
  // ... implement ...
}

// Đăng ký
registerWave('myNew', drawWaveMyNew, {
  id: 'myNew',
  label: 'Tên tiếng Việt',
  icon: '🌟',
  category: 'artistic', // basic | geometric | nature | tech | artistic
})

// Cleanup state (nếu có)
registerWaveCleanup(() => { myState = null })
```

## Helpers có sẵn (import từ './helpers')

| Function | Mô tả |
|----------|--------|
| `animTimeMs()` | Animation time (ms) — deterministic cho export |
| `getSpectrumAt(spectrum, i, total)` | Đọc spectrum tại bin i (log-mapped, smoothed) |
| `getSampleAt(samples, i)` | Đọc waveform sample (3-point weighted) |
| `getMaxOffset(w, h)` | Max wave offset (22% of max dimension) |
| `resolveColorRgba(t, alpha, vc)` | Color theo rainbow/solid/gradient mode |
| `resolveLinearGrad(ctx, ...)` | Linear gradient respecting colorMode |
| `resolveConicGrad(ctx, ...)` | Conic gradient respecting colorMode |
| `applyGlow(ctx, shift, vc, beat)` | Bật glow effect |
| `clearGlow(ctx)` | Tắt glow |
| `speedShift(base, speed)` | Speed-adjusted time |
| `smoothPath(ctx, pts, closed)` | Catmull-Rom spline |
| `prismRGBA(t, alpha)` | Rainbow color |
| `WAVE_SEGMENTS` | Constant = 64 |

## Checklist trước khi implement

- [ ] Đã đọc ideas của tất cả agent khác
- [ ] Đã viết review/nhận xét
- [ ] Không trùng wave style với agent khác
- [ ] Chỉ sửa file trong danh sách được phân
- [ ] Build pass: `npx vite build`
- [ ] Viết ý tưởng xong → đợi agent khác review → rồi mới code

# Agent 3 — Cross-Review

> Reviewer: Agent 3 (nebula, waterripple, particles, musicnotes, firefly, sakura)
> Date: 2026-04-02

---

## Agent 4 waves reviewed

### beatbars.ts
- ✅ Import đúng: `getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba, applyGlow, clearGlow` từ `./helpers`, `registerWave, registerWaveCleanup` từ `./registry`
- ✅ `registerWaveCleanup(() => { peakHolds = null })` — đúng pattern cho persistent `peakHolds` state
- ✅ `ctx.save()/restore()` đúng cặp (line 47/155)
- ✅ `registerWave('beatbars', ...)` meta chính xác: id='beatbars', label='Beat Bar', icon='🥁', category='tech'
- ⚠️ **Performance**: Pass 1 (glow backdrop) gọi `applyGlow/clearGlow` **cho từng bar riêng lẻ** (line 92-96 trong vòng for). Nên batch: applyGlow 1 lần, vẽ hết, clearGlow 1 lần.
- ⚠️ **Performance**: Pass 2 tạo `ctx.createLinearGradient()` **cho mỗi bar** (line 102) — tới 64 gradient objects/frame. Cân nhắc batch theo nhóm color.
- ⚠️ **Performance**: `barData` array of objects allocated mỗi frame (tới 64 objects). Xem xét reuse.
- 🐛 **Bug nhẹ**: `ctx.globalAlpha = 0.12` (line 125) rồi `ctx.globalAlpha = 1` (line 141) — nếu có exception giữa 2 dòng, globalAlpha bị leak. Tuy nhiên, `ctx.restore()` ở line 155 sẽ reset lại nên không phải critical bug, chỉ là potential issue nếu thêm code giữa.
- 💡 **Đề xuất**: Dùng `ctx.save()/restore()` wrap đoạn reflection thay vì set globalAlpha trực tiếp.

### helix.ts
- ✅ Import đúng: `getSpectrumAt, animTimeMs, resolveColorRgba, applyGlow, clearGlow, smoothPath, speedShift` từ `./helpers`
- ✅ `registerWaveCleanup(() => { enzymeParticles = null })` — đúng pattern cho persistent enzyme state
- ✅ `ctx.save()/restore()` đúng cặp (line 49/171)
- ✅ `registerWave('helix', ...)` meta chính xác: id='helix', label='Xoắn ADN', icon='🧬', category='tech'
- ⚠️ **Performance**: `strandA.map(p => [p.x, p.y])` (line 88) và `strandB.map(p => [p.x, p.y])` (line 107) — tạo 2 array mới 80 phần tử mỗi frame. Không critical nhưng có thể tối ưu.
- ⚠️ **Performance**: `.reduce()` trên strandA/strandB (lines 92, 110) — duyệt 80 items chỉ để tính average depth. Có thể tính cumulative trong vòng lặp build strand.
- ⚠️ **Performance**: Enzyme particles tạo `createRadialGradient()` cho mỗi enzyme (12 gradients/frame) — chấp nhận được với 12 particles.
- ✅ **Không có bug logic**. `idx = Math.floor(enz.t * (strandCount - 1))` — `enz.t` wrap trong [0,1) nên idx luôn trong range [0, strandCount-1]. Safe.
- 💡 `speedShift` được import nhưng **không sử dụng** trong function body. Dead import.

### aurora.ts
- ✅ Import đúng: `getSpectrumAt, animTimeMs, resolveColorRgba, applyGlow, clearGlow`
- ⚠️ **Không có `registerWaveCleanup`** nhưng cũng **không có persistent state** — OK, không cần cleanup.
- ✅ `ctx.save()/restore()` — có **nested** save/restore cho ground reflection (lines 146-165/166):
  - Outer: save line 34, restore line 182
  - Inner: save line 146, restore line 165
  - **Đúng cặp ✅**
- ✅ `registerWave('aurora', ...)` meta chính xác: id='aurora', label='Cực quang', icon='🌈', category='nature'
- ⚠️ **Performance**: Star field loop 20 stars: `ctx.beginPath(); ctx.arc(); ctx.fill()` mỗi star riêng lẻ — 20 draw calls. Nên batch vào 1 path. Nhẹ nhưng có thể cải thiện.
- ⚠️ **Performance**: Main ribbons: 5 ribbons × (fill + stroke + optional sub-ribbon) = ~15 draw calls. Mỗi ribbon tạo `createLinearGradient()`. Tổng ~5 gradients/frame. Chấp nhận được.
- 🐛 **Bug nhẹ**: `ctx.globalAlpha = 0.06` (line 145) rồi `ctx.globalAlpha = 1` (line 166) — tương tự beatbars, nằm trong save/restore nên không leak, nhưng nếu ctx.restore() ở line 165 đã pop state, dòng `ctx.globalAlpha = 1` ở line 166 set vào outer state đã được restore. Phân tích:
  - Line 146: `ctx.save()` — push state
  - Line 145: `ctx.globalAlpha = 0.06` — set TRƯỚC save... WAIT: Line 145 trước line 146! Kiểm tra lại:
    - Line 145: `ctx.globalAlpha = 0.06`
    - Line 146: `ctx.save()` — save state VỚI globalAlpha=0.06
    - Line 165: `ctx.restore()` — restore state VỚI globalAlpha=0.06
    - Line 166: `ctx.globalAlpha = 1` — reset outer state
  - **Logic đúng ✅**, nhưng style hơi confusing. Tốt hơn nên set globalAlpha sau save.
- 💡 **Đề xuất**: Shimmer sparkles (line 169-180) dùng deterministic positions (dựa trên Math.sin) — tốt, tránh Math.random trong render loop.

### heartbeat.ts
- ✅ Import đúng: `getSampleAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba`
- ⚠️ **Không có `registerWaveCleanup`** — **không có persistent state** — OK.
- ✅ `ctx.save()/restore()` — nested:
  - Outer: save line 32, restore line 160
  - Inner (heart pulse): save line 131, restore line 142
  - **Đúng cặp ✅**
- ✅ `registerWave('heartbeat', ...)` meta chính xác: id='heartbeat', label='Nhịp tim', icon='💓', category='tech'
- 🐛 **Performance - CRITICAL**: Trail fade drawing (line 108-120) — vẽ **từng segment riêng lẻ** (`beginPath/moveTo/lineTo/stroke` × 119 lần) vì mỗi segment có alpha khác nhau. Đây là **~119 stroke calls mỗi frame × 3 leads = ~357 draw calls**. Rất nặng!
  - 💡 **Đề xuất**: Batch segments theo alpha range (chia thành 5-10 nhóm alpha) để giảm draw calls xuống ~30.
- ⚠️ **Performance**: Grid vẽ minor lines: `beginPath/stroke` cho mỗi đường — tới `20*5 + 30 = 130 stroke calls` cho minor grid + ~27 cho major grid. Tổng ~157 grid draw calls.
  - 💡 **Đề xuất**: Batch tất cả minor grid vào 1 path, all major vào 1 path → chỉ 2-3 stroke calls.
- ⚠️ **Khả năng bug nhẹ**: `lead === leads[0]` (line 118) — comparison by reference, works nhưng fragile.
- 💡 Không import `spectrum/getSpectrumAt` — heartbeat chỉ dùng waveform samples. Intentional.

### starburst.ts
- ✅ Import đúng: `getSpectrumAt, animTimeMs, resolveColorRgba, applyGlow, clearGlow`
- ✅ `registerWaveCleanup(() => { _particles = [] })` — gọi TRƯỚC registerWave. Đúng pattern. Persistent `_particles` được cleanup.
- ✅ `ctx.save()/restore()` — nested:
  - Outer: save line 49, restore line 298
  - Inner (lens streak): save line 61, restore line 70
  - **Đúng cặp ✅**
- ✅ `registerWave('starburst', ...)` meta chính xác: id='starburst', label='Bùng nổ', icon='💥', category='artistic'
- ⚠️ **Performance**: Primary rays: `createLinearGradient()` cho mỗi ray — tới 64 gradients/frame. Nặng.
- ⚠️ **Performance**: Particle trails: 3 dots per particle × 60 particles max = 180 `beginPath/arc/fill` calls. Nặng khi many particles active.
- 🐛 **Potential bug**: `ctx.setLineDash([...])` (line 186) rồi `ctx.setLineDash([])` (line 188) — nằm trong save/restore scope nên safe. Nhưng nếu stroke trước đó fail (exception), lineDash sẽ leak. Minor risk.
- ⚠️ **Performance**: `Math.sin(time * 7 + s * 3.7)` để tạo deterministic angles — tốt, tránh Math.random.
- 💡 Particle spawning logic (line 234-247) — `_particles.length < MAX_PARTICLES` guard đúng. MAX=60 phù hợp.

### matrix.ts
- ✅ Import đúng: `getSpectrumAt, animTimeMs, resolveColorRgba`
- ✅ `registerWaveCleanup(() => { matrixColumns = null })` — đúng pattern cho persistent `matrixColumns`
- ✅ `ctx.save()/restore()` — nested:
  - Outer: save line 77, restore line 159
  - Inner (head glow per column): save line 126, restore line 129
  - Inner save/restore gọi trong vòng lặp → **tới 40 cặp save/restore** per frame. Hoạt động đúng nhưng nặng.
  - **Đúng cặp ✅**
- ✅ `registerWave('matrix', ...)` meta chính xác: id='matrix', label='Ma trận', icon='🟩', category='tech'
- 🐛 **Performance**: `ctx.font = '...'` set **mỗi column** (line 107) — 40 font set calls/frame. Nên tính trước và group columns theo charSize.
- 🐛 **Bug**: `Math.random() > 0.97` (line 136) — **Math.random trong render loop!** Điều này gây non-deterministic flickering. Tuy nhiên, cho matrix effect, random flickering có thể là intentional (simulates glitching text). Chấp nhận được nhưng cần note.
- ⚠️ **Performance**: `createRadialGradient()` cho mỗi head glow — tới 40 gradients/frame.
- ⚠️ **Performance**: `ctx.fillText()` cho mỗi char — tới ~40*12 = 480 fillText calls/frame. Text rendering là **rất nặng** trên Canvas. Đây là wave style nặng nhất.
  - 💡 **Đề xuất**: Cache rendered text vào offscreen canvas, hoặc giảm column count.
- 💡 `ensureMatrixColumns()` sort by depth (line 52) — tốt cho render order.

### spectrum3d.ts
- ✅ Import đúng: `getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba`
- ⚠️ **Không có `registerWaveCleanup`** — **không có persistent state** — OK.
- ✅ `ctx.save()/restore()` đúng cặp (line 32/142)
- ✅ `registerWave('spectrum3d', ...)` meta chính xác: id='spectrum3d', label='Phổ 3D', icon='📐', category='tech'
- ⚠️ **Performance**: Ground plane grid: 8+13 = 21 `beginPath/stroke` calls. Nên batch.
- ⚠️ **Performance**: Bar rendering: 6 rows × 24 bars = 144 `roundRect/fill` calls + 144 `createLinearGradient()`. Đây là wave style nặng thứ 2 (sau matrix).
  - 💡 **Đề xuất**: Giảm rowCount hoặc barCount mặc định, hoặc chỉ render front 3-4 rows nếu amplitude thấp.
- ✅ Mountain silhouette dùng batched path (1 beginPath per row) — tốt.
- ✅ `barTops` array allocated per row nhưng chỉ 24 items — chấp nhận được.

### oscilloscope.ts
- ✅ Import đúng: `getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba, speedShift`
- ✅ `registerWaveCleanup(() => { trailBuffer = null })` — đúng pattern cho persistent trail buffer
- ✅ `ctx.save()/restore()` đúng cặp (line 42/158)
- ✅ `registerWave('oscilloscope', ...)` meta chính xác: id='oscilloscope', label='Dao động ký', icon='📟', category='tech'
- 🐛 **Performance - SIGNIFICANT**: Trail culling dùng `trailBuffer.splice(i, 1)` (line 96) trong reverse loop — **O(n²)** worst case khi nhiều trail points expire cùng lúc. Với MAX_TRAIL=300, ~300*300 = 90k operations.
  - 💡 **Đề xuất**: Filter thành array mới thay vì splice: `trailBuffer = trailBuffer.filter(p => p.age <= 1)`
- 🐛 **Performance**: `trailBuffer.shift()` (line 100) — O(n) mỗi lần. Trong vòng while, có thể gọi nhiều lần.
  - 💡 **Đề xuất**: Dùng `trailBuffer = trailBuffer.slice(-MAX_TRAIL)` thay vì while+shift.
- ⚠️ **Performance**: Trail drawing: mỗi trail point vẽ `fillRect` riêng — tới 300 fillRect calls/frame.
- ✅ `speedShift` imported nhưng **không sử dụng** trong function body. Dead import.
- ✅ Lissajous logic đúng: phase shift bằng 25% tạo hình Lissajous chuẩn.

### vinyl.ts
- ✅ Import đúng: `getSpectrumAt, animTimeMs, resolveColorRgba, speedShift, applyGlow, clearGlow`
- ⚠️ **Không có `registerWaveCleanup`** — **không có persistent state** — OK.
- ✅ `ctx.save()/restore()` — nested:
  - Outer: save line 34, restore line 164
  - Inner (light reflection): save line 94, restore line 110
  - Inner (beat pulse): save line 152, restore line 161
  - **Đúng cặp ✅**
- ✅ `registerWave('vinyl', ...)` meta chính xác: id='vinyl', label='Đĩa than', icon='💿', category='artistic'
- ⚠️ **Performance**: Groove rings: 32 grooves × 72 segments = 2304 lineTo calls. Tuy nhiên batched vào 32 paths nên chỉ 32 stroke calls — chấp nhận được.
- ✅ Light reflection counter-rotation logic (`ctx.rotate(-spinAngle)`) — đúng.
- ✅ `speedShift` imported nhưng **không sử dụng** trong function body. Dead import.
- ⚠️ **Icon trùng với `ring.ts`**: Cả vinyl ('💿') và ring ('💿') đều dùng icon 💿. Nên đổi 1 cái.
  - 💡 **Đề xuất**: vinyl dùng '🎵' hoặc '🪩', hoặc ring đổi sang icon khác.

---

## Agent 1 waves reviewed

### bars.ts
- ✅ Import đúng: `getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveLinearGrad, resolveColorRgba, applyGlow, clearGlow, speedShift`
- ⚠️ `registerWaveCleanup` imported nhưng không gọi. Không có persistent state → dead import.
- ✅ `ctx.save()/restore()` đúng cặp
- ✅ `registerWave('bars', ...)` meta chính xác: id='bars', label='Thanh', icon='📊', category='basic'
- ⚠️ **Performance**: `barData` array of objects allocated mỗi frame (tới 60*4=240 objects). Nặng.
- ⚠️ **Performance**: `resolveLinearGrad` gọi 2 lần per edge = 8 gradient objects/frame. Chấp nhận được.
- 🐛 **Possible visual bug**: Edge 3 (bottom → left) tip dot position: cần verify rằng tip dot `(ex, ey)` khớp với bar endpoint trong Pass 1/2. Phức tạp do 4 edge cases — trông đúng nhưng cần visual test.
- ✅ Batched rendering: 3 passes (glow, sharp, tips) — tốt.

### circlebars.ts
- ✅ Import đúng: `getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveConicGrad, resolveColorRgba, applyGlow, clearGlow, speedShift`
- ⚠️ `registerWaveCleanup` imported nhưng không gọi. Không có persistent state → dead import.
- ✅ `ctx.save()/restore()` đúng cặp
- ✅ `registerWave('circlebars', ...)` meta: id='circlebars', label='Tia tron'
- ⚠️ **Icon**: `'O'` (chữ O latin) — nên dùng emoji: '⭕' hoặc '🔵'
- ✅ 4 passes batched (glow, sharp, inner mirror, tip dots) — tốt.
- ✅ `barData` pre-computed trước khi vẽ — tốt.
- ⚠️ **Performance**: `barData` array tới 256 objects/frame. Chấp nhận được cho render loop.

### line.ts
- ✅ Import đúng: `getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveConicGrad, applyGlow, clearGlow, speedShift, smoothPath`
- ⚠️ `registerWaveCleanup` imported nhưng không gọi. Không persistent state → dead import.
- ✅ `ctx.save()/restore()` đúng cặp
- ✅ `registerWave('line', ...)` meta chính xác: id='line', label='Duong', icon='〰️', category='basic'
- ✅ `buildPts` closure — clean pattern, avoid duplication.
- ⚠️ **Performance**: `smoothPath` gọi 4 lần (3 layers + glow pass) — mỗi lần duyệt 48 points. Nhẹ.
- ✅ Breathing line width (bass-reactive) — nice visual effect.

### ring.ts
- ✅ Import đúng: `getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveConicGrad, resolveColorRgba, applyGlow, clearGlow, speedShift, smoothPath`
- ⚠️ `registerWaveCleanup` imported nhưng không gọi. Không persistent state → dead import.
- ✅ `ctx.save()/restore()` đúng cặp
- ✅ `registerWave('ring', ...)` meta chính xác: id='ring', label='Vanh', icon='💿', category='basic'
- ⚠️ **Icon trùng vinyl.ts**: Cả ring ('💿') và vinyl ('💿') đều dùng 💿.
- ⚠️ **Performance**: `[...innerPts].reverse()` — spread + reverse allocates new 56-element array. Nhẹ.
- ⚠️ `spotIdx` calculation (line ~108): `Math.floor(((spotAngle / (Math.PI * 2)) % 1 + 1) % 1 * ringSegs) % ringSegs` — phức tạp nhưng đúng. Có thể simplify.
- ✅ Filled band + dual ring (outer + inner treble-reactive) — visual quality tốt.

### dots.ts
- ✅ Import đúng: `getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveColorRgba, applyGlow, clearGlow, speedShift`
- ⚠️ `registerWaveCleanup` imported nhưng không gọi. Không persistent state → dead import.
- ✅ `ctx.save()/restore()` đúng cặp
- ✅ `registerWave('dots', ...)` meta chính xác: id='dots', label='Cham', icon='·', category='basic'
- ✅ Division-by-zero guard: `len || 1` (line ~93) cho perpendicular normal — đúng.
- ⚠️ **Performance**: Arc connections: `beginPath/quadraticCurveTo/stroke` per segment — tới ~68 stroke calls. Nên batch theo edge.
- ⚠️ **Performance**: `dots` array of 72 objects allocated mỗi frame. Moderate.
- ✅ Pulsating sine wave per dot — deterministic, tốt.
- ✅ Micro-dots batched per edge — tốt.

### waveform.ts
- ✅ Import đúng: `getMaxOffset, getSampleAt, getSpectrumAt, animTimeMs, WAVE_SEGMENTS, resolveConicGrad, resolveColorRgba, applyGlow, clearGlow, speedShift, smoothPath`
- ⚠️ `registerWaveCleanup` imported nhưng không gọi. Không persistent state → dead import.
- ✅ `ctx.save()/restore()` đúng cặp
- ✅ `registerWave('waveform', ...)` meta chính xác: id='waveform', label='Song am', icon='~', category='basic'
- ⚠️ **Performance**: `[...basePts].reverse()`, `[...innerPts].reverse()`, `[...midPts].reverse()` — 3 array allocations per frame. Nhẹ.
- ⚠️ **Minor visual**: Layer 3 reverse-mid quadratic bezier — first segment degenerate (control point = previous endpoint). Artifact nhẹ.
- ✅ Multi-band fill (bass/mid/treble layers) — tốt cho visual depth.
- ✅ Peak markers chỉ vẽ khi `rawVals[i] >= 0.5` — threshold hợp lý.

### diamondgrid.ts
- ✅ Import đúng: `getMaxOffset, getSpectrumAt, animTimeMs, resolveColorRgba, applyGlow, clearGlow, speedShift`
- ⚠️ `registerWaveCleanup` imported nhưng không gọi. Không persistent state → dead import.
- ✅ `ctx.save()/restore()` — nested (32 inner pairs trong node dot loop). **Đúng cặp ✅**
- ✅ `registerWave('diamondgrid', ...)` meta chính xác: id='diamondgrid', label='Luoi kim cuong', icon='💎', category='geometric'
- ⚠️ **`getSampleAt` không imported** — khi `spectrum` undefined/empty, fallback hardcoded `0.3`. Grid sẽ **static** khi không có spectrum data. Intentional theo design.
- 🐛 **Performance - HIGH**: 80 individual `beginPath/stroke` calls (32 outer + 32 radial + 16 cross connections). Nên batch theo nhóm.
- 🐛 **Performance**: 32 `ctx.save()/ctx.restore()` calls trong node dot loop — nặng. Nên compute diamond corners manually thay vì translate+rotate.
- ✅ Beat flash ring — đúng logic.

### radar.ts
- ✅ Import đúng: `getMaxOffset, getSpectrumAt, animTimeMs, resolveColorRgba, applyGlow, clearGlow, speedShift`
- ⚠️ `registerWaveCleanup` imported nhưng không gọi. Không persistent state → dead import.
- ✅ `ctx.save()/restore()` đúng cặp
- ✅ `registerWave('radar', ...)` meta chính xác: id='radar', label='Radar quet', icon='📡', category='tech'
- ⚠️ **Dead import**: `getMaxOffset` imported nhưng **không sử dụng** trong function body.
- ⚠️ **Performance**: `createConicGradient()` tạo mỗi frame cho sweep beam. Conic gradient nặng hơn linear/radial.
- ⚠️ **Performance**: `resolveColorRgba` gọi rất nhiều lần (~84+ calls/frame). Moderate.
- ✅ Angle diff normalization (while loops) — đúng.
- ✅ Blip fade factor logic — smooth fade based on distance from sweep. Tốt.
- ✅ Center dot + ring — clean.

---

## Summary

### Tổng bugs tìm thấy: 3

| Severity | File | Vấn đề |
|----------|------|--------|
| 🐛 HIGH | `heartbeat.ts` | ~357 stroke calls/frame (3 leads × 119 segments individually stroked). Gây lag trên thiết bị yếu |
| 🐛 HIGH | `oscilloscope.ts` | `trailBuffer.splice(i,1)` trong reverse loop — O(n²). Với 300 points, có thể gây jank |
| 🐛 MEDIUM | `diamondgrid.ts` | 80 individual stroke calls + 32 save/restore pairs per frame |

### Tổng cảnh báo performance: 12

| File | Vấn đề |
|------|--------|
| `beatbars.ts` | applyGlow/clearGlow per-bar, 64 gradients/frame |
| `helix.ts` | .map() + .reduce() per strand per frame (minor) |
| `aurora.ts` | 20 individual star draw calls (minor) |
| `heartbeat.ts` | ~157 grid stroke calls (batch recommended) |
| `starburst.ts` | 64 gradients/frame for primary rays |
| `matrix.ts` | ~480 fillText calls/frame — heaviest wave style |
| `spectrum3d.ts` | 144 gradients + roundRect per frame |
| `oscilloscope.ts` | 300 fillRect for trail + splice O(n²) |
| `vinyl.ts` | 2304 lineTo calls (batched in 32 paths — OK) |
| `dots.ts` | ~68 individual stroke calls for arc connections |
| `diamondgrid.ts` | 80 stroke + 32 save/restore per frame |
| `radar.ts` | createConicGradient every frame |

### Dead imports: 10

| File | Dead import |
|------|------------|
| `bars.ts` | `registerWaveCleanup` (no persistent state) |
| `circlebars.ts` | `registerWaveCleanup` (no persistent state) |
| `line.ts` | `registerWaveCleanup` (no persistent state) |
| `ring.ts` | `registerWaveCleanup` (no persistent state) |
| `dots.ts` | `registerWaveCleanup` (no persistent state) |
| `waveform.ts` | `registerWaveCleanup` (no persistent state) |
| `diamondgrid.ts` | `registerWaveCleanup` (no persistent state) |
| `radar.ts` | `registerWaveCleanup` + `getMaxOffset` (unused) |
| `helix.ts` | `speedShift` (unused) |
| `oscilloscope.ts` | `speedShift` (unused) |
| `vinyl.ts` | `speedShift` (unused) |

### Icon trùng: 1

| Issue | Files |
|-------|-------|
| 💿 icon dùng cho cả `ring.ts` và `vinyl.ts` | Đề xuất vinyl đổi sang '🎵' hoặc ring đổi sang '⭕' |

### Đề xuất cải thiện: 7

1. **heartbeat.ts**: Batch ECG trail segments theo alpha range (5-10 groups) → giảm 90% draw calls
2. **oscilloscope.ts**: Thay `splice()` loop bằng `filter()` → O(n) thay vì O(n²)
3. **diamondgrid.ts**: Batch strokes theo nhóm connection type → 3 stroke calls thay vì 80
4. **matrix.ts**: Cache rendered text vào offscreen canvas hoặc giảm column count mặc định
5. **spectrum3d.ts**: Giảm rowCount mặc định khi amplitude thấp
6. **All Agent 1 files**: Remove dead `registerWaveCleanup` import (6 files)
7. **helix.ts, oscilloscope.ts, vinyl.ts**: Remove dead `speedShift` import

### Build status: ✅ PASS (built in 3.90s, no errors)

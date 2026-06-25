# Agent 4 — Cross-Review

## Ngày: 2026-04-03

---

## AGENT 1 waves reviewed (8 files)

### bars.ts (V2)
- ✅ **Tốt**: 3-pass rendering (glow → sharp → tip dots), beat pulse width 1.15x, rounded caps
- ✅ **Tốt**: `ctx.save()/restore()` đúng cặp
- ✅ **Tốt**: Import đầy đủ helpers cần thiết
- ✅ **Tốt**: Tối ưu — batch moveTo/lineTo trong 1 beginPath() cho pass 1 & 2
- ⚠️ **Cảnh báo**: Dòng 52 — `barData` array allocated mỗi frame (4 lần/frame cho 4 edges). Với `barsPerEdge=60`, tổng 240 objects/frame. Không nghiêm trọng nhưng có thể tối ưu bằng pre-allocated array.
- 💡 **Đề xuất**: Edge 3 (left edge), dòng 105: `ey = halfH - pos` — khi bars vẽ từ trái, tip dots ở dưới lên trên nhưng logic vị trí ngược với edge 1 (right). Kiểm tra lại visual correctness.

### circlebars.ts (V2)
- ✅ **Tốt**: Inner mirror bars (pass 3) — concept xuất sắc, tạo depth
- ✅ **Tốt**: Base ring glow on beat, tip glow dots cho high amplitude
- ✅ **Tốt**: `ctx.save()/restore()` đúng cặp
- ⚠️ **Cảnh báo**: Dòng 119, icon = `'O'` (chữ O viết hoa) — nên là emoji `'⭕'` hoặc `'◎'` để consistent với style các wave khác (tất cả đều dùng emoji/unicode)
- 💡 **Đề xuất**: Pass 4 tip glow dots chỉ hiện khi `amp > 0.5` — có thể giảm xuống `0.4` để nhiều dots hơn, tạo hiệu ứng sống động hơn

### line.ts (V2)
- ✅ **Tốt**: 3-layer depth effect (outer 1.15x, main 1.0x, inner 0.7x) — rất đẹp conceptually
- ✅ **Tốt**: Breathing line width via bass energy
- ✅ **Tốt**: Sử dụng `smoothPath()` cho bezier smoothing
- ✅ **Tốt**: `ctx.save()/restore()` đúng cặp
- ✅ Không có bug tiềm ẩn

### ring.ts (V2)
- ✅ **Tốt**: Dual ring (treble-reactive inner ring) — great frequency separation
- ✅ **Tốt**: Pulsing fill between outer and inner ring
- ✅ **Tốt**: 5 rotating glow spots orbiting outer ring
- ⚠️ **Cảnh báo**: Dòng 125, icon = `'💿'` — trùng với vinyl wave style! Cần đổi icon để phân biệt. Gợi ý: `'⭕'` hoặc `'🔘'`
- 💡 **Đề xuất**: Inner ring chỉ hiện khi `treble > 0.1` (dòng 95) — threshold thấp, ok. Nhưng `t = Math.pow(rawT, 1.3) * treble * 1.5` có thể vượt 1.0 khi treble cao → radius inner ring có thể lớn hơn outer ring. Nên clamp.

### dots.ts (V2)
- ✅ **Tốt**: Pulsating dots (individual sine phase per dot)
- ✅ **Tốt**: Arc connections via quadratic bezier — rất smooth
- ✅ **Tốt**: Outer micro-dots ring — nice detail
- ✅ **Tốt**: Batch rendering (4 draws cho dots thay vì 72)
- ✅ **Tốt**: `ctx.save()/restore()` đúng cặp
- ✅ Không có bug tiềm ẩn. Clean code.

### waveform.ts (V2)
- ✅ **Tốt**: Multi-band fill (bass/mid/treble layers) — excellent frequency visualization
- ✅ **Tốt**: Peak markers at loudest points
- ✅ **Tốt**: `smoothPath()` cho outer band
- ⚠️ **Cảnh báo**: Dòng 94-102 — `smoothPath(ctx, outerPts, false)` rồi ngay sau đó dùng `ctx.lineTo()` và `ctx.quadraticCurveTo()` cho reversed midPts. Hai phương pháp vẽ khác nhau (smoothPath vs manual quadratic) có thể tạo khoảng hở nhỏ giữa outer và mid fill. Nên thống nhất.
- 💡 **Đề xuất**: Inner band fill (dòng 71-79) không dùng smoothPath → đường viền hơi gấp khúc. Nên dùng smoothPath cho consistency.

### diamondgrid.ts (NEW)
- ✅ **Tốt**: Concept unique — category 'geometric' mới
- ✅ **Tốt**: Diamond shape (rotated square) cho node dots — creative
- ✅ **Tốt**: Cross-connections tạo diamond pattern
- ✅ **Tốt**: Beat flash ring
- ✅ **Tốt**: `ctx.save()/restore()` đúng cặp (cả outer save và inner save cho translate/rotate)
- ⚠️ **Cảnh báo**: Dòng 129-144 — `applyGlow()` gọi trong vòng lặp `for` (mỗi node) mà không batch. Nếu nhiều nodes có `t > 0.3`, sẽ gọi `applyGlow/clearGlow` rất nhiều lần. Nên batch render: tách riêng nodes có glow và vẽ 1 lần.
- 🐛 **Bug nhẹ**: Dòng 53-55 — khi `spectrum` không có, fallback là `0.3` cố định. Không dùng `getSampleAt()` như các wave khác → diamondgrid sẽ không reactive khi chưa có FFT data (chỉ có raw samples). Nên fallback giống pattern chuẩn.

### radar.ts (NEW)
- ✅ **Tốt**: Conic gradient sweep beam — rất giống radar thật
- ✅ **Tốt**: Blips chỉ hiện near sweep (within trail angle) — realistic
- ✅ **Tốt**: Fade factor based on distance from sweep
- ✅ **Tốt**: Center dot + ring
- ✅ **Tốt**: `ctx.save()/restore()` đúng cặp
- ⚠️ **Cảnh báo**: Dòng 85-86 — `rawT < 0.15 → continue` nhưng nếu ALL spectrum values < 0.15 (ví dụ pause/silence), radar hiện blank không có blips nào. Có thể thêm 1-2 static blips để radar không trống hoàn toàn.
- 💡 **Đề xuất**: `trailAngle = Math.PI * 0.4` (72°) — khá rộng. Radar thật thường trail ~30-45°. Giảm xuống `Math.PI * 0.25` sẽ realistic hơn.

---

## AGENT 2 waves reviewed (6 files)

### plasma.ts (V2)
- ✅ **Tốt**: Beat breathing + beat expansion — double-reactive
- ✅ **Tốt**: Plasma cells between rings — creative detail
- ✅ **Tốt**: `ctx.save()/restore()` đúng cặp
- ✅ **Tốt**: `ctx.globalAlpha = 0.6` cho plasma cells rồi reset `= 1` — đúng
- ⚠️ **Cảnh báo**: Dòng 91 — `ctx.globalAlpha = 0.6` set trước vòng lặp cells. Nếu cells loop throw error, globalAlpha không được reset. Tuy nhiên có `ctx.restore()` ở cuối function nên ok.
- 💡 **Đề xuất**: Chỉ có 2 rings (`ringCount = 2`). Ideas nói thêm ring breathing + plasma cells — đã implement. Nhưng có thể thêm 3rd ring ở trong cùng cho depth.

### lightning.ts (V2)
- ✅ **Tốt**: Bolt branching — sub-branch tách ra từ midpoint (40%) cho bolts mạnh
- ✅ **Tốt**: Beat flash overlay — white-blue fill cho strong beats
- ✅ **Tốt**: Thunder afterglow — radial gradient tại bolt base
- ✅ **Tốt**: Icon đã fix `⚡` (đúng emoji)
- ✅ **Tốt**: `ctx.save()/restore()` đúng cặp
- ✅ **Tốt**: RNG deterministic (seed-based sin) — no Math.random() in render loop
- ⚠️ **Cảnh báo**: Dòng 114 — `ctx.lineWidth = size * 0.004` set ngoài vòng lặp bolts ở Pass 1, nhưng bolt branches có `t * 0.6` → chúng nên mỏng hơn bolts chính. Hiện tại tất cả bolts (cả branch) vẽ cùng lineWidth.
- 💡 **Đề xuất**: Branch bolts nên có lineWidth nhỏ hơn. Có thể multiply `lineWidth *= bolt.t` để branches tự nhiên mỏng hơn.

### galaxy.ts (V2)
- ✅ **Tốt**: Twinkling stars deterministic (seed-based) — no Math.random()
- ✅ **Tốt**: Nebula glow between arms — bass-reactive
- ✅ **Tốt**: Beat spiral expansion
- ✅ **Tốt**: Dust lane depth effect (dark semi-transparent strip)
- ✅ **Tốt**: `ctx.save()/restore()` đúng cặp
- ⚠️ **Cảnh báo**: Dòng 60 — `ctx.globalAlpha = 0.4` cho nebula glow, reset ở dòng 72. Nếu `bassE <= 0.25`, globalAlpha vẫn là 1 (ok). Nhưng nếu chạy vào nebula block rồi arm path vẽ với `globalAlpha = 0.4` trước khi reset → rendering bị ảnh hưởng. Kiểm tra: reset đúng ở dòng 72 trước khi vẽ arm paths ✅ — ok.
- 💡 **Đề xuất**: 4 passes cho mỗi arm (glow, sharp, dust, white core) — 3 arms × 4 passes = 12 ctx.beginPath/stroke calls. Có thể gộp dust lane pass với sharp trail (cùng points).

### fire.ts (V2)
- ✅ **Tốt**: Bug fix `_beat` → `beat` — CRITICAL fix done
- ✅ **Tốt**: Ember particles rising from flame tips
- ✅ **Tốt**: Flame tip shifts white-yellow on high energy
- ✅ **Tốt**: Heat haze glow at base
- ✅ **Tốt**: Icon fix `🔥`
- ✅ **Tốt**: `ctx.save()/restore()` đúng cặp
- ✅ **Tốt**: Ember rendering dùng deterministic seed (position-based) — no Math.random()
- ⚠️ **Cảnh báo**: Dòng 131 — `ctx.globalAlpha = 0.8` set trước embers, reset dòng 151 = `1`. OK.
- ⚠️ **Cảnh báo**: Dòng 35 — `embers` array: objects allocated mỗi frame (non-persistent). Tối đa `12 flames × 4 edges = 48 objects/frame`. Acceptable.
- ✅ Không có persistent state, nên không cần `registerWaveCleanup()` — đúng.

### neonbars.ts (V2)
- ✅ **Tốt**: Performance optimization — 2 passes cho small bars (t < 0.3), 5 passes cho large bars
- ✅ **Tốt**: Beat pulse wave — expanding ring from center
- ✅ **Tốt**: Bar reflections (mirror ghost inward)
- ✅ **Tốt**: Connecting arcs between adjacent high bar tips
- ✅ **Tốt**: Custom `neonColorAt()` function — independent color palette, works regardless of vc.colorMode
- ✅ **Tốt**: `ctx.save()/restore()` đúng cặp
- ⚠️ **Cảnh báo**: `neonColorAt()` ignores `vc.colorMode` / `vc.color1` / `vc.color2`. User custom color settings won't apply to neonbars. This is intentional (neon theme) but inconsistent with other waves that respect `resolveColorRgba()`.
- ⚠️ **Cảnh báo**: Dòng 100 — `barTips` array allocated mỗi frame. Worst case `4 edges × 60 bars = 240 objects`. Acceptable nhưng nhiều.
- 🐛 **Bug nhẹ**: Dòng 166 — `ctx.strokeStyle = ... (t - 0.75) * 3` — khi `t = 1.0`, alpha = `0.75` — hợp lý. Nhưng khi `t > 1.0` (theoretically impossible nhưng nếu `Math.pow(raw, 1.2)` với `raw=1` thì `t=1`), alpha vẫn capped bởi canvas. OK.

### crystalring.ts (V2)
- ✅ **Tốt**: Beat breathing (radius pulses with sin)
- ✅ **Tốt**: Light ray projections from peak points outward
- ✅ **Tốt**: Color temperature warm→cool shift based on energy
- ✅ **Tốt**: Crystal facet effect (angular jumps) — unique technique
- ✅ **Tốt**: 4-pointed star sparkle particles
- ✅ **Tốt**: `smoothPath()` cho outer ring
- ✅ **Tốt**: `ctx.save()/restore()` đúng cặp
- ⚠️ **Cảnh báo**: Dòng 44-52 — `crystalColors` array (7 elements with `Math.floor()`) allocated MỖI FRAME. Nên hoist ra ngoài function hoặc cache (chỉ thay đổi khi `totalEnergy` thay đổi đáng kể).
- ⚠️ **Cảnh báo**: Giống neonbars, `crystalColor()` custom function ignores `vc.colorMode` — user colors don't apply. Intentional nhưng inconsistent.
- 💡 **Đề xuất**: Icon `💎` trùng với `diamondgrid` (Agent 1)! Cần 1 trong 2 đổi icon. Gợi ý crystalring: `🔮` (crystal ball) hoặc `✨`.

---

## Summary

| Metric | Agent 1 | Agent 2 |
|--------|---------|---------|
| Files reviewed | 8 | 6 |
| Total bugs | 1 (diamondgrid fallback) | 0 |
| Cảnh báo | 6 | 5 |
| Đề xuất | 4 | 3 |
| ctx.save/restore | ✅ All correct | ✅ All correct |
| registerWave meta | ✅ All correct | ✅ All correct |
| Persistent state cleanup | N/A (none used) | N/A (none used) |
| Import correctness | ✅ All correct | ✅ All correct |

### Critical findings:
1. **Icon conflict**: `ring.ts` icon `💿` trùng `vinyl.ts` (Agent 4) — 1 trong 2 cần đổi
2. **Icon conflict**: `crystalring.ts` icon `💎` trùng `diamondgrid.ts` (Agent 1) — 1 trong 2 cần đổi
3. **diamondgrid.ts**: Spectrum fallback = `0.3` constant thay vì dùng `getSampleAt()` → không reactive khi chỉ có raw samples
4. **neonbars + crystalring**: Custom color functions ignore user `vc.colorMode` settings — cần document rõ hoặc fallback to resolveColorRgba

### Overall quality: ⭐⭐⭐⭐ (Excellent)
Cả Agent 1 và Agent 2 code sạch, không có critical bugs, performance acceptable, V2 features đều meaningful. Vài cảnh báo nhỏ không ảnh hưởng runtime.

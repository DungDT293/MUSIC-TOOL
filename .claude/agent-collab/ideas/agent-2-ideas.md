# Agent 2 — Ideas: Effects Group

## Phân tích hiện trạng & ý tưởng nâng cấp

### 1. plasma.ts — Plasma (🌀)
**Hiện trạng**: 2 concentric rings với spectrum-driven biên dạng + inner energy glow. Đẹp nhưng hơi tĩnh, thiếu beat reaction.

**Nâng cấp**:
- ✅ Beat-reactive ring expansion: rings phình ra khi beat > threshold
- ✅ Thêm plasma cells (small bubbles) di chuyển giữa 2 rings, bass-driven
- ✅ Ring breathing: baseR dao động theo bass energy
- ✅ Color saturation boost on beat (glow intensity × beat)

---

### 2. lightning.ts — Sét (/)
**Hiện trạng**: 4-edge bolt system, khá tốt. Thiếu branching và beat flash.

**Nâng cấp**:
- ✅ Bolt branching: mỗi bolt chính có 1-2 nhánh con (t > 0.5)
- ✅ Beat flash: canvas flash trắng nhẹ khi beat > 0.8
- ✅ Thunder afterglow: persistent glow tại gốc bolt khi cường độ cao
- ✅ Sửa icon: `'/'` → `'⚡'` (icon đúng ý nghĩa hơn)

---

### 3. galaxy.ts — Thiên hà (🌌)
**Hiện trạng**: 3-arm spiral galaxy, functional nhưng stars quá đều và thiếu depth.

**Nâng cấp**:
- ✅ Twinkling stars: random sparkle particles between arms (size/alpha randomized)
- ✅ Dust lanes: subtle dark opacity gaps giữa arms tạo depth
- ✅ Beat spiral expansion: arms unwind slightly on beat
- ✅ Nebula background glow giữa spiral arms (bass-reactive)

---

### 4. fire.ts — Lửa (^)
**Hiện trạng**: flame shapes OK, nhưng `_beat` parameter bị unused! Thiếu embers/sparks.

**Nâng cấp**:
- ✅ **BUG FIX**: Sử dụng beat parameter cho flame intensity pulse
- ✅ Ember particles: random rising sparks từ đỉnh flame
- ✅ Flame tip flickering: tip color shifts white-yellow on high energy
- ✅ Heat haze: subtle color distortion tại base
- ✅ Sửa icon: `'^'` → `'🔥'`

---

### 5. neonbars.ts — Neon 3D (💡)
**Hiện trạng**: Rất chi tiết (corner glow, scanner, sparkles). Tuy nhiên hơi nặng (5 passes per bar!).

**Nâng cấp**:
- ✅ Beat pulse wave: ripple glow lan truyền từ center ra edges khi beat
- ✅ Connecting arcs: neon lines nối giữa bar tips adjacent (treble-reactive)
- ✅ Giảm passes từ 5→3 cho bars thấp (t < 0.3) → performance
- ✅ Bar reflection: mirror ghost phía trong (opacity 0.1)

---

### 6. crystalring.ts — Pha lê (💎)
**Hiện trạng**: Đẹp nhất group, nhiều effects. Có thể thêm beat breathing.

**Nâng cấp**:
- ✅ Beat breathing: ring radius pulse theo beat (inhale/exhale)
- ✅ Light ray projections: từ peak points, tia sáng chiếu ra ngoài
- ✅ Color temperature shift: warm→cool theo audio energy
- ✅ Multiple facet modes: hexagonal vs octagonal faceting

---

## Wave styles mới (2 styles)

### 7. NEW: vortex.ts — Xoáy nước (🌊)
**Category**: nature
**Mô tả**: Xoáy nước spiral với water physics simulation. Particles bị hút vào trung tâm, spectrum drives vortex strength. Treble = outer ripples, bass = suction force.
**Lý do**: Chưa có wave kiểu nước xoáy nào — waterripple là sóng lan, vortex là lực hút.

### 8. NEW: shockwave.ts — Sóng xung (💥)
**Category**: tech
**Mô tả**: Rings expanding outward từ center on beat. Mỗi beat tạo 1 ring mới, rings fade + expand. Như khi bass drop → visual shockwave blast. Spectrum drives ring thickness/color.
**Lý do**: Beat-driven effect thuần túy — hiện không wave nào phản ứng "1 beat = 1 visual event".

---

## Không trùng lặp
- Agent 1 (basic): bars, circlebars, line, ring, dots, waveform — KHÁC
- Agent 3 (nature): nebula, waterripple, particles, musicnotes — KHÁC (vortex ≠ waterripple)
- Agent 4 (tech): beatbars, helix, aurora, heartbeat, starburst, matrix, spectrum3d — KHÁC (shockwave ≠ starburst)

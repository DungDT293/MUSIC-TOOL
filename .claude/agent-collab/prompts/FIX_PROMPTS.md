# Fix Prompts — Paste vào 3 tabs agent (Agent 4 đã tự fix xong)

Agent 4 đã:
- Thêm `deterministicRandom(seed)` vào `helpers.ts` + export từ `index.ts`
- Fix matrix.ts, helix.ts (Math.random → deterministicRandom)
- Fix oscilloscope.ts (splice → filter, O(n²) → O(n))
- Batch heartbeat.ts (357 → ~24 draw calls: grid batched + ECG trails grouped by alpha)
- Remove dead imports: helix (speedShift), oscilloscope (speedShift), vinyl (speedShift, registerWaveCleanup), spectrum3d (registerWaveCleanup)

---

## 🔴 AGENT 1 — Fix bugs

```
Bạn là Agent 1. Cross-review đã tìm thấy các vấn đề trong files bạn phụ trách.

Agent 4 đã thêm helper `deterministicRandom(seed)` vào helpers.ts và export từ index.ts. Bạn có thể import nó nếu cần.

FIX CẦN LÀM (chỉ sửa files của bạn):

1. REMOVE dead `registerWaveCleanup` imports trong 7 files (không có persistent state → không cần):
   - src/features/song-nhac/runtime/render/waves/bars.ts
   - src/features/song-nhac/runtime/render/waves/circlebars.ts
   - src/features/song-nhac/runtime/render/waves/line.ts
   - src/features/song-nhac/runtime/render/waves/ring.ts
   - src/features/song-nhac/runtime/render/waves/dots.ts
   - src/features/song-nhac/runtime/render/waves/waveform.ts
   - src/features/song-nhac/runtime/render/waves/diamondgrid.ts

   Cách sửa: đổi `import { registerWave, registerWaveCleanup } from './registry'`
   → `import { registerWave } from './registry'`

2. REMOVE dead `getMaxOffset` import trong radar.ts:
   - Bỏ `getMaxOffset` khỏi import line (không dùng trong function)

3. ĐỔI ICON ring.ts: '💿' → '⭕' (trùng với vinyl.ts)
   - Sửa registerWave() meta: icon: '💿' → icon: '⭕'
   - Sửa comment ở đầu file nếu có

4. FIX diamondgrid.ts spectrum fallback:
   - Dòng có `? getSpectrumAt(...) : 0.3` — thay `0.3` bằng `getSampleAt(samples, Math.floor((i / totalCells) * 64))`
   - Thêm `getSampleAt` vào import từ './helpers'
   - Thêm `WAVE_SEGMENTS` vào import nếu dùng

5. ĐỔI ICON circlebars.ts: 'O' → '⭕' (chữ O không phải emoji)
   - Sửa registerWave() meta: icon: 'O' → icon: '◎'

   Lưu ý: ring đã đổi sang '⭕', nên circlebars dùng '◎' để khác.

SAU KHI FIX: chạy `npx vite build` để verify.
```

---

## 🟢 AGENT 2 — Fix bugs

```
Bạn là Agent 2. Cross-review đã tìm thấy các vấn đề trong files bạn phụ trách.

Agent 4 đã thêm helper `deterministicRandom(seed)` vào helpers.ts và export từ index.ts.

FIX CẦN LÀM (chỉ sửa files của bạn):

1. ĐỔI ICON crystalring.ts: '💎' → '🔮' (trùng với diamondgrid.ts)
   - Sửa registerWave() meta: icon: '💎' → icon: '🔮'

2. WRAP ctx.globalAlpha sections trong save()/restore() (4 files):

   Thay vì:
   ```
   ctx.globalAlpha = 0.6
   // ... drawing code ...
   ctx.globalAlpha = 1
   ```

   Dùng:
   ```
   ctx.save()
   ctx.globalAlpha = 0.6
   // ... drawing code ...
   ctx.restore()
   ```

   Files cần sửa:
   - plasma.ts (dòng ctx.globalAlpha = 0.6 cho plasma cells)
   - galaxy.ts (dòng ctx.globalAlpha = 0.4 cho nebula glow)
   - fire.ts (dòng ctx.globalAlpha = 0.8 cho embers)
   - crystalring.ts (dòng ctx.globalAlpha = 0.5 cho light rays)

SAU KHI FIX: chạy `npx vite build` để verify.
```

---

## 🔵 AGENT 3 — Fix bugs

```
Bạn là Agent 3. Cross-review đã tìm thấy các vấn đề trong files bạn phụ trách.

Agent 4 đã thêm helper `deterministicRandom(seed)` vào helpers.ts và export từ index.ts.
Import: `import { ..., deterministicRandom } from './helpers'`

FIX CẦN LÀM (chỉ sửa files của bạn):

1. REPLACE Math.random() → deterministicRandom() (5 files):

   a) nebula.ts — shooting star creation:
      - Math.random() trong push({angle, startR, speed, hue})
      - Dùng: deterministicRandom(animTimeMs() * 0.1 + shootingStars.length * 73.1)

   b) waterripple.ts — ripplePhases init:
      - Math.random() trong initial phase values
      - Dùng: deterministicRandom(i * 127.1 + 7)

   c) particles.ts — ensureParticles() + beat burst + respawn:
      - Thay TẤT CẢ Math.random() bằng deterministicRandom(seed) với seed phù hợp
      - Init: deterministicRandom(i * 73.1 + field_offset)
      - Respawn: deterministicRandom(animTimeMs() * 0.1 + i * 47.3)
      - Beat burst: deterministicRandom(animTimeMs() * 3 + i * 49.7)

   d) sakura.ts — ensurePetals() + beat swirl + respawn:
      - Tương tự particles.ts

   e) firefly.ts — ensureFireflies() init:
      - Thay Math.random() bằng deterministicRandom(i * seed_offset)

2. ĐỔI ICON firefly.ts: '🔥' → '🪲' (trùng với fire.ts)
   - Sửa registerWave() meta: icon: '🔥' → icon: '🪲'

3. SỬA LABELS thiếu dấu (4 files):
   - nebula.ts: 'Tinh van' → 'Tinh vân'
   - particles.ts: 'Hat sang' → 'Hạt sáng'
   - firefly.ts: 'Dom dom' → 'Đom đóm'
   - sakura.ts: 'Hoa anh dao' → 'Hoa anh đào'

SAU KHI FIX: chạy `npx vite build` để verify.
```

---

## Sau khi cả 3 agents fix xong

Agent 4 sẽ chạy final build verify + tổng kết.
Tất cả fixes chỉ sửa files riêng của mỗi agent → không conflict.

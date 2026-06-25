# Agent 2 — Cross-Review

> Reviewer: Agent 2 (Effects Group)
> Date: 2026-04-03
> Reviewed: Agent 3 (Nature Group) + Agent 4 (Tech Group)

---

## Agent 3 waves reviewed

### nebula.ts
- ✅ Tốt: Đẹp, nhiều lớp hiệu ứng (dust lanes, shooting stars, supernova, orbiting pulsar). `ctx.save()/restore()` đúng cặp. `registerWaveCleanup()` có.
- ⚠️ Cảnh báo: Label `'Tinh van'` thiếu dấu tiếng Việt — nên là `'Tinh vân'`
- 🐛 Bug: `Math.random()` dùng trong `shootingStars.push()` (angle, startR, speed, hue) — **non-deterministic cho export**. Mỗi frame có thể tạo shooting star ở vị trí khác nhau giữa preview vs export.
- 💡 Đề xuất: Dùng seeded pseudo-random dựa trên `animTimeMs()` thay vì `Math.random()`. Ví dụ: `const rng = (n) => { const x = Math.sin(seed + n * 49297) * 49297; return x - Math.floor(x) }`

### waterripple.ts
- ✅ Tốt: Code sạch, hiệu ứng nước rất thuyết phục. `smoothPath()` cho concentric rings. `registerWaveCleanup()` có. Caustic light patches rất hay.
- 🐛 Bug: `ripplePhases` init dùng `Math.random()` trong draw function — non-deterministic trên first frame khi export.
- 💡 Đề xuất: Init `ripplePhases` bằng deterministic formula: `ripplePhases.push(i * 0.523 + 0.7)` (golden ratio offset)

### particles.ts
- ✅ Tốt: Trail system, sparkle stars, bass attraction — V2 rất tốt. `registerWaveCleanup()` có. Inner `ctx.save()/restore()` cho sparkle star đúng cặp.
- ⚠️ Cảnh báo: Label `'Hat sang'` thiếu dấu — nên là `'Hạt sáng'`
- 🐛 Bug: `ensureParticles()` dùng `Math.random()` cho position, velocity, size — non-deterministic first frame export.
- 🐛 Bug: `p.y` wrap-around block reset dùng `Math.random()` — non-deterministic **mỗi frame** khi particle respawn.
- 💡 Đề xuất: Dùng deterministic seed cho particle init + respawn. Respawn dùng `Math.sin(frameCount * i * 73.1) * 0.5 + 0.5`.

### musicnotes.ts
- ✅ Tốt: Code rất tốt! Deterministic (no Math.random). H2O style faithful. `ctx.save()/restore()` đúng cặp (outer + inner cho note symbols). Không có persistent state nên không cần cleanup.
- ✅ Tốt: Grid overlay + EQ bars + corner dots rất đẹp.
- ⚠️ Cảnh báo: Dùng `ctx.roundRect()` — modern API, cần kiểm tra browser support cho Electron target.
- ⚠️ Cảnh báo: Grid drawing tạo rất nhiều line segments — có thể nặng trên canvas lớn (1920x1080). Cân nhắc giảm grid density hoặc cache.

### firefly.ts
- ✅ Tốt: Lissajous flight paths đẹp. Synchronized blink on bass creative. `registerWaveCleanup()` có. Trail system smooth.
- 🐛 Bug (MEDIUM): **Icon trùng**: `icon: '🔥'` — **TRÙNG VỚI fire.ts!** Cần đổi thành icon khác (gợi ý: `'🪲'` hoặc `'✨'`).
- ⚠️ Cảnh báo: Label `'Dom dom'` thiếu dấu — nên là `'Đom đóm'`
- 🐛 Bug: `ensureFireflies()` dùng `Math.random()` — non-deterministic first frame export.
- 💡 Đề xuất: Icon `'🪲'` phù hợp hơn cho đom đóm, tránh nhầm với `fire.ts`.

### sakura.ts
- ✅ Tốt: Petal shape drawing (bezier teardrop) rất đẹp. Depth illusion via rotation cos scale clever. `registerWaveCleanup()` có.
- ⚠️ Cảnh báo: Label `'Hoa anh dao'` thiếu dấu — nên là `'Hoa anh đào'`
- 🐛 Bug: `ensurePetals()` dùng `Math.random()` — non-deterministic first frame.
- 🐛 Bug: Beat fragment swirl dùng `Math.random()` **mỗi frame** (line: `const dist = size * 0.03 * (0.3 + Math.random() * 0.7)`). Non-deterministic cho export.
- 💡 Đề xuất: Beat fragment positions nên dùng deterministic formula dựa trên `time + i`.

---

## Agent 4 waves reviewed

### beatbars.ts
- ✅ Tốt: Code sạch. Peak hold indicators hay. `beat` used (not `_beat`). `registerWaveCleanup()` có. No `Math.random()`. `barCount` clamped ≥16.
- ✅ Tốt: Stereo-like separation + reflection ripple — V2 improvements solid.

### helix.ts
- ✅ Tốt: `beat` used. `ctx.save()/restore()` matched. `registerWaveCleanup()` có.
- 🐛 Bug (LOW): `Math.random()` trong lazy-init block (`ensureParticles` pattern) — non-deterministic trên first export frame.
- ⚠️ Cảnh báo: `speedShift` imported nhưng **không dùng** — dead import.

### aurora.ts
- ✅ Tốt: Code đẹp, deterministic (no Math.random). Star positions dùng `Math.sin(i * 7.3...)`. Ground reflection effect neat. No persistent state.
- ⚠️ Cảnh báo (LOW): `(i / (rayCount - 1))` — nếu `rayCount=1` sẽ divide by zero. Hardcoded=8 nên safe, nhưng fragile nếu thay đổi.

### heartbeat.ts
- ✅ Tốt: Code sạch, no Math.random, save/restore matched (outer + inner). No persistent state.
- ⚠️ Cảnh báo: `spectrum` parameter hoàn toàn không dùng — ECG waveform chỉ dùng `samples`. Không phải bug nhưng là wasted opportunity — có thể dùng spectrum cho heartbeat rate variation.

### starburst.ts
- ✅ Tốt: Deterministic particle spawning (`Math.sin` based). `registerWaveCleanup()` có.
- ⚠️ Cảnh báo: `samples` parameter không dùng — chỉ dùng `spectrum` và `bands`. Không phải bug.

### matrix.ts
- ✅ Tốt: `registerWaveCleanup()` có. save/restore matched.
- 🐛 Bug (HIGH): **`Math.random()` dùng MỖI FRAME** — column reset (hue, chars) + char flicker (`Math.random() > 0.97`). **Export sẽ non-deterministic!** Đây là bug nghiêm trọng nhất trong toàn bộ codebase wave.
- 💡 Đề xuất: Thay `Math.random()` bằng seeded RNG dựa trên column index + `animTimeMs()`. Char flicker dùng `Math.sin(time * 17 + colIdx * 7 + charIdx * 3) > 0.95`.

### spectrum3d.ts
- ✅ Tốt: No Math.random. save/restore matched. No persistent state.
- ⚠️ Cảnh báo: `registerWaveCleanup` imported nhưng **không gọi** — dead import, nên remove.

### oscilloscope.ts
- ✅ Tốt: `trailBuffer` persistent state + `registerWaveCleanup()` có. No Math.random.
- ⚠️ Cảnh báo: `speedShift` imported nhưng **không dùng** — dead import.

### vinyl.ts
- ✅ Tốt: Deterministic. save/restore matched (3 nested pairs balanced).
- ⚠️ Cảnh báo: `speedShift` imported nhưng **không dùng** — dead import.
- ⚠️ Cảnh báo: `registerWaveCleanup` imported nhưng **không gọi** — dead import. Không có persistent state nên đúng là không cần, nhưng nên remove import.

---

## Summary

### Bug Severity Overview

| Severity | Count | Files |
|----------|-------|-------|
| 🔴 HIGH | 1 | matrix.ts (Math.random every frame) |
| 🟡 MEDIUM | 1 | firefly.ts (icon trùng fire.ts) |
| 🟠 LOW | 7 | nebula, waterripple, particles, sakura, helix (Math.random in init/respawn) |
| ⚠️ Warning | 10 | unused imports, missing diacritics, fragile divisions |
| ✅ Clean | 5 | beatbars, aurora, heartbeat, musicnotes, starburst |

### Tổng bugs tìm thấy: 9
- 1 HIGH: matrix.ts Math.random every frame → export non-deterministic
- 1 MEDIUM: firefly.ts icon `'🔥'` trùng fire.ts
- 7 LOW: Math.random() in lazy-init or respawn (nebula, waterripple, particles×2, sakura×2, helix)

### Tổng đề xuất: 7
- Tất cả Math.random() → seeded pseudo-random
- firefly icon → `'🪲'`
- Labels thiếu dấu tiếng Việt (4 files Agent 3)
- Remove unused imports (4 files Agent 4)
- spectrum3d, vinyl: remove dead `registerWaveCleanup` import
- helix, oscilloscope, vinyl: remove dead `speedShift` import

### Build status: ✅ PASS (verified `npx vite build`)

### Pattern Issue — `Math.random()` in Export
Vấn đề lớn nhất xuyên suốt là `Math.random()` trong draw functions. Kiến trúc đã có `animTimeMs()` deterministic clock, nhưng nhiều wave dùng `Math.random()` cho:
1. Lazy init (first frame): particles, firefly, waterripple, helix, sakura
2. Respawn (every frame): particles, nebula shooting stars, sakura beat fragments, matrix columns
3. Char flicker (every frame): matrix

→ **Đề xuất cho coordinator**: Thêm helper `deterministicRandom(seed: number): number` vào `helpers.ts` dựa trên `animTimeMs()` + seed, để tất cả agents dùng chung pattern.

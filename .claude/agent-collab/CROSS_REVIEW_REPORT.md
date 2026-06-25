# Cross-Review Consolidated Report — Tổng hợp 4 agents

## Ngày: 2026-04-03

---

## 🔴 BUG NGHIÊM TRỌNG — Cần fix ngay

### 1. `Math.random()` trong render loop (Export Non-Deterministic)
**Phát hiện bởi**: Agent 1, Agent 2, Agent 3 (cross-confirmed)

| # | File | Agent sửa | Vấn đề | Severity |
|---|------|-----------|--------|----------|
| 1 | `matrix.ts` | **Agent 4** | `Math.random() > 0.97` flicker + column reset — **mỗi frame** | 🔴 HIGH |
| 2 | `nebula.ts` | Agent 3 | `Math.random()` trong shooting star creation | 🟡 MEDIUM |
| 3 | `particles.ts` | Agent 3 | `Math.random()` trong beat burst + respawn | 🟡 MEDIUM |
| 4 | `sakura.ts` | Agent 3 | `Math.random()` trong beat swirl + respawn | 🟡 MEDIUM |
| 5 | `waterripple.ts` | Agent 3 | `Math.random()` trong ripplePhases init | 🟠 LOW |
| 6 | `helix.ts` | **Agent 4** | `Math.random()` trong enzyme init | 🟠 LOW |
| 7 | `firefly.ts` | Agent 3 | `Math.random()` trong ensureFireflies init | 🟠 LOW |

**Giải pháp thống nhất**: Thêm `deterministicRandom(seed)` helper vào `helpers.ts` (Agent 2 đề xuất). Pattern:
```typescript
export function deterministicRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297
  return x - Math.floor(x)
}
```

### 2. Performance-critical: heartbeat.ts ~357 stroke calls/frame
**Phát hiện bởi**: Agent 3
- 3 ECG leads × 119 individual stroke calls = ~357 draw calls/frame
- **Agent 4 fix**: Batch segments theo alpha range (5-10 groups)

### 3. Performance: oscilloscope.ts `splice()` O(n²)
**Phát hiện bởi**: Agent 3
- `trailBuffer.splice(i, 1)` trong reverse loop — O(n²) worst case
- **Agent 4 fix**: Thay bằng `trailBuffer = trailBuffer.filter(...)`

---

## 🟡 ICON CONFLICTS — Cần đổi icon

| Conflict | File 1 | File 2 | Agent giải quyết |
|----------|--------|--------|-----------------|
| 💿 trùng | `ring.ts` (Agent 1) | `vinyl.ts` (Agent 4) | Agent 1 đổi ring → `⭕` |
| 💎 trùng | `crystalring.ts` (Agent 2) | `diamondgrid.ts` (Agent 1) | Agent 2 đổi crystalring → `🔮` |
| 🔥 trùng | `fire.ts` (Agent 2) | `firefly.ts` (Agent 3) | Agent 3 đổi firefly → `🪲` |

---

## ⚠️ DEAD IMPORTS — Dọn dẹp

### Agent 1 files (6 files):
- `bars.ts`, `circlebars.ts`, `line.ts`, `ring.ts`, `dots.ts`, `waveform.ts`, `diamondgrid.ts`, `radar.ts`
- Dead: `registerWaveCleanup` (không có persistent state)
- `radar.ts`: thêm dead `getMaxOffset`

### Agent 4 files (3 files):
- `helix.ts`, `oscilloscope.ts`, `vinyl.ts` — Dead: `speedShift`
- `vinyl.ts`, `spectrum3d.ts` — Dead: `registerWaveCleanup`

---

## ⚠️ LABEL THIẾU DẤU (Agent 3)

| File | Hiện tại | Nên sửa |
|------|----------|---------|
| `nebula.ts` | 'Tinh van' | 'Tinh vân' |
| `particles.ts` | 'Hat sang' | 'Hạt sáng' |
| `firefly.ts` | 'Dom dom' | 'Đom đóm' |
| `sakura.ts` | 'Hoa anh dao' | 'Hoa anh đào' |

---

## 📋 ACTION PLAN — Ai làm gì

### Phase 1: Coordinator (bạn) tạo shared helper
- [ ] Thêm `deterministicRandom(seed)` vào `helpers.ts`
- [ ] Export từ `index.ts`

### Phase 2: Mỗi agent fix bugs trong files mình (song song, không conflict)

**Agent 1** fix:
- [ ] Remove dead `registerWaveCleanup` imports (6 files)
- [ ] Remove dead `getMaxOffset` from `radar.ts`
- [ ] Đổi icon `ring.ts` → `⭕`
- [ ] Fix `diamondgrid.ts` spectrum fallback (dùng `getSampleAt()`)

**Agent 2** fix:
- [ ] Đổi icon `crystalring.ts` → `🔮`
- [ ] Wrap `ctx.globalAlpha` sections trong `save()/restore()` (plasma, galaxy, fire, crystalring)

**Agent 3** fix:
- [ ] Replace `Math.random()` → `deterministicRandom()` trong nebula, particles, sakura, waterripple, firefly
- [ ] Đổi icon `firefly.ts` → `🪲`
- [ ] Sửa labels thiếu dấu (4 files)

**Agent 4** fix:
- [ ] Replace `Math.random()` → `deterministicRandom()` trong matrix.ts + helix.ts
- [ ] Batch heartbeat.ts ECG trail segments (giảm ~357 → ~30 draw calls)
- [ ] Fix oscilloscope.ts `splice()` → `filter()`
- [ ] Remove dead `speedShift` imports (helix, oscilloscope, vinyl)
- [ ] Remove dead `registerWaveCleanup` imports (vinyl, spectrum3d)

### Phase 3: Build verify
- [ ] `npx vite build` — 0 errors required

---

## Prompt cho 4 agents fix bugs

> Paste prompt tương ứng vào mỗi tab agent. Cả 4 chạy song song.

### Trước tiên — bạn (coordinator) cần:
Thêm helper `deterministicRandom` vào `helpers.ts` rồi mới paste prompt cho agents.

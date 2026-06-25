# Cross-Review Prompts — Paste vào 4 tab song song

Mỗi agent nhận 1 prompt bên dưới. Paste vào tab tương ứng. Cả 4 chạy cùng lúc, mỗi agent đọc code của 2 agents khác (không đọc chính mình) → tổng 4 review files, không conflict.

---

## 🔴 AGENT 1 — Cross-review Agent 2 + Agent 3

```
Bạn là Agent 1 trong hệ thống 4 agents phát triển wave styles cho ứng dụng trộn nhạc.
Nhiệm vụ bây giờ: CROSS-REVIEW — kiểm tra code thực tế của Agent 2 và Agent 3.

📖 Đọc protocol: .claude/agent-collab/CROSS_REVIEW_PROTOCOL.md

BƯỚC 1: Đọc các file wave CỦA AGENT 2:
- src/features/song-nhac/runtime/render/waves/plasma.ts
- src/features/song-nhac/runtime/render/waves/lightning.ts
- src/features/song-nhac/runtime/render/waves/galaxy.ts
- src/features/song-nhac/runtime/render/waves/fire.ts
- src/features/song-nhac/runtime/render/waves/neonbars.ts
- src/features/song-nhac/runtime/render/waves/crystalring.ts

BƯỚC 2: Đọc các file wave CỦA AGENT 3:
- src/features/song-nhac/runtime/render/waves/nebula.ts
- src/features/song-nhac/runtime/render/waves/waterripple.ts
- src/features/song-nhac/runtime/render/waves/particles.ts
- src/features/song-nhac/runtime/render/waves/musicnotes.ts
- src/features/song-nhac/runtime/render/waves/firefly.ts
- src/features/song-nhac/runtime/render/waves/sakura.ts

BƯỚC 3: Với mỗi file, kiểm tra:
1. Import đúng helpers? (resolveColorRgba, animTimeMs, getSpectrumAt...)
2. Có bug tiềm ẩn? (unused params, division by zero, out-of-bounds)
3. Performance: vòng lặp lồng nhau? object allocation trong render loop?
4. ctx.save()/restore() đúng cặp?
5. registerWave() meta chính xác?
6. Persistent state có registerWaveCleanup()?

BƯỚC 4: Ghi kết quả vào:
.claude/agent-collab/cross-reviews/agent-1-crossreview.md

BƯỚC 5: Chạy npx vite build để verify toàn bộ project vẫn build pass.

CHỈ ĐỌC, KHÔNG SỬA file của agent khác. Ghi bug/đề xuất vào review file.
```

---

## 🟢 AGENT 2 — Cross-review Agent 3 + Agent 4

```
Bạn là Agent 2 trong hệ thống 4 agents phát triển wave styles cho ứng dụng trộn nhạc.
Nhiệm vụ bây giờ: CROSS-REVIEW — kiểm tra code thực tế của Agent 3 và Agent 4.

📖 Đọc protocol: .claude/agent-collab/CROSS_REVIEW_PROTOCOL.md

BƯỚC 1: Đọc các file wave CỦA AGENT 3:
- src/features/song-nhac/runtime/render/waves/nebula.ts
- src/features/song-nhac/runtime/render/waves/waterripple.ts
- src/features/song-nhac/runtime/render/waves/particles.ts
- src/features/song-nhac/runtime/render/waves/musicnotes.ts
- src/features/song-nhac/runtime/render/waves/firefly.ts
- src/features/song-nhac/runtime/render/waves/sakura.ts

BƯỚC 2: Đọc các file wave CỦA AGENT 4:
- src/features/song-nhac/runtime/render/waves/beatbars.ts
- src/features/song-nhac/runtime/render/waves/helix.ts
- src/features/song-nhac/runtime/render/waves/aurora.ts
- src/features/song-nhac/runtime/render/waves/heartbeat.ts
- src/features/song-nhac/runtime/render/waves/starburst.ts
- src/features/song-nhac/runtime/render/waves/matrix.ts
- src/features/song-nhac/runtime/render/waves/spectrum3d.ts
- src/features/song-nhac/runtime/render/waves/oscilloscope.ts
- src/features/song-nhac/runtime/render/waves/vinyl.ts

BƯỚC 3: Với mỗi file, kiểm tra:
1. Import đúng helpers? (resolveColorRgba, animTimeMs, getSpectrumAt...)
2. Có bug tiềm ẩn? (unused params, division by zero, out-of-bounds)
3. Performance: vòng lặp lồng nhau? object allocation trong render loop?
4. ctx.save()/restore() đúng cặp?
5. registerWave() meta chính xác?
6. Persistent state có registerWaveCleanup()?

BƯỚC 4: Ghi kết quả vào:
.claude/agent-collab/cross-reviews/agent-2-crossreview.md

BƯỚC 5: Chạy npx vite build để verify toàn bộ project vẫn build pass.

CHỈ ĐỌC, KHÔNG SỬA file của agent khác. Ghi bug/đề xuất vào review file.
```

---

## 🔵 AGENT 3 — Cross-review Agent 4 + Agent 1

```
Bạn là Agent 3 trong hệ thống 4 agents phát triển wave styles cho ứng dụng trộn nhạc.
Nhiệm vụ bây giờ: CROSS-REVIEW — kiểm tra code thực tế của Agent 4 và Agent 1.

📖 Đọc protocol: .claude/agent-collab/CROSS_REVIEW_PROTOCOL.md

BƯỚC 1: Đọc các file wave CỦA AGENT 4:
- src/features/song-nhac/runtime/render/waves/beatbars.ts
- src/features/song-nhac/runtime/render/waves/helix.ts
- src/features/song-nhac/runtime/render/waves/aurora.ts
- src/features/song-nhac/runtime/render/waves/heartbeat.ts
- src/features/song-nhac/runtime/render/waves/starburst.ts
- src/features/song-nhac/runtime/render/waves/matrix.ts
- src/features/song-nhac/runtime/render/waves/spectrum3d.ts
- src/features/song-nhac/runtime/render/waves/oscilloscope.ts
- src/features/song-nhac/runtime/render/waves/vinyl.ts

BƯỚC 2: Đọc các file wave CỦA AGENT 1:
- src/features/song-nhac/runtime/render/waves/bars.ts
- src/features/song-nhac/runtime/render/waves/circlebars.ts
- src/features/song-nhac/runtime/render/waves/line.ts
- src/features/song-nhac/runtime/render/waves/ring.ts
- src/features/song-nhac/runtime/render/waves/dots.ts
- src/features/song-nhac/runtime/render/waves/waveform.ts
- src/features/song-nhac/runtime/render/waves/diamondgrid.ts
- src/features/song-nhac/runtime/render/waves/radar.ts

BƯỚC 3: Với mỗi file, kiểm tra:
1. Import đúng helpers? (resolveColorRgba, animTimeMs, getSpectrumAt...)
2. Có bug tiềm ẩn? (unused params, division by zero, out-of-bounds)
3. Performance: vòng lặp lồng nhau? object allocation trong render loop?
4. ctx.save()/restore() đúng cặp?
5. registerWave() meta chính xác?
6. Persistent state có registerWaveCleanup()?

BƯỚC 4: Ghi kết quả vào:
.claude/agent-collab/cross-reviews/agent-3-crossreview.md

BƯỚC 5: Chạy npx vite build để verify toàn bộ project vẫn build pass.

CHỈ ĐỌC, KHÔNG SỬA file của agent khác. Ghi bug/đề xuất vào review file.
```

---

## 🟡 AGENT 4 — Cross-review Agent 1 + Agent 2

```
Bạn là Agent 4 trong hệ thống 4 agents phát triển wave styles cho ứng dụng trộn nhạc.
Nhiệm vụ bây giờ: CROSS-REVIEW — kiểm tra code thực tế của Agent 1 và Agent 2.

📖 Đọc protocol: .claude/agent-collab/CROSS_REVIEW_PROTOCOL.md

BƯỚC 1: Đọc các file wave CỦA AGENT 1:
- src/features/song-nhac/runtime/render/waves/bars.ts
- src/features/song-nhac/runtime/render/waves/circlebars.ts
- src/features/song-nhac/runtime/render/waves/line.ts
- src/features/song-nhac/runtime/render/waves/ring.ts
- src/features/song-nhac/runtime/render/waves/dots.ts
- src/features/song-nhac/runtime/render/waves/waveform.ts
- src/features/song-nhac/runtime/render/waves/diamondgrid.ts
- src/features/song-nhac/runtime/render/waves/radar.ts

BƯỚC 2: Đọc các file wave CỦA AGENT 2:
- src/features/song-nhac/runtime/render/waves/plasma.ts
- src/features/song-nhac/runtime/render/waves/lightning.ts
- src/features/song-nhac/runtime/render/waves/galaxy.ts
- src/features/song-nhac/runtime/render/waves/fire.ts
- src/features/song-nhac/runtime/render/waves/neonbars.ts
- src/features/song-nhac/runtime/render/waves/crystalring.ts

BƯỚC 3: Với mỗi file, kiểm tra:
1. Import đúng helpers? (resolveColorRgba, animTimeMs, getSpectrumAt...)
2. Có bug tiềm ẩn? (unused params, division by zero, out-of-bounds)
3. Performance: vòng lặp lồng nhau? object allocation trong render loop?
4. ctx.save()/restore() đúng cặp?
5. registerWave() meta chính xác?
6. Persistent state có registerWaveCleanup()?

BƯỚC 4: Ghi kết quả vào:
.claude/agent-collab/cross-reviews/agent-4-crossreview.md

BƯỚC 5: Chạy npx vite build để verify toàn bộ project vẫn build pass.

CHỈ ĐỌC, KHÔNG SỬA file của agent khác. Ghi bug/đề xuất vào review file.
```

---

## Sơ đồ review chéo (mỗi agent review 2 agents, mỗi agent được 2 agents review)

```
Agent 1 ──review──▶ Agent 2, Agent 3
Agent 2 ──review──▶ Agent 3, Agent 4
Agent 3 ──review──▶ Agent 4, Agent 1
Agent 4 ──review──▶ Agent 1, Agent 2

→ Mỗi agent được 2 người review khác nhau ✅
→ Không ai review chính mình ✅
→ File output riêng biệt, không conflict ✅
```

## Sau khi cả 4 hoàn thành

Tổng hợp: đọc tất cả 4 file trong `cross-reviews/` → tạo danh sách bugs cần fix.
Mỗi agent tự fix bugs trong files mình phụ trách dựa trên feedback từ cross-review.

# Chức năng 13 — Sóng nhạc (Music Visualizer)

**Trạng thái:** **Tầng 1 (Core)** + **Tầng 3 (Export UX v1)** xong; **Audio Input** chưa → user chưa có nguồn audio thật để preview/export. **Tầng 2 (Editor)** chưa.  
**Chi tiết kiến trúc:** `docs/RFC_MUSIC_VISUALIZER_V2_AND_EXPORT_PHASE2.md`.

**Đã xong (thật sự dùng được về kỹ thuật):**
- Export: backend FFmpeg + offscreen + dialog (preset, range, progress, cancel, retry CPU). UI gọi `exportVideo` → backend chạy đúng.

**Chưa xong — thiếu đúng 1 mảnh: AUDIO INPUT**

| Mảnh | Trạng thái |
|------|------------|
| Audio source (file / playlist / drag-drop) | ❌ |
| Gắn audio vào Preview + Timeline + Export | ❌ |
| TrackDuration thật | ❌ |
| Export range / Full track dựa trên audio thật | ❌ |

Hiện export dùng `DEFAULT_EXPORT_AUDIO_URL` (demo). Timeline có waveform chỉ khi bấm "Play demo". User không chọn được audio → cảm giác "chưa dùng được" là **đúng**. Bước tiếp theo bắt buộc: **Bước 6 — Audio Input & Binding** (contract trước, code sau).

**Checkpoint:** Tag `song-nhac-export-v1` — commit `1ff2026b372eddbb1e8831875f4687687036a21b` (ghi trong RFC nếu cần).

---

## Layout contract

| Vùng | Trách nhiệm | Gắn với |
|------|-------------|--------|
| Toolbar | Play \| Export \| Preview quality — command surface only, không FFT/audio | IPC + Orchestrator |
| Left panel | Layers (scroll riêng), Engines | Zustand (UI-only) |
| **Preview** | Dual-canvas / Gizmo — **đen, không mock** | visualizer-runtime (ref + useEffect) |
| Right panel | Inspector, Engine params | Zustand (UI-only) |
| Timeline | Waveform / beat — canvas riêng, precomputed data | Worker → data → Canvas |

---

## 🔒 Contract khóa (PreviewViewport)

- **Không** subscribe FFT / currentTime / waveform.
- **Không** setState theo frame.
- Canvas lifecycle nằm trong runtime; UI chỉ cung cấp container ref.
- **FPS:** do runtime push (throttle 500ms). React chỉ render text. ❌ Không tính FPS trong React.

---

## UI–Performance checklist

- [ ] **Preview:** Canvas không nằm trong React re-render tree; PreviewViewport dùng ref + useEffect.
- [ ] **Zustand:** Chỉ subscribe `selectedLayerId`, `activeEngine`, `play/pause`. Không subscribe FFT, currentTime, waveform.
- [ ] **Timeline:** Waveform render bằng Canvas riêng; beat markers từ precomputed data.
- [ ] **Scroll:** Scroll Layers không ảnh hưởng Preview.
- [ ] **Resize:** Resize window không trigger re-render React của Preview (canvas resize qua ResizeObserver là OK).

---

## Lộ trình gắn runtime & export (đúng thứ tự)

1. **Bước 1 — Runtime “rỗng”** ✅ **DONE (Official)**  
   WebGL + Canvas2D + Composite, test pattern. Resize / quality / FPS push. UI shell đóng băng contract; Preview 100% ngoài React render tree.

2. **Bước 2 — AudioAnalyzer (preview-only)** ✅ **DONE**  
   - `runtime/audio/AudioAnalyzerRealtime.ts`: AudioContext, AnalyserNode, getFrequencyData / getWaveformData.  
   - Runtime pull FFT trong RAF; không callback / setState / store. nhạc chạy → FFT thay đổi; overlay test pattern “nhúc nhích”; 0 re-render theo frame; pause → FFT đứng; không file ngoài runtime import FFT.

3. **Bước 3 — Engine đầu tiên (WaveBars)** ✅ **DONE (Official)**  
   - `runtime/engine/`: VisualizerEngine, EngineHost, WaveBarsEngine.  
   - Engine chỉ nhận time + FFT → vẽ; không React / Zustand / Export.  
   - attachAudio() trong runtime; timeSec = clock preview; quality scale không ảnh hưởng logic engine.

4. **Bước 4 — Timeline data precompute** ✅ **DONE (Official)**  
   - Timeline không FFT realtime; waveform + beat precompute bằng Worker.  
   - TimelineView redraw event-based, không RAF; Preview FPS không ảnh hưởng; không import chéo runtime/audio/engine.

5. **Bước 5 — Export Phase 2 (Deterministic)** ✅ **DONE (Production-grade)**  
   - Runtime: Preview & Export dùng chung `renderOneFrame()`; loop deterministic (timeSec = i/fps); TimeSource / AudioSourceExport / FrameSink; IPC sẵn.  
   - Backend: Offscreen window, FFmpeg pipe (rawvideo RGBA + backpressure + drain), Progress + Cancel end-to-end, handshake config ack, queue limit, frame validation, NVENC→CPU retry.  
   - **Chốt:** Mọi sai khác Preview ≠ Export chỉ có thể nằm ở render-core/engine.

6. **Bước 6 — Audio Input & Binding** ⏭️ **TIẾP THEO (chốt làm)**  
   - Mục tiêu: User chọn audio → preview chạy → timeline có waveform → export dùng audio đó.  
   - Nguồn audio: ưu tiên (A) track từ playlist trong app; (B) chọn file riêng để sau.  
   - Binding: AudioSource (UI) → PreviewViewport.attachAudio(audioEl) → Timeline precompute (Worker) → ExportConfig.audioFileUrl.  
   - UX: hiển thị tên + duration; Export enable khi có audio, Full track = duration thật; chưa có audio → disable Export, text "Load audio to export".  
   - **Không:** đưa audio/FFT vào Zustand, FFT trong React, đụng export backend.  
   - **Contract chi tiết:** [CONTRACT_BUOC_6_AUDIO_INPUT.md](CONTRACT_BUOC_6_AUDIO_INPUT.md) (file được sửa / không được đụng, luồng binding, UX, checklist pass/fail).

---

## Trạng thái kiến trúc (editor-grade)

```
UI (React)          → Toolbar, PreviewViewport, Timeline, Panels (command surface / precompute)
Runtime (imperative)→ AudioAnalyzerRealtime, EngineHost + WaveBarsEngine, CanvasHost, renderOneFrame (shared)
Export (deterministic)→ ExportRuntime (for-loop), AudioSourceExport (seek), FrameSink (buffer → ffmpeg), IPC boundary ready
```

---

## Wiring (đã hoàn tất)

- **A. Offscreen + ExportRunner** ✅ — Main tạo window ẩn, load `#export`; ready ping → config; ExportRunner nhận config ack → runExportRuntime, sendExportFrame (transfer buffer), sendExportDone.
- **B. FFmpeg pipe (Main)** ✅ — `songNhacFfmpegPipe.ts`: spawn rawvideo + audio mux, writeFrame + drain, endInput idempotent, waitForExit (once). Main writer loop enqueue → pipe stdin; closeStdinAndFinish mọi đường thoát.
- **C. Audio mux** ✅ — file path từ fileURLToPath; không phải file:// thì export video-only.

---

## Harden (tùy chọn, chưa bắt buộc)

- **AudioSourceExport:** Hiện seek → delay 50ms → FFT. Production có thể chờ `timeupdate`/`seeked` hoặc `|audio.currentTime - timeSec| < 2ms`.
- **yield setTimeout(0):** Đúng cho in-window; khi chuyển offscreen có thể bỏ (export chạy renderer riêng).
- **FrameSink:** Khi gắn FFmpeg, `writeFrame()` phải pipe thẳng stdin, không giữ frame trong RAM.

---

## Checklist ship-ready (sau khi hoàn tất offscreen + FFmpeg)

- [ ] Export 5–10 phút video không lệch audio
- [ ] Preview vs Export giống nhau về chuyển động
- [ ] Máy yếu → export chậm, video vẫn mượt
- [ ] Cancel export giữa chừng không crash
- [ ] UI không freeze

## Harden & test (production-grade)

**Edge cases đã khóa:** (A) Frame/progress/done sau cancel/settled → drop. (B) Queue + noMoreFrames; accept frame đến hết rồi mới end stdin. (C) FFmpeg stderr consumed. (D) Cancel → SIGTERM, sau 2s SIGKILL nếu còn sống. (E) Audio không phải `file://` → bỏ qua mux, export video-only + log warn. (F) Validate frame size = W×H×4; sai → fail job. Queue limit MAX_QUEUE_FRAMES=120, vượt → fail job; cảnh báo khi queue > 60.

**Smoke tests:** Export 10s 320×180 30fps; 10s 1920×1080 60fps; Cancel ở ~10% / 50% / 90%; Start export 2 lần liên tiếp (cleanup sạch); Đóng app khi đang export.

**Đã có:** Encoder retry (NVENC fail → suggestedRetryWithCpu + retryConfig, UI retry 1 lần). Queue warn > 60; frame drop warn (waiting ack / no pipe).

---

## Ba tầng hoàn chỉnh (định nghĩa đúng tài liệu)

| Tầng | Nội dung | Trạng thái |
|------|----------|------------|
| **1. Core kỹ thuật** | Engine + export pipeline (runtime, FFmpeg, offscreen, progress/cancel) | ✅ **đã xong** |
| **2. Editor / Edit workflow** | Layer (add/remove/reorder), engine per layer, Inspector, playhead sync timeline, keyframe, beat-sync | ❌ chưa làm |
| **3. User Export flow** | Export dialog (resolution, fps, duration, range), preset, progress/cancel/retry CPU | ✅ **v1 xong** |
| **Audio Input** | Nguồn audio (playlist / file) → Preview + Timeline + Export | ❌ **chưa** (thiếu mảnh này nên user chưa “dùng được” thật) |

**Thứ tự làm:** Trước hết **Bước 6 — Audio Input & Binding** (đã chốt). Sau đó: 1️⃣ EDIT hoặc 3️⃣ PRESET/TEMPLATE.

## Roadmap kỹ thuật

| Bước | Nội dung | Trạng thái |
|------|----------|------------|
| [1] | Runtime skeleton | ✅ |
| [2] | AudioAnalyzer (preview) | ✅ |
| [3] | Engine system (WaveBars) | ✅ |
| [4] | Timeline precompute (Worker) | ✅ |
| [5] | Export Phase 2 (Deterministic) backend | ✅ |
| [6] | **Audio Input & Binding** (playlist / file → preview, timeline, export) | ⏭️ **tiếp theo** |
| [7] | EXPORT VIDEO UX (dialog, preset, range, progress, retry) | ✅ |
| [8] | EDIT (layer + engine + inspector) | ⏭️ |
| [9] | PRESET/TEMPLATE | ⏭️ |

---

## 🔒 Freeze — Do-not-touch list

**Không sửa** (trừ khi fix bug): `renderOneFrame`, `ExportRuntime`, `songNhacFfmpegPipe`, IPC handlers song-nhac (`export-video`, `export-ready`, `export-config-ack`, `export-frame`, `export-progress`, `export-done`, `export-cancel`), writer loop & `closeStdinAndFinish` trong main.

Mọi thay đổi engine/layer phải đi qua **interface** (VisualizerEngine, FrameSink, ExportConfig) + **test** (preview vs export cùng `renderOneFrame`).

---

## Smoke tests tối thiểu (manual, cố định)

- [ ] Export 10s 320×180 30fps ✅
- [ ] Export 30s 1080p 60fps ✅
- [ ] Cancel ở 10% / 50% / 90% ✅
- [ ] Retry GPU→CPU (giả lập fail NVENC nếu cần) ✅

---

## Debug switch (env)

- `DEBUG_SONGNHAC_FFMPEG=1` — log FFmpeg stderr (300 ký tự) trong pipe.
- `DEBUG_SONGNHAC_EXPORT=1` — (tùy chọn) log queue length / throughput khi thêm.

---

## Phạm vi module (freeze)

- **Engine hiện tại:** WaveBars only.
- **Layer / preset / FX:** out of scope cho phiên bản freeze.
- Mở rộng sau: đi qua interface + test, không đụng contract trên.

---

## Tiếp theo trong Sóng nhạc (đã chốt)

**Bước tiếp theo bắt buộc:** **Bước 6 — Audio Input & Binding**  
- Chốt: **YES — dùng audio từ playlist hiện tại** (option A; option B = chọn file riêng làm sau).  
- Mục tiêu: User chọn audio → preview + timeline + export dùng audio đó; chưa có audio → disable Export, "Load audio to export".  
- **Contract đã viết:** [CONTRACT_BUOC_6_AUDIO_INPUT.md](CONTRACT_BUOC_6_AUDIO_INPUT.md) — phạm vi, luồng binding, file được sửa, file không được đụng, UX tối thiểu, checklist pass/fail.

**Sau Bước 6**, chọn một hướng:
- **1️⃣ EDIT** — Layer, engine per layer, Inspector, playhead, keyframe, beat-sync (phase lớn, Sóng nhạc v2).
- **3️⃣ PRESET / TEMPLATE** — Preset WaveBars, load/save, áp preset rồi export (nhẹ hơn).

Nếu **không** làm tiếp Sóng nhạc: chọn module khác trong app (sidebar 1–12), contract trước khi code.

---

**Contract:** README này là nguồn chân lý kiến trúc Chức năng 13. Thay đổi vi phạm layout/PreviewViewport/Timeline/Export contract → reject. Mọi sai khác Preview ≠ Export chỉ có thể do render-core/engine — dùng làm kim chỉ nam debug.

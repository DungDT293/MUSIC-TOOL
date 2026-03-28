# CONTRACT BƯỚC 6 — Audio Input & Binding (Sóng nhạc)

**Mục tiêu duy nhất:** User chọn audio (từ playlist trong app) → preview chạy → timeline có waveform → export dùng đúng audio đó. Chưa có audio → Export disabled + "Load audio to export".

**Nguyên tắc:** Contract trước, code sau. Không đưa audio/FFT vào Zustand. Không đụng export backend.

---

## 1. Phạm vi chính xác

| Trong phạm vi | Ngoài phạm vi (khóa Bước 6) |
|---------------|-----------------------------|
| Audio lấy từ **playlist / track hiện tại trong app** (Option A) | File picker chọn file audio riêng (Option B — để sau) |
| Binding: playlist → &lt;audio&gt; → Preview + Timeline + Export | Thêm engine, layer edit, keyframe |
| UX: có/không audio → enable/disable Export, tên + duration | Sửa logic render-core, export backend |
| **Có thể** lưu `currentAudioUrl: string \| null` (hoặc path) để Export + "có audio chưa" | Không lưu FFT, không lưu buffer/Blob/HTMLAudioElement trong store |

**Nguồn playlist:** Dùng `window.api.listPlaylists()` (đã có). User trong màn Sóng nhạc chọn 1 playlist → chọn 1 track → track đó trở thành "current track" cho session (preview + timeline + export).

---

## 2. Luồng binding kỹ thuật

```
┌─────────────────────────────────────────────────────────────────┐
│  UI Sóng nhạc (SongNhacScreen hoặc component con)                │
│  - List playlists (listPlaylists)                                │
│  - Chọn playlist → chọn track (path, duration từ PlaylistTrack)  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Đổi path → file URL (toFileUrl hoặc fallback file://)           │
│  Tạo / cập nhật <audio> element (src = file URL)                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────┐
│ PreviewViewport │ │ Timeline        │ │ Export (Dialog/Toolbar)  │
│ .attachAudio(   │ │ startCompute(   │ │ audioFileUrl = url hoặc  │
│   audioEl       │ │   channelData,  │ │ path đã chọn             │
│ )               │ │   sampleRate,   │ │ durationSec = track thật │
│                 │ │   duration      │ │ Enable khi có audio      │
│                 │ │ )               │ │ Disable + text khi chưa  │
└─────────────────┘ └─────────────────┘ └─────────────────────────┘
```

**Quy tắc:**
- **Audio element** do UI (Screen hoặc component chọn track) sở hữu; truyền xuống PreviewViewport qua prop (ref hoặc element). PreviewViewport chỉ gọi `runtimeRef.current.attachAudio(audioEl)` khi có element hợp lệ.
- **Timeline:** Khi có audio đã load (metadata hoặc decode xong), gọi `startCompute(channelData, sampleRate, duration)`. Nguồn channelData: decode trong renderer (sau khi có ArrayBuffer từ file, qua IPC đọc file hoặc blob từ audio element nếu có cơ chế).
- **Export:** `ExportConfig.audioFileUrl` = file URL (file://) của track đã chọn; `durationSec` từ timeline hoặc track.duration. Không gửi blob/arrayBuffer lên backend; backend đã nhận `audioFileUrl` và tự xử lý.
- **Không:** Đưa FFT / currentTime / waveform / HTMLAudioElement vào Zustand. Không gọi API FFT từ React. Không sửa `renderOneFrame`, ExportRuntime, FFmpeg, IPC export.

---

## 3. Danh sách FILE ĐƯỢC SỬA

| File | Thay đổi dự kiến (chỉ ý niệm, implementation chi tiết theo code) |
|------|-------------------------------------------------------------------|
| `src/features/song-nhac/SongNhacScreen.tsx` | Orchestrate: state "track đã chọn" (url/path + duration + tên); truyền audio ref/url xuống Preview + Export; có thể thêm component con "AudioSourceSelector" (playlist + track dropdown). |
| `src/features/song-nhac/PreviewViewport.tsx` | Nhận prop (vd. `audioRef` từ ngoài hoặc `initialAudioUrl`); gọi `attachAudio(audioEl)` khi có; giữ nút "Play demo" cho fallback; không bắt buộc decode tại đây — có thể decode ở layer cha rồi gọi `onTimelineCompute`. |
| Timeline trigger | Khi load xong track (decode xong hoặc có duration + channelData), gọi `startCompute(channelData, sampleRate, duration)` (đã có từ `useTimelineCompute`). Nơi gọi: Screen hoặc component chứa cả Preview + Timeline. |
| `src/features/song-nhac/export/ExportDialog.tsx` (và/hoặc toolbar) | Enable nút "Export…" / "Start export" chỉ khi **có audio đã chọn**; khi chưa có: disable + hiện text "Load audio to export". Lấy `audioFileUrl` và duration từ props/context/store nhẹ (vd. `currentAudioUrl`, `currentDurationSec`) — chỉ string/number, không phải audio buffer. |
| `src/features/song-nhac/toolbar/VisualizerToolbar.tsx` | Có thể disable "Export…" khi chưa có audio (hoặc để ExportDialog tự disable "Start export" và hiện text; tùy UX thống nhất). |
| Store (nếu cần tối thiểu) | Cho phép **chỉ** các field dạng: `currentAudioUrl: string | null`, `currentAudioDurationSec: number`, `currentTrackDisplayName: string` (để Export + UX). Không thêm FFT, waveform, audio element ref vào store. Có thể dùng một store nhỏ (vd. `songNhacAudioStore`) hoặc mở rộng nhẹ store hiện có đúng mục "có audio chưa + url + duration". |

**Có thể thêm file mới (không đụng file freeze):**
- Component UI chọn playlist + track (vd. `AudioSourceSelector.tsx`) trong `src/features/song-nhac/` gọi `listPlaylists()`, hiển thị playlist/track, trả về `{ path, fileUrl, duration, displayName }`.

**Decode audio cho Timeline:** Hiện timeline cần `channelData, sampleRate, duration`. Với file local (file://), renderer có thể cần IPC để đọc file thành ArrayBuffer (nếu app đã có sẵn); sau đó `AudioContext.decodeAudioData` trong renderer rồi gọi `startCompute`. Hoặc dùng cơ chế tương tự "Play demo" (fetch không dùng được cho file://) — contract để mở: "decode trong renderer hoặc qua IPC, miễn không đụng runtime/audio hay export backend".

---

## 4. Danh sách FILE TUYỆT ĐỐI KHÔNG ĐƯỢC ĐỤNG

| File / module | Lý do |
|---------------|--------|
| `src/features/song-nhac/runtime/export/renderOneFrame.ts` | Freeze — mọi sai khác Preview ≠ Export chỉ do render-core. |
| `src/features/song-nhac/runtime/export/ExportRuntime.ts` | Freeze. |
| `src/features/song-nhac/runtime/export/AudioSourceExport.ts` | Thuộc export deterministic. |
| `src/features/song-nhac/runtime/audio/*` | Runtime FFT; không đưa vào React/Zustand. |
| `backend/video/songNhacFfmpegPipe.ts` | Freeze backend. |
| `electron/main.ts` (các handler song-nhac: export-video, export-ready, export-config-ack, export-frame, export-progress, export-done, export-cancel; writer loop; closeStdinAndFinish) | Freeze backend. |
| `src/features/song-nhac/export/ExportRunner.tsx`, `IpcFrameSink.ts` | Export runner + IPC frame — không đụng logic. |
| Các IPC handler export trong preload (đã expose songNhac.exportVideo, v.v.) | Chỉ dùng, không sửa signature/behavior. |

**Tóm tắt:** Không sửa render-core, runtime/audio, export pipeline (main + FFmpeg + offscreen runner). Chỉ sửa UI + binding (Screen, PreviewViewport props, Timeline trigger, ExportDialog enable/disable + nguồn audioFileUrl/duration).

---

## 5. UX tối thiểu (rõ ràng)

| Tình huống | Yêu cầu |
|------------|---------|
| **Chưa có audio** | Nút Export (toolbar/dialog) **disabled**. Hiển thị text kiểu "Load audio to export" (trong dialog hoặc gần nút Export). |
| **Đã chọn track (có audio)** | Hiển thị **tên track** (hoặc fileName) và **duration** (ví dụ "3:24"). Export **enabled**. Full track = duration thật từ track/timeline. |
| **Export dialog** | Khi mở, nếu chưa có audio: vẫn mở nhưng "Start export" disabled + text "Load audio to export". Range "Full track" dùng `trackDurationSec` thật. |

Không bắt buộc: drag-drop file, file picker (Option B). Chỉ cần: chọn từ playlist trong màn Sóng nhạc → có audio → preview + timeline + export dùng đúng nguồn đó.

---

## 6. Checklist pass/fail cho Bước 6

Khi code xong, kiểm tra:

- [ ] **Load từ playlist:** Trong Sóng nhạc, user chọn được playlist và 1 track từ playlist đó.
- [ ] **Preview chạy:** Sau khi chọn track, preview (visualizer) chạy đúng với audio đó (attachAudio + play).
- [ ] **Timeline có waveform:** Timeline hiển thị waveform (và nếu có, beat) tương ứng track đã chọn.
- [ ] **Export dùng đúng audio:** Export video có tiếng đúng track đã chọn; duration khớp (Full track = duration thật).
- [ ] **Preview ≡ Export:** Chuyển động visualizer khi xem preview và khi xem file export giống nhau (cùng renderOneFrame, đã đảm bảo từ trước).
- [ ] **Chưa có audio:** Export disabled, có text "Load audio to export" (hoặc tương đương).
- [ ] **Không đụng file cấm:** Không sửa renderOneFrame, ExportRuntime, songNhacFfmpegPipe, IPC handlers export, runtime/audio.

---

**Contract này là phần mở rộng của README Chức năng 13.** Mọi thay đổi Bước 6 phải tuân theo đúng file được sửa / không được đụng và luồng binding ở trên.

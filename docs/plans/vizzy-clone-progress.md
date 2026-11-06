# Clone chức năng Vizzy — tiến độ

Mục tiêu: clone toàn bộ chức năng editor Vizzy vào Sóng nhạc. Mỗi mục chỉ được đánh ✅ khi
đã chạy trong app thật (chụp ảnh) hoặc đã đo được, không đánh dấu theo cảm tính.

## Panel trái

| Panel | Vizzy có | Trạng thái |
|---|---|---|
| **Composition** | cây nhóm → layer, thêm/xoá/nhân bản, thứ tự | ✅ (LayersPanel) |
| **Analyzers** | analyzer theo layer: dải tần, màu, độ nhạy | ✅ dải tần + độ nhạy + làm mượt theo từng layer (rail Analyzer + Inspector) |
| **Effects** | blending, two-pass blur, global alpha, FXAA, tint, mirror, camera shake | ✅ blur (1 pass / 2 pass separable), alpha, tint, mirror, zoom, shake, **FXAA** |
| **Automations** | keyframe theo thuộc tính | ✅ keyframe opacity/scaleX/scaleY/x/y/rotation, nội suy tuyến tính, hiện trên timeline |
| **Media** | uploads, stock, audio, images, videos | ✅ thư viện 3 tab + **kho mẫu 8 nền SVG dựng sẵn** (bấm là thêm lớp) |
| **Projects** | project settings/history, list | ✅ lưu/mở .json, **danh sách gần đây (10)**, **tự lưu nháp + khôi phục khi mở app** |
| **Lyrics** | nhập lyric, LRCLIB | ✅ nhập LRC/plain, tự chia thời gian, overlay lyric, **tìm lời online qua LRCLIB** |

## Panel phải (Inspector theo loại object)

| Object | Vizzy | Trạng thái |
|---|---|---|
| **Visualizer** | preset, spectrum layers, general, position, basics | 🟡 ~12 tham số (preset, màu, sóng, glow, thời gian) |
| **Particles** | shape 5 kiểu, color, mirror, constant size, front/back limit + time, alpha, amount, opacity range, size range, fade in/out, random, behaviour, origin, transform | 🟡 11 tham số (shape 3 kiểu, màu, amount, size/opacity range, speed, spread, gravity, beat, mirror) |
| **Image** | appearance, blending, flatten, transform | ✅ thêm blend, anchor, bo góc, viền, bóng đổ |
| **Video** | như image | ✅ cùng bộ với image |
| **Text** | font, stroke, shadow, alignment | 🟡 font/cỡ/màu/viền/bóng, chưa có căn lề nhiều dòng |

## Timeline

| Chức năng | Trạng thái |
|---|---|
| waveform thật | ✅ |
| playhead + seek | ✅ |
| zoom | ✅ |
| track theo layer | ✅ |
| kéo mép clip đổi thời gian | ✅ kéo mép trái/phải + kéo thân clip, có undo gesture, **snap + đường guide** |
| Snap theo lưới thời gian (1s ≤4 phút, 5s ≤15 phút, 15s dài hơn) | ✅ |
| chọn & kéo nhiều clip | ✅ Ctrl/Shift-click chọn nhiều, kéo thân là cả nhóm dời cùng delta |
| keyframe trên track | ✅ hiện kim cương, **kéo để đổi thời điểm**, snap lưới + key khác |
| Danh sách keyframe trong Inspector (nhảy tới, nhân bản +1s, xoá từng key) | ✅ |
| ruler thời gian | ✅ mốc tự chọn theo độ dài |

| Context menu chuột phải (chọn preset, thêm keyframe, ẩn, nhân bản, thứ tự, reset, xoá) | ✅ |
| Context menu cho clip timeline (bắt đầu/kết thúc tại playhead, phủ toàn bài, xoá khoảng, ẩn, nhân bản, bật/tắt snap) | ✅ |
| Preset thumbnail render thật (1 engine dùng lại, cache localStorage theo theme) | ✅ |
| Preset tự tạo (lưu cấu hình sóng hiện tại, đặt tên, áp dụng, xoá) | ✅ |
| Áp preset cho nhiều lớp sóng cùng lúc (Ctrl/Shift chọn nhiều) | ✅ |
| Thumbnail render thật cho preset tự tạo | ✅ |
| Phím tắt editor (Space, ←/→, Ctrl+D, Delete, Ctrl+Z/Y, S, Ctrl+S, **Ctrl+C/V**) | ✅ |
| Sao chép / dán lớp (giữ timeRange, offset 30px) | ✅ |
| Dán tại playhead (Ctrl+Shift+V) | ✅ |

## Ngoài phạm vi Vizzy (làm cho quy trình số lượng lớn)

| Chức năng | Trạng thái |
|---|---|
| Hàng đợi export (nhiều video, xuất lần lượt, tiến độ từng cái, huỷ) | ✅ |
| Xuất theo khoảng thời gian trong hàng đợi | ✅ |
| Xuất hàng loạt: chọn nhiều bài + 1 thư mục, mỗi bài 1 job | ✅ |
| Hàng đợi lưu qua lần mở app; job đang chạy tự resume thành chờ | ✅ |
| Hoàn tác / làm lại thao tác hàng đợi (thêm, xoá, dọn) | ✅ |

## Ghi chú kỹ thuật

- Ảnh/video: bo góc, viền, bóng đổ được **bake vào texture** (canvas 2D) nên không tốn shader.
- Blend mode áp lên `MeshBasicMaterial.blending`; screen dùng custom blend.
- Effects chạy trong `finishPass` (1 pass duy nhất trước OutputPass) và đi theo cả đường xuất video.
